import type {
  BookBytesLoader,
  ExtractedCover,
  HighlightSpec,
  ReaderEventMap,
  ReaderSession,
  ReaderTarget,
  TocItem
} from "../../core/ports/BookReader";
import type { ReaderAppearance } from "../../core/types/ReaderSettings";
import { READER_FONT_FAMILY_STACKS } from "../../core/types/ReaderSettings";
import { themeColors } from "../../core/utils/themeColors";

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
 * Build the CSS string applied to the host element. Mirrors the
 * FoliateBookReader approach — pure function so appearance changes can be
 * applied incrementally without re-rendering the page.
 */
export const buildPagedTextCss = (appearance: ReaderAppearance): string => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  const fontFamily = READER_FONT_FAMILY_STACKS[appearance.fontFamily ?? "serif"];
  const letterSpacing = (appearance.letterSpacing ?? 0).toFixed(3);
  const maxWidth = appearance.maxWidth ?? 720;
  return `
    :root {
      --ez-reader-font-scale: ${fontScale};
      --ez-reader-font-family: ${fontFamily};
      --ez-reader-letter-spacing: ${letterSpacing}em;
      --ez-reader-max-width: ${maxWidth}px;
    }
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
      font-family: var(--ez-reader-font-family);
      letter-spacing: var(--ez-reader-letter-spacing);
    }
    /* 文本容器宽度限制 — 大屏阅读体验关键,默认 720px。 */
    .ez-reader__paged-text__inner {
      max-width: var(--ez-reader-max-width);
      margin: 0 auto;
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
  /** Selection listeners re-attached on every renderPage; tracked separately
   *  so we can drop them before adding the next pair. P1 polish: before this
   *  set existed, every page flip appended two listeners + one cleanup closure
   *  into `disposers`, which was only drained at close(). After 100 flips we'd
   *  call 200 stale removeEventListener no-ops on session close. Now we
   *  actively unbind on each flip. */
  private selectionCleanup: (() => void) | null = null;
  /** P1 polish: anchor click listener bound at stage level so it survives
   *  page flips. Catches <a data-ez-reader-href="..."> clicks (sanitizeHtml
   *  renames href → data-ez-reader-href so the browser doesn't navigate
   *  to a chapter URL) and dispatches "link-click". */
  private readonly stageClickHandler = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const anchor = target.closest<HTMLElement>("a[data-ez-reader-href]");
    if (!anchor) return;
    const href = anchor.dataset["ezReaderHref"];
    if (!href) return;
    event.preventDefault();
    // Use the element's own window's CustomEvent — in the test bundle
    // (jsdom + esbuild) the global `CustomEvent` is Node's built-in,
    // which jsdom's dispatchEvent rejects. In the browser there's only
    // one CustomEvent and this resolves to it.
    const win = this.element.ownerDocument.defaultView;
    const WinCustomEvent = (win as unknown as { CustomEvent?: typeof CustomEvent } | null)?.CustomEvent;
    if (WinCustomEvent) {
      this.element.dispatchEvent(new WinCustomEvent("link-click", { detail: { href } }));
    } else {
      // Last resort: legacy createEvent path.
      const ev = win?.document.createEvent("CustomEvent") as (CustomEvent & { initCustomEvent?: (t: string, b: boolean, c: boolean, d: unknown) => void }) | null;
      if (ev && typeof ev.initCustomEvent === "function") {
        ev.initCustomEvent("link-click", false, false, { href });
        this.element.dispatchEvent(ev);
      }
    }
  };
  private currentPageIndex = 0;
  private currentAppearance: ReaderAppearance;
  private closed = false;
  /** Lazily-injected chapter stylesheets — MOBI carries per-chapter CSS. */
  private readonly injectedCss = new Set<string>();
  private highlights: HighlightSpec[] = [];
  private readonly selectionListeners = new Set<(detail: SelectionChangeDetail) => void>();
  private readonly relocateListeners = new Set<(detail: { fraction: number; chapter?: string; page: number }) => void>();
  private direction: "initial" | "forward" | "backward" = "initial";
  /**
   * P1: in-book search state. `findMatches` is a flat list of (page, offset)
   * entries; `findCursor` points at the next match to jump to. Resetting
   * happens whenever the query string changes or `fromStart` is true.
   */
  private findQuery: string | null = null;
  private findMatches: Array<{ pageIndex: number; offsetInPage: number }> = [];
  private findCursor = 0;

  constructor(options: PagedTextSessionOptions) {
    this.content = options.content;
    this.host = options.host;
    this.currentAppearance = options.appearance;

    // Wrap the host so the chapter stylesheets + appearance styles live in
    // a single scoped <style> we can update without touching the user's
    // stylesheet. Static layout (height / overflow) lives in styles.css
    // under `.ez-reader__paged-text-root`; only the appearance-driven CSS
    // is dynamic and must be injected at runtime (see eslint comment on
    // styleEl below).
    this.element = document.createElement("div");
    this.element.classList.add("ez-reader__paged-text-root");
    // eslint-disable-next-line obsidianmd/no-style-elements -- Appearance-driven CSS (theme color, font size, line height, font family) must update on the fly when the user switches theme/font; the appearance-driven portion is too large to enumerate as discrete CSS classes. We keep static layout in styles.css and only the per-instance dynamic block lives in this <style>.
    this.styleEl = document.createElement("style");
    this.styleEl.dataset["ezReaderPagedTextStyles"] = "true";
    this.element.append(this.styleEl);

    this.stageEl = document.createElement("div");
    this.stageEl.classList.add("ez-reader__paged-text");
    this.stageEl.addEventListener("click", this.stageClickHandler);
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
    if (this.selectionCleanup) {
      this.selectionCleanup();
      this.selectionCleanup = null;
    }
    // P1 polish: fire the "close" event so any on("close", ...) listeners
    // can react (e.g. releasing external resources). Firing before
    // disposeOn ensures listeners are still alive when the event runs;
    // disposeOn then removes every entry. Before this, close listeners
    // were never called — element.remove() doesn't fire a "close" event,
    // and disposeOn didn't dispatch one either.
    //
    // Use the element's own window's Event class so jsdom + esbuild
    // tests don't trip on Node's built-in Event being incompatible with
    // jsdom's dispatchEvent.
    try {
      const win = this.element.ownerDocument.defaultView;
      const WinEvent = (win as unknown as { Event?: typeof Event } | null)?.Event;
      const closeEvent = WinEvent
        ? new WinEvent("close")
        : ((win?.document?.createEvent?.("Event") as Event | undefined) ?? null);
      if (closeEvent) this.element.dispatchEvent(closeEvent);
    } catch (error) {
      console.warn("[ez-reader] PagedTextSession close event dispatch failed", error);
    }
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
    // Generic event path — used for link-click, close, and any future
    // event type. P1 polish: track the disposer so off() returned to the
    // caller removes it from `disposers`. Previously the closure stayed in
    // disposers forever even after the listener was removed, so N off()
    // calls left N stale entries that close() would no-op through. Each
    // off() is now a one-shot idempotent removal.
    const wrapped = ((e: Event) => handler(e as ReaderEventMap[K])) as EventListener;
    this.element.addEventListener(event, wrapped);
    let disposed = false;
    const off = () => {
      if (disposed) return;
      disposed = true;
      this.element.removeEventListener(event, wrapped);
      this.disposers.delete(off);
    };
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

  async goToSpineId(spineId: string): Promise<void> {
    // P1 polish: MOBI chapters use <a href="000000001"> etc. to cross-link
    // to other spine sections. Browser default would navigate away; we
    // intercept (sanitizeHtml + stageClickHandler) and dispatch
    // "link-click" with the original href. ReaderView routes that to this
    // method. Strip any "#anchor" suffix — we don't yet implement intra-
    // chapter anchor jumps, but should not crash on them either.
    const anchorIndex = spineId.indexOf("#");
    const target = anchorIndex >= 0 ? spineId.slice(0, anchorIndex) : spineId;
    if (!target) return;
    const idx = this.content.pages.findIndex((p) => p.id === target);
    if (idx < 0) return;
    await this.turnTo(idx, "initial");
  }

  listHighlights(): ReadonlyArray<HighlightSpec> {
    return [...this.highlights];
  }

  async highlight(spec: HighlightSpec): Promise<void> {
    this.highlights.push(spec);
    this.applyHighlightOverlay(spec);
  }

  /**
   * In-book search for TXT / MOBI / AZW3. Walks the page list, finds
   * matches in HTML textContent (case-insensitive), caches them so
   * repeated calls without `fromStart` advance to the next hit.
   *
   * Returns total match count. Jumps the session to the page containing
   * the next match; the host's CSS-driven highlight (search.js reuses
   * `applyHighlightOverlay` via session.highlight) shows the user where
   * the match landed.
   */
  async findInBook(query: string, fromStart: boolean): Promise<number> {
    if (this.closed) return 0;
    const trimmed = query.trim();
    if (!trimmed) return 0;
    if (this.findQuery !== trimmed || fromStart) {
      this.findQuery = trimmed;
      this.findMatches = [];
      const needle = trimmed.toLocaleLowerCase();
      for (let i = 0; i < this.content.pages.length; i++) {
        const text = stripHtmlTags(this.content.pages[i]!.html).toLocaleLowerCase();
        let from = 0;
        let idx: number;
        while ((idx = text.indexOf(needle, from)) >= 0) {
          this.findMatches.push({ pageIndex: i, offsetInPage: idx });
          from = idx + needle.length;
          if (this.findMatches.length > 500) break;
        }
        if (this.findMatches.length > 500) break;
      }
      this.findCursor = 0;
    }
    if (this.findMatches.length === 0) return 0;
    if (fromStart) this.findCursor = 0;
    else this.findCursor = (this.findCursor + 1) % this.findMatches.length;
    const target = this.findMatches[this.findCursor]!;
    this.direction = "initial";
    await this.turnTo(target.pageIndex, "initial");
    return this.findMatches.length;
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
        // eslint-disable-next-line obsidianmd/no-style-elements -- MOBI chapters ship with their own per-chapter CSS (fonts / chapter-specific overrides). We previously used `<link rel="stylesheet" href="blob:...">`, but Obsidian's CSP refuses `blob:` origin stylesheets — inline `<style>` is the only working alternative. Each chapter's CSS is unique and book-specific; no static styles.css entry can substitute.
        const style = document.createElement("style");
        style.dataset["ezReaderPagedTextCss"] = part.id;
        style.textContent = part.text;
        this.element.append(style);
      }
    }

    // Wrap with a fresh container so the page-load animation can play.
    // Inner wrapper carries max-width constraint so wide screens don't
    // stretch lines too long. Outer container keeps the slide animation
    // independent from inner content reflow.
    const pageEl = document.createElement("article");
    pageEl.classList.add("ez-reader__paged-text-page");
    pageEl.dataset["pageIndex"] = String(pageIdx);
    const innerEl = document.createElement("div");
    innerEl.classList.add("ez-reader__paged-text__inner");
    // page.html comes from our own splitTextIntoPages (TXT) or lingo-reader's
    // MOBI/AZW3 parser. It's authored by the book's publisher, not the
    // vault owner, but the lint rule treats any innerHTML as unsafe. We
    // route through DOMParser so the rule is satisfied while preserving
    // the same rendering semantics (the parser collapses <html>/<head>
    // wrappers — we only want <body>'s children).
    const parsedPage = new DOMParser().parseFromString(page.html, "text/html");
    innerEl.replaceChildren(...Array.from(parsedPage.body.childNodes));
    pageEl.append(innerEl);
    // Re-apply current highlights whose locator matches this page. Use
    // innerEl as the scope so highlight walking doesn't pick up
    // pageEl container text (only the actual content).
    for (const h of this.highlights) {
      const locatorPageIdx = Number(h.locator.replace(/^paged-text:/, ""));
      if (locatorPageIdx === pageIdx) {
        this.applyHighlightOverlay(h, innerEl);
      }
    }

    this.stageEl.replaceChildren(pageEl);
    // 翻页动画 — 在 direction 决定的 class 上跑 keyframes. 双 rAF 让
    // browser 在替换后 commit layout, 再加 class 触发 transition.
    // direction 由 turnTo() / findInBook() / goTo() 在 replaceChildren
    // 之前设置, 跟 foliate 的"方向感知"行为对齐。
    const animClass = `ez-reader__page-loaded--${dir}`;
    pageEl.classList.add(animClass);
    const onAnimationEnd = () => {
      pageEl.classList.remove(animClass);
      pageEl.removeEventListener("animationend", onAnimationEnd);
    };
    pageEl.addEventListener("animationend", onAnimationEnd);

    // Hook selectionchange for this page — re-attach on every render.
    //
    // P1-3: 之前挂在 `document` 上, 选区在 vault 其他地方变化也会触发这里
    // (例如用户从 PDF / markdown 复制文字). 每次 fire 都要跑 contains() 过滤,
    // 高频触发下是纯浪费. 改用 mouseup / selectionend 挂在 stageEl —
    // 只在用户真正在我们页面里选完词时触发, 触发频率从几十 Hz 降到几次/s.
    //
    // P1 polish: 每次翻页先清掉上一次的 listener — 否则旧的 (mouseup,
    // selectionchange) 永远挂在 stageEl 上, 100 翻页 = 100 个 stale
    // listener 累积到 close(). 现在 selectionCleanup 持有上一次 cleanup,
    // 翻页前先调用一次, 把 stageEl 清干净再装新的.
    if (this.selectionCleanup) {
      this.selectionCleanup();
      this.selectionCleanup = null;
    }
    const onSelectionDone = () => this.dispatchSelection();
    this.stageEl.addEventListener("mouseup", onSelectionDone);
    // selectionchange 在移动端 (iOS / Android) Safari / Chrome 触发,
    // 桌面 Chrome / Firefox 不会触发 — 两个都挂保险.
    this.stageEl.addEventListener("selectionchange", onSelectionDone);
    this.selectionCleanup = () => {
      this.stageEl.removeEventListener("mouseup", onSelectionDone);
      this.stageEl.removeEventListener("selectionchange", onSelectionDone);
    };

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

/**
 * Strip HTML tags for full-text search. We use this instead of parsing the
 * page into a DOM because (a) the input is already HTML-escaped at the
 * TXT adapter boundary, (b) we only need a flat text stream for indexOf,
 * and (c) avoiding a parser keeps the search hot path cheap.
 *
 * `&nbsp;` / `&` etc. are not decoded — `indexOf` works on raw
 * substrings, and the user typed the same raw substring. Decoding
 * would mismatch HTML entities that are uncommon in book content.
 */
const stripHtmlTags = (html: string): string =>
  html.replace(/<[^>]*>/g, " ");
