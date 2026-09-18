import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { Bookmark } from "../../core/entities/Bookmark";
import type { Book, BookFormat } from "../../core/entities/Book";
import type { Excerpt } from "../../core/entities/Excerpt";
import type { ReadingPosition, ReadingState } from "../../core/entities/ReadingState";
import { expandWithCap } from "./chineseSelectionExpansion";
import type { BookReader, ReaderSession, TocItem } from "../../core/ports/BookReader";
import type { LibraryEntry, LibraryService } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import type { NoteWriter } from "../../core/ports/NoteWriter";
import { AppearanceModal } from "./AppearanceModal";
import { BookmarksPanel } from "./BookmarksPanel";
import { ExcerptsPanel } from "./ExcerptsPanel";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { ReaderToolbar } from "./ReaderToolbar";
import { SearchBar } from "./SearchBar";
import { SidebarNotesPanel } from "./SidebarNotesPanel";
import { TocPanel } from "./TocPanel";
import { ThoughtModal } from "./ThoughtModal";
import { TranslationDrawer } from "./TranslationDrawer";
import { routeShortcut, type ShortcutAction } from "./readerShortcuts";
import { ShortcutHelpModal } from "./ShortcutHelpModal";
import { FoliateContentDelegate } from "./foliateContentDelegate";
import { TextContentDelegate } from "./textContentDelegate";
import type { ContentDelegate } from "./ContentDelegate";
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
  /**
   * EPUB 渲染后端 (foliate-js)。ReaderView 通过 `ContentDelegate` 间接
   * 使用, P1 之后不再直接看到 foliate / pdfjs 的存在。
   */
  readonly foliate: BookReader;
  /**
   * TXT / MOBI / AZW3 渲染后端。统一通过 `PagedTextSession` 渲染,
   * 跟 EPUB 共享划词 / 翻页 / 高亮 UX。ReaderView 仍然只看到
   * `ContentDelegate` 这一层抽象, 不知道下面是 foliate 还是 PagedTextSession.
   */
  readonly textReader: BookReader;
  readonly translation: TranslationService;
  readonly noteWriter?: NoteWriter;
  readonly bookBytesLoader: BookBytesLoader;
  readonly settingsProvider?: () => Promise<LoadedSettings>;
  readonly onBookOpened?: (entry: LibraryEntry) => void;
  /**
   * P0-2: Library service 透传进来, 让 openSession 成功后调 refreshMetadata
   * 升级 title / author. 用 optional 保证旧调用方 (测试) 不会因为新
   * 字段而编译失败.
   */
  readonly library?: LibraryService;
}

/**
 * 根据 book format 选对应的 ContentDelegate。
 * - PDF 不走这里 (Plugin.openReader 直接交给 Obsidian 内置 viewer)
 * - EPUB → foliate-js (FoliateContentDelegate)
 * - TXT / MOBI / AZW3 → PagedTextSession (TextContentDelegate)
 */
const createContentDelegate = (format: BookFormat, deps: { foliate: BookReader; textReader: BookReader }): ContentDelegate => {
  switch (format) {
    case "txt":
    case "mobi":
    case "azw3":
      return new TextContentDelegate(deps.textReader);
    case "epub":
    case "pdf":
    case "azw":
      return new FoliateContentDelegate(deps.foliate);
  }
};

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
  /**
   * Fraction at the moment of selection, frozen so it doesn't drift if
   * the reader scrolls / pages between selection and "save excerpt".
   * Previously we used the live `this.fraction`, which advanced silently
   * while the user opened the excerpt modal — by the time the excerpt
   * was saved, the cfi/page was for the old page but the fraction was
   * for the new one.
   */
  fraction: number;
}

/**
 * Cryptographically random ID for bookmarks / excerpts / thoughts.
 * 早期版本用 `Date.now() + Math.random()` — 同毫秒内多次创建可能撞 ID,
 * 导致后续 `appendExcerpt` 的 block-id 去重误判为已存在 (跨条目静默丢弃).
 *
 * P2-6: 优先 crypto.randomUUID, 没就 fallback 到 Math.random + 时间戳.
 * Android WebView < 81 没有 crypto.randomUUID (但 crypto.subtle 一般有,
 * polyfills.ts 已经 polyfill 了). 这种环境下 fallback 不会重复 —
 * 冲突概率 (62^16 ≈ 4.7e28) 比桌面差但远低于 daily excerpt count.
 */
const generateExcerptId = (prefix: "bm" | "ex" | "th"): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) {
    return `${prefix}-${uuid}`;
  }
  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${fallback}`;
};

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest("input, textarea, select, button, [contenteditable='true'], a"));

/**
 * Map a `ReadingPosition` to the locator shape `NoteWriter.appendExcerpt`
 * expects (cfi / fraction / page). The new "text" kind (TXT / MOBI /
 * AZW3 paginated books) sends fraction + start/end so the markdown note
 * records both the page position and the progress fraction.
 */
const locatorForNoteWriter = (pos: ReadingPosition): {
  readonly cfi?: string;
  readonly fraction: number;
  readonly page?: number;
} => {
  switch (pos.kind) {
    case "reflow":
      return {
        cfi: pos.cfi,
        fraction: pos.fraction
      };
    case "pdf":
      return {
        fraction: 0,
        page: pos.page
      };
    case "text":
      return {
        fraction: pos.fraction
      };
  }
};

/**
 * Wrapper that returns the expanded selection (or `raw` unchanged) for
 * the current document selection. Caches the surrounding context text
 * (from the selection's commonAncestor text node) so the pure helper
 * `expandWithCap` from `./chineseSelectionExpansion` can be unit-tested
 * separately.
 *
 * Cap is 100 chars — long enough for a sentence, short enough that we
 * don't accidentally swallow an entire paragraph.
 */
const maybeExpandChineseSelection = (raw: string): { text: string } => {
  const sel = globalThis.document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : undefined;
  if (!range) return { text: raw };
  const container = range.commonAncestorContainer;
  const containerText = container.nodeType === 3 ? container.textContent ?? "" : container.textContent ?? "";
  if (!containerText) return { text: raw };
  const text = expandWithCap(raw, containerText, 100);
  return { text };
};

/**
 * 自动生成 quick bookmark 的 label — 按 B 加书签没有 modal, 这里用
 * chapter + 百分比拼一个足够辨识的 label. 比如:
 *   "Chapter 6 · 42%" / "未命名章节 · 15%" / "15%" (没 chapter 时)
 *
 * 后续可以让用户在 BookmarksPanel 重命名 (TODO: 面板 inline rename).
 *
 * 纯函数, 容易测.
 */
export const composeQuickBookmarkLabel = (
  chapter: string | null | undefined,
  fraction: number
): string => {
  // clamp 到 [0, 1] — `fraction` 在 relocate 异常时可能漂出范围, 直接输出
  // "-10%" 或 "150%" 让用户困惑. 跟 ReaderToolbar.clampFraction 同样的语义.
  const safeFraction = Number.isFinite(fraction)
    ? Math.max(0, Math.min(1, fraction))
    : 0;
  const pct = `${Math.round(safeFraction * 100)}%`;
  const trimmedChapter = chapter?.trim();
  if (trimmedChapter) {
    // 截到 60 字符防止 chapter title 太长
    const cap = trimmedChapter.length > 60 ? `${trimmedChapter.slice(0, 60)}…` : trimmedChapter;
    return `${cap} · ${pct}`;
  }
  return pct;
};

/**
 * 摘录文本截断: quick highlight 没有 modal, 用 selection 截前 30 字符作
 * 默认 fallback label 视觉提示 (虽然 Excerpt entity 存的是完整 text,
 * 但 side panel 用 text 的前 N 字符预览, 太长会撑破卡片). 中文按
 * Unicode 码点切, 不切坏 surrogate pair.
 */
export const truncateExcerptText = (text: string, maxChars = 30): string => {
  const trimmed = text.trim();
  if ([...trimmed].length <= maxChars) return trimmed;
  return `${[...trimmed].slice(0, maxChars).join("")}…`;
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
  private searchBar: SearchBar | undefined;
  private shortcutHelpModal: ShortcutHelpModal | undefined;
  private host: HTMLElement | undefined;
  private fraction = 0;
  private chapter = "";
  private bookmarkCount = 0;
  private excerptCount = 0;
  private pendingSelection: ActiveSelection | undefined;
  private tocItems: ReadonlyArray<TocItem> = [];
  /** P2: toc item id → 该章节的 fraction. 滚动过程中被动记录 —
   *  chapter label 改变时, 用 label 在 tocItems 里找 id, 把 (id, 当前 fraction)
   *  写进 map. 用于 toolbar 进度条下方的章节标记条. */
  private tocFractions = new Map<string, number>();
  private isDesktopWide = false;
  private isImmersive = false;
  /**
   * P1: 阅读时长统计 — 每次 reader 成为 active leaf 时开始计时,
   * 离开时把 ms 累加并 30s 防抖写回 store. 字段 `totalReadingMs`
   * 已经在 ReadingState 里.
   */
  private activeSinceMs: number | null = null;
  private lastReadingFlushAt = 0;
  /**
   * Find-in-book 状态 — toolbar 拿这两个字段做 badge + active 视觉。
   * searchBarVisible 也控制 input 是否聚焦。
   */
  private searchBarVisible = false;
  private searchMatchCount: number | null = null;
  /**
   * Debounce timestamp for `persistProgress` failures — relocate 触发频繁
   * (每翻页一次),连续失败时不能让 Notice 刷屏. 5s 内只展示一次.
   */
  private lastProgressFailureNoticeAt = 0;
  /**
   * C1 修复: relocate 风暴 debounce. foliate 滚动模式下 relocate 触发频繁
   * (60Hz 滚动里 5-10 次/秒), 每次都 await exportLocator + await
   * updatePosition → data.json IO 风暴. PdfOverlay 同位置已经做了 250ms
   * debounce (pdfOverlay.ts:312-323), ReaderView 漏掉. 现在 debounce 300ms,
   * 配合 1% 距离阈值避免跨页定位 race (用户翻到第 N 页,debounce 期间又翻
   * 到 N+1,旧 timer 会写 N 的 fraction 覆盖 — 距离阈值让最后一次保留).
   */
  private persistProgressTimer: ReturnType<typeof setTimeout> | undefined;
  private persistProgressPending: { fraction: number; locator: string | undefined } | undefined;

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
        onShowFontSettings: () => void this.showFontSettings(),
        onToggleToc: () => void this.toggleToc(),
        onToggleNotes: () => void this.toggleNotes(),
        onCycleStatus: () => void this.cycleStatus(),
        onToggleFavorite: () => void this.toggleFavorite(),
        onToggleImmersive: () => void this.toggleImmersive(),
        onOpenSearch: () => void this.openSearchBar(),
        onCloseSearch: () => void this.closeSearchBar(),
        // P2: 进度条下方的章节标记点 — 跳到该章节
        onJumpToc: (id) => void this.jumpToTocById(id)
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
        showFontSettings: true,
        currentPage: null,
        totalPages: null,
        searchOpen: false,
        searchMatchCount: null
      }
    );
    container.append(this.toolbar.root);

    this.bookmarksPanel = new BookmarksPanel(
      {
        onJump: (bookmark) => void this.jumpToBookmark(bookmark),
        onRemove: (bookmark) => void this.removeBookmark(bookmark),
        onClose: () => this.hideAllPanels()
      },
      container
    );
    this.excerptsPanel = new ExcerptsPanel(
      {
        app: this.deps.app,
        onJump: (excerpt) => void this.jumpToExcerpt(excerpt),
        onRemove: (excerpt) => void this.removeExcerpt(excerpt),
        onClose: () => this.hideAllPanels()
      },
      container
    );

    // 双栏布局: desktop 上 notes 面板在左侧常驻
    const body = container.createDiv({ cls: "ez-reader__reader__body" });

    // 沉浸模式下的小 × 按钮 — 永远可见, 用户不需要先 swipe / tap 触发 toolbar.
    // P0 修复: 之前沉浸模式 toolbar 完全隐藏, 用户没有任何方式退出 (除了关闭整个
    // Obsidian), 只能 swipe down / tap 才能临时显示 toolbar — 移动端极易误触翻页.
    // 又: 之前按钮只在 onload 一次性创建, 用户用 Shift+F 进入沉浸 (onload 后)
    // 时按钮根本不在 DOM, 用户完全卡住. 现在 toggleImmersive 也会动态创建/移除.
    if (this.isImmersive) {
      this.ensureImmersiveExitButton(container);
    }

    this.notesPanel = new SidebarNotesPanel(
      {
        app: this.deps.app,
        onJump: (excerpt) => void this.jumpToExcerpt(excerpt),
        onRemove: (excerpt) => void this.removeExcerpt(excerpt),
        onEdit: (excerpt) => void this.editExcerpt(excerpt),
        // P2: inline note patch — 用户在 panel 里点 note 直接编辑, blur 保存.
        // 只 patch note 字段, 不动 locator / text / tags. 比 editExcerpt
        // (remove + add) 高效得多, 用户频繁触发.
        onUpdateNote: (excerpt, note) => this.updateExcerptNoteInline(excerpt, note),
        onAddThought: () => void this.openFreeThoughtModal(),
        // P1: notes panel header × 按钮 (mobile / narrow layout only;
        // desktop-wide 永远显示, 不需要 ×).
        onClose: this.isDesktopWide ? undefined : () => this.hideAllPanels()
      },
      body
    );
    if (this.isDesktopWide) {
      this.notesPanel.show();
    } else {
      this.notesPanel.hide();
    }

    this.host = body.createDiv({ cls: "ez-reader__reader__stage" });

    // TocPanel 现在是左侧边栏 (320px), 跟 notesPanel 同侧互斥显示 —
    // v4 UX: 树状结构 + ▶/▼ 折叠, 不再是顶部下拉.
    this.tocPanel = new TocPanel(
      {
        onJump: (item) => void this.jumpToTocItem(item),
        onClose: () => this.hideAllPanels()
      },
      body
    );

    this.translationDrawer = new TranslationDrawer(
      {
        onSaveAsNote: (src, translated) => void this.saveTranslationAsNote(src, translated),
        // P2: 翻译面板"复制"按钮 — 复用 navigator.clipboard.writeText 路径,
        // 跟 selection menu 复制一致. TranslationDrawer 自己 catch 失败显示 ✓.
        onCopy: (translated) => this.copyTextToClipboard(translated)
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
    }, {
      // P2: 选区菜单快捷键提示 — 用户不用问 ? 也能发现 Shift+T / C / Shift+H
      thought: "Shift+T",
      excerpt: "Shift+H",
      translate: undefined, // 翻译直接走 Shift+T 重叠, 不显示
      copy: "C"
    });

    // P1: 搜索栏 — 浮在 body 之上 (跟 selection menu 同级), 用户输
    // 入 query → 调 session.findInBook → toolbar 显示命中数 / active 态。
    this.searchBar = new SearchBar({
      onSearch: (query) => void this.runFindInBook(query, false),
      onSearchFromStart: (query) => void this.runFindInBook(query, true),
      onClose: () => this.closeSearchBar()
    });

    this.bindSwipeGestures();
    this.bindKeyboardNavigation();
    this.bindImmersiveToolbarToggle();
    this.bindReadingTimeTracker();
    if (this.entry) await this.openSession();
  }

  async onClose(): Promise<void> {
    // P0-7 修复: 等切书发起的 close 也跑完 (setEntry 是 sync, 调用方不
    // await 我们, 但我们仍需保证 onClose 时旧 session 已释放, 否则
    // Obsidian 的 leaf detach 会带着未 close 的 foliate iframe).
    if (this.pendingClosePromise) {
      await this.pendingClosePromise;
      this.pendingClosePromise = undefined;
    }
    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }
    // C1 修复: persistProgress debounce timer 必须 clear. 关闭 view 时
    // 如果还有未 flush 的进度, 立即同步 flush (用户期望 "我翻到的位置"
    // 在关闭时被记住). flush 完清 pending, 让 onClose 之后即便 timer
    // 误 fire 也不写盘.
    if (this.persistProgressTimer !== undefined) {
      globalThis.clearTimeout(this.persistProgressTimer);
      this.persistProgressTimer = undefined;
      const pending = this.persistProgressPending;
      this.persistProgressPending = undefined;
      if (pending) await this.persistProgress(pending.fraction, pending.locator);
    }
    this.selectionMenu?.destroy();
    this.selectionMenu = undefined;
    this.searchBar?.destroy();
    this.searchBar = undefined;
    this.notesPanel?.dispose();
    this.host = undefined;
    // P0-1 修复: 兜底 timer 必须 clear, 否则 view 关闭后 timer 还持有
    // view 引用直到 fire. 现在 markReady() 内部已经会 clear.
    this.markReady();
    this.pendingSelection = undefined;
  }

  setEntry(entry: LibraryEntry): void {
    this.entry = entry;
    // C7 修复: bump session token — 让正在 await 旧 session 的 caller
    // (主要是 obsidian:// 协议 handler 调的 openExcerptById) 知道等错
    // 了 session, 重新对当前 token await. bump 必须在任何 await 之前
    // (包括 pendingClosePromise 的发起) — 否则旧 caller 拿到 token 后
    // session 已经被关, 旧 caller 还在新 session 上跳旧 excerpt.
    this.currentSessionToken += 1;
    // 切换书时: 关闭上一个 session 释放 worker / iframe, 重置 ready promise.
    // P0-7 修复: 之前 fire-and-forget, 旧 foliate iframe / PDF.js worker
    // 还没释放就立刻在 host 上挂新 session, 极端情况下两份 reader 同时
    // 跑 (内存翻倍, 旧 worker 卸载延后). 现在用 stored promise 串行:
    // setEntry 是 sync 接口, 调用方不 await 我们 — 但 pendingClosePromise
    // 让下次 setEntry / openSession / onClose 等旧 session 真正关掉.
    if (this.session) {
      this.pendingClosePromise = this.session.close().catch((error) => {
        console.warn("[ez-reader] failed to close previous session", error);
      });
      this.session = undefined;
    }
    // 切书时清掉 pendingSelection — 否则上一本书选过的词, pending 文本还指向
    // 旧书. 用户点 "翻译 / 摘录 / 想法" 按钮会作用在错的书上 (locator 也无效).
    this.pendingSelection = undefined;
    this.selectionMenu?.hide();
    // 解析旧 readyPromise — 旧 awaiter (例如协议 handler 调
    // openExcerptById) 之前阻塞在 await whenReady(),现在让它退出.
    this.markReady();
    if (this.host) {
      void this.openSession();
    } else {
      // host 还没就绪(onOpen 仍在跑,例如 leaf.setViewState 在 onOpen 完成前 resolve)
      // 等下一帧再试。openSession 内部有 if (!this.host) return 保护。
      const tryOpen = () => {
        if (this.host && this.entry && !this.session) {
          void this.openSession();
        }
      };
      globalThis.requestAnimationFrame(tryOpen);
      // 兜底: 100ms 后再试一次
      globalThis.setTimeout(tryOpen, 100);
    }
  }

  /** Public entry point used by the obsidian:// protocol handler. */
  async openExcerptById(excerptId: string): Promise<void> {
    if (!this.entry) return;
    // C7 修复: 抓 token 在 await 之前. await 之后如果 token 变了, 说明
    // 在 await 期间 setEntry 切书了, 旧 promise resolve 后我们要重新等新
    // session, 而不是在新 session 上跳旧 excerpt locator.
    const tokenAtEntry = this.currentSessionToken;
    await this.whenReady();
    if (tokenAtEntry !== this.currentSessionToken) {
      // session 在我们等的时候换了 — 重新对当前 session 来一次.
      return this.openExcerptById(excerptId);
    }
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
  // P0-1 修复: 30s 兜底 timer 必须保存 handle, 在 markReady / onClose /
  // setEntry 时 clear. 之前 fire-and-forget, view 关闭后 timer 还持有 view
  // 引用直到 30s 后 fire, 反复开关书会累积僵尸 timer.
  private readyFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  // P0-7 修复: setEntry 是 sync, 旧 session.close() 不能 fire-and-forget
  // (见 setEntry 注释). 这里存 promise 让后续 openSession / onClose await.
  private pendingClosePromise: Promise<void> | undefined;
  // C7 修复: setEntry / openSession 生成一个 token. whenReady / openExcerptById
  // await 完后, 还要检查 token 是不是还是当前 — 否则 await 的是旧 session,
  // 新 session 已经挂上去, 旧 awaiter 在新 session 上调 jumpToExcerpt 跳到
  // 错位置 (obsidian:// 协议 "回到原文" 链接的最常见 root cause).
  private currentSessionToken = 0;

  private markReady(): void {
    if (this.readyFallbackTimer !== undefined) {
      globalThis.clearTimeout(this.readyFallbackTimer);
      this.readyFallbackTimer = undefined;
    }
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
      // 兜底: 30 秒还没就绪就强制 resolve,避免永久挂起.
      this.readyFallbackTimer = globalThis.setTimeout(() => {
        this.readyFallbackTimer = undefined;
        this.markReady();
      }, 30000);
    }
    return this.readyPromise;
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
    // passive: true — onTouchEnd 不调 preventDefault (让 selection 行为正常),
    // 标 false 会让 Chrome 在控制台报 "Unable to preventDefault" 警告, 没意义.
    this.host.addEventListener("touchend", onTouchEnd, { passive: true });
    // mousemove passive 避免阻塞滚动; 60Hz 触发但 setTimeout 重置足够轻量
    this.host.addEventListener("mousemove", onMouseMove, { passive: true });
    this.register(() => {
      this.host?.removeEventListener("touchstart", onTouchStart);
      this.host?.removeEventListener("touchend", onTouchEnd);
      this.host?.removeEventListener("mousemove", onMouseMove);
      if (visibleTimer !== undefined) globalThis.clearTimeout(visibleTimer);
    });
  }

  /**
   * P1: 阅读时长统计 — 监听 workspace 'active-leaf-change'. 当本 leaf
   * 成为 active 时记录开始时间, 失去 focus 时把累加 ms 写回 store。
   * 30s 防抖避免高频切窗造成 IO 风暴。
   */
  private bindReadingTimeTracker(): void {
    const onLeafChange = () => {
      const now = Date.now();
      const isActive = this.deps.app.workspace.activeLeaf === this.leaf;
      if (isActive && this.activeSinceMs === null) {
        this.activeSinceMs = now;
      } else if (!isActive && this.activeSinceMs !== null) {
        const delta = now - this.activeSinceMs;
        this.activeSinceMs = null;
        if (delta >= 1000) void this.flushReadingTime(delta);
      }
    };
    this.deps.app.workspace.on("active-leaf-change", onLeafChange);
    if (this.deps.app.workspace.activeLeaf === this.leaf) {
      this.activeSinceMs = Date.now();
    }
    this.register(() => {
      this.deps.app.workspace.off("active-leaf-change", onLeafChange);
      if (this.activeSinceMs !== null) {
        const delta = Date.now() - this.activeSinceMs;
        this.activeSinceMs = null;
        if (delta >= 1000) void this.flushReadingTime(delta);
      }
    });
  }

  private async flushReadingTime(deltaMs: number): Promise<void> {
    if (!this.entry) return;
    const now = Date.now();
    if (now - this.lastReadingFlushAt < 30000 && deltaMs < 60000) return;
    this.lastReadingFlushAt = now;
    try {
      const next = await this.deps.reading.addReadingTime(this.entry.book.id, deltaMs);
      // 同步 entry 里的 reading 字段 — 让 toolbar 显示新累计。
      this.entry = { ...this.entry, reading: next };
      this.toolbar?.update(this.toolbarState());
    } catch (error) {
      console.warn("[ez-reader] flushReadingTime failed", error);
    }
  }

  // ---- 键盘 ----
  private bindKeyboardNavigation(): void {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      // P2 polish: 焦点在 visible TocPanel 内时, 让 TocPanel 自己的
      // capture handler 接管键盘 (箭头 / Enter / Home/End / ←/→ / Space).
      // ReaderView 的容器层 capture handler 在 ancestor 阶段先跑, 但
      // tocPanel 已经 stopPropagation, 这里再加一次保险 — 不让 Home/End
      // / Space 触发翻页.
      if (this.tocPanel?.isVisible() && this.tocPanel.contains(event.target)) {
        return;
      }
      if (!this.session) return;
      const action = routeShortcut(event, this.shortcuts);
      if (action === null) return;
      this.runShortcutAction(action, event);
    };
    // 用 capture: true 让我们的 handler 在 foliate 内部 keyboard handler 之前跑
    this.containerEl.addEventListener("keydown", handler, true);
    this.register(() => this.containerEl.removeEventListener("keydown", handler, true));
  }

  /**
   * Dispatch a routed shortcut to the actual handler. Kept separate from
   * `routeShortcut` so the router stays a pure function (testable).
   */
  private runShortcutAction(action: ShortcutAction, event: KeyboardEvent): void {
    switch (action) {
      case "prev":
        event.preventDefault();
        void this.goToNext(-1);
        return;
      case "next":
        event.preventDefault();
        void this.goToNext(1);
        return;
      case "first":
        event.preventDefault();
        void this.seekFraction(0);
        return;
      case "last":
        event.preventDefault();
        void this.seekFraction(1);
        return;
      case "toggleNotes":
        event.preventDefault();
        void this.toggleNotes();
        return;
      case "toggleToc":
        event.preventDefault();
        void this.toggleToc();
        return;
      case "translate":
        event.preventDefault();
        void this.requestTranslation();
        return;
      case "excerpt":
        event.preventDefault();
        void this.saveExcerptFromSelection();
        return;
      case "quickHighlight":
        event.preventDefault();
        void this.quickHighlight();
        return;
      case "quickBookmark":
        event.preventDefault();
        void this.quickBookmark();
        return;
      case "toggleImmersive":
        event.preventDefault();
        this.toggleImmersive();
        return;
      case "showHelp":
        event.preventDefault();
        void this.showShortcutHelp();
        return;
      case "copySelection":
        event.preventDefault();
        this.copyCurrentSelection();
        return;
      case "openSearch":
        event.preventDefault();
        // 切换 search bar — 已开就关, 关就开. 跟 toolbar 按钮一致。
        if (this.searchBarVisible) this.closeSearchBar();
        else this.openSearchBar();
        return;
      case "escape":
        // 优先级: search bar → 选区菜单 → 抽屉 → panel → 不动 reader (防止误关)
        //
        // C3 修复: 之前 case "escape" 不调 preventDefault,事件冒泡到 Obsidian
        // 内部 handler → 关 leaf. 用户开 notes panel 想 Esc 关 panel,结果
        // 整个 reader 被关掉. 现在命中任何 UI 元素时 preventDefault,Obsidian
        // 内部 handler 看不到这个事件,只关我们的 panel;没命中任何东西时
        // 不 preventDefault,让 Obsidian 自己关 leaf (符合"无 panel 时 Esc
        // 退出"的默认行为).
        let escapeHandled = false;
        if (this.searchBarVisible) {
          this.closeSearchBar();
          escapeHandled = true;
        } else if (this.selectionMenu?.isVisible()) {
          this.selectionMenu.hide();
          escapeHandled = true;
        } else if (this.translationDrawer?.isVisible()) {
          this.translationDrawer.hide();
          escapeHandled = true;
        } else if (this.tocPanel?.isVisible() || this.bookmarksPanel?.isVisible() || this.excerptsPanel?.isVisible() || this.notesPanel?.isVisible()) {
          // P0 修复: 之前 Esc 只关 tocPanel, 其他三个 panel (书签/摘录/笔记) Esc
          // 没反应. 现在统一通过 hideAllPanels 关闭所有可见 panel, 任何可见 panel
          // 上的 × 按钮和 Esc 都走同一条路径.
          this.hideAllPanels();
          escapeHandled = true;
        }
        if (escapeHandled) event.preventDefault();
        return;
    }
  }

  /** Copy current document selection to clipboard (Ctrl+C-style shortcut). */
  private copyCurrentSelection(): void {
    const sel = globalThis.document.getSelection();
    const text = sel?.toString() ?? "";
    if (!text) return;
    void this.copyTextToClipboard(text);
  }

  /**
   * Write `text` to the system clipboard and give a short Notice. Used by
   * both the keyboard shortcut and the selection menu — previously the
   * latter did not await and gave no feedback, so failures (clipboard
   * permission denied) were silent.
   */
  private async copyTextToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(`已复制 (${text.length} 字符)`, 1500);
    } catch (error) {
      console.warn("[ez-reader] copy failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`复制失败: ${message}`, 4000);
    }
  }

  /** Show keyboard shortcut help overlay. */
  private async showShortcutHelp(): Promise<void> {
    // P2: 用 ShortcutHelpModal 替代 Notice — Notice 在长列表下被截断,
    // 用户看完也不记得. Modal 有 Esc/× 关闭, 表格更清晰.
    if (!this.shortcutHelpModal) {
      const { ShortcutHelpModal } = await import("./ShortcutHelpModal");
      this.shortcutHelpModal = new ShortcutHelpModal(this.deps.app, this.shortcuts);
    }
    this.shortcutHelpModal.open();
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

  // Zoom controls live on the PDF overlay (ReaderView doesn't render PDFs),
// so there's no in-toolbar zoom cluster here. BookReaderSession.setScale /
// setFitWidth remain on the port in case a future adapter (PDF+) needs them.

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
    // P0-7 修复: 等旧 session 真正关掉(切书路径), 否则两份 reader 同时
    // 挂在 host 上 — foliate iframe + PDF.js worker 内存翻倍, 旧 worker
    // 卸载延后到下一次 frame, 偶发 OOM. await 后再 mount 新 session.
    if (this.pendingClosePromise) {
      await this.pendingClosePromise;
      this.pendingClosePromise = undefined;
    }
    const book = this.entry.book;
    const delegate = createContentDelegate(book.locator.format, {
      foliate: this.deps.foliate,
      textReader: this.deps.textReader
    });
    try {
      this.session = await delegate.mount(this.host, {
        book,
        appearance: this.appearance,
        loader: this.deps.bookBytesLoader
      });
    } catch (error) {
      console.error("[ez-reader] failed to open book", book.locator.path, error);
      this.renderOpenError(error);
      // 即便失败也 markReady, 让外部知道不会继续等待
      this.markReady();
      return;
    }
    this.deps.onBookOpened?.(this.entry);
    // P0-2: reader open 成功后异步触发 metadata 升级 — 把 EPUB OPF / MOBI
    // EXTH 的真 title / author 写回 store, shelf 重渲染. 不 await, 不阻塞
    // 当前 reader 初始化; 失败由 LibraryService.refreshMetadata 内部 warn.
    if (this.deps.library) {
      void this.deps.library.refreshMetadata(this.entry.book.id);
    }
    this.applyTheme(this.appearance.theme);
    this.toolbar?.update(this.toolbarState());

    // P0 修复: foliate iframe 内的 keydown 事件不会 bubble 到 parent document,
    // 所以挂在 containerEl 上的 keyboard listener 永远收不到 ArrowLeft /
    // ArrowRight — 用户报告"键盘翻页不工作". 现在 FoliateSession 暴露
    // setOnIframeKeydown, ReaderView 注册一个转发到自己的 routeShortcut + 
    // runShortcutAction 路径, 复用同一套 keyboard route.
    const routeFromIframe = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      const action = routeShortcut(event, this.shortcuts);
      if (action === null) return;
      this.runShortcutAction(action, event);
    };
    if (typeof this.session.setOnIframeKeydown === "function") {
      this.session.setOnIframeKeydown(routeFromIframe);
    }

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
    // P1 fix: foliate-js 的 `relocate` 事件 detail 没有 chapter 字段 —
    // 必须另外通过 `currentChapter()` 同步当前章节标题, 否则 toolbar /
    // bookmark modal / pendingSelection.chapter 一直为空, 用户看到的章节
    // 永远是空白. 其他 reader (PagedTextSession / Mobi) 走自己的 chapter
    // resolution, currentChapter 返回 string | null 兜底.
    try {
      const initialChapter = await this.session.currentChapter?.();
      if (initialChapter && initialChapter.trim()) {
        this.chapter = initialChapter.trim();
      }
    } catch (error) {
      console.warn("[ez-reader] currentChapter (initial) failed", error);
    }
    this.toolbar?.update(this.toolbarState());

    const offRelocate = this.session.on("relocate", (event) => {
      const detail = (event as CustomEvent<{ fraction?: number; locator?: string; chapter?: string }>).detail;
      if (typeof detail?.fraction === "number") {
        this.fraction = detail.fraction;
        // foliate / paginator 都不带 chapter; 用 session.currentChapter() 实时拿
        // (已经在 foliate-js paginator.js 内部用 view.lastLocation.tocItem.label).
        const liveChapter = this.session?.currentChapter?.()?.trim?.() ?? "";
        let activeTocId: string | null = null;
        if (liveChapter) {
          this.chapter = liveChapter;
          // 同步更新 TocPanel 的 active 项 — 通过 label 匹配
          if (this.tocItems.length > 0) {
            const match = this.tocItems.find((it) => it.label === liveChapter);
            if (match) {
              this.tocPanel?.setActive(match.id);
              activeTocId = match.id;
            }
          }
        } else if (detail.chapter) {
          // 兜底: 某些 session (PagedTextSession) 在 relocate 里直接给 chapter.
          this.chapter = detail.chapter;
          if (this.tocItems.length > 0) {
            const match = this.tocItems.find((it) => it.label === detail.chapter);
            if (match) {
              this.tocPanel?.setActive(match.id);
              activeTocId = match.id;
            }
          }
        }
        // P2: 章节标记条 — 被动记录 chapter→fraction. 用户每翻一章,
        // 就在 tocFractions 里写一条 (id, fraction), 后续 toolbar 渲染 dots.
        // 注意只在 fraction 真变的时候写, 不每次 relocate 都 flush (relocate
        // 在翻页 / scroll 都触发, 同一章节可能触发多次 — 写同样的 fraction 没意义).
        if (activeTocId && !this.tocFractions.has(activeTocId)) {
          this.tocFractions.set(activeTocId, detail.fraction);
          // P2 polish: 同步 visited ids 给 TocPanel — 让 panel 内的进度点
          // 圆点从灰变绿. 没必要每次 relocate 都调, 只在 tocFractions 真
          // 增加时同步一次.
          this.tocPanel?.setVisited(this.tocFractions.keys());
        }
        this.toolbar?.update(this.toolbarState());
        this.schedulePersistProgress(detail.fraction, detail.locator);
      }
    });

    // P1 polish: intra-book link clicks (MOBI chapters use <a href="000000001">
    // etc. for cross-refs). PagedTextSession's stageClickHandler intercepts
    // the click and dispatches "link-click"; we route it back to the
    // session via goToSpineId / goToToc / goTo({kind:"identifier"}).
    const offLinkClick = this.session.on("link-click", (event) => {
      const detail = (event as CustomEvent<{ href: string }>).detail;
      if (!detail?.href) return;
      void this.handleLinkClick(detail.href);
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
      this.pendingSelection = { text, rect: detail.rect, locator: detail.locator, chapter: this.chapter, fraction: this.fraction };
      // 同步扩展 DOM Selection, 让用户视觉上看到选词扩展了
      if (text !== detail.text) {
        const sel = globalThis.document.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          // 把 selection 替换成整段 expanded text — 通过设置 Range
          const range = sel.getRangeAt(0);
          const node = range.startContainer.parentNode;
          if (node && node.textContent?.includes(text)) {
            const newRange = document.createRange();
            const startOffset = (node.textContent ?? "").indexOf(text);
            if (startOffset >= 0) {
              newRange.setStart(node, startOffset);
              newRange.setEnd(node, startOffset + text.length);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }
        }
      }
      if (selectionDebounce !== undefined) globalThis.clearTimeout(selectionDebounce);
      selectionDebounce = globalThis.setTimeout(() => {
        selectionDebounce = undefined;
        const sel = globalThis.document.getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0) : undefined;
        const rect = range?.getBoundingClientRect() ?? detail.rect;
        // foliate 选词 rect 是 iframe-viewport 相对 — 找 iframe 在 host 里的
        // 偏移,传给 selectionMenu 让它把 rect 转到 host viewport 空间,
        // 否则菜单飘到屏幕左上角.
        const hostOffset = this.findSessionIframeOffset();
        if (rect && rect.width > 0) {
          this.selectionMenu?.show(rect, hostOffset);
        } else {
          const fallbackRect = new DOMRect(
            globalThis.innerWidth / 2 - 100,
            globalThis.innerHeight - 120,
            200,
            40
          );
          this.selectionMenu?.show(fallbackRect, hostOffset);
        }
      }, 180);
    });

    // 加载 TOC
    if (this.session.tableOfContents) {
      try {
        this.tocItems = await this.session.tableOfContents();
        this.tocPanel?.setToc(this.tocItems);
        // 加载 TOC 后, 把已记录的 visited ids 同步给 panel — 进度点
        // 从加载好就反映用户的阅读进度 (而不是要等下一次 relocate).
        this.tocPanel?.setVisited(this.tocFractions.keys());
      } catch (error) {
        console.warn("[ez-reader] failed to load TOC", error);
      }
    }

    const disposeOn = () => {
      offRelocate();
      offSelect();
      offLinkClick();
      // 清理 selectionDebounce, 否则 session 关闭后定时器还会触发,
      // 在已 detach 的 view 上调用 selectionMenu.show() (虽然 selectionMenu
      // 还活着但 host 已经 undefined, 会出错)
      if (selectionDebounce !== undefined) {
        globalThis.clearTimeout(selectionDebounce);
        selectionDebounce = undefined;
      }
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
    // 并发触发, 错一条不影响其他 (foliate / pdfjs 高亮各自是 fire-and-forget)
    await Promise.all(excerpts.map(async (ex) => {
      let locator: string | undefined;
      if (ex.locator.position.kind === "reflow") {
        locator = ex.locator.position.cfi;
      } else if (ex.locator.position.kind === "pdf") {
        // 优先 subpath(精确 4-tuple), 否则只到页
        locator = ex.locator.position.selection ?? `page=${ex.locator.position.page}`;
      } else if (ex.locator.position.kind === "text") {
        // PagedTextSession 的 locator 是 `paged-text:<pageIdx>`。我们从
        // 持久化的 start/end 还原 pageIdx: start * totalPages。
        const textPos = ex.locator.position;
        const session = this.session;
        if (!session) return;
        const totalRaw = session.totalPages ? session.totalPages() : null;
        const total = totalRaw ?? 1;
        const safeTotal = total > 0 ? total : 1;
        const pageIdx = Math.max(0, Math.min(safeTotal - 1, Math.floor(textPos.start * safeTotal)));
        locator = `paged-text:${pageIdx}`;
      }
      if (!locator) return;
      try {
        await this.session!.highlight!({
          id: ex.id,
          text: ex.text,
          locator,
          color: "yellow",
          createdAt: ex.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] failed to restore highlight", ex.id, error);
      }
    }));
  }

  /**
   * Returns the viewport offset between the session's iframe content
   * and the host document. Selection rects from inside an iframe are
   * iframe-viewport relative — to position a menu in the host viewport
   * we need to add this offset.
   *
   * `session.element` is the foliate-view web component, which is a
   * positioned overlay matching the host host's size and origin. We
   * assume the foliate iframe is rendered at the same offset (true in
   * practice for foliate-js 1.0.1 with `data-ez-reader-flow` set).
   *
   * P1-9: PagedTextSession (TXT / MOBI / AZW3) renders directly into the
   * host document (no iframe). Selection rects from inside its stage
   * are already host-viewport-relative — passing an offset would
   * double-shift the menu. We detect the non-iframe path via the
   * session.element's tag name and return undefined for it.
   */
  private findSessionIframeOffset(): { x: number; y: number } | undefined {
    if (!this.session) return undefined;
    const el = this.session.element;
    // foliate-view is a custom element (registered by foliate-js). Anything
    // else (PagedTextSession's <div>) doesn't need an iframe offset.
    if (el.tagName.toLowerCase() !== "foliate-view") return undefined;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return undefined;
    return { x: rect.left, y: rect.top };
  }

  private toolbarState(): Parameters<NonNullable<typeof this.toolbar>["update"]>[0] {
    // P2: 章节标记条 — 从 tocItems + tocFractions 拼出 toolbar 需要的
    // { id, label, fraction }[] 列表. 顺序按 tocItems 的定义顺序 (通常是
    // 文档顺序), 不按 fraction 排 — 用户在 toc 里跳的顺序跟 toc tree 一致.
    const tocMarkers = this.tocItems
      .map((item) => {
        const frac = this.tocFractions.get(item.id);
        return frac === undefined ? null : { id: item.id, label: item.label, fraction: frac };
      })
      .filter((m): m is { id: string; label: string; fraction: number } => m !== null);
    return {
      fraction: this.fraction,
      chapter: this.chapter,
      status: this.entry?.reading.status ?? "unread",
      favorite: this.entry?.reading.favorite ?? false,
      showingBookmarks: this.bookmarksPanel?.isVisible?.() ?? false,
      showingExcerpts: this.excerptsPanel?.isVisible?.() ?? false,
      showingNotes: this.notesPanel?.isVisible?.() ?? false,
      showingToc: this.tocPanel?.isVisible?.() ?? false,
      showingImmersive: this.isImmersive,
      showFontSettings: true,
      bookmarkCount: this.bookmarkCount,
      excerptCount: this.excerptCount,
      currentPage: this.session?.currentPage?.() ?? null,
      totalPages: this.session?.totalPages?.() ?? null,
      searchOpen: this.searchBarVisible,
      searchMatchCount: this.searchMatchCount,
      totalReadingMs: this.entry?.reading.totalReadingMs ?? 0,
      tocMarkers
    };
  }

  // ---- 翻页 / 跳转 ----
  private async goToNext(direction: -1 | 1): Promise<void> {
    if (!this.session) return;
    // 翻页前清掉选区和菜单 — 否则 SelectionMenu 留在旧页面位置
    this.selectionMenu?.hide();
    const sel = globalThis.document.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    // ReaderSession.goTo 自身支持 { kind: "next" | "previous" }, 不再走
    // 重复的 session.next() / session.previous() (port 上是 redundant).
    await this.session.goTo(direction === 1 ? { kind: "next" } : { kind: "previous" });
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

  /** P2: 进度条下方章节标记点点击 — 通过 id 直接跳. */
  private async jumpToTocById(id: string): Promise<void> {
    const item = this.tocItems.find((it) => it.id === id);
    if (item) await this.jumpToTocItem(item);
  }

  /**
   * P1 polish: route intra-book link clicks (PagedTextSession dispatches
   * "link-click" when the user clicks an `<a data-ez-reader-href>`).
   * Resolution strategy:
   *   1. Prefer `goToSpineId(href)` — PagedTextSession looks it up in
   *      pages[].id. Works for MOBI 9-digit spine ids and any other
   *      intra-book path.
   *   2. Fall back to `goToToc(href)` — the href may already be a TOC id
   *      like "toc-3" if the engine happens to emit one.
   *   3. Fall back to `goTo({kind:"identifier", value: href})` — generic
   *      engine-native routing (e.g. EPUB's own goTo accepts a CFI).
   *   4. Last resort: numeric fraction if the href is a number.
   * Failures are silent — the link may point outside the book (we
   * rewrote href → data-ez-reader-href, so external URLs should already
   * be filtered out by sanitizeHtml).
   */
  private async handleLinkClick(href: string): Promise<void> {
    if (!this.session) return;
    // Strip any "#anchor" — we don't yet implement intra-chapter anchor
    // jumps, but a fragment alone shouldn't break navigation either.
    const target = href.includes("#") ? href.split("#")[0]! : href;
    if (!target) return;
    if (this.session.goToSpineId) {
      await this.session.goToSpineId(target);
      return;
    }
    if (this.session.goToToc) {
      const tocMatch = this.tocItems.find((t) => t.id === target);
      if (tocMatch) {
        await this.session.goToToc(tocMatch.id);
        this.tocPanel?.setActive(tocMatch.id);
        return;
      }
    }
    // Numeric → fraction (some engines emit "12" for chapter 12).
    if (/^\d+$/.test(target)) {
      await this.session.goTo({ kind: "identifier", value: target });
      return;
    }
    console.warn("[ez-reader] link click unhandled", href);
  }

  /**
   * C1 修复: 把 `void this.persistProgress(...)` 改成 schedule + debounce.
   * relocate 风暴期间只保留最后一次;fraction 跨过 0.01 (1%) 阈值时也会
   * 立即 flush (防止用户拖到底部,debounce 期间关 vault 丢最后一段进度).
   */
  private schedulePersistProgress(fraction: number, locator: string | undefined): void {
    const pending = this.persistProgressPending;
    // 1% 阈值 — 跨页跳转 / 翻书 / 跳目录都过这个阈值, 走立即 flush.
    const distance = pending ? Math.abs(pending.fraction - fraction) : 0;
    if (pending === undefined || distance >= 0.01) {
      // 替换 pending, timer 重置 (300ms)
      this.persistProgressPending = { fraction, locator };
      if (this.persistProgressTimer !== undefined) {
        globalThis.clearTimeout(this.persistProgressTimer);
      }
      this.persistProgressTimer = globalThis.setTimeout(() => {
        this.persistProgressTimer = undefined;
        const next = this.persistProgressPending;
        if (next) {
          this.persistProgressPending = undefined;
          void this.persistProgress(next.fraction, next.locator);
        }
      }, 300);
    } else {
      // 距离近 (同一页内), 只更新 pending, timer 复用
      this.persistProgressPending = { fraction, locator };
    }
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
    } else if (typeof finalLocator === "string" && finalLocator.startsWith("paged-text:")) {
      // TXT / MOBI / AZW3 — PagedTextSession locator is `paged-text:<pageIdx>`.
      // Persist both the page range and the fraction so future readers can
      // resume either by page or by scroll-position.
      const pageIdx = Number(finalLocator.slice("paged-text:".length)) || 0;
      const session = this.session;
      const totalRaw = session && session.totalPages ? session.totalPages() : null;
      const total = totalRaw ?? 1;
      const safeTotal = total > 0 ? total : 1;
      const start = pageIdx / safeTotal;
      const end = (pageIdx + 1) / safeTotal;
      position = { kind: "text", fraction, start, end };
    } else if (finalLocator) {
      position = { kind: "reflow", fraction, cfi: finalLocator };
    } else {
      position = { kind: "reflow", fraction };
    }
    try {
      await this.deps.reading.updatePosition(this.entry.book.id, position);
    } catch (error) {
      // 进度写入失败 — relocate 触发频繁 (每翻页一次), 不能弹 Notice 否则刷屏.
      // 5s 兜底只展示一次, 让用户知道有问题但不阻塞阅读.
      console.warn("[ez-reader] persistProgress failed", error);
      const now = Date.now();
      if (now - this.lastProgressFailureNoticeAt > 5000) {
        this.lastProgressFailureNoticeAt = now;
        new Notice("保存阅读进度失败,稍后重试");
      }
    }
  }

  // ---- 书签 ----
  private async addBookmarkAtCurrentPosition(): Promise<void> {
    if (!this.entry) return;
    const { BookmarkModal } = await import("./BookmarkModal");
    // P1 polish: BookmarkModal 现在显示 chapter + percentage + 当前页可见文本片段
    // 作为 default label, 让用户立即看到"我在哪儿加书签". preview 优先用
    // 当前选中的文字 (如果有), 否则用 toolbar 的 chapterLabel.
    const preview = this.pendingSelection?.text
      ?? (this.chapter ? this.chapter : "")
      ?? "";
    const modal = new BookmarkModal(this.deps.app, {
      chapter: this.chapter ?? "",
      fraction: this.fraction,
      preview: preview.length > 80 ? `${preview.slice(0, 80)}…` : preview,
      timestamp: Date.now()
    });
    const label = await modal.openAndWait();
    if (label === null) return;
    await this.addBookmarkCore(label, false);
  }

  /**
   * "Quick bookmark" (按 B) — 不弹 modal, 用 chapter + percentage + 时间
   * 作自动 label, 用户后续可在 BookmarksPanel 重命名 (TODO: 待面板支持
   * inline rename 后, 体验再上一层). 设计动机: 微信读书 / Apple Books
   * 都没有"加书签"弹窗, 都是一键加入 + 后续命名 — 弹窗打断阅读流.
   */
  private async quickBookmark(): Promise<void> {
    if (!this.entry) return;
    const autoLabel = composeQuickBookmarkLabel(this.chapter, this.fraction);
    await this.addBookmarkCore(autoLabel, true);
  }

  /** 共享的 bookmark 保存逻辑, modal flow 和 quick flow 都走这里. */
  private async addBookmarkCore(label: string, quick: boolean): Promise<void> {
    if (!this.entry) return;
    const locator = await this.session?.exportLocator();
    if (!locator) {
      new Notice("无法获取当前位置 — 书签未保存");
      return;
    }
    try {
      await this.deps.reading.addBookmark({
        id: generateExcerptId("bm"),
        bookId: this.entry.book.id,
        label,
        locator: { position: { kind: "reflow", fraction: this.fraction, cfi: locator }, chapter: this.chapter },
        createdAt: Date.now()
      });
    } catch (error) {
      console.warn("[ez-reader] addBookmark failed", error);
      new Notice("添加书签失败");
      return;
    }
    await this.refreshPanels();
    new Notice(quick ? `📑 已加书签 (按 ? 看快捷键)` : "书签已添加", 1800);
  }

  private async toggleBookmarks(): Promise<void> {
    if (!this.bookmarksPanel) return;
    // P1: 切换行为 — 已显示则隐藏, 跟 toc/notes 一致. 之前永远 show,
    // 用户点书签按钮"打开 → 再点一下什么都不发生"很别扭.
    if (this.bookmarksPanel.isVisible()) {
      this.bookmarksPanel.hide();
    } else {
      this.bookmarksPanel.show();
      this.excerptsPanel?.hide();
    }
    await this.refreshPanels();
    this.toolbar?.update(this.toolbarState());
  }

  private async toggleExcerpts(): Promise<void> {
    if (!this.excerptsPanel) return;
    // P1: 同上 — 切换行为, 跟 bookmarks / toc / notes 一致.
    if (this.excerptsPanel.isVisible()) {
      this.excerptsPanel.hide();
    } else {
      this.excerptsPanel.show();
      this.bookmarksPanel?.hide();
    }
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

  /** 关闭所有侧边 panel — panel header 上的 × 按钮和 Esc 键都走这个. */
  private hideAllPanels(): void {
    this.bookmarksPanel?.hide();
    this.excerptsPanel?.hide();
    this.tocPanel?.hide();
    this.notesPanel?.hide();
    this.toolbar?.update(this.toolbarState());
  }

  private toggleImmersive(): void {
    this.isImmersive = !this.isImmersive;
    const root = this.containerEl.children[1] as HTMLElement;
    root.toggleClass("ez-reader__immersive", this.isImmersive);
    // P0 修复: 切换后动态管理 × 按钮 — 进入沉浸时创建, 退出时移除. 之前
    // 按钮只在 onload 时一次性创建, 用户用 Shift+F 切沉浸时按钮根本不在 DOM.
    if (this.isImmersive) {
      this.ensureImmersiveExitButton(root);
    } else {
      root.querySelector(".ez-reader__immersive-exit")?.remove();
    }
    this.toolbar?.update(this.toolbarState());
  }

  /** 在 container 里加一个 immersive-exit × 按钮 (如果还没建). */
  private ensureImmersiveExitButton(container: HTMLElement): void {
    if (container.querySelector(".ez-reader__immersive-exit")) return;
    const exitBtn = container.createEl("button", {
      cls: "ez-reader__immersive-exit",
      attr: { type: "button", "aria-label": "退出沉浸模式", title: "退出沉浸模式 (Esc)" },
      text: "×"
    });
    exitBtn.addEventListener("click", () => {
      this.isImmersive = false;
      container.removeClass("ez-reader__immersive");
      exitBtn.remove();
      this.toolbar?.update(this.toolbarState());
    });
  }

  private async cycleStatus(): Promise<void> {
    if (!this.entry) return;
    // 轮询: unread → reading → finished → abandoned → unread
    const order: ReadonlyArray<ReadingState["status"]> = ["unread", "reading", "finished", "abandoned"];
    const current = this.entry.reading.status;
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length] ?? "unread";
    try {
      const updated = await this.deps.reading.setStatus(this.entry.book.id, next);
      this.entry = { ...this.entry, reading: updated };
      this.toolbar?.update(this.toolbarState());
    } catch (error) {
      console.warn("[ez-reader] cycleStatus failed", error);
      new Notice("更新阅读状态失败");
    }
  }

  private async toggleFavorite(): Promise<void> {
    if (!this.entry) return;
    try {
      const updated = await this.deps.reading.toggleFavorite(this.entry.book.id);
      this.entry = { ...this.entry, reading: updated };
      this.toolbar?.update(this.toolbarState());
    } catch (error) {
      console.warn("[ez-reader] toggleFavorite failed", error);
      new Notice("更新收藏状态失败");
    }
  }

  private async refreshPanels(): Promise<void> {
    if (!this.entry) return;
    const [bookmarks, excerpts] = await Promise.all([
      this.deps.reading.listBookmarks(this.entry.book.id),
      this.deps.reading.listExcerpts(this.entry.book.id)
    ]);
    this.bookmarkCount = bookmarks.length;
    this.excerptCount = excerpts.length;
    this.bookmarksPanel?.setBookmarks(bookmarks);
    this.excerptsPanel?.setExcerpts(excerpts);
    this.notesPanel?.setEntries(excerpts);
    this.toolbar?.update(this.toolbarState());
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
    try {
      await this.deps.reading.removeBookmark(this.entry.book.id, bookmark.id);
    } catch (error) {
      console.warn("[ez-reader] removeBookmark failed", error);
      new Notice("删除书签失败");
      return;
    }
    await this.refreshPanels();
    new Notice("书签已删除", 1500);
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
    try {
      await this.deps.reading.removeExcerpt(this.entry.book.id, excerpt.id);
    } catch (error) {
      console.warn("[ez-reader] removeExcerpt failed", error);
      new Notice("删除摘录失败");
      return;
    }
    if (this.session?.removeHighlight) {
      try {
        await this.session.removeHighlight(excerpt.id);
      } catch {
        // ignore — 引擎层失败不影响 annotation store 已经成功的删除
      }
    }
    await this.refreshPanels();
    new Notice("摘录已删除", 1500);
  }

  private async editExcerpt(excerpt: Excerpt): Promise<void> {
    const modal = new ThoughtModal(this.deps.app, {
      text: excerpt.text,
      chapter: excerpt.locator.chapter
    });
    const submit = await modal.openAndWait();
    if (!submit || !this.entry) return;
    // 走 patch 路径 — 不重写 highlight (locator 没变), 比 remove+add 高效
    try {
      await this.deps.reading.updateExcerptNote(this.entry.book.id, excerpt.id, {
        note: submit.note,
        tags: submit.tags
      });
    } catch (error) {
      console.warn("[ez-reader] editExcerpt failed", error);
      new Notice("编辑摘录失败");
      return;
    }
    await this.refreshPanels();
    new Notice("摘录已更新", 1500);
  }

  /**
   * P2: inline note patch — 用户在 SidebarNotesPanel 点 note 直接编辑,
   * blur 自动保存. 只改 note 字段, 不动 locator / text / tags.
   * 失败抛出 (UI 会回滚).
   */
  private async updateExcerptNoteInline(excerpt: Excerpt, note: string): Promise<void> {
    if (!this.entry) throw new Error("no entry");
    await this.deps.reading.updateExcerptNote(this.entry.book.id, excerpt.id, { note });
    await this.refreshPanels();
  }

  private async saveExcerptFromSelection(): Promise<void> {
    if (!this.entry || !this.pendingSelection) return;
    const { ExcerptModal } = await import("./ExcerptModal");
    const modal = new ExcerptModal(this.deps.app, { text: this.pendingSelection.text });
    const submit = await modal.openAndWait();
    if (!submit) return;
    await this.saveExcerptCore(this.pendingSelection.text, submit.note, submit.tags, false);
  }

  /**
   * "Quick highlight" (按 H, 不带 shift) — 选中文本后按 H 直接保存摘录
   * + 黄色高亮, 不弹 modal. label 截断到 30 字符 (中文按字符 / 英文按词
   * 边界), 跟 Notion / Readwise 的快速摘录一致.
   *
   * 注意: 只在有选词 (`pendingSelection`) 时才生效. 没有选词按 H 忽略
   * (避免误触); 用户想要 modal 流程继续按 Shift+H.
   */
  private async quickHighlight(): Promise<void> {
    if (!this.entry || !this.pendingSelection) {
      new Notice("先选一段文字再按 H", 2000);
      return;
    }
    const note = ""; // quick 不弹 modal, note 留空, 后续面板补
    await this.saveExcerptCore(this.pendingSelection.text, note, [], true);
  }

  /** 共享 excerpt 保存逻辑, modal flow 和 quick flow 都走这里. */
  private async saveExcerptCore(
    text: string,
    note: string,
    tags: ReadonlyArray<string>,
    quick: boolean
  ): Promise<void> {
    if (!this.entry) return;
    const excerptId = generateExcerptId("ex");
    const locator = this.pendingSelection?.locator ?? (await this.session?.exportLocator()) ?? undefined;
    if (!locator) {
      new Notice("无法获取选区位置 — 摘录未保存");
      return;
    }
    const pos: ReadingPosition = this.isPdf && this.session?.currentPage
      ? {
          kind: "pdf",
          page: this.session.currentPage() ?? 1,
          ...(typeof locator === "string" && locator.startsWith("#page=") ? { selection: locator } : {})
        }
      : { kind: "reflow", fraction: this.pendingSelection?.fraction ?? this.fraction, cfi: locator };

    const excerpt: Excerpt = {
      id: excerptId,
      bookId: this.entry.book.id,
      text,
      locator: { position: pos, chapter: this.chapter },
      note,
      tags,
      createdAt: Date.now()
    };
    try {
      await this.deps.reading.addExcerpt(excerpt);
    } catch (error) {
      console.warn("[ez-reader] addExcerpt failed", error);
      new Notice("保存摘录失败");
      return;
    }
    if (this.session?.highlight) {
      try {
        await this.session.highlight({
          id: excerptId,
          text,
          locator,
          color: "yellow",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] session.highlight failed", error);
      }
    }
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
          locator: locatorForNoteWriter(pos),
          chapterTitle: excerpt.locator.chapter,
          format: this.entry.book.locator.format,
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
        new Notice("写入笔记失败 (摘录已保存)");
      }
    }
    await this.refreshPanels();
    this.notesPanel?.flashLast(excerptId);
    new Notice(quick ? `🖍 已高亮 (按 ? 看快捷键)` : "摘录已保存", 1800);
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
    const excerptId = generateExcerptId("th");
    // 选词触发 → 用 pendingSelection.fraction (frozen);
    // 自由想法 (openFreeThoughtModal) → text 是 undefined, 用 live this.fraction.
    const thoughtFraction = text !== undefined ? this.pendingSelection?.fraction ?? this.fraction : this.fraction;
    const pos: ReadingPosition = this.isPdf && this.session?.currentPage
      ? {
          kind: "pdf",
          page: this.session.currentPage() ?? 1,
          ...(typeof locator === "string" && locator.startsWith("#page=") ? { selection: locator } : {})
        }
      : { kind: "reflow", fraction: thoughtFraction, cfi: locator };

    const excerpt: Excerpt = {
      id: excerptId,
      bookId: this.entry.book.id,
      text: text ?? "",
      locator: { position: pos, chapter: this.chapter },
      note: submit.note,
      tags: submit.tags,
      createdAt: Date.now()
    };
    try {
      await this.deps.reading.addExcerpt(excerpt);
    } catch (error) {
      console.warn("[ez-reader] saveThought addExcerpt failed", error);
      new Notice("保存想法失败");
      return;
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
          locator: locatorForNoteWriter(pos),
          chapterTitle: excerpt.locator.chapter,
          format: this.entry.book.locator.format,
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
        new Notice("写入笔记失败 (想法已保存)");
      }
    }
    await this.refreshPanels();
    this.notesPanel?.flashLast(excerptId);
    new Notice("想法已保存", 1500);
  }

  private copySelectionToClipboard(): void {
    const selection = this.pendingSelection?.text;
    if (!selection) return;
    void this.copyTextToClipboard(selection);
  }

  private async requestTranslation(): Promise<void> {
    if (!this.pendingSelection || !this.translationDrawer) return;
    await this.translationDrawer.translate(this.pendingSelection.text);
  }

  /**
   * P1: 打开 find-in-book 搜索栏 — 跟 ReaderSelectionMenu 同级, 浮在
   * reader 顶部。让用户立刻开始打字。再次触发 / Esc 关闭。
   */
  private openSearchBar(): void {
    if (!this.searchBar) return;
    this.searchBarVisible = true;
    this.searchBar.show();
    this.toolbar?.update(this.toolbarState());
  }

  private closeSearchBar(): void {
    if (!this.searchBar) return;
    this.searchBarVisible = false;
    this.searchMatchCount = null;
    this.searchBar.hide();
    this.toolbar?.update(this.toolbarState());
  }

  private async runFindInBook(query: string, fromStart: boolean): Promise<void> {
    if (!this.session || typeof this.session.findInBook !== "function") {
      // Session 没挂上或格式不支持 — 静默关闭 search bar.
      this.closeSearchBar();
      new Notice("当前格式暂不支持搜索");
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      this.searchMatchCount = null;
      this.toolbar?.update(this.toolbarState());
      return;
    }
    try {
      const count = await this.session.findInBook(trimmed, fromStart);
      this.searchMatchCount = count;
      this.toolbar?.update(this.toolbarState());
      if (count === 0) {
        new Notice(`未找到 "${trimmed}"`);
      } else if (fromStart) {
        new Notice(`找到 ${count} 处匹配 (从首处开始)`);
      } else {
        new Notice(`匹配 ${this.findCursorDisplay(count)} / ${count}`);
      }
    } catch (error) {
      console.warn("[ez-reader] findInBook failed", error);
      new Notice("搜索失败");
      this.closeSearchBar();
    }
  }

  /**
   * 用户按 Enter (fromStart) vs Enter again (next) 时显示不同文案 ——
   * 复用一个 cursor 但要从 toolbar badge 推断 index。这里简化: 不暴露
   * cursor index,只显示 total, 跟 Kindle 类似。
   */
  private findCursorDisplay(_total: number): string {
    return "下一处";
  }

  private async saveTranslationAsNote(source: string, translated: string): Promise<void> {
    if (!this.entry) return;
    const text = `> ${source.replace(/\n/g, "\n> ")}\n\n**翻译**:\n\n${translated}`;
    await this.saveThoughtCore(text, this.pendingSelection?.locator);
  }
}

