const audioInput = document.getElementById('audioInput');
const uploadBtn = document.getElementById('uploadBtn');
const loading = document.getElementById('loading');
const playerSection = document.getElementById('player-section');
const audioPlayer = document.getElementById('audioPlayer');
const transcript = document.getElementById('transcript');

// 우측 사이드바 정보
const infoDate = document.getElementById('infoDate');
const infoDuration = document.getElementById('infoDuration');
const infoFilename = document.getElementById('infoFilename');

// 설정 요소
const modelSelect = document.getElementById('modelSelect');
const deviceSelect = document.getElementById('deviceSelect');
const deviceStatus = document.getElementById('deviceStatus');
const applySettingsBtn = document.getElementById('applySettingsBtn');
const settingsStatus = document.getElementById('settingsStatus');

// LLM 요약 요소
const llmModelSelect = document.getElementById('llmModelSelect');
const llmApiUrl = document.getElementById('llmApiUrl');
const llmApiKey = document.getElementById('llmApiKey');
const summarizeBtn = document.getElementById('summarizeBtn');
const summaryResult = document.getElementById('summaryResult');

// 프리셋 요소
const llmPresetSelect = document.getElementById('llmPresetSelect');
const presetNameInput = document.getElementById('presetNameInput');
const savePresetBtn = document.getElementById('savePresetBtn');
const deletePresetBtn = document.getElementById('deletePresetBtn');

// 요약 템플릿 및 편집 요소
const summaryTemplate = document.getElementById('summaryTemplate');
const editSummaryBtn = document.getElementById('editSummaryBtn');
const copySummaryBtn = document.getElementById('copySummaryBtn');

// 개발 모드: true면 mock 데이터 사용
const DEV_MODE = false;

// 프리셋 저장 키
const PRESETS_KEY = 'llm_presets';

// 기본 프리셋 (API 키 제외)
const DEFAULT_PRESETS = [
    {
        name: 'OpenAI GPT-5',
        model: 'gpt-5',
        customModel: '',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: '',
        template: `## 회의 요약

### 주요 안건
- (내용) [시간]

### 결정 사항
- (내용) [시간]

### 액션 아이템
- [ ] (담당자) (내용) [시간]

### 기타 메모`
    },
    {
        name: 'Anthropic Claude Sonnet 4',
        model: 'claude-sonnet-4',
        customModel: '',
        apiUrl: 'https://api.anthropic.com/v1',
        apiKey: '',
        template: `## 회의 요약

### 주요 안건
- (내용) [시간]

### 결정 사항
- (내용) [시간]

### 액션 아이템
- [ ] (담당자) (내용) [시간]

### 기타 메모`
    }
];

// 콘솔 로그 함수
function log(message, type = 'info') {
    const time = new Date().toLocaleTimeString('ko-KR');
    console.log(`[${time}] [${type}] ${message}`);
}

log('App initialized', 'success');

let chunks = [];
let currentNoteId = null;
let currentFilename = null;

// 타이머 관련
let progressTimer = null;
let startTime = null;
let estimatedTotalTime = null;
let currentProgress = 0;
let currentMessage = '';

// 노트 목록 요소
const noteList = document.getElementById('noteList');
const noteTitle = document.getElementById('noteTitle');
const newNoteBtn = document.getElementById('newNoteBtn');
const deleteNoteBtn = document.getElementById('deletNoteBtn');

// 새 노트 버튼 이벤트
newNoteBtn.addEventListener('click', () => {
    currentNoteId = null;
    currentFilename = null;
    chunks = [];
    noteTitle.textContent = '새 노트';
    infoFilename.textContent = '-';
    infoDate.textContent = '-';
    infoDuration.textContent = '-';
    playerSection.classList.add('hidden');
    transcript.innerHTML = '<p class="placeholder">음성 파일을 업로드하면 텍스트가 여기에 표시됩니다.</p>';
    summaryResult.innerHTML = '<span class="placeholder-text">요약을 생성하려면 위 버튼을 클릭하세요</span>';

    // 활성 표시 제거
    document.querySelectorAll('.note-item').forEach(el => el.classList.remove('active'));

    // 삭제 버튼 숨기기
    deleteNoteBtn.style.display = 'none';

    log('New note created', 'info');
});

// 노트 제목 편집 기능
noteTitle.contentEditable = 'true';
noteTitle.addEventListener('blur', saveNoteTitle);
noteTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        noteTitle.blur();
    }
});

// 노트 제목 저장
async function saveNoteTitle() {
    if (!currentNoteId) return;

    const newTitle = noteTitle.textContent.trim();
    if (!newTitle) {
        noteTitle.textContent = '새 노트';
        return;
    }

    try {
        const response = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: currentNoteId,
                title: newTitle
            })
        });

        const data = await response.json();
        if (data.success) {
            log(`Note title updated: ${newTitle}`, 'success');
            loadNoteList();
        }
    } catch (error) {
        log(`Failed to update title: ${error.message}`, 'error');
    }
}

// 노트 삭제 버튼 이벤트
deleteNoteBtn.addEventListener('click', deleteCurrentNote);

// 현재 노트 삭제
async function deleteCurrentNote() {
    if (!currentNoteId) {
        alert('삭제할 노트가 없습니다.');
        return;
    }

    const title = noteTitle.textContent;
    if (!confirm(`"${title}" 노트를 삭제하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/notes/${currentNoteId}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        if (data.success) {
            log(`Note deleted: ${title}`, 'success');

            // 새 노트 상태로 초기화
            currentNoteId = null;
            currentFilename = null;
            chunks = [];
            noteTitle.textContent = '새 노트';
            infoFilename.textContent = '-';
            infoDate.textContent = '-';
            infoDuration.textContent = '-';
            playerSection.classList.add('hidden');
            transcript.innerHTML = '<p class="placeholder">음성 파일을 업로드하면 텍스트가 여기에 표시됩니다.</p>';
            summaryResult.innerHTML = '<span class="placeholder-text">요약을 생성하려면 위 버튼을 클릭하세요</span>';
            deleteNoteBtn.style.display = 'none';

            // 노트 목록 새로고침
            loadNoteList();
        }
    } catch (error) {
        log(`Failed to delete note: ${error.message}`, 'error');
    }
}

// 초기 상태에서 삭제 버튼 숨기기
deleteNoteBtn.style.display = 'none';

// 페이지 로드 시 설정 및 노트 목록 불러오기
loadConfig();
loadNoteList();

// 설정 적용 버튼 이벤트
applySettingsBtn.addEventListener('click', applySettings);

// 커스텀 모델 입력 요소
const customModelContainer = document.getElementById('customModelContainer');
const customModelInput = document.getElementById('customModelInput');

// LLM 모델 변경 시 기본 URL 설정 및 커스텀 입력 표시
llmModelSelect.addEventListener('change', () => {
    const model = llmModelSelect.value;

    // 커스텀 모델 입력 표시/숨김
    if (model === 'custom') {
        customModelContainer.style.display = 'block';
        customModelInput.focus();
    } else {
        customModelContainer.style.display = 'none';
    }

    // 기본 URL 설정
    if (model.startsWith('gpt') || model === 'custom') {
        llmApiUrl.value = 'https://api.openai.com/v1';
    } else if (model.startsWith('claude')) {
        llmApiUrl.value = 'https://api.anthropic.com/v1';
    }
});

// 실제 사용할 모델명 가져오기
function getSelectedModel() {
    const model = llmModelSelect.value;
    if (model === 'custom') {
        return customModelInput.value.trim() || 'gpt-4o-mini';
    }
    return model;
}

// Claude 모델 ID 매핑
function getClaudeModelId(model) {
    const modelMap = {
        'claude-3-5-sonnet': 'claude-sonnet-4-20250514',
        'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
        'claude-sonnet-4': 'claude-sonnet-4-20250514'
    };
    return modelMap[model] || model;
}

// 요약 생성 버튼 이벤트
summarizeBtn.addEventListener('click', generateSummary);

// 검증 버튼
const verifyBtn = document.getElementById('verifyBtn');
verifyBtn.addEventListener('click', verifySummary);

// 프리셋 이벤트
savePresetBtn.addEventListener('click', savePreset);
deletePresetBtn.addEventListener('click', deletePreset);
llmPresetSelect.addEventListener('change', loadSelectedPreset);

// 요약 편집/복사 이벤트
editSummaryBtn.addEventListener('click', toggleSummaryEdit);
copySummaryBtn.addEventListener('click', copySummary);

// 프리셋 목록 로드
loadPresets();

// LLM 요약 생성
async function generateSummary() {
    if (chunks.length === 0) {
        summaryResult.innerHTML = '<span class="placeholder-text">요약할 텍스트가 없습니다. 먼저 음성을 변환하세요.</span>';
        return;
    }

    const apiUrl = llmApiUrl.value.trim();
    const apiKey = llmApiKey.value.trim();
    const model = getSelectedModel();
    const template = summaryTemplate.value.trim();

    if (!apiUrl || !apiKey) {
        summaryResult.innerHTML = '<span class="placeholder-text">API URL과 API Key를 입력하세요.</span>';
        return;
    }

    if (llmModelSelect.value === 'custom' && !customModelInput.value.trim()) {
        summaryResult.innerHTML = '<span class="placeholder-text">모델명을 입력하세요.</span>';
        return;
    }

    // 타임스탬프와 함께 전체 텍스트 추출
    const fullText = chunks.map(c => {
        const time = formatTime(c.timestamp[0]);
        const speaker = c.speaker ? `${c.speaker}` : '';
        return `[${time}] ${speaker ? speaker + ': ' : ''}${c.text}`;
    }).join('\n');

    // 로딩 UI 표시
    summaryResult.innerHTML = `
        <div class="summary-loading">
            <div class="spinner"></div>
            <span class="loading-text">요약 생성 중</span>
            <span class="loading-dots"></span>
        </div>
    `;
    summaryResult.classList.add('loading');
    summaryResult.contentEditable = 'false';
    summaryResult.classList.remove('editable');
    editSummaryBtn.textContent = '편집';

    // 버튼 비활성화
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = '생성 중...';
    verifyBtn.disabled = true;

    // 시스템 프롬프트 구성
    let systemPrompt = `당신은 공식 사업 회의록을 작성하는 전문가입니다.

## 중요 공지
이 회의록은 공식 문서로 사용되며, 완성 후 사용자가 직접 출처와 녹취록을 교차로 들으며 검증할 것입니다.
**누락된 내용이 있으면 안 됩니다.**

## 필수 규칙
1. 녹취록에 언급된 주요 사항들에 대하여 모두 요약하세요.
2. 모든 내용에 출처 시간을 [MM:SS] 형식으로 표기하세요.
3. 여러 시간대를 종합한 경우 [MM:SS], [MM:SS] 형식으로 모든 시간을 표기하세요.
4. 녹취록이기에 전사가 잘못된 부분이 있을 수 있습니다.
5. 한국어로 작성하세요.`;

    if (template) {
        systemPrompt += `\n\n## 출력 형식\n다음 템플릿에 맞춰 작성하세요:\n\n${template}`;
    }

    const userPrompt = `[공식 회의 녹취록]
${fullText}

---
위 녹취록을 바탕으로 회의록을 작성하세요.
- 모든 내용을 빠짐없이 포함
- 각 항목에 출처 시간 [MM:SS] 표기 필수`;

    try {
        let response;
        let summary;

        log(`Calling LLM API: model=${model}, url=${apiUrl}`, 'info');

        if (model.startsWith('gpt')) {
            // OpenAI API
            log('Using OpenAI API...', 'info');
            response = await fetch(`${apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_completion_tokens: 16000
                })
            });

            log(`OpenAI response status: ${response.status}`, 'info');
            const data = await response.json();
            log(`OpenAI response data: ${JSON.stringify(data).substring(0, 500)}...`, 'info');
            if (data.error) {
                throw new Error(data.error.message);
            }
            // 콘텐츠 필터 확인
            const finishReason = data.choices?.[0]?.finish_reason;
            if (finishReason === 'content_filter') {
                throw new Error('OpenAI 콘텐츠 필터에 의해 차단되었습니다. 다른 모델(Claude 등)을 사용하거나, 민감한 내용이 포함되어 있는지 확인하세요.');
            }
            summary = data.choices[0].message.content;
            if (!summary || summary.trim() === '') {
                throw new Error('API가 빈 응답을 반환했습니다. 다시 시도하거나 다른 모델을 사용해 보세요.');
            }

        } else if (model.startsWith('claude')) {
            // Anthropic API
            log('Using Anthropic API...', 'info');
            response = await fetch(`${apiUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: getClaudeModelId(model),
                    max_tokens: 16000,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userPrompt }
                    ]
                })
            });

            log(`Anthropic response status: ${response.status}`, 'info');
            const data = await response.json();
            log(`Anthropic response data: ${JSON.stringify(data).substring(0, 200)}...`, 'info');
            if (data.error) {
                throw new Error(data.error.message);
            }
            summary = data.content[0].text;

        } else {
            // Custom API (OpenAI 호환 형식 가정)
            log('Using Custom API...', 'info');
            response = await fetch(`${apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_completion_tokens: 16000
                })
            });

            const data = await response.json();
            log(`Custom API response: ${JSON.stringify(data).substring(0, 500)}...`, 'info');
            if (data.error) {
                throw new Error(data.error.message || 'API 오류');
            }
            // 콘텐츠 필터 확인
            const finishReason = data.choices?.[0]?.finish_reason;
            if (finishReason === 'content_filter') {
                throw new Error('콘텐츠 필터에 의해 차단되었습니다. 다른 모델을 사용해 보세요.');
            }
            summary = data.choices[0].message.content;
            if (!summary || summary.trim() === '') {
                throw new Error('API가 빈 응답을 반환했습니다.');
            }
        }

        // 타임스탬프를 클릭 가능한 링크로 변환
        const formattedSummary = formatSummaryWithTimestamps(summary);
        summaryResult.innerHTML = `<div class="summary-text">${formattedSummary}</div>`;

        // 타임스탬프 클릭 이벤트 바인딩
        bindTimestampLinks();

        log('Summary generated', 'success');

    } catch (error) {
        log(`Summary error: ${error.message}`, 'error');
        console.error('Full error:', error);
        summaryResult.innerHTML = `<span class="placeholder-text" style="color: var(--neon-pink);">오류: ${error.message}</span>`;
    } finally {
        summaryResult.classList.remove('loading');
        // 버튼 상태 복원
        summarizeBtn.disabled = false;
        summarizeBtn.textContent = '요약 생성';
        verifyBtn.disabled = false;
        log('Summary generation finished', 'info');
    }
}

// 요약 텍스트에서 타임스탬프를 클릭 가능한 링크로 변환
function formatSummaryWithTimestamps(text) {
    // [MM:SS] 또는 [M:SS] 형식의 타임스탬프를 찾아서 링크로 변환
    const timestampRegex = /\[(\d{1,2}:\d{2})\]/g;

    return text.replace(timestampRegex, (match, time) => {
        const seconds = parseTimeToSeconds(time);
        return `<span class="timestamp-link" data-time="${seconds}">[${time}]</span>`;
    });
}

// MM:SS 형식을 초로 변환
function parseTimeToSeconds(timeStr) {
    const parts = timeStr.split(':');
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return minutes * 60 + seconds;
}

// 타임스탬프 링크에 클릭 이벤트 바인딩
function bindTimestampLinks() {
    document.querySelectorAll('.timestamp-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const time = parseFloat(link.dataset.time);

            // 가장 가까운 청크 찾기
            const closestChunk = findClosestChunk(time);

            if (closestChunk) {
                const chunkTime = parseFloat(closestChunk.dataset.start);

                // 오디오 재생 위치 이동 (청크 시작 시간으로) 및 재생
                audioPlayer.currentTime = chunkTime;
                audioPlayer.play();

                // 해당 청크 하이라이트
                highlightChunk(closestChunk);

                // 녹취록으로 스크롤
                closestChunk.scrollIntoView({ behavior: 'smooth', block: 'center' });

                log(`Jump to ${formatTime(chunkTime)} (requested: ${formatTime(time)})`, 'info');
            } else {
                // 청크를 못 찾으면 그냥 해당 시간으로 이동
                audioPlayer.currentTime = time;
                audioPlayer.play();
                log(`Jump to ${formatTime(time)} (no chunk found)`, 'info');
            }
        });
    });
}

// 특정 시간에 가장 가까운 청크 찾기
function findClosestChunk(time) {
    const chunkLines = document.querySelectorAll('.chunk-line');
    let closestChunk = null;
    let minDiff = Infinity;

    chunkLines.forEach(el => {
        const start = parseFloat(el.dataset.start);
        const diff = Math.abs(start - time);

        // 시작 시간이 가장 가까운 청크 찾기
        if (diff < minDiff) {
            minDiff = diff;
            closestChunk = el;
        }
    });

    return closestChunk;
}

// 특정 청크 하이라이트
function highlightChunk(targetChunk) {
    document.querySelectorAll('.chunk-line').forEach(el => {
        el.classList.remove('active');
    });
    if (targetChunk) {
        targetChunk.classList.add('active');
    }
}

// 특정 시간의 청크 하이라이트 (오디오 재생 중 사용)
function highlightChunkAtTime(time) {
    document.querySelectorAll('.chunk-line').forEach(el => {
        const start = parseFloat(el.dataset.start);
        const end = parseFloat(el.dataset.end);

        if (time >= start && time < end) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

// 요약 편집 토글
function toggleSummaryEdit() {
    const isEditable = summaryResult.contentEditable === 'true';

    if (isEditable) {
        // 편집 모드 종료
        summaryResult.contentEditable = 'false';
        summaryResult.classList.remove('editable');
        editSummaryBtn.textContent = '편집';

        // 타임스탬프 링크 다시 바인딩
        bindTimestampLinks();

        log('Summary edit mode disabled', 'info');
    } else {
        // 편집 모드 시작
        summaryResult.contentEditable = 'true';
        summaryResult.classList.add('editable');
        summaryResult.focus();
        editSummaryBtn.textContent = '완료';

        log('Summary edit mode enabled', 'info');
    }
}

// 요약 복사
async function copySummary() {
    const summaryText = summaryResult.innerText;

    if (!summaryText || summaryText.includes('요약을 생성하려면')) {
        alert('복사할 요약이 없습니다.');
        return;
    }

    try {
        await navigator.clipboard.writeText(summaryText);
        copySummaryBtn.textContent = '복사됨!';
        setTimeout(() => {
            copySummaryBtn.textContent = '복사';
        }, 2000);
        log('Summary copied to clipboard', 'success');
    } catch (error) {
        log(`Copy failed: ${error.message}`, 'error');
        alert('복사에 실패했습니다.');
    }
}

// 요약 검증
async function verifySummary() {
    const currentSummary = summaryResult.innerText;

    if (!currentSummary || currentSummary.includes('요약을 생성하려면')) {
        alert('검증할 요약이 없습니다. 먼저 요약을 생성하세요.');
        return;
    }

    if (chunks.length === 0) {
        alert('녹취록이 없습니다.');
        return;
    }

    const apiUrl = llmApiUrl.value.trim();
    const apiKey = llmApiKey.value.trim();
    const model = getSelectedModel();

    if (!apiUrl || !apiKey) {
        alert('API URL과 API Key를 입력하세요.');
        return;
    }

    if (llmModelSelect.value === 'custom' && !customModelInput.value.trim()) {
        alert('모델명을 입력하세요.');
        return;
    }

    // 원본 녹취록
    const fullText = chunks.map(c => {
        const time = formatTime(c.timestamp[0]);
        const speaker = c.speaker ? `${c.speaker}` : '';
        return `[${time}] ${speaker ? speaker + ': ' : ''}${c.text}`;
    }).join('\n');

    // 로딩 UI 표시
    summaryResult.innerHTML = `
        <div class="summary-loading">
            <div class="spinner"></div>
            <span class="loading-text">검증 중</span>
            <span class="loading-dots"></span>
        </div>
    `;
    summaryResult.classList.add('loading');

    // 버튼 비활성화
    verifyBtn.disabled = true;
    verifyBtn.textContent = '검증 중...';
    summarizeBtn.disabled = true;

    const systemPrompt = `당신은 회의록 검증 전문가입니다.

## 역할
원본 녹취록과 작성된 요약본을 비교하여 누락된 내용을 찾아내세요.

## 검증 기준
1. 녹취록에 있지만 요약에 없는 내용
2. 요약에서 잘못 해석되거나 왜곡된 내용
3. 시간 표기가 누락되거나 잘못된 항목

## 출력 형식
### 검증 결과

**누락된 내용:**
- (내용) [MM:SS] - 누락됨

**수정 필요:**
- (내용) [MM:SS] - (수정 사항)

**검증 완료:**
누락 없음 / X건의 누락 발견

---
누락이 없으면 "누락 없음. 요약이 정확합니다."라고 표시하세요.`;

    const userPrompt = `[원본 녹취록]
${fullText}

---

[작성된 요약본]
${currentSummary}

---
위 녹취록과 요약본을 비교하여 누락되거나 잘못된 내용이 있는지 검증하세요.`;

    try {
        let response;
        let result;

        if (model.startsWith('gpt')) {
            response = await fetch(`${apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_completion_tokens: 16000
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            result = data.choices[0].message.content;

        } else if (model.startsWith('claude')) {
            response = await fetch(`${apiUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: getClaudeModelId(model),
                    max_tokens: 16000,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }]
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            result = data.content[0].text;

        } else {
            response = await fetch(`${apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_completion_tokens: 16000
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message || 'API 오류');
            result = data.choices[0].message.content;
        }

        const formattedResult = formatSummaryWithTimestamps(result);
        summaryResult.innerHTML = `<div class="summary-text verification-result">${formattedResult}</div>`;
        bindTimestampLinks();

        log('Verification completed', 'success');

    } catch (error) {
        log(`Verification error: ${error.message}`, 'error');
        summaryResult.innerHTML = `<span class="placeholder-text" style="color: var(--neon-pink);">검증 오류: ${error.message}</span>`;
    } finally {
        summaryResult.classList.remove('loading');
        // 버튼 상태 복원
        verifyBtn.disabled = false;
        verifyBtn.textContent = '검증';
        summarizeBtn.disabled = false;
    }
}

// 프리셋 관리 함수들
function getPresets() {
    const presetsJson = localStorage.getItem(PRESETS_KEY);
    if (presetsJson) {
        return JSON.parse(presetsJson);
    }
    // 프리셋이 없으면 기본 프리셋 저장 후 반환
    savePresetsToStorage(DEFAULT_PRESETS);
    return DEFAULT_PRESETS;
}

function savePresetsToStorage(presets) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function loadPresets(selectName = null) {
    const presets = getPresets();
    llmPresetSelect.innerHTML = '<option value="">선택하세요...</option>';

    presets.forEach((preset, index) => {
        const option = document.createElement('option');
        option.value = index.toString();
        option.textContent = preset.name;
        if (selectName && preset.name === selectName) {
            option.selected = true;
        }
        llmPresetSelect.appendChild(option);
    });

    log(`Loaded ${presets.length} presets`, 'info');
}

function savePreset() {
    const name = presetNameInput.value.trim();
    if (!name) {
        alert('프리셋 이름을 입력하세요.');
        return;
    }

    const preset = {
        name: name,
        model: llmModelSelect.value,
        customModel: customModelInput.value,
        apiUrl: llmApiUrl.value,
        apiKey: llmApiKey.value,
        template: summaryTemplate.value
    };

    const presets = getPresets();

    // 같은 이름의 프리셋이 있으면 덮어쓰기
    const existingIndex = presets.findIndex(p => p.name === name);
    if (existingIndex >= 0) {
        if (!confirm(`"${name}" 프리셋이 이미 존재합니다. 덮어쓰시겠습니까?`)) {
            return;
        }
        presets[existingIndex] = preset;
    } else {
        presets.push(preset);
    }

    savePresetsToStorage(presets);
    loadPresets(name);  // 저장한 프리셋 자동 선택
    presetNameInput.value = '';

    log(`Preset saved: ${name}`, 'success');
}

function deletePreset() {
    const selectedIndex = llmPresetSelect.value;
    if (selectedIndex === '' || selectedIndex === null) {
        alert('삭제할 프리셋을 선택하세요.');
        return;
    }

    const presets = getPresets();
    const presetName = presets[parseInt(selectedIndex)].name;

    if (!confirm(`"${presetName}" 프리셋을 삭제하시겠습니까?`)) {
        return;
    }

    presets.splice(parseInt(selectedIndex), 1);
    savePresetsToStorage(presets);
    loadPresets();

    log(`Preset deleted: ${presetName}`, 'info');
}

function loadSelectedPreset() {
    const selectedIndex = llmPresetSelect.value;
    if (selectedIndex === '' || selectedIndex === null) return;

    const presets = getPresets();
    const index = parseInt(selectedIndex, 10);
    const preset = presets[index];

    if (preset) {
        llmModelSelect.value = preset.model;
        llmApiUrl.value = preset.apiUrl || '';
        llmApiKey.value = preset.apiKey || '';
        summaryTemplate.value = preset.template || '';

        // 커스텀 모델 처리
        if (preset.model === 'custom') {
            customModelContainer.style.display = 'block';
            customModelInput.value = preset.customModel || '';
        } else {
            customModelContainer.style.display = 'none';
            customModelInput.value = '';
        }

        // 모델에 따라 기본 URL 설정 (사용자가 비워둔 경우)
        if (!preset.apiUrl) {
            if (preset.model.startsWith('gpt') || preset.model === 'custom') {
                llmApiUrl.value = 'https://api.openai.com/v1';
            } else if (preset.model.startsWith('claude')) {
                llmApiUrl.value = 'https://api.anthropic.com/v1';
            }
        }

        log(`Preset loaded: ${preset.name}`, 'success');
    }
}

// 노트 목록 불러오기
async function loadNoteList() {
    try {
        const response = await fetch('/api/notes');
        const data = await response.json();

        if (data.success) {
            renderNoteList(data.notes);
            log(`Loaded ${data.notes.length} notes`, 'success');
        }
    } catch (error) {
        log(`Failed to load notes: ${error.message}`, 'error');
    }
}

// 노트 목록 렌더링
function renderNoteList(notes) {
    noteList.innerHTML = '';

    if (notes.length === 0) {
        noteList.innerHTML = '<li class="note-empty">저장된 노트가 없습니다</li>';
        return;
    }

    notes.forEach(note => {
        const li = document.createElement('li');
        li.className = 'note-item';
        if (note.id === currentNoteId) {
            li.classList.add('active');
        }
        li.dataset.noteId = note.id;

        const date = note.created_at ? note.created_at.split(' ')[0] : '';

        li.innerHTML = `
            <span class="note-title">${note.title}</span>
            <span class="note-date">${date}</span>
        `;

        li.addEventListener('click', () => loadNote(note.id));

        noteList.appendChild(li);
    });
}

// 노트 로드
async function loadNote(noteId) {
    try {
        const response = await fetch(`/api/notes/${noteId}`);
        const data = await response.json();

        if (data.success) {
            const note = data.note;
            currentNoteId = note.id;
            currentFilename = note.audio_filename;
            chunks = note.chunks || [];

            // UI 업데이트
            noteTitle.textContent = note.title;
            infoFilename.textContent = note.audio_filename || '-';
            infoDate.textContent = note.created_at ? note.created_at.split(' ')[0] : '-';
            infoDuration.textContent = note.duration ? formatTime(note.duration) : '-';

            // 오디오 플레이어
            if (note.audio_filename) {
                audioPlayer.src = `/uploads/${note.audio_filename}`;
                playerSection.classList.remove('hidden');
            }

            // 트랜스크립트 표시
            displayTranscript(chunks);

            // 목록에서 활성 표시
            document.querySelectorAll('.note-item').forEach(el => {
                el.classList.toggle('active', el.dataset.noteId === noteId);
            });

            // 삭제 버튼 표시
            deleteNoteBtn.style.display = 'flex';

            // 요약 초기화
            summaryResult.innerHTML = '<span class="placeholder-text">요약을 생성하려면 위 버튼을 클릭하세요</span>';

            log(`Loaded note: ${note.title}`, 'success');
        }
    } catch (error) {
        log(`Failed to load note: ${error.message}`, 'error');
    }
}

// 노트 저장
async function saveNote(title, audioFilename, text, chunks, duration) {
    try {
        const noteData = {
            id: currentNoteId || undefined,
            title: title || audioFilename || '새 노트',
            audio_filename: audioFilename,
            duration: duration,
            text: text,
            chunks: chunks
        };

        const response = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(noteData)
        });

        const data = await response.json();

        if (data.success) {
            currentNoteId = data.note.id;
            log(`Note saved: ${data.note.title}`, 'success');

            // 노트 목록 새로고침
            loadNoteList();

            return data.note;
        }
    } catch (error) {
        log(`Failed to save note: ${error.message}`, 'error');
    }
    return null;
}

// 설정 불러오기
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();

        if (data.success) {
            log('Config loaded', 'success');

            // 모델 선택 옵션 업데이트
            modelSelect.innerHTML = '';
            data.available_models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.name;
                if (model.id === data.config.model_id) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });

            // 장치 선택
            deviceSelect.value = data.config.device_mode;

            // CUDA 상태 표시
            if (data.cuda_available) {
                deviceStatus.textContent = 'GPU 사용 가능';
                deviceStatus.className = 'device-status available';
            } else {
                deviceStatus.textContent = 'GPU 없음';
                deviceStatus.className = 'device-status unavailable';
                // GPU 옵션 비활성화
                const cudaOption = deviceSelect.querySelector('option[value="cuda"]');
                if (cudaOption) {
                    cudaOption.disabled = true;
                }
            }
        }
    } catch (error) {
        log(`Failed to load config: ${error.message}`, 'error');
    }
}

// 설정 적용
async function applySettings() {
    const config = {
        model_id: modelSelect.value,
        device_mode: deviceSelect.value,
    };

    showSettingsStatus('설정 저장 중...', 'info');
    applySettingsBtn.disabled = true;

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        log('Config saved', 'success');
        showSettingsStatus('설정 저장 완료! (다음 변환 시 적용)', 'success');

        setTimeout(() => {
            hideSettingsStatus();
        }, 3000);

    } catch (error) {
        log(`Settings error: ${error.message}`, 'error');
        showSettingsStatus(`오류: ${error.message}`, 'error');
    } finally {
        applySettingsBtn.disabled = false;
    }
}

function showSettingsStatus(message, type) {
    settingsStatus.textContent = message;
    settingsStatus.className = `settings-status ${type}`;
    settingsStatus.classList.remove('hidden');
}

function hideSettingsStatus() {
    settingsStatus.classList.add('hidden');
}

// 업로드 버튼 클릭 시 파일 선택 창 열기
uploadBtn.addEventListener('click', () => {
    audioInput.click();
});

// 파일 선택 시 자동 처리
audioInput.addEventListener('change', async () => {
    const file = audioInput.files[0];
    if (!file) return;

    log(`File selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, 'info');

    // 파일 정보 업데이트
    infoFilename.textContent = file.name;
    infoDate.textContent = new Date().toLocaleDateString('ko-KR');

    // 타이머 초기화
    startTime = Date.now();
    estimatedTotalTime = null;
    currentProgress = 0;

    // 진행률 UI 표시
    showProgress(0, '업로드 준비 중...');
    transcript.innerHTML = '';

    try {
        let data;

        if (DEV_MODE) {
            log('DEV_MODE: Using mock data', 'warning');
            await simulateMockProgress();
            data = getMockData();
            audioPlayer.src = URL.createObjectURL(file);
            stopProgressTimer();
        } else {
            // 1단계: 파일 업로드
            log('Starting file upload...', 'info');
            const uploadResult = await uploadWithProgress(file);

            if (!uploadResult.success) {
                log(`Upload failed: ${uploadResult.error}`, 'error');
                throw new Error(uploadResult.error);
            }

            log(`Upload complete. Job ID: ${uploadResult.job_id}`, 'success');

            // 2단계: SSE로 변환 진행률 수신
            log('Starting transcription via SSE...', 'info');
            data = await transcribeWithSSE(uploadResult.job_id, uploadResult.filename);
        }

        if (data.success) {
            log(`Transcription complete! ${data.chunks?.length || 0} chunks found`, 'success');
            playerSection.classList.remove('hidden');
            chunks = data.chunks || [];
            currentFilename = data.filename;
            currentNoteId = null;  // 새 노트

            displayTranscript(chunks);

            // 제목 업데이트
            const title = data.filename.replace(/\.[^/.]+$/, '');
            noteTitle.textContent = title;

            audioPlayer.addEventListener('loadedmetadata', () => {
                const duration = audioPlayer.duration;
                infoDuration.textContent = formatTime(duration);

                // 자동 저장
                saveNote(title, data.filename, data.text, chunks, duration);
            }, { once: true });
        } else {
            log(`Error: ${data.error}`, 'error');
            transcript.innerHTML = '<p class="placeholder">오류: ' + data.error + '</p>';
        }
    } catch (error) {
        log(`Exception: ${error.message}`, 'error');
        stopProgressTimer();
        hideProgress();
        transcript.innerHTML = '<p class="placeholder">오류: ' + error.message + '</p>';
    }
});

function startProgressTimer() {
    stopProgressTimer();
    progressTimer = setInterval(() => {
        updateTimeBasedProgress();
    }, 500);
}

function stopProgressTimer() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
}

function updateTimeBasedProgress() {
    if (!startTime || !estimatedTotalTime) return;

    const elapsed = (Date.now() - startTime) / 1000;
    // 시간 기반 진행률 계산 (30% ~ 95% 범위)
    const timeProgress = Math.min(elapsed / estimatedTotalTime, 1);
    const mappedProgress = 30 + (timeProgress * 65); // 30% ~ 95%

    if (mappedProgress > currentProgress && mappedProgress < 95) {
        currentProgress = mappedProgress;
        showProgress(currentProgress, currentMessage);
    }
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
        return `${mins}분 ${secs}초`;
    }
    return `${secs}초`;
}

function uploadWithProgress(file) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('audio', file);

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                currentProgress = percent * 0.3;
                showProgress(currentProgress, `파일 업로드 중... ${percent}%`);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                try {
                    const err = JSON.parse(xhr.responseText);
                    resolve(err);
                } catch {
                    reject(new Error('서버 오류'));
                }
            }
        });

        xhr.addEventListener('error', () => reject(new Error('네트워크 오류')));
        xhr.open('POST', '/upload');
        xhr.send(formData);
    });
}

function transcribeWithSSE(jobId, filename) {
    return new Promise((resolve, reject) => {
        log(`SSE connecting to /transcribe/${jobId}`, 'info');
        const eventSource = new EventSource(`/transcribe/${jobId}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            log(`SSE [${data.stage}] progress=${data.progress}% msg="${data.message}" duration=${data.duration}`, 'info');

            // 오디오 길이로 예상 시간 계산 (CPU: 오디오 길이의 약 1~2배)
            if (data.duration && data.duration > 0 && !estimatedTotalTime) {
                estimatedTotalTime = data.duration * 1.5;
                log(`Audio duration: ${data.duration.toFixed(1)}s, estimated time: ${estimatedTotalTime.toFixed(1)}s`, 'info');
                startTime = Date.now(); // 변환 시작 시간 리셋
                startProgressTimer(); // 시간 기반 진행률 타이머 시작
            }

            // duration 없을 때 fallback (processing 단계에서)
            if (data.stage === 'processing' && !estimatedTotalTime) {
                estimatedTotalTime = 60;  // 기본 1분
                startTime = Date.now();
                startProgressTimer();
                log('Using fallback estimated time: 60s', 'warning');
            }

            currentMessage = data.message;

            // 서버에서 보내는 진행률이 현재보다 높으면 업데이트
            const serverProgress = 30 + (data.progress * 0.7);
            if (serverProgress > currentProgress) {
                currentProgress = serverProgress;
            }
            showProgress(currentProgress, currentMessage);

            if (data.stage === 'complete') {
                log('SSE complete - closing connection', 'success');
                eventSource.close();
                stopProgressTimer();
                currentProgress = 100;
                showProgress(100, '변환 완료!');
                setTimeout(() => {
                    hideProgress();
                    audioPlayer.src = `/uploads/${filename}`;
                    resolve({
                        success: true,
                        filename: filename,
                        text: data.result.text,
                        chunks: data.result.chunks
                    });
                }, 500);
            } else if (data.stage === 'error') {
                log(`SSE error: ${data.message}`, 'error');
                eventSource.close();
                stopProgressTimer();
                hideProgress();
                reject(new Error(data.message));
            }
        };

        eventSource.onerror = (e) => {
            log(`SSE connection error`, 'error');
            eventSource.close();
            stopProgressTimer();
            hideProgress();
            reject(new Error('연결 오류'));
        };
    });
}

function showProgress(percent, message) {
    loading.classList.remove('hidden');
    const displayPercent = Math.min(Math.round(percent), 100);

    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    let remainingText = '';

    if (estimatedTotalTime && estimatedTotalTime > 0) {
        const remaining = Math.max(0, Math.ceil(estimatedTotalTime - elapsed));
        remainingText = remaining > 0 ? formatDuration(remaining) : '거의 완료...';
    } else {
        remainingText = '측정 중...';
    }

    loading.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${displayPercent}%"></div>
            </div>
            <div class="progress-info">
                <span class="progress-text">${message}</span>
                <span class="progress-percent">${displayPercent}%</span>
            </div>
            <div class="progress-time">
                <span class="time-label">경과: <span id="elapsed-time">${formatDuration(elapsed)}</span></span>
                <span class="time-label">남은 시간: <span id="remaining-time">${remainingText}</span></span>
            </div>
        </div>
    `;
}

function hideProgress() {
    loading.classList.add('hidden');
    stopProgressTimer();
}

async function simulateMockProgress() {
    startProgressTimer();
    for (let i = 0; i <= 30; i += 5) {
        currentProgress = i;
        showProgress(i, `파일 업로드 중... ${Math.round(i / 0.3)}%`);
        await new Promise(r => setTimeout(r, 100));
    }
    estimatedTotalTime = 10;
    currentMessage = '음성 인식 중...';
    for (let i = 30; i <= 100; i += 5) {
        currentProgress = i;
        showProgress(i, '음성 인식 중...');
        await new Promise(r => setTimeout(r, 200));
    }
    stopProgressTimer();
}

function getMockData() {
    return {
        success: true,
        filename: 'test.mp3',
        text: '안녕하세요. 오늘 회의를 시작하겠습니다.',
        chunks: [
            { text: '안녕하세요.', timestamp: [0.0, 1.5] },
            { text: '오늘 회의를 시작하겠습니다.', timestamp: [1.5, 3.5] },
        ]
    };
}

function displayTranscript(chunks) {
    transcript.innerHTML = '';

    if (chunks.length === 0) {
        transcript.innerHTML = '<p class="placeholder">텍스트를 인식하지 못했습니다.</p>';
        return;
    }

    // 화자 분리 여부 확인
    const hasSpeakers = chunks.some(chunk => chunk.speaker !== undefined);

    if (hasSpeakers) {
        // 화자별로 그룹화하여 표시
        let currentSpeaker = null;
        let currentBlock = null;

        chunks.forEach((chunk, index) => {
            const speaker = chunk.speaker || '화자';

            // 화자가 변경되면 새 블록 생성
            if (speaker !== currentSpeaker) {
                currentSpeaker = speaker;
                currentBlock = document.createElement('div');
                currentBlock.className = `speaker-block speaker-${getSpeakerIndex(speaker)}`;

                const label = document.createElement('span');
                label.className = 'speaker-label';
                label.textContent = speaker;
                currentBlock.appendChild(label);

                const content = document.createElement('div');
                content.className = 'speaker-content';
                currentBlock.appendChild(content);

                transcript.appendChild(currentBlock);
            }

            // 각 청크를 줄바꿈으로 표시
            const line = document.createElement('div');
            line.className = 'chunk-line';
            line.dataset.index = index;
            line.dataset.start = chunk.timestamp[0];
            line.dataset.end = chunk.timestamp[1];

            line.innerHTML = `<span class="timestamp">[${formatTime(chunk.timestamp[0])}]</span> <span class="chunk-text">${chunk.text}</span>`;

            line.addEventListener('click', () => {
                audioPlayer.currentTime = chunk.timestamp[0];
                audioPlayer.play();
            });

            currentBlock.querySelector('.speaker-content').appendChild(line);
        });
    } else {
        // 화자 분리 없음 - 줄바꿈으로 표시
        chunks.forEach((chunk, index) => {
            const line = document.createElement('div');
            line.className = 'chunk-line';
            line.dataset.index = index;
            line.dataset.start = chunk.timestamp[0];
            line.dataset.end = chunk.timestamp[1];

            line.innerHTML = `<span class="timestamp">[${formatTime(chunk.timestamp[0])}]</span> <span class="chunk-text">${chunk.text}</span>`;

            line.addEventListener('click', () => {
                audioPlayer.currentTime = chunk.timestamp[0];
                audioPlayer.play();
            });

            transcript.appendChild(line);
        });
    }
}

// 화자 인덱스 추출 (색상 구분용)
function getSpeakerIndex(speaker) {
    const match = speaker.match(/\d+/);
    return match ? (parseInt(match[0]) % 2) : 0;
}

function formatTime(seconds) {
    if (seconds === null || isNaN(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 오디오 재생 중 현재 위치에 해당하는 텍스트 하이라이트
audioPlayer.addEventListener('timeupdate', () => {
    const currentTime = audioPlayer.currentTime;

    document.querySelectorAll('.chunk-line').forEach(el => {
        const start = parseFloat(el.dataset.start);
        const end = parseFloat(el.dataset.end);

        if (currentTime >= start && currentTime < end) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
});
