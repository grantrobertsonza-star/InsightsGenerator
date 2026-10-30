import { StringDecoder } from "node:string_decoder";

/** Keep fragments until a newline arrives, scanning each incoming chunk only once.
 * Wide raw-table replies can be tens of megabytes; rescanning the accumulated reply on
 * every pipe chunk made their framing quadratic before JSON parsing even began. */
export function createJsonLineReader(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder("utf8");
  let fragments: string[] = [];
  return chunk => {
    const text = decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    let from = 0;
    for (;;) {
      const newline = text.indexOf("\n", from);
      if (newline < 0) {
        if (from < text.length) fragments.push(text.slice(from));
        return;
      }
      fragments.push(text.slice(from, newline));
      const line = fragments.join("").trim();
      fragments = [];
      if (line) onLine(line);
      from = newline + 1;
    }
  };
}
