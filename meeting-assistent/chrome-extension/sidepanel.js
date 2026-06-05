const transcriptEl = document.getElementById('transcript');
const statusEl = document.getElementById('status');
const dotEl = document.getElementById('dot');
const btnClear = document.getElementById('btn-clear');
const btnCopy = document.getElementById('btn-copy');

let turns = [];
let interimTurn = null;
let ws = null;
let reconnectTimer = null;

function setConnected(connected) {
  dotEl.className = 'dot ' + (connected ? 'connected' : 'disconnected');
  statusEl.textContent = connected ? 'Connected' : 'App not running';
}

function speakerLabel(s) {
  return s === 'A' ? 'You' : 'Prospect';
}

function renderTranscript() {
  if (turns.length === 0 && !interimTurn) {
    transcriptEl.innerHTML = '<span class="placeholder">Waiting for recording...</span>';
    return;
  }

  const html = turns.map((t) =>
    `<div class="turn speaker-${t.speaker.toLowerCase()}">
      <span class="turn-label">${speakerLabel(t.speaker)}</span>
      <span class="turn-text">${t.text}</span>
    </div>`
  ).join('');

  const interim = interimTurn
    ? `<div class="turn speaker-${interimTurn.speaker.toLowerCase()} interim">
        <span class="turn-label">${speakerLabel(interimTurn.speaker)}</span>
        <span class="turn-text">${interimTurn.text}</span>
      </div>`
    : '';

  transcriptEl.innerHTML = html + interim;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function connect() {
  if (ws) ws.close();
  ws = new WebSocket('ws://localhost:5000');

  ws.onopen = () => {
    setConnected(true);
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const speaker = msg.speaker || 'A';

      if (msg.type === 'final' && msg.text) {
        interimTurn = null;
        const last = turns[turns.length - 1];
        if (last && last.speaker === speaker) {
          last.text += ' ' + msg.text;
        } else {
          turns.push({ speaker, text: msg.text });
        }
        renderTranscript();
      } else if (msg.type === 'partial' && msg.text) {
        interimTurn = { speaker, text: msg.text };
        renderTranscript();
      } else if (msg.type === 'reset') {
        turns = [];
        interimTurn = null;
        renderTranscript();
      }
    } catch (e) { /* ignore */ }
  };

  ws.onclose = () => {
    setConnected(false);
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => { setConnected(false); };
}

btnClear.addEventListener('click', () => {
  fullTranscript = '';
  renderTranscript();
});

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(fullTranscript).then(() => {
    btnCopy.textContent = 'Copied!';
    setTimeout(() => { btnCopy.textContent = 'Copy'; }, 1500);
  });
});

connect();
