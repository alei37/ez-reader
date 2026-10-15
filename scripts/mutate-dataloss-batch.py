#!/usr/bin/env python3
"""Mutation check for the data-loss fixes (group A).

  - ReadingState read-modify-write is atomic
  - mutate() does not advance the cache before saveData confirms
  - cover file names are hashed, not character-folded

Same contract as every previous batch: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/ReadingStateAtomicity.test.mjs"

TARGETS = {
    "reading": ROOT / "src/core/services/ReadingService.ts",
    "store": ROOT / "src/adapters/obsidian/ObsidianAnnotationStore.ts",
    "cover": ROOT / "src/adapters/obsidian/CoverCache.ts",
}

MUTATIONS = [
    # --- atomic ReadingState -------------------------------------------------
    (
        "M63 addReadingTime goes back to read-then-upsert",
        "reading",
        "    if (deltaMs <= 0) return this.getState(bookId);\n    return this.patchState(bookId, (state) => ({\n      ...state,\n      totalReadingMs: (state.totalReadingMs ?? 0) + deltaMs\n    }));",
        "    if (deltaMs <= 0) return this.getState(bookId);\n    const state = await this.getState(bookId);\n    await this.annotations.upsertReading({ ...state, totalReadingMs: (state.totalReadingMs ?? 0) + deltaMs });\n    return this.getState(bookId);",
        1,
    ),
    (
        "M64 updatePosition goes back to read-then-upsert",
        "reading",
        "    const next = await this.patchState(bookId, (state) => ({\n      ...state,\n      position,\n      status: inferStatus(state.status, fraction)\n    }));",
        "    const state = await this.getState(bookId);\n    const next: ReadingState = { ...state, position, status: inferStatus(state.status, fraction) };\n    await this.annotations.upsertReading(next);",
        1,
    ),
    (
        "M65 patchState ignores the in-chain value and reseeds from defaults",
        "reading",
        "      const base = current ?? defaultReadingState(bookId, now);",
        "      const base = defaultReadingState(bookId, now);",
        1,
    ),
    # --- mutate() cache ordering --------------------------------------------
    (
        "M66 mutate advances the cache before saveData again",
        "store",
        "      if (snapshot === this.cache) return;\n      await this.plugin.saveData(snapshot);\n      this.cache = snapshot;",
        "      this.cache = snapshot;\n      await this.plugin.saveData(snapshot);",
        1,
    ),
    (
        "M67 mutate no longer skips a no-op patch",
        "store",
        "      if (snapshot === this.cache) return;\n",
        "",
        1,
    ),
    (
        "M68 patchReading writes even when the patch returns null",
        "store",
        "      const next = patch(current);\n      if (next === null) return snapshot;",
        "      const next = patch(current) ?? current;\n      if (next === null) return snapshot;",
        1,
    ),
    # --- cover file names ----------------------------------------------------
    (
        "M69 cover stem goes back to per-character folding",
        "cover",
        "const coverFileStem = (bookId: string): string => bookIdTag(bookId);",
        'const coverFileStem = (bookId: string): string => bookId.replace(/[^A-Za-z0-9._-]/g, "_");',
        1,
    ),
    (
        "M70 cover stem truncates to a shared path prefix",
        "cover",
        "const coverFileStem = (bookId: string): string => bookIdTag(bookId);",
        "const coverFileStem = (bookId: string): string => bookId.replace(/[^A-Za-z0-9._-]/g, \"_\").slice(0, 10);",
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