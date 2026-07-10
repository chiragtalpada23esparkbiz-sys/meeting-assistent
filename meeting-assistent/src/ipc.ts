import { ipcMain, desktopCapturer, BrowserWindow } from 'electron';
import { getSystemAudioSource } from './systemAudio';
import { uploadFinal } from './uploader';
import { startSessions, sendMicPcm, sendSystemPcm, stopSessions, transcriptEvents } from './assemblyai';
import { broadcastToExtension } from './localRelay';
import { processTurn, processScreenshot, setActiveAssistant, getActiveAssistantId, getAssistantList, resetHistory, setListeningMode, getListeningMode } from './assistantManager';
import type { RecordingMetadata } from './types';

// Debounce state — lives at module level so handlers can share it
let interviewerTimer: ReturnType<typeof setTimeout> | null = null;
let accumulatedInterviewerText = ''; // Accumulate interviewer speech before processing
let lastProcessedText = '';
let detectionPaused = false; // Stop/Ready toggle
const INTERVIEWER_SILENCE_MS = 1500; // Wait for silence before processing question

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
  ipcMain.handle('reset-assistant', () => { resetHistory(); lastProcessedText = ''; accumulatedInterviewerText = ''; });

  // Called by "Got it" button — clears dedup so next question is detected fresh
  ipcMain.handle('reset-last-question', () => { lastProcessedText = ''; accumulatedInterviewerText = ''; });

  // Screenshot capture → Claude vision analysis
  ipcMain.handle('capture-and-analyze', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    const source = sources[0];
    if (!source) {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('suggestion-error', 'No screen source found');
      return;
    }
    const imageBase64 = source.thumbnail.toJPEG(85).toString('base64');
    await processScreenshot(imageBase64);
  });

  // Window dragging (needed because focusable:false breaks native -webkit-app-region drag)
  // Return full bounds to preserve exact size during drag (avoids DPI scaling issues on Windows)
  ipcMain.handle('get-window-bounds', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return { x: 0, y: 0, width: 400, height: 580 };
    return win.getBounds();
  });

  ipcMain.handle('drag-start', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setResizable(false);
  });

  ipcMain.handle('drag-end', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setResizable(true);
  });

  ipcMain.handle('set-window-bounds', (_event, x: number, y: number, width: number, height: number) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  });

  // Detection on/off toggle
  ipcMain.handle('start-detection', () => { detectionPaused = false; });
  ipcMain.handle('stop-detection',  () => { detectionPaused = true; });

  // Listening mode — 'interviewer' (default) listens to speaker B (system audio)
  //                  'self' listens to speaker A (mic) so user can repeat the question
  ipcMain.handle('set-listening-mode', (_event, mode: 'interviewer' | 'self') => {
    lastProcessedText = ''; // clear dedup so the re-stated question fires fresh
    accumulatedInterviewerText = '';
    setListeningMode(mode);
  });
  ipcMain.handle('get-listening-mode', () => getListeningMode());


  // ── Transcript routing with accumulation for interviewer ──
  // Interviewer speech (speaker B) is accumulated and only processed after silence
  // This ensures we capture the full question before triggering the assistant
  transcriptEvents.on('transcript', (msg: { type: string; text: string; speaker?: string | null }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('transcript-update', msg);
    broadcastToExtension(msg);

    const speaker = msg.speaker ?? 'A';

    // Speaker A (user) — process immediately
    if (speaker === 'A' && msg.type === 'final' && msg.text) {
      safeProcess('A', msg.text);
      return;
    }

    // Speaker B (interviewer) — accumulate and wait for silence
    if (speaker === 'B' && msg.text) {
      // Reset timer on any new speech
      if (interviewerTimer) {
        clearTimeout(interviewerTimer);
        interviewerTimer = null;
      }

      if (msg.type === 'final') {
        // Append final to accumulated text
        accumulatedInterviewerText += (accumulatedInterviewerText ? ' ' : '') + msg.text;
      }

      // Start silence timer — process after no speech for INTERVIEWER_SILENCE_MS
      const textToProcess = msg.type === 'final' ? accumulatedInterviewerText : msg.text;
      interviewerTimer = setTimeout(() => {
        interviewerTimer = null;
        if (textToProcess) {
          safeProcess('B', textToProcess);
          accumulatedInterviewerText = ''; // Reset for next question
        }
      }, INTERVIEWER_SILENCE_MS);
    }
  });
}
