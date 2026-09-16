import { test } from "node:test";
import { strict as assert } from "node:assert";
import { BaseTranslationProvider } from "../../src/adapters/translation/BaseTranslationProvider";
import type { TranslationRequest, TranslationResult } from "../../src/core/ports/TranslationProvider";

/**
 * Minimal concrete subclass for testing the base class helpers in isolation.
 * We don't need network behaviour — just `formatError`, `checkEmptyKey`,
 * and the `fetchJson` plumbing (which we test with mocked global fetch).
 */
class TestProvider extends BaseTranslationProvider {
  readonly id = "test";
  readonly displayName = "Test";
  readonly signupUrl = "https://example.com";
  readonly signupHint = "test hint";
  protected readonly providerName = "Test";
  protected formatHttpError(status: number, _body: unknown): string {
    return `Test HTTP ${status}`;
  }

  // Expose protected helpers for tests.
  public callFormatError(error: unknown): string {
    return this.formatError(error);
  }
  public callCheckEmptyKey(key: string): string | null {
    return this.checkEmptyKey(key);
  }
  public callFetchJson<T>(
    url: string,
    init: RequestInit,
    options?: { providerName?: string }
  ): Promise<T> {
    return this.fetchJson<T>(url, init, options);
  }

  // Unused abstract method stubs — we test the base helpers directly.
  async validateKey(_apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
  async translate(_apiKey: string, _request: TranslationRequest): Promise<TranslationResult> {
    return { text: "", detectedSource: null, providerId: this.id };
  }
}

const setupFetchStub = (impl: typeof globalThis.fetch): void => {
  globalThis.fetch = impl as typeof globalThis.fetch;
};
const restoreFetch = (saved: typeof globalThis.fetch | undefined): void => {
  if (saved) globalThis.fetch = saved;
  else delete (globalThis as { fetch?: typeof globalThis.fetch }).fetch;
};

test("formatError: Error instance → 拿 message", () => {
  const p = new TestProvider();
  assert.equal(p.callFormatError(new Error("boom")), "boom");
});

test("formatError: 字符串 → 直接", () => {
  const p = new TestProvider();
  assert.equal(p.callFormatError("oops"), "oops");
});

test("formatError: 其他类型 → String()", () => {
  const p = new TestProvider();
  assert.equal(p.callFormatError(42), "42");
});

test("checkEmptyKey: 空字符串 → null", () => {
  const p = new TestProvider();
  assert.equal(p.callCheckEmptyKey(""), null);
  assert.equal(p.callCheckEmptyKey("   "), null);
});

test("checkEmptyKey: 有效 → trim 后", () => {
  const p = new TestProvider();
  assert.equal(p.callCheckEmptyKey("  abc  "), "abc");
});

test("fetchJson: 网络错误 → 抛 '网络请求失败'", async () => {
  const saved = globalThis.fetch;
  setupFetchStub(() => Promise.reject(new Error("ECONNREFUSED")));
  try {
    const p = new TestProvider();
    await assert.rejects(p.callFetchJson("http://x", {}), /网络请求失败.*ECONNREFUSED/);
  } finally {
    restoreFetch(saved);
  }
});

test("fetchJson: 非 JSON 响应 → 抛 '返回了非 JSON 响应'", async () => {
  const saved = globalThis.fetch;
  setupFetchStub(() =>
    Promise.resolve(new Response("<html>not json</html>", { status: 200 }))
  );
  try {
    const p = new TestProvider();
    await assert.rejects(p.callFetchJson("http://x", {}), /Test 返回了非 JSON 响应/);
  } finally {
    restoreFetch(saved);
  }
});

test("fetchJson: HTTP 4xx → 抛 formatHttpError 消息", async () => {
  const saved = globalThis.fetch;
  setupFetchStub(() =>
    Promise.resolve(new Response(JSON.stringify({ code: 42 }), { status: 418 }))
  );
  try {
    const p = new TestProvider();
    await assert.rejects(p.callFetchJson("http://x", {}), /Test HTTP 418/);
  } finally {
    restoreFetch(saved);
  }
});

test("fetchJson: HTTP 2xx + 有效 JSON → 返回 payload", async () => {
  const saved = globalThis.fetch;
  setupFetchStub(() =>
    Promise.resolve(new Response(JSON.stringify({ hello: "world" }), { status: 200 }))
  );
  try {
    const p = new TestProvider();
    const result = await p.callFetchJson<{ hello: string }>("http://x", {});
    assert.deepEqual(result, { hello: "world" });
  } finally {
    restoreFetch(saved);
  }
});

test("fetchJson: options.providerName 覆盖错误前缀", async () => {
  const saved = globalThis.fetch;
  setupFetchStub(() =>
    Promise.resolve(new Response("<html>nope</html>", { status: 200 }))
  );
  try {
    const p = new TestProvider();
    await assert.rejects(
      p.callFetchJson("http://x", {}, { providerName: "Test Auth" }),
      /Test Auth 返回了非 JSON 响应/
    );
  } finally {
    restoreFetch(saved);
  }
});
