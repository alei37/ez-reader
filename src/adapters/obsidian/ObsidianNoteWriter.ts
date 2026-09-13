import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { Plugin } from "obsidian";
import type { AnnotationStore } from "../../core/ports/AnnotationStore";
import type {
  BookNoteRef,
  BookLocatorInfo,
  ExcerptInput,
  NoteWriter,
  ThoughtInput
} from "../../core/ports/NoteWriter";
import type { PluginSettings } from "../../core/types/ReaderSettings";

const PROTOCOL = "ez-reader";

/**
 * Obsidian-side implementation of `NoteWriter`. Each book gets its own
 * Markdown file under `<notesDirectory>/<title>-<bookId-prefix>.md`.
 *
 * Excerpts and thoughts are appended as Obsidian callout blocks with a
 * block ID (`^<excerptId>`), so any excerpt can be referenced from any
 * other note via `[[book-note#^<excerptId>]]` (Obsidian renders this as a
 * deep link). The block also contains a "return to source" link using
 * the `obsidian://<PROTOCOL>?annotation=<id>` protocol, which the plugin
 * handles via `registerObsidianProtocolHandler`.
 */
export class ObsidianNoteWriter implements NoteWriter {
  private readonly cacheByPath = new Map<string, BookNoteRef>();
  // Serialize concurrent appends to the same note file. vault.process
  // is not atomic across calls — if two excerpts land at the same time,
  // the second read() might see the pre-first content and the second
  // process() would clobber the first. We chain writes per-file via a
  // tail promise so two saves settle one after the other.
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly annotations: AnnotationStore
  ) {}

  async ensureBookNote(input: { bookId: string; bookTitle: string; bookPath: string }): Promise<BookNoteRef> {
    const cached = this.cacheByPath.get(input.bookId);
    if (cached) return cached;

    const settings = await this.annotations.listSettings();
    const baseDir = sanitizeDir(settings.notesDirectory || "zz_阅读与研究/阅读笔记");
    await this.ensureDirectory(baseDir);

    const safeTitle = sanitizeFileBase(input.bookTitle || input.bookPath.split("/").pop() || input.bookId);
    const idTag = input.bookId.slice(0, 8);
    const fileName = `${safeTitle}-${idTag}.md`;
    const notePath = normalizePath(`${baseDir}/${fileName}`);

    const abstract = this.app.vault.getAbstractFileByPath(notePath);
    if (!(abstract instanceof TFile)) {
      const header = renderBookHeader(input, settings);
      await this.app.vault.create(notePath, header);
    }

    const ref: BookNoteRef = { path: notePath, bookId: input.bookId, title: input.bookTitle };
    this.cacheByPath.set(input.bookId, ref);
    return ref;
  }

  async appendExcerpt(ref: BookNoteRef, input: ExcerptInput): Promise<void> {
    return this.enqueueWrite(ref.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(file instanceof TFile)) return;
      // Idempotent: if a block with this excerptId already exists in the
      // note, skip the append. This protects against editExcerpt flows
      // and other places where the same excerpt could be written twice.
      const existing = await this.app.vault.read(file);
      if (existing.includes(`^${input.excerptId}`)) return;
      const block = renderExcerptBlock(input, ref.title, ref.bookId, PROTOCOL);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}\n\n${block}`);
    });
  }

  async appendThought(ref: BookNoteRef, input: ThoughtInput): Promise<void> {
    return this.enqueueWrite(ref.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(file instanceof TFile)) return;
      // 想法的 block id 基于 createdAt 戳; 同样去重
      const blockId = `thought-${input.createdAt}`;
      const existing = await this.app.vault.read(file);
      if (existing.includes(`^${blockId}`)) return;
      const block = renderThoughtBlock(input, PROTOCOL);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}\n\n${block}`);
    });
  }

  /**
   * Serialize concurrent writes to the same path. Each call queues its
   * async fn on the tail of the path's promise chain so two saves
   * settle one after the other — no clobber, no lost block.
   */
  private enqueueWrite(path: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.writeQueues.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Keep the chain alive even if a step throws — the next caller
    // should still get to run.
    this.writeQueues.set(path, next.catch(() => undefined));
    return next;
  }

  async resolveExcerptLink(excerptId: string): Promise<BookLocatorInfo | null> {
    const snapshot = await this.annotations.load();
    const excerpt = snapshot.excerpts.find((e) => e.id === excerptId);
    if (!excerpt) return null;
    // 根据 bookId 在 library 列表里查 format, 没找到就保持 unknown
    const reading = snapshot.reading.find((r) => r.bookId === excerpt.bookId);
    let format = "unknown";
    if (reading) {
      // ReadingState 不带 format, 我们从 reading.position 类型推断
      format = reading.position?.kind === "pdf" ? "pdf" : "epub";
    }
    return {
      bookId: excerpt.bookId,
      format,
      locator: excerpt.locator
    };
  }

  private async ensureDirectory(path: string): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) return;
    // Create each ancestor in turn; Obsidian's adapter.mkdir is not recursive.
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

const sanitizeDir = (raw: string): string => {
  // Strip leading slashes, normalize.
  return normalizePath(raw.trim().replace(/^\/+/, ""));
};

const sanitizeFileBase = (raw: string): string => {
  // Keep Chinese + Latin letters, digits, hyphen, underscore. Replace others
  // with `-` and trim trailing dashes so the filename ends cleanly.
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
};

const renderBookHeader = (
  input: { bookId: string; bookTitle: string; bookPath: string },
  settings: PluginSettings
): string => {
  const date = new Date().toISOString().slice(0, 10);
  const title = settings.defaultNoteTemplate
    .replace(/\{\{title\}\}/g, input.bookTitle || "未命名")
    .replace(/\{\{author\}\}/g, settings.libraryOwnerName || "")
    .replace(/\{\{date\}\}/g, date);
  return [
    "---",
    `title: "${(input.bookTitle || "未命名").replace(/"/g, '\\"')}"`,
    `ez-reader: ${input.bookId}`,
    `source: ${input.bookPath}`,
    `created: ${date}`,
    "---",
    "",
    title,
    "",
    "> 由 EzReader 自动生成。划词摘录与想法会出现在此笔记中,带 Obsidian 块 ID 可被双向链接。",
    ""
  ].join("\n");
};

const renderExcerptBlock = (input: ExcerptInput, bookTitle: string, bookId: string, protocol: string): string => {
  const quoteLines = input.text.split(/\r?\n/).map((line) => `> ${line}`);
  const tagLine = input.tags.length > 0 ? `> **Tags**: ${input.tags.map((t) => `#${t}`).join(" ")}` : null;
  const sourceParts: string[] = [];
  if (input.chapterTitle) sourceParts.push(input.chapterTitle);
  if (typeof input.locator.page === "number") sourceParts.push(`第 ${input.locator.page} 页`);
  if (typeof input.locator.fraction === "number") sourceParts.push(`进度 ${Math.round(input.locator.fraction * 100)}%`);
  sourceParts.push(input.format.toUpperCase());

  const lines = [
    "> [!quote] 摘录",
    `> **${bookTitle}** · ${sourceParts.join(" · ")}`,
    `> Created: ${new Date(input.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    // 双向链接: 协议 URL 用于外部跳转, wiki link 用于 vault 内跳转 (光标在块上即可)
    `> 返回原文: [打开阅读器](obsidian://${protocol}?book=${encodeURIComponent(bookId)}&annotation=${encodeURIComponent(input.excerptId)}) · [[#^${input.excerptId}|回到此摘录]]`,
    tagLine,
    ">",
    ...quoteLines
  ].filter((line): line is string => Boolean(line));
  if (input.note.trim()) {
    lines.push(">", `> [!note] 想法`, `> ${input.note.trim().split(/\r?\n/).join("\n> ")}`);
  }
  lines.push("", `^${input.excerptId}`, "");
  return lines.join("\n");
};

const renderThoughtBlock = (input: ThoughtInput, protocol: string): string => {
  const lines = [
    "> [!note] 想法",
    `> Created: ${new Date(input.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    ...(input.tags.length > 0 ? [`> **Tags**: ${input.tags.map((t) => `#${t}`).join(" ")}`] : []),
    "",
    input.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n"),
    "",
    `^thought-${input.createdAt}`,
    ""
  ];
  return lines.join("\n");
};
