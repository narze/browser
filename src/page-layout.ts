import type { PageRegion } from "../shared/browser";

// Measure the actual page regions, including CSS, borders, rails, and split toolbars.
export function observePageLayout(
  root: HTMLElement,
  report: (regions: PageRegion[]) => Promise<void>,
) {
  const elements = root.matches("[data-page-id]")
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>("[data-page-id]"));
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const regions = elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { id: Number(element.dataset.pageId), bounds: { x, y, width, height } };
      });
      void report(regions);
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  elements.forEach((element) => observer.observe(element));
  schedule();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
