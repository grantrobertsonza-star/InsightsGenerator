// The floating Research assistant window keeps inside the browser window wherever it is dragged or
// however it is resized (components/movableWindow.ts): size between the minimum and the viewport
// less 8px each side, position at least 8px from each edge, and the default frame on the right.
import { describe, expect, it } from "vitest";
import { clampFrame, defaultFrame, MIN_SIZE } from "../../components/movableWindow";

const view = { width: 1440, height: 900 };

describe("the assistant window frame", () => {
  it("opens 380 wide, up to 560 tall, 20 from the right and 80 from the top", () => {
    expect(defaultFrame(view)).toEqual({ right: 20, top: 80, width: 380, height: 560 });
    // A short browser window: the height leaves room (viewport less 96), never below the minimum.
    expect(defaultFrame({ width: 1440, height: 600 }).height).toBe(504);
    expect(defaultFrame({ width: 1440, height: 300 }).height).toBe(MIN_SIZE.height);
  });
  it("leaves a frame inside the window alone", () => {
    const f = { right: 500, top: 200, width: 500, height: 400 };
    expect(clampFrame(f, view)).toEqual(f);
  });
  it("keeps a window dragged past an edge 8px inside it", () => {
    expect(clampFrame({ right: -200, top: -50, width: 380, height: 560 }, view)).toMatchObject({ right: 8, top: 8 });
    expect(clampFrame({ right: 5000, top: 5000, width: 380, height: 560 }, view)).toMatchObject({ right: 1440 - 380 - 8, top: 900 - 560 - 8 });
  });
  it("resizing stops at the minimum and at the viewport, and the position follows to stay inside", () => {
    expect(clampFrame({ right: 20, top: 80, width: 50, height: 50 }, view)).toMatchObject({ width: MIN_SIZE.width, height: MIN_SIZE.height });
    // Grown past the viewport: at most the viewport less 8px each side, pinned 8px in.
    expect(clampFrame({ right: 20, top: 80, width: 5000, height: 5000 }, view)).toEqual({ right: 8, top: 8, width: 1440 - 16, height: 900 - 16 });
    // Grown downwards from a low position: the top moves up so the bottom stays inside.
    expect(clampFrame({ right: 20, top: 600, width: 380, height: 500 }, view)).toMatchObject({ top: 900 - 500 - 8, height: 500 });
  });
});
