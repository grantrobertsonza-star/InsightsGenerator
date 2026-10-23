/**
 * A browser's own words for a request that never got an answer ("Failed to fetch" in Chrome,
 * "Load failed" in Safari, "NetworkError when attempting to fetch resource" in Firefox) said
 * plainly. Any other message (the server's own error) is returned as it is.
 */
const BROWSER_NETWORK_ERROR = /^(TypeError: )?(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|fetch failed|network request failed)$/i;

export function plainConnectionError(message: string): string {
  return BROWSER_NETWORK_ERROR.test(message.trim()) ? "The connection to the server was lost before an answer came back." : message;
}
