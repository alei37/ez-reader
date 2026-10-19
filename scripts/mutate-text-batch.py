#!/usr/bin/env python3
"""Mutation check for the TXT / MOBI adapter batch.

  - selectionchange is bound on `document`, not on an element (the DOM spec
    only dispatches it on Document — an element listener is 100% dead code,
    which is why mobile selection popups never appeared)
  - `decodeText` protects the TextDecoder *construction* and *result*, not
    just the decode call
  - chapter titles come from the source lines, not from the rendered
    single-line `page.html`

Same contract as every previous batch: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/TextAdapterFixes.test.mjs"

TARGETS = {
    "session": ROOT / "src/adapters/text/PagedTextSession.ts",
    "txt": ROOT / "src/adapters/text/TxtBookReader.ts",
}

MUTATIONS = [
    (
        "M99 selectionchange goes back onto the stage element (dead code)",
        "session",
        '    this.element.ownerDocument.addEventListener("selectionchange", this.documentSelectionHandler);',
        '    this.element.addEventListener("selectionchange", this.documentSelectionHandler);',
        1,
    ),
    (
        "M100 the document listener is never unbound in close()",
        "session",
        '    this.element.ownerDocument.removeEventListener(\n      "selectionchange",\n      this.documentSelectionHandler\n    );',
        '    void 0;',
        1,
    ),
    (
        "M101 TextDecoder construction is unguarded again (RangeError escapes)",
        "txt",
        "  try {\n    return new TextDecoder(label, { fatal }).decode(bytes);\n  } catch {\n    return null;\n  }",
        "  return new TextDecoder(label, { fatal }).decode(bytes);",
        1,
    ),
    (
        "M102 the U+FFFD probe is dropped (mojibake accepted as success)",
        "txt",
        "  const text = tryDecode(bytes, label, false);\n  if (text === null) return null;\n  return isCleanText(text) ? text : null;",
        "  return tryDecode(bytes, label, false);",
        1,
    ),
    (
        "M103 strict decode stops probing for replacement chars",
        "txt",
        "  const text = tryDecode(bytes, label, true);\n  if (text === null) return null;\n  return isCleanText(text) ? text : null;",
        "  return tryDecode(bytes, label, true);",
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
                print(f"{name:<66} PATTERN-MISS (matched {count}x, expected {expected})")
                inconclusive.append(f"{name}: matched {count}x, expected {expected}")
                continue

            path.write_text(original.replace(old, new, expected), encoding="utf-8")

            build = subprocess.run(BUILD, cwd=ROOT, capture_output=True, text=True)
            if build.returncode != 0:
                print(f"{name:<66} INCONCLUSIVE (build failed)")
                tail = (build.stderr or build.stdout).strip().splitlines()
                if tail:
                    print("    " + tail[-1][:150])
                inconclusive.append(f"{name}: build failed, not an assertion")
                path.write_text(original, encoding="utf-8")
                continue

            proc = subprocess.run(["node", "--test", TEST], cwd=ROOT, capture_output=True, text=True)
            output = proc.stdout + proc.stderr
            if fail_count(output) > 0:
                print(f"{name:<66} DETECTED ({fail_count(output)} failing)")
                detected += 1
            else:
                print(f"{name:<66} NOT DETECTED")
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
