// Event-only, unprivileged page metadata. Never send commands or secrets here.
export const pagePreload = `(() => {
  if (window !== window.top) return;
  const report = () => window.__electrobunSendToHost?.({
    type: 'page-metadata', url: location.href, title: document.title,
    loading: document.readyState !== 'complete'
  });
  document.addEventListener('DOMContentLoaded', () => {
    report();
    new MutationObserver(report).observe(document.head, { childList: true, subtree: true, characterData: true });
  });
  window.addEventListener('load', report);
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function(...args) { const result = original.apply(this, args); report(); return result; };
  }
})();`;
