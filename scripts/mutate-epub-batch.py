#!/usr/bin/env python3
"""Mutation check for the EPUB fixes (selection menu + sanitize gate + blob release).

Each mutation reverts one fix in place. A fix is only considered *locked in*
if reverting it makes a test fail **by assertion** — not by a build error.

Rules enforced here (same as the earlier batches):
  - count-limited substitution, so a pattern can only match N times
  - verify the mutation actually landed before running the tests
  - a non-compiling revert is reported INCONCLUSIVE and exits non-zero,
    because "the build broke" is not evidence that a test covers the fix
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "src/adapters/foliate/FoliateBookReader.ts"
TEST = "tests/dist/core/EpubSelectionAndSanitize.test.mjs"

MUTATIONS = [
    (
        "M41 MIME gate drops application/xhtml+xml again",
        'if (!/^(?:application|text)\\/(?:xhtml\\+xml|html)$/i.test(detail.type ?? "")) return;',
        'if (!/text\\/(x?html)/i.test(detail.type ?? "")) return;',
    ),
    (
        "M42 no initial attach (waits for the next load again)",
        "const alreadyLoaded = this.getLastLoaded?.();",
        "const alreadyLoaded = null as { doc: Document; index: number } | null;",
    ),
    (
        "M43 view.open() failure stops releasing the parsed book",
        'destroyParsedBook(parsed, "open-failed");',
        "void 0;",
    ),
    (
        "M44 applyAppearance failure stops closing the session",
        "      await session.close();\n      throw error;",
        "      throw error;",
    ),
    (
        "M45 sanitizeBookContent stops stripping inline handlers",
        '.replace(/\\son[a-z]+\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+)/gi, "")',
        ".replace(/(?!x)x^/g, \"\")",
    ),
    (
        "M46 captureLoad is registered after view.open() returns",
        'view.addEventListener("load", captureLoad);\n    try {\n      await view.open(parsed);',
        "try {\n      await view.open(parsed);",
    ),
]

BUILD = ["node", "esbuild.tests.config.mjs"]


def run_tests() -> tuple[int, str]:
    proc = subprocess.run(
        ["node", "--test", TEST], cwd=ROOT, capture_output=True, text=True
    )
    return proc.returncode, proc.stdout + proc.stderr


def fail_count(output: str) -> int:
    for line in output.splitlines():
        if line.startswith("ℹ fail ") or line.startswith("# fail "):
            try:
                return int(line.split()[-1])
            except ValueError:
                pass
    return 0


def main() -> int:
    backup = TARGET.read_text(encoding="utf-8")
    inconclusive: list[str] = []
    detected = 0

    try:
        for name, old, new in MUTATIONS:
            count = backup.count(old)
            if count != 1:
                print(f"{name:<52} PATTERN-MISS (matched {count}x)")
                inconclusive.append(f"{name}: pattern matched {count}x, expected 1")
                continue

            mutated = backup.replace(old, new, 1)
            TARGET.write_text(mutated, encoding="utf-8")

            build = subprocess.run(BUILD, cwd=ROOT, capture_output=True, text=True)
            if build.returncode != 0:
                print(f"{name:<52} INCONCLUSIVE (build failed)")
                print("    " + (build.stderr or build.stdout).strip().splitlines()[-1][:160])
                inconclusive.append(f"{name}: build failed, not an assertion")
                TARGET.write_text(backup, encoding="utf-8")
                continue

            code, output = run_tests()
            if fail_count(output) > 0:
                print(f"{name:<52} DETECTED ({fail_count(output)} failing)")
                detected += 1
            else:
                print(f"{name:<52} NOT DETECTED")
                inconclusive.append(f"{name}: no test failed")

            TARGET.write_text(backup, encoding="utf-8")
    finally:
        TARGET.write_text(backup, encoding="utf-8")

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