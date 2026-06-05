export interface Turn {
  speaker: string;
  text: string;
}

export interface AssistantPlugin {
  id: string;
  name: string;
  description: string;

  // Should this turn trigger an LLM response?
  // mySpeaker is passed in so the plugin knows who "you" are
  shouldRespond(turn: Turn, history: Turn[], mySpeaker: string): boolean;

  // Build the user message sent to the LLM
  buildPrompt(turn: Turn, history: Turn[]): string;

  // System-level instructions for the LLM
  systemPrompt: string;
}
