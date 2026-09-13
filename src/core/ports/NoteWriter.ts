/**
 * Port for writing excerpt / thought notes to the vault. The port is
 * intentionally framework-agnostic; the Obsidian adapter under
 * `adapters/obsidian/ObsidianNoteWriter` is the only implementation today.
 *
 * Each excerpt is persisted in two places:
 *   1. The plugin's own AnnotationStore (already wired) — used by the
 *      reader UI to list / navigate / edit excerpts while reading.
 *   2. A Markdown file under the user's configured notesDirectory —
 *      gives them a real Obsidian note they can search, link to, and
 *      sync via Syncthing.
 *
 * The two are bridged by `excerptId` — the same id appears as a
 * Markdown block ID (`^<excerptId>`) in the note, and the note contains
 * a "return to source" link using the `obsidian://<plugin-id>?annotation=<id>`
 * protocol that the plugin handles via `registerObsidianProtocolHandler`.
 */

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
  readonly format: "epub" | "pdf";
  readonly createdAt: number;
}

export interface ThoughtInput {
  readonly text: string;
  readonly locator: string;
  readonly createdAt: number;
  readonly tags: ReadonlyArray<string>;
}

export interface BookNoteRef {
  /** Vault-relative path of the note file. */
  readonly path: string;
  /** Book id (slug used as part of the filename). */
  readonly bookId: string;
  /** Display title of the book (used in note heading). */
  readonly title: string;
}

export interface BookLocatorInfo {
  readonly bookId: string;
  readonly format: string;
  readonly locator: unknown;
}

export interface NoteWriter {
  /**
   * Ensure the per-book note exists. Returns the path / ref so callers
   * can chain `appendExcerpt` / `appendThought`. Idempotent.
   */
  ensureBookNote(input: { bookId: string; bookTitle: string; bookPath: string }): Promise<BookNoteRef>;

  /** Append an excerpt block to the per-book note. */
  appendExcerpt(ref: BookNoteRef, input: ExcerptInput): Promise<void>;

  /** Append a standalone thought to the per-book note. */
  appendThought(ref: BookNoteRef, input: ThoughtInput): Promise<void>;

  /** Resolve an excerptId back to where it lives (for protocol handler). */
  resolveExcerptLink(excerptId: string): Promise<BookLocatorInfo | null>;
}
