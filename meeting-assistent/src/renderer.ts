import './index.css';
import { MeetingRecorder } from './recorder';

// DOM
const titlebar          = document.querySelector('.titlebar') as HTMLElement;
const assistantSelBtn   = document.getElementById('assistant-sel-btn') as HTMLButtonElement;
const assistantSelList  = document.getElementById('assistant-sel-list') as HTMLDivElement;
const micSelBtn         = document.getElementById('mic-sel-btn') as HTMLButtonElement;
const micSelList        = document.getElementById('mic-sel-list') as HTMLDivElement;
const content         = document.getElementById('content') as HTMLDivElement;
const btnMinimize     = document.getElementById('btn-minimize') as HTMLButtonElement;
const btnClose        = document.getElementById('btn-close') as HTMLButtonElement;
const btnSize         = document.getElementById('btn-size') as HTMLButtonElement;
const btnRecord       = document.getElementById('btn-record') as HTMLButtonElement;
const btnStop         = document.getElementById('btn-stop') as HTMLButtonElement;
const btnPause        = document.getElementById('btn-pause') as HTMLButtonElement;
const btnGotIt        = document.getElementById('btn-got-it') as HTMLButtonElement;
const btnSnap         = document.getElementById('btn-snap') as HTMLButtonElement;
const btnDetectStart  = document.getElementById('btn-detect-start') as HTMLButtonElement;
const btnDetectStop   = document.getElementById('btn-detect-stop') as HTMLButtonElement;
const btnRepeatMode   = document.getElementById('btn-repeat-mode') as HTMLButtonElement;
const statusEl        = document.getElementById('status') as HTMLElement;
const timerEl         = document.getElementById('timer') as HTMLElement;
const transcriptEl    = document.getElementById('transcript') as HTMLElement;
const suggestionCard  = document.getElementById('suggestion-card') as HTMLElement;
const answerEl        = document.getElementById('suggestion') as HTMLElement;
const cardBadge       = document.getElementById('card-badge') as HTMLElement;
const questionRow     = document.getElementById('question-row') as HTMLElement;
const questionText    = document.getElementById('question-text') as HTMLElement;
const cardFooter      = document.getElementById('card-footer') as HTMLElement;

let recorder: MeetingRecorder | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let elapsedSeconds = 0;
let isExpanded = false;
let rawAnswerBuffer = ''; // accumulates full LLM response for correct markdown rendering

// Transcript state
interface Turn { speaker: string; text: string; }
let turns: Turn[] = [];
let interimTurn: Turn | null = null;

// Render markdown to HTML (operates on full buffered text, not individual chunks)
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/#{1,6}\s+(.+)/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n/g, '<br>');
}

function setStatus(msg: string): void { statusEl.textContent = msg; }

// detecting=true  → Ready button is the "current state" indicator, Stop is clickable
// detecting=false → Stop button is the "current state" indicator, Ready is clickable
function setDetectionState(detecting: boolean): void {
  btnDetectStart.disabled = detecting;
  btnDetectStop.disabled  = !detecting;
  btnDetectStart.classList.toggle('is-active-state', detecting);
  btnDetectStart.classList.remove('is-stop-state');
  btnDetectStop.classList.toggle('is-stop-state', !detecting);
  btnDetectStop.classList.remove('is-active-state');
}

// Initial state: detection is on (matches ipc.ts default)
setDetectionState(true);

btnDetectStart.addEventListener('click', async () => {
  await window.electronAPI.startDetection();
  setDetectionState(true);
});

btnDetectStop.addEventListener('click', async () => {
  await window.electronAPI.stopDetection();
  setDetectionState(false);
});

let isRepeatMode = false;

btnRepeatMode.addEventListener('click', async () => {
  isRepeatMode = !isRepeatMode;
  await window.electronAPI.setListeningMode(isRepeatMode ? 'self' : 'interviewer');
  btnRepeatMode.classList.toggle('is-repeat-state', isRepeatMode);
  setStatus(isRepeatMode ? 'Repeat mode — speak the question into your mic' : 'Ready');
});

function speakerLabel(s: string): string { return s === 'A' ? 'You' : 'Interviewer'; }

function renderTranscript(): void {
  if (turns.length === 0 && !interimTurn) {
    transcriptEl.innerHTML = '<span class="placeholder">Transcript will appear here during recording...</span>';
    return;
  }
  const html = turns.map((t) => `
    <div class="turn speaker-${t.speaker.toLowerCase()}">
      <span class="turn-label">${speakerLabel(t.speaker)}</span>
      <span class="turn-text">${t.text}</span>
    </div>`).join('');
  const interim = interimTurn ? `
    <div class="turn speaker-${interimTurn.speaker.toLowerCase()} interim">
      <span class="turn-label">${speakerLabel(interimTurn.speaker)}</span>
      <span class="turn-text">${interimTurn.text}</span>
    </div>` : '';
  transcriptEl.innerHTML = html + interim;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ── Custom dropdowns (native <select> broken by focusable:false) ──
let selectedMicId = '';
let selectedAssistantId = '';

function makeCustomSel(
  btn: HTMLButtonElement,
  list: HTMLDivElement,
  items: { value: string; label: string }[],
  currentValue: string,
  onSelect: (value: string) => void,
): void {
  list.innerHTML = '';
  items.forEach(({ value, label }) => {
    const opt = document.createElement('button');
    opt.className = 'custom-sel-opt' + (value === currentValue ? ' selected' : '');
    opt.textContent = label;
    opt.addEventListener('click', () => {
      onSelect(value);
      btn.textContent = label;
      list.hidden = true;
      list.querySelectorAll('.custom-sel-opt').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
    list.appendChild(opt);
  });
  btn.textContent = items.find((i) => i.value === currentValue)?.label ?? btn.textContent;
}

function toggleList(list: HTMLDivElement, otherList: HTMLDivElement): void {
  otherList.hidden = true;
  list.hidden = !list.hidden;
}

assistantSelBtn.addEventListener('click', () => toggleList(assistantSelList, micSelList));
micSelBtn.addEventListener('click',       () => toggleList(micSelList, assistantSelList));

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.custom-sel')) {
    assistantSelList.hidden = true;
    micSelList.hidden = true;
  }
});

async function loadAssistants(): Promise<void> {
  try {
    const [list, active] = await Promise.all([
      window.electronAPI.getAssistants(),
      window.electronAPI.getActiveAssistant(),
    ]);
    selectedAssistantId = active;
    makeCustomSel(
      assistantSelBtn, assistantSelList,
      list.map(({ id, name }) => ({ value: id, label: name })),
      active,
      (id) => { selectedAssistantId = id; window.electronAPI.setAssistant(id); },
    );
  } catch (err) { console.error('loadAssistants failed:', err); }
}

async function loadMicDevices(): Promise<void> {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    tmp.getTracks().forEach((t) => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    if (mics.length) selectedMicId = mics[0].value;
    makeCustomSel(
      micSelBtn, micSelList,
      mics,
      selectedMicId,
      (id) => { selectedMicId = id; },
    );
  } catch (err) { console.warn('loadMicDevices failed:', err); }
}

loadAssistants();
loadMicDevices();


// ── JS drag (replaces -webkit-app-region: drag, broken by focusable:false) ──
let dragging = false;
let dragStartScreenX = 0, dragStartScreenY = 0;
let winStartX = 0, winStartY = 0;

titlebar.addEventListener('mousedown', (e) => {
  // Don't start drag if clicking a button inside the titlebar
  if ((e.target as HTMLElement).closest('button')) return;
  dragging = true;
  dragStartScreenX = e.screenX;
  dragStartScreenY = e.screenY;
  winStartX = window.screenX;
  winStartY = window.screenY;
  titlebar.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  window.electronAPI.setWindowPosition(
    winStartX + (e.screenX - dragStartScreenX),
    winStartY + (e.screenY - dragStartScreenY),
  );
});

document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  titlebar.classList.remove('dragging');
});

// Window controls
btnMinimize.addEventListener('click', () => {
  const collapsed = content.classList.toggle('collapsed');
  btnMinimize.textContent = collapsed ? '+' : '−';
});
btnClose.addEventListener('click', () => window.close());

// Size toggle — compact (400×580) ↔ large (520×720)
btnSize.addEventListener('click', () => {
  isExpanded = !isExpanded;
  window.resizeTo(isExpanded ? 520 : 400, isExpanded ? 720 : 580);
  btnSize.textContent = isExpanded ? '⤡' : '⤢';
});

// Suggestion events
window.electronAPI.onSuggestionStart((data) => {
  rawAnswerBuffer = '';
  answerEl.innerHTML = '';
  answerEl.classList.remove('has-text');
  cardBadge.textContent = 'Thinking...';
  cardBadge.className = 'card-badge thinking';
  suggestionCard.classList.add('active');
  questionText.textContent = data.question;
  questionRow.removeAttribute('hidden');
  cardFooter.setAttribute('hidden', '');
});

window.electronAPI.onSuggestionChunk((text) => {
  rawAnswerBuffer += text;
  // Render from full buffer so markdown across chunk boundaries works
  answerEl.innerHTML = renderMarkdown(rawAnswerBuffer);
  answerEl.classList.add('has-text');
  answerEl.scrollTop = answerEl.scrollHeight;
});

window.electronAPI.onSuggestionDone(() => {
  // Final render with complete text
  answerEl.innerHTML = renderMarkdown(rawAnswerBuffer);
  cardBadge.textContent = 'Ready';
  cardBadge.className = 'card-badge ready';
  suggestionCard.classList.remove('active');
  cardFooter.removeAttribute('hidden');
});

window.electronAPI.onSuggestionError((err) => {
  cardBadge.textContent = 'Error';
  cardBadge.className = 'card-badge';
  answerEl.textContent = `Error: ${err}`;
  setStatus(`AI error: ${err}`);
});

// Snap — capture screen and analyze with Claude vision
btnSnap.addEventListener('click', async () => {
  if (btnSnap.classList.contains('loading')) return;
  btnSnap.classList.add('loading');
  try {
    await window.electronAPI.captureAndAnalyze();
  } finally {
    btnSnap.classList.remove('loading');
  }
});

// Got it — dismiss answer, ready for next question
btnGotIt.addEventListener('click', () => {
  rawAnswerBuffer = '';
  answerEl.innerHTML = 'Listening for next question...';
  answerEl.classList.remove('has-text');
  window.electronAPI.resetLastQuestion(); // clear dedup so next question fires fresh
  questionRow.setAttribute('hidden', '');
  cardFooter.setAttribute('hidden', '');
  cardBadge.textContent = 'Waiting...';
  cardBadge.className = 'card-badge';
  suggestionCard.classList.remove('active');
});

// Transcript events
window.electronAPI.onTranscript((msg) => {
  const speaker = (msg.speaker as string | null | undefined) ?? 'A';
  if (msg.type === 'partial') {
    interimTurn = { speaker, text: msg.text };
    renderTranscript();
  } else if (msg.type === 'final') {
    interimTurn = null;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += ' ' + msg.text;
    else turns.push({ speaker, text: msg.text });
    renderTranscript();
  } else if (msg.type === 'error') {
    setStatus(`Transcription error: ${msg.text}`);
  }
});

// Timer
function formatTime(s: number): string {
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');
}
function startTimer(): void {
  elapsedSeconds = 0;
  timerInterval = setInterval(() => { elapsedSeconds++; timerEl.textContent = formatTime(elapsedSeconds); }, 1000);
}
function stopTimer(): void {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// Record
btnRecord.addEventListener('click', async () => {
  btnRecord.disabled = true; btnStop.disabled = false; btnPause.disabled = false;
  turns = []; interimTurn = null; renderTranscript();
  answerEl.textContent = 'Start recording — suggestions appear when a question is detected.';
  answerEl.classList.remove('has-text');
  questionRow.setAttribute('hidden', '');
  cardFooter.setAttribute('hidden', '');
  cardBadge.textContent = 'Waiting...';
  cardBadge.className = 'card-badge';
  await window.electronAPI.resetAssistant();

  isRepeatMode = false;
  btnRepeatMode.classList.remove('is-repeat-state');
  await window.electronAPI.setListeningMode('interviewer');

  setDetectionState(true);
  await window.electronAPI.startDetection();

  recorder = new MeetingRecorder({ onStatus: setStatus, micDeviceId: selectedMicId || undefined });
  try {
    await recorder.start();
    startTimer();
  } catch (err) {
    setStatus(`Error: ${(err as Error).message}`);
    btnRecord.disabled = false; btnStop.disabled = true; btnPause.disabled = true;
  }
});

btnPause.addEventListener('click', () => {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause(); btnPause.textContent = 'Resume'; stopTimer(); setStatus('Paused');
  } else {
    recorder.resume(); btnPause.textContent = 'Pause'; startTimer(); setStatus('Recording');
  }
});

btnStop.addEventListener('click', async () => {
  if (!recorder) return;
  btnStop.disabled = true; btnPause.disabled = true; stopTimer(); setStatus('Finalizing...');
  const result = await recorder.stop();
  if (!result) { setStatus('Nothing to upload.'); btnRecord.disabled = false; return; }
  setStatus('Uploading...');
  try {
    const res = await window.electronAPI.uploadFinal(result.wavBuffer, result.metadata);
    setStatus(res.ok ? `Done — ${formatTime(elapsedSeconds)}` : `Upload failed`);
  } catch (err) {
    setStatus(`Upload error: ${(err as Error).message}`);
  }
  btnRecord.disabled = false; btnPause.textContent = 'Pause'; timerEl.textContent = '00:00:00'; recorder = null;
});
