function resolveAddress(input, searchEngine = "duckduckgo") {
  const value = input.trim();
  if (!value) return "";
  const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value);
  if (local) return new URL(`http://${value}`).href;
  if (/^https?:\/\//i.test(value)) return new URL(value).href;
  const domain = /^(?:[^\s/:]+\.)+[^\s/:]{2,}(?::\d+)?(?:[/?#]|$)/.test(value);
  if (domain) return new URL(`https://${value}`).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error("Only HTTP and HTTPS addresses are supported.");
  }
  const searchUrls = {
    duckduckgo: "https://duckduckgo.com/?q=",
    google: "https://www.google.com/search?q=",
    bing: "https://www.bing.com/search?q=",
  };
  return `${searchUrls[searchEngine] || searchUrls.duckduckgo}${encodeURIComponent(value)}`;
}

module.exports = { resolveAddress };
