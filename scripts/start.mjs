import { createServer } from "vite-plus";
import { spawn } from "node:child_process";
import electron from "electron";
import { existsSync } from "node:fs";

const dev = process.argv.includes("--dev");
if (!dev && !existsSync(new URL("../dist/index.html", import.meta.url))) {
  console.error("Run pnpm build before pnpm start.");
  process.exit(1);
}
const server = dev ? await createServer() : null;
if (server) {
  await server.listen();
  server.printUrls();
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
if (server) env.ELECTRON_RENDERER_URL = server.resolvedUrls.local[0];
const child = spawn(electron, ["."], { stdio: "inherit", env });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server?.close();
  process.exit(code);
}
child.on("exit", (code) => void stop(code ?? 0));
child.on("error", (error) => {
  console.error(error);
  void stop(1);
});
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
