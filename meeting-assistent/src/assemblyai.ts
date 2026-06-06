import { AssemblyAI } from 'assemblyai';
import type { TurnEvent } from 'assemblyai';
import { EventEmitter } from 'events';

export const transcriptEvents = new EventEmitter();

type Transcriber = ReturnType<InstanceType<typeof AssemblyAI>['streaming']['transcriber']>;

let micTranscriber: Transcriber | null = null;
let systemTranscriber: Transcriber | null = null;
let sessionsActive = false;

function createTranscriber(apiKey: string): Transcriber {
  const client = new AssemblyAI({ apiKey });
  return client.streaming.transcriber({
    sampleRate: 16000,
    encoding: 'pcm_s16le',
    speechModel: 'universal-streaming-english',
    // Faster end-of-turn detection so questions are caught in one go
    minTurnSilence: 560,
    endOfTurnConfidenceThreshold: 0.45,
  });
}

function attachHandlers(t: Transcriber, speaker: 'A' | 'B', label: string): void {
  t.on('open', ({ id }: { id: string }) => {
    console.log(`[AssemblyAI] ${label} session open — ${id}`);
  });

  t.on('turn', (turn: TurnEvent) => {
    if (!turn.transcript) return;
    transcriptEvents.emit('transcript', {
      type: turn.end_of_turn ? 'final' : 'partial',
      text: turn.transcript,
      speaker,
    });
  });

  t.on('error', (err: Error) => {
    console.error(`[AssemblyAI] ${label} error:`, err.message);
  });

  t.on('close', (code: number) => {
    console.log(`[AssemblyAI] ${label} closed — code: ${code}`);
    // If socket closes unexpectedly while sessions should be active, notify UI
    if (sessionsActive) {
      console.warn(`[AssemblyAI] ${label} closed unexpectedly, marking sessions inactive`);
      sessionsActive = false;
      transcriptEvents.emit('transcript', {
        type: 'error',
        text: `Connection lost (${label}). Please restart recording.`,
      });
    }
  });
}

export async function startSessions(sessionId: string): Promise<void> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    transcriptEvents.emit('transcript', { type: 'error', text: 'ASSEMBLYAI_API_KEY not set in .env' });
    return;
  }

  micTranscriber = createTranscriber(apiKey);
  systemTranscriber = createTranscriber(apiKey);

  attachHandlers(micTranscriber, 'A', 'Mic');       // mic = always "You"
  attachHandlers(systemTranscriber, 'B', 'System');  // system audio = always other person

  await Promise.all([
    micTranscriber.connect(),
    systemTranscriber.connect(),
  ]);

  sessionsActive = true;
  console.log(`[AssemblyAI] Both sessions ready — session: ${sessionId}`);
}

export function sendMicPcm(buffer: ArrayBuffer): void {
  if (!sessionsActive || !micTranscriber) return;
  try {
    micTranscriber.sendAudio(buffer);
  } catch (err) {
    // Socket closed unexpectedly - stop sending
    console.warn('[AssemblyAI] Mic socket closed unexpectedly, stopping sends');
    sessionsActive = false;
  }
}

export function sendSystemPcm(buffer: ArrayBuffer): void {
  if (!sessionsActive || !systemTranscriber) return;
  try {
    systemTranscriber.sendAudio(buffer);
  } catch (err) {
    // Socket closed unexpectedly - stop sending
    console.warn('[AssemblyAI] System socket closed unexpectedly, stopping sends');
    sessionsActive = false;
  }
}

export async function stopSessions(): Promise<void> {
  // Set flag first to prevent any incoming PCM from being sent
  sessionsActive = false;

  await Promise.allSettled([
    micTranscriber?.close(),
    systemTranscriber?.close(),
  ]);
  micTranscriber = null;
  systemTranscriber = null;
}
