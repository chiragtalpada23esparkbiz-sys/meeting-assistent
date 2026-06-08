import { ipcMain, desktopCapturer, BrowserWindow } from 'electron';
import { getSystemAudioSource } from './systemAudio';
import { uploadFinal } from './uploader';
import { startSessions, sendMicPcm, sendSystemPcm, stopSessions, transcriptEvents } from './assemblyai';
import { broadcastToExtension } from './localRelay';
import { processTurn, setActiveAssistant, getActiveAssistantId, getAssistantList, resetHistory } from './assistantManager';
import type { RecordingMetadata } from './types';

// Debounce state — lives at module level so handlers can share it
let partialTimer: ReturnType<typeof setTimeout> | null = null;
let lastPartialText = '';
let lastProcessedText = '';
let detectionPaused = false; // Stop/Ready toggle

function safeProcess(speaker: string, text: string): void {
  if (detectionPaused) return;
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized === lastProcessedText) return;
  lastProcessedText = normalized;
  processTurn({ speaker, text: text.trim() });
}

export function setupIpcHandlers(): void {
  ipcMain.handle('get-system-audio-source', () => getSystemAudioSource());

  ipcMain.handle('upload-final', (_event, wavBuffer: ArrayBuffer, metadata: RecordingMetadata) =>
    uploadFinal(wavBuffer, metadata)
  );

  ipcMain.handle('get-audio-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  // AssemblyAI streaming
  ipcMain.handle('start-deepgram', (_event, sessionId: string) => startSessions(sessionId));
  ipcMain.handle('send-mic-pcm', (_event, buf: ArrayBuffer) => sendMicPcm(buf));
  ipcMain.handle('send-system-pcm', (_event, buf: ArrayBuffer) => sendSystemPcm(buf));
  ipcMain.handle('stop-deepgram', () => stopSessions());

  // Assistant controls
  ipcMain.handle('get-assistants', () => getAssistantList());
  ipcMain.handle('get-active-assistant', () => getActiveAssistantId());
  ipcMain.handle('set-assistant', (_event, id: string) => setActiveAssistant(id));
  ipcMain.handle('reset-assistant', () => { resetHistory(); lastProcessedText = ''; });

  // Called by "Got it" button — clears dedup so next question is detected fresh
  ipcMain.handle('reset-last-question', () => { lastProcessedText = ''; });

  // Window dragging (needed because focusable:false breaks native -webkit-app-region drag)
  ipcMain.handle('set-window-position', (_event, x: number, y: number) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setPosition(Math.round(x), Math.round(y));
  });

  // Detection on/off toggle
  ipcMain.handle('start-detection', () => { detectionPaused = false; });
  ipcMain.handle('stop-detection',  () => { detectionPaused = true; });


  // ── Transcript routing with debounced fallback ──
  transcriptEvents.on('transcript', (msg: { type: string; text: string; speaker?: string | null }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('transcript-update', msg);
    broadcastToExtension(msg);

    const speaker = msg.speaker ?? 'A';

    if (msg.type === 'final' && msg.text) {
      // Cancel pending debounce — we got the real final
      if (speaker === 'B' && partialTimer) {
        clearTimeout(partialTimer);
        partialTimer = null;
      }
      safeProcess(speaker, msg.text);
    }

    // Debounce fallback: treat interviewer partial as final after 800ms silence
    // This catches questions even when end_of_turn fires late
    if (msg.type === 'partial' && speaker === 'B' && msg.text) {
      lastPartialText = msg.text;
      if (partialTimer) clearTimeout(partialTimer);
      partialTimer = setTimeout(() => {
        partialTimer = null;
        safeProcess('B', lastPartialText);
      }, 800);
    }
  });
}
