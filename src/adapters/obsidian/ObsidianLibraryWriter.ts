import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { Plugin } from "obsidian";
import type { AnnotationStore } from "../../core/ports/AnnotationStore";
import type {
  BookDirRef,
  BookLocatorInfo,
  ExcerptInput,
  LibraryWriter,
  MigrationResult,
  RenameBookFilesResult,
  ThoughtInput
} from "../../core/ports/LibraryWriter";
import type { BookId } from "../../core/entities/Book";
import type { BookInfo } from "../../core/entities/BookInfo";
import type { ReadingSession } from "../../core/entities/ReadingSession";
import { defaultBookInfo } from "../../core/entities/BookInfo";
import { bookInfoFromFrontmatter, parseFrontmatter, serializeBookInfo } from "./frontmatter";
import { hexFromBuffer, sha1Bytes } from "../../platform/Sha1";

const PROTOCOL = "ez-reader";

/**
 * Base directory under the vault root where all per-book files live.
 *
 * The layout is intentionally flat — three sub-directories side by side,
 * no per-book folder:
 *
 *   <vaultRoot>/ezreader/notes/<safeTitle>-<id>.md
 *   <vaultRoot>/ezreader/info/<safeTitle>-<id>.md
 *   <vaultRoot>/ezreader/sessions/<safeTitle>-<id>.jsonl
 *
 * Legacy layouts (v0.2.x): `notesDirectory/` defaults to
 * `ezreader-notes/阅读笔记/` with a single flat `.md` per book. We
 * migrate on first run via `migrateLegacyNotes`.
 */
export const LIBRARY_BASE_DIR = "ezreader";
const NOTES_SUBDIR = "notes";
const INFO_SUBDIR = "info";
const SESSIONS_SUBDIR = "sessions";

/**
 * Obsidian-side implementation of `LibraryWriter`. Replaces
 * `ObsidianNoteWriter` from v0.2.x — same per-book notes file format
 * (block-id–keyed excerpts / thoughts), plus the new info.md and
 * sessions.jsonl siblings.
 */
export class ObsidianLibraryWriter implements LibraryWriter {
  private readonly cacheByBookId = new Map<BookId, BookDirRef>();
  // Serialize concurrent writes to the same path. vault.process is not
  // atomic across calls — two saves landing in the same tick would
  // race the read() and the second process() would clobber the first.
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly annotations: AnnotationStore
  ) {}

  // -----------------------------------------------------------------------
  // ensureBookDir
  // -----------------------------------------------------------------------

  async ensureBookDir(input: { bookId: BookId; bookTitle: string; bookPath: string }): Promise<BookDirRef> {
    const cached = this.cacheByBookId.get(input.bookId);
    if (cached) return cached;

    await this.ensureDirectory(LIBRARY_BASE_DIR);
    await this.ensureDirectory(`${LIBRARY_BASE_DIR}/${NOTES_SUBDIR}`);
    await this.ensureDirectory(`${LIBRARY_BASE_DIR}/${INFO_SUBDIR}`);
    await this.ensureDirectory(`${LIBRARY_BASE_DIR}/${SESSIONS_SUBDIR}`);

    const safeTitle = sanitizeFileBase(input.bookTitle || input.bookPath.split("/").pop() || input.bookId);
    const fileBase = await this.resolveFileBase(input.bookId, safeTitle);
    const notesPath = normalizePath(`${LIBRARY_BASE_DIR}/${NOTES_SUBDIR}/${fileBase}.md`);
    const infoPath = normalizePath(`${LIBRARY_BASE_DIR}/${INFO_SUBDIR}/${fileBase}.md`);
    const sessionsPath = normalizePath(`${LIBRARY_BASE_DIR}/${SESSIONS_SUBDIR}/${fileBase}.jsonl`);

    // Create the notes file if it doesn't exist. info.md / sessions.jsonl
    // are created lazily on first writeBookInfo / appendReadingSession
    // because they're not useful when empty.
    if (!(this.app.vault.getAbstractFileByPath(notesPath) instanceof TFile)) {
      const header = renderNotesHeader(input);
      await this.app.vault.create(notesPath, header);
    }

    const ref: BookDirRef = {
      notesPath,
      infoPath,
      sessionsPath,
      bookId: input.bookId,
      title: input.bookTitle,
      bookPath: input.bookPath
    };
    this.cacheByBookId.set(input.bookId, ref);
    return ref;
  }

  /**
   * Build the `<safeTitle>-<idTag>` file base for a book.
   *
   * P0 fix: `bookId` IS the vault path (`ObsidianBookSource.resolveId`
   * returns `locator.path`), so the old `bookId.slice(0, 8)` could contain
   * a `/` — e.g. `books/dune.epub` → `Dune-books/du.md` → a path whose
   * parent directory does not exist → `vault.create` throws ENOENT and
   * every excerpt for that book is silently dropped. Any vault with a
   * 5–7 character top-level folder (`books/`, `notes/`, `library/`) hit
   * this.
   *
   * It was ALSO not unique: a path prefix is shared by everything under the
   * same first 8 characters, so every book in `04-resources/books/` produced
   * the tag `04-resou`. Sanitizing the prefix does not help — it is still a
   * prefix. The tag is now a hash of the whole bookId: path-safe AND
   * collision-free.
   *
   * The legacy raw-slice form is still checked first: it could only ever
   * have produced a working path when the first path segment was ≥ 8
   * characters, so existing `notes/*.md` files under such vaults must stay
   * reachable or they'd be orphaned by the upgrade.
   */
  private async resolveFileBase(bookId: BookId, safeTitle: string): Promise<string> {
    const legacyTag = bookId.slice(0, 8);
    if (!legacyTag.includes("/")) {
      const legacyBase = `${safeTitle}-${legacyTag}`;
      const legacyNotes = `${LIBRARY_BASE_DIR}/${NOTES_SUBDIR}/${legacyBase}.md`;
      if (this.app.vault.getAbstractFileByPath(legacyNotes) instanceof TFile) {
        return legacyBase;
      }
    }
    return `${safeTitle}-${bookIdTag(bookId)}`;
  }

  /**
   * Locate `ezreader/<subdir>/<safeTitle>-<idTag><ext>` for a book without
   * relying on `info.md` or on knowing the book's title.
   *
   * The id tag is derived from the bookId alone, and every per-book file is
   * named `<something>-<idTag><ext>`, so a suffix match over a directory
   * listing identifies the right file no matter what the title was. This is
   * what makes a rename recoverable: the caller knows only the OLD bookId,
   * never the old title. Both the sanitized and the legacy raw-slice tags
   * are tried. Returns `undefined` when nothing matches.
   */
  private async findPathByIdTag(
    bookId: BookId,
    subdir: string,
    ext: string
  ): Promise<string | undefined> {
    const dir = normalizePath(`${LIBRARY_BASE_DIR}/${subdir}`);
    let files: ReadonlyArray<string>;
    try {
      files = (await this.app.vault.adapter.list(dir)).files;
    } catch {
      return undefined;
    }
    const legacyTag = bookId.slice(0, 8);
    const tags = [bookIdTag(bookId)];
    if (!legacyTag.includes("/") && !tags.includes(legacyTag)) tags.push(legacyTag);

    for (const filePath of files) {
      if (!filePath.toLowerCase().endsWith(`.${ext}`)) continue;
      const stem = filePath.split("/").pop()!.replace(/\.[^.]+$/, "");
      if (tags.some((tag) => tag.length > 0 && stem.endsWith(`-${tag}`))) return filePath;
    }
    return undefined;
  }

  async renameBookFiles(input: {
    fromBookId: BookId;
    toBookId: BookId;
    newTitle: string;
  }): Promise<RenameBookFilesResult> {
    const moved: string[] = [];
    const missing: string[] = [];
    if (input.fromBookId === input.toBookId) return { moved, missing };

    const fallbackTitle =
      input.newTitle || input.toBookId.split("/").pop() || input.toBookId;
    const newBase = `${sanitizeFileBase(fallbackTitle)}-${bookIdTag(input.toBookId)}`;

    const targets: ReadonlyArray<{ subdir: string; ext: string }> = [
      { subdir: NOTES_SUBDIR, ext: "md" },
      { subdir: INFO_SUBDIR, ext: "md" },
      { subdir: SESSIONS_SUBDIR, ext: "jsonl" }
    ];

    for (const { subdir, ext } of targets) {
      const oldPath = await this.findPathByIdTag(input.fromBookId, subdir, ext);
      if (!oldPath) {
        missing.push(`${LIBRARY_BASE_DIR}/${subdir}/<unknown>.${ext}`);
        continue;
      }
      const newPath = normalizePath(`${LIBRARY_BASE_DIR}/${subdir}/${newBase}.${ext}`);
      if (oldPath === newPath) continue;

      const file = this.app.vault.getAbstractFileByPath(oldPath);
      if (!(file instanceof TFile)) {
        missing.push(oldPath);
        continue;
      }
      if (this.app.vault.getAbstractFileByPath(newPath) instanceof TFile) {
        // Destination occupied (a second book already claims this base).
        // Overwriting would destroy that book's notes; leave the source
        // file untouched and report it so the caller can surface it.
        missing.push(oldPath);
        continue;
      }
      await this.app.vault.rename(file, newPath);
      moved.push(oldPath);
    }

    // Drop the stale ref so the next write recomputes paths. Deliberately
    // NOT seeding a ref for `toBookId` here: we only moved the files that
    // happened to exist, and a cached ref would claim paths (notably
    // notes.md) that were never created.
    this.cacheByBookId.delete(input.fromBookId);

    return { moved, missing };
  }

  // -----------------------------------------------------------------------
  // Excerpt / Thought
  // -----------------------------------------------------------------------

  async appendExcerpt(ref: BookDirRef, input: ExcerptInput): Promise<void> {
    return this.enqueueWrite(ref.notesPath, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.notesPath);
      if (!(file instanceof TFile)) return;
      const blockIdRegex = new RegExp(`(^|\\n)\\^${escapeRegExp(input.excerptId)}\\s*$`, "m");
      const existing = await this.app.vault.read(file);
      if (blockIdRegex.test(existing)) return;
      const noteBase = ref.notesPath.split("/").pop()?.replace(/\.md$/i, "") ?? ref.title;
      const block = renderExcerptBlock(input, ref.title, ref.bookId, PROTOCOL, noteBase);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}\n\n${block}`);
    });
  }

  async appendThought(ref: BookDirRef, input: ThoughtInput): Promise<void> {
    return this.enqueueWrite(ref.notesPath, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.notesPath);
      if (!(file instanceof TFile)) return;
      const blockId = `thought-${input.thoughtId}`;
      const blockIdRegex = new RegExp(`(^|\\n)\\^${escapeRegExp(blockId)}\\s*$`, "m");
      const existing = await this.app.vault.read(file);
      if (blockIdRegex.test(existing)) return;
      const block = renderThoughtBlock(input, blockId, PROTOCOL);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}\n\n${block}`);
    });
  }

  // -----------------------------------------------------------------------
  // Book info (info.md)
  // -----------------------------------------------------------------------

  async writeBookInfo(ref: BookDirRef, info: BookInfo): Promise<void> {
    await this.enqueueWrite(ref.infoPath, async () => {
      // Read existing body so we preserve user-edited markdown below the
      // frontmatter (the default body is regenerated when the user has
      // appended content; we still strip the old body to keep file tidy,
      // but never clobber a body that doesn't match our default stub).
      const existing = this.app.vault.getAbstractFileByPath(ref.infoPath);
      let preservedBody: string | undefined;
      if (existing instanceof TFile) {
        try {
          const raw = await this.app.vault.read(existing);
          const parsed = parseFrontmatter(raw);
          if (parsed && parsed.body.trim().length > 0) {
            // Only keep body if the user (or a previous run) added content
            // beyond the auto-generated stub. The default body starts with
            // `# <title>` — anything else we treat as user content.
            const stub = `# ${info.title}`;
            if (!parsed.body.trimStart().startsWith(stub)) {
              preservedBody = parsed.body;
            }
          }
        } catch (error) {
          console.warn("[ez-reader] writeBookInfo: failed to preserve body", error);
        }
      }
      const body = preservedBody ?? undefined; // serializeBookInfo uses defaultBody if undefined
      const serialized = serializeBookInfo(info, body);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, serialized);
      } else {
        await this.app.vault.create(ref.infoPath, serialized);
      }
    });
  }

  async readBookInfo(bookId: BookId): Promise<BookInfo | null> {
    // Find the info.md by bookId — we cache bookId → infoPath but
    // bookId is hashed in the filename (only first 8 chars), so we have
    // to walk the info/ directory if the cache misses.
    const cached = this.cacheByBookId.get(bookId);
    if (cached) return this.readBookInfoFromPath(cached.infoPath, bookId);
    // Cache miss (e.g. ReaderView never opened this book). List the
    // info/ directory and pick the file whose frontmatter.bookId matches.
    return this.findAndReadBookInfo(bookId);
  }

  private async readBookInfoFromPath(path: string, bookId: BookId): Promise<BookInfo | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
      const raw = await this.app.vault.read(file);
      const parsed = parseFrontmatter(raw);
      if (!parsed) return null;
      const defaults = defaultBookInfo({
        bookId,
        format: "epub",
        filePath: "",
        fileSizeBytes: 0,
        fileModifiedAt: 0,
        addedToLibraryAt: Date.now(),
        title: bookId
      });
      return bookInfoFromFrontmatter(parsed, defaults);
    } catch (error) {
      console.warn("[ez-reader] readBookInfo failed", path, error);
      return null;
    }
  }

  private async findAndReadBookInfo(bookId: BookId): Promise<BookInfo | null> {
    const dirPath = normalizePath(`${LIBRARY_BASE_DIR}/${INFO_SUBDIR}`);
    try {
      const listed = await this.app.vault.adapter.list(dirPath);
      for (const filePath of listed.files) {
        if (!filePath.endsWith(".md")) continue;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) continue;
        try {
          const raw = await this.app.vault.read(file);
          const parsed = parseFrontmatter(raw);
          if (!parsed) continue;
          if (parsed.values.get("bookId") === bookId) {
            const defaults = defaultBookInfo({
              bookId,
              format: "epub",
              filePath: "",
              fileSizeBytes: 0,
              fileModifiedAt: 0,
              addedToLibraryAt: Date.now(),
              title: bookId
            });
            const info = bookInfoFromFrontmatter(parsed, defaults);
            // Populate cache so subsequent calls skip the directory walk.
            //
            // P0 fix: derive the sibling paths from the infoPath we actually
            // just found, instead of re-deriving them from title + bookId.
            // The old `${sanitizeFileBase(info.title)}-${bookId.slice(0,8)}`
            // reconstruction was wrong three ways:
            //   - raw bookId.slice() could inject a `/` (see resolveFileBase)
            //   - it used `info.title`, which is not necessarily the title
            //     `ensureBookDir` was called with (ReaderView passes the full
            //     locator.path as fallback, LibraryService uses the basename)
            //   - any future change to the naming scheme silently breaks it
            // `infoPath` is `ezreader/info/<base>.md` — swapping the
            // subdirectory and extension gives the exact siblings.
            this.cacheByBookId.set(bookId, {
              notesPath: siblingPath(filePath, NOTES_SUBDIR, ".md"),
              infoPath: filePath,
              sessionsPath: siblingPath(filePath, SESSIONS_SUBDIR, ".jsonl"),
              bookId,
              title: info.title,
              bookPath: info.filePath
            });
            return info;
          }
        } catch {
          // skip corrupted file
        }
      }
    } catch (error) {
      console.warn("[ez-reader] findAndReadBookInfo failed", dirPath, error);
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Reading sessions (sessions.jsonl)
  // -----------------------------------------------------------------------

  async appendReadingSession(ref: BookDirRef, session: ReadingSession): Promise<void> {
    await this.enqueueWrite(ref.sessionsPath, async () => {
      const line = JSON.stringify(session) + "\n";
      // P0 v0.3.0 fix: 用 `vault.adapter.append` 替代 `vault.process`.
      // 之前每次 append = read full file + modify + write back, O(N) per call
      // → O(N²) cumulative. 重 reader 一周就积累几千 sessions, IO 风暴.
      // adapter.append 是真正的文件追加 (kernel-level pwrite, no read).
      //
      // Obsidian 的 adapter.append 不自动创建缺失文件 — 文件不存在时
      // 会抛 ENOENT. 先 exists 检查, 没有就用 vault.create 初始化空
      // 文件再 append. enqueueWrite 串行化同 path, 避免两个 flush 并发
      // 都看到 "不存在" 然后 create 覆盖.
      const exists = await this.app.vault.adapter.exists(ref.sessionsPath);
      if (!exists) {
        await this.app.vault.create(ref.sessionsPath, line);
        return;
      }
      await this.app.vault.adapter.append(ref.sessionsPath, line);
    });
  }

  async loadReadingSessions(bookId: BookId): Promise<ReadonlyArray<ReadingSession>> {
    let sessionsPath = this.cacheByBookId.get(bookId)?.sessionsPath;
    if (!sessionsPath) {
      // P0 fix: the old code resolved the path exclusively through
      // `findAndReadBookInfo`, i.e. by finding an `info/<base>.md` that
      // carries the bookId in its frontmatter. But `writeBookInfo` has no
      // production caller, so `info/` is empty for every real user — and
      // after an Obsidian restart (cold cache) this returned `[]` even
      // though `sessions/<base>.jsonl` was sitting on disk full of data.
      // The BookInfoModal reading-time panel was therefore zero for every
      // user until they happened to re-read a book in the same session.
      //
      // Fall back to locating the sessions file by its id tag: the file
      // name is `<safeTitle>-<idTag>.jsonl` and the id tag is derived from
      // the bookId alone, so it is stable without any title or info.md.
      sessionsPath = await this.findPathByIdTag(bookId, SESSIONS_SUBDIR, "jsonl");
      if (sessionsPath) {
        this.cacheByBookId.set(bookId, {
          notesPath: siblingPath(sessionsPath, NOTES_SUBDIR, ".md"),
          infoPath: siblingPath(sessionsPath, INFO_SUBDIR, ".md"),
          sessionsPath,
          bookId,
          title: "",
          bookPath: bookId
        });
      }
    }
    if (!sessionsPath) return [];
    const file = this.app.vault.getAbstractFileByPath(sessionsPath);
    if (!(file instanceof TFile)) return [];
    let raw: string;
    try {
      raw = await this.app.vault.read(file);
    } catch (error) {
      console.warn("[ez-reader] loadReadingSessions failed", sessionsPath, error);
      return [];
    }
    const sessions: ReadingSession[] = [];
    let skipped = 0;
    for (const line of raw.split(/\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed = JSON.parse(trimmed) as ReadingSession;
        if (
          typeof parsed.startedAt === "number" &&
          typeof parsed.endedAt === "number" &&
          typeof parsed.durationMs === "number" &&
          typeof parsed.progressStart === "number" &&
          typeof parsed.progressEnd === "number"
        ) {
          sessions.push(parsed);
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      console.warn(`[ez-reader] loadReadingSessions: skipped ${skipped} corrupted lines in ${sessionsPath}`);
    }
    return sessions;
  }

  // -----------------------------------------------------------------------
  // Locator resolution (protocol handler support)
  // -----------------------------------------------------------------------

  async resolveExcerptLink(excerptId: string): Promise<BookLocatorInfo | null> {
    const snapshot = await this.annotations.load();
    const excerpt = snapshot.excerpts.find((e) => e.id === excerptId);
    if (!excerpt) return null;
    const reading = snapshot.reading.find((r) => r.bookId === excerpt.bookId);
    let format: string = "unknown";
    if (reading) {
      const posKind = reading.position?.kind;
      if (posKind === "pdf") format = "pdf";
      else if (posKind === "text") format = "txt";
      else if (posKind === "reflow") format = "epub";
    }
    return {
      bookId: excerpt.bookId,
      format,
      locator: excerpt.locator
    };
  }

  // -----------------------------------------------------------------------
  // Migration: legacy notesDirectory/ → ezreader/notes/
  // -----------------------------------------------------------------------

  async migrateLegacyNotes(input: { legacyNotesDir: string }): Promise<MigrationResult> {
    const legacyDir = sanitizeDir(input.legacyNotesDir);
    if (!legacyDir || legacyDir === LIBRARY_BASE_DIR) {
      return { migratedNotes: 0, failedNotes: 0, migratedBookIds: [] };
    }

    let listed: { files: string[]; folders: string[] };
    try {
      listed = await this.app.vault.adapter.list(legacyDir);
    } catch {
      // Legacy directory doesn't exist — nothing to migrate.
      return { migratedNotes: 0, failedNotes: 0, migratedBookIds: [] };
    }

    // Ensure destination directories exist (notes/ — the others are
    // lazily created on first write).
    await this.ensureDirectory(LIBRARY_BASE_DIR);
    await this.ensureDirectory(`${LIBRARY_BASE_DIR}/${NOTES_SUBDIR}`);

    let migrated = 0;
    let failed = 0;
    const migratedBookIds: BookId[] = [];

    for (const filePath of listed.files) {
      if (!filePath.endsWith(".md")) continue;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;

      // Try to extract the bookId from the legacy file's frontmatter
      // (v0.2.x wrote `ez-reader: <bookId>` in the YAML header).
      let bookId: BookId | undefined;
      try {
        const raw = await this.app.vault.read(file);
        const parsed = parseFrontmatter(raw);
        const candidate = parsed?.values.get("bookId");
        if (typeof candidate === "string" && candidate.length > 0) {
          bookId = candidate;
        }
      } catch (error) {
        console.warn("[ez-reader] migrateLegacyNotes: failed to read", filePath, error);
      }

      if (!bookId) {
        failed += 1;
        continue;
      }

      // Compute the new path: <bookId>.slice(0,8) — matches
      // `ensureBookDir`'s naming so subsequent operations on this book
      // reuse the migrated file.
      const safeTitle = file.basename.split("-").slice(0, -1).join("-") || file.basename;
      const fileBase = `${sanitizeFileBase(safeTitle)}-${bookId.slice(0, 8)}`;
      const newPath = normalizePath(`${LIBRARY_BASE_DIR}/${NOTES_SUBDIR}/${fileBase}.md`);

      try {
        // Read once so we can write to the new path (vault.rename would
        // also work, but explicit read+create+delete is clearer about
        // ordering and lets us skip the create if the destination already
        // exists).
        const raw = await this.app.vault.read(file);
        const existing = this.app.vault.getAbstractFileByPath(newPath);
        if (existing instanceof TFile) {
          // Destination already exists — skip silently. The migrated
          // book will pick up the existing destination via the cache.
          console.warn(`[ez-reader] migrateLegacyNotes: ${newPath} already exists, skipping ${filePath}`);
          continue;
        }
        await this.app.vault.create(newPath, raw);
        // `vault.delete` permanently removes the file. A user who enabled
        // Files → "Deleted files: Move to trash" expects *all* deletions to
        // land in the trash — but `vault.delete` bypasses that preference, so
        // the pre-migration notes they were still using would vanish with no
        // recovery path. `FileManager.trashFile` honors the setting, and it
        // still falls back to a hard delete when the user chose that, so it
        // is correct under every configuration.
        await this.app.fileManager.trashFile(file);
        migrated += 1;
        migratedBookIds.push(bookId);
      } catch (error) {
        console.warn("[ez-reader] migrateLegacyNotes: failed to move", filePath, error);
        failed += 1;
      }
    }

    return { migratedNotes: migrated, failedNotes: failed, migratedBookIds };
  }

  // -----------------------------------------------------------------------
  // Write queue (per-path serialization)
  // -----------------------------------------------------------------------

  private enqueueWrite(path: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.writeQueues.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.writeQueues.set(path, next.catch(() => undefined));
    return next;
  }

  // -----------------------------------------------------------------------
  // ensureDirectory
  // -----------------------------------------------------------------------

  private async ensureDirectory(path: string): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) return;
    const parts = path.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const here = normalizePath(acc);
      if (!(await this.app.vault.adapter.exists(here))) {
        try {
          await this.app.vault.adapter.mkdir(here);
        } catch (error) {
          // racing or already exists — both fine
          if (!(await this.app.vault.adapter.exists(here))) {
            throw error;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown renderers (kept verbatim from v0.2.x ObsidianNoteWriter)
// ---------------------------------------------------------------------------

const renderNotesHeader = (input: { bookId: BookId; bookTitle: string; bookPath: string }): string => {
  const date = new Date().toISOString().slice(0, 10);
  return [
    "---",
    `title: "${(input.bookTitle || "未命名").replace(/"/g, '\\"')}"`,
    `bookId: ${input.bookId}`,
    `source: ${input.bookPath}`,
    `created: ${date}`,
    "---",
    "",
    input.bookTitle || "未命名",
    "",
    "> 由 EzReader 自动生成。划词摘录与想法会出现在此笔记中,带 Obsidian 块 ID 可被双向链接。",
    ""
  ].join("\n");
};

const renderExcerptBlock = (input: ExcerptInput, bookTitle: string, bookId: BookId, protocol: string, noteBase: string): string => {
  const safeBookTitle = escapeWikiLink(bookTitle);
  const safeNoteLink = noteBase;
  const safeChapter = input.chapterTitle ? escapeWikiLink(input.chapterTitle) : undefined;
  const safeTextLines = input.text.split(/\r?\n/).map((line) => `> ${escapeWikiLink(line)}`);
  const safeTagLine = input.tags.length > 0
    ? `> **Tags**: ${input.tags.map((t) => `#${escapeWikiLink(t)}`).join(" ")}`
    : null;
  const sourceParts: string[] = [];
  if (safeChapter) sourceParts.push(safeChapter);
  if (typeof input.locator.page === "number") sourceParts.push(`第 ${input.locator.page} 页`);
  if (typeof input.locator.fraction === "number") sourceParts.push(`进度 ${Math.round(input.locator.fraction * 100)}%`);
  sourceParts.push(input.format.toUpperCase());

  const lines = [
    "> [!quote] 摘录",
    `> **${safeBookTitle}** · ${sourceParts.join(" · ")}`,
    `> Created: ${new Date(input.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    `> 来源: [[${safeNoteLink}|${safeBookTitle}]]`,
    `> 返回原文: [打开阅读器](obsidian://${protocol}?book=${encodeURIComponent(bookId)}&annotation=${encodeURIComponent(input.excerptId)}) · [[#^${input.excerptId}|回到此摘录]]`,
    safeTagLine,
    ">",
    ...safeTextLines
  ].filter((line): line is string => Boolean(line));
  const note = input.note.trim();
  if (note) {
    const noteLines = note.split(/\r?\n/).map((line) => `> ${escapeWikiLink(line)}`);
    lines.push(">", `> [!note] 想法`, ...noteLines);
  }
  lines.push("", `^${input.excerptId}`, "");
  return lines.join("\n");
};

const renderThoughtBlock = (input: ThoughtInput, blockId: string, protocol: string): string => {
  const lines = [
    "> [!note] 想法",
    `> Created: ${new Date(input.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    ...(input.tags.length > 0 ? [`> **Tags**: ${input.tags.map((t) => `#${escapeWikiLink(t)}`).join(" ")}`] : []),
    "",
    input.text.split(/\r?\n/).map((line) => `> ${escapeWikiLink(line)}`).join("\n"),
    "",
    `^${blockId}`,
    ""
  ];
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// String helpers (kept from v0.2.x ObsidianNoteWriter)
// ---------------------------------------------------------------------------

const sanitizeDir = (raw: string): string =>
  normalizePath(raw.trim().replace(/^\/+/, ""));

/**
 * Map an `ezreader/<subdir>/<base>.<ext>` path onto one of its siblings,
 * e.g. `ezreader/info/Dune-a1b2c3d4.md` →
 *   `ezreader/sessions/Dune-a1b2c3d4.jsonl`.
 *
 * Used by the cold-cache lookup to recover `notesPath` / `sessionsPath`
 * from a discovered `infoPath` without re-deriving the naming scheme from
 * the book title.
 */
const siblingPath = (infoPath: string, subdir: string, ext: string): string => {
  const base = infoPath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return normalizePath(`${LIBRARY_BASE_DIR}/${subdir}/${base}${ext}`);
};

/**
 * Stable, path-safe, collision-free tag for a bookId.
 *
 * The bookId IS the vault path, so it can contain `/` — unusable as a
 * filename component. It is also usually a long shared prefix
 * (`04-resources/books/...`), so slicing it is not unique either. Hashing
 * the whole thing fixes both: 10 hex chars off SHA-1, so ~2^40 buckets
 * and a book library will never hit a collision.
 */
const bookIdTag = (bookId: BookId): string =>
  hexFromBuffer(sha1Bytes(new TextEncoder().encode(bookId))).slice(0, 10);

const sanitizeFileBase = (raw: string): string => {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
};

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeWikiLink = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
