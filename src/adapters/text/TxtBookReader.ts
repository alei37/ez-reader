import type { Book, BookMetadata } from "../../core/entities/Book";
import type {
  BookBytesLoader,
  BookReader,
  ExtractedCover,
  ReaderSession,
  TocItem
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";
import type { PagedTextContent, PagedTextPage } from "./PagedTextSession";
import { PagedTextSession } from "./PagedTextSession";

/**
 * Adapter for plain `.txt` files. Loads the bytes, decodes them as UTF-8,
 * splits the text into fixed-size pages (with paragraph-aware breaking),
 * and renders them through the shared `PagedTextSession`.
 *
 * Format reference (RFC):
 *   - Pure text — no embedded cover, no metadata beyond filename.
 *   - Selections, highlights, TOC, and progress work the same as any
 *     other paged text engine.
 *
 * Why a custom adapter vs. wrapping foliate-js?
 *   foliate-js's `makeBook` expects EPUBs (or ZIP-shaped files). TXT is
 *   trivial — a tiny splitter keeps the bundle size smaller and gives
 *   us direct control over page-break heuristics (paragraph-aware) and
 *   the cover-fallback story.
 */

/** Approximate characters per page. Tuned for ~16px font on a 600px tall pane. */
const DEFAULT_PAGE_CHARS = 1600;

/** Hard cap so a single page never blows up if the input has very long lines. */
const MAX_PAGE_CHARS = 2400;

/**
 * A page chunk plus the **raw source lines** it was built from.
 *
 * Why keep the lines: chapter detection needs "one line at a time", and by
 * the time a page is rendered it is a single line of HTML with no line
 * structure left. Keeping the pre-pagination lines here is what makes
 * `detectChapterTitle` work for TXT at all (see `planTxtPages`).
 */
interface TextChunk {
  /** Text of the page, paragraphs joined by a blank line. */
  readonly text: string;
  /** The trimmed source paragraphs that produced `text`, in order. */
  readonly lines: ReadonlyArray<string>;
}

/**
 * Pure page-splitter. Decoupled from DOM and IO so unit tests can hit it.
 *
 * Strategy:
 *   1. Split the text into paragraphs by blank lines (or single newlines,
 *      depending on `paragraphMode`).
 *   2. Pack paragraphs into pages greedily until the running total exceeds
 *      `pageChars`. A paragraph longer than a page gets its own page so
 *      mid-paragraph breaks only happen as a last resort.
 *   3. Escape user content for safe HTML insertion.
 */
export const splitTextIntoPages = (
  text: string,
  options: { pageChars?: number; paragraphMode?: "blank-line" | "single-newline" } = {}
): PagedTextPage[] =>
  splitTextIntoChunks(text, options).map((chunk, index) => ({
    id: `page-${index}`,
    html: paragraphsToHtml(chunk.text)
  }));

/**
 * The pagination engine, kept separate from `splitTextIntoPages` so we can
 * carry each page's original lines alongside its HTML. The HTML this
 * produces is byte-identical to `splitTextIntoPages` for the same input —
 * only the extra `lines` field is new (asserted by the tests).
 */
const splitTextIntoChunks = (
  text: string,
  options: { pageChars?: number; paragraphMode?: "blank-line" | "single-newline" } = {}
): TextChunk[] => {
  const pageChars = Math.max(200, Math.min(MAX_PAGE_CHARS, options.pageChars ?? DEFAULT_PAGE_CHARS));
  const mode = options.paragraphMode ?? detectParagraphMode(text);
  const paragraphs = splitIntoParagraphs(text, mode);

  const chunks: TextChunk[] = [];
  // `lines` 是正在拼装的那一页的原始段落, `currentLength` 是它的字符数
  // (= lines.join("\n\n").length)。维护长度而不是每次重算 join,是因为
  // 诗歌 / 日志类文件里一页可能有几百个极短段落,每次 join 会变成 O(n^2)。
  // `lines.join("\n\n")` 得到的文本与旧实现逐字相同,所以页面边界不变。
  let lines: string[] = [];
  let currentLength = 0;
  const flush = (): void => {
    const trimmed = lines.join("\n\n").trimEnd();
    const collected = lines;
    lines = [];
    currentLength = 0;
    if (trimmed.length === 0) return;
    chunks.push({ text: trimmed, lines: collected });
  };
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > pageChars) {
      // Single paragraph longer than a page — flush what we have, then
      // hard-break this paragraph at sentence boundaries.
      flush();
      const hardChunks = hardBreakLongParagraph(trimmed, pageChars);
      for (const chunk of hardChunks) {
        chunks.push({ text: chunk, lines: [chunk] });
      }
      continue;
    }
    if (lines.length === 0) {
      lines = [trimmed];
      currentLength = trimmed.length;
      continue;
    }
    if (currentLength + trimmed.length + 2 > pageChars) {
      flush();
      lines = [trimmed];
      currentLength = trimmed.length;
    } else {
      lines.push(trimmed);
      currentLength += trimmed.length + 2;
    }
  }
  flush();

  if (chunks.length === 0) {
    chunks.push({ text: "", lines: [] });
  }
  return chunks;
};

/**
 * Heuristic: if the text has any blank-line paragraph breaks, use them;
 * otherwise treat every newline as a paragraph (one-line per paragraph,
 * common in poetry / log dumps).
 */
const detectParagraphMode = (text: string): "blank-line" | "single-newline" => {
  if (/\r?\n\s*\r?\n/.test(text)) return "blank-line";
  return "single-newline";
};

const splitIntoParagraphs = (text: string, mode: "blank-line" | "single-newline"): string[] => {
  if (mode === "blank-line") {
    return text.split(/\r?\n\s*\r?\n/g);
  }
  return text.split(/\r?\n/g);
};

/**
 * Convert a chunk of paragraphs to safe HTML. Each blank-line-separated
 * paragraph becomes a `<p>`. User-supplied text is HTML-escaped and
 * single newlines preserved as `<br>` so poetry stays readable.
 */
const paragraphsToHtml = (text: string): string => {
  const parts = text.split(/\n{2,}/);
  return parts
    .map((part) => {
      const escaped = escapeHtml(part);
      const withBreaks = escaped.replace(/\r?\n/g, "<br>");
      return `<p>${withBreaks}</p>`;
    })
    .join("");
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Hard-break a single long paragraph at sentence boundaries when possible,
 * falling back to character-level breaks if a sentence still overflows.
 */
const hardBreakLongParagraph = (text: string, maxChars: number): string[] => {
  const result: string[] = [];
  // First try splitting on sentence-ending punctuation (Chinese + Latin).
  const sentenceRe = /[^。！？!?；;]+[。！？!?；;]?/g;
  const sentences = text.match(sentenceRe) ?? [text];
  let buffer = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buffer.length > 0) {
        result.push(buffer);
        buffer = "";
      }
      // Fall back to character chunks for absurdly long sentences.
      for (let i = 0; i < sentence.length; i += maxChars) {
        result.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (buffer.length === 0) {
      buffer = sentence;
    } else if (buffer.length + sentence.length <= maxChars) {
      buffer += sentence;
    } else {
      result.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer.length > 0) result.push(buffer);
  return result;
};

/**
 * P1 polish: extract a book title from the head of the text, falling back to
 * the filename. Previous heuristic ("first non-empty line ≤80 chars, no
 * trailing 。/.") misidentified the first body sentence of classical Chinese
 * novels as the title (e.g. 《千字文》 opens with "天地玄黄,宇宙洪荒" — 8
 * chars, no trailing 。, treated as title). Strategy now:
 *
 *  1. Strong signals: scan the first ~50 lines for an unmistakable structural
 *     marker — "书名:" / "Title:" / "TITLE" / "题:" / `《X》` / 卷X / 第X章
 *     etc. First match wins.
 *  2. Weak signal: if no strong signal found, take the first non-empty line,
 *     but only if it's plausibly a title — ≤25 chars (short classical title
 *     or 1-2 line poetic name), no body-sentence punctuation (，。！？、；:
 *     "?" "!" ...). Long sentences are body, not title.
 *  3. Otherwise fall back to filename.
 */
export const STRONG_TITLE_PATTERNS: ReadonlyArray<RegExp> = [
  // 显式声明: "书名: xxx" / "Title: xxx" / "题: xxx"
  /^[\s\u3000]*(?:书\s*名|Title|题|篇名)\s*[:：]\s*(.+?)\s*$/iu,
  // 引号包围: 《书名》 / 《 书名 》 / 「书名」 / 『书名』 / "书名"
  /^[\s\u3000]*[《「『"“](.{1,40}?)[》」』"”][\s\u3000]*$/u,
  // 书的结构: 卷X / 第X章 / 全X / 篇X — 后面跟副标题或不跟
  // 两个 alternation:
  //   a) "卷"/"篇"/"全" + 可选数字 + 可选[章回...] (e.g. "卷一", "卷之一", "卷一 大题")
  //   b) "第" + 数字 + [章回节卷集篇] + 可选副标题 (e.g. "第一章 标题", "第三回")
  /^[\s\u3000]*(?:(?:卷|篇|全)(?:之?[0-9零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]+)?(?:[章回]?)|第\s*[0-9零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]+\s*[章回节卷集篇])\s*(.{0,30})$/u,
  // 中文书名常见格式: 5-15 字无标点
  /^[\s\u3000]*[\u4e00-\u9fa5]{2,15}[\s\u3000]*$/u,
];

export const BODY_PUNCTUATION = /[，。！？、；：""''?!,;:"'']/;

export const guessTitleFromText = (text: string, fallback: string): string => {
  const lines = text.split(/\r?\n/).slice(0, 50);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    for (const re of STRONG_TITLE_PATTERNS) {
      const match = line.match(re);
      if (match) {
        // 第一组捕获是提取的标题, 整行匹配则取整行
        const candidate = (match[1] ?? line).trim();
        if (candidate.length > 0 && candidate.length <= 40 && !BODY_PUNCTUATION.test(candidate)) {
          return candidate;
        }
      }
    }
  }
  // 弱信号兜底: 第一行 ≤25 字, 没有 body 标点
  const firstLine = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  if (
    firstLine.length > 0 &&
    firstLine.length <= 25 &&
    !BODY_PUNCTUATION.test(firstLine)
  ) {
    return firstLine;
  }
  return fallback;
};

/**
 * P1: 检测一行是不是章节标题(中文古文 + 西方翻译小说通用)。模式尽量宽松:
 * - `第X章` / `第X回` / `Chapter N` / `CHAPTER N`
 * - 不区分全/半角、不区分大小写
 *
 * 返回 null 表示这行不是章节标题。
 */
export const matchChapterTitle = (line: string): string | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return null;
  for (const re of CHAPTER_TITLE_PATTERNS) {
    if (re.test(trimmed)) return trimmed;
  }
  return null;
};

/** 章节标题行的模式表,导出以便复用与测试。 */
export const CHAPTER_TITLE_PATTERNS: ReadonlyArray<RegExp> = [
  // 中文古文 / 翻译小说常见模式
  /^[\s　]*第\s*[0-9零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]+\s*[章回节卷集篇]/u,
  /^[\s　]*chapter\s+[0-9]+(?:\s|$)/iu,
  /^[\s　]*CHAPTER\s+[IVXLCDM]+/u
];

/**
 * P1: 从多行文本里找第一个章节标题行(兼容旧的公开 API)。
 *
 * ⚠️ 它**不能**用来检测已经渲染好的页面 HTML —— TXT 的 `page.html` 是一行
 * 字符串,里面只有 `<p>` / `<br>` 标签,按行切开后"章节标题"永远不可能出现在
 * 行首。Bug 3 就是这么来的。分页时请改用 `planTxtPages`(它在分页**之前**
 * 拿着原始行做检测)。
 *
 * 返回 null 表示没识别到章节标题 — caller 显示 fallback。
 */
export const detectChapterTitle = (text: string): string | null => {
  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(0, 50)) {
    const matched = matchChapterTitle(line);
    if (matched) return matched;
  }
  return null;
};

/** TOC 条目上限。防止检测到几千个"章节"的日志/诗歌文件把目录面板撑爆。 */
const MAX_TXT_TOC_ITEMS = 500;

/** A TXT book's full rendering plan: paginated text + chapter metadata. */
export interface TxtPagePlan {
  readonly title: string;
  readonly pages: ReadonlyArray<PagedTextPage>;
  readonly toc: ReadonlyArray<TocItem>;
  readonly chapterStartPages: ReadonlyArray<number>;
}

/**
 * Build the whole TXT book plan: title, paginated pages (each carrying the
 * chapter it belongs to), and a TOC derived from the detected chapters.
 *
 * ## 方案选择(为什么是"分页前检测"而不是别的)
 *
 * 被否掉的两个方案:
 *
 * 1. **在渲染后的 `page.html` 上检测**(旧实现)。`splitTextIntoPages` 把每段
 *    包进 `<p>`,段落之间没有 `\n`,整个 page.html 就是**一行**。按行切开后
 *    每行都以 `<p>` 开头,`^第X章` 永远匹配不上 → 每页 chapterTitle 恒等于
 *    书名,目录面板里全是同一个名字,章节跳转 / 进度点全部失效。这不是"匹配
 *    率低",是结构性 0 命中。
 *
 * 2. **改分页逻辑,让 page.html 保留换行**(例如把段落之间的 `\n\n` 换成
 *    真实换行)。否决原因:TXT 分页是段落感知的,`pageChars` 的预算计算
 *    (`current.length + trimmed.length + 2`)依赖"段间空白恰好是 2 个字符";
 *    一旦改分隔符,预算就偏了,`TxtPagination.test.ts` 里那批按字符数断言的
 *    用例会漂。而且 MOBI 侧的调用方也读同一套分页约定 —— 改动面大、收益小。
 *
 * 采用的方案:**分页时顺手把每页的原始段落行带出来**(`TextChunk.lines`),
 * 章节检测在**分页之前**就已经能拿到行信息。分页规则、page.html 输出、page
 * 边界全部保持原样(逐字相同),MOBI 完全不受影响 —— 它自己构造 pages,从不
 * 走这条路径。
 */
export const planTxtPages = (
  text: string,
  fallbackTitle: string,
  options: { pageChars?: number; paragraphMode?: "blank-line" | "single-newline" } = {}
): TxtPagePlan => {
  const title = guessTitleFromText(text, fallbackTitle);
  const chunks = splitTextIntoChunks(text, options);

  // TOC: 书名一条 + 每章一条。chapterStartPages 与 toc **下标对齐**
  // (PagedTextSession.goToToc 用 toc 下标去取 chapterStartPages)。
  const toc: TocItem[] = [{ id: "txt-root", label: title, depth: 0 }];
  const chapterStartPages: number[] = [0];
  const pages: PagedTextPage[] = [];

  let currentChapter = title;
  for (const chunk of chunks) {
    // 每页取第一个章节标题行;一页最多记一个章节(PagedTextPage.chapterTitle
    // 是单值模型)。没检测到就继承上一章 —— 翻到任何一页工具栏都有名字。
    for (const line of chunk.lines) {
      const detected = matchChapterTitle(line);
      if (!detected) continue;
      currentChapter = detected;
      if (toc.length < MAX_TXT_TOC_ITEMS) {
        toc.push({ id: `txt-ch-${toc.length}`, label: detected, depth: 1 });
        chapterStartPages.push(pages.length);
      }
      break;
    }
    pages.push({
      id: `page-${pages.length}`,
      html: paragraphsToHtml(chunk.text),
      chapterTitle: currentChapter
    });
  }

  return { title, pages, toc, chapterStartPages };
};

export class TxtBookReader implements BookReader {
  async open(
    book: Book,
    host: HTMLElement,
    appearance: ReaderAppearance,
    loader: BookBytesLoader
  ): Promise<ReaderSession> {
    const bytes = await loader(book.locator.path);
    const text = decodeText(bytes);
    const fallbackTitle = book.locator.path.split("/").pop()?.replace(/\.txt$/i, "") ?? "TXT";
    const plan = planTxtPages(text, fallbackTitle);
    const content: PagedTextContent = {
      pages: plan.pages,
      toc: plan.toc,
      chapterStartPages: plan.chapterStartPages
    };
    return new PagedTextSession({ content, host, appearance, loader });
  }

  async extractCover(): Promise<ExtractedCover | null> {
    // Plain text has no embedded cover.
    return null;
  }

  /**
   * TXT 没有结构化 metadata — caller 应该 fallback 到
   * `BookSource.readMetadata` 的 filename-derived 结果. 这里返回 null
   * 让 LibraryService 走 fallback 路径, 不要覆盖已有的 filename-based title.
   */
  async readMetadata(): Promise<BookMetadata | null> {
    return null;
  }
}

/**
 * Decode bytes as text. Strategy (each step exists because of a real
 * environment; see the numbered comments below for which one bites where):
 *
 *   1. UTF-16 BOM (`FF FE` / `FE FF`) → decode as UTF-16LE / UTF-16BE.
 *      Windows "Unicode encoding" files have interleaved NULs, so strict
 *      UTF-8 rejects them and GB18030 would "successfully" decode the
 *      binary garbage into CJK-looking mojibake.
 *   2. UTF-8 BOM (`EF BB BF`) → skip the BOM, then run the same chain as
 *      step 3 on the remainder. The BOM must not be fed to the CJK
 *      decoders or the whole body shifts by three bytes.
 *   3. Strict UTF-8 (`fatal: true` **plus** a U+FFFD probe — see below).
 *   4. GB18030, then GBK (`fatal: true`, then permissive-if-clean).
 *   5. Permissive UTF-8, accepted only when the result has no U+FFFD.
 *   6. windows-1252, then a hand-rolled Latin-1 mapping.
 *
 * P0-4: without the GB18030 fallback, the user's GBK-encoded Chinese
 * novels opened to a wall of □□□ — silent data loss with no notice.
 *
 * P0 (this revision) — **every** `new TextDecoder(...)` is wrapped, and every
 * decode result is validated. Two failure modes were unrecoverable before:
 *
 *   a) Old Android WebViews do not register the `gb18030` label, so
 *      `new TextDecoder("gb18030")` throws `RangeError`. Unguarded, that
 *      exception escaped `decodeText` and the book refused to open at all.
 *   b) Environments that ignore the `{ fatal: true }` option (also old
 *      WebViews) make the "strict UTF-8" probe succeed *silently* with
 *      mojibake, so the GB18030 fallback was never reached. Conversely,
 *      an environment with a broken gb18030 table constructs fine and
 *      returns U+FFFD for everything — previously accepted as a "success".
 *      Both ended in an unreadable page.
 *
 * The U+FFFD probe is what closes (b) from both sides: a decode that had to
 * substitute replacement characters did not actually understand the bytes,
 * so we keep looking instead of shipping a page of tofu.
 *
 * Known limitation (deliberately not fixed here): a UTF-8 file with a few
 * stray invalid bytes fails step 3 and then gets decoded as GB18030, which
 * "succeeds" into plausible-looking mojibake. Distinguishing that needs a
 * per-byte validity ratio heuristic; out of scope for this fix.
 */
export const decodeText = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  if (view.length >= 2 && view[0] === 0xff && view[1] === 0xfe) {
    return decodeUtf16(view.subarray(2), "utf-16le");
  }
  if (view.length >= 2 && view[0] === 0xfe && view[1] === 0xff) {
    return decodeUtf16(view.subarray(2), "utf-16be");
  }
  // UTF-8 BOM: skip it, then run the full chain on the body.
  const body =
    view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf
      ? view.subarray(3)
      : view;
  return decodeBody(body);
};

/** The actual fallback chain, BOM already stripped. */
const decodeBody = (view: Uint8Array): string => {
  // 3) strict UTF-8 — the overwhelmingly common case (modern exports).
  const utf8 = decodeStrict(view, "utf-8");
  if (utf8 !== null) return utf8;

  // 4) CJK legacy encodings. `gb18030` is a superset of `gbk`; `gbk` is kept as
  //    a separate step because a runtime may register one label and not the
  //    other, and a book in GBK still decodes correctly under it.
  for (const label of CJK_FALLBACK_LABELS) {
    const decoded = decodeStrict(view, label) ?? decodeIfClean(view, label);
    if (decoded !== null) return decoded;
  }

  // 5) permissive UTF-8 — the bytes are "mostly" UTF-8 or nothing else fits.
  const lenientUtf8 = decodeIfClean(view, "utf-8");
  if (lenientUtf8 !== null) return lenientUtf8;

  // 6) Last resort. windows-1252 maps every byte to a printable Latin-1
  //    character (mojibake, but nothing is lost and there are no tofu boxes).
  //    If even that label is missing, the manual loop below cannot fail:
  //    it is plain arithmetic over the byte array.
  const windows1252 = decodeIfClean(view, "windows-1252");
  if (windows1252 !== null) return windows1252;
  return decodeLatin1(view);
};

/**
 * CJK fallback labels, in the order we try them.
 *
 * Why big5 is NOT here: Big5 decodes GBK bytes into plausible-looking but
 * *wrong* traditional Chinese without emitting a single U+FFFD, so our
 * validity probe cannot tell a correct decode from a wrong one. Shipping
 * silently-wrong text is worse than shipping U+FFFD, which at least tells
 * the user the encoding guess failed.
 */
const CJK_FALLBACK_LABELS: ReadonlyArray<string> = ["gb18030", "gbk"];

/**
 * `TextDecoder(label)` + decode, or `null` when this runtime lacks the
 * encoding (old WebView → `RangeError`) or the decoder throws mid-decode
 * (strict mode + invalid bytes). Never throws — that guarantee is what
 * keeps one bad file from failing `open()` for the whole book.
 */
const tryDecode = (bytes: Uint8Array, label: string, fatal: boolean): string | null => {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
};

/**
 * Strict decode with an explicit "did it actually understand this?" probe.
 *
 * `{ fatal: true }` alone is not enough on old WebViews that ignore the
 * options dictionary — there the decode silently succeeds with mojibake.
 * The U+FFFD check is what catches that case, and also catches runtimes
 * whose gb18030 implementation is registered but broken.
 */
const decodeStrict = (bytes: Uint8Array, label: string): string | null => {
  const text = tryDecode(bytes, label, true);
  if (text === null) return null;
  return isCleanText(text) ? text : null;
};

/** Permissive decode, accepted only when the result has no replacement chars. */
const decodeIfClean = (bytes: Uint8Array, label: string): string | null => {
  const text = tryDecode(bytes, label, false);
  if (text === null) return null;
  return isCleanText(text) ? text : null;
};

/**
 * A decode that had to invent U+FFFD replacement characters did not
 * understand the input. (Files that legitimately contain U+FFFD are rare
 * enough that rejecting the decode is the better trade — the next fallback
 * always returns *something* readable.)
 */
const isCleanText = (text: string): boolean => !text.includes("\uFFFD");

/**
 * Ultimate fallback: one byte → one character, straight from the code
 * point. Uses `String.fromCharCode` in chunks because passing a whole
 * book's byte array in one call blows the argument limit.
 *
 * The result is Latin-1 mojibake, but it is guaranteed: no decoder, no
 * label, no options — nothing to be unsupported. A book that opens as
 * garbage is recoverable; a book that refuses to open is not.
 */
const decodeLatin1 = (bytes: Uint8Array): string => {
  const CHUNK = 4096;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return out;
};

/**
 * UTF-16 via the platform decoder. Node and every Chromium/WebView build
 * expose `utf-16le` / `utf-16be`, but guard anyway — an old Android
 * WebView would otherwise throw out of `decodeText` and fail the whole book
 * open instead of degrading to the previous behavior.
 */
const decodeUtf16 = (bytes: Uint8Array, label: "utf-16le" | "utf-16be"): string => {
  const decoded = tryDecode(bytes, label, false);
  if (decoded !== null) return decoded;
  return tryDecode(bytes, "utf-8", false) ?? decodeLatin1(bytes);
};
