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
import { renameInSnapshot } from "../../core/utils/renameSnapshot";
import { sanitizeBookMetadata } from "../../core/utils/metadata";

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
      onboardingDismissed: raw?.onboardingDismissed === true,
      // P2: 跟 pinnedAtByBookId / addedAtByBookId 同样的 fallback 模式 —
      // 旧 data.json 没这个字段就给空 map, 不会因为 undefined 让
      // loadVisitedTocIds 炸掉.
      visitedTocIdsByBookId: this.sanitizeVisitedTocIdsMap(raw?.visitedTocIdsByBookId),
      // v0.3.0: 一次性迁移完成标记. sanitize boolean — 老 data.json
      // 没这个字段 → false → Plugin.runV030Migration 跑一次。
      //
      // P1 fix: `Plugin.runV030Migration` wrote this flag via
      // `patchSettings`, which lands it at `data.json.settings.migratedToV030`,
      // while this read looks at the TOP level. The guard therefore never
      // tripped and the legacy-notes migration re-ran on every launch,
      // re-listing and re-reading the whole old folder each time. Read
      // both, so a flag written by the buggy build is still honored.
      migratedToV030:
        raw?.migratedToV030 === true ||
        (raw?.settings as { migratedToV030?: unknown } | undefined)?.migratedToV030 === true,
      // Retry counter for a failed migration. Absent → 0 attempts so far.
      migratedToV030Attempts:
        typeof raw?.migratedToV030Attempts === "number" && Number.isFinite(raw.migratedToV030Attempts)
          ? raw.migratedToV030Attempts
          : 0
    };
    return this.cache;
  }

  /** Wrap a mutation so it serializes through `writeChain`. */
  private async mutate(fn: () => Promise<AnnotationSnapshot>): Promise<void> {
    const next = this.writeChain.then(fn).then(async (snapshot) => {
      // P1 修复: 之前是 `this.cache = snapshot;` 然后才 `await saveData`。
      // saveData 抛错时(磁盘满 / vault 只读 / data.json 被锁)cache 已经推进,
      // 而 `load()` 的 `if (this.cache) return this.cache` 从此**永不回读磁盘**
      // —— 内存态和 data.json 在这个 session 内永久分叉。更糟的是下一次成功的
      // mutate 会把这段"从未落过盘"的 delta 一起写回去,把失败彻底掩盖掉:
      // 用户看到的全是正常值, 重启后才发现改动回滚了。
      //
      // 改成落盘成功后才推进 cache。失败时 cache 保持旧值(与磁盘一致),
      // rejection 继续往上抛给调用方。
      //
      // 顺带: 所有"已经是这个状态"的分支都 `return snapshot`(同一个引用),
      // 所以引用相等即代表无变化 —— 直接跳过写盘。addToLibrary /
      // setAddedAt / markOnboardingDismissed / setMigratedToV030 / patchReading
      // 的 no-op 分支原本每次都会把整份 data.json 重写一遍。
      if (snapshot === this.cache) return;
      await this.plugin.saveData(snapshot);
      this.cache = snapshot;
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
   * object with a non-empty `title` string; every other field is normalised
   * but **kept**. Invalid entries are dropped silently so a corrupt data.json
   * never crashes the shelf.
   *
   * P0 数据丢失修复: 这个函数之前只输出 `{title, authors, languages: [],
   * cachedAt}` —— publisher / published / identifier / description 全部丢弃,
   * 而且 **每次 `load()` 都会重建一遍**(load 只在 cache 为空时跑, 所以实际
   * 效果是每次重启 Obsidian 把这些字段清一遍)。后果不只是详情弹窗少几行:
   * `LibraryService.stats()` 的语言统计恒为空 → 书架的语言筛选永远筛不出东西。
   *
   * 真实 vault 已经受损, 例如:
   *   {"title":"Introduction to Seismology","authors":[],"languages":[],…}
   * —— EPUB 里明明有出版信息, 是被这里吃掉的。
   *
   * 现在逐字段规范化并保留, 已存的数据下次 load 就回来了; 未知的额外字段
   * 也透传, 这样将来 `BookMetadata` 加字段也不会再被这里静默销毁。
   */
  private sanitizeRichMetadataMap(input: unknown): Record<string, import("../../core/entities/Book").BookMetadata> {
    if (!input || typeof input !== "object") return {};
    const out: Record<string, import("../../core/entities/Book").BookMetadata> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!v || typeof v !== "object") continue;
      const m = v as Record<string, unknown>;
      if (typeof m.title !== "string" || !m.title.trim()) continue;
      out[k] = sanitizeBookMetadata(m);
    }
    return out;
  }

  /**
   * P2: 验证 visited toc ids map. 每本书的 value 是 string array; 元素
   * 不是 string 过滤掉, 整个 entry 损坏 (非 array) 也丢, 不让坏数据
   * 整个阻塞 load.
   */
  private sanitizeVisitedTocIdsMap(
    input: unknown
  ): Record<string, ReadonlyArray<string>> {
    if (!input || typeof input !== "object") return {};
    const out: Record<string, ReadonlyArray<string>> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!Array.isArray(v)) continue;
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const id of v) {
        if (typeof id !== "string" || !id) continue;
        // 去重 — 同一本书的 visited ids 不应有重复, 但损坏数据可能
        // 有, sanitize 时清掉.
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      if (ids.length > 0) out[k] = ids;
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

  async patchReading(
    bookId: BookId,
    patch: (current: ReadingState | undefined) => ReadingState | null
  ): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.reading.find((s) => s.bookId === bookId);
      const next = patch(current);
      if (next === null) return snapshot;
      const rest = snapshot.reading.filter((s) => s.bookId !== bookId);
      return { ...snapshot, reading: [...rest, next] };
    });
  }

  async renameBookId(fromBookId: BookId, toBookId: BookId): Promise<void> {
    if (fromBookId === toBookId) return;
    // One `mutate` = one `saveData` round-trip on the write chain. Splitting
    // this into per-field writes would leave data.json half-re-keyed if the
    // plugin is disabled mid-rename, which is the exact failure this method
    // exists to prevent.
    await this.mutate(async () => {
      const snapshot = await this.load();
      return renameInSnapshot(snapshot, fromBookId, toBookId);
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

  async updateExcerptNote(
    bookId: BookId,
    excerptId: string,
    patch: { note?: string; tags?: ReadonlyArray<string> }
  ): Promise<void> {
    // P2: notes panel inline edit 用, 只 patch note / tags 字段. 不动
    // locator / text / createdAt — locator 变了 highlight 也得改, 不是
    // 用户编辑 note 的语义. 写一次 snapshot, 跟 addExcerpt 同样的 write
    // chain 串行.
    await this.mutate(async () => {
      const snapshot = await this.load();
      const next = snapshot.excerpts.map((e) => {
        if (e.bookId !== bookId || e.id !== excerptId) return e;
        return {
          ...e,
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {})
        };
      });
      return { ...snapshot, excerpts: next };
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

  /**
   * P1 fix: record the v0.3.0 migration outcome at the TOP level of
   * `data.json`, which is where `load()` looks. Writing it through
   * `patchSettings` put it under `settings.*` instead, so the migration
   * re-ran on every launch. `passed` records whether the run actually
   * finished; `Plugin` retries a failed run a bounded number of times.
   */
  async setMigratedToV030(passed: boolean, attempts?: number): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.migratedToV030 === passed && snapshot.migratedToV030Attempts === attempts) {
        return snapshot;
      }
      return {
        ...snapshot,
        migratedToV030: passed,
        ...(attempts === undefined ? {} : { migratedToV030Attempts: attempts })
      };
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
      if (current[bookId] !== undefined && current[bookId] <= addedAt) return snapshot;
      return { ...snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
    });
  }

  async getPinnedAt(bookId: BookId): Promise<number | null> {
    const snapshot = await this.load();
    return snapshot.pinnedAtByBookId?.[bookId] ?? null;
  }

  async setPinnedAt(bookId: BookId, pinnedAt: number | null): Promise<void> {
    await this.patchPinnedAt(bookId, () => pinnedAt);
  }

  async patchPinnedAt(bookId: BookId, patch: (current: number | null) => number | null): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.pinnedAtByBookId?.[bookId] ?? null;
      const nextValue = patch(current);
      const next = { ...(snapshot.pinnedAtByBookId ?? {}) };
      if (nextValue === null) {
        delete next[bookId];
      } else {
        next[bookId] = nextValue;
      }
      // Nothing changed → hand back the same reference so mutate() skips the write.
      if (nextValue === current && (snapshot.pinnedAtByBookId ?? {})[bookId] === nextValue) {
        return snapshot;
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
      // P1 修复: 跟 `setAddedAt` 保持一致 — 保留较大旧值. 之前
      // `addedAtByBookId[id] > addedAt → 写 addedAt` 在书已有较晚时间戳时
      // 会回退到当前 now (例如用户改系统时间, 或 data.json 里手动写入
      // 了未来时间戳), 违反 first-added wins 语义. 现在统一:
      // "保留较大值" = current 已是较大 → 跳过; 否则 → 写.
      const addedAtByBookId = { ...existingAddedAt };
      for (const id of newIds) {
        const current = addedAtByBookId[id];
        if (typeof current === "number" && current >= addedAt) continue;
        addedAtByBookId[id] = addedAt;
      }
      return { ...snapshot, library, addedAtByBookId };
    });
  }

  async hasOnboardingBeenDismissed(): Promise<boolean> {
    const snapshot = await this.load();
    return snapshot.onboardingDismissed === true;
  }

  /**
   * P2: 读 visited toc ids. 旧 data.json 没 visitedTocIdsByBookId 字段
   * 时 load() 已 fallback 到空 map, 这里直接读.
   */
  async loadVisitedTocIds(bookId: BookId): Promise<ReadonlyArray<string>> {
    const snapshot = await this.load();
    return snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }

  /**
   * P2: 写 visited toc ids. 在 write chain 内做 (跟 setPinnedAt 同样的
   * mutate 模式) — 避免两个并发 caller (relocate 触发多个 chapter
   * visited) 各 load 一份旧 array 后互相覆盖. caller 自己负责去重
   * (ReaderView.schedulePersistVisited 维护本地 Set).
   */
  async saveVisitedTocIds(bookId: BookId, ids: ReadonlyArray<string>): Promise<void> {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.visitedTocIdsByBookId ?? {};
      // ids 是 caller 的完整数组 (ReaderView 把 tocFractions.keys() 拼出来),
      // 直接 overwrite. 如果 caller 想增量 append 也行 — 这里不强制去重,
      // 但 saveVisitedTocIds 之前 caller 自己保证不重复 (用 Set 维护).
      const next = { ...current, [bookId]: [...ids] };
      return { ...snapshot, visitedTocIdsByBookId: next };
    });
  }

  private normalizeSettings(input: PluginSettings | undefined): PluginSettings {
    if (!input) return DEFAULT_PLUGIN_SETTINGS;
    return { ...DEFAULT_PLUGIN_SETTINGS, ...input };
  }
}