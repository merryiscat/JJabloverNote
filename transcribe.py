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
    """오디오 파일의 길이(초)를 반환"""
    try:
        import wave
        import contextlib

        # WAV 파일인 경우
        if audio_path.lower().endswith('.wav'):
            with contextlib.closing(wave.open(audio_path, 'r')) as f:
                frames = f.getnframes()
                rate = f.getframerate()
                return frames / float(rate)
    except:
        pass

    # 다른 포맷은 mutagen 사용 시도
    try:
        from mutagen import File
        audio = File(audio_path)
        if audio is not None and audio.info is not None:
            return audio.info.length
    except:
        pass

    # 기본값 반환 (알 수 없는 경우)
    return None


def transcribe_audio_with_progress(pipe, audio_path, language="korean", progress_callback=None):
    """진행률 콜백과 함께 음성을 텍스트로 변환"""

    # 지원되지 않는 형식은 wav로 변환
    converted_path, is_temp = convert_audio_to_wav(audio_path)

    try:
        # 오디오 길이 확인
        duration = get_audio_duration(converted_path)

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
                generate_kwargs={"language": language},
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
                generate_kwargs={"language": language}
            )

            if progress_callback:
                progress_callback({
                    "stage": "complete",
                    "progress": 100,
                    "message": "변환 완료!"
                })

        return result
    finally:
        # 임시 파일 삭제
        if is_temp and os.path.exists(converted_path):
            os.remove(converted_path)
