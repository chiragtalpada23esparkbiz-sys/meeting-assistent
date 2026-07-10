import { AssemblyAI } from 'assemblyai';
import type { TurnEvent } from 'assemblyai';
import { EventEmitter } from 'events';

export const transcriptEvents = new EventEmitter();

type Transcriber = ReturnType<InstanceType<typeof AssemblyAI>['streaming']['transcriber']>;

let micTranscriber: Transcriber | null = null;
let systemTranscriber: Transcriber | null = null;
let sessionsActive = false;
let reconnecting = false;
let currentApiKey: string | null = null;

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

async function reconnectSessions(): Promise<void> {
  if (reconnecting || !currentApiKey) return;
  reconnecting = true;
  console.log('[AssemblyAI] Attempting to reconnect...');

  // Close any existing connections
  await Promise.allSettled([
    micTranscriber?.close(),
    systemTranscriber?.close(),
  ]);

  // Wait a bit before reconnecting
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (!sessionsActive) {
    // User stopped recording during reconnect delay
    reconnecting = false;
    return;
  }

  try {
    micTranscriber = createTranscriber(currentApiKey);
    systemTranscriber = createTranscriber(currentApiKey);

    attachHandlers(micTranscriber, 'A', 'Mic');
    attachHandlers(systemTranscriber, 'B', 'System');

    await Promise.all([
      micTranscriber.connect(),
      systemTranscriber.connect(),
    ]);

    console.log('[AssemblyAI] Reconnected successfully');
    transcriptEvents.emit('transcript', {
      type: 'final',
      text: '[Reconnected]',
      speaker: 'A',
    });
  } catch (err) {
    console.error('[AssemblyAI] Reconnection failed:', (err as Error).message);
    // Try again after a longer delay
    setTimeout(() => {
      reconnecting = false;
      if (sessionsActive) reconnectSessions();
    }, 3000);
    return;
  }

  reconnecting = false;
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
    // If socket closes unexpectedly while sessions should be active, try to reconnect
    if (sessionsActive && !reconnecting) {
      console.warn(`[AssemblyAI] ${label} closed unexpectedly, attempting reconnect...`);
      reconnectSessions();
    }
  });
}

export async function startSessions(sessionId: string): Promise<void> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    transcriptEvents.emit('transcript', { type: 'error', text: 'ASSEMBLYAI_API_KEY not set in .env' });
    return;
  }

  // Save API key for reconnection
  currentApiKey = apiKey;
  reconnecting = false;

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
  if (!sessionsActive || !micTranscriber || reconnecting) return;
  try {
    micTranscriber.sendAudio(buffer);
  } catch (err) {
    // Socket closed unexpectedly - trigger reconnect
    console.warn('[AssemblyAI] Mic socket error, triggering reconnect');
    if (!reconnecting) reconnectSessions();
  }
}

export function sendSystemPcm(buffer: ArrayBuffer): void {
  if (!sessionsActive || !systemTranscriber || reconnecting) return;
  try {
    systemTranscriber.sendAudio(buffer);
  } catch (err) {
    // Socket closed unexpectedly - trigger reconnect
    console.warn('[AssemblyAI] System socket error, triggering reconnect');
    if (!reconnecting) reconnectSessions();
  }
}

export async function stopSessions(): Promise<void> {
  // Set flags first to prevent any incoming PCM from being sent and stop reconnection
  sessionsActive = false;
  reconnecting = false;
  currentApiKey = null;

  await Promise.allSettled([
    micTranscriber?.close(),
    systemTranscriber?.close(),
  ]);
  micTranscriber = null;
  systemTranscriber = null;
}
