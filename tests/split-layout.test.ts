import { describe, expect, it } from "vite-plus/test";
import { dividerRatio, dropZone, paneNames, splitGrid } from "../src/split-layout";

describe("split pane layout", () => {
  it("names panes by their place on the screen", () => {
    expect(paneNames("columns", 2)).toEqual(["left", "right"]);
    expect(paneNames("columns", 3)).toEqual(["left", "middle", "right"]);
    expect(paneNames("rows", 2)).toEqual(["top", "bottom"]);
    expect(paneNames("grid", 3)).toEqual(["left", "top right", "bottom right"]);
    expect(paneNames("grid", 4)).toEqual(["top left", "top right", "bottom left", "bottom right"]);
    expect(new Set(paneNames("columns", 4)).size).toBe(4);
    expect(new Set(paneNames("rows", 4)).size).toBe(4);
  });

  it("places panes and dividers on alternating grid tracks", () => {
    expect(
      splitGrid({ tabIds: [1, 2], layout: "columns", columns: [0.6, 0.4], rows: [1] }),
    ).toEqual({
      columns: "minmax(0, 0.6fr) var(--split-divider-width) minmax(0, 0.4fr)",
      rows: "minmax(0, 1fr)",
      panes: ["1 / 1 / 2 / 2", "1 / 3 / 2 / 4"],
      dividers: [{ axis: "columns", index: 0, area: "1 / 2 / -1 / 3" }],
    });
    const grid = splitGrid({
      tabIds: [1, 2, 3],
      layout: "grid",
      columns: [0.5, 0.5],
      rows: [0.5, 0.5],
    });
    expect(grid.panes).toEqual(["1 / 1 / 4 / 2", "1 / 3 / 2 / 4", "3 / 3 / 4 / 4"]);
    expect(grid.dividers).toEqual([
      { axis: "columns", index: 0, area: "1 / 2 / -1 / 3" },
      { axis: "rows", index: 0, area: "2 / 3 / 3 / 4" },
    ]);
    expect(
      splitGrid({ tabIds: [1, 2, 3, 4], layout: "grid", columns: [0.5, 0.5], rows: [0.5, 0.5] })
        .panes,
    ).toEqual(["1 / 1 / 2 / 2", "1 / 3 / 2 / 4", "3 / 1 / 4 / 2", "3 / 3 / 4 / 4"]);
    expect(
      splitGrid({ tabIds: [1, 2, 3], layout: "rows", columns: [1], rows: [0.2, 0.3, 0.5] })
        .dividers,
    ).toEqual([
      { axis: "rows", index: 0, area: "2 / 1 / 3 / -1" },
      { axis: "rows", index: 1, area: "4 / 1 / 5 / -1" },
    ]);
  });

  it("turns a pointer position into the ratio of the two tracks next to a divider", () => {
    // Two 492px panes and an 8px divider: the middle of the divider is half.
    expect(dividerRatio([0.5, 0.5], 0, 496, 992, 8)).toBeCloseTo(0.5);
    // Three 328px columns: the second divider sits at 664 + 4.
    expect(dividerRatio([1 / 3, 1 / 3, 1 / 3], 1, 668, 1000, 8)).toBeCloseTo(0.5);
    expect(dividerRatio([1 / 3, 1 / 3, 1 / 3], 1, 340, 1000, 8)).toBeCloseTo(0);
  });

  it("picks the drop edge nearest to the pointer, along the split's axis", () => {
    const rect = { x: 100, y: 50, width: 400, height: 200 };
    // No split: any edge, and the zone is that half of the page.
    expect(dropZone(null, rect, 120, 150, false)).toEqual({
      edge: "left",
      x: 100,
      y: 50,
      width: 200,
      height: 200,
    });
    expect(dropZone(null, rect, 300, 60, false)).toMatchObject({ edge: "top", height: 100 });
    expect(dropZone(null, rect, 300, 240, false)).toMatchObject({ edge: "bottom", y: 150 });
    expect(dropZone(null, rect, 490, 60, false)).toMatchObject({ edge: "right", x: 300 });
    // Columns take only left or right, rows only top or bottom.
    expect(dropZone("columns", rect, 300, 55, false)?.edge).toBe("left");
    expect(dropZone("columns", rect, 301, 55, false)?.edge).toBe("right");
    expect(dropZone("rows", rect, 105, 200, false)?.edge).toBe("bottom");
    expect(dropZone("grid", rect, 300, 245, false)?.edge).toBe("bottom");
    // A full split replaces the whole pane.
    expect(dropZone("grid", rect, 120, 150, true)).toEqual({ edge: "right", ...rect });
  });
});
