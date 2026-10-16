import { afterEach, describe, expect, it } from "vitest";
import { displayDay, displayUtcMinute } from "../displayDate";

// The upload date in the Import data list is rendered on the server and again in the browser. The
// two runtimes can have different time zones and locales; the text must not depend on either.
const ZONES = ["UTC", "Africa/Johannesburg", "America/Los_Angeles", "Pacific/Kiritimati"];
const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

describe("displayDay", () => {
  it("writes the same text in every time zone, including just before UTC midnight", () => {
    for (const iso of ["2026-10-16T14:03:00Z", "2026-10-16T23:30:00Z", "2026-10-16T00:10:00+02:00"]) {
      const seen = new Set<string>();
      for (const zone of ZONES) {
        process.env.TZ = zone;
        seen.add(displayDay(iso));
      }
      expect([...seen], iso).toHaveLength(1);
    }
    expect(displayDay("2026-10-16T23:30:00Z")).toBe("16 Oct 2026");
    // 00:10 in Johannesburg is still the previous UTC day: the documented cost of a fixed zone.
    expect(displayDay("2026-10-16T00:10:00+02:00")).toBe("15 Oct 2026");
  });

  it("reproduces why the old rendering mismatched: the zone alone changes the local day", () => {
    const iso = "2026-10-16T23:30:00Z";
    process.env.TZ = "UTC";
    const server = new Date(iso).toLocaleDateString("en-US");
    process.env.TZ = "Pacific/Kiritimati";
    const browser = new Date(iso).toLocaleDateString("en-US");
    expect(server).not.toBe(browser);
    expect(displayDay(iso)).toBe("16 Oct 2026");
  });

  it("says the date is unknown rather than writing Invalid Date", () => {
    expect(displayDay("not a date")).toBe("Date unknown");
    expect(displayUtcMinute("")).toBe("Date unknown");
  });
});

describe("displayUtcMinute", () => {
  it("gives the exact UTC minute whatever the zone", () => {
    process.env.TZ = "Pacific/Kiritimati";
    expect(displayUtcMinute("2026-10-16T14:03:27.123Z")).toBe("2026-10-16 14:03 UTC");
  });
});
