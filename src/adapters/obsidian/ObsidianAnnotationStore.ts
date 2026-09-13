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

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<AnnotationSnapshot> {
    if (this.cache) return this.cache;
    const raw = (await this.plugin.loadData()) as Partial<AnnotationSnapshot> | null;
    const settings = this.normalizeSettings(raw?.settings);
    this.cache = {
      version: 1,
      settings,
      reading: raw?.reading ?? [],
      bookmarks: raw?.bookmarks ?? [],
      excerpts: raw?.excerpts ?? []
    };
    return this.cache;
  }

  async save(snapshot: AnnotationSnapshot): Promise<void> {
    this.cache = snapshot;
    await this.plugin.saveData(snapshot as unknown as Record<string, unknown>);
  }

  async listReading(): Promise<ReadonlyArray<ReadingState>> {
    const snapshot = await this.load();
    return snapshot.reading;
  }

  async upsertReading(state: ReadingState): Promise<void> {
    const snapshot = await this.load();
    const next = [...snapshot.reading.filter((s) => s.bookId !== state.bookId), state];
    await this.save({ ...snapshot, reading: next });
  }

  async listBookmarks(bookId: BookId): Promise<ReadonlyArray<Bookmark>> {
    const snapshot = await this.load();
    return snapshot.bookmarks.filter((bookmark) => bookmark.bookId === bookId);
  }

  async addBookmark(bookmark: Bookmark): Promise<void> {
    const snapshot = await this.load();
    await this.save({ ...snapshot, bookmarks: [...snapshot.bookmarks, bookmark] });
  }

  async removeBookmark(bookId: BookId, bookmarkId: string): Promise<void> {
    const snapshot = await this.load();
    await this.save({
      ...snapshot,
      bookmarks: snapshot.bookmarks.filter((b) => !(b.bookId === bookId && b.id === bookmarkId))
    });
  }

  async listExcerpts(bookId: BookId): Promise<ReadonlyArray<Excerpt>> {
    const snapshot = await this.load();
    return snapshot.excerpts.filter((excerpt) => excerpt.bookId === bookId);
  }

  async addExcerpt(excerpt: Excerpt): Promise<void> {
    const snapshot = await this.load();
    await this.save({ ...snapshot, excerpts: [...snapshot.excerpts, excerpt] });
  }

  async removeExcerpt(bookId: BookId, excerptId: string): Promise<void> {
    const snapshot = await this.load();
    await this.save({
      ...snapshot,
      excerpts: snapshot.excerpts.filter((e) => !(e.bookId === bookId && e.id === excerptId))
    });
  }

  async listSettings(): Promise<PluginSettings> {
    const snapshot = await this.load();
    return snapshot.settings;
  }

  async saveSettings(settings: PluginSettings): Promise<void> {
    const snapshot = await this.load();
    await this.save({ ...snapshot, settings });
  }

  private normalizeSettings(input: PluginSettings | undefined): PluginSettings {
    if (!input) return DEFAULT_PLUGIN_SETTINGS;
    return { ...DEFAULT_PLUGIN_SETTINGS, ...input };
  }
}