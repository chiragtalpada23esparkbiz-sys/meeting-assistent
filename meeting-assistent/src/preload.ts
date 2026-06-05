import { contextBridge, ipcRenderer } from 'electron';
import type { SystemAudioSource, RecordingMetadata, UploadResult } from './types';

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio
  getSystemAudioSource: (): Promise<SystemAudioSource> =>
    ipcRenderer.invoke('get-system-audio-source'),
  getAudioSources: (): Promise<Array<{ id: string; name: string }>> =>
    ipcRenderer.invoke('get-audio-sources'),
  uploadFinal: (wavBuffer: ArrayBuffer, metadata: RecordingMetadata): Promise<UploadResult> =>
    ipcRenderer.invoke('upload-final', wavBuffer, metadata),

  // AssemblyAI — two streams
  startDeepgram: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('start-deepgram', sessionId),
  sendMicPcm: (buf: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('send-mic-pcm', buf),
  sendSystemPcm: (buf: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('send-system-pcm', buf),
  stopDeepgram: (): Promise<void> =>
    ipcRenderer.invoke('stop-deepgram'),

  // Transcript events
  onTranscript: (cb: (msg: { type: string; text: string; speaker?: string | null }) => void) =>
    ipcRenderer.on('transcript-update', (_e, msg) => cb(msg)),

  // Assistant
  getAssistants: (): Promise<Array<{ id: string; name: string; description: string }>> =>
    ipcRenderer.invoke('get-assistants'),
  getActiveAssistant: (): Promise<string> =>
    ipcRenderer.invoke('get-active-assistant'),
  setAssistant: (id: string): Promise<void> =>
    ipcRenderer.invoke('set-assistant', id),
  resetAssistant: (): Promise<void> =>
    ipcRenderer.invoke('reset-assistant'),
  resetLastQuestion: (): Promise<void> =>
    ipcRenderer.invoke('reset-last-question'),
  startDetection: (): Promise<void> =>
    ipcRenderer.invoke('start-detection'),
  stopDetection: (): Promise<void> =>
    ipcRenderer.invoke('stop-detection'),

  // Suggestion streaming events
  onSuggestionStart: (cb: (data: { question: string }) => void) =>
    ipcRenderer.on('suggestion-start', (_e, data) => cb(data)),
  onSuggestionChunk: (cb: (text: string) => void) =>
    ipcRenderer.on('suggestion-chunk', (_e, text) => cb(text)),
  onSuggestionDone: (cb: () => void) =>
    ipcRenderer.on('suggestion-done', () => cb()),
  onSuggestionError: (cb: (err: string) => void) =>
    ipcRenderer.on('suggestion-error', (_e, err) => cb(err)),
});
