export { interviewAssistant } from './interview';
export { salesAssistant } from './sales';
export type { AssistantPlugin, Turn } from './types';

import { interviewAssistant } from './interview';
import { salesAssistant } from './sales';
import type { AssistantPlugin } from './types';

// Registry — add new assistants here
export const ASSISTANTS: AssistantPlugin[] = [
  interviewAssistant,
  salesAssistant,
];
