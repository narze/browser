import { describe, expect, it } from "vite-plus/test";
import { normalizePageLayout } from "../electron/page-layout.cjs";

describe("measured page layout", () => {
  it("rounds rectangle edges and clips content to the native viewport", () => {
    expect(
      normalizePageLayout(
        [
          { id: 1, bounds: { x: -5, y: -10, width: 100, height: 100 } },
          { id: 2, bounds: { x: 70.4, y: 20.6, width: 80, height: 100 } },
        ],
        120,
        90,
      ),
    ).toEqual([
      { id: 1, bounds: { x: 0, y: 0, width: 95, height: 90 } },
      { id: 2, bounds: { x: 70, y: 21, width: 50, height: 69 } },
    ]);
  });
  it("allows empty reports and zero-area hidden page regions", () => {
    expect(normalizePageLayout([], 640, 420)).toEqual([]);
    expect(
      normalizePageLayout([{ id: 1, bounds: { x: 800, y: 800, width: 50, height: 50 } }], 640, 420),
    ).toEqual([{ id: 1, bounds: { x: 640, y: 420, width: 0, height: 0 } }]);
  });
  it.each([
    null,
    {},
    [null],
    [{ id: -1, bounds: {} }],
    [{ id: 1, bounds: { x: 0, y: 0, width: NaN, height: 1 } }],
    [{ id: 1, bounds: { x: 0, y: 0, width: 10, height: -1 } }],
    [{ id: 1, bounds: { x: Infinity, y: 0, width: 10, height: 1 } }],
    [1, 1].map((id) => ({ id, bounds: { x: 0, y: 0, width: 10, height: 10 } })),
    [1, 2, 3, 4, 5].map((id) => ({ id, bounds: { x: 0, y: 0, width: 10, height: 10 } })),
  ])("rejects malformed or ambiguous reports: %j", (report) => {
    expect(() => normalizePageLayout(report, 640, 420)).toThrow();
  });
  it("accepts one region for each of up to four split panes", () => {
    const report = [1, 2, 3, 4].map((id) => ({
      id,
      bounds: { x: (id - 1) * 10, y: 0, width: 10, height: 10 },
    }));
    expect(normalizePageLayout(report, 640, 420)).toEqual(report);
  });
});
