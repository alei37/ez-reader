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
    const baseDir = sanitizeDir(settings.notesDirectory || "ezreader-notes/阅读笔记");
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
      // Idempotent: block IDs always sit on their own line. We use a
      // regex anchor so a substring match inside a normal paragraph
      // doesn't trigger a false positive (e.g. a user typing "^abc-123"
      // in their notes).
      const blockIdRegex = new RegExp(`(^|\\n)\\^${escapeRegExp(input.excerptId)}\\s*$`, "m");
      const existing = await this.app.vault.read(file);
      if (blockIdRegex.test(existing)) return;
      // 把 ref.path 转成 note basename (去掉 .md 扩展名 + 所在目录), 用于
      // Obsidian wiki-link: 摘录 blockquote 里放 `[[<noteBase>]]`, 让用户
      // 在 vault 任何地方 grep "书名" 或点反向链接都能找到该书的笔记.
      // 之前只渲染了书名(纯文本), Obsidian 不知道是 link, 没法反向.
      const noteBase = ref.path.split("/").pop()?.replace(/\.md$/i, "") ?? ref.title;
      const block = renderExcerptBlock(input, ref.title, ref.bookId, PROTOCOL, noteBase);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}\n\n${block}`);
    });
  }

  async appendThought(ref: BookNoteRef, input: ThoughtInput): Promise<void> {
    return this.enqueueWrite(ref.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(file instanceof TFile)) return;
      // thoughtId 是 caller 传入的 UUID (生成的 reader 端). 早期版本
      // 用 createdAt 戳当 block id, 同 ms 多条会撞 → 第二次 append
      // 被去重逻辑误判已存在 → 静默丢失.
      const blockId = `thought-${input.thoughtId}`;
      const blockIdRegex = new RegExp(`(^|\\n)\\^${escapeRegExp(blockId)}\\s*$`, "m");
      const existing = await this.app.vault.read(file);
      if (blockIdRegex.test(existing)) return;
      const block = renderThoughtBlock(input, blockId, PROTOCOL);
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
    let format: string = "unknown";
    if (reading) {
      // ReadingState 不带 format 字段, 我们从 reading.position 类型推断。
      // - "pdf"  → PDF (走 Obsidian 内置 viewer)
      // - "text" → TXT / MOBI / AZW3 (PagedTextSession)
      // - "reflow" → EPUB (foliate-js)
      const posKind = reading.position?.kind;
      if (posKind === "pdf") format = "pdf";
      else if (posKind === "text") format = "txt"; // 兜底, 用 library 的精确 format 在上游解决
      else if (posKind === "reflow") format = "epub";
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

const renderExcerptBlock = (input: ExcerptInput, bookTitle: string, bookId: string, protocol: string, noteBase: string): string => {
  // 用户控制的字符串在写到 markdown 之前 escape wiki-link / 反斜杠.
  // 不 escape 引号 / 重点符 / html: 仍然允许用户在 quote 里写 bold/link,
  // 但屏蔽 [[evil-path]] 这种 wiki-link 形成 (用户可能误粘或
  // 输入到 vault 里恶意路径名). bookTitle 来自文件名 basename, 也 escape.
  const safeBookTitle = escapeWikiLink(bookTitle);
  // noteBase 来自 ref.path 文件名 basename, Obsidian 自己的安全规则保证
  // 它不含 ]] / 换行, 不需要 escape; 但 escapeWikiLink 会破坏 [[, 所以
  // 这里直接用 (nota: ensureBookNote 已经 sanitizeFileBase 过一次).
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
    // P0 修复: 之前只渲染纯文本书名, Obsidian 无法识别为 wiki-link, 反向链接
    // 面板也看不到这条引用 — 用户体验"摘录没形成双链". 现在加 `[[noteBase]]`
    // 让 vault 里任何位置用 `[[noteBase]]` 或点击反向链接都能跳到这本书的笔记.
    // 摘录 blockquote 自己也在这个 note 里, 所以反向链接面板会显示从其他笔记
    // 引用本笔记的次数. 用户点反向链接 → 看到所有引用本笔记的摘录块.
    `> 来源: [[${safeNoteLink}|${safeBookTitle}]]`,
    // 双向链接: 协议 URL 用于外部跳转, wiki link 用于 vault 内跳转 (光标在块上即可)
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

/** Escape regex meta-characters in a block id before embedding in a regex. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Escape characters that would form an unintended Obsidian wiki-link or
 * break a markdown escape. Other markdown (bold / italics / inline code)
 * stays enabled — the blockquote context already protects the worst
 * injection vectors, and we want users to keep formatting in their notes.
 *
 *   \\    — backslash first so the other escapes don't get double-escaped
 *   [    — wiki-link opener (Obsidian would auto-link [[path]])
 *   ]    — wiki-link closer
 */
const escapeWikiLink = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
