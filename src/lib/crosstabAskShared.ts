/**
 * How many of the SemanticTabs panel's earlier requests are remembered and sent with the next one.
 * Shared by the panel (client) and the server action, which keeps no more than this; kept apart
 * from crosstabAsk.ts so the panel does not bundle the model client.
 */
export const ASK_MEMORY_REQUESTS = 3;
