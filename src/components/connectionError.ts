/**
 * The browsers' own words for a request that got no answer: "Failed to fetch" (Chrome),
 * "NetworkError when attempting to fetch resource." (Firefox), "Load failed" (Safari), and the
 * runtime wordings "fetch failed" and "Network request failed". The one list of them (Codex
 * M-B8-02): actionFailure.ts (project controls) and the Research assistant both recognise a lost
 * connection with it, each in its own words.
 */
const BROWSER_NETWORK_ERROR = /^(failed to fetch|networkerror when attempting to fetch resource\.?|load failed|fetch failed|network request failed)$/i;

/**
 * True when `message` is one of those wordings. A message as an Error prints it, "TypeError: ..."
 * (the browser raises them as a TypeError), is recognised too.
 */
export function isBrowserNetworkErrorMessage(message: string): boolean {
  return BROWSER_NETWORK_ERROR.test(message.trim().replace(/^TypeError:\s*/, ""));
}

/** The Research assistant's wording for a lost connection; any other message is returned as it is. */
export function plainConnectionError(message: string): string {
  return isBrowserNetworkErrorMessage(message) ? "The connection to the server was lost before an answer came back." : message;
}
