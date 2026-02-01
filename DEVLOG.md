# JJabloverNote 개발 일지 - 회의 녹취록 자동화 서비스 만들기

## 프로젝트 소개

**JJabloverNote**는 회의 음성 파일을 업로드하면 자동으로 텍스트로 변환하고, 누가 말했는지 구분하고, AI가 요약까지 해주는 웹 서비스입니다.

### 왜 만들었나?
회의 끝나고 녹취록 정리하는 게 너무 귀찮았습니다. 2시간 회의 녹음 들으면서 타이핑하면 반나절이 걸리는데, 이걸 자동화하면 좋겠다고 생각했습니다.

### 주요 기능
1. **음성 → 텍스트 변환** (Speech-to-Text)
2. **화자 분리** (누가 말했는지 구분)
3. **AI 요약** (GPT/Claude로 회의록 자동 생성)
4. **노트 저장/관리**

---

# Part 1: 프로젝트 구조 설계

## 파일 구조

```
JJabloverNote/
├── app.py              # 서버 (Flask)
├── transcribe.py       # 음성 인식 (Whisper)
├── diarization.py      # 화자 분리 (pyannote)
├── static/
│   ├── index.html      # 화면 구조
│   ├── script.js       # 동작 로직
│   └── style.css       # 디자인
├── uploads/            # 업로드된 오디오 파일
└── notes/              # 저장된 노트 (JSON)
```

### 역할 분담
- **app.py**: 웹 서버, API 제공, 파일 관리
- **transcribe.py**: AI 음성 인식 담당
- **diarization.py**: "이건 화자1이 말한 거야" 구분
- **static/**: 사용자가 보는 화면

---

# Part 2: 백엔드 서버 구축 (Flask)

## Flask란?
Python으로 웹 서버를 만들 수 있게 해주는 도구입니다. "이 주소로 요청이 오면 이렇게 응답해라"를 정의할 수 있습니다.

## 구현한 API들

| 주소 | 기능 |
|------|------|
| `POST /upload` | 오디오 파일 업로드 |
| `GET /transcribe/{id}` | 변환 진행률 실시간 전송 |
| `GET /api/notes` | 저장된 노트 목록 |
| `POST /api/notes` | 노트 저장 |
| `DELETE /api/notes/{id}` | 노트 삭제 |
| `GET /api/config` | 설정 조회 |
| `POST /api/config` | 설정 변경 |

## 핵심 코드 설명

### 1. 파일 업로드 처리
```python
@app.route('/upload', methods=['POST'])
def upload_file():
    file = request.files['audio']

    # 파일명 중복 처리: 같은 이름 있으면 (1), (2) 붙이기
    filename = get_unique_filename(folder, filename)

    # 파일 저장
    file.save(filepath)

    # 작업 ID 발급 (나중에 진행률 조회용)
    job_id = uuid.uuid4().hex
    return {'job_id': job_id, 'filename': filename}
```

### 2. SSE (Server-Sent Events) - 실시간 진행률
일반적인 API는 "요청 → 응답" 한 번으로 끝나지만, SSE는 서버가 계속 메시지를 보낼 수 있습니다.

```python
@app.route('/transcribe/<job_id>')
def transcribe_job(job_id):
    def generate():
        # 5% 진행
        yield f"data: {json.dumps({'progress': 5, 'message': '모델 로딩 중...'})}\n\n"

        # 실제 변환 수행...

        # 80% 진행
        yield f"data: {json.dumps({'progress': 80, 'message': '화자 분리 중...'})}\n\n"

        # 100% 완료
        yield f"data: {json.dumps({'progress': 100, 'message': '완료!'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')
```

**왜 SSE를 사용했나?**
- 음성 변환은 오래 걸림 (2시간 파일 → 수십 분)
- 사용자에게 "지금 몇 % 진행됐어요"를 계속 알려줘야 함
- 일반 API로는 불가능, SSE로 실시간 전송

### 3. 노트 저장 (JSON 파일)
데이터베이스 없이 간단하게 JSON 파일로 저장했습니다.

```python
# 저장
with open(f'notes/{note_id}.json', 'w') as f:
    json.dump({
        'id': note_id,
        'title': '회의 녹취록',
        'text': '변환된 텍스트...',
        'chunks': [...]  # 타임스탬프별 텍스트
    }, f)

# 불러오기
with open(f'notes/{note_id}.json', 'r') as f:
    note = json.load(f)
```

---

# Part 3: 음성 인식 (Whisper AI)

## Whisper란?
OpenAI가 만든 음성 인식 AI입니다. 음성 파일을 넣으면 텍스트로 변환해줍니다. 무료로 공개되어 있어서 로컬에서 실행할 수 있습니다.

## 모델 크기별 특징

| 모델 | 크기 | 속도 | 정확도 |
|------|------|------|--------|
| Tiny | 75MB | 가장 빠름 | 낮음 |
| Base | 142MB | 빠름 | 보통 |
| Small | 466MB | 보통 | 좋음 |
| Medium | 1.5GB | 느림 | 높음 |
| Large-v3 | 3GB | 매우 느림 | 최고 |

## 구현 코드

### 모델 로드
```python
from transformers import pipeline

def load_whisper_model(model_id, device_mode):
    # GPU 사용 가능하면 GPU, 아니면 CPU
    if device_mode == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"

    # Whisper 파이프라인 생성
    pipe = pipeline(
        "automatic-speech-recognition",
        model=model_id,  # 예: "openai/whisper-large-v3"
        device=device,
    )
    return pipe
```

### 음성 변환
```python
def transcribe_audio(pipe, audio_path):
    result = pipe(
        audio_path,
        return_timestamps=True,  # 타임스탬프도 함께
        generate_kwargs={"language": "korean"}
    )
    return result

# 결과 예시:
# {
#   "text": "안녕하세요. 회의를 시작하겠습니다.",
#   "chunks": [
#     {"text": "안녕하세요.", "timestamp": [0.0, 1.5]},
#     {"text": "회의를 시작하겠습니다.", "timestamp": [1.5, 3.2]}
#   ]
# }
```

### 오디오 포맷 변환
Whisper는 WAV 파일을 선호합니다. m4a, mp3 등은 ffmpeg으로 변환합니다.

```python
def convert_audio_to_wav(audio_path):
    if audio_path.endswith('.wav'):
        return audio_path  # 이미 WAV면 그대로

    # ffmpeg으로 WAV 변환
    wav_path = tempfile.mktemp(suffix='.wav')
    subprocess.run([
        'ffmpeg', '-i', audio_path,
        '-ar', '16000',  # 16kHz 샘플링
        '-ac', '1',      # 모노
        wav_path
    ])
    return wav_path
```

---

# Part 4: 화자 분리 (Speaker Diarization)

## 화자 분리란?
"이 부분은 A가 말한 거고, 저 부분은 B가 말한 거야"를 구분하는 기술입니다.

## pyannote.audio 사용
```python
from pyannote.audio import Pipeline

def perform_diarization(audio_path, hf_token):
    # 화자 분리 모델 로드
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token  # HuggingFace 토큰 필요
    )

    # 분석 수행
    diarization = pipeline(audio_path)

    # 결과 추출
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "start": turn.start,   # 시작 시간
            "end": turn.end,       # 끝 시간
            "speaker": speaker     # "SPEAKER_00", "SPEAKER_01" 등
        })

    return segments
```

## Whisper 결과와 병합
Whisper는 "무슨 말을 했는지", pyannote는 "누가 말했는지"를 알려줍니다. 이 둘을 합쳐야 합니다.

```python
def merge_transcription_with_diarization(chunks, diarization_segments):
    for chunk in chunks:
        chunk_mid = (chunk['timestamp'][0] + chunk['timestamp'][1]) / 2

        # 청크의 중간 시점에 누가 말하고 있었는지 찾기
        for seg in diarization_segments:
            if seg['start'] <= chunk_mid <= seg['end']:
                chunk['speaker'] = seg['speaker']
                break

    return chunks

# 결과:
# {"text": "안녕하세요", "timestamp": [0, 1.5], "speaker": "화자1"}
# {"text": "네, 반갑습니다", "timestamp": [1.5, 3], "speaker": "화자2"}
```

---

# Part 5: 프론트엔드 (HTML/CSS/JavaScript)

## 3단 레이아웃 구조

```
┌─────────────┬───────────────────────┬─────────────────┐
│   왼쪽      │       가운데          │      오른쪽     │
│  사이드바   │      메인 영역        │     사이드바    │
├─────────────┼───────────────────────┼─────────────────┤
│ • 새 노트   │  [노트 제목]          │ 설정:           │
│ • 노트1     │                       │ • 모델 선택     │
│ • 노트2     │  ▶ 오디오 플레이어    │ • GPU/CPU       │
│ • 노트3     │                       │                 │
│             │  [녹취록 내용]        │ LLM 설정:       │
│             │  [0:00] 안녕하세요    │ • API Key       │
│             │  [0:05] 회의 시작...  │ • 템플릿        │
│             │                       │                 │
│             │                       │ [요약 생성]     │
│             │                       │ [요약 결과...]  │
└─────────────┴───────────────────────┴─────────────────┘
```

## 핵심 JavaScript 기능

### 1. 파일 업로드 + 진행률 표시
```javascript
// XHR로 업로드 (진행률 이벤트 받기 위해)
const xhr = new XMLHttpRequest();

xhr.upload.addEventListener('progress', (e) => {
    const percent = (e.loaded / e.total) * 100;
    showProgress(percent, `업로드 중... ${percent}%`);
});

xhr.open('POST', '/upload');
xhr.send(formData);
```

### 2. SSE로 변환 진행률 수신
```javascript
function transcribeWithSSE(jobId) {
    const eventSource = new EventSource(`/transcribe/${jobId}`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        showProgress(data.progress, data.message);

        if (data.stage === 'complete') {
            eventSource.close();
            displayTranscript(data.result.chunks);
        }
    };
}
```

### 3. 오디오 재생 + 텍스트 하이라이트 싱크
```javascript
// 오디오 재생 위치가 바뀔 때마다
audioPlayer.addEventListener('timeupdate', () => {
    const currentTime = audioPlayer.currentTime;

    // 모든 텍스트 줄을 확인
    document.querySelectorAll('.chunk-line').forEach(el => {
        const start = parseFloat(el.dataset.start);
        const end = parseFloat(el.dataset.end);

        // 현재 재생 위치가 이 줄의 시간 범위 안이면 하이라이트
        if (currentTime >= start && currentTime < end) {
            el.classList.add('active');  // 노란색 배경
        } else {
            el.classList.remove('active');
        }
    });
});

// 텍스트 클릭하면 해당 위치로 이동
chunkLine.addEventListener('click', () => {
    audioPlayer.currentTime = chunk.timestamp[0];
    audioPlayer.play();
});
```

### 4. LLM 요약 (OpenAI/Claude API 직접 호출)
```javascript
async function generateSummary() {
    const fullText = chunks.map(c =>
        `[${formatTime(c.timestamp[0])}] ${c.speaker}: ${c.text}`
    ).join('\n');

    // OpenAI API 호출
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-5',
            messages: [
                { role: 'system', content: '회의록 작성 전문가입니다...' },
                { role: 'user', content: fullText }
            ],
            max_completion_tokens: 16000
        })
    });

    const data = await response.json();
    displaySummary(data.choices[0].message.content);
}
```

### 5. 프리셋 저장 (LocalStorage)
```javascript
// 저장
function savePreset() {
    const preset = {
        name: '내 설정',
        model: 'gpt-5',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: '...',
        template: '## 회의 요약\n...'
    };

    const presets = JSON.parse(localStorage.getItem('llm_presets') || '[]');
    presets.push(preset);
    localStorage.setItem('llm_presets', JSON.stringify(presets));
}

// 불러오기
function loadPreset(index) {
    const presets = JSON.parse(localStorage.getItem('llm_presets'));
    const preset = presets[index];
    // UI에 적용...
}
```

---

# Part 6: 해결한 버그들

## 버그 1: "예상 시간 계산 중..."이 안 바뀜

**원인**: WAV 파일만 길이 측정 가능, m4a/mp3는 측정 불가

**해결**: ffprobe 사용 (ffmpeg 설치 시 함께 설치됨)
```python
def get_audio_duration(audio_path):
    result = subprocess.run([
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        audio_path
    ], capture_output=True, text=True)
    return float(result.stdout)  # 예: 3600.5
```

## 버그 2: 요약 버튼 눌러도 반응이 없음

**원인**: OpenAI 콘텐츠 필터가 응답 차단 (`finish_reason: "content_filter"`)

**해결**: finish_reason 확인 후 에러 메시지 표시
```javascript
if (data.choices[0].finish_reason === 'content_filter') {
    throw new Error('콘텐츠 필터에 의해 차단되었습니다. Claude를 사용해 보세요.');
}
```

## 버그 3: 같은 텍스트가 무한 반복됨

**원인**: Whisper의 알려진 버그 (Hallucination)

**해결**:
1. `condition_on_prev_tokens: False` 설정
2. 3번 이상 연속 반복되는 텍스트 필터링
```python
def filter_repeated_text(result):
    if text == prev_text:
        repeat_count += 1
        if repeat_count >= 3:
            continue  # 건너뛰기
```

## 버그 4: 녹취록 클릭하면 엉뚱한 곳 재생

**원인**: WAV 변환 후 타임스탬프와 원본 오디오 싱크 불일치

**해결**: 비율 보정
```python
ratio = original_duration / converted_duration  # 예: 1.0005
timestamp = timestamp * ratio  # 모든 타임스탬프에 적용
```

## 버그 5: max_tokens 에러

**원인**: OpenAI 새 모델은 `max_completion_tokens` 사용

**해결**: 파라미터명 변경
```javascript
// 이전
{ max_tokens: 16000 }

// 수정 후
{ max_completion_tokens: 16000 }
```

---

# Part 7: 사용된 기술 스택

| 분류 | 기술 | 용도 |
|------|------|------|
| 백엔드 | Flask (Python) | 웹 서버, API |
| 음성 인식 | Whisper (transformers) | 음성 → 텍스트 |
| 화자 분리 | pyannote.audio | 누가 말했는지 구분 |
| 오디오 변환 | ffmpeg | m4a → wav 변환 |
| 프론트엔드 | HTML/CSS/JavaScript | 사용자 화면 |
| AI 요약 | OpenAI API, Claude API | 회의록 자동 생성 |
| 데이터 저장 | JSON 파일 | 노트 저장 |
| 설정 저장 | LocalStorage | 프리셋 저장 |

---

# Part 8: 배운 점

1. **AI도 완벽하지 않다**: Whisper 반복 오류, 콘텐츠 필터 등 예상치 못한 문제 발생
2. **파일 변환은 항상 주의**: 오디오 변환 시 길이가 미세하게 달라질 수 있음
3. **실시간 진행률은 SSE**: 긴 작업은 사용자에게 진행 상황을 알려줘야 함
4. **API는 자주 바뀐다**: `max_tokens` → `max_completion_tokens` 같은 변경
5. **에러 핸들링 중요**: 모든 가능한 실패 케이스를 처리해야 사용자 경험이 좋아짐

---

*다음 목표: 화자 분리 정확도 개선, 실시간 스트리밍 녹취 기능*
