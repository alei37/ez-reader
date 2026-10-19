#!/usr/bin/env python3
"""Mutation check for the v0.3.3 architecture batch.

  - ReaderView persists which book a leaf shows (getState / setState)
  - findReaderLeafForBook trusts the live view over the stale layout
  - openReader reuses an already-open leaf instead of always spawning one
  - readerOpenMode is actually read
  - onunload tears every PdfOverlay down

Same contract as every previous batch: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/ReaderStatePersistence.test.mjs"

TARGETS = {
    "reader": ROOT / "src/ui/reader/ReaderView.ts",
    "plugin": ROOT / "src/Plugin.ts",
    "leafstate": ROOT / "src/ui/reader/readerLeafState.ts",
}

MUTATIONS = [
    (
        "M81 buildReaderViewState leaks undefined instead of an empty string",
        "reader",
        "  file: input.bookId ?? \"\",",
        "  file: input.bookId as string,",
        1,
    ),
    (
        "M82 parseReaderViewState stops rejecting a non-string file",
        "reader",
        "  if (typeof candidate.file !== \"string\") return null;",
        "  if (typeof candidate.file !== \"string\") return { file: String(candidate.file) };",
        1,
    ),
    (
        "M83 parseReaderViewState accepts any truthy immersive value",
        "reader",
        "    immersive: candidate.immersive === true ? true : undefined",
        "    immersive: candidate.immersive ? true : undefined",
        1,
    ),
    (
        "M84 setState stops waiting for the host",
        "reader",
        "    await this.whenHostReady();",
        "    void 0;",
        1,
    ),
    (
        "M85 onClose stops re-arming the host-ready signal",
        "reader",
        "    this.hostReadyPromise = undefined;\n    this.hostReadyResolve = undefined;",
        "    void 0;\n    void 0;",
        1,
    ),
    (
        "M86 setState pushes an empty reader onto the nav history",
        "reader",
        "    result.history = false;",
        "    result.history = true;",
        1,
    ),
    (
        "M87 findReaderLeafForBook trusts the stale layout over the live view",
        "leafstate",
        "  if (typeof viewBookId === \"string\" && viewBookId.length > 0) {\n    return viewBookId === bookId;\n  }\n  if (!layoutState || typeof layoutState !== \"object\" || Array.isArray(layoutState)) return false;\n  const file = (layoutState as { file?: unknown }).file;\n  return typeof file === \"string\" && file === bookId;",
        "  if (layoutState && typeof layoutState === \"object\" && !Array.isArray(layoutState)) {\n    const file = (layoutState as { file?: unknown }).file;\n    if (typeof file === \"string\" && file === bookId) return true;\n  }\n  return typeof viewBookId === \"string\" && viewBookId.length > 0 && viewBookId === bookId;",
        1,
    ),
    (
        "M88 openReader always spawns a fresh tab again",
        "plugin",
        "    const reusable = this.findReaderLeafForBook(entry.book.id);\n    if (reusable) {",
        "    const reusable = null as WorkspaceLeaf | null;\n    if (reusable) {",
        1,
    ),
    (
        "M89 readerOpenMode goes back to being a decorative setting",
        "plugin",
        "    const leaf = this.app.workspace.getLeaf(mode === \"window\" ? \"window\" : \"tab\");",
        "    const leaf = this.app.workspace.getLeaf(\"tab\");",
        1,
    ),
    (
        "M90 onunload stops tearing the PDF overlays down",
        "plugin",
        "        unmountAllPdfOverlays();",
        "        void 0;",
        1,
    ),
    (
        "M91 onunload's overlay teardown loses its catch",
        "plugin",
        "      .catch(() => {",
        "      .then(() => {",
        1,
    ),
    (
        "M92 the protocol fallback grabs an unrelated reader leaf again",
        "plugin",
        "        const leaf = this.findReaderLeafForBook(bookId);\n        if (leaf?.view instanceof ReaderView) {\n          await this.withTimeout(leaf.view.openExcerptById(excerptId), 30000, \"openExcerptById\");\n        } else {",
        "        const leaf = this.findReaderLeafForBook(bookId) ?? this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)[0];\n        if (leaf?.view instanceof ReaderView) {\n          await this.withTimeout(leaf.view.openExcerptById(excerptId), 30000, \"openExcerptById\");\n        } else {",
        1,
    ),
]

BUILD = ["node", "esbuild.tests.config.mjs"]


def fail_count(output: str) -> int:
    for line in output.splitlines():
        if line.startswith("ℹ fail ") or line.startswith("# fail "):
            try:
                return int(line.split()[-1])
            except ValueError:
                pass
    return 0


def main() -> int:
    backups = {k: p.read_text(encoding="utf-8") for k, p in TARGETS.items()}
    inconclusive: list[str] = []
    detected = 0

    try:
        for name, key, old, new, expected in MUTATIONS:
            path = TARGETS[key]
            original = backups[key]
            count = original.count(old)
            if count != expected:
                print(f"{name:<62} PATTERN-MISS (matched {count}x, expected {expected})")
                inconclusive.append(f"{name}: matched {count}x, expected {expected}")
                continue

            path.write_text(original.replace(old, new, expected), encoding="utf-8")

            build = subprocess.run(BUILD, cwd=ROOT, capture_output=True, text=True)
            if build.returncode != 0:
                print(f"{name:<62} INCONCLUSIVE (build failed)")
                tail = (build.stderr or build.stdout).strip().splitlines()
                if tail:
                    print("    " + tail[-1][:150])
                inconclusive.append(f"{name}: build failed, not an assertion")
                path.write_text(original, encoding="utf-8")
                continue

            proc = subprocess.run(["node", "--test", TEST], cwd=ROOT, capture_output=True, text=True)
            output = proc.stdout + proc.stderr
            if fail_count(output) > 0:
                print(f"{name:<62} DETECTED ({fail_count(output)} failing)")
                detected += 1
            else:
                print(f"{name:<62} NOT DETECTED")
                inconclusive.append(f"{name}: no test failed")

            path.write_text(original, encoding="utf-8")
    finally:
        for key, path in TARGETS.items():
            path.write_text(backups[key], encoding="utf-8")

    total = len(MUTATIONS)
    print(f"\n{detected}/{total} mutations detected by test assertion")
    if inconclusive:
        print("\nINCONCLUSIVE / MISSED:")
        for item in inconclusive:
            print(f"  - {item}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
