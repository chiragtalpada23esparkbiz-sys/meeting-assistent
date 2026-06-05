import { AssemblyAI } from 'assemblyai';
import type { TurnEvent } from 'assemblyai';
import { EventEmitter } from 'events';

export const transcriptEvents = new EventEmitter();

type Transcriber = ReturnType<InstanceType<typeof AssemblyAI>['streaming']['transcriber']>;

let micTranscriber: Transcriber | null = null;
let systemTranscriber: Transcriber | null = null;

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

  console.log(`[AssemblyAI] Both sessions ready — session: ${sessionId}`);
}

export function sendMicPcm(buffer: ArrayBuffer): void {
  micTranscriber?.sendAudio(buffer);
}

export function sendSystemPcm(buffer: ArrayBuffer): void {
  systemTranscriber?.sendAudio(buffer);
}

export async function stopSessions(): Promise<void> {
  await Promise.allSettled([
    micTranscriber?.close(),
    systemTranscriber?.close(),
  ]);
  micTranscriber = null;
  systemTranscriber = null;
}
