import torch
import os
import subprocess
import tempfile
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
import json


def convert_audio_to_wav(audio_path: str) -> str:
    """지원되지 않는 오디오 형식을 wav로 변환"""
    # wav, flac은 대부분 지원되므로 그대로 반환
    ext = os.path.splitext(audio_path)[1].lower()
    if ext in ['.wav', '.flac']:
        return audio_path, False

    # ffmpeg으로 wav 변환
    wav_path = tempfile.mktemp(suffix='.wav')
    try:
        result = subprocess.run([
            'ffmpeg', '-i', audio_path,
            '-ar', '16000',  # 16kHz로 리샘플링
            '-ac', '1',      # 모노
            '-y',            # 덮어쓰기
            wav_path
        ], check=True, capture_output=True)
        return wav_path, True  # True = 임시 파일 생성됨
    except subprocess.CalledProcessError as e:
        print(f"[Transcribe] ffmpeg 변환 실패: {e.stderr.decode() if e.stderr else e}")
        return audio_path, False
    except FileNotFoundError:
        print("[Transcribe] ffmpeg이 설치되지 않았습니다. 원본 파일로 시도합니다.")
        return audio_path, False


def get_device_and_dtype(device_mode="auto"):
    """GPU/CPU 선택 (auto, cuda, cpu)"""
    if device_mode == "cuda":
        if not torch.cuda.is_available():
            raise ValueError("CUDA를 사용할 수 없습니다. GPU가 없거나 CUDA가 설치되지 않았습니다.")
        return "cuda:0", torch.float16
    elif device_mode == "cpu":
        return "cpu", torch.float32
    else:  # auto
        if torch.cuda.is_available():
            return "cuda:0", torch.float16
        return "cpu", torch.float32


def load_whisper_model(model_id="openai/whisper-base", device_mode="auto"):
    """Whisper 모델 로드"""
    device, torch_dtype = get_device_and_dtype(device_mode)

    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_id,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True
    )
    model.to(device)

    processor = AutoProcessor.from_pretrained(model_id)

    pipe = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        torch_dtype=torch_dtype,
        device=device,
    )

    return pipe


def transcribe_audio(pipe, audio_path, language="korean"):
    """음성을 텍스트로 변환 (타임스탬프 포함)"""
    # 지원되지 않는 형식은 wav로 변환
    converted_path, is_temp = convert_audio_to_wav(audio_path)

    try:
        result = pipe(
            converted_path,
            return_timestamps=True,
            generate_kwargs={"language": language}
        )
        return result
    finally:
        # 임시 파일 삭제
        if is_temp and os.path.exists(converted_path):
            os.remove(converted_path)


def get_audio_duration(audio_path):
    """오디오 파일의 길이(초)를 반환 - ffprobe 사용"""

    # 방법 1: ffprobe 사용 (ffmpeg 설치 시 함께 설치됨)
    try:
        result = subprocess.run([
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            audio_path
        ], capture_output=True, text=True, timeout=10)

        if result.returncode == 0 and result.stdout.strip():
            duration = float(result.stdout.strip())
            print(f"[Transcribe] Audio duration (ffprobe): {duration:.1f}s")
            return duration
    except Exception as e:
        print(f"[Transcribe] ffprobe failed: {e}")

    # 방법 2: wave 모듈 (WAV 파일)
    try:
        import wave
        import contextlib

        if audio_path.lower().endswith('.wav'):
            with contextlib.closing(wave.open(audio_path, 'r')) as f:
                frames = f.getnframes()
                rate = f.getframerate()
                duration = frames / float(rate)
                print(f"[Transcribe] Audio duration (wave): {duration:.1f}s")
                return duration
    except Exception as e:
        print(f"[Transcribe] wave module failed: {e}")

    # 방법 3: mutagen (설치된 경우)
    try:
        from mutagen import File
        audio = File(audio_path)
        if audio is not None and audio.info is not None:
            duration = audio.info.length
            print(f"[Transcribe] Audio duration (mutagen): {duration:.1f}s")
            return duration
    except Exception as e:
        print(f"[Transcribe] mutagen failed: {e}")

    # 기본값 반환 (알 수 없는 경우)
    print("[Transcribe] Could not determine audio duration")
    return None


def adjust_timestamps(result, ratio):
    """타임스탬프를 비율에 맞게 조정"""
    if "chunks" in result:
        for chunk in result["chunks"]:
            if "timestamp" in chunk and chunk["timestamp"]:
                start, end = chunk["timestamp"]
                if start is not None:
                    chunk["timestamp"] = (start * ratio, end * ratio if end else None)
    return result


def filter_repeated_text(result):
    """반복되는 텍스트 청크를 필터링"""
    if "chunks" not in result or not result["chunks"]:
        return result

    filtered_chunks = []
    prev_text = ""
    repeat_count = 0
    max_repeats = 3  # 같은 텍스트가 3번 이상 연속되면 필터링

    for chunk in result["chunks"]:
        text = chunk.get("text", "").strip()

        # 같은 텍스트가 반복되는지 확인
        if text == prev_text:
            repeat_count += 1
            if repeat_count >= max_repeats:
                print(f"[Transcribe] Filtered repeated text: '{text[:50]}...'")
                continue
        else:
            repeat_count = 1
            prev_text = text

        filtered_chunks.append(chunk)

    if len(filtered_chunks) < len(result["chunks"]):
        print(f"[Transcribe] Filtered {len(result['chunks']) - len(filtered_chunks)} repeated chunks")

    result["chunks"] = filtered_chunks

    # 전체 텍스트도 재구성
    result["text"] = " ".join(c.get("text", "") for c in filtered_chunks)

    return result


def transcribe_audio_with_progress(pipe, audio_path, language="korean", progress_callback=None):
    """진행률 콜백과 함께 음성을 텍스트로 변환"""

    # 원본 오디오 길이 확인 (싱크 보정용)
    original_duration = get_audio_duration(audio_path)
    print(f"[Transcribe] Original audio duration: {original_duration:.1f}s" if original_duration else "[Transcribe] Could not get original duration")

    # 지원되지 않는 형식은 wav로 변환
    converted_path, is_temp = convert_audio_to_wav(audio_path)

    try:
        # 변환된 오디오 길이 확인
        if is_temp:
            converted_duration = get_audio_duration(converted_path)
            print(f"[Transcribe] Converted audio duration: {converted_duration:.1f}s" if converted_duration else "")
        else:
            converted_duration = original_duration

        duration = original_duration or converted_duration

        if progress_callback:
            progress_callback({
                "stage": "processing",
                "progress": 0,
                "message": "음성 분석 시작...",
                "duration": duration
            })

        # Whisper는 30초 단위로 chunk 처리
        chunk_length = 30  # seconds

        if duration and duration > chunk_length:
            # 긴 오디오: chunk 단위로 처리하며 진행률 업데이트
            total_chunks = int(duration / chunk_length) + 1

            result = pipe(
                converted_path,
                return_timestamps=True,
                generate_kwargs={
                    "language": language,
                    "condition_on_prev_tokens": False,  # 반복 방지
                    "compression_ratio_threshold": 1.35,  # 반복 감지 임계값
                    "no_speech_threshold": 0.6,
                },
                chunk_length_s=chunk_length,
            )

            if progress_callback:
                progress_callback({
                    "stage": "complete",
                    "progress": 100,
                    "message": "변환 완료!"
                })
        else:
            # 짧은 오디오: 한 번에 처리
            if progress_callback:
                progress_callback({
                    "stage": "processing",
                    "progress": 50,
                    "message": "음성 인식 중..."
                })

            result = pipe(
                converted_path,
                return_timestamps=True,
                generate_kwargs={
                    "language": language,
                    "condition_on_prev_tokens": False,  # 반복 방지
                    "compression_ratio_threshold": 1.35,
                    "no_speech_threshold": 0.6,
                }
            )

            if progress_callback:
                progress_callback({
                    "stage": "complete",
                    "progress": 100,
                    "message": "변환 완료!"
                })

        # 반복 텍스트 필터링
        result = filter_repeated_text(result)

        # 타임스탬프 싱크 보정 (원본 오디오와 변환된 오디오의 duration이 다를 경우)
        if is_temp and original_duration and converted_duration and abs(original_duration - converted_duration) > 0.5:
            ratio = original_duration / converted_duration
            print(f"[Transcribe] Applying timestamp correction ratio: {ratio:.4f}")
            result = adjust_timestamps(result, ratio)

        return result
    finally:
        # 임시 파일 삭제
        if is_temp and os.path.exists(converted_path):
            os.remove(converted_path)
