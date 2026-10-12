#!/usr/bin/env python3
"""Mutation-verify the book-rename recovery path.

Each mutation reverts one fix; the matching test MUST fail by test
assertion (NOT by a build error — an imprecise mutation proves nothing and
is reported as inconclusive). Every substitution is count-limited and
anchored on a unique substring so it can't silently no-op or hit the wrong
site.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/ljl/dsh/ezreader")

SNAP = "src/core/utils/renameSnapshot.ts"
BOOKSOURCE = "src/adapters/obsidian/ObsidianBookSource.ts"
LIBSVC = "src/core/services/LibraryService.ts"
WRITER = "src/adapters/obsidian/ObsidianLibraryWriter.ts"

# (id, description, file, [(old, new, count)], test bundle)
MUTATIONS = [
    (
        "M32",
        "ObsidianBookSource.watch: emit 'modified' again instead of 'renamed'",
        BOOKSOURCE,
        [('kind: "renamed",', 'kind: "modified",', 1)],
        "BookRename",
    ),
    (
        "M33",
        "renameInSnapshot: drop the library re-key (shipped behaviour)",
        SNAP,
        [("    library,\n", "    library: snapshot.library,\n", 1)],
        "BookRename",
    ),
    (
        "M34",
        "renameInSnapshot: forget visitedTocIdsByBookId",
        SNAP,
        [
            (
                "visitedTocIdsByBookId: rekeyMap(snapshot.visitedTocIdsByBookId, fromBookId, toBookId)",
                "visitedTocIdsByBookId: snapshot.visitedTocIdsByBookId",
                1,
            )
        ],
        "BookRename",
    ),
    (
        "M35",
        "renameInSnapshot: forget excerpts",
        SNAP,
        [("excerpts: rekeyArray(snapshot.excerpts, fromBookId, toBookId),", "excerpts: snapshot.excerpts,", 1)],
        "BookRename",
    ),
    (
        "M36",
        "rekeyMap: overwrite the destination instead of letting it win",
        SNAP,
        [("  if (!(toBookId in map)) {\n    next[toBookId] = map[fromBookId] as V;\n  }", "  next[toBookId] = map[fromBookId] as V;", 1)],
        "BookRename",
    ),
    (
        "M37",
        "LibraryService.handleRenamed: do not re-key the in-memory entry",
        LIBSVC,
        [
            (
                "      this.entries.delete(fromId);\n",
                "      this.entries.delete(fromId); if (1) return;\n",
                1,
            )
        ],
        "BookRename",
    ),
    (
        "M38",
        "LibraryService.handleRenamed: never move the ezreader/ files",
        LIBSVC,
        [
            (
                "        const result = await this.libraryWriter.renameBookFiles({",
                "        const result = { missing: [] } as any; void this.libraryWriter; if (0) await this.libraryWriter.renameBookFiles({",
                1,
            ),
            (
                "          newTitle: existing.book.metadata?.title ?? existing.book.locator.path\n        });",
                "          newTitle: existing.book.metadata?.title ?? existing.book.locator.path\n        });",
                1,
            ),
        ],
        "BookRename",
    ),
    (
        "M39",
        "ObsidianLibraryWriter.renameBookFiles: locate nothing (never moves a file)",
        WRITER,
        [
            (
                '    const newBase = `${sanitizeFileBase(fallbackTitle)}-${bookIdTag(input.toBookId)}`;',
                '    const newBase = `${sanitizeFileBase(fallbackTitle)}-${bookIdTag(input.toBookId)}`;\n    if (newBase) return { moved, missing };',
                1,
            )
        ],
        "VaultRoundTrip",
    ),
    (
        "M40",
        "ObsidianLibraryWriter.renameBookFiles: clobber an occupied destination",
        WRITER,
        [
            (
                "      if (this.app.vault.getAbstractFileByPath(newPath) instanceof TFile) {\n"
                "        // Destination occupied (a second book already claims this base).\n"
                "        // Overwriting would destroy that book's notes; leave the source\n"
                "        // file untouched and report it so the caller can surface it.\n"
                "        missing.push(oldPath);\n"
                "        continue;\n"
                "      }\n",
                "",
                1,
            )
        ],
        "VaultRoundTrip",
    ),
]


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True)


def main():
    build = run("node esbuild.tests.config.mjs")
    if build.returncode != 0:
        print("BUILD FAILED\n" + build.stdout + build.stderr)
        return 1

    baseline = run("node --test tests/dist/core/*.test.mjs")
    print(f"baseline: {'PASS' if baseline.returncode == 0 else 'FAIL'}")

    results = []
    for mid, desc, rel, subs, target in MUTATIONS:
        path = ROOT / rel
        backup = path.read_text()
        mutated = backup
        missing = False
        for old, new, count in subs:
            if old not in mutated:
                print(f"{mid}: ANCHOR-MISSING in {rel}: {old[:60]!r}")
                results.append((mid, desc, "ANCHOR-MISSING"))
                missing = True
                break
            mutated = mutated.replace(old, new, count)
        if missing:
            continue
        if mutated == backup:
            print(f"{mid}: NO-OP -- substitution changed nothing")
            results.append((mid, desc, "NO-OP"))
            continue

        path.write_text(mutated)
        rb = run("node esbuild.tests.config.mjs")
        if rb.returncode != 0:
            print(f"{mid}: INCONCLUSIVE -- revert does not build; rewrite the mutation")
            results.append((mid, desc, "BUILD-ERROR"))
        else:
            t = run(f"node --test tests/dist/core/{target}.test.mjs")
            failed = re.search(r"^(?:ℹ|#) fail (\d+)$", t.stdout, re.M)
            n = int(failed.group(1)) if failed else -1
            if t.returncode != 0:
                print(f"{mid}: DETECTED ({n} failed)" if n > 0 else f"{mid}: DETECTED (non-zero exit)")
                results.append((mid, desc, "DETECTED"))
            else:
                print(f"{mid}: *** NOT DETECTED ***")
                results.append((mid, desc, "NOT-DETECTED"))
        path.write_text(backup)

    print("\n" + "=" * 74)
    for mid, desc, status in results:
        print(f"  {mid}  {status:<16} {desc}")
    print("=" * 74)
    bad = [r for r in results if r[2] != "DETECTED"]
    if bad:
        print(f"{len(bad)} mutation(s) not cleanly detected")
        return 1
    print(f"all {len(results)} mutations detected by test assertion")
    return 0


if __name__ == "__main__":
    sys.exit(main())