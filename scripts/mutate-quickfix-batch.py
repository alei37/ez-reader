#!/usr/bin/env python3
"""Mutation check for the group-B quick fixes.

  - immersive shortcut reachable
  - PDF translation stale-result guard
  - API key never sent over plaintext http

Same contract as every previous batch: a fix counts as locked in only if
reverting it makes a test fail **by assertion**. A non-compiling revert is
INCONCLUSIVE and exits non-zero.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = "tests/dist/core/QuickFixesBatch.test.mjs"

TARGETS = {
    "shortcuts": ROOT / "src/ui/reader/readerShortcuts.ts",
    "pdf": ROOT / "src/ui/reader/pdfOverlay.ts",
    "openai": ROOT / "src/adapters/translation/OpenAICompatibleTranslationProvider.ts",
    "anthropic": ROOT / "src/adapters/translation/AnthropicCompatibleTranslationProvider.ts",
}

MUTATIONS = [
    (
        "M54 immersive F check moves back behind the shift gate",
        "shortcuts",
        '  if (event.key === "F") {\n    return "toggleImmersive";\n  }\n\n  if (event.shiftKey) {',
        "  if (event.shiftKey) {",
        1,
    ),
    (
        "M55 bare lowercase f starts matching immersive again",
        "shortcuts",
        '  if (event.key === "F") {\n    return "toggleImmersive";\n  }',
        '  if (event.key === "F" || event.key === "f") {\n    return "toggleImmersive";\n  }',
        1,
    ),
    (
        "M56 PDF translation drops the stale-result guard",
        "pdf",
        "      if (generation !== this.translateGeneration) return; // stale result\n",
        "",
        1,
    ),
    (
        "M57 PDF translation drops the stale-error guard",
        "pdf",
        "      if (generation !== this.translateGeneration) return; // stale error\n",
        "",
        1,
    ),
    (
        "M58 PDF call sites stop delegating to the guarded helper",
        "pdf",
        "    return this.runTranslation(text, rect);\n  }\n\n  /**\n   * Translate + render, with a generation guard.",
        "    void this.runTranslation(text, rect);\n  }\n\n  /**\n   * Translate + render, with a generation guard.",
        1,
    ),
    (
        "M59 unmount stops invalidating in-flight translations",
        "pdf",
        "    // 作废在途翻译 — 否则 unmount 之后到达的响应仍会往已 detach 的 popover\n    // 写 DOM(跟 TranslationDrawer.hide() 里 bump generation 同一个理由)。\n    this.translateGeneration += 1;\n",
        "",
        1,
    ),
    (
        "M60 OpenAI-compatible provider drops the https gate",
        "openai",
        '    if (!this.isValidHttpUrl(config.baseUrl)) {\n      throw new Error(\n        `API 基础地址必须是 https://(当前: "${config.baseUrl}")。为避免 API key 明文外发, 已拒绝发送。`\n      );\n    }\n',
        "",
        1,
    ),
    (
        "M61 the https gate accepts plaintext http",
        "openai",
        "      return url.protocol === \"https:\";",
        '      return url.protocol === "https:" || url.protocol === "http:";',
        1,
    ),
    (
        "M62 Anthropic-compatible provider drops the https gate",
        "anthropic",
        '    if (!this.isValidHttpUrl(config.baseUrl)) {\n      throw new Error(\n        `API 基础地址必须是 https://(当前: "${config.baseUrl}")。为避免 API key 明文外发, 已拒绝发送。`\n      );\n    }\n',
        "",
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
                print(f"{name:<54} PATTERN-MISS (matched {count}x, expected {expected})")
                inconclusive.append(f"{name}: matched {count}x, expected {expected}")
                continue

            path.write_text(original.replace(old, new, expected), encoding="utf-8")

            build = subprocess.run(BUILD, cwd=ROOT, capture_output=True, text=True)
            if build.returncode != 0:
                print(f"{name:<54} INCONCLUSIVE (build failed)")
                tail = (build.stderr or build.stdout).strip().splitlines()
                if tail:
                    print("    " + tail[-1][:150])
                inconclusive.append(f"{name}: build failed, not an assertion")
                path.write_text(original, encoding="utf-8")
                continue

            proc = subprocess.run(["node", "--test", TEST], cwd=ROOT, capture_output=True, text=True)
            output = proc.stdout + proc.stderr
            if fail_count(output) > 0:
                print(f"{name:<54} DETECTED ({fail_count(output)} failing)")
                detected += 1
            else:
                print(f"{name:<54} NOT DETECTED")
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