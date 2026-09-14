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

  constructor(private readonly plugin: Plugin) {}

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
      coverPaths: this.sanitizeRecord(raw?.coverPaths)
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

  private normalizeSettings(input: PluginSettings | undefined): PluginSettings {
    if (!input) return DEFAULT_PLUGIN_SETTINGS;
    return { ...DEFAULT_PLUGIN_SETTINGS, ...input };
  }
}