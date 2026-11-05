import type { BrowserApi, PageSnapshot } from "../shared/browser";

/** The tab that is being dragged, and still images of the pages it can split. */
export const tabDrag = $state<{ id: number | null; snapshots: PageSnapshot[] }>({
  id: null,
  snapshots: [],
});
let drag = 0;

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Native pages sit above the chrome and would hide its drop zones. The chrome shows
 * still images of the pages first, then hides the real pages for the drag.
 */
export async function beginTabDrag(api: BrowserApi, id: number) {
  const current = ++drag;
  tabDrag.id = id;
  tabDrag.snapshots = [];
  const snapshots = await api.capturePages().catch(() => []);
  await Promise.all(
    snapshots.map((snapshot) => {
      const image = new Image();
      image.src = snapshot.image;
      return image.decode().catch(() => {});
    }),
  );
  if (current !== drag) return;
  tabDrag.snapshots = snapshots;
  await frame();
  await frame();
  if (current === drag) await api.setTabDragging(true);
}

export function endTabDrag(api: BrowserApi) {
  if (tabDrag.id === null) return;
  drag++;
  tabDrag.id = null;
  tabDrag.snapshots = [];
  void api.setTabDragging(false);
}
