const { getDomain } = require("tldts");

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

/** The registrable domain of a URL (bbc.co.uk for news.bbc.co.uk), or its host for IPs and local names. */
function site(url) {
  try {
    const { hostname } = new URL(url);
    return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
  } catch {
    return null;
  }
}

/** @param {string} a @param {string} b */
const sameSite = (a, b) => site(a) !== null && site(a) === site(b);

module.exports = { isWebUrl, isTabId, canOpenPopup, sameSite };
