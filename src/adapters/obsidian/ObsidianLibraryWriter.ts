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
  ThoughtInput
} from "../../core/ports/LibraryWriter";
import type { BookId } from "../../core/entities/Book";
import type { BookInfo } from "../../core/entities/BookInfo";
import type { ReadingSession } from "../../core/entities/ReadingSession";
import { defaultBookInfo } from "../../core/entities/BookInfo";
import { bookInfoFromFrontmatter, parseFrontmatter, serializeBookInfo } from "./frontmatter";

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
    const idTag = input.bookId.slice(0, 8);
    const fileBase = `${safeTitle}-${idTag}`;
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
            const safeTitle = info.title;
            const idTag = bookId.slice(0, 8);
            const fileBase = `${sanitizeFileBase(safeTitle)}-${idTag}`;
            this.cacheByBookId.set(bookId, {
              notesPath: normalizePath(`${LIBRARY_BASE_DIR}/${NOTES_SUBDIR}/${fileBase}.md`),
              infoPath: filePath,
              sessionsPath: normalizePath(`${LIBRARY_BASE_DIR}/${SESSIONS_SUBDIR}/${fileBase}.jsonl`),
              bookId,
              title: safeTitle,
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
      const file = this.app.vault.getAbstractFileByPath(ref.sessionsPath);
      const line = JSON.stringify(session) + "\n";
      if (file instanceof TFile) {
        await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}${line}`);
      } else {
        // First session — create the file with just this line.
        await this.app.vault.create(ref.sessionsPath, line);
      }
    });
  }

  async loadReadingSessions(bookId: BookId): Promise<ReadonlyArray<ReadingSession>> {
    const cached = this.cacheByBookId.get(bookId);
    let sessionsPath: string | undefined = cached?.sessionsPath;
    if (!sessionsPath) {
      const info = await this.findAndReadBookInfo(bookId);
      sessionsPath = info ? this.cacheByBookId.get(bookId)?.sessionsPath : undefined;
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
        await this.app.vault.delete(file);
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
