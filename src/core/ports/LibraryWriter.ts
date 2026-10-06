import type { BookInfo } from "../entities/BookInfo";
import type { BookId } from "../entities/Book";
import type { ReadingSession } from "../entities/ReadingSession";

/**
 * Port for writing per-book files into the vault. Replaces the old
 * `NoteWriter` port — now spans excerpts / thoughts / book info /
 * reading-session log under a single, cohesive API.
 *
 * File layout (under `<vault>/<baseDir>/`, where `baseDir` defaults to
 * `"ezreader/"`):
 *
 *   <baseDir>/notes/<safeTitle>-<id>.md       ← excerpt + thought blocks
 *   <baseDir>/info/<safeTitle>-<id>.md        ← YAML frontmatter + auto body
 *   <baseDir>/sessions/<safeTitle>-<id>.jsonl ← append-only session log
 *
 * The three sub-directories are flat (no per-book folder) so users can
 * `ls` them, search across books, or set up Dataview queries without
 * traversing nested folders. Existing excerpts are migrated from the
 * old `notesDirectory` setting on first run (see `ObsidianLibraryWriter.migrate`).
 */

// ============================================================================
// Excerpt / Thought (carried over from NoteWriter verbatim for backward compat)
// ============================================================================

export interface ExcerptInput {
  readonly excerptId: string;
  readonly text: string;
  readonly note: string;
  readonly tags: ReadonlyArray<string>;
  readonly locator: {
    readonly cfi?: string;
    readonly fraction: number;
    readonly page?: number;
  };
  readonly chapterTitle?: string;
  /**
   * Source format. Originally restricted to "epub" | "pdf" before the
   * TXT/MOBI/AZW3 readers shipped — now reflects every format that can
   * produce excerpts. The LibraryWriter formats the "📖 来源" line
   * differently per format (EPUB shows the chapter, PDF shows the page).
   */
  readonly format: import("../entities/Book").BookFormat;
  readonly createdAt: number;
}

export interface ThoughtInput {
  /**
   * Stable id for the thought. Used as the markdown block-id (`^thought-<id>`)
   * — must be globally unique so multiple thoughts saved in the same
   * millisecond don't dedupe-collide. The reader generates this with
   * `crypto.randomUUID()`; the LibraryWriter just propagates it.
   */
  readonly thoughtId: string;
  readonly text: string;
  readonly locator: string;
  readonly createdAt: number;
  readonly tags: ReadonlyArray<string>;
}

// ============================================================================
// Book ref — opaque handle returned by ensureBookDir; threads through every
// per-book write so callers don't repeat bookId/title/path on every call.
// ============================================================================

export interface BookDirRef {
  /** Vault-relative path of the per-book notes file (`.md`). */
  readonly notesPath: string;
  /** Vault-relative path of the per-book info file (`.md`). */
  readonly infoPath: string;
  /** Vault-relative path of the per-book sessions file (`.jsonl`). */
  readonly sessionsPath: string;
  /** Book id (slug used as part of the filename). */
  readonly bookId: BookId;
  /** Display title of the book (used in note headings, frontmatter title). */
  readonly title: string;
  /** Vault-relative path of the original book file (EPUB/PDF/etc). */
  readonly bookPath: string;
}

// ============================================================================
// Locator resolution (carried over from NoteWriter)
// ============================================================================

export interface BookLocatorInfo {
  readonly bookId: string;
  readonly format: string;
  readonly locator: unknown;
}

// ============================================================================
// Port interface
// ============================================================================

export interface LibraryWriter {
  /**
   * Ensure the per-book sub-files exist (notes.md, info.md, sessions.jsonl).
   * Returns a `BookDirRef` so callers can chain `appendExcerpt` etc.
   * Idempotent: re-invoking with the same bookId returns the cached ref.
   */
  ensureBookDir(input: { bookId: BookId; bookTitle: string; bookPath: string }): Promise<BookDirRef>;

  /** Append an excerpt block to the per-book notes file. */
  appendExcerpt(ref: BookDirRef, input: ExcerptInput): Promise<void>;

  /** Append a standalone thought to the per-book notes file. */
  appendThought(ref: BookDirRef, input: ThoughtInput): Promise<void>;

  /**
   * Write (overwrite) the per-book info file. The adapter formats
   * `BookInfo` as YAML frontmatter + a brief markdown body. Caller is
   * expected to pass a fully-populated `BookInfo` — partial updates are
   * the caller's job (read-modify-write).
   */
  writeBookInfo(ref: BookDirRef, info: BookInfo): Promise<void>;

  /**
   * Read the per-book info file, or `null` if it doesn't exist yet.
   * Adapter parses YAML frontmatter and merges with defaults; corrupted
   * files return `null` (not throw) so a broken info file doesn't block
   * shelf rendering.
   */
  readBookInfo(bookId: BookId): Promise<BookInfo | null>;

  /**
   * Append a reading session to the per-book `.jsonl` log. The adapter
   * appends one JSON object + newline; never rewrites history.
   */
  appendReadingSession(ref: BookDirRef, session: ReadingSession): Promise<void>;

  /**
   * Load all reading sessions for a book. Adapter reads the `.jsonl` log
   * and parses line-by-line; corrupted lines are silently dropped (logged
   * once at warn level) so a single bad entry doesn't kill the log.
   */
  loadReadingSessions(bookId: BookId): Promise<ReadonlyArray<ReadingSession>>;

  /**
   * Resolve an excerptId back to where it lives (for the protocol handler).
   * Carried over from NoteWriter for backward compatibility.
   */
  resolveExcerptLink(excerptId: string): Promise<BookLocatorInfo | null>;

  /**
   * One-shot migration from the legacy `notesDirectory/` (configurable,
   * default `ezreader-notes/阅读笔记/`) into the new `ezreader/notes/`
   * layout. Idempotent: returns `migrated: 0` when no legacy files are
   * found. Returns counts so callers can show "已迁移 12 个笔记".
   *
   * After successful migration the adapter clears `settings.notesDirectory`
   * to empty / deletes the old directory (whichever the caller chooses
   * based on its tolerance for file deletion). The adapter itself does
   * NOT delete — it leaves that decision to Plugin.
   */
  migrateLegacyNotes(input: { legacyNotesDir: string }): Promise<MigrationResult>;
}

export interface MigrationResult {
  /** Number of `.md` files successfully moved into `ezreader/notes/`. */
  readonly migratedNotes: number;
  /** Number of legacy files that failed to move (logged individually). */
  readonly failedNotes: number;
  /** Book ids that were migrated, in the order they were processed. */
  readonly migratedBookIds: ReadonlyArray<BookId>;
}
