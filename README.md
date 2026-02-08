# JJablover Note

음성을 텍스트로 변환하고, 화자를 분리하여 표시하며, AI 요약을 생성하는 웹 앱

---

## 주요 기능

### 1. 음성-텍스트 변환 (STT)
- **Whisper 모델**: Tiny, Base, Small, Medium, Large-v3 선택
- **처리 장치**: 자동/GPU(CUDA)/CPU 선택
- SSE로 실시간 진행률 표시

### 2. 화자 분리 (Speaker Diarization)
- **pyannote.audio 3.4.0** 사용
- 화자별 블록 분리 표시 (화자1, 화자2...)
- 색상 구분 (neon-pink, neon-blue)

### 3. 노트 관리
- 변환 완료 시 자동 저장
- 노트 제목 수정 (클릭하여 편집)
- 노트 삭제
- 서버 재시작 후에도 유지 (JSON 파일 저장)

### 4. AI 요약 기능
- OpenAI GPT / Anthropic Claude 지원
- 사용자 정의 템플릿
- 타임스탬프 출처 표기 [MM:SS]
- 타임스탬프 클릭 시 해당 위치 재생
- 요약 검증 기능 (누락 내용 확인)
- 요약 편집 및 복사

### 5. 프리셋 관리
- LLM 설정 저장/불러오기
- 템플릿 포함 저장

---

## 파일 구조

```
JJabloverNote/
├── app.py              # Flask 서버, API 엔드포인트
├── transcribe.py       # Whisper 모델 로드 및 변환
├── diarization.py      # 화자 분리 모듈 (pyannote.audio)
├── .env                # 환경 변수 (HF_TOKEN 등)
├── .env.example        # 환경 변수 예시
├── .gitignore          # Git 제외 파일
├── pyproject.toml      # 의존성 정의
├── static/
│   ├── index.html      # 메인 HTML
│   ├── script.js       # 프론트엔드 로직
│   └── style.css       # 스타일
├── uploads/            # 업로드된 오디오 파일 (git 제외)
└── notes/              # 저장된 노트 JSON (git 제외)
```

---

## 설치 및 실행

### 사전 요구사항
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (Python 패키지 매니저)
- [ffmpeg](https://ffmpeg.org/) (오디오 변환용)
- NVIDIA GPU + 드라이버 (GPU 사용 시)

### 1. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일에 HuggingFace 토큰 입력
```

### 2. uv로 설치 및 실행
```bash
# 가상환경 생성 (기존 있으면 초기화)
uv venv --clear

# 의존성 설치 (CUDA PyTorch 자동 적용)
uv sync

# 화자 분리 기능 포함 설치
uv sync --extra diarization

# pyannote.audio가 PyTorch를 CPU 버전으로 덮어쓸 수 있으므로 CUDA 재설치
uv pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124 --force-reinstall --no-deps

# 서버 실행
uv run python app.py
```

### 3. pip으로 설치 (uv 없이)
```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Mac/Linux

# CUDA 버전 PyTorch (GPU 사용 시)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# 기본 패키지
pip install flask python-dotenv transformers accelerate pyannote.audio

# 서버 실행
python app.py
```

브라우저에서 `http://localhost:5000` 접속

---

## API 엔드포인트

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/config` | 현재 설정 및 모델 목록 |
| POST | `/api/config` | 설정 업데이트 |
| POST | `/upload` | 오디오 파일 업로드 |
| GET | `/transcribe/<job_id>` | SSE로 변환 진행률 전송 |
| GET | `/api/notes` | 노트 목록 |
| POST | `/api/notes` | 노트 저장/수정 |
| GET | `/api/notes/<id>` | 노트 조회 |
| DELETE | `/api/notes/<id>` | 노트 삭제 |

---

## 의존성

```
flask>=3.0.0
python-dotenv>=1.0.0
transformers>=4.36.0
torch>=2.1.0
accelerate>=0.25.0
pyannote.audio>=3.1,<4.0
```

---

## 해결한 이슈

- **PyTorch 2.6 weights_only**: `torch.load` monkey-patch
- **m4a 미지원**: ffmpeg으로 wav 변환
- **파일명 중복**: `파일명(1).mp3` 형식 자동 변경
