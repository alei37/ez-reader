import esbuild from "esbuild";
import { rm } from "node:fs/promises";

await rm("tests/dist", { recursive: true, force: true });
await esbuild.build({
  entryPoints: ["tests/core/*.test.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir: "tests/dist/core",
  outExtension: { ".js": ".mjs" },
  external: ["obsidian"],
  logLevel: "info"
});