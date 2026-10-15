import type { Bookmark } from "../entities/Bookmark";
import type { BookId } from "../entities/Book";
import type { Excerpt } from "../entities/Excerpt";
import type { ReadingPosition, ReadingState } from "../entities/ReadingState";
import type { ReadingSession, DailyReadingTime } from "../entities/ReadingSession";
import type { AnnotationStore } from "../ports/AnnotationStore";
import type { LibraryWriter } from "../ports/LibraryWriter";
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
 *
 * Optional `libraryWriter` (v0.3.0) is used for reading-time analytics
 * (recordSession / getDailyReadingTime). When omitted (tests, old callers)
 * those methods become no-ops.
 */
export class ReadingService {
  constructor(
    private readonly annotations: AnnotationStore,
    private readonly onChange?: (state: ReadingState) => void | Promise<void>,
    private readonly libraryWriter?: LibraryWriter
  ) {}

  /** Get current state, falling back to a default. */
  async getState(bookId: BookId): Promise<ReadingState> {
    const all = await this.annotations.listReading();
    return all.find((state) => state.bookId === bookId) ?? defaultReadingState(bookId);
  }

  /**
   * Apply `patch` to one book's ReadingState atomically, inside the store's
   * write chain, and return the persisted result.
   *
   * P0 修复: 这个类之前每个方法都是 `getState()` → 造一条**完整**的
   * ReadingState → `upsertReading()` 整条替换。`upsertReading` 看起来是原子的,
   * 但 `mutate()` 的 writeChain 只串行化**写盘**, `getState()` 那次**读发生在
   * 链外** —— 于是两个并发 caller 读到同一份 base, 后写的赢, 先写的字段凭空
   * 消失。
   *
   * 这在生产里是天天发生的:ReaderView 的 `flushReadingTime` → `addReadingTime`
   * 和 relocate 的 `updatePosition` 是两条互不等待的路径。实测(修复前):
   * 20 次并发 flush 只记下 1 次(1000ms 而不是 20000ms)。
   *
   * 端口上已经有 `patchSettings` / `patchCoverPaths` 这个形状, ReadingState
   * 当时只是没迁移过去。
   */
  private async patchState(
    bookId: BookId,
    patch: (current: ReadingState) => ReadingState,
    now = Date.now()
  ): Promise<ReadingState> {
    let result: ReadingState | undefined;
    await this.annotations.patchReading(bookId, (current) => {
      const base = current ?? defaultReadingState(bookId, now);
      const next = patch(base);
      // Carry an explicit timestamp into a freshly-seeded state so
      // `defaultReadingState(bookId, now)` stays the single source for it.
      result = next;
      return next;
    });
    // patchReading only returns null when the caller asked to skip; this
    // implementation never does, so `result` is always set.
    return result ?? defaultReadingState(bookId, now);
  }

  /** Mark a book as currently being read and bump the lastOpenedAt. */
  async openBook(bookId: BookId, now = Date.now()): Promise<ReadingState> {
    const next = await this.patchState(
      bookId,
      (state) => ({
        ...state,
        lastOpenedAt: now,
        status: state.status === "unread" ? "reading" : state.status
      }),
      now
    );
    await this.fireChange(next);
    return next;
  }

  /** Persist a new position and re-classify status if needed. */
  async updatePosition(bookId: BookId, position: ReadingPosition): Promise<ReadingState> {
    const fraction = computeFraction(position);
    const next = await this.patchState(bookId, (state) => ({
      ...state,
      position,
      status: inferStatus(state.status, fraction)
    }));
    await this.fireChange(next);
    return next;
  }

  async setStatus(bookId: BookId, status: ReadingState["status"]): Promise<ReadingState> {
    const next = await this.patchState(bookId, (state) => ({ ...state, status }));
    await this.fireChange(next);
    return next;
  }

  async toggleFavorite(bookId: BookId): Promise<ReadingState> {
    const next = await this.patchState(bookId, (state) => ({ ...state, favorite: !state.favorite }));
    await this.fireChange(next);
    return next;
  }

  /**
   * P1: 累加阅读时长. 通过 ReaderView 的 active-leaf 监听器触发,
   * deltaMs 来自"上次 active 到这次 inactive"的间隔。
   * 不触发 onChange (shelf 不需要立即 re-render — 累计是后台行为)。
   *
   * P0: 之前这里是 lost update 最严重的一处 —— 它跟 `updatePosition` 落在
   * 同一个 tick 时, 整个 delta 会被 position 那次写覆盖掉。现在两者都走
   * `patchState`, 在同一条 writeChain 上排队, 互不干扰。
   */
  async addReadingTime(bookId: BookId, deltaMs: number): Promise<ReadingState> {
    if (deltaMs <= 0) return this.getState(bookId);
    return this.patchState(bookId, (state) => ({
      ...state,
      totalReadingMs: (state.totalReadingMs ?? 0) + deltaMs
    }));
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

  /**
   * P2: 读取这本书用户翻过的 toc item id 列表. ReaderView 在 openSession
   * 完成后立即调, 把结果传给 TocPanel.setVisited, 让进度点从第一次
   * 打开就有绿色 (而不是要等下次 relocate 才填).
   */
  async getVisitedTocIds(bookId: BookId): Promise<ReadonlyArray<string>> {
    return this.annotations.loadVisitedTocIds(bookId);
  }

  /**
   * P2: 写这本书的 visited toc ids (覆盖). ReaderView 在 debounce 后调,
   * 跟 progress 持久化一样 300ms 兜底, 不每次 relocate 都写盘. ids 是
   * 当前 user 翻过的所有 toc id (caller 自己维护 Set 去重).
   */
  async saveVisitedTocIds(bookId: BookId, ids: ReadonlyArray<string>): Promise<void> {
    await this.annotations.saveVisitedTocIds(bookId, ids);
  }

  /**
   * v0.3.0: 记录一次阅读 session. ReaderView 在 flushActiveSession 时调,
   * 把 session 持久化到 `ezreader/sessions/<title>-<id>.jsonl`,
   * 供后续 getDailyReadingTime 聚合用.
   *
   * 不触发 onChange (shelf 不需要每次 session 都重渲染 — ReadingState
   * 的 totalReadingMs 由 addReadingTime 单独维护).
   *
   * `titleHint` (P1 v0.3.0 fix): caller 传入真实书名. LibraryWriter
   * 内部用 bookTitle 算 filename (`<safeTitle>-<id>`), 缺 titleHint
   * 时 fallback 到 bookId 会 orphan 老 sessions.jsonl (因为后续
   * appendExcerpt 传真 title 会创建另一个 file path). PDF / TXT 场景
   * session.chapter 是 undefined, ReaderView 用 entry.book.metadata.title,
   * PdfOverlay 用 file basename — 两者都比 bookId 稳定.
   */
  async recordSession(
    bookId: BookId,
    session: ReadingSession,
    titleHint?: string
  ): Promise<void> {
    if (session.durationMs <= 0) return;
    if (this.libraryWriter) {
      try {
        const ref = await this.libraryWriter.ensureBookDir({
          bookId,
          bookTitle: titleHint ?? session.chapter ?? bookId,
          bookPath: ""
        });
        await this.libraryWriter.appendReadingSession(ref, session);
      } catch (error) {
        console.warn("[ez-reader] recordSession failed", bookId, error);
      }
    }
  }

  /**
   * v0.3.0: 读最近 N 天每日阅读时长. 返回值按日期降序排列, gaps 用
   * 0-bucket 填充, 始终有 `days` 个条目.
   */
  async getDailyReadingTime(bookId: BookId, days: number): Promise<ReadonlyArray<DailyReadingTime>> {
    if (!this.libraryWriter) return [];
    let sessions: ReadonlyArray<ReadingSession> = [];
    try {
      sessions = await this.libraryWriter.loadReadingSessions(bookId);
    } catch (error) {
      console.warn("[ez-reader] getDailyReadingTime: loadReadingSessions failed", bookId, error);
      return [];
    }
    // Lazy import to keep the dep graph one-way (core/ → adapters/, never back).
    const { aggregateDailyReadingTime } = await import("../../adapters/obsidian/dailyReadingTime");
    return aggregateDailyReadingTime(sessions, days);
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