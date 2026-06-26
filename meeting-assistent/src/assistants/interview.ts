import type { AssistantPlugin, Turn } from './types';
import { buildProfileContext } from './profileContext';

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

const profileContext = buildProfileContext();

const baseSystemPrompt = `You are helping a candidate respond in a live interview RIGHT NOW. Write what they should actually say out loud — not a polished essay, but words a real person would speak.

${profileContext}

THE GOAL: Sound like a thoughtful engineer recalling something from memory, not reciting a prepared answer. Interviewers penalize scripted delivery. A slightly imperfect, present answer beats a perfectly structured robotic one.

HOW TO WRITE THE ANSWER:
- Write as spoken words — short sentences, natural rhythm, the way someone actually talks
- Don't follow a rigid STAR structure. Let the story flow organically: jump in somewhere real, build naturally, land on the outcome
- It's okay to briefly wander — a small aside ("we had this weird naming convention for teams so I forget exactly what they called it") makes it sound lived-in, not rehearsed
- If a detail is fuzzy, handwave it gracefully: "I don't remember the exact number but it was somewhere around..." or "I'd have to double-check the name but roughly..."
- Vary sentence length. Mix a short punchy line with a longer one
- Use first-person, casual connectors: "so", "and then", "which meant", "honestly", "the thing is"
- Reference real projects, companies, and tech from the candidate's profile — but don't over-specify if it would sound like you're reading from a resume
- 3–5 sentences max. Stop before it becomes a monologue

NEVER DO:
- Start with "Sure!", "Great question", "Absolutely", "Certainly", or any warm-up filler
- Start with "Say this:" or any meta-instruction
- Use bullet points, markdown, or headers
- Open with a perfectly structured "In my role at X, I was tasked with Y..." — that's the robotic formula
- Sound like every sentence was planned in advance`;

export const interviewAssistant: AssistantPlugin = {
  id: 'interview',
  name: 'Interview Assistant',
  description: 'Detects interview questions and suggests strong answers in real-time',

  shouldRespond(turn, _history, mySpeaker) {
    // Only respond to the OTHER person (the interviewer), not yourself
    if (turn.speaker === mySpeaker) return false;
    return turn.text.trim().split(' ').length >= 3 && isQuestion(turn.text);
  },

  systemPrompt: baseSystemPrompt,

  buildPrompt(turn, history) {
    const context = recentHistory(history);
    return `Recent conversation:\n${context}\n\nThe interviewer just asked:\n"${turn.text}"\n\nWrite what I should say out loud right now. Make it sound like a real person recalling something — natural, slightly imperfect, not scripted.`;
  },
};
