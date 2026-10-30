import { describe, expect, it } from "vitest";
import { createJsonLineReader } from "../jsonLineReader";
describe("statistics JSON lines preserve complete reply identity", () => {
  it("reads multiple messages from one chunk and retains the next partial reply", () => {
    const lines: string[] = []; const write = createJsonLineReader(line => lines.push(line));
    write(Buffer.from('{"ready":true}\n{"id":1,"result":42}\n{"id":2'));
    expect(lines.map(x => JSON.parse(x))).toEqual([{ ready: true }, { id: 1, result: 42 }]);
    write(Buffer.from(',"error":"retry"}\n'));
    expect(JSON.parse(lines[2])).toEqual({ id: 2, error: "retry" });
  });
  it("preserves UTF-8 characters split between arbitrary byte chunks", () => {
    const expected = { id: 3, result: "Caf\u00e9 \ud83d\udcc8" }; const values: unknown[] = [];
    const write = createJsonLineReader(line => values.push(JSON.parse(line)));
    for (const byte of Buffer.from(JSON.stringify(expected) + "\n")) write(Buffer.from([byte]));
    expect(values).toEqual([expected]);
  });
  it("keeps CRLF and blank-line behavior without trimming a JSON string's own spaces", () => {
    const values: unknown[] = []; const write = createJsonLineReader(line => values.push(JSON.parse(line)));
    write(Buffer.from(' \r')); write(Buffer.from('\n\n  {"result":"  source wording  "}\r')); write(Buffer.from('\n'));
    expect(values).toEqual([{ result: "  source wording  " }]);
  });
  it("does not publish an incomplete reply, and can recover after a malformed complete line", () => {
    const values: unknown[] = []; const write = createJsonLineReader(line => { try { values.push(JSON.parse(line)); } catch { /* The worker ignores non-protocol output. */ } });
    write(Buffer.from('not json\n{"id":4,"result":'));
    expect(values).toEqual([]); write(Buffer.from('true}\n'));
    expect(values).toEqual([{ id: 4, result: true }]);
  });
  it("delivers a large fragmented reply exactly once without retaining an old fragment", () => {
    const expected = { id: 5, result: "source".repeat(50_000) }; const values: unknown[] = [];
    const write = createJsonLineReader(line => values.push(JSON.parse(line)));
    const bytes = Buffer.from(JSON.stringify(expected) + '\n{"id":6,"result":0}\n');
    for (let i = 0; i < bytes.length; i += 257) write(bytes.subarray(i, i + 257));
    expect(values).toEqual([expected, { id: 6, result: 0 }]);
  });
});
