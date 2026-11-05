// @ts-check
// Geometry of the pages outside the tab list. The main process places the native
// page views with it, and the trusted views draw their frames around the same rects.

/** Height of the quick window's toolbar, above its page. */
export const QUICK_TOOLBAR_HEIGHT = 44;
/** Height of the peek card's header, and the card's border around its page. */
export const PEEK_HEADER_HEIGHT = 44;
export const PEEK_INSET = 6;

/**
 * The peek card, centered in a window, and the page inside it.
 * @param {number} width @param {number} height
 */
export function peekLayout(width, height) {
  const marginX = Math.max(24, Math.round(width * 0.06));
  const marginY = Math.max(24, Math.round(height * 0.05));
  const cardWidth = Math.max(0, Math.min(1100, width - 2 * marginX));
  const card = {
    x: Math.round((width - cardWidth) / 2),
    y: marginY,
    width: cardWidth,
    height: Math.max(0, height - 2 * marginY),
  };
  const page = {
    x: card.x + PEEK_INSET,
    y: card.y + PEEK_HEADER_HEIGHT,
    width: Math.max(0, card.width - 2 * PEEK_INSET),
    height: Math.max(0, card.height - PEEK_HEADER_HEIGHT - PEEK_INSET),
  };
  return { card, page };
}
