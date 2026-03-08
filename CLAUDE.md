# JJablover Note - 프로젝트 가이드

## 프로젝트 개요
음성을 텍스트로 변환(STT)하고, 화자를 분리하며, AI 요약을 생성하는 Flask 웹 앱

## 기술 스택
- **Backend**: Flask, Python 3.10+
- **STT**: OpenAI Whisper (transformers)
- **화자 분리**: pyannote.audio 3.4.0
- **AI 요약**: OpenAI GPT / Anthropic Claude
- **오디오 처리**: ffmpeg, torchaudio

## 개발 환경

### 가상환경
```powershell
# 활성화
.\Jnote\Scripts\Activate.ps1

# 비활성화
deactivate
```

### 필수 시스템 의존성
- **ffmpeg**: 오디오 파일 로드에 필수
  ```powershell
  winget install ffmpeg --accept-source-agreements
  ```

### Python 패키지 설치
```powershell
# CUDA 12.4 버전 PyTorch (GPU 사용 시)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# 기본 패키지
pip install flask python-dotenv transformers accelerate pyannote.audio
```

## 환경 변수 (.env)
```
HF_TOKEN=<HuggingFace 토큰>  # pyannote 모델 다운로드용
OPENAI_API_KEY=<선택>
ANTHROPIC_API_KEY=<선택>
```

## 실행
```powershell
python app.py
# http://localhost:5000
```

## 주요 파일
- `app.py` - Flask 서버, API 엔드포인트
- `transcribe.py` - Whisper 모델 로드 및 변환
- `diarization.py` - 화자 분리 모듈
- `static/` - 프론트엔드 (HTML, JS, CSS)
- `notes/` - 저장된 노트 JSON
- `uploads/` - 업로드된 오디오 파일
