import { BrowserWindow } from 'electron';
import { ASSISTANTS } from './assistants';
import type { AssistantPlugin, Turn } from './assistants';

// Lazy — required at call time so a broken SDK or missing key never crashes startup
function streamCompletion(systemPrompt: string, userContent: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_key_here') {
    throw new Error('ANTHROPIC_API_KEY not set in .env');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  return client.messages.stream({
    model: 'claude-opus-4-5',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
}

let activeAssistant: AssistantPlugin = ASSISTANTS[0];
const mySpeaker = 'A'; // mic stream is always Speaker A = "You"
const history: Turn[] = [];

export function setActiveAssistant(id: string): void {
  const found = ASSISTANTS.find((a) => a.id === id);
  if (found) {
    activeAssistant = found;
    history.length = 0;
    console.log(`[Assistant] Switched to: ${found.name}`);
  }
}

export function getActiveAssistantId(): string {
  return activeAssistant.id;
}

export function getAssistantList(): Array<{ id: string; name: string; description: string }> {
  return ASSISTANTS.map(({ id, name, description }) => ({ id, name, description }));
}

export function resetHistory(): void {
  history.length = 0;
}

export async function processTurn(turn: Turn): Promise<void> {
  history.push(turn);

  console.log(`[Assistant] Turn — speaker: ${turn.speaker} (me=${mySpeaker}), text: "${turn.text.slice(0, 60)}"`);

  const willRespond = activeAssistant.shouldRespond(turn, history, mySpeaker);
  console.log(`[Assistant] shouldRespond: ${willRespond}`);
  if (!willRespond) return;

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;

  win.webContents.send('suggestion-start', { question: turn.text });

  try {
    const stream = streamCompletion(
      activeAssistant.systemPrompt,
      activeAssistant.buildPrompt(turn, history),
    );

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        win.webContents.send('suggestion-chunk', chunk.delta.text);
      }
    }

    win.webContents.send('suggestion-done');
  } catch (err) {
    win.webContents.send('suggestion-error', (err as Error).message);
  }
}
