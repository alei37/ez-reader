#!/usr/bin/env python3
"""Mutation check for the data-integrity batch.

  - rich metadata keeps every field through a restart
  - import confirms + backs up before the destructive write
  - setEntry drops the pending progress debounce
  - togglePin decides inside the store's write chain
  - addedDesc keys off addedToLibraryAt
  - the source watch is registered once
  - core/ no longer depends on adapters/

Same contract as every previous batch: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/DataIntegrityBatch.test.mjs"

TARGETS = {
    "metadata": ROOT / "src/core/utils/metadata.ts",
    "store": ROOT / "src/adapters/obsidian/ObsidianAnnotationStore.ts",
    "settings": ROOT / "src/ui/settings/SettingsTab.ts",
    "reader": ROOT / "src/ui/reader/ReaderView.ts",
    "library": ROOT / "src/core/services/LibraryService.ts",
}

MUTATIONS = [
    (
        "M71 sanitize drops optional string fields again",
        "metadata",
        "  return {\n    title: String(input.title).trim(),\n    authors: stringArray(input.authors),\n    languages: locales(input.languages),\n    cachedAt: cachedAt(input.cachedAt),",
        "  return {\n    title: String(input.title).trim(),\n    authors: stringArray(input.authors),\n    languages: [],\n    cachedAt: cachedAt(input.cachedAt),",
        1,
    ),
    (
        "M72 sanitize drops publisher / published / identifier / description",
        "metadata",
        "    ...(optionalString(input.publisher) !== undefined\n      ? { publisher: optionalString(input.publisher) }\n      : {}),",
        "",
        1,
    ),
    (
        "M73 sanitize stops passing unknown fields through",
        "metadata",
        "  const extras: Record<string, unknown> = {};\n  for (const [key, value] of Object.entries(input)) {\n    if (known.has(key) || value === undefined) continue;\n    extras[key] = value;\n  }",
        "  const extras: Record<string, unknown> = {};",
        1,
    ),
    (
        "M74 sanitize trusts a corrupt cachedAt",
        "metadata",
        "  typeof value === \"number\" && Number.isFinite(value) && value > 0 ? value : Date.now();",
        "  typeof value === \"number\" ? value : 0;",
        1,
    ),
    (
        "M75 import's cancel branch becomes unreachable",
        "settings",
        "        if (!ok) {\n          new Notice(\"已取消导入\");\n          return;\n        }",
        "        if (false) {\n          new Notice(\"已取消导入\");\n          return;\n        }",
        1,
    ),
    (
        "M76 import skips the backup",
        "settings",
        "        await this.backupCurrentData();\n",
        "",
        1,
    ),
    (
        "M77 setEntry leaves the progress debounce armed",
        "reader",
        "    if (this.persistProgressTimer !== undefined) {\n      window.clearTimeout(this.persistProgressTimer);\n      this.persistProgressTimer = undefined;\n    }\n    this.persistProgressPending = undefined;\n",
        "",
        1,
    ),
    (
        "M78 togglePin decides from the stale in-memory entry again",
        "library",
        "    await this.annotations.patchPinnedAt(bookId, (current) => {\n      nextPinnedAt = current === null ? now : null;\n      return nextPinnedAt;\n    });",
        "    const entry = this.entries.get(bookId);\n    nextPinnedAt = entry?.book.pinnedAt == null ? now : null;\n    await this.annotations.patchPinnedAt(bookId, () => nextPinnedAt);",
        1,
    ),
    (
        "M79 addedDesc goes back to sorting by file mtime",
        "library",
        "      return (\n        (b.book.addedToLibraryAt ?? 0) - (a.book.addedToLibraryAt ?? 0)\n      );",
        "      return b.book.sourceModifiedAt - a.book.sourceModifiedAt;",
        1,
    ),
    (
        "M80 initialize guards on entries.size again",
        "library",
        "    if (this.initialized) return;",
        "    if (this.entries.size > 0) return;",
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
                print(f"{name:<58} PATTERN-MISS (matched {count}x, expected {expected})")
                inconclusive.append(f"{name}: matched {count}x, expected {expected}")
                continue

            path.write_text(original.replace(old, new, expected), encoding="utf-8")

            build = subprocess.run(BUILD, cwd=ROOT, capture_output=True, text=True)
            if build.returncode != 0:
                print(f"{name:<58} INCONCLUSIVE (build failed)")
                tail = (build.stderr or build.stdout).strip().splitlines()
                if tail:
                    print("    " + tail[-1][:150])
                inconclusive.append(f"{name}: build failed, not an assertion")
                path.write_text(original, encoding="utf-8")
                continue

            proc = subprocess.run(["node", "--test", TEST], cwd=ROOT, capture_output=True, text=True)
            output = proc.stdout + proc.stderr
            if fail_count(output) > 0:
                print(f"{name:<58} DETECTED ({fail_count(output)} failing)")
                detected += 1
            else:
                print(f"{name:<58} NOT DETECTED")
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