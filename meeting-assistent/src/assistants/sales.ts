import type { AssistantPlugin, Turn } from './types';

const TRIGGER_PATTERNS = [
  /\?$/,
  /(too expensive|pricing|cost|budget|afford|cheaper|discount)/i,
  /(competitor|alternative|vs\.|versus|compared to|why not)/i,
  /(not sure|think about|get back|need time|talk to)/i,
  /(how does|what does|tell me about|can it|does it)/i,
];

function recentHistory(history: Turn[], n = 6): string {
  return history
    .slice(-n)
    .map((t) => `${t.speaker === 'A' ? 'Rep' : 'Prospect'}: ${t.text}`)
    .join('\n');
}

export const salesAssistant: AssistantPlugin = {
  id: 'sales',
  name: 'Sales Assistant',
  description: 'Handles objections and suggests responses during sales calls',

  shouldRespond(turn, _history, mySpeaker) {
    if (turn.speaker === mySpeaker) return false;
    return turn.text.trim().split(' ').length >= 4 &&
      TRIGGER_PATTERNS.some((p) => p.test(turn.text));
  },

  systemPrompt: `You are an expert sales coach helping a sales rep respond to prospects in real-time during a live sales call.

Rules:
- Suggest a concise, confident response (2-4 sentences max)
- Acknowledge the prospect's concern before addressing it
- Focus on value, not features
- Never be pushy — be consultative
- Start directly — no meta-commentary`,

  buildPrompt(turn, history) {
    const context = recentHistory(history);
    return `Recent conversation:\n${context}\n\nThe prospect just said:\n"${turn.text}"\n\nSuggest what the rep should say next.`;
  },
};
