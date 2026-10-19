#!/usr/bin/env python3
"""Mutation check for the shelf / book-info batch.

  - ShelfView restores the scroll position across a re-render
  - an empty result explicitly resets to the top
  - BookInfoModal's disk probe catches upstream `catch {}` (data on disk
    but an empty snapshot is the only evidence of a swallowed IO error)
  - BookInfoModal no longer conflates "the book was deleted" with
    "reading it failed"

Same contract as every previous batch: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/ShelfAndBookInfo.test.mjs"

TARGETS = {
    "shelf": ROOT / "src/ui/shelf/ShelfView.ts",
    "info": ROOT / "src/ui/shelf/BookInfoModal.ts",
}

MUTATIONS = [
    (
        "M93 ShelfView stops remembering scrollTop before empty()",
        "shelf",
        "    const previousScrollTop = this.body.scrollTop;",
        "    const previousScrollTop = 0;",
        1,
    ),
    (
        "M94 ShelfView renders at the top again on every keystroke",
        "shelf",
        "      if (previousScrollTop > 0) {\n        this.body.scrollTop = previousScrollTop;\n      }",
        "      this.body.scrollTop = 0;",
        1,
    ),
    (
        "M95 ShelfView stops resetting on an empty result",
        "shelf",
        "      this.body.scrollTop = 0;",
        "      this.body.scrollTop = previousScrollTop;",
        1,
    ),
    (
        "M96 the probe stops noticing a swallowed upstream error",
        "info",
        "      if (opts.hasUsableData === false) {\n        return { state: \"error\", path, message: \"文件里有内容, 但详情页没解析出来\" };\n      }",
        "      if (opts.hasUsableData === false) {\n        return { state: \"absent\", path };\n      }",
        1,
    ),
    (
        "M97 BookInfoModal conflates a failed read with a deleted book again",
        "info",
        "      this.loadError = message;\n      this.missing = false;",
        "      this.loadError = null;\n      this.missing = true;",
        1,
    ),
    (
        "M98 the probe turns 'file exists but I can't read it' into 'never read'",
        "info",
        "    } catch (error) {\n      return { state: \"error\", path, message: describeError(error) };\n    }\n  }\n\n  /** Grab the adapter",
        "    } catch (error) {\n      return { state: \"absent\", path };\n    }\n  }\n\n  /** Grab the adapter",
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
                print(f"{name:<64} PATTERN-MISS (matched {count}x, expected {expected})")
                inconclusive.append(f"{name}: matched {count}x, expected {expected}")
                continue

            path.write_text(original.replace(old, new, expected), encoding="utf-8")

            build = subprocess.run(BUILD, cwd=ROOT, capture_output=True, text=True)
            if build.returncode != 0:
                print(f"{name:<64} INCONCLUSIVE (build failed)")
                tail = (build.stderr or build.stdout).strip().splitlines()
                if tail:
                    print("    " + tail[-1][:150])
                inconclusive.append(f"{name}: build failed, not an assertion")
                path.write_text(original, encoding="utf-8")
                continue

            proc = subprocess.run(["node", "--test", TEST], cwd=ROOT, capture_output=True, text=True)
            output = proc.stdout + proc.stderr
            if fail_count(output) > 0:
                print(f"{name:<64} DETECTED ({fail_count(output)} failing)")
                detected += 1
            else:
                print(f"{name:<64} NOT DETECTED")
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
