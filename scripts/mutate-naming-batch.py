#!/usr/bin/env python3
"""Mutation check for the per-book filename / MOBI chapter / add-modal timeout fixes.

Same contract as the previous batches: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero, because a build error is not evidence that
anything covers the fix.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/PerBookFileNaming.test.mjs"

TARGETS = {
    "modal": ROOT / "src/ui/shelf/BookInfoModal.ts",
    "mobi": ROOT / "src/adapters/text/MobiBookReader.ts",
    "add": ROOT / "src/ui/shelf/AddToLibraryModal.ts",
    "writer": ROOT / "src/adapters/obsidian/ObsidianLibraryWriter.ts",
}

# (label, file key, old, new, expected count)
MUTATIONS = [
    (
        "M47 modal goes back to bookId.slice(0, 8)",
        "modal",
        "const bookFileStem = (title: string, bookId: string): string =>\n  `${sanitizeFileBase(title)}-${bookIdTag(bookId)}`;",
        "const bookFileStem = (title: string, bookId: string): string =>\n  `${sanitizeFileBase(title)}-${bookId.slice(0, 8)}`;",
        1,
    ),
    (
        "M48 modal grows a private copy of the sanitizer again",
        "modal",
        'import { bookIdTag, sanitizeFileBase } from "../../adapters/obsidian/ObsidianLibraryWriter";',
        'import { bookIdTag, sanitizeFileBase } from "../../adapters/obsidian/ObsidianLibraryWriter";\n'
        "const sanitizeWikiTitle = (raw: string): string => sanitizeFileBase(raw).toUpperCase();",
        1,
    ),
    (
        "M49 bookIdTag stops hashing and slices again",
        "writer",
        'export const bookIdTag = (bookId: BookId): string =>\n  hexFromBuffer(sha1Bytes(new TextEncoder().encode(bookId))).slice(0, 10);',
        'export const bookIdTag = (bookId: BookId): string => bookId.slice(0, 10);',
        1,
    ),
    (
        "M50 MOBI drops the chapterTitle back-fill",
        "mobi",
        "  for (const [pageIdx, label] of spineIdToChapterLabel) {\n"
        "    const page = pages[pageIdx];\n"
        "    if (page) (page as { chapterTitle?: string }).chapterTitle = label;\n"
        "  }",
        "  void spineIdToChapterLabel;",
        1,
    ),
    (
        "M51 MOBI drops the carry-forward for pages before the first TOC entry",
        "mobi",
        "    } else if (carried) {\n"
        "      (page as { chapterTitle?: string }).chapterTitle = carried;\n"
        "    }",
        "    }",
        1,
    ),
    (
        "M52 add-modal gates the cover phase on the shared cross-phase flag again",
        "add",
        '      deadline = Date.now() + timeoutMs;\n      await this.raceWithTimeout(this.extractCoversFor(books), timeoutMs, "confirmSelection.extractCoversFor");\n      if (phaseExpired()) throw new Error("extractCoversFor 超时");',
        '      await this.raceWithTimeout(this.extractCoversFor(books), timeoutMs, "confirmSelection.extractCoversFor");\n      if (timedOut) throw new Error("extractCoversFor 超时");',
        1,
    ),
    (
        "M53 add-modal drops the per-phase reset in confirmAddAll",
        "add",
        '      deadline = Date.now() + timeoutMs;\n      await this.raceWithTimeout(this.extractCoversFor(newlyAdded), timeoutMs, "confirmAddAll.extractCoversFor");',
        '      await this.raceWithTimeout(this.extractCoversFor(newlyAdded), timeoutMs, "confirmAddAll.extractCoversFor");',
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