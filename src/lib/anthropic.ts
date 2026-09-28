import Anthropic from "@anthropic-ai/sdk";

// Server-only. Never import this into a client component, the API key
// would end up shipped to the browser.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const CLAUDE_MODEL = "claude-sonnet-5";
