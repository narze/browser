const { isTabId } = require("./policy.cjs");

/**
 * @param {unknown} report
 * @param {number} width
 * @param {number} height
 * @returns {import('../shared/browser').PageRegion[]}
 */
function normalizePageLayout(report, width, height) {
  if (!Array.isArray(report) || report.length > 2) throw new Error("Invalid page layout.");
  const ids = new Set();
  return report.map((region) => {
    const bounds = region?.bounds;
    if (
      !isTabId(region?.id) ||
      ids.has(region.id) ||
      !bounds ||
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ||
      bounds.width < 0 ||
      bounds.height < 0
    )
      throw new Error("Invalid page layout.");
    ids.add(region.id);
    const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
    const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
    const right = Math.max(x, Math.min(width, Math.round(bounds.x + bounds.width)));
    const bottom = Math.max(y, Math.min(height, Math.round(bounds.y + bounds.height)));
    return { id: region.id, bounds: { x, y, width: right - x, height: bottom - y } };
  });
}

module.exports = { normalizePageLayout };
