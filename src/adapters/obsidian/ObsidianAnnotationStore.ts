import { Plugin } from "obsidian";
import type { Bookmark } from "../../core/entities/Bookmark";
import type { BookId } from "../../core/entities/Book";
import type { Excerpt } from "../../core/entities/Excerpt";
import type { ReadingState } from "../../core/entities/ReadingState";
import type {
  AnnotationSnapshot,
  AnnotationStore
} from "../../core/ports/AnnotationStore";
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from "../../core/types/ReaderSettings";

/**
 * Persistence adapter for annotation data. Mirrors what the upstream plugin
 * stored in `data.json` so we can implement a one-shot migration later;
 * for now we keep the same shape and re-use `Plugin.loadData/saveData`.
 */
export class ObsidianAnnotationStore implements AnnotationStore {
  private cache: AnnotationSnapshot | null = null;
  // Serialize all writes through this chain. loadData/saveData use the
  // file system; two concurrent addBookmark/addExcerpt calls would
  // otherwise each read the same base snapshot, both build a delta on
  // top, and the later save would clobber the earlier one.
  private writeChain: Promise<void> = Promise.resolve();
  /**
   * Called after every settings mutation (saveSettings / patchSettings)
   * with the freshly-persisted PluginSettings. Used by Plugin to bust
   * downstream caches (e.g. TranslationCoordinator's 30s settings TTL).
   */
  private settingsListeners = new Set<(settings: PluginSettings) => void>();

  constructor(private readonly plugin: Plugin) {}

  /**
   * Subscribe to settings changes. Returns a disposer that unsubscribes.
   * Used by Plugin to wire TranslationCoordinator.invalidate() and other
   * downstream caches without making them part of the AnnotationStore port.
   */
  onSettingsChanged(listener: (settings: PluginSettings) => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }

  private notifySettingsChanged(settings: PluginSettings): void {
    for (const listener of this.settingsListeners) {
      try {
        listener(settings);
      } catch (error) {
        console.warn("[ez-reader] settings change listener threw", error);
      }
    }
  }

  async load(): Promise<AnnotationSnapshot> {
    if (this.cache) return this.cache;
    const raw = (await this.plugin.loadData()) as Partial<AnnotationSnapshot> | null;
    const settings = this.normalizeSettings(raw?.settings);
    // 容错: 旧版本或损坏的 data 可能让 array 包含非数组元素,
    // 或者 reading 数组里元素缺字段. 过滤无效条目避免下游 crash.
    this.cache = {
      version: 1,
      settings,
      library: this.sanitizeStringArray(raw?.library),
      reading: this.sanitizeReadingArray(raw?.reading),
      bookmarks: this.sanitizeBookmarkArray(raw?.bookmarks),
      excerpts: this.sanitizeExcerptArray(raw?.excerpts),
      coverPaths: this.sanitizeRecord(raw?.coverPaths),
      addedAtByBookId: this.sanitizeAddedAtMap(raw?.addedAtByBookId),
      // 镜像 sanitizeAddedAtMap 的逻辑: 数字映射, 过滤非有限正值.
      pinnedAtByBookId: this.sanitizeAddedAtMap(raw?.pinnedAtByBookId),
      // P0-2: rich metadata 从 EPUB OPF / MOBI EXTH 解析, 持久化避免每次
      // open 都重新解析 (MOBI parser 阻塞主线程 2-5s). sanitize 失败时
      // 静默丢, 让 caller 重试下一次 open.
      richMetadataByBookId: this.sanitizeRichMetadataMap(raw?.richMetadataByBookId),
      // P0 修复: 之前漏读 onboardingDismissed, hasOnboardingBeenDismissed
      // 永远返回 false, modal 每次启动都弹. markOnboardingDismissed 写的
      // 标志其实在 data.json 里, 只是 load() 没拷到 cache.
      onboardingDismissed: raw?.onboardingDismissed === true
    };
    return this.cache;
  }

  /** Wrap a mutation so it serializes through `writeChain`. */
  private async mutate(fn: () => Promise<AnnotationSnapshot>): Promise<void> {
    const next = this.writeChain.then(fn).then(async (snapshot) => {
      this.cache = snapshot;
      await this.plugin.saveData(snapshot as unknown as Record<string, unknown>);
    });
    // Keep the chain alive even on errors — next caller still runs.
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    await next;
  }

  private sanitizeStringArray(input: unknown): string[] {
    return Array.isArray(input) ? input.filter((x): x is string => typeof x === "string") : [];
  }

  private sanitizeReadingArray(input: unknown): import("../../core/entities/ReadingState").ReadingState[] {
    if (!Array.isArray(input)) return [];
    return input.filter((x) => {
      if (!x || typeof x !== "object") return false;
      const r = x as { bookId?: unknown; status?: unknown };
      return typeof r.bookId === "string" && (
        r.status === "unread" || r.status === "reading" ||
        r.status === "finished" || r.status === "abandoned"
      );
    }) as import("../../core/entities/ReadingState").ReadingState[];
  }

  private sanitizeBookmarkArray(input: unknown): import("../../core/entities/Bookmark").Bookmark[] {
    if (!Array.isArray(input)) return [];
    return input.filter((x) => {
      if (!x || typeof x !== "object") return false;
      const b = x as { id?: unknown; bookId?: unknown; label?: unknown };
      return typeof b.id === "string" && typeof b.bookId === "string" && typeof b.label === "string";
    }) as import("../../core/entities/Bookmark").Bookmark[];
  }

  private sanitizeExcerptArray(input: unknown): import("../../core/entities/Excerpt").Excerpt[] {
    if (!Array.isArray(input)) return [];
    return input.filter((x) => {
      if (!x || typeof x !== "object") return false;
      const e = x as { id?: unknown; bookId?: unknown; text?: unknown; locator?: unknown };
      return typeof e.id === "string" && typeof e.bookId === "string" &&
        typeof e.text === "string" && e.locator !== null && typeof e.locator === "object";
    }) as import("../../core/entities/Excerpt").Excerpt[];
  }

  private sanitizeRecord(input: unknown): Record<string, string> {
    if (!input || typeof input !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }

  private sanitizeAddedAtMap(input: unknown): Record<string, number> {
    if (!input || typeof input !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  }

  /**
   * Validate the per-book rich metadata map. Each entry must be a plain
   * object with a non-empty `title` string; everything else (authors,
   * publisher, etc.) is optional and falls back to empty. Invalid entries
   * are dropped silently so a corrupt data.json never crashes the shelf.
   */
  private sanitizeRichMetadataMap(input: unknown): Record<string, import("../../core/entities/Book").BookMetadata> {
    if (!input || typeof input !== "object") return {};
    const out: Record<string, import("../../core/entities/Book").BookMetadata> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!v || typeof v !== "object") continue;
      const m = v as { title?: unknown; authors?: unknown; cachedAt?: unknown };
      if (typeof m.title !== "string" || !m.title.trim()) continue;
      const authors: string[] = Array.isArray(m.authors)
        ? m.authors.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
        : [];
      const cachedAt = typeof m.cachedAt === "number" && Number.isFinite(m.cachedAt) && m.cachedAt > 0 ? m.cachedAt : Date.now();
      out[k] = {
        title: m.title.trim(),
        authors,
        languages: [],
        cachedAt
      };
    }
    return out;
  }

  async save(snapshot: AnnotationSnapshot): Promise<void> {
    // External callers can still bypass mutate(); serialize through the same
    // chain so they don't race with internal mutations.
    await this.mutate(async () => snapshot);
  }

  async listLibrary(): Promise<ReadonlyArray<BookId>> {
    const snapshot = await this.load();
    return snapshot.library;
  }

  async addToLibrary(bookId: BookId): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.library.includes(bookId)) return snapshot;
      return { ...snapshot, library: [...snapshot.library, bookId] };
    });
  }

  async removeFromLibrary(bookId: BookId): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return {
        ...snapshot,
        library: snapshot.library.filter((id) => id !== bookId)
      };
    });
  }

  async listReading(): Promise<ReadonlyArray<ReadingState>> {
    const snapshot = await this.load();
    return snapshot.reading;
  }

  async upsertReading(state: ReadingState): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const next = [...snapshot.reading.filter((s) => s.bookId !== state.bookId), state];
      return { ...snapshot, reading: next };
    });
  }

  async listBookmarks(bookId: BookId): Promise<ReadonlyArray<Bookmark>> {
    const snapshot = await this.load();
    return snapshot.bookmarks.filter((bookmark) => bookmark.bookId === bookId);
  }

  async addBookmark(bookmark: Bookmark): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.bookmarks.some((b) => b.id === bookmark.id)) return snapshot;
      return { ...snapshot, bookmarks: [...snapshot.bookmarks, bookmark] };
    });
  }

  async removeBookmark(bookId: BookId, bookmarkId: string): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return {
        ...snapshot,
        bookmarks: snapshot.bookmarks.filter((b) => !(b.bookId === bookId && b.id === bookmarkId))
      };
    });
  }

  async listExcerpts(bookId: BookId): Promise<ReadonlyArray<Excerpt>> {
    const snapshot = await this.load();
    return snapshot.excerpts.filter((excerpt) => excerpt.bookId === bookId);
  }

  async addExcerpt(excerpt: Excerpt): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.excerpts.some((e) => e.id === excerpt.id)) return snapshot;
      return { ...snapshot, excerpts: [...snapshot.excerpts, excerpt] };
    });
  }

  async removeExcerpt(bookId: BookId, excerptId: string): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return {
        ...snapshot,
        excerpts: snapshot.excerpts.filter((e) => !(e.bookId === bookId && e.id === excerptId))
      };
    });
  }

  async listSettings(): Promise<PluginSettings> {
    const snapshot = await this.load();
    return snapshot.settings;
  }

  async saveSettings(settings: PluginSettings): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return { ...snapshot, settings };
    });
    this.notifySettingsChanged(settings);
  }

  /**
   * Atomic settings update. The read-modify-write runs inside the write
   * chain so two concurrent patches can't both read the same base and
   * overwrite each other's fields. Use this from any debounced caller
   * (slider drag, text input) to avoid the read-modify-write race that
   * `listSettings()` + `saveSettings()` would create.
   */
  async patchSettings(patch: (settings: PluginSettings) => PluginSettings): Promise<void> {
    let nextSettings: PluginSettings | undefined;
    await this.mutate(async () => {
      const snapshot = await this.load();
      nextSettings = patch(snapshot.settings);
      return { ...snapshot, settings: nextSettings };
    });
    if (nextSettings) this.notifySettingsChanged(nextSettings);
  }

  async loadCoverPaths(): Promise<Readonly<Record<string, string>>> {
    const snapshot = await this.load();
    return snapshot.coverPaths ?? {};
  }

  async saveCoverPaths(coverPaths: Record<string, string>): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return { ...snapshot, coverPaths };
    });
  }

  /**
   * P0-3 修复: 原子地 read-modify-write coverPaths map. 旧 `saveCoverPaths`
   * 是 caller 先 loadCoverPaths (读 cache) 再 saveCoverPaths (写) — 两个
   * 并发 caller 都可能在 T1-T2 之间读到同一份旧 map, 然后后写的覆盖先写
   * 的, 丢 coverPath. 现在 patch callback 在 mutate 内部读最新 cache 再 merge,
   * 串行化在 writeChain 上 — 跟 patchSettings 同样的语义.
   */
  async patchCoverPaths(patch: (paths: Record<string, string>) => Record<string, string>): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.coverPaths ?? {};
      return { ...snapshot, coverPaths: patch(current) };
    });
  }

  async markOnboardingDismissed(): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.onboardingDismissed === true) return snapshot;
      return { ...snapshot, onboardingDismissed: true };
    });
  }

  async getAddedAt(bookId: BookId): Promise<number | null> {
    const snapshot = await this.load();
    return snapshot.addedAtByBookId?.[bookId] ?? null;
  }

  async setAddedAt(bookId: BookId, addedAt: number): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.addedAtByBookId ?? {};
      // Don't downgrade an existing timestamp — once a book is added, its
      // "first added" moment stays stable across reopens.
      if (current[bookId] !== undefined && current[bookId]! <= addedAt) return snapshot;
      return { ...snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
    });
  }

  async getPinnedAt(bookId: BookId): Promise<number | null> {
    const snapshot = await this.load();
    return snapshot.pinnedAtByBookId?.[bookId] ?? null;
  }

  async setPinnedAt(bookId: BookId, pinnedAt: number | null): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.pinnedAtByBookId ?? {};
      const next = { ...current };
      if (pinnedAt === null) {
        delete next[bookId];
      } else {
        next[bookId] = pinnedAt;
      }
      return { ...snapshot, pinnedAtByBookId: next };
    });
  }

  /**
   * P0-2 配套: 持久化从 EPUB/MOBI 解析的真 metadata, 避免每次 vault 重启
   * 都重新解压解析 (MOBI 大文件阻塞主线程 2-5s). overwrite 不 merge —
   * 真 metadata 应该是 ground truth, 不会比之前解析的还差.
   */
  async saveRichMetadata(bookId: BookId, metadata: import("../../core/entities/Book").BookMetadata): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.richMetadataByBookId ?? {};
      return { ...snapshot, richMetadataByBookId: { ...current, [bookId]: metadata } };
    });
  }

  async loadRichMetadata(bookId: BookId): Promise<import("../../core/entities/Book").BookMetadata | null> {
    const snapshot = await this.load();
    return snapshot.richMetadataByBookId?.[bookId] ?? null;
  }

  /**
   * P0 修复: 之前 `Promise.all([...addToLibrary, ...setAddedAt])` 让每个
   * book 都触发 2 个串行 mutate (writeChain 串行化). 100 本书 = 200 个
   * saveData, 用户报告"加入所选"体感 ~10s 甚至卡死. 现在 1 个 mutate
   * 把所有 ids 一起加上 + 一起 stamp, 一次 saveData 落盘.
   */
  async addToLibraryBatchWithStamp(bookIds: ReadonlyArray<BookId>, addedAt: number): Promise<void> {
    if (bookIds.length === 0) return;
    await this.mutate(async () => {
      const snapshot = await this.load();
      const existingLibrary = new Set(snapshot.library);
      const existingAddedAt = snapshot.addedAtByBookId ?? {};
      // Filter out ids that are already in the library — for those, their
      // original addedAt must NOT be downgraded (first-added wins).
      const newIds = bookIds.filter((id) => !existingLibrary.has(id));
      if (newIds.length === 0) return snapshot;
      const library = [...snapshot.library, ...newIds];
      // Build the new addedAt map once; only stamp ids that don't already
      // have a (larger-or-equal) entry.
      const addedAtByBookId = { ...existingAddedAt };
      for (const id of newIds) {
        if (addedAtByBookId[id] === undefined || addedAtByBookId[id]! > addedAt) {
          addedAtByBookId[id] = addedAt;
        }
      }
      return { ...snapshot, library, addedAtByBookId };
    });
  }

  async hasOnboardingBeenDismissed(): Promise<boolean> {
    const snapshot = await this.load();
    return snapshot.onboardingDismissed === true;
  }

  private normalizeSettings(input: PluginSettings | undefined): PluginSettings {
    if (!input) return DEFAULT_PLUGIN_SETTINGS;
    return { ...DEFAULT_PLUGIN_SETTINGS, ...input };
  }
}