import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { RecordingMetadata, UploadResult } from './types';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';
const WS_URL = process.env.WS_URL || 'ws://localhost:4000';

const activeSockets = new Map<string, WebSocket>();

export const uploaderEvents = new EventEmitter();

function getOrCreateSocket(sessionId: string): WebSocket {
  if (activeSockets.has(sessionId)) return activeSockets.get(sessionId)!;

  const ws = new WebSocket(`${WS_URL}/stream?session=${sessionId}`);
  ws.on('error', (err) => console.error(`[WS ${sessionId}]`, err.message));
  ws.on('close', () => activeSockets.delete(sessionId));

  // Forward transcript messages from server back to renderer
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as { type: string; text: string };
      uploaderEvents.emit('transcript', msg);
    } catch {
      // binary data — ignore
    }
  });

  activeSockets.set(sessionId, ws);
  return ws;
}

export async function uploadChunk(chunkBuffer: ArrayBuffer, sessionId: string): Promise<UploadResult> {
  const ws = getOrCreateSocket(sessionId);
  const buf = Buffer.from(chunkBuffer);

  return new Promise((resolve) => {
    const send = () =>
      ws.send(buf, (err) => resolve({ ok: !err, error: err?.message }));

    if (ws.readyState === WebSocket.OPEN) {
      send();
    } else {
      ws.once('open', send);
    }
  });
}

export async function uploadFinal(wavBuffer: ArrayBuffer, metadata: RecordingMetadata): Promise<UploadResult> {
  const ws = activeSockets.get(metadata.sessionId);
  if (ws) {
    ws.close();
    activeSockets.delete(metadata.sessionId);
  }

  try {
    const file = new File(
      [Buffer.from(wavBuffer)],
      `recording-${metadata.sessionId}.wav`,
      { type: 'audio/wav' }
    );
    const form = new FormData();
    form.append('audio', file);
    form.append('sessionId', metadata.sessionId);
    form.append('durationMs', String(metadata.durationMs));
    form.append('startedAt', metadata.startedAt);

    const res = await fetch(`${SERVER_URL}/upload`, { method: 'POST', body: form });
    const data = await res.json() as unknown;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
