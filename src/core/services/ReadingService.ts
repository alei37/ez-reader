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
 *
 * Optional `onChange` callback fires whenever a reading state is written
 * (openBook / updatePosition / setStatus / toggleFavorite). Callers use
 * this to keep derived state in sync — e.g. LibraryService.updateReading
 * so the shelf refreshes and the next ReaderView.open reads the latest
 * position for resume. Bookmarks / excerpts don't fire it because they
 * don't change the reading state.
 */
export class ReadingService {
  constructor(
    private readonly annotations: AnnotationStore,
    private readonly onChange?: (state: ReadingState) => void | Promise<void>
  ) {}

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
    await this.fireChange(next);
    return next;
  }

  /** Persist a new position and re-classify status if needed. */
  async updatePosition(bookId: BookId, position: ReadingPosition): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const fraction = computeFraction(position);
    const status = inferStatus(state.status, fraction);
    const next: ReadingState = { ...state, position, status };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }

  async setStatus(bookId: BookId, status: ReadingState["status"]): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const next: ReadingState = { ...state, status };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }

  async toggleFavorite(bookId: BookId): Promise<ReadingState> {
    const state = await this.getState(bookId);
    const next: ReadingState = { ...state, favorite: !state.favorite };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }

  /**
   * P1: 累加阅读时长. 通过 ReaderView 的 active-leaf 监听器触发,
   * deltaMs 来自"上次 active 到这次 inactive"的间隔。
   * 不触发 onChange (shelf 不需要立即 re-render — 累计是后台行为)。
   */
  async addReadingTime(bookId: BookId, deltaMs: number): Promise<ReadingState> {
    if (deltaMs <= 0) return this.getState(bookId);
    const state = await this.getState(bookId);
    const next: ReadingState = {
      ...state,
      totalReadingMs: (state.totalReadingMs ?? 0) + deltaMs
    };
    await this.annotations.upsertReading(next);
    return next;
  }

  /** Fire onChange (if registered), swallowing errors so a listener
   *  failure doesn't break the write that already succeeded. */
  private async fireChange(state: ReadingState): Promise<void> {
    if (!this.onChange) return;
    try {
      await this.onChange(state);
    } catch (error) {
      console.warn("[ez-reader] ReadingService.onChange listener failed", error);
    }
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

  /**
   * P2: 只 patch note / tags 字段, 不重写整张 excerpt. 配合 notes panel
   * 的 inline edit — 用户 blur 出 note 字段 → 立即调这个, 不重新写
   * highlight (locator 没变), 也不改 createdAt / text.
   */
  async updateExcerptNote(
    bookId: BookId,
    excerptId: string,
    patch: { note?: string; tags?: ReadonlyArray<string> }
  ): Promise<void> {
    await this.annotations.updateExcerptNote(bookId, excerptId, patch);
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
  if (position.kind === "reflow" || position.kind === "text" || position.kind === "pdf") {
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