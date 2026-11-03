/** @param {unknown} value */
function isWebUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** @param {unknown} value */
const isTabId = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** @param {number} lastOpenedAt
 * @param {number} now */
const canOpenPopup = (lastOpenedAt, now) => now - lastOpenedAt >= 750;

module.exports = { isWebUrl, isTabId, canOpenPopup };
