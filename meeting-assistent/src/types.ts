export interface SystemAudioSource {
  sourceId: string | null;
  platform: string;
  supported: boolean;
  guidance?: string;
}

export interface RecordingMetadata {
  sessionId: string;
  durationMs: number;
  startedAt: string;
}

export interface UploadResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
}

export interface TranscriptMessage {
  type: 'partial' | 'final' | 'error' | 'status' | 'reset';
  text: string;
  speaker?: string | null;
}
