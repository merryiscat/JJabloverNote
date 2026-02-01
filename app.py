import os
import uuid
import json
import time
import threading
import torch
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory, Response
from werkzeug.utils import secure_filename
from transcribe import load_whisper_model, transcribe_audio, get_audio_duration

# .env 파일 로드
load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 최대 100MB

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a', 'flac'}

# 사용 가능한 모델 목록
AVAILABLE_MODELS = [
    {"id": "openai/whisper-tiny", "name": "Tiny (가장 빠름, 낮은 품질)"},
    {"id": "openai/whisper-base", "name": "Base (빠름, 보통 품질)"},
    {"id": "openai/whisper-small", "name": "Small (보통 속도, 좋은 품질)"},
    {"id": "openai/whisper-medium", "name": "Medium (느림, 높은 품질)"},
    {"id": "openai/whisper-large-v3", "name": "Large-v3 (가장 느림, 최고 품질)"},
]

# 전역 설정
class TranscriptionConfig:
    def __init__(self):
        self.model_id = "openai/whisper-base"
        self.device_mode = "auto"  # auto, cuda, cpu
        self.enable_diarization = True
        self.hf_token = os.getenv('HF_TOKEN', '')

    def to_dict(self):
        return {
            "model_id": self.model_id,
            "device_mode": self.device_mode,
            "enable_diarization": self.enable_diarization,
            "hf_token": "****" if self.hf_token else ""
        }

    def update(self, data):
        if "model_id" in data:
            self.model_id = data["model_id"]
        if "device_mode" in data:
            self.device_mode = data["device_mode"]
        if "enable_diarization" in data:
            self.enable_diarization = data["enable_diarization"]
        if "hf_token" in data and data["hf_token"] != "****":
            self.hf_token = data["hf_token"]

config = TranscriptionConfig()

# 모델은 첫 요청 시 로드 (lazy loading)
whisper_pipe = None
current_model_id = None
current_device_mode = None

# 작업 상태 저장
job_status = {}

# 모델 로드 잠금
model_lock = threading.Lock()


def get_whisper_pipe(force_reload=False):
    global whisper_pipe, current_model_id, current_device_mode

    with model_lock:
        need_reload = (
            force_reload or
            whisper_pipe is None or
            current_model_id != config.model_id or
            current_device_mode != config.device_mode
        )

        if need_reload:
            # 기존 모델 해제
            if whisper_pipe is not None:
                print(f"기존 모델 해제 중... ({current_model_id})")
                del whisper_pipe
                whisper_pipe = None
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                print("GPU 메모리 정리 완료")

            print(f"Whisper 모델 로딩 중... ({config.model_id}, device={config.device_mode})")
            whisper_pipe = load_whisper_model(config.model_id, config.device_mode)
            current_model_id = config.model_id
            current_device_mode = config.device_mode
            print("모델 로딩 완료!")

        return whisper_pipe


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/config', methods=['GET'])
def get_config():
    """현재 설정 및 사용 가능한 모델 목록 반환"""
    return jsonify({
        "success": True,
        "config": config.to_dict(),
        "available_models": AVAILABLE_MODELS,
        "cuda_available": torch.cuda.is_available(),
        "current_device": current_device_mode or config.device_mode
    })


@app.route('/api/config', methods=['POST'])
def update_config():
    """설정 업데이트"""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "요청 데이터가 없습니다"}), 400

    # 유효성 검증
    if "model_id" in data:
        valid_models = [m["id"] for m in AVAILABLE_MODELS]
        if data["model_id"] not in valid_models:
            return jsonify({"success": False, "error": "유효하지 않은 모델입니다"}), 400

    if "device_mode" in data:
        if data["device_mode"] not in ["auto", "cuda", "cpu"]:
            return jsonify({"success": False, "error": "유효하지 않은 장치 모드입니다"}), 400
        if data["device_mode"] == "cuda" and not torch.cuda.is_available():
            return jsonify({"success": False, "error": "CUDA를 사용할 수 없습니다"}), 400

    config.update(data)

    return jsonify({
        "success": True,
        "config": config.to_dict(),
        "message": "설정이 업데이트되었습니다"
    })


@app.route('/api/reload-model', methods=['GET', 'POST'])
def reload_model():
    """모델 강제 리로드"""
    def generate():
        yield f"data: {json.dumps({'stage': 'start', 'message': '모델 리로드 시작...'})}\n\n"

        try:
            yield f"data: {json.dumps({'stage': 'unloading', 'message': '기존 모델 해제 중...'})}\n\n"

            get_whisper_pipe(force_reload=True)

            yield f"data: {json.dumps({'stage': 'complete', 'message': '모델 리로드 완료!'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'stage': 'error', 'message': str(e)})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


def get_unique_filename(folder, filename):
    """중복 파일명 처리 - 파일명(1), 파일명(2) 형식으로 변경"""
    base, ext = os.path.splitext(filename)
    counter = 1
    new_filename = filename

    while os.path.exists(os.path.join(folder, new_filename)):
        new_filename = f"{base}({counter}){ext}"
        counter += 1

    return new_filename


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'audio' not in request.files:
        return jsonify({'success': False, 'error': '파일이 없습니다'}), 400

    file = request.files['audio']
    if file.filename == '':
        return jsonify({'success': False, 'error': '선택된 파일이 없습니다'}), 400

    if file and allowed_file(file.filename):
        # 원본 파일명 보존 (한글 등)
        original_filename = file.filename
        filename = secure_filename(file.filename)
        if not filename:
            ext = original_filename.rsplit('.', 1)[1].lower()
            filename = f"{uuid.uuid4().hex}.{ext}"

        # 중복 파일명 처리
        filename = get_unique_filename(app.config['UPLOAD_FOLDER'], filename)

        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # 작업 ID 생성
        job_id = uuid.uuid4().hex
        job_status[job_id] = {
            'status': 'uploaded',
            'progress': 0,
            'message': '파일 업로드 완료',
            'filepath': filepath,
            'filename': filename,
            'result': None
        }

        return jsonify({
            'success': True,
            'job_id': job_id,
            'filename': filename
        })

    return jsonify({'success': False, 'error': '허용되지 않는 파일 형식입니다'}), 400


@app.route('/transcribe/<job_id>')
def transcribe_job(job_id):
    """SSE로 변환 진행률 전송"""
    if job_id not in job_status:
        return jsonify({'success': False, 'error': '작업을 찾을 수 없습니다'}), 404

    def generate():
        job = job_status[job_id]
        filepath = job['filepath']

        # 오디오 길이 확인
        duration = get_audio_duration(filepath)

        yield f"data: {json.dumps({'stage': 'init', 'progress': 0, 'message': '파일 분석 중...', 'duration': duration})}\n\n"

        try:
            yield f"data: {json.dumps({'stage': 'loading', 'progress': 5, 'message': '모델 로딩 중...'})}\n\n"

            pipe = get_whisper_pipe()

            yield f"data: {json.dumps({'stage': 'processing', 'progress': 10, 'message': f'음성 인식 시작 (길이: {duration:.1f}초)' if duration else '음성 인식 시작...', 'duration': duration})}\n\n"

            # 실제 변환 수행
            print(f"[Transcribe] Starting transcription for {filepath}")
            result = transcribe_audio(pipe, filepath)
            print(f"[Transcribe] Completed: {len(result.get('chunks', []))} chunks")

            # 화자 분리 수행
            chunks = result.get('chunks', [])

            if config.enable_diarization and config.hf_token:
                yield f"data: {json.dumps({'stage': 'diarization', 'progress': 80, 'message': '화자 분리 중...'})}\n\n"

                try:
                    from diarization import perform_diarization, merge_transcription_with_diarization

                    diarization_segments = perform_diarization(filepath, config.hf_token)
                    chunks = merge_transcription_with_diarization(chunks, diarization_segments)
                    print(f"[Diarization] Completed: {len(diarization_segments)} segments")
                except ImportError:
                    print("[Diarization] pyannote.audio가 설치되지 않았습니다")
                except Exception as e:
                    print(f"[Diarization] Error: {e}")

            yield f"data: {json.dumps({'stage': 'processing', 'progress': 95, 'message': '결과 처리 중...'})}\n\n"

            # 결과 저장
            job_status[job_id]['result'] = {'text': result['text'], 'chunks': chunks}
            job_status[job_id]['status'] = 'complete'

            yield f"data: {json.dumps({'stage': 'complete', 'progress': 100, 'message': f'변환 완료! ({len(chunks)}개 청크)', 'result': {'text': result['text'], 'chunks': chunks}})}\n\n"

        except Exception as e:
            import traceback
            print(f"[Transcribe] Error: {e}")
            traceback.print_exc()
            yield f"data: {json.dumps({'stage': 'error', 'progress': 0, 'message': str(e)})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@app.route('/job/<job_id>')
def get_job_result(job_id):
    """작업 결과 조회"""
    if job_id not in job_status:
        return jsonify({'success': False, 'error': '작업을 찾을 수 없습니다'}), 404

    job = job_status[job_id]
    if job['status'] == 'complete' and job['result']:
        return jsonify({
            'success': True,
            'filename': job['filename'],
            'text': job['result']['text'],
            'chunks': job['result'].get('chunks', [])
        })

    return jsonify({
        'success': False,
        'status': job['status'],
        'message': job.get('message', '')
    })


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# 노트 저장 관련 API
NOTES_FOLDER = 'notes'


def get_notes_list():
    """저장된 노트 목록 조회"""
    notes = []
    if os.path.exists(NOTES_FOLDER):
        for filename in os.listdir(NOTES_FOLDER):
            if filename.endswith('.json'):
                filepath = os.path.join(NOTES_FOLDER, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        note = json.load(f)
                        notes.append({
                            'id': note.get('id'),
                            'title': note.get('title'),
                            'created_at': note.get('created_at'),
                            'audio_filename': note.get('audio_filename'),
                            'duration': note.get('duration')
                        })
                except:
                    pass
    # 최신순 정렬
    notes.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    return notes


@app.route('/api/notes', methods=['GET'])
def list_notes():
    """저장된 노트 목록"""
    return jsonify({
        'success': True,
        'notes': get_notes_list()
    })


@app.route('/api/notes', methods=['POST'])
def save_note():
    """노트 저장 (부분 업데이트 지원)"""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': '데이터가 없습니다'}), 400

    note_id = data.get('id') or uuid.uuid4().hex
    os.makedirs(NOTES_FOLDER, exist_ok=True)
    filepath = os.path.join(NOTES_FOLDER, f'{note_id}.json')

    # 기존 노트가 있으면 로드하여 병합
    existing_note = {}
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            existing_note = json.load(f)

    # 기존 데이터에 새 데이터 병합 (새 데이터가 우선)
    note = {
        'id': note_id,
        'title': data.get('title') or existing_note.get('title') or '새 노트',
        'created_at': data.get('created_at') or existing_note.get('created_at') or time.strftime('%Y-%m-%d %H:%M:%S'),
        'audio_filename': data.get('audio_filename') if 'audio_filename' in data else existing_note.get('audio_filename'),
        'duration': data.get('duration') if 'duration' in data else existing_note.get('duration'),
        'text': data.get('text') if 'text' in data else existing_note.get('text'),
        'chunks': data.get('chunks') if 'chunks' in data else existing_note.get('chunks', [])
    }

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(note, f, ensure_ascii=False, indent=2)

    return jsonify({
        'success': True,
        'note': {
            'id': note['id'],
            'title': note['title'],
            'created_at': note['created_at']
        }
    })


@app.route('/api/notes/<note_id>', methods=['GET'])
def get_note(note_id):
    """노트 조회"""
    filepath = os.path.join(NOTES_FOLDER, f'{note_id}.json')

    if not os.path.exists(filepath):
        return jsonify({'success': False, 'error': '노트를 찾을 수 없습니다'}), 404

    with open(filepath, 'r', encoding='utf-8') as f:
        note = json.load(f)

    return jsonify({
        'success': True,
        'note': note
    })


@app.route('/api/notes/<note_id>', methods=['DELETE'])
def delete_note(note_id):
    """노트 삭제"""
    filepath = os.path.join(NOTES_FOLDER, f'{note_id}.json')

    if not os.path.exists(filepath):
        return jsonify({'success': False, 'error': '노트를 찾을 수 없습니다'}), 404

    os.remove(filepath)

    return jsonify({
        'success': True,
        'message': '노트가 삭제되었습니다'
    })


def main():
    os.makedirs('uploads', exist_ok=True)
    os.makedirs(NOTES_FOLDER, exist_ok=True)
    app.run(debug=True, port=5000, host='0.0.0.0', threaded=True)


if __name__ == '__main__':
    main()
