import type { AssistantPlugin, Turn } from './types';

const QUESTION_PATTERNS = [
  /\?/,
  /\b(tell me|describe|explain|walk me through|talk me through)\b/i,
  /\b(what|how|why|when|where|who|which)\b/i,
  /\b(can you|could you|have you|would you|do you|did you)\b/i,
  /\b(talk about|tell us|give me|give us|share|elaborate)\b/i,
  /(your experience|your background|your approach|you handled|you dealt)/i,
];

function isQuestion(text: string): boolean {
  const clean = text.trim();
  // Must have at least 3 words to avoid noise
  if (clean.split(/\s+/).length < 3) return false;
  return QUESTION_PATTERNS.some((p) => p.test(clean));
}

function recentHistory(history: Turn[], n = 6): string {
  return history
    .slice(-n)
    .map((t) => `${t.speaker === 'A' ? 'You' : 'Interviewer'}: ${t.text}`)
    .join('\n');
}

export const interviewAssistant: AssistantPlugin = {
  id: 'interview',
  name: 'Interview Assistant',
  description: 'Detects interview questions and suggests strong answers in real-time',

  shouldRespond(turn, _history, mySpeaker) {
    // Only respond to the OTHER person (the interviewer), not yourself
    if (turn.speaker === mySpeaker) return false;
    return turn.text.trim().split(' ').length >= 3 && isQuestion(turn.text);
  },

  systemPrompt: `You are an expert interview coach. The candidate is in a live interview RIGHT NOW and needs an answer they can speak immediately.

Rules:
- Start DIRECTLY with the answer — first word should be a real answer word
- NEVER start with "Say this:", "Here's an answer:", "Sure!", "Great question", or any meta-commentary
- 3-5 sentences max — concise and confident
- Use STAR method (Situation, Task, Action, Result) for behavioral questions
- Be specific and natural, not robotic
- Plain text only — no markdown, no bullet points, no bold`,

  buildPrompt(turn, history) {
    const context = recentHistory(history);
    return `Recent conversation:\n${context}\n\nThe interviewer just asked:\n"${turn.text}"\n\nProvide a strong, concise answer I can say right now.`;
  },
};
