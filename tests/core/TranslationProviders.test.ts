import { test } from "node:test";
import { strict as assert } from "node:assert";

import { DeeplTranslationProvider } from "../../src/adapters/translation/DeeplTranslationProvider";
import { GoogleTranslationProvider } from "../../src/adapters/translation/GoogleTranslationProvider";
import { YoudaoTranslationProvider } from "../../src/adapters/translation/YoudaoTranslationProvider";
import { TranslationCoordinator } from "../../src/core/services/TranslationService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from "../../src/core/ports/TranslationProvider";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";
import { DEFAULT_PLUGIN_SETTINGS } from "../../src/core/types/ReaderSettings";
import type { Locale } from "../../src/core/types/Locale";

/**
 * Provider 校验逻辑 + 协调器的单元测试。我们不发真实网络请求 — 那部分要
 * 靠 Obsidian runtime 真测。这些测试锁定:
 * 1. validateKey 对畸形输入给出友好提示
 * 2. TranslationCoordinator 选择正确的 provider
 * 3. TranslationCoordinator 把 settings 里的 source/target locale 透传过去
 */

const deepl = new DeeplTranslationProvider();
const google = new GoogleTranslationProvider();
const youdao = new YoudaoTranslationProvider();

test("DeeplTranslationProvider: 空 key → 拒绝", async () => {
  const r = await deepl.validateKey("");
  assert.equal(r.ok, false);
});

test("DeeplTranslationProvider: 短 key → 提示太短", async () => {
  const r = await deepl.validateKey("abc");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /太短/);
});

test("DeeplTranslationProvider: 像样的 key → 通过", async () => {
  const r = await deepl.validateKey("12345678-1234-1234-1234-1234567890ab:fx");
  assert.equal(r.ok, true);
});

test("DeeplTranslationProvider: id/displayName 稳定 (settings 持久化靠这些)", () => {
  assert.equal(deepl.id, "deepl");
  assert.equal(deepl.displayName, "DeepL");
});

test("GoogleTranslationProvider: 非 JSON → 友好提示", async () => {
  const r = await google.validateKey("not-json");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /JSON/);
});

test("GoogleTranslationProvider: JSON 但缺 client_email → 拒绝", async () => {
  const r = await google.validateKey(JSON.stringify({
    type: "service_account",
    project_id: "my-project",
    private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----"
  }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /client_email/);
});

test("GoogleTranslationProvider: JSON 但 type 不是 service_account → 拒绝", async () => {
  const r = await google.validateKey(JSON.stringify({
    type: "user",
    project_id: "my-project",
    client_email: "x@y.iam.gserviceaccount.com",
    private_key: "k"
  }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /service account type/i);
});

test("GoogleTranslationProvider: 完整 service account JSON → 通过", async () => {
  const r = await google.validateKey(JSON.stringify({
    type: "service_account",
    project_id: "my-project",
    client_email: "x@y.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----"
  }));
  assert.equal(r.ok, true);
});

test("YoudaoTranslationProvider: 空 key → 拒绝", async () => {
  const r = await youdao.validateKey("");
  assert.equal(r.ok, false);
});

test("YoudaoTranslationProvider: 非 JSON → 提示 JSON 格式", async () => {
  const r = await youdao.validateKey("just-a-string");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /JSON 格式/);
});

test("YoudaoTranslationProvider: JSON 但缺 appSecret → 拒绝", async () => {
  const r = await youdao.validateKey(JSON.stringify({ appKey: "abc" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /appKey 和 appSecret/);
});

test("YoudaoTranslationProvider: 完整 JSON → 通过", async () => {
  const r = await youdao.validateKey(JSON.stringify({
    appKey: "my-app-key",
    appSecret: "my-app-secret"
  }));
  assert.equal(r.ok, true);
});

test("Provider 三件套各自 id 唯一 — coordinator 据此路由", () => {
  const ids = new Set([deepl.id, google.id, youdao.id]);
  assert.equal(ids.size, 3, "providers 必须有互不重复的 id");
});

// ---- TranslationCoordinator ----

class StaticStore implements AnnotationStore {
  private snapshot: AnnotationSnapshot;
  constructor(initial: AnnotationSnapshot) {
    this.snapshot = initial;
  }
  async load(): Promise<AnnotationSnapshot> { return this.snapshot; }
  async save(s: AnnotationSnapshot): Promise<void> { this.snapshot = s; }
  async listLibrary() { return []; }
  async addToLibrary(): Promise<void> {}
  async removeFromLibrary(): Promise<void> {}
  async listReading() { return []; }
  async upsertReading(): Promise<void> {}
  async listBookmarks() { return []; }
  async addBookmark(): Promise<void> {}
  async removeBookmark(): Promise<void> {}
  async listExcerpts() { return []; }
  async addExcerpt(): Promise<void> {}
  async removeExcerpt(): Promise<void> {}
  async listSettings(): Promise<PluginSettings> { return this.snapshot.settings; }
  async saveSettings(s: PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: s };
  }
  async patchSettings(patch: (s: PluginSettings) => PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }
  async loadCoverPaths() { return {}; }
  async saveCoverPaths(): Promise<void> {}
  async getAddedAt(): Promise<number | null> { return null; }
  async setAddedAt(): Promise<void> {}
  async markOnboardingDismissed(): Promise<void> {}
  async hasOnboardingBeenDismissed(): Promise<boolean> { return true; }
}

const settingsWithTranslation = (providerId: string, apiKey: string, source: Locale, target: Locale): PluginSettings => ({
  ...DEFAULT_PLUGIN_SETTINGS,
  translation: { providerId, apiKey, sourceLocale: source, targetLocale: target }
});

class StubProvider implements TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly signupUrl?: string;
  readonly signupHint?: string;
  public readonly calls: Array<{ key: string; req: TranslationRequest }> = [];
  public readonly response: TranslationResult;
  constructor(id: string, response: TranslationResult) {
    this.id = id;
    this.displayName = id;
    this.response = response;
  }
  async validateKey(): Promise<{ ok: true }> { return { ok: true }; }
  async translate(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push({ key: apiKey, req: request });
    return this.response;
  }
}

test("TranslationCoordinator: 没有配置 translation 时直接抛错", async () => {
  const store = new StaticStore({
    version: 1,
    settings: { ...DEFAULT_PLUGIN_SETTINGS, translation: null },
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  });
  const coord = new TranslationCoordinator(store, [deepl, google, youdao]);
  await assert.rejects(
    () => coord.translate("hello", "auto" as Locale, "zh-CN"),
    /not configured/i
  );
});

test("TranslationCoordinator: 配置了但 provider id 未知时抛错", async () => {
  const store = new StaticStore({
    version: 1,
    settings: settingsWithTranslation("unknown-provider", "k", "auto", "zh-CN"),
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  });
  const coord = new TranslationCoordinator(store, [deepl, google, youdao]);
  await assert.rejects(
    () => coord.translate("hello", "auto", "zh-CN"),
    /Unknown translation provider/
  );
});

test("TranslationCoordinator: 用配置的 provider id 路由请求并透传 apiKey", async () => {
  const stub = new StubProvider("stub-test", {
    text: "你好",
    detectedSource: null,
    providerId: "stub-test"
  });
  const store = new StaticStore({
    version: 1,
    settings: settingsWithTranslation("stub-test", "secret-key", "en", "zh-CN"),
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  });
  const coord = new TranslationCoordinator(store, [stub]);
  const result = await coord.translate("hello", "auto", "zh-CN");
  assert.equal(result.text, "你好");
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].key, "secret-key");
  // settings 里的 source/target locale 优先于方法参数
  assert.equal(stub.calls[0].req.source, "en");
  assert.equal(stub.calls[0].req.target, "zh-CN");
});

test("TranslationCoordinator: settings.sourceLocale 空字符串 → 用方法参数 source", async () => {
  const stub = new StubProvider("stub-test", {
    text: "ok",
    detectedSource: null,
    providerId: "stub-test"
  });
  const store = new StaticStore({
    version: 1,
    settings: settingsWithTranslation("stub-test", "k", "" as Locale, "zh-CN"),
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  });
  const coord = new TranslationCoordinator(store, [stub]);
  await coord.translate("hello", "en" as Locale, "zh-CN");
  assert.equal(stub.calls[0].req.source, "en");
});

test("TranslationCoordinator.listProviders 返回所有注入的 providers", () => {
  const coord = new TranslationCoordinator(new StaticStore({
    version: 1,
    settings: DEFAULT_PLUGIN_SETTINGS,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: []
  }), [deepl, google, youdao]);
  const list = coord.listProviders();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((p) => p.id).sort(), ["deepl", "google-translation-v3", "youdao"]);
});