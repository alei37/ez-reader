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
  // Keep `obsidian` (not available in node) AND heavy CJS-only deps
  // (`jsdom`, Node built-ins) external so the test bundle is ESM-only.
  // jsdom uses dynamic `require('path')` internally which breaks when
  // bundled; loading it as an external keeps its CJS interop intact.
  external: ["obsidian", "jsdom", "path", "fs", "url", "os", "crypto", "stream", "buffer", "util", "events", "assert", "child_process"],
  logLevel: "info"
});