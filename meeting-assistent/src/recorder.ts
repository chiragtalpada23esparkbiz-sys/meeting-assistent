import { createAudioMix, createPcmStreamer, chunksToWav, AudioMixResult, PcmStreamer } from './audioMixer';
import type { RecordingMetadata } from './types';

const CHUNK_INTERVAL_MS = 2000;

export interface StopResult {
  wavBuffer: ArrayBuffer;
  metadata: RecordingMetadata;
}

export class MeetingRecorder {
  private onStatus?: (msg: string) => void;
  private micDeviceId?: string;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: ArrayBuffer[] = [];
  private mixControl: AudioMixResult | null = null;
  private pcmStreamer: PcmStreamer | null = null;
  private systemPcmStreamer: PcmStreamer | null = null;
  private sessionId = '';
  private startedAt = '';

  constructor(callbacks: { onStatus?: (msg: string) => void; micDeviceId?: string } = {}) {
    this.onStatus = callbacks.onStatus;
    this.micDeviceId = callbacks.micDeviceId;
  }

  async start(): Promise<string> {
    this.sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = new Date().toISOString();
    this.chunks = [];

    this.onStatus?.('Requesting microphone...');
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.micDeviceId ? { exact: this.micDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
      video: false,
    });

    this.onStatus?.('Requesting system audio...');
    const sysInfo = await window.electronAPI.getSystemAudioSource();
    let systemStream: MediaStream | null = null;

    if (sysInfo.supported && sysInfo.sourceId) {
      try {
        const desktopStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sysInfo.sourceId,
            },
          } as MediaTrackConstraints,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sysInfo.sourceId,
            },
          } as MediaTrackConstraints,
        } as MediaStreamConstraints);

        desktopStream.getVideoTracks().forEach((t) => t.stop());
        systemStream = new MediaStream(desktopStream.getAudioTracks());
      } catch (err) {
        console.warn('System audio unavailable, mic-only:', (err as Error).message);
        this.onStatus?.('System audio unavailable — mic only');
      }
    } else if (sysInfo.guidance) {
      this.onStatus?.(sysInfo.guidance);
    }

    this.onStatus?.('Mixing audio...');
    this.mixControl = await createAudioMix(micStream, systemStream);

    // Start AssemblyAI sessions (one per stream)
    await window.electronAPI.startDeepgram(this.sessionId);

    // Mic → AssemblyAI mic session (always "You")
    this.pcmStreamer = createPcmStreamer(micStream, (buf) => {
      window.electronAPI.sendMicPcm(buf);
    });

    // System audio → AssemblyAI system session (always "Interviewer")
    if (systemStream) {
      this.systemPcmStreamer = createPcmStreamer(systemStream, (buf) => {
        window.electronAPI.sendSystemPcm(buf);
      });
    }

    // MediaRecorder for final WAV
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.mediaRecorder = new MediaRecorder(this.mixControl.mixedStream, {
      mimeType,
      audioBitsPerSecond: 128000,
    });

    this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) e.data.arrayBuffer().then((buf) => this.chunks.push(buf));
    };

    this.mediaRecorder.start(CHUNK_INTERVAL_MS);
    this.onStatus?.('Recording');
    return this.sessionId;
  }

  stop(): Promise<StopResult | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return Promise.resolve(null);
    }

    this.pcmStreamer?.stop();
    this.pcmStreamer = null;
    this.systemPcmStreamer?.stop();
    this.systemPcmStreamer = null;
    window.electronAPI.stopDeepgram();

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        this.mixControl?.stop();
        const durationMs = Date.now() - new Date(this.startedAt).getTime();
        const wavBuffer = await chunksToWav(this.chunks);
        resolve({ wavBuffer, metadata: { sessionId: this.sessionId, durationMs, startedAt: this.startedAt } });
      };
      this.mediaRecorder!.stop();
    });
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.pause();
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') this.mediaRecorder.resume();
  }

  get state(): RecordingState {
    return this.mediaRecorder?.state ?? 'inactive';
  }
}
