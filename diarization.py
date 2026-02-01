"""화자 분리 모듈 (pyannote.audio 사용)"""

from typing import List, Dict, Optional
import torch

# PyTorch 2.6+ weights_only 문제 해결 (pyannote.audio 호환성)
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

# lightning_fabric도 patch
import lightning_fabric.utilities.cloud_io as cloud_io
cloud_io.torch.load = _patched_torch_load

# 캐시된 파이프라인
_diarization_pipeline = None


def load_diarization_pipeline(hf_token: str):
    """화자 분리 파이프라인 로드"""
    global _diarization_pipeline

    if _diarization_pipeline is None:
        from pyannote.audio import Pipeline

        _diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token
        )

        # GPU 사용 가능하면 GPU로 이동
        import torch
        if torch.cuda.is_available():
            _diarization_pipeline.to(torch.device("cuda"))

    return _diarization_pipeline


def convert_to_wav_if_needed(audio_path: str) -> str:
    """m4a 등 지원되지 않는 형식을 wav로 변환"""
    import os
    import tempfile
    import subprocess

    # wav는 그대로 반환
    if audio_path.lower().endswith('.wav'):
        return audio_path

    # ffmpeg으로 wav 변환
    wav_path = tempfile.mktemp(suffix='.wav')
    try:
        subprocess.run([
            'ffmpeg', '-i', audio_path,
            '-ar', '16000',  # 16kHz로 리샘플링
            '-ac', '1',  # 모노
            '-y',  # 덮어쓰기
            wav_path
        ], check=True, capture_output=True)
        return wav_path
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg 변환 실패: {e.stderr.decode()}")


def perform_diarization(audio_path: str, hf_token: str) -> List[Dict]:
    """
    오디오 파일에서 화자 분리 수행

    Returns:
        List[Dict]: 각 세그먼트의 정보
            - start: 시작 시간 (초)
            - end: 종료 시간 (초)
            - speaker: 화자 ID
    """
    pipeline = load_diarization_pipeline(hf_token)

    # 지원되지 않는 형식은 wav로 변환
    wav_path = convert_to_wav_if_needed(audio_path)

    # 화자 분리 수행
    diarization = pipeline(wav_path)

    # 임시 파일이면 삭제
    if wav_path != audio_path:
        import os
        os.remove(wav_path)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "start": turn.start,
            "end": turn.end,
            "speaker": speaker
        })

    return segments


def merge_transcription_with_diarization(
    chunks: List[Dict],
    diarization_segments: List[Dict]
) -> List[Dict]:
    """
    음성 인식 결과와 화자 분리 결과 병합

    Args:
        chunks: Whisper의 변환 결과 (text, timestamp)
        diarization_segments: 화자 분리 결과 (start, end, speaker)

    Returns:
        화자 정보가 추가된 청크 리스트
    """
    if not diarization_segments:
        return chunks

    # 화자 ID를 보기 좋은 이름으로 변환
    speaker_map = {}
    speaker_count = 0

    merged_chunks = []

    for chunk in chunks:
        if not chunk.get('timestamp'):
            merged_chunks.append(chunk)
            continue

        chunk_start = chunk['timestamp'][0]
        chunk_end = chunk['timestamp'][1]
        chunk_mid = (chunk_start + chunk_end) / 2

        # 청크의 중간 지점이 속한 화자 찾기
        speaker = None
        for seg in diarization_segments:
            if seg['start'] <= chunk_mid <= seg['end']:
                speaker = seg['speaker']
                break

        # 화자를 찾지 못한 경우 가장 가까운 세그먼트의 화자 사용
        if speaker is None:
            min_distance = float('inf')
            for seg in diarization_segments:
                seg_mid = (seg['start'] + seg['end']) / 2
                distance = abs(chunk_mid - seg_mid)
                if distance < min_distance:
                    min_distance = distance
                    speaker = seg['speaker']

        # 화자 이름 매핑
        if speaker and speaker not in speaker_map:
            speaker_count += 1
            speaker_map[speaker] = format_speaker_label(speaker, speaker_count)

        merged_chunk = chunk.copy()
        merged_chunk['speaker'] = speaker_map.get(speaker, '화자')
        merged_chunks.append(merged_chunk)

    return merged_chunks


def format_speaker_label(speaker_id: str, index: int) -> str:
    """
    화자 ID를 사용자 친화적인 라벨로 변환

    Args:
        speaker_id: pyannote에서 생성한 화자 ID (예: "SPEAKER_00")
        index: 화자 순서 번호

    Returns:
        포맷된 화자 라벨 (예: "화자1")
    """
    return f"화자{index}"
