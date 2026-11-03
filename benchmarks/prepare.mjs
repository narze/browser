import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

await run("pnpm", ["exec", "vp", "build"], join(root, "benchmarks/electron"));
await run(
  process.env.BUN_BINARY || "bun",
  ["install", "--frozen-lockfile"],
  join(root, "experiments/electrobun"),
);
await run(process.env.BUN_BINARY || "bun", ["run", "build"], join(root, "experiments/electrobun"));
