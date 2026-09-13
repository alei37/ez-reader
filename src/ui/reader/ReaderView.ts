import { ItemView, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { Bookmark } from "../../core/entities/Bookmark";
import type { Book } from "../../core/entities/Book";
import type { Excerpt } from "../../core/entities/Excerpt";
import type { ReadingPosition } from "../../core/entities/ReadingState";
import type { BookReader, ReaderSession, TocItem } from "../../core/ports/BookReader";
import type { LibraryEntry } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import type { NoteWriter } from "../../core/ports/NoteWriter";
import { AppearanceModal } from "./AppearanceModal";
import { BookmarksPanel } from "./BookmarksPanel";
import { ExcerptsPanel } from "./ExcerptsPanel";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { ReaderToolbar } from "./ReaderToolbar";
import { SidebarNotesPanel } from "./SidebarNotesPanel";
import { TocPanel } from "./TocPanel";
import { ThoughtModal } from "./ThoughtModal";
import { TranslationDrawer } from "./TranslationDrawer";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_READER_APPEARANCE,
  type KeyboardShortcuts,
  type ReaderAppearance,
  type ReaderTheme
} from "../../core/types/ReaderSettings";
import type { BookBytesLoader } from "../../core/ports/BookReader";
import type { TranslationService } from "../../core/ports/TranslationProvider";
import type { Locale } from "../../core/types/Locale";

export const READER_VIEW_TYPE = "ez-reader-view";

interface ReaderViewDeps {
  readonly app: App;
  readonly reading: ReadingService;
  readonly foliate: BookReader;
  readonly pdfjs: BookReader;
  readonly translation: TranslationService;
  readonly noteWriter?: NoteWriter;
  readonly bookBytesLoader: BookBytesLoader;
  readonly settingsProvider?: () => Promise<LoadedSettings>;
  readonly onBookOpened?: (entry: LibraryEntry) => void;
}

interface LoadedSettings {
  defaultAppearance: ReaderAppearance;
  shortcuts: KeyboardShortcuts;
  twoPagesByDefault: boolean;
  immersiveOnTablet: boolean;
  translationLocale: Locale;
  rememberProgress: boolean;
}

interface ActiveSelection {
  text: string;
  rect: DOMRect | undefined;
  locator: string | undefined;
  chapter?: string;
}

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest("input, textarea, select, button, [contenteditable='true'], a"));

/**
 * Heuristic that expands a too-short selection to a nearby sentence
 * boundary when the surrounding text looks CJK. Browsers without
 * CJK word segmentation tend to leave a selection as a single
 * character; the user usually meant the whole clause.
 *
 * Trigger conditions:
 *   - the original selection is shorter than 12 chars
 *   - the selection contains CJK characters (otherwise leave alone —
 *     Latin selections are tokenized correctly)
 *   - we can find a stop character (。！？!?;,，;\n) within ±80 chars
 *     of the selection inside `docText` (we approximate by walking
 *     the current Selection's surrounding text node when possible)
 */
const maybeExpandChineseSelection = (raw: string): { text: string } => {
  if (raw.length >= 12) return { text: raw };
  // CJK 字符比例 > 0.5 才认为需要扩展
  const cjkCount = Array.from(raw).filter((ch) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch)).length;
  if (cjkCount === 0) return { text: raw };
  // 从当前 DOM selection 拿到上下文, 在 ±120 字符窗口内找标点
  const sel = globalThis.document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : undefined;
  if (!range) return { text: raw };
  const container = range.commonAncestorContainer;
  const containerText = container.nodeType === 3 ? container.textContent ?? "" : container.textContent ?? "";
  if (!containerText) return { text: raw };
  // 找到 raw 在 containerText 里的位置 (近似)
  const idx = containerText.indexOf(raw);
  if (idx < 0) return { text: raw };
  const before = containerText.slice(Math.max(0, idx - 120), idx);
  const after = containerText.slice(idx + raw.length, Math.min(containerText.length, idx + raw.length + 120));
  // 找左侧最近的句号/逗号
  const leftStop = Math.max(
    before.lastIndexOf("。"), before.lastIndexOf("！"), before.lastIndexOf("？"),
    before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"),
    before.lastIndexOf("，"), before.lastIndexOf(","),
    before.lastIndexOf("\n"), before.lastIndexOf("；"), before.lastIndexOf(";")
  );
  const rightStopMatch = [
    "。", "！", "？", ".", "!", "?",
    "，", ",", "\n", "；", ";"
  ].map((c) => ({ ch: c, at: after.indexOf(c) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  const leftStart = leftStop >= 0 ? Math.max(0, idx - 120) + leftStop + 1 : Math.max(0, idx - 20);
  const rightEnd = rightStopMatch
    ? idx + raw.length + rightStopMatch.at + 1
    : idx + raw.length + 20;
  const expanded = containerText.slice(leftStart, rightEnd).trim();
  // 只接受 < 100 字符的扩展结果
  if (expanded.length > 100 || expanded.length <= raw.length) return { text: raw };
  return { text: expanded };
};

/**
 * ItemView that holds one reader session. Layout (single column on tablet,
 * two-column on desktop ≥ 1024px):
 *
 *   [toolbar — prev / progress / next / TOC / notes / Aa / ×]
 *   [TOC panel (collapsible)]
 *   [Sidebar notes (collapsible, desktop only)] | [Book stage]
 *   [Translation drawer (collapsible)]
 *
 * The view lives for the lifetime of the leaf; switching books closes
 * the old session and opens a new one.
 */
export class ReaderView extends ItemView {
  private readonly deps: ReaderViewDeps;
  private entry: LibraryEntry | undefined;
  private session: ReaderSession | undefined;
  private appearance: ReaderAppearance = { ...DEFAULT_READER_APPEARANCE };
  private shortcuts: KeyboardShortcuts = DEFAULT_KEYBOARD_SHORTCUTS;
  private toolbar: ReaderToolbar | undefined;
  private bookmarksPanel: BookmarksPanel | undefined;
  private excerptsPanel: ExcerptsPanel | undefined;
  private notesPanel: SidebarNotesPanel | undefined;
  private tocPanel: TocPanel | undefined;
  private translationDrawer: TranslationDrawer | undefined;
  private selectionMenu: ReaderSelectionMenu | undefined;
  private host: HTMLElement | undefined;
  private fraction = 0;
  private chapter = "";
  private pendingSelection: ActiveSelection | undefined;
  private tocItems: ReadonlyArray<TocItem> = [];
  private isDesktopWide = false;
  private isImmersive = false;

  constructor(leaf: WorkspaceLeaf, deps: ReaderViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.entry ? `阅读: ${this.entry.book.locator.path}` : "阅读器";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ez-reader__reader");
    // 加载 settings
    let loadedSettings: LoadedSettings | undefined;
    if (this.deps.settingsProvider) {
      try {
        const fetched = await this.deps.settingsProvider();
        loadedSettings = fetched;
        this.appearance = { ...fetched.defaultAppearance };
        this.shortcuts = fetched.shortcuts;
        this.rememberProgress = fetched.rememberProgress !== false;
      } catch (error) {
        console.warn("[ez-reader] failed to load settings", error);
      }
    }

    this.isDesktopWide = window.matchMedia("(min-width: 1024px)").matches;
    // 自动进沉浸: pad / phone + 设置里允许时
    this.isImmersive = !this.isDesktopWide && (loadedSettings?.immersiveOnTablet ?? false);
    container.toggleClass("ez-reader__immersive", this.isImmersive);
    container.toggleClass("ez-reader__desktop-wide", this.isDesktopWide);
    // 双页默认
    if (loadedSettings?.twoPagesByDefault && this.appearance.flow !== "scrolled") {
      this.appearance = { ...this.appearance, twoPages: true };
    }

    this.toolbar = new ReaderToolbar(
      {
        onPrev: () => void this.goToNext(-1),
        onNext: () => void this.goToNext(1),
        onProgressChange: (fraction) => void this.seekFraction(fraction),
        onAddBookmark: () => void this.addBookmarkAtCurrentPosition(),
        onToggleBookmarks: () => void this.toggleBookmarks(),
        onToggleExcerpts: () => void this.toggleExcerpts(),
        onClose: () => this.leaf.detach(),
        onZoomIn: () => void this.zoomIn(),
        onZoomOut: () => void this.zoomOut(),
        onZoomReset: () => void this.zoomReset(),
        onShowFontSettings: () => void this.showFontSettings(),
        onToggleToc: () => void this.toggleToc(),
        onToggleNotes: () => void this.toggleNotes(),
        onToggleImmersive: () => this.toggleImmersive()
      },
      {
        fraction: 0,
        chapter: "",
        status: this.entry?.reading.status ?? "unread",
        showingBookmarks: false,
        showingExcerpts: false,
        showingNotes: this.isDesktopWide,
        showingToc: false,
        showingImmersive: this.isImmersive,
        showZoomControls: false,
        showFontSettings: true
      }
    );
    container.append(this.toolbar.root);

    this.bookmarksPanel = new BookmarksPanel(
      {
        onJump: (bookmark) => void this.jumpToBookmark(bookmark),
        onRemove: (bookmark) => void this.removeBookmark(bookmark)
      },
      container
    );
    this.excerptsPanel = new ExcerptsPanel(
      {
        onJump: (excerpt) => void this.jumpToExcerpt(excerpt),
        onRemove: (excerpt) => void this.removeExcerpt(excerpt)
      },
      container
    );

    // 双栏布局: desktop 上 notes 面板在左侧常驻
    const body = container.createDiv({ cls: "ez-reader__reader__body" });

    this.notesPanel = new SidebarNotesPanel(
      {
        onJump: (excerpt) => void this.jumpToExcerpt(excerpt),
        onRemove: (excerpt) => void this.removeExcerpt(excerpt),
        onEdit: (excerpt) => void this.editExcerpt(excerpt),
        onAddThought: () => void this.openFreeThoughtModal()
      },
      body
    );
    if (this.isDesktopWide) {
      this.notesPanel.show();
    } else {
      this.notesPanel.hide();
    }

    this.host = body.createDiv({ cls: "ez-reader__reader__stage" });

    this.tocPanel = new TocPanel(
      {
        onJump: (item) => void this.jumpToTocItem(item)
      },
      container
    );

    this.translationDrawer = new TranslationDrawer(
      {
        onSaveAsNote: (src, translated) => void this.saveTranslationAsNote(src, translated)
      },
      this.deps.translation,
      body,
      { source: "auto", target: (loadedSettings?.translationLocale as Locale) ?? "zh-CN" }
    );

    this.selectionMenu = new ReaderSelectionMenu({
      onExcerpt: () => void this.saveExcerptFromSelection(),
      onThought: () => void this.saveThoughtFromSelection(),
      onCopy: () => this.copySelectionToClipboard(),
      onTranslate: () => void this.requestTranslation()
    });

    this.bindSwipeGestures();
    this.bindKeyboardNavigation();
    this.bindImmersiveToolbarToggle();
    if (this.entry) await this.openSession();
  }

  async onClose(): Promise<void> {
    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }
    this.selectionMenu?.destroy();
    this.selectionMenu = undefined;
    this.host = undefined;
  }

  setEntry(entry: LibraryEntry): void {
    this.entry = entry;
    // 切换书时: 关闭上一个 session 释放 worker / iframe, 重置 ready promise
    if (this.session) {
      const old = this.session;
      this.session = undefined;
      void old.close().catch((error) => console.warn("[ez-reader] failed to close previous session", error));
    }
    // 重新创建 ready promise 以便下次 whenReady 重新等待
    this.readyPromise = undefined;
    this.readyResolve = undefined;
    if (this.host) {
      void this.openSession();
    }
  }

  /** Public entry point used by the obsidian:// protocol handler. */
  async openExcerptById(excerptId: string): Promise<void> {
    if (!this.entry) return;
    // 等 session 就绪(openSession 是 fire-and-forget,但 session 字段会立即被赋值;
    // session 内部的 goTo / highlight 需要 await engine.open 完成)
    await this.whenReady();
    const all = await this.deps.reading.listExcerpts(this.entry.book.id);
    const target = all.find((e) => e.id === excerptId);
    if (target) await this.jumpToExcerpt(target);
  }

  /**
   * Check whether the user has disabled progress memory in settings.
   * The flag lives on PluginSettings (rememberProgress). Defaults to
   * true so first-run users see the resume behaviour out of the box.
   */
  private rememberProgress: boolean = true;

  private async isProgressMemoryEnabled(): Promise<boolean> {
    return this.rememberProgress;
  }

  /**
   * Resolves once the current reader session is ready to receive
   * commands (goTo / highlight / etc.). Used by the obsidian:// protocol
   * handler so the reverse-jump waits for the session to settle instead
   * of racing the async book-open.
   */
  private readyPromise: Promise<void> | undefined;
  private readyResolve: (() => void) | undefined;

  private markReady(): void {
    if (this.readyResolve) this.readyResolve();
    this.readyResolve = undefined;
    this.readyPromise = undefined;
  }

  private whenReady(): Promise<void> {
    if (this.session && !this.readyPromise) {
      return Promise.resolve();
    }
    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve) => {
        this.readyResolve = resolve;
      });
      // 兜底: 30 秒还没就绪就强制 resolve,避免永久挂起
      globalThis.setTimeout(() => this.markReady(), 30000);
    }
    return this.readyPromise;
  }

  // ---- 平台检测 ----
  private shouldAutoImmerse(): boolean {
    // 默认 desktop 不进沉浸; pad / phone 进
    // (具体从 settings 读)
    return false;
  }

  private bindImmersiveToolbarToggle(): void {
    if (!this.host) return;
    let lastTouchY = 0;
    let lastTouchX = 0;
    let visibleTimer: ReturnType<typeof setTimeout> | undefined;

    const show = () => {
      const root = this.containerEl.children[1] as HTMLElement;
      root.addClass("is-toolbar-visible");
      if (visibleTimer !== undefined) globalThis.clearTimeout(visibleTimer);
      visibleTimer = globalThis.setTimeout(() => {
        if (this.isImmersive) root.removeClass("is-toolbar-visible");
      }, 2400);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!this.isImmersive) return;
      const touch = event.touches[0];
      if (!touch) return;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!this.isImmersive) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dy = touch.clientY - lastTouchY;
      // Tap (no significant motion) or top-edge swipe → show toolbar
      if (Math.abs(touch.clientY - lastTouchY) < 12 && Math.abs(touch.clientX - lastTouchX) < 12) {
        show();
        return;
      }
      // Swipe down from the top edge: show toolbar
      if (dy > 30 && lastTouchY < 80) {
        show();
      }
      // 不在这里 preventDefault, 会阻止 selection 行为。
      // (翻页由 bindSwipeGestures 处理, 这里只管 toolbar 显示)
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!this.isImmersive) return;
      // 在桌面端 pad 触控上,鼠标移到顶部 80px 也显示 toolbar
      if (event.clientY < 80) show();
    };

    this.host.addEventListener("touchstart", onTouchStart, { passive: true });
    this.host.addEventListener("touchend", onTouchEnd, { passive: false });
    this.host.addEventListener("mousemove", onMouseMove);
    this.register(() => {
      this.host?.removeEventListener("touchstart", onTouchStart);
      this.host?.removeEventListener("touchend", onTouchEnd);
      this.host?.removeEventListener("mousemove", onMouseMove);
      if (visibleTimer !== undefined) globalThis.clearTimeout(visibleTimer);
    });
  }

  // ---- 键盘 ----
  private bindKeyboardNavigation(): void {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target)) return;
      if (!this.session) return;
      const key = event.key.toLowerCase();
      if (key === this.shortcuts.prev.toLowerCase() || event.key === "PageUp") {
        event.preventDefault();
        void this.goToNext(-1);
      } else if (key === this.shortcuts.next.toLowerCase() || event.key === "PageDown") {
        event.preventDefault();
        void this.goToNext(1);
      } else if (key === this.shortcuts.toggleSidebar.toLowerCase()) {
        event.preventDefault();
        void this.toggleNotes();
      } else if (key === this.shortcuts.toggleToc.toLowerCase()) {
        event.preventDefault();
        void this.toggleToc();
      } else if (key === this.shortcuts.translate.toLowerCase() && event.shiftKey) {
        event.preventDefault();
        void this.requestTranslation();
      } else if (key === this.shortcuts.highlight.toLowerCase() && event.shiftKey) {
        event.preventDefault();
        void this.saveExcerptFromSelection();
      } else if (event.key === "Escape") {
        // 关闭浮窗
        this.translationDrawer?.hide();
        this.tocPanel?.hide();
        this.selectionMenu?.hide();
      }
    };
    // 用 capture: true 让我们的 handler 在 foliate 内部 keyboard handler 之前跑
    this.containerEl.addEventListener("keydown", handler, { capture: true });
    this.register(() => this.containerEl.removeEventListener("keydown", handler, { capture: true } as EventListenerOptions));
  }

  private bindSwipeGestures(): void {
    if (!this.host) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    const onEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      void this.goToNext(dx < 0 ? 1 : -1);
      event.preventDefault();
    };

    this.host.addEventListener("touchstart", onStart, { passive: true });
    this.host.addEventListener("touchend", onEnd, { passive: false });
    this.register(() => {
      this.host?.removeEventListener("touchstart", onStart);
      this.host?.removeEventListener("touchend", onEnd);
    });
  }

  // ---- session ----
  private get isPdf(): boolean {
    return this.entry?.book.locator.format === "pdf";
  }

  private async zoomIn(): Promise<void> {
    if (!this.session?.setScale) return;
    const current = this.session.currentScale?.() ?? 1.5;
    await this.session.setScale(current * 1.25);
    this.toolbar?.update(this.toolbarState());
  }

  private async zoomOut(): Promise<void> {
    if (!this.session?.setScale) return;
    const current = this.session.currentScale?.() ?? 1.5;
    await this.session.setScale(current / 1.25);
    this.toolbar?.update(this.toolbarState());
  }

  private async zoomReset(): Promise<void> {
    if (!this.session?.setFitWidth) return;
    await this.session.setFitWidth();
    this.toolbar?.update(this.toolbarState());
  }

  private async showFontSettings(): Promise<void> {
    if (!this.session) return;
    const modal = new AppearanceModal(this.deps.app, this.appearance);
    const next = await modal.openAndWait();
    if (!next) return;
    this.appearance = next;
    await this.session.applyAppearance(next);
    this.applyTheme(next.theme);
    this.toolbar?.update(this.toolbarState());
  }

  private applyTheme(theme: ReaderTheme): void {
    const root = this.host?.closest(".ez-reader__reader") ?? this.containerEl;
    root.removeClass("ez-reader__theme-system", "ez-reader__theme-light", "ez-reader__theme-dark", "ez-reader__theme-sepia");
    root.addClass(`ez-reader__theme-${theme}`);
  }

  private renderOpenError(error: unknown): void {
    if (!this.host) return;
    this.host.empty();
    this.host.removeClass("ez-reader__pdf-stage");
    this.host.addClass("ez-reader__reader__error");
    const message = error instanceof Error ? error.message : String(error);
    this.host.createEl("h3", { text: "无法打开这本书" }).addClass("ez-reader__reader__error-title");
    this.host.createEl("p", { text: message }).addClass("ez-reader__reader__error-message");
    const stack = error instanceof Error ? error.stack : undefined;
    if (stack) {
      const details = this.host.createEl("details");
      details.createEl("summary", { text: "技术细节" });
      details.createEl("pre", { text: stack }).addClass("ez-reader__reader__error-stack");
    }
  }

  private async openSession(): Promise<void> {
    if (!this.entry || !this.host) return;
    const book = this.entry.book;
    const engine = this.bookReaderFor(book);
    try {
      this.session = await engine.open(book, this.host, this.appearance, this.deps.bookBytesLoader);
    } catch (error) {
      console.error("[ez-reader] failed to open book", book.locator.path, error);
      this.renderOpenError(error);
      // 即便失败也 markReady, 让外部知道不会继续等待
      this.markReady();
      return;
    }
    this.deps.onBookOpened?.(this.entry);
    this.applyTheme(this.appearance.theme);
    this.toolbar?.update(this.toolbarState());

    // 进度记忆: 跳转到上次位置 (受 settings 开关控制)
    const progressEnabled = await this.isProgressMemoryEnabled();
    const stored = this.entry.reading.position;
    if (stored && progressEnabled) {
      try {
        await this.resumeFromPosition(stored);
      } catch (error) {
        console.warn("[ez-reader] failed to resume from stored position", error);
      }
    }

    const fraction = await this.session.currentFraction();
    this.fraction = fraction;
    this.toolbar?.update(this.toolbarState());

    const offRelocate = this.session.on("relocate", (event) => {
      const detail = (event as CustomEvent<{ fraction?: number; locator?: string; chapter?: string }>).detail;
      if (typeof detail?.fraction === "number") {
        this.fraction = detail.fraction;
        if (detail.chapter) {
          this.chapter = detail.chapter;
          // 同步更新 TocPanel 的 active 项 — 通过 label 匹配
          if (this.tocItems.length > 0) {
            const match = this.tocItems.find((it) => it.label === detail.chapter);
            if (match) this.tocPanel?.setActive(match.id);
          }
        }
        this.toolbar?.update(this.toolbarState());
        void this.persistProgress(detail.fraction, detail.locator);
      }
    });

    // 防抖: selectionchange 在用户拖拽过程中多次触发, 我们延迟 180ms
    // 等待用户真正完成选词再弹菜单
    let selectionDebounce: ReturnType<typeof setTimeout> | undefined;
    const offSelect = this.session.on("selection-change", (event) => {
      const detail = (event as CustomEvent<{ text: string; locator?: string; rect?: DOMRect }>).detail;
      if (!detail?.text) {
        if (selectionDebounce !== undefined) globalThis.clearTimeout(selectionDebounce);
        selectionDebounce = undefined;
        this.selectionMenu?.hide();
        return;
      }
      // 中文段落里, 浏览器按"字符"分词. 如果只选了一两个字符 (没有空格), 自动扩到最近的句号/逗号,
      // 这样想法/摘录更有意义. CJK 段落 (没有空格 / 拉丁词比例低) 才触发.
      const expanded = maybeExpandChineseSelection(detail.text);
      const text = expanded.text;
      this.pendingSelection = { text, rect: detail.rect, locator: detail.locator, chapter: this.chapter };
      if (selectionDebounce !== undefined) globalThis.clearTimeout(selectionDebounce);
      selectionDebounce = globalThis.setTimeout(() => {
        selectionDebounce = undefined;
        const sel = globalThis.document.getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0) : undefined;
        const rect = range?.getBoundingClientRect() ?? detail.rect;
        if (rect && rect.width > 0) {
          this.selectionMenu?.show(rect);
        } else {
          const fallbackRect = new DOMRect(
            globalThis.innerWidth / 2 - 100,
            globalThis.innerHeight - 120,
            200,
            40
          );
          this.selectionMenu?.show(fallbackRect);
        }
      }, 180);
    });

    // 加载 TOC
    if (this.session.tableOfContents) {
      try {
        this.tocItems = await this.session.tableOfContents();
        this.tocPanel?.setToc(this.tocItems);
      } catch (error) {
        console.warn("[ez-reader] failed to load TOC", error);
      }
    }

    const disposeOn = () => {
      offRelocate();
      offSelect();
    };
    this.register(disposeOn);

    // 恢复已存的高亮
    await this.restoreHighlights();

    // 通知外部(openExcerptById / 协议 handler)session 已就绪
    this.markReady();
  }

  private async resumeFromPosition(position: ReadingPosition): Promise<void> {
    if (!this.session) return;
    switch (position.kind) {
      case "reflow":
        if (position.cfi) {
          await this.session.goTo({ kind: "identifier", value: position.cfi });
        } else {
          await this.session.goTo({ kind: "fraction", fraction: position.fraction });
        }
        return;
      case "pdf":
        if (this.session.setScale && position.scale !== undefined) {
          await this.session.setScale(position.scale);
        } else if (this.session.setFitWidth) {
          await this.session.setFitWidth();
        }
        // 优先用 subpath 跳转到精确的 selection 位置(如有)
        if (position.selection) {
          await this.session.goTo({ kind: "identifier", value: position.selection });
        } else {
          await this.session.goTo({ kind: "identifier", value: `page=${position.page}` });
        }
        return;
      case "text":
        await this.session.goTo({ kind: "fraction", fraction: position.fraction });
        return;
    }
  }

  private async restoreHighlights(): Promise<void> {
    if (!this.entry || !this.session?.highlight) return;
    const excerpts = await this.deps.reading.listExcerpts(this.entry.book.id);
    for (const ex of excerpts) {
      let locator: string | undefined;
      if (ex.locator.position.kind === "reflow") {
        locator = ex.locator.position.cfi;
      } else if (ex.locator.position.kind === "pdf") {
        // 优先 subpath(精确 4-tuple), 否则只到页
        locator = ex.locator.position.selection ?? `page=${ex.locator.position.page}`;
      }
      if (!locator) continue;
      try {
        await this.session.highlight({
          id: ex.id,
          text: ex.text,
          locator,
          color: "yellow",
          createdAt: ex.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] failed to restore highlight", ex.id, error);
      }
    }
  }

  private toolbarState(): Parameters<NonNullable<typeof this.toolbar>["update"]>[0] {
    return {
      fraction: this.fraction,
      chapter: this.chapter,
      status: this.entry?.reading.status ?? "unread",
      showingBookmarks: this.bookmarksPanel?.isVisible?.() ?? false,
      showingExcerpts: this.excerptsPanel?.isVisible?.() ?? false,
      showingNotes: this.notesPanel?.isVisible?.() ?? false,
      showingToc: this.tocPanel?.isVisible?.() ?? false,
      showingImmersive: this.isImmersive,
      zoom: this.session?.currentScale?.(),
      showZoomControls: this.session?.setScale !== undefined,
      showFontSettings: true
    };
  }

  private bookReaderFor(book: Book): BookReader {
    return book.locator.format === "pdf" ? this.deps.pdfjs : this.deps.foliate;
  }

  // ---- 翻页 / 跳转 ----
  private async goToNext(direction: -1 | 1): Promise<void> {
    if (!this.session) return;
    if (direction === 1 && this.session.next) {
      await this.session.next();
    } else if (direction === -1 && this.session.previous) {
      await this.session.previous();
    } else {
      await this.session.goTo(direction === 1 ? { kind: "next" } : { kind: "previous" });
    }
  }

  private async seekFraction(fraction: number): Promise<void> {
    if (!this.session) return;
    await this.session.goTo({ kind: "fraction", fraction });
  }

  private async jumpToTocItem(item: TocItem): Promise<void> {
    if (!this.session?.goToToc) return;
    await this.session.goToToc(item.id);
    this.tocPanel?.setActive(item.id);
  }

  private async persistProgress(fraction: number, locator?: string): Promise<void> {
    if (!this.entry) return;
    const exported = await this.session?.exportLocator();
    const finalLocator = locator ?? exported;
    let position: ReadingPosition;
    if (this.isPdf && this.session?.currentPage) {
      const pdfSelection = typeof finalLocator === "string" && finalLocator.startsWith("#page=") ? finalLocator : undefined;
      position = {
        kind: "pdf",
        page: this.session.currentPage() ?? 1,
        scale: this.session.currentScale?.(),
        fitWidth: this.session.isFitWidth?.(),
        ...(pdfSelection ? { selection: pdfSelection } : {})
      };
    } else if (finalLocator) {
      position = { kind: "reflow", fraction, cfi: finalLocator };
    } else {
      position = { kind: "reflow", fraction };
    }
    await this.deps.reading.updatePosition(this.entry.book.id, position);
  }

  // ---- 书签 ----
  private async addBookmarkAtCurrentPosition(): Promise<void> {
    if (!this.entry) return;
    const { BookmarkModal } = await import("./BookmarkModal");
    const modal = new BookmarkModal(this.deps.app);
    const label = await modal.openAndWait();
    if (label === null) return;
    const locator = await this.session?.exportLocator();
    if (!locator) return;
    await this.deps.reading.addBookmark({
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bookId: this.entry.book.id,
      label,
      locator: { position: { kind: "reflow", fraction: this.fraction, cfi: locator }, chapter: this.chapter },
      createdAt: Date.now()
    });
    await this.refreshPanels();
  }

  private async toggleBookmarks(): Promise<void> {
    if (!this.bookmarksPanel) return;
    this.bookmarksPanel.show();
    this.excerptsPanel?.hide();
    await this.refreshPanels();
    this.toolbar?.update(this.toolbarState());
  }

  private async toggleExcerpts(): Promise<void> {
    if (!this.excerptsPanel) return;
    this.excerptsPanel.show();
    this.bookmarksPanel?.hide();
    await this.refreshPanels();
    this.toolbar?.update(this.toolbarState());
  }

  private toggleToc(): void {
    if (!this.tocPanel) return;
    this.tocPanel.toggle();
    this.toolbar?.update(this.toolbarState());
  }

  private toggleNotes(): void {
    if (!this.notesPanel) return;
    this.notesPanel.toggle();
    this.toolbar?.update(this.toolbarState());
  }

  private toggleImmersive(): void {
    this.isImmersive = !this.isImmersive;
    const root = this.containerEl.children[1] as HTMLElement;
    root.toggleClass("ez-reader__immersive", this.isImmersive);
    this.toolbar?.update(this.toolbarState());
  }

  private async refreshPanels(): Promise<void> {
    if (!this.entry) return;
    const [bookmarks, excerpts] = await Promise.all([
      this.deps.reading.listBookmarks(this.entry.book.id),
      this.deps.reading.listExcerpts(this.entry.book.id)
    ]);
    this.bookmarksPanel?.setBookmarks(bookmarks);
    this.excerptsPanel?.setExcerpts(excerpts);
    this.notesPanel?.setEntries(excerpts);
  }

  private async jumpToBookmark(bookmark: Bookmark): Promise<void> {
    if (!this.session) return;
    if (bookmark.locator.position.kind === "reflow" && bookmark.locator.position.cfi) {
      await this.session.goTo({ kind: "identifier", value: bookmark.locator.position.cfi });
    } else {
      await this.session.goTo({ kind: "fraction", fraction: bookmark.locator.position.kind === "reflow" ? bookmark.locator.position.fraction : 0 });
    }
  }

  private async removeBookmark(bookmark: Bookmark): Promise<void> {
    if (!this.entry) return;
    await this.deps.reading.removeBookmark(this.entry.book.id, bookmark.id);
    await this.refreshPanels();
  }

  private async jumpToExcerpt(excerpt: Excerpt): Promise<void> {
    if (!this.session) return;
    const pos = excerpt.locator.position;
    if (pos.kind === "reflow" && pos.cfi) {
      await this.session.goTo({ kind: "identifier", value: pos.cfi });
    } else if (pos.kind === "pdf") {
      // 优先用 subpath(精确到 selection),否则只跳页
      const target = pos.selection ?? `page=${pos.page}`;
      await this.session.goTo({ kind: "identifier", value: target });
    } else if (pos.kind === "reflow" || pos.kind === "text") {
      await this.session.goTo({ kind: "fraction", fraction: pos.fraction });
    }
  }

  private async removeExcerpt(excerpt: Excerpt): Promise<void> {
    if (!this.entry) return;
    await this.deps.reading.removeExcerpt(this.entry.book.id, excerpt.id);
    if (this.session?.removeHighlight) {
      try {
        await this.session.removeHighlight(excerpt.id);
      } catch {
        // ignore
      }
    }
    await this.refreshPanels();
  }

  private async editExcerpt(excerpt: Excerpt): Promise<void> {
    const modal = new ThoughtModal(this.deps.app, {
      text: excerpt.text,
      chapter: excerpt.locator.chapter
    });
    const submit = await modal.openAndWait();
    if (!submit || !this.entry) return;
    const updated: Excerpt = {
      ...excerpt,
      note: submit.note,
      tags: submit.tags
    };
    await this.deps.reading.removeExcerpt(this.entry.book.id, excerpt.id);
    await this.deps.reading.addExcerpt(updated);
    // 同步到 markdown 笔记
    if (this.deps.noteWriter && this.entry) {
      try {
        const ref = await this.deps.noteWriter.ensureBookNote({
          bookId: this.entry.book.id,
          bookTitle: this.entry.book.metadata?.title ?? this.entry.book.locator.path,
          bookPath: this.entry.book.locator.path
        });
        await this.deps.noteWriter.appendExcerpt(ref, {
          excerptId: updated.id,
          text: updated.text,
          note: updated.note,
          tags: updated.tags,
          locator: {
            cfi: updated.locator.position.kind === "reflow" ? updated.locator.position.cfi : undefined,
            fraction: updated.locator.position.kind === "reflow" ? updated.locator.position.fraction : 0,
            page: updated.locator.position.kind === "pdf" ? updated.locator.position.page : undefined
          },
          chapterTitle: updated.locator.chapter,
          format: this.entry.book.locator.format === "pdf" ? "pdf" : "epub",
          createdAt: updated.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
      }
    }
    await this.refreshPanels();
  }

  private async saveExcerptFromSelection(): Promise<void> {
    if (!this.entry || !this.pendingSelection) return;
    const { ExcerptModal } = await import("./ExcerptModal");
    const modal = new ExcerptModal(this.deps.app, { text: this.pendingSelection.text });
    const submit = await modal.openAndWait();
    if (!submit) return;
    const excerptId = `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const locator = this.pendingSelection.locator ?? (await this.session?.exportLocator()) ?? undefined;
    if (!locator) return;
    // PDF 上保存完整 4-tuple subpath 用于精确还原高亮
    const pos: ReadingPosition = this.isPdf && this.session?.currentPage
      ? {
          kind: "pdf",
          page: this.session.currentPage() ?? 1,
          ...(typeof locator === "string" && locator.startsWith("#page=") ? { selection: locator } : {})
        }
      : { kind: "reflow", fraction: this.fraction, cfi: locator };

    const excerpt: Excerpt = {
      id: excerptId,
      bookId: this.entry.book.id,
      text: this.pendingSelection.text,
      locator: { position: pos, chapter: this.chapter },
      note: submit.note,
      tags: submit.tags,
      createdAt: Date.now()
    };
    await this.deps.reading.addExcerpt(excerpt);
    if (this.session?.highlight) {
      try {
        await this.session.highlight({
          id: excerptId,
          text: this.pendingSelection.text,
          locator,
          color: "yellow",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] session.highlight failed", error);
      }
    }
    // 同步到 vault md
    if (this.deps.noteWriter) {
      try {
        const ref = await this.deps.noteWriter.ensureBookNote({
          bookId: this.entry.book.id,
          bookTitle: this.entry.book.metadata?.title ?? this.entry.book.locator.path,
          bookPath: this.entry.book.locator.path
        });
        await this.deps.noteWriter.appendExcerpt(ref, {
          excerptId,
          text: excerpt.text,
          note: excerpt.note,
          tags: excerpt.tags,
          locator: {
            cfi: pos.kind === "reflow" ? pos.cfi : undefined,
            fraction: pos.kind === "reflow" ? pos.fraction : 0,
            page: pos.kind === "pdf" ? pos.page : undefined
          },
          chapterTitle: excerpt.locator.chapter,
          format: this.entry.book.locator.format === "pdf" ? "pdf" : "epub",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
      }
    }
    await this.refreshPanels();
    this.notesPanel?.flashLast(excerptId);
  }

  private async saveThoughtFromSelection(): Promise<void> {
    if (!this.entry || !this.pendingSelection) return;
    await this.saveThoughtCore(this.pendingSelection.text, this.pendingSelection.locator);
  }

  private async openFreeThoughtModal(): Promise<void> {
    if (!this.entry) return;
    const locator = await this.session?.exportLocator();
    await this.saveThoughtCore(undefined, locator ?? undefined);
  }

  private async saveThoughtCore(text: string | undefined, locator: string | undefined): Promise<void> {
    if (!this.entry) return;
    const modal = new ThoughtModal(this.deps.app, {
      text: text ?? "",
      chapter: this.chapter
    });
    const submit = await modal.openAndWait();
    if (!submit) return;
    const excerptId = `th-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pos: ReadingPosition = this.isPdf && this.session?.currentPage
      ? {
          kind: "pdf",
          page: this.session.currentPage() ?? 1,
          ...(typeof locator === "string" && locator.startsWith("#page=") ? { selection: locator } : {})
        }
      : { kind: "reflow", fraction: this.fraction, cfi: locator };

    const excerpt: Excerpt = {
      id: excerptId,
      bookId: this.entry.book.id,
      text: text ?? "",
      locator: { position: pos, chapter: this.chapter },
      note: submit.note,
      tags: submit.tags,
      createdAt: Date.now()
    };
    await this.deps.reading.addExcerpt(excerpt);
    // 同步到 vault md
    if (this.deps.noteWriter) {
      try {
        const ref = await this.deps.noteWriter.ensureBookNote({
          bookId: this.entry.book.id,
          bookTitle: this.entry.book.metadata?.title ?? this.entry.book.locator.path,
          bookPath: this.entry.book.locator.path
        });
        await this.deps.noteWriter.appendExcerpt(ref, {
          excerptId,
          text: excerpt.text,
          note: excerpt.note,
          tags: excerpt.tags,
          locator: {
            cfi: pos.kind === "reflow" ? pos.cfi : undefined,
            fraction: pos.kind === "reflow" ? pos.fraction : 0,
            page: pos.kind === "pdf" ? pos.page : undefined
          },
          chapterTitle: excerpt.locator.chapter,
          format: this.entry.book.locator.format === "pdf" ? "pdf" : "epub",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
      }
    }
    await this.refreshPanels();
    this.notesPanel?.flashLast(excerptId);
  }

  private copySelectionToClipboard(): void {
    const selection = this.pendingSelection?.text;
    if (!selection) return;
    void navigator.clipboard.writeText(selection);
  }

  private async requestTranslation(): Promise<void> {
    if (!this.pendingSelection || !this.translationDrawer) return;
    await this.translationDrawer.translate(this.pendingSelection.text);
  }

  private async saveTranslationAsNote(source: string, translated: string): Promise<void> {
    if (!this.entry) return;
    const text = `> ${source.replace(/\n/g, "\n> ")}\n\n**翻译**:\n\n${translated}`;
    await this.saveThoughtCore(text, this.pendingSelection?.locator);
  }
}
