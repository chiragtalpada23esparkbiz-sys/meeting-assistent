const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const PORT = 4000;
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const app = express();

// WebSocket server for real-time chunk streaming
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

wss.on('connection', (ws, req) => {
  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('session') ?? 'unknown';
  let chunkCount = 0;

  console.log(`\n[WS] Session connected: ${sessionId}`);

  ws.on('message', (data) => {
    chunkCount++;
    console.log(`[WS] Chunk #${chunkCount} received — ${data.length} bytes (session: ${sessionId})`);
  });

  ws.on('close', () => {
    console.log(`[WS] Session closed: ${sessionId} — total chunks: ${chunkCount}`);
  });
});

// HTTP endpoint for final WAV upload
const upload = multer({ storage: multer.memoryStorage() });

app.post('/upload', upload.single('audio'), (req, res) => {
  const { sessionId, durationMs, startedAt } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No audio file received' });
  }

  const filename = `${sessionId}.wav`;
  const filepath = path.join(RECORDINGS_DIR, filename);
  fs.writeFileSync(filepath, file.buffer);

  const durationSec = (Number(durationMs) / 1000).toFixed(1);
  console.log(`\n[HTTP] Final upload received`);
  console.log(`  Session  : ${sessionId}`);
  console.log(`  Started  : ${startedAt}`);
  console.log(`  Duration : ${durationSec}s`);
  console.log(`  Size     : ${(file.buffer.length / 1024).toFixed(1)} KB`);
  console.log(`  Saved to : recordings/${filename}`);

  res.json({ ok: true, sessionId, filename });
});

server.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`WebSocket ready at  ws://localhost:${PORT}/stream`);
  console.log(`Recordings saved to: ${RECORDINGS_DIR}`);
  console.log('\nWaiting for recording...\n');
});
