import { test } from "node:test";
import { strict as assert } from "node:assert";

import { LibraryService } from "../../src/core/services/LibraryService";
import { ReadingService } from "../../src/core/services/ReadingService";
import { TranslationCoordinator } from "../../src/core/services/TranslationService";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../src/core/ports/AnnotationStore";
import type { BookId, BookLocator, BookMetadata, CoverImage } from "../../src/core/entities/Book";
import type { BookChangeHandler, BookSource } from "../../src/core/ports/BookSource";
import type { Disposable } from "../../src/core/utils/Disposable";
import type { ReadingState } from "../../src/core/entities/ReadingState";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../../src/core/ports/TranslationProvider";
import type { Locale } from "../../src/core/types/Locale";

/**
 * Integration test that wires the real LibraryService + ReadingService
 * together against fake adapters. We deliberately avoid mocks of the
 * Obsidian runtime — these tests should pass on plain Node.
 */
const next_settings = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {
    uiLocale: "zh-CN",
    translation: null,
    defaultAppearance: {
      fontSize: 100,
      lineHeight: 1.6,
      margin: 32,
      theme: "system",
      flow: "paginated",
      twoPages: false,
      immersive: false
    },
    notesDirectory: "ezreader-notes/阅读笔记",
    researchDirectory: "ezreader-notes/主题研究",
    libraryOwnerName: "",
    defaultNoteTemplate: "# {{title}}\n",
    readerOpenMode: "tab",
    twoPagesByDefault: false,
    immersiveOnTablet: false,
    autoCreateNoteOnOpen: true, // legacy field, ignored by current code
    keyboardShortcuts: undefined,
    rememberProgress: true
  };
};

class InMemoryStore implements AnnotationStore {
  snapshot: AnnotationSnapshot = {
    version: 1,
    settings: undefined as never,
    library: [],
    reading: [],
    bookmarks: [],
    excerpts: [],
    coverPaths: {}
  };
  /** Mirror ObsidianAnnotationStore.onSettingsChanged — listSettings TTL
   * cache busters (e.g. TranslationCoordinator.invalidate) plug in here. */
  private settingsListeners = new Set<(settings: unknown) => void>();
  onSettingsChanged(listener: (settings: unknown) => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }
  private notifySettingsChanged(settings: unknown): void {
    for (const listener of this.settingsListeners) listener(settings);
  }

  async load(): Promise<AnnotationSnapshot> { return this.snapshot; }
  async save(s: AnnotationSnapshot): Promise<void> { this.snapshot = s; }
  async listLibrary(): Promise<ReadonlyArray<BookId>> { return this.snapshot.library; }
  async addToLibrary(id: BookId): Promise<void> {
    if (!this.snapshot.library.includes(id)) {
      this.snapshot = { ...this.snapshot, library: [...this.snapshot.library, id] };
    }
  }
  async removeFromLibrary(id: BookId): Promise<void> {
    this.snapshot = { ...this.snapshot, library: this.snapshot.library.filter((x) => x !== id) };
  }
  async listReading(): Promise<ReadonlyArray<ReadingState>> { return this.snapshot.reading; }
  async upsertReading(state: ReadingState): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      reading: [...this.snapshot.reading.filter((r) => r.bookId !== state.bookId), state]
    };
  }
  async listBookmarks(): Promise<ReadonlyArray<unknown>> { return []; }
  async addBookmark(): Promise<void> {}
  async removeBookmark(): Promise<void> {}
  async listExcerpts(): Promise<ReadonlyArray<unknown>> { return []; }
  async addExcerpt(): Promise<void> {}
  async removeExcerpt(): Promise<void> {}
  async listSettings(): Promise<unknown> {
    // Mirror the real ObsidianAnnotationStore.normalizeSettings: return
    // a sensible PluginSettings object so consumers don't have to null-check
    // every field. The shape mirrors what `DEFAULT_PLUGIN_SETTINGS`
    // produces when the user has never opened the settings tab.
    return next_settings(this.snapshot.settings);
  }
  async saveSettings(s: unknown): Promise<void> {
    // Persist back into the snapshot so subsequent translate() sees the key.
    const current = (next_settings(this.snapshot.settings) ?? {}) as Record<string, unknown>;
    const merged = { ...current, ...(s as Record<string, unknown>) };
    this.snapshot = { ...this.snapshot, settings: merged as never };
    this.notifySettingsChanged(merged);
  }
  async patchSettings(patch: (s: ReturnType<typeof next_settings>) => unknown): Promise<void> {
    const next = patch(this.snapshot.settings);
    this.snapshot = { ...this.snapshot, settings: next as never };
    this.notifySettingsChanged(next);
  }
  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> { return {}; }
  async saveCoverPaths(): Promise<void> {}
  async patchCoverPaths(): Promise<void> {}
  async getAddedAt(): Promise<number | null> { return null; }
  async getPinnedAt(): Promise<number | null> { return null; }
  async setAddedAt(bookId: string, addedAt: number): Promise<void> {
    const current = this.snapshot.addedAtByBookId ?? {};
    this.snapshot = { ...this.snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
  }
  async markOnboardingDismissed(): Promise<void> {
    this.snapshot = { ...this.snapshot, onboardingDismissed: true };
  }
  async hasOnboardingBeenDismissed(): Promise<boolean> {
    return this.snapshot.onboardingDismissed === true;
  }
  // P2: visited toc ids mock — 跟 ObsidianAnnotationStore 同样的 in-memory 实现.
  async loadVisitedTocIds(bookId: string): Promise<ReadonlyArray<string>> {
    return this.snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }
  async saveVisitedTocIds(bookId: string, ids: ReadonlyArray<string>): Promise<void> {
    const current = this.snapshot.visitedTocIdsByBookId ?? {};
    this.snapshot = {
      ...this.snapshot,
      visitedTocIdsByBookId: { ...current, [bookId]: [...ids] }
    };
  }
}

class FakeSource implements BookSource {
  private watchers: BookChangeHandler[] = [];
  constructor(public files: Array<{ locator: BookLocator; metadata: BookMetadata | null }>) {}
  async *scan(formats: ReadonlySet<unknown> = new Set()): AsyncIterable<BookLocator> {
    for (const f of this.files) {
      // Mirror real ObsidianBookSource behavior: skip formats not in the set
      if (formats.size > 0 && !formats.has(f.locator.format)) continue;
      yield f.locator;
    }
  }
  addFile(locator: BookLocator, metadata: BookMetadata | null): void {
    this.files.push({ locator, metadata });
  }
  async read(): Promise<ArrayBuffer> { return new ArrayBuffer(0); }
  async readMetadata(locator: BookLocator): Promise<BookMetadata | null> {
    const f = this.files.find((x) => x.locator.path === locator.path);
    return f?.metadata ?? null;
  }
  async readCover(): Promise<CoverImage | null> { return null; }
  async lookup(path: string): Promise<BookLocator | null> {
    const f = this.files.find((x) => x.locator.path === path);
    return f?.locator ?? null;
  }
  resolveId(locator: BookLocator): string { return locator.path; }
  async resolveLocator(id: string): Promise<BookLocator | null> {
    return this.lookup(id);
  }
  watch(handler: BookChangeHandler): Disposable {
    this.watchers.push(handler);
    return { dispose: () => {} };
  }
  fireAdded(path: string, format: "epub" | "pdf"): void {
    for (const h of this.watchers) h({ kind: "added", path, format });
  }
  fireRemoved(path: string, format: "epub" | "pdf"): void {
    for (const h of this.watchers) h({ kind: "removed", path, format });
  }
}

class FakeProvider implements TranslationProvider {
  readonly id = "fake";
  readonly displayName = "Fake";
  calls = 0;
  async validateKey(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
  async translate(_apiKey: string, req: TranslationRequest): Promise<TranslationResult> {
    this.calls += 1;
    return { text: `[${req.target}] ${req.text}`, detectedSource: "en", providerId: "fake" };
  }
}

const newServices = () => {
  const store = new InMemoryStore();
  const source = new FakeSource([
    { locator: { path: "/books/a.epub", format: "epub", sizeBytes: 100, modifiedAt: 1 }, metadata: null },
    { locator: { path: "/books/b.pdf", format: "pdf", sizeBytes: 200, modifiedAt: 2 }, metadata: null },
    { locator: { path: "/books/c.epub", format: "epub", sizeBytes: 300, modifiedAt: 3 }, metadata: null }
  ]);
  const library = new LibraryService(source, store);
  const reading = new ReadingService(store);
  const translation = new TranslationCoordinator(store, [new FakeProvider()]);
  // Mirror Plugin.onload — bust translation's listSettings TTL cache on save.
  store.onSettingsChanged(() => translation.invalidate());
  return { library, reading, translation, store, source };
};

test("integration: scan → initialize → add to library → list", async () => {
  const { library } = await newServices();
  let emits = 0;
  library.subscribe(() => emits += 1);
  await library.initialize();
  // diagnostic: 检查 entries 实际填充情况
  const stat = library.stats();
  assert.equal(stat.total, 3, `expected 3 discovered, got ${stat.total} (emits=${emits})`);
  assert.equal(stat.inLibrary, 0);
  // `list()` 默认只返回已加入; 用 `list(_, _, true)` 看全部
  const allDiscovered = library.list(undefined, undefined, true);
  assert.equal(allDiscovered.length, 3, `list all returned ${allDiscovered.length}`);
  await library.addToLibrary("/books/a.epub");
  const inLib = library.list(undefined, undefined, false);
  assert.equal(inLib.length, 1);
  assert.equal(inLib[0]!.book.locator.path, "/books/a.epub");
  assert.ok(emits >= 2, "should emit on scan + addToLibrary");
});

test("integration: openBook → progress update → status flows through", async () => {
  const { library, reading } = await newServices();
  await library.initialize();
  const bookId = "/books/a.epub";
  await library.addToLibrary(bookId);

  // openBook: unread → reading
  let state = await reading.openBook(bookId);
  assert.equal(state.status, "reading");

  // updatePosition: mid-book → still reading
  state = await reading.updatePosition(bookId, { kind: "reflow", fraction: 0.5 });
  assert.equal(state.status, "reading");

  // updatePosition: ≥ 95% → finished
  state = await reading.updatePosition(bookId, { kind: "reflow", fraction: 0.97 });
  assert.equal(state.status, "finished");

  // setStatus explicit: 重新读 finished → reading (允许 reset)
  state = await reading.setStatus(bookId, "reading");
  assert.equal(state.status, "reading");
});

test("integration: PDF progress flows through with kind=pdf", async () => {
  const { library, reading } = await newServices();
  await library.initialize();
  const bookId = "/books/b.pdf";
  await library.addToLibrary(bookId);

  await reading.openBook(bookId);
  // PDF 位置是 page; fraction 永远是 0
  await reading.updatePosition(bookId, { kind: "pdf", page: 42 });
  const state = await reading.getState(bookId);
  assert.equal(state.position?.kind, "pdf");
  if (state.position?.kind === "pdf") {
    assert.equal(state.position.page, 42);
  }
});

test("integration: translation goes through coordinator when key set", async () => {
  const { library, translation, store } = await newServices();
  await library.initialize();
  await library.addToLibrary("/books/a.epub");

  // 没有 API key 时应该 throw
  await assert.rejects(
    () => translation.translate("hello", "auto" as Locale, "zh-CN" as Locale),
    /Translation is not configured/
  );

  // 设置 API key
  const settings = await store.load();
  await store.saveSettings({ ...settings.settings, translation: {
    providerId: "fake",
    apiKey: "key",
    sourceLocale: "auto",
    targetLocale: "zh-CN"
  } });
  // 重载 (cache invalidate): TranslationCoordinator 缓存 settings — 我们再读
  const result = await translation.translate("hello", "auto" as Locale, "zh-CN" as Locale);
  assert.equal(result.text, "[zh-CN] hello");
  assert.equal(result.providerId, "fake");
});

test("integration: library.addToLibrary + removeFromLibrary is idempotent", async () => {
  const { library } = await newServices();
  await library.initialize();
  await library.addToLibrary("/books/a.epub");
  await library.addToLibrary("/books/a.epub"); // 二次加 — 不报错, 不重复
  assert.equal(library.list().length, 1);
  await library.removeFromLibrary("/books/a.epub");
  await library.removeFromLibrary("/books/a.epub"); // 二次删 — 不报错
  assert.equal(library.list().length, 0);
});

test("integration: book added via watch event reflects in shelf", async () => {
  const { library, source } = await newServices();
  let emits = 0;
  library.subscribe(() => emits += 1);
  await library.initialize();
  const emitsAfterInit = emits;
  // 模拟用户拖入新书: source 现在有它 + 触发 watch 'added'
  source.addFile(
    { path: "/books/new.epub", format: "epub", sizeBytes: 50, modifiedAt: 4 },
    null
  );
  source.fireAdded("/books/new.epub", "epub");
  // 等 microtask 让 emit 落地
  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.ok(emits > emitsAfterInit, "watcher should emit");
  const entry = library.get("/books/new.epub");
  assert.ok(entry, "new book should be visible after watch event");
});

test("integration: book removed via watch event clears from shelf", async () => {
  const { library, source } = await newServices();
  await library.initialize();
  await library.addToLibrary("/books/a.epub");
  assert.ok(library.get("/books/a.epub"));
  source.fireRemoved("/books/a.epub", "epub");
  // initialize re-entrancy 锁: watch 'removed' 直接清, watch 'added' 触发 refreshBook.
  await new Promise((r) => globalThis.setTimeout(r, 50));
  assert.equal(library.get("/books/a.epub"), undefined);
});
