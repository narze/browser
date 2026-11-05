import type { BrowserState, SplitLayout } from "../shared/browser";

type Split = NonNullable<BrowserState["split"]>;

const NAMES: Record<SplitLayout, string[][]> = {
  columns: [
    [],
    [],
    ["left", "right"],
    ["left", "middle", "right"],
    ["far left", "center left", "center right", "far right"],
  ],
  rows: [
    [],
    [],
    ["top", "bottom"],
    ["top", "middle", "bottom"],
    ["top", "upper middle", "lower middle", "bottom"],
  ],
  grid: [
    [],
    [],
    ["left", "right"],
    ["left", "top right", "bottom right"],
    ["top left", "top right", "bottom left", "bottom right"],
  ],
};

/** Pane names for labels, in pane order. */
export function paneNames(layout: SplitLayout, count: number) {
  return NAMES[layout][count] ?? [];
}

const tracks = (sizes: number[]) =>
  sizes.map((size) => `minmax(0, ${size}fr)`).join(" var(--split-divider-width) ");

/**
 * CSS grid placement: panes sit on odd tracks and dividers on even tracks.
 * Areas are "row-start / column-start / row-end / column-end".
 */
export function splitGrid(split: Split) {
  const count = split.tabIds.length;
  const area = (row: number, column: number, rowEnd = row + 1, columnEnd = column + 1) =>
    `${row} / ${column} / ${rowEnd} / ${columnEnd}`;
  const panes = split.tabIds.map((_, index) => {
    if (split.layout === "columns") return area(1, 2 * index + 1);
    if (split.layout === "rows") return area(2 * index + 1, 1);
    // A grid of three gives the first pane the whole left column.
    if (count === 3) return index === 0 ? area(1, 1, 4) : area(2 * index - 1, 3);
    return area(2 * Math.floor(index / 2) + 1, 2 * (index % 2) + 1);
  });
  const dividers = [
    ...split.columns.slice(1).map((_, index) => ({
      axis: "columns" as const,
      index,
      area: area(1, 2 * index + 2, -1),
    })),
    ...split.rows.slice(1).map((_, index) => ({
      axis: "rows" as const,
      index,
      area:
        split.layout === "grid" && count === 3
          ? area(2 * index + 2, 3)
          : area(2 * index + 2, 1, 2 * index + 3, -1),
    })),
  ];
  return { columns: tracks(split.columns), rows: tracks(split.rows), panes, dividers };
}

/**
 * The share of the two tracks next to divider `index` that goes before a pointer
 * at `position` pixels from the start of the workspace.
 */
export function dividerRatio(
  sizes: number[],
  index: number,
  position: number,
  total: number,
  gap: number,
) {
  const available = total - (sizes.length - 1) * gap;
  const before = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
  const start = before * available + index * gap;
  return (position - start - gap / 2) / ((sizes[index] + sizes[index + 1]) * available);
}
