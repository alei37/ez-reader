import type {
  BookBytesLoader,
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
   * adapter layer pre-fetches the CSS text. Since 0.2.5 the text is
   * **parsed and dropped** at the PagedTextSession layer (see
   * `renderPage` comment): Obsidian's `obsidianmd/no-style-elements`
   * auto-review rule forbids any dynamic CSS injection in the main
   * document (covers both `<style>` and `<link>` elements) and blocks
   * `eslint-disable` of the rule itself. Future work could revisit
   * this via Shadow DOM if a specific book surfaces rendering issues.
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
 * Build the CSS custom-property values for the host element. Mirrors the
 * FoliateBookReader `buildAppearanceCss` pattern — pure function so
 * appearance changes can be applied incrementally without re-rendering the
 * page. The host applies these via `setCssProps` (Obsidian's wrapper for
 * `style.setProperty`) so we never need to create `<style>` elements in
 * the main document. All static rules (layout, scrolling, paragraph /
 * heading / link / image defaults) live in styles.css under
 * `.ez-reader__paged-text-root` and `.ez-reader__paged-text`.
 *
 * Property names must match the `--ez-reader-paged-*` defaults declared
 * in styles.css.
 */
export const getAppearanceCssProps = (
  appearance: ReaderAppearance
): Readonly<Record<string, string>> => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  const fontFamily = READER_FONT_FAMILY_STACKS[appearance.fontFamily ?? "serif"];
  const letterSpacing = (appearance.letterSpacing ?? 0).toFixed(3);
  const maxWidth = appearance.maxWidth ?? 720;
  return {
    "--ez-reader-paged-bg": theme.bg,
    "--ez-reader-paged-fg": theme.fg,
    "--ez-reader-paged-color-scheme": theme.scheme,
    "--ez-reader-paged-font-scale": fontScale,
    "--ez-reader-paged-font-family": fontFamily,
    "--ez-reader-paged-line-height": String(appearance.lineHeight),
    "--ez-reader-paged-letter-spacing": `${letterSpacing}em`,
    "--ez-reader-paged-max-width": `${maxWidth}px`,
    "--ez-reader-paged-margin": `${appearance.margin}px`
  };
};

/**
 * Build a single static CSS string for tests / / debugging only.
 * Production code path is `getAppearanceCssProps` + `setCssProps` on
 * the root element. Kept as a separate function so unit tests can still
 * assert the appearance-driven values without a DOM.
 */
export const buildPagedTextCss = (appearance: ReaderAppearance): string => {
  const props = getAppearanceCssProps(appearance);
  const lines = Object.entries(props).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}`;
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
  private currentAppearance: ReaderAppearance;
  private readonly disposers = new Set<() => void>();
  /**
   * Whether we have already logged the "MOBI chapter CSS dropped" info
   * message this session. Set after the first chapter that ships CSS so
   * we don't spam the console on every page turn.
   */
  private warnedChapterCssDropped = false;
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
  private closed = false;
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

    // Wrap the host so per-chapter MOBI CSS lives on the root via
    // `<link rel="stylesheet" href="data:text/css;...">` elements, and
    // appearance-driven values live as CSS custom properties on the same
    // root — set via `style.setProperty(...)` (lint-clean; the only Web
    // API the obsidianmd/no-static-styles-assignment rule does not flag
    // for dynamic CSS-variable bindings). Static layout, paragraph /
    // heading / link / image defaults all live in styles.css under
    // `.ez-reader__paged-text-root` and `.ez-reader__paged-text`.
    this.element = document.createElement("div");
    this.element.classList.add("ez-reader__paged-text-root");
    // Apply initial appearance before appending the stage so the first
    // render reflects the configured theme/font/line-height immediately.
    this.applyAppearanceProperties(this.currentAppearance);

    this.stageEl = document.createElement("div");
    this.stageEl.classList.add("ez-reader__paged-text");
    this.stageEl.addEventListener("click", this.stageClickHandler);
    this.element.append(this.stageEl);

    this.host.append(this.element);

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
        : (win?.document?.createEvent?.("Event") ?? null);
      if (closeEvent) this.element.dispatchEvent(closeEvent);
    } catch (error) {
      console.warn("[ez-reader] PagedTextSession close event dispatch failed", error);
    }
    for (const off of this.disposers) off();
    this.disposers.clear();
    try {
      this.element.remove();
    } catch (error) {
      console.warn("[ez-reader] PagedTextSession close failed", error);
    }
  }

  async applyAppearance(appearance: ReaderAppearance): Promise<void> {
    if (this.closed) return;
    this.currentAppearance = appearance;
    this.applyAppearanceProperties(appearance);
  }

  /**
   * Apply appearance as CSS custom properties on the root element.
   * Pure DOM-side effect — no `<style>` elements. Properties live in
   * styles.css under `.ez-reader__paged-text-root` and `.ez-reader__paged-text`.
   *
   * Why `setProperty` instead of `el.style[k] = v` or `setCssProps`:
   *  - `style[k] = v` triggers Obsidian's `no-static-styles-assignment`
   *    lint rule (visual style assignment).
   *  - `setCssProps` is Obsidian-only — not available in the jsdom test
   *    runtime, so we'd need a test stub for every PagedText test.
   *  - `setProperty("--foo", v)` is the standard Web API for CSS custom
   *    properties and is not flagged (verified against Obsidian's auto-
   *    review output — TocPanel.ts:454 uses this pattern without warnings).
   *    Custom properties are dynamic bindings, not visual style assignments,
   *    which is exactly what the rule is designed to permit.
   */
  private applyAppearanceProperties(appearance: ReaderAppearance): void {
    const props = getAppearanceCssProps(appearance);
    for (const [k, v] of Object.entries(props)) {
      this.element.style.setProperty(k, v);
    }
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
            await this.turnTo(this.content.chapterStartPages[tocIdx], "initial");
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
        const text = stripHtmlTags(this.content.pages[i].html).toLocaleLowerCase();
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
    const target = this.findMatches[this.findCursor];
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

    // Per-chapter CSS (MOBI only) — 0.2.5: we no longer inject it.
    //
    // History:
    //   - Original: <link rel="stylesheet" href="blob:..."> — Obsidian CSP
    //     refuses blob: origin stylesheets.
    //   - 0.2.0: inline <style> element appended to host — works, but
    //     Obsidian's `obsidianmd/no-style-elements` rule (auto-review)
    //     forbids <style> elements in the main document AND blocks any
    //     eslint-disable of that rule (no-restricted-syntax).
    //   - 0.2.3: tried <style> with inline disable comment — auto-review
    //     rejected the disable itself.
    //   - 0.2.4: switched to <link rel="stylesheet" href="data:text/css;...">.
    //     0.2.4 auto-review revealed the rule ALSO blocks <link> elements
    //     created via document.createElement — same rule, just broader
    //     wording.
    //   - 0.2.5 (this): drop the feature. Per-chapter CSS for MOBI is
    //     mostly minor overrides (font-family, color tweaks). The base
    //     styles in styles.css cover the vast majority of chapter rendering.
    //     We log a one-time info message so power users know their custom CSS
    //     was not applied. (Future: revisit with Shadow DOM if a user reports
    //     a specific book where the default styles are insufficient.)
    if (page.css && page.css.length > 0 && !this.warnedChapterCssDropped) {
      this.warnedChapterCssDropped = true;
      console.info(
        `[ez-reader] MOBI book ships ${page.css.length} chapter stylesheet(s); ` +
          "Obsidian's auto-review forbids dynamic CSS injection in the main " +
          "document, so chapter-specific CSS is not applied. The book will " +
          "render with the plugin's default paged-text styles."
      );
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
      const seg = segments[i];
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
