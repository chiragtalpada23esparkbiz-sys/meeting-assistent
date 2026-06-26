import type { SystemAudioSource, RecordingMetadata, UploadResult } from './types';

declare module '*.css';

declare global {
  interface Window {
    electronAPI: {
      getSystemAudioSource: () => Promise<SystemAudioSource>;
      getAudioSources: () => Promise<Array<{ id: string; name: string }>>;
      uploadFinal: (wavBuffer: ArrayBuffer, metadata: RecordingMetadata) => Promise<UploadResult>;
      startDeepgram: (sessionId: string) => Promise<void>;
      sendMicPcm: (buf: ArrayBuffer) => Promise<void>;
      sendSystemPcm: (buf: ArrayBuffer) => Promise<void>;
      stopDeepgram: () => Promise<void>;
      onTranscript: (cb: (msg: { type: string; text: string; speaker?: string | null }) => void) => void;
      getAssistants: () => Promise<Array<{ id: string; name: string; description: string }>>;
      getActiveAssistant: () => Promise<string>;
      setAssistant: (id: string) => Promise<void>;
      resetAssistant: () => Promise<void>;
      resetLastQuestion: () => Promise<void>;
      setWindowPosition: (x: number, y: number) => Promise<void>;
      captureAndAnalyze: () => Promise<void>;
      startDetection: () => Promise<void>;
      stopDetection: () => Promise<void>;
      setListeningMode: (mode: 'interviewer' | 'self') => Promise<void>;
      getListeningMode: () => Promise<'interviewer' | 'self'>;
      onSuggestionStart: (cb: (data: { question: string }) => void) => void;
      onSuggestionChunk: (cb: (text: string) => void) => void;
      onSuggestionDone: (cb: () => void) => void;
      onSuggestionError: (cb: (err: string) => void) => void;
    };
  }
}
