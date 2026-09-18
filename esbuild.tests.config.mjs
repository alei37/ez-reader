import esbuild from "esbuild";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const stubPath = fileURLToPath(new URL("./tests/stubs/obsidian-stub.mjs", import.meta.url));

await rm("tests/dist", { recursive: true, force: true });
await esbuild.build({
  entryPoints: ["tests/core/*.test.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir: "tests/dist/core",
  outExtension: { ".js": ".mjs" },
  // Alias `obsidian` to a stub module so the test bundle resolves
  // `import { Modal } from "obsidian"` (used by ConfirmModal etc.) without
  // trying to actually load the package — obsidian is types-only and
  // doesn't ship runtime code. Tests don't call Modal methods, only
  // construct or pass `app: undefined`, so an empty default export works.
  alias: {
    "obsidian": stubPath
  },
  // Keep heavy CJS-only deps (`jsdom`, Node built-ins) external so the
  // test bundle is ESM-only. jsdom uses dynamic `require('path')` internally
  // which breaks when bundled; loading it as an external keeps its CJS
  // interop intact.
  external: ["jsdom", "path", "fs", "url", "os", "crypto", "stream", "buffer", "util", "events", "assert", "child_process"],
  logLevel: "info"
});