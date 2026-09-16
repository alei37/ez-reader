import type { Bookmark } from "../entities/Bookmark";
import type { BookId } from "../entities/Book";
import type { Excerpt } from "../entities/Excerpt";
import type { ReadingPosition, ReadingState } from "../entities/ReadingState";
import type { AnnotationStore } from "../ports/AnnotationStore";
import { defaultReadingState, progressFraction } from "../entities/ReadingState";

/**
 * Reading service. The shelf view and reader view go through this service
 * for any mutation: bookmark add, excerpt add, progress update, status
 * change. This isolates the rules (e.g. "opening a book transitions status
 * from unread to reading") from the persistence and the UI.
 */
export class ReadingService {
  constructor(private readonly annotations: AnnotationStore) {}

  /** Get current state, falling back to a default. */
  async getState(bookId: BookId): Promise<ReadingState> {
    const all = await this.annotations.listReading();
    return all.find((state) => state.bookId === bookId) ?? defaultReadingState(bookId);
  }

  /** Mark a book as currently being read and bump the lastOpenedAt. */
  async openBook(bookId: BookId, now = Date.now()): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const next: ReadingState = {
      ...state,
      lastOpenedAt: now,
      status: state.status === "unread" ? "reading" : state.status
    };
    await this.annotations.upsertReading(next);
    return next;
  }

  /** Persist a new position and re-classify status if needed. */
  async updatePosition(bookId: BookId, position: ReadingPosition): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const fraction = computeFraction(position);
    const status = inferStatus(state.status, fraction);
    const next: ReadingState = { ...state, position, status };
    await this.annotations.upsertReading(next);
    return next;
  }

  async setStatus(bookId: BookId, status: ReadingState["status"]): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const next: ReadingState = { ...state, status };
    await this.annotations.upsertReading(next);
    return next;
  }

  async toggleFavorite(bookId: BookId): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const next: ReadingState = { ...state, favorite: !state.favorite };
    await this.annotations.upsertReading(next);
    return next;
  }

  async addBookmark(bookmark: Bookmark): Promise<void> {
    await this.annotations.addBookmark(bookmark);
  }

  async removeBookmark(bookId: BookId, bookmarkId: string): Promise<void> {
    await this.annotations.removeBookmark(bookId, bookmarkId);
  }

  async listBookmarks(bookId: BookId): Promise<ReadonlyArray<Bookmark>> {
    return this.annotations.listBookmarks(bookId);
  }

  async addExcerpt(excerpt: Excerpt): Promise<void> {
    await this.annotations.addExcerpt(excerpt);
  }

  async removeExcerpt(bookId: BookId, excerptId: string): Promise<void> {
    await this.annotations.removeExcerpt(bookId, excerptId);
  }

  async listExcerpts(bookId: BookId): Promise<ReadonlyArray<Excerpt>> {
    return this.annotations.listExcerpts(bookId);
  }

  /** Read the configured translation target locale, with sensible default. */
  async getTranslationLocale(): Promise<string> {
    try {
      const settings = await this.annotations.listSettings();
      const locale = settings.translation?.targetLocale;
      return typeof locale === "string" && locale ? locale : "zh-CN";
    } catch {
      return "zh-CN";
    }
  }
}

const computeFraction = (position: ReadingPosition): number => {
  if (position.kind === "reflow" || position.kind === "text") {
    return progressFraction({
      bookId: "",
      position,
      status: "reading",
      favorite: false,
      lastOpenedAt: null,
      totalReadingMs: 0
    });
  }
  return 0;
};

const inferStatus = (current: ReadingState["status"], fraction: number): ReadingState["status"] => {
  if (current === "finished" || current === "abandoned") return current;
  if (fraction >= 0.95) return "finished";
  if (fraction > 0) return "reading";
  return current === "unread" ? "unread" : "reading";
};