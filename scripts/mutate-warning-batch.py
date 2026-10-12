#!/usr/bin/env python3
"""Mutation-verify the 0.3.2 auto-review warning batch.

Each mutation reverts one fix; the matching test MUST fail. Anything that
still passes is reported as INCONCLUSIVE (the test does not actually pin
the fix). Every mutation verifies its own substitution landed before the
test run — an earlier batch of these silently no-op'd and read as "pass".
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/ljl/dsh/ezreader")

# Each sub is (old, new, count). `count` matters: a bare str.replace hits
# every occurrence, which turned M31 into a duplicate-`const` syntax error
# instead of a real revert. A mutation that fails to *build* proves
# nothing about the test, so the script now reports BUILD-ERROR as a
# failure to be fixed, not as a detection.
MUTATIONS = [
    (
        "M26",
        "Plugin.ts: revealLeaf await -> void (only silences the linter)",
        "src/Plugin.ts",
        [("await this.app.workspace.revealLeaf(", "void this.app.workspace.revealLeaf(", -1)],
        "tests/dist/core/LintWarningFixes.test.mjs",
    ),
    (
        "M27",
        "ReaderView.ts: drop BOTH braces around `let escapeHandled`",
        "src/ui/reader/ReaderView.ts",
        [
            ('case "escape": {', 'case "escape":', 1),
            ("        return;\n      }\n    }\n  }", "        return;\n    }\n  }", 1),
        ],
        "tests/dist/core/LintWarningFixes.test.mjs",
    ),
    (
        "M28",
        "BaseTranslationProvider.ts: reject(raw reason) instead of reject(toError(reason))",
        "src/adapters/translation/BaseTranslationProvider.ts",
        [("reject(toError(error));", "reject(error);", 1)],
        "tests/dist/core/LintWarningFixes.test.mjs",
    ),
    (
        "M29",
        "ObsidianLibraryWriter.ts: trashFile -> vault.delete (permanent unlink)",
        "src/adapters/obsidian/ObsidianLibraryWriter.ts",
        [("await this.app.fileManager.trashFile(file);", "await this.app.vault.delete(file);", 1)],
        "tests/dist/core/VaultRoundTrip.test.mjs",
    ),
    (
        "M30",
        "pdfOverlay.ts: reintroduce the write-only lastQuery binding",
        "src/ui/reader/pdfOverlay.ts",
        [
            (
                "const commit = (fromStart: boolean): void => {",
                'let lastQuery = "";\n  const commit = (fromStart: boolean): void => {\n    lastQuery = input.value.trim();',
                1,
            )
        ],
        "tests/dist/core/LintWarningFixes.test.mjs",
    ),
    (
        "M31",
        "BookInfoModal.ts: reintroduce the unused placeholder binding",
        "src/ui/shelf/BookInfoModal.ts",
        [
            (
                "      chart.createDiv({\n        cls: \"ez-reader__book-info-bar-chart__placeholder\",",
                "      const placeholder = chart.createDiv({\n        cls: \"ez-reader__book-info-bar-chart__placeholder\",",
                1,
            )
        ],
        "tests/dist/core/LintWarningFixes.test.mjs",
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
    for mid, desc, rel, subs, test_target in MUTATIONS:
        target = ROOT / rel
        backup = target.read_text()
        mutated = backup
        for old, new, count in subs:
            if old not in mutated:
                print(f"{mid}: SKIP - anchor not found in {rel}: {old!r}")
                results.append((mid, desc, "ANCHOR-MISSING"))
                break
            mutated = mutated.replace(old, new) if count < 0 else mutated.replace(old, new, count)
        else:
            # Anchor was found and replaced — confirm the bytes really moved.
            if mutated == backup:
                print(f"{mid}: SKIP - substitution was a no-op")
                results.append((mid, desc, "NO-OP"))
                continue
            target.write_text(mutated)
            if target.read_text() != mutated:
                print(f"{mid}: SKIP - mutation did not persist")
                results.append((mid, desc, "NOT-PERSISTED"))
                continue

            rb = run("node esbuild.tests.config.mjs")
            if rb.returncode != 0:
                # A revert that does not compile proves nothing about the
                # test — report it as an inconclusive mutation so it gets
                # rewritten, not counted as a win.
                print(f"{mid}: *** INCONCLUSIVE *** -- revert does not build; mutation is imprecise")
                results.append((mid, desc, "BUILD-ERROR"))
            else:
                t = run(f"node --test {test_target}")
                # `node --test` uses the spec reporter by default, which
                # prints "ℹ fail N"; older/TAP runs print "# fail N".
                # Matching only one of them made every mutation look
                # undetected.
                failed = re.search(r"^(?:ℹ|#) fail (\d+)$", t.stdout, re.M)
                n = int(failed.group(1)) if failed else -1
                if t.returncode != 0:
                    detail = f"{n} test(s) failed" if n > 0 else "non-zero exit"
                    print(f"{mid}: DETECTED ({detail})")
                    results.append((mid, desc, "DETECTED"))
                else:
                    print(f"{mid}: *** NOT DETECTED *** -- the test does not pin this fix")
                    results.append((mid, desc, "NOT-DETECTED"))
            target.write_text(backup)

    print("\n" + "=" * 72)
    bad = [r for r in results if r[2] != "DETECTED"]
    for mid, desc, status in results:
        print(f"  {mid}  {status:<22} {desc}")
    print("=" * 72)
    if bad:
        print(f"{len(bad)} mutation(s) not detected")
        return 1
    print(f"all {len(results)} mutations detected")
    return 0


if __name__ == "__main__":
    sys.exit(main())