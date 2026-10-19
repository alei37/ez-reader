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
import type { Bookmark } from "../../src/core/entities/Bookmark";
import type { BookMetadata } from "../../src/core/entities/Book";
import type { Excerpt } from "../../src/core/entities/Excerpt";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import { renameInSnapshot } from "../../src/core/utils/renameSnapshot";

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
  async listLibrary(): Promise<ReadonlyArray<string>> { return this.snapshot.library; }
  async addToLibrary(bookId: string): Promise<void> {
    if (this.snapshot.library.includes(bookId)) return;
    this.snapshot = { ...this.snapshot, library: [...this.snapshot.library, bookId] };
  }
  async removeFromLibrary(bookId: string): Promise<void> {
    this.snapshot = { ...this.snapshot, library: this.snapshot.library.filter((id) => id !== bookId) };
  }
  async listReading(): Promise<ReadonlyArray<ReadingState>> { return this.snapshot.reading; }
  async upsertReading(state: ReadingState): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((r) => r.bookId !== state.bookId), state]
    };
  }

  // 端口漂移修复: 以前签名写的是 `(current: undefined) => unknown`, 跟端口的
  // `(current: ReadingState | undefined) => ReadingState | null` 对不上 ——
  // `implements AnnotationStore` 一直是假的. 这里改成跟端口一致, 并且真的
  // 走 read-modify-write.
  async patchReading(
    bookId: string,
    patch: (current: ReadingState | undefined) => ReadingState | null
  ): Promise<void> {
    const current = this.snapshot.reading.find((r) => r.bookId === bookId);
    const next = patch(current);
    if (next === null) return;
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((r) => r.bookId !== bookId), next]
    };
  }

  async listBookmarks(bookId: string): Promise<ReadonlyArray<Bookmark>> {
    return this.snapshot.bookmarks.filter((b) => b.bookId === bookId);
  }
  async addBookmark(bookmark: Bookmark): Promise<void> {
    this.snapshot = { ...this.snapshot, bookmarks: [...this.snapshot.bookmarks, bookmark] };
  }
  async removeBookmark(bookId: string, bookmarkId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      bookmarks: this.snapshot.bookmarks.filter((b) => !(b.bookId === bookId && b.id === bookmarkId))
    };
  }
  async listExcerpts(bookId: string): Promise<ReadonlyArray<Excerpt>> {
    return this.snapshot.excerpts.filter((e) => e.bookId === bookId);
  }
  async addExcerpt(excerpt: Excerpt): Promise<void> {
    this.snapshot = { ...this.snapshot, excerpts: [...this.snapshot.excerpts, excerpt] };
  }
  async removeExcerpt(bookId: string, excerptId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      excerpts: this.snapshot.excerpts.filter((e) => !(e.bookId === bookId && e.id === excerptId))
    };
  }
  /** 只 patch note / tags, 其余字段 (id / text / locator / createdAt) 保持原值. */
  async updateExcerptNote(
    bookId: string,
    excerptId: string,
    patch: { note?: string; tags?: ReadonlyArray<string> }
  ): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      excerpts: this.snapshot.excerpts.map((e) => {
        if (e.bookId !== bookId || e.id !== excerptId) return e;
        return {
          ...e,
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {})
        };
      })
    };
  }
  async listSettings(): Promise<PluginSettings> { return this.snapshot.settings; }
  async saveSettings(s: PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: s };
  }
  async patchSettings(patch: (s: PluginSettings) => PluginSettings): Promise<void> {
    this.snapshot = { ...this.snapshot, settings: patch(this.snapshot.settings) };
  }
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> { return this.snapshot.coverPaths ?? {}; }
  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths };
  }
  async patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void> {
    this.snapshot = { ...this.snapshot, coverPaths: patch(this.snapshot.coverPaths ?? {}) };
  }
  async getAddedAt(bookId: string): Promise<number | null> {
    return this.snapshot.addedAtByBookId?.[bookId] ?? null;
  }
  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
    this.snapshot = { ...this.snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
  }
  // 端口漂移修复: 下面这几个方法端口上有, 桩里以前没有 —— 补成真的实现.
  async getPinnedAt(bookId: string): Promise<number | null> {
    return this.snapshot.pinnedAtByBookId?.[bookId] ?? null;
  }
  async setPinnedAt(bookId: string, pinnedAt: number | null): Promise<void> {
    const current = this.snapshot.pinnedAtByBookId ?? {};
    const next = { ...current };
    if (pinnedAt === null) delete next[bookId];
    else next[bookId] = pinnedAt;
    this.snapshot = { ...this.snapshot, pinnedAtByBookId: next };
  }
  async patchPinnedAt(bookId: string, patch: (current: number | null) => number | null): Promise<void> {
    const currentMap = this.snapshot.pinnedAtByBookId ?? {};
    const nextValue = patch(currentMap[bookId] ?? null);
    const next = { ...currentMap };
    if (nextValue === null) delete next[bookId];
    else next[bookId] = nextValue;
    this.snapshot = { ...this.snapshot, pinnedAtByBookId: next };
  }
  async saveRichMetadata(bookId: string, metadata: BookMetadata): Promise<void> {
    const current = this.snapshot.richMetadataByBookId ?? {};
    this.snapshot = { ...this.snapshot, richMetadataByBookId: { ...current, [bookId]: metadata } };
  }
  async loadRichMetadata(bookId: string): Promise<BookMetadata | null> {
    return this.snapshot.richMetadataByBookId?.[bookId] ?? null;
  }
  async addToLibraryBatchWithStamp(bookIds: ReadonlyArray<string>, addedAt: number): Promise<void> {
    const existing = new Set(this.snapshot.library);
    const newIds = bookIds.filter((id) => !existing.has(id));
    if (newIds.length === 0) return;
    const addedAtByBookId = { ...(this.snapshot.addedAtByBookId ?? {}) };
    for (const id of newIds) {
      if (addedAtByBookId[id] === undefined || addedAtByBookId[id]! > addedAt) {
        addedAtByBookId[id] = addedAt;
      }
    }
    this.snapshot = {
      ...this.snapshot,
      library: [...this.snapshot.library, ...newIds],
      addedAtByBookId
    };
  }
  async markOnboardingDismissed(): Promise<void> {
    this.snapshot = { ...this.snapshot, onboardingDismissed: true };
  }
  async hasOnboardingBeenDismissed(): Promise<boolean> {
    return this.snapshot.onboardingDismissed === true;
  }
  // P2: visited toc ids mock — 跟真 adapter 一样的 in-memory 实现.
  async loadVisitedTocIds(bookId: string): Promise<ReadonlyArray<string>> {
    return this.snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }
  async saveVisitedTocIds(bookId: string, ids: ReadonlyArray<string>): Promise<void> {
    const current = this.snapshot.visitedTocIdsByBookId ?? {};
    this.snapshot = { ...this.snapshot, visitedTocIdsByBookId: { ...current, [bookId]: [...ids] } };
  }
  /** 复用 core 的纯函数, 跟真 adapter 走同一条 re-key 路径. */
  async renameBookId(fromBookId: string, toBookId: string): Promise<void> {
    this.snapshot = renameInSnapshot(this.snapshot, fromBookId, toBookId);
  }
  /** 迁移标记写在 snapshot 顶层 (不是 settings 里), 跟真 adapter 一致. */
  async setMigratedToV030(passed: boolean, attempts?: number): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      migratedToV030: passed,
      ...(attempts === undefined ? {} : { migratedToV030Attempts: attempts })
    };
  }
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