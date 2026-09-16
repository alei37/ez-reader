import type {
  BookBytesLoader,
  ExtractedCover,
  HighlightSpec,
  ReaderEventMap,
  ReaderSession,
  ReaderTarget,
  TocItem
} from "../../core/ports/BookReader";
import type { ReaderAppearance, ReaderTheme } from "../../core/types/ReaderSettings";

/**
 * A single rendered "page" of the book. Pages are flat-HTML chunks that the
 * session renders into the host element. Each page knows where it sits in
 * the book (0..N-1) so `currentFraction()` and `goTo(fraction)` work.
 *
 * The page model is intentionally simple — TXT and MOBI don't have the
 * pagination complexity of an EPUB. We render one page at a time and
 * "turn" by replacing the host's contents.
 */
export interface PagedTextPage {
  /** Stable id; usually a chunk index or chapter id. */
  readonly id: string;
  /** Display HTML for this page (sanitized upstream). */
  readonly html: string;
  /**
   * Per-chapter stylesheets (MOBI only). The MOBI parser hands us
   * `blob:` URLs for these — Obsidian's CSP refuses to load stylesheets
   * from `blob:` URLs (style-src does not include `blob:`), so the
   * adapter layer pre-fetches the CSS text and we inject it as an inline
   * `<style>` element. Already injected on first show.
   */
  readonly css?: ReadonlyArray<{ id: string; text: string }>;
  /** Optional chapter title used by `currentChapter()`. */
  readonly chapterTitle?: string;
}

/** Static metadata + flat page list. Constructed once per book open. */
export interface PagedTextContent {
  readonly pages: ReadonlyArray<PagedTextPage>;
  /** TOC entries in display order. */
  readonly toc: ReadonlyArray<TocItem>;
  /** Chapter index → start page index. Used to resolve TOC jumps. */
  readonly chapterStartPages: ReadonlyArray<number>;
  /** Cover image bytes, if any. */
  readonly cover?: { bytes: ArrayBuffer; mimeType: string } | null;
}

/**
 * Theme color resolution. Kept identical to FoliateBookReader.themeColors
 * so both engines look identical when the user switches between formats.
 *
 * Not exported from `adapters/index.ts` (would collide with Foliate's
 * identically-named export). Consumers import it directly from
 * `adapters/text/PagedTextSession` if needed.
 */
const themeColors = (theme: ReaderTheme): { bg: string; fg: string; scheme: "light" | "dark" | "light dark" } => {
  switch (theme) {
    case "light":
      return { bg: "#ffffff", fg: "#1f2328", scheme: "light" };
    case "dark":
      return { bg: "#1f2328", fg: "#e6edf3", scheme: "dark" };
    case "sepia":
      return { bg: "#f4ecd8", fg: "#4b3b2a", scheme: "light" };
    default:
      return { bg: "Canvas", fg: "CanvasText", scheme: "light dark" };
  }
};

/**
 * Build the CSS string applied to the host element. Mirrors the
 * FoliateBookReader approach — pure function so appearance changes can be
 * applied incrementally without re-rendering the page.
 */
export const buildPagedTextCss = (appearance: ReaderAppearance): string => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  return `
    :root { --ez-reader-font-scale: ${fontScale}; }
    .ez-reader__paged-text {
      font-size: calc(1em * var(--ez-reader-font-scale));
      line-height: ${appearance.lineHeight};
      color: ${theme.fg};
      background: ${theme.bg};
      color-scheme: ${theme.scheme};
      padding: 24px ${appearance.margin}px 64px;
      box-sizing: border-box;
      overflow-y: auto;
      height: 100%;
      font-family: var(--ez-reader-text-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif);
    }
    .ez-reader__paged-text p { margin: 0 0 1em 0; }
    .ez-reader__paged-text a { color: inherit; text-decoration: underline; }
    .ez-reader__paged-text img { max-width: 100%; height: auto; }
    .ez-reader__paged-text h1, .ez-reader__paged-text h2, .ez-reader__paged-text h3,
    .ez-reader__paged-text h4, .ez-reader__paged-text h5, .ez-reader__paged-text h6 {
      line-height: ${appearance.lineHeight};
      margin: 1.2em 0 0.6em;
    }
  `;
};

interface SelectionChangeDetail {
  text: string;
  /** Stable locator string the host can persist. */
  locator: string;
  /** Optional page-relative rect for floating menu positioning. */
  rect: DOMRect | undefined;
}

interface PagedTextSessionOptions {
  readonly content: PagedTextContent;
  readonly host: HTMLElement;
  readonly appearance: ReaderAppearance;
  /** Provider for byte loading — used to convert blob: cover URLs back to bytes if needed. */
  readonly loader: BookBytesLoader;
}

/**
 * Shared session for any flat-HTML paginated book. Used by both TXT and
 * MOBI/AZW3 — TXT pages are character-bounded chunks; MOBI pages are
 * chapters.
 *
 * Selections work the same as the foliate reader: the host listens to
 * `selectionchange` and forwards to its delegate.
 */
export class PagedTextSession implements ReaderSession {
  readonly element: HTMLElement;
  private readonly content: PagedTextContent;
  private readonly stageEl: HTMLElement;
  private readonly host: HTMLElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly disposers = new Set<() => void>();
  private currentPageIndex = 0;
  private currentAppearance: ReaderAppearance;
  private closed = false;
  /** Lazily-injected chapter stylesheets — MOBI carries per-chapter CSS. */
  private readonly injectedCss = new Set<string>();
  private highlights: HighlightSpec[] = [];
  private readonly selectionListeners = new Set<(detail: SelectionChangeDetail) => void>();
  private readonly relocateListeners = new Set<(detail: { fraction: number; chapter?: string; page: number }) => void>();
  private direction: "initial" | "forward" | "backward" = "initial";

  constructor(options: PagedTextSessionOptions) {
    this.content = options.content;
    this.host = options.host;
    this.currentAppearance = options.appearance;

    // Wrap the host so the chapter stylesheets + appearance styles live in
    // a single scoped <style> we can update without touching the user's
    // stylesheet.
    this.element = document.createElement("div");
    this.element.classList.add("ez-reader__paged-text-root");
    this.element.style.height = "100%";
    this.element.style.overflow = "hidden";
    this.styleEl = document.createElement("style");
    this.styleEl.dataset["ezReaderPagedTextStyles"] = "true";
    this.element.append(this.styleEl);

    this.stageEl = document.createElement("div");
    this.stageEl.classList.add("ez-reader__paged-text");
    this.element.append(this.stageEl);

    this.host.append(this.element);
    this.styleEl.textContent = buildPagedTextCss(this.currentAppearance);

    // First render at page 0 — fire-after-mount so listeners attached via
    // `on("relocate", ...)` after `open()` still see the initial position.
    this.renderPage(0, "initial");
  }

  /** Direction of last navigation; ReaderView uses it for page animations. */
  get lastDirection(): "initial" | "forward" | "backward" {
    return this.direction;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.disposers) off();
    this.disposers.clear();
    this.injectedCss.clear();
    try {
      this.element.remove();
    } catch (error) {
      console.warn("[ez-reader] PagedTextSession close failed", error);
    }
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    if (this.closed) return;
    this.currentAppearance = appearance;
    this.styleEl.textContent = buildPagedTextCss(appearance);
  }

  async goTo(target: ReaderTarget): Promise<void> {
    if (this.closed) return;
    switch (target.kind) {
      case "next":
        await this.turnTo(Math.min(this.content.pages.length - 1, this.currentPageIndex + 1), "forward");
        return;
      case "previous":
        await this.turnTo(Math.max(0, this.currentPageIndex - 1), "backward");
        return;
      case "fraction": {
        const total = this.content.pages.length;
        if (total === 0) return;
        const idx = Math.min(total - 1, Math.max(0, Math.round(target.fraction * (total - 1))));
        await this.turnTo(idx, "initial");
        return;
      }
      case "identifier": {
        const idx = Number(target.value);
        if (!Number.isFinite(idx)) {
          // Fall back to TOC id resolution.
          const tocIdx = this.content.toc.findIndex((t) => t.id === target.value);
          if (tocIdx >= 0 && this.content.chapterStartPages[tocIdx] !== undefined) {
            await this.turnTo(this.content.chapterStartPages[tocIdx]!, "initial");
          }
          return;
        }
        await this.turnTo(Math.max(0, Math.min(this.content.pages.length - 1, idx)), "initial");
        return;
      }
    }
  }

  async currentFraction(): Promise<number> {
    if (this.content.pages.length <= 1) return 0;
    return this.currentPageIndex / (this.content.pages.length - 1);
  }

  on<K extends keyof ReaderEventMap>(event: K, handler: (event: ReaderEventMap[K]) => void): () => void {
    if (event === "selection-change") {
      const wrapped = (detail: SelectionChangeDetail) => {
        handler({ detail } as unknown as ReaderEventMap[K]);
      };
      this.selectionListeners.add(wrapped);
      return () => {
        this.selectionListeners.delete(wrapped);
      };
    }
    if (event === "relocate") {
      const wrapped = (detail: { fraction: number; chapter?: string; page: number }) => {
        handler({ detail } as unknown as ReaderEventMap[K]);
      };
      this.relocateListeners.add(wrapped);
      return () => {
        this.relocateListeners.delete(wrapped);
      };
    }
    const wrapped = ((e: Event) => handler(e as ReaderEventMap[K])) as EventListener;
    this.element.addEventListener(event, wrapped);
    const off = () => this.element.removeEventListener(event, wrapped);
    this.disposers.add(off);
    return off;
  }

  async exportLocator(): Promise<string | null> {
    return `paged-text:${this.currentPageIndex}`;
  }

  currentChapter(): string | null {
    return this.content.pages[this.currentPageIndex]?.chapterTitle ?? null;
  }

  currentPage(): number | null {
    return this.currentPageIndex + 1;
  }

  totalPages(): number | null {
    return this.content.pages.length;
  }

  async tableOfContents(): Promise<ReadonlyArray<TocItem>> {
    return this.content.toc;
  }

  async goToToc(id: string): Promise<void> {
    const idx = this.content.toc.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const pageIdx = this.content.chapterStartPages[idx];
    if (typeof pageIdx === "number") {
      await this.turnTo(pageIdx, "initial");
    }
  }

  listHighlights(): ReadonlyArray<HighlightSpec> {
    return [...this.highlights];
  }

  async highlight(spec: HighlightSpec): Promise<void> {
    this.highlights.push(spec);
    this.applyHighlightOverlay(spec);
  }

  async removeHighlight(id: string): Promise<void> {
    this.highlights = this.highlights.filter((h) => h.id !== id);
    // MOBI/TXT highlights live inside the same DOM — strip wrappers.
    const stage = this.stageEl;
    const wraps = stage.querySelectorAll(`[data-ez-reader-highlight-id="${cssEscape(id)}"]`);
    wraps.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
  }

  /** Re-render the current page after a content mutation (e.g. theme switch). */
  private renderPage(pageIdx: number, dir: "initial" | "forward" | "backward"): void {
    this.direction = dir;
    const page = this.content.pages[pageIdx];
    if (!page) return;
    this.currentPageIndex = pageIdx;

    // Inject any per-chapter CSS that hasn't been injected yet (MOBI only).
    // P0 修复: 之前用 `<link rel="stylesheet" href="blob:...">`, Obsidian CSP
    // 拒绝 `blob:` 源 stylesheet, 控制台一直刷 "Refused to load the
    // stylesheet 'blob:...'" 警告. 改成 inline `<style>` (CSP 允许 'unsafe-inline').
    if (page.css) {
      for (const part of page.css) {
        if (this.injectedCss.has(part.id)) continue;
        this.injectedCss.add(part.id);
        const style = document.createElement("style");
        style.dataset["ezReaderPagedTextCss"] = part.id;
        style.textContent = part.text;
        this.element.append(style);
      }
    }

    // Wrap with a fresh container so the page-load animation can play.
    const pageEl = document.createElement("article");
    pageEl.classList.add("ez-reader__paged-text-page");
    pageEl.dataset["pageIndex"] = String(pageIdx);
    pageEl.innerHTML = page.html;
    // Re-apply current highlights whose locator matches this page.
    for (const h of this.highlights) {
      const locatorPageIdx = Number(h.locator.replace(/^paged-text:/, ""));
      if (locatorPageIdx === pageIdx) {
        this.applyHighlightOverlay(h, pageEl);
      }
    }

    this.stageEl.replaceChildren(pageEl);

    // Hook selectionchange for this page — re-attach on every render.
    const onChange = () => this.dispatchSelection();
    document.addEventListener("selectionchange", onChange);
    const cleanupSelection = () => document.removeEventListener("selectionchange", onChange);
    this.disposers.add(cleanupSelection);

    // Fire relocate for any listener attached after mount.
    const total = this.content.pages.length;
    const fraction = total <= 1 ? 0 : pageIdx / (total - 1);
    const detail = { fraction, chapter: page.chapterTitle ?? undefined, page: pageIdx + 1 };
    for (const listener of this.relocateListeners) listener(detail);
  }

  private async turnTo(pageIdx: number, dir: "initial" | "forward" | "backward"): Promise<void> {
    if (pageIdx === this.currentPageIndex) return;
    this.renderPage(pageIdx, dir);
  }

  private dispatchSelection(): void {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text) return;
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    // Only fire when the selection lives inside our stage.
    if (!this.stageEl.contains(range.commonAncestorContainer)) return;
    const detail: SelectionChangeDetail = {
      text,
      locator: `paged-text:${this.currentPageIndex}`,
      rect: rect ?? undefined
    };
    for (const listener of this.selectionListeners) listener(detail);
  }

  private applyHighlightOverlay(spec: HighlightSpec, scope?: HTMLElement): void {
    const root = scope ?? this.stageEl;
    if (!spec.text) return;

    // P0-2: The old implementation used `range.surroundContents`, which
    // throws if the range crosses element boundaries (the common case
    // when a user selects across two paragraphs in TXT / MOBI). We
    // silently broke out of the loop on that error, dropping multi-
    // paragraph highlights entirely.
    //
    // New approach: walk all text nodes in document order, concatenate
    // their content to a single string, find `spec.text` in it, then
    // split each overlapping text node and wrap the matching fragment
    // with `<mark>`. Iterating in reverse keeps later offsets stable
    // when earlier DOM mutations would otherwise shift them.

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const tn = node as Text;
      if ((tn.textContent ?? "").length > 0) textNodes.push(tn);
    }
    if (textNodes.length === 0) return;

    const joined = textNodes.map((n) => n.textContent ?? "").join("");
    const startIdx = joined.indexOf(spec.text);
    if (startIdx < 0) {
      // Text not found on this page — could be split across pages, or
      // content was edited since the excerpt was saved. Not an error.
      return;
    }
    const endIdx = startIdx + spec.text.length;

    // Collect (textNode, startOffsetWithinNode, endOffsetWithinNode) for
    // each node that overlaps the highlight range.
    type Seg = { node: Text; start: number; end: number };
    const segments: Seg[] = [];
    let cursor = 0;
    for (const tn of textNodes) {
      const len = (tn.textContent ?? "").length;
      const nodeStart = cursor;
      const nodeEnd = cursor + len;
      if (nodeEnd > startIdx && nodeStart < endIdx) {
        segments.push({
          node: tn,
          start: Math.max(0, startIdx - nodeStart),
          end: Math.min(len, endIdx - nodeStart)
        });
      }
      cursor = nodeEnd;
      if (cursor >= endIdx) break;
    }
    if (segments.length === 0) return;

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i]!;
      const text = seg.node.textContent ?? "";
      const before = text.slice(0, seg.start);
      const middle = text.slice(seg.start, seg.end);
      const after = text.slice(seg.end);
      const parent = seg.node.parentNode;
      if (!parent) continue;

      const mark = document.createElement("mark");
      mark.className = "ez-reader__highlight";
      mark.dataset["ezReaderHighlightId"] = spec.id;
      mark.style.backgroundColor = highlightColor(spec.color);
      mark.textContent = middle;

      // Build a fragment: [before text] [mark] [after text]. When before
      // or after is empty we skip it so the resulting DOM has no empty
      // text nodes (those confuse downstream selection / walk logic).
      const frag = document.createDocumentFragment();
      if (before.length > 0) frag.appendChild(document.createTextNode(before));
      frag.appendChild(mark);
      if (after.length > 0) frag.appendChild(document.createTextNode(after));
      parent.replaceChild(frag, seg.node);
    }
  }
}

const highlightColor = (color?: HighlightSpec["color"]): string => {
  switch (color) {
    case "red":
      return "rgba(255, 99, 99, 0.35)";
    case "blue":
      return "rgba(99, 153, 255, 0.35)";
    case "green":
      return "rgba(99, 255, 153, 0.35)";
    case "yellow":
    default:
      return "rgba(255, 220, 80, 0.4)";
  }
};

/** Minimal CSS.escape polyfill — only handles the chars our IDs use. */
const cssEscape = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
