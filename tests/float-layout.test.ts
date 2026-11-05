import { describe, expect, it } from "vite-plus/test";
import { peekLayout } from "../shared/float-layout.js";

describe("peek layout", () => {
  it("centers a card with the page under its header", () => {
    expect(peekLayout(1280, 850)).toEqual({
      card: { x: 90, y: 43, width: 1100, height: 764 },
      page: { x: 96, y: 87, width: 1088, height: 714 },
    });
  });

  it("keeps a margin around the card in a small window", () => {
    const { card, page } = peekLayout(640, 420);
    expect(card).toEqual({ x: 38, y: 24, width: 564, height: 372 });
    expect(page.x + page.width).toBe(card.x + card.width - 6);
    expect(page.y + page.height).toBe(card.y + card.height - 6);
  });

  it("never gives a negative size", () => {
    const { card, page } = peekLayout(20, 20);
    expect(Math.min(card.width, card.height, page.width, page.height)).toBe(0);
  });
});
