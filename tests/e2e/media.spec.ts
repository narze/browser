import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A video with a quiet tone, made in the page so the test needs no media files.
const VIDEO = `<title>Video</title><video width="320" height="180"></video><script>
const canvas = Object.assign(document.createElement("canvas"), { width: 320, height: 180 });
const context = canvas.getContext("2d");
let frame = 0;
setInterval(() => {
  context.fillStyle = "hsl(" + ((frame++ * 4) % 360) + " 70% 50%)";
  context.fillRect(0, 0, 320, 180);
}, 40);
const audio = new AudioContext();
const tone = audio.createOscillator();
const gain = audio.createGain();
gain.gain.value = 0.01;
const output = audio.createMediaStreamDestination();
tone.connect(gain).connect(output);
tone.start();
const video = document.querySelector("video");
video.srcObject = new MediaStream([
  ...canvas.captureStream(25).getVideoTracks(),
  ...output.stream.getAudioTracks(),
]);
video.play();
</script>`;

test("media controls in the sidebar and auto picture in picture (D5)", async () => {
  const profile = await mkdtemp(join(tmpdir(), "browser-media-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(request.url === "/video" ? VIDEO : `<title>Page ${request.url}</title>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
    ),
  );
  const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
  try {
    const chrome = await app.firstWindow();
    const state = () => chrome.evaluate(() => window.browser!.getState());
    const address = chrome.getByRole("textbox", { name: "Search or enter address" });
    const go = async (path: string) => {
      await address.fill(origin + path);
      await address.press("Enter");
    };
    const media = chrome.getByRole("region", { name: "Media" });
    const video = (code: string) =>
      app.evaluate(
        ({ webContents }, { url, code }) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === url)!
            .executeJavaScript(code),
        { url: `${origin}/video`, code },
      );
    const inPictureInPicture = () => video("!!document.pictureInPictureElement");
    await chrome.evaluate(() => window.browser!.setTabLayout("left"));

    // The tab that plays sound gets a mute button. The card hides while the tab shows.
    await go("/video");
    const videoTab = chrome.getByRole("tab", { name: "Video" });
    await expect(videoTab).toBeVisible();
    await expect(chrome.getByRole("button", { name: "Mute tab: Video" })).toBeVisible();
    await expect.poll(async () => (await state()).media[0]?.playback).toBe("playing");
    await expect(media).toBeHidden();

    // Leaving the tab moves its video to picture in picture and shows the media card.
    await chrome.getByRole("button", { name: "New tab", exact: true }).click();
    await go("/other");
    await expect(media).toBeVisible();
    await expect(media).toContainText("Video");
    await expect(media).toContainText("Playing");
    await expect.poll(inPictureInPicture).toBe(true);
    await chrome.screenshot({ path: test.info().outputPath("media-playing.png") });

    // Play/pause and mute work from the card.
    await media.getByRole("button", { name: "Pause" }).click();
    await expect(media).toContainText("Paused");
    await expect.poll(() => video("document.querySelector('video').paused")).toBe(true);
    await media.getByRole("button", { name: "Play" }).click();
    await expect(media).toContainText("Playing");
    await expect.poll(() => video("document.querySelector('video').paused")).toBe(false);
    const mute = media.getByRole("button", { name: "Mute" });
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    await expect(chrome.getByRole("button", { name: "Mute tab: Video" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(async () => (await state()).media[0]?.muted).toBe(true);
    await chrome.screenshot({ path: test.info().outputPath("media-muted.png") });
    await chrome.getByRole("button", { name: "Mute tab: Video" }).click();
    await expect(mute).toHaveAttribute("aria-pressed", "false");

    // The card opens the tab, and the video leaves picture in picture.
    await media.getByRole("button", { name: /Video/ }).click();
    await expect(videoTab).toHaveAttribute("aria-selected", "true");
    await expect(media).toBeHidden();
    await expect.poll(inPictureInPicture).toBe(false);

    // With the setting off, leaving the tab keeps the video in the page.
    await chrome.getByRole("button", { name: "Settings", exact: true }).click();
    const setting = chrome.getByRole("checkbox", { name: /Picture in picture/ });
    await expect(setting).toBeChecked();
    await setting.uncheck();
    await expect.poll(async () => (await state()).settings.autoPictureInPicture).toBe(false);
    await chrome.getByRole("button", { name: "Back to browsing" }).click();
    await chrome.getByRole("tab", { name: "Page /other" }).click();
    await expect(media).toBeVisible();
    await expect.poll(async () => (await state()).media[0]?.playback).toBe("playing");
    // A negative check: give a picture-in-picture request time to happen.
    await chrome.waitForTimeout(1000);
    expect(await inPictureInPicture()).toBe(false);
  } finally {
    await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
