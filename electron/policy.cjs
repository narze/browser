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

/** The last two parts of a host name, without "www.": a cheap guess at the site. */
function site(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2).join(".");
  } catch {
    return null;
  }
}

/** @param {string} a @param {string} b */
const sameSite = (a, b) => site(a) !== null && site(a) === site(b);

module.exports = { isWebUrl, isTabId, canOpenPopup, sameSite };
