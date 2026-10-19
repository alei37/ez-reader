import { Notice, Plugin, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { CoverCache } from "./adapters/obsidian/CoverCache";
import { ObsidianAnnotationStore } from "./adapters/obsidian/ObsidianAnnotationStore";
import { ObsidianBookSource } from "./adapters/obsidian/ObsidianBookSource";
import { ObsidianLibraryWriter } from "./adapters/obsidian/ObsidianLibraryWriter";
import { FoliateBookReader } from "./adapters/foliate/FoliateBookReader";
import { TxtBookReader } from "./adapters/text/TxtBookReader";
import { MobiBookReader } from "./adapters/text/MobiBookReader";
import { PdfCoverExtractor } from "./adapters/obsidian/PdfCoverExtractor";
import { GoogleTranslationProvider } from "./adapters/translation/GoogleTranslationProvider";
import { YoudaoTranslationProvider } from "./adapters/translation/YoudaoTranslationProvider";
import { DeeplTranslationProvider } from "./adapters/translation/DeeplTranslationProvider";
import { MyMemoryTranslationProvider } from "./adapters/translation/MyMemoryTranslationProvider";
import { OpenAICompatibleTranslationProvider } from "./adapters/translation/OpenAICompatibleTranslationProvider";
import { AnthropicCompatibleTranslationProvider } from "./adapters/translation/AnthropicCompatibleTranslationProvider";
import { LibraryService } from "./core/services/LibraryService";
import { ReadingService } from "./core/services/ReadingService";
import { TranslationCoordinator } from "./core/services/TranslationService";
import type { LibraryEntry } from "./core/services/LibraryService";
import type { Excerpt } from "./core/entities/Excerpt";
import type { BookBytesLoader, BookReader } from "./core/ports/BookReader";
import type { LibraryWriter } from "./core/ports/LibraryWriter";
import type {
  KeyboardShortcuts,
  ReaderAppearance,
  ReaderOpenMode
} from "./core/types/ReaderSettings";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_READER_APPEARANCE
} from "./core/types/ReaderSettings";
import type { Locale } from "./core/types/Locale";
import { ShelfView, SHELF_VIEW_TYPE } from "./ui/shelf/ShelfView";
import { READER_VIEW_TYPE, ReaderView } from "./ui/reader/ReaderView";
import { readerLeafMatchesBook } from "./ui/reader/readerLeafState";
import { SettingsTab } from "./ui/settings/SettingsTab";

/**
 * How many times the v0.3.0 legacy-notes migration is retried before
 * giving up. A failed run keeps the flag false so the next launch can try
 * again — which matters on a second device where the legacy folder may
 * not have finished syncing yet — but an unbounded retry would re-list
 * the vault on every startup forever if the folder is genuinely gone.
 */
const MIGRATION_MAX_ATTEMPTS = 5;

/**
 * Obsidian plugin class. Wires adapters into the core services and exposes
 * the shelf + reader views to the workspace.
 *
 * The plugin is deliberately thin: lifecycle hooks, view registration,
 * ribbon actions. All business logic lives in the core services.
 */
export default class EzReaderPlugin extends Plugin {
  private bookSource!: ObsidianBookSource;
  private annotationStore!: ObsidianAnnotationStore;
  private library!: LibraryService;
  private reading!: ReadingService;
  private translation!: TranslationCoordinator;
  private foliate!: BookReader;
  private txtReader!: BookReader;
  private mobiReader!: BookReader;
  private pdfCover!: PdfCoverExtractor;
  private covers!: CoverCache;
  private noteWriter!: LibraryWriter;
  /**
   * Cached value of the user's original `showUnsupportedFiles` setting,
   * so onunload can restore it. Stored as a private field instead of
   * pinned to `this` via cast to keep the type contract honest.
   */
  private __ezReaderPreviousShowUnsupported: boolean | undefined;

  async onload(): Promise<void> {
    this.bookSource = new ObsidianBookSource(this.app);
    this.annotationStore = new ObsidianAnnotationStore(this);
    // P0 fix: noteWriter 必须在 LibraryService / ReadingService 之前构造.
    // 之前它在下面 (构造 CoverCache 之后) 才 new, 而两个 service 的构造
    // 参数是 `private readonly libraryWriter?: LibraryWriter` —— 按值捕获.
    // 传进去的 undefined 会被永久锁死, 导致:
    //   - ReadingService.recordSession 恒 no-op → sessions/*.jsonl 从没写过
    //   - LibraryService.getRichEntry 跳过整个 analytics 分支 → BookInfoModal
    //     阅读时长面板永远是 0
    // ObsidianLibraryWriter 只依赖 (app, plugin, annotations), 三个此时都已就绪.
    this.noteWriter = new ObsidianLibraryWriter(this.app, this, this.annotationStore);
    // Local Book Reader upstream opens Obsidian's "Detect all file
    // extensions" setting so `vault.getFiles()` returns PDF/EPUB alongside
    // markdown. We do the same before initializing the library.
    await this.enableAllBookFormatsInFileExplorer();
    // P0-2: 在构造 LibraryService 之前先构造 readers, 这样 metadataReader
    // 可以聚合 foliate + textReader 让 LibraryService.refreshMetadata 拿到
    // EPUB OPF / MOBI EXTH 的真 title / author. 顺序不能反 — readers 必须
    // 先 new 完才能聚合成 metadataReader.
    this.foliate = new FoliateBookReader();
    this.txtReader = new TxtBookReader();
    this.mobiReader = new MobiBookReader();
    // P1: PDF cover extraction uses Obsidian's bundled pdf.js (the same
    // instance the built-in PDFView uses). Reusing it avoids shipping
    // ~2MB of vendored pdf.js + a worker — and crucially avoids
    // overwriting `globalThis.pdfjsLib`, which would otherwise make
    // Obsidian's PDFView crash with a worker version mismatch.
    this.pdfCover = new PdfCoverExtractor();
    const metadataReader: BookReader = {
      // metadataReader 只用于 readMetadata, open/extractCover 永远不会被调用
      // (它们走 textReader / foliate dispatcher). 这里保留接口实现避免
      // 类型 widen, 但 throw 防止误用.
      open: async () => {
        throw new Error("metadataReader.open should never be called");
      },
      extractCover: async () => null,
      readMetadata: async (book, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader!.readMetadata(book, loader);
        }
        if (book.locator.format === "txt") {
          return this.txtReader!.readMetadata(book, loader);
        }
        if (book.locator.format === "epub") {
          return this.foliate!.readMetadata(book, loader);
        }
        return null;
      }
    };
    this.library = new LibraryService(
      this.bookSource,
      this.annotationStore,
      metadataReader,
      this.makeBookBytesLoader(),
      // P0 fix: 第 5 个参数必须传, 否则 getRichEntry 的 analytics 分支
      // 永远跳过 (dailyReadingTime: [] / streak: 0 / info.md 读不到).
      this.noteWriter
    );
    this.reading = new ReadingService(
      this.annotationStore,
      // 同步 LibraryService.entries + emit shelf refresh, 否则 reader 翻页
      // 写完 data.json 后 shelf 仍然显示旧进度, 关闭 → 重开 reader 也不
      // resume (entry.reading 是 library.entries 的旧快照).
      (state) => this.library.updateReading(state),
      // v0.3.0: 透传 libraryWriter 让 ReadingService.recordSession /
      // getDailyReadingTime 能写到 ezreader/sessions/*.jsonl
      this.noteWriter
    );
    this.translation = new TranslationCoordinator(this.annotationStore, [
      new YoudaoTranslationProvider(),
      new DeeplTranslationProvider(),
      new GoogleTranslationProvider(),
      // P2: 免费无 key provider — 给不想注册信用卡/有道那种付费账户的用户。
      // 每天每个 IP 1 万字符,质量略低于 DeepL/Google 但够用。
      new MyMemoryTranslationProvider(),
      // P2: 用户自定义 LLM (OpenAI 兼容) — DeepSeek / 智谱 / 通义 / OpenAI
      // 都走同一接口, 在 settings 里填 baseUrl + apiKey + model 即可.
      new OpenAICompatibleTranslationProvider(),
      // P2: 用户自定义 LLM (Anthropic Messages API 兼容) — MiniMax 等。
      // 注意是 /v1/messages 不是 /chat/completions, 鉴权走 x-api-key 头.
      new AnthropicCompatibleTranslationProvider()
    ]);
    // Settings 改完立即 bust translation 30s cache, 让下一次 translate 拿到新 provider / key.
    this.annotationStore.onSettingsChanged(() => this.translation.invalidate());
    // P1 之后: ez-reader 不再写 PDF 渲染。PDF 走 Obsidian 内置 viewer (PDF++ 接管)。
    // 封面仍然走我们自己的 pdf.js (只渲染首页, 不接管整本 PDF 渲染)。
    // TXT 没封面 (返回 null), 不注册 — CoverCache 走占位封面。
    this.covers = new CoverCache(
      this.app,
      this,
      this.library,
      {
        epub: this.foliate,
        mobi: this.mobiReader,
        azw3: this.mobiReader,
        pdf: this.pdfCover
      },
      this.annotationStore
    );

    // Obsidian loads files asynchronously. `vault.getFiles()` returns an
    // empty list until the layout is ready and the initial vault scan has
    // finished. Wait for that moment before doing the first library scan,
    // matching the upstream plugin's pattern.
    this.app.workspace.onLayoutReady(async () => {
      // v0.3.0: 一次性老 `notesDirectory/` → 新 `ezreader/` 迁移。放在
      // library.initialize 之前跑 — 万一迁移失败用户能看到 Notice,但
      // 不影响 library 正常工作(新结构的 notes/ 还没文件,只是空)。
      // 跑过一次后写 migratedToV030 = true,后续启动跳过。
      await this.runV030Migration();
      await this.library.initialize();
      // Cover hydration must run after the library has populated its
      // entries — slug → bookId mapping needs them to exist.
      await this.covers.hydrateCovers();
      // P3: Obsidian 重启后会自动恢复之前打开的 leaf, 但 `openInBuiltInViewer`
      // 这条挂 overlay 的路径只在用户从书架打开时才会跑 — 自动恢复的 PDF
      // leaf 没人挂 overlay, 用户就看到「翻译弹窗/选词菜单不见了」。这里扫
      // 一遍所有已打开的 PDF leaf, 给在书架里的 PDF 补挂 overlay.
      await this.attachOverlaysToOpenLibraryPdfs();
    });
    // P3: 用户从书架外 (反向链接 / 全局搜索 / 文件浏览器) 点开 PDF 时,
    // `openInBuiltInViewer` 不会被调用, overlay 也漏挂. active-leaf-change
    // 覆盖这条路径 — 每次切到 PDF leaf 都 check 一下, 缺就补挂. findPdfOverlayForLeaf
    // 是 WeakMap 查表, 命中就 return, 0 开销.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf || leaf.view.getViewType() !== "pdf") return;
        void this.attachOverlayToPdfLeafIfLibraryBook(leaf);
      })
    );

    this.addSettingTab(new SettingsTab(this.app, this, this.annotationStore, this.translation.listProviders()));

    this.registerView(
      SHELF_VIEW_TYPE,
      (leaf) => new ShelfView(leaf, this.deps())
    );
    this.registerView(
      READER_VIEW_TYPE,
      (leaf) => new ReaderView(leaf, this.readerDeps())
    );

    this.addRibbonIcon("library", "打开个人图书馆", () => {
      void this.openShelf();
    });
    // P1 修复: 删掉第二个 ribbon "从书库打开电子书" — 之前 openPicker 找
    // 当前 active file 然后在文件管理器打开, 但用户已经有"个人图书馆"按钮
    // 可以浏览所有书, 这个 button 是多余入口. Obsidian ribbon 槽位宝贵,
    // 留空位给以后真正有用的入口.

    // Reverse-jump protocol: a note may link back to the source via
    // `obsidian://ez-reader?book=<bookId>&annotation=<excerptId>`. The
    // handler opens the book and jumps the reader to the excerpt.
    this.registerObsidianProtocolHandler("ez-reader", (params) => {
      void this.handleProtocol(params);
    });
  }

  onunload(): void {
    this.library?.dispose();
    // v0.3.3: 卸载所有 PdfOverlay。之前完全没做这件事, 后果是用户
    // "禁用插件"之后, 每个开着的 PDF leaf 上仍然跑着:
    //   - 一个 60fps 的 requestAnimationFrame 循环 (每帧 getBoundingClientRect)
    //   - 2 个 MutationObserver
    //   - document 上的 selectionchange / mousedown / visibilitychange listener
    //   - window 上的 resize / blur / focus listener
    // 这些全是**闭包持有 view 引用**的, 插件对象被卸载后它们照跑不误,
    // 而且 rAF 循环会阻止对应页面的 GC —— 禁用一次插件泄漏一整批。
    //
    // 用动态 import 是因为 pdfOverlay.ts 是重模块 (只有打开 PDF 时才该加载);
    // 卸载路径上一个失败不能阻断后面的清理, 所以整段包在 catch 里。
    void import("./ui/reader/pdfOverlay")
      .then(({ unmountAllPdfOverlays }) => {
        unmountAllPdfOverlays();
      })
      .catch(() => {
        // pdfOverlay 从来没被 import 过 (用户没开过 PDF) —— 什么都不用卸载。
      });
    // 还原用户原本的 "Detect all file extensions" 设置 — 我们只在
    // 插件活跃期间打开它, 退出时恢复原值, 不污染用户的偏好。
    if (typeof this.__ezReaderPreviousShowUnsupported === "boolean") {
      const vault = this.app.vault as typeof this.app.vault & {
        setConfig?: (key: string, value: boolean) => Promise<void> | void;
      };
      void vault.setConfig?.("showUnsupportedFiles", this.__ezReaderPreviousShowUnsupported);
    }
  }

  private deps(): ConstructorParameters<typeof ShelfView>[1] {
    return {
      app: this.app,
      library: this.library,
      reading: this.reading,
      foliate: this.foliate,
      openReader: (entry: LibraryEntry) => this.openReader(entry),
      covers: this.covers,
      bookBytesLoader: this.makeBookBytesLoader(),
      // Onboarding 模态需要持久化 dismissal 标志 — 透传 annotationStore
      annotationStore: this.annotationStore,
      // Shelf density 等 shelf-only 的设置也走这里, 不暴露 patchSettings
      // 全部能力 — ShelfView 只需要读 + 写这一个字段, 锁死最小接口.
      settingsStore: this.annotationStore
    };
  }

  private readerDeps(): ConstructorParameters<typeof ReaderView>[1] {
    return {
      app: this.app,
      reading: this.reading,
      foliate: this.foliate,
      // TXT / MOBI / AZW3 共享同一个 BookReader 抽象 — Plugin 层把
      // mobi/azw3 路由给 MobiBookReader (内部按 format 再细派),
      // txt 路由给 TxtBookReader。ReaderView 只看到这一个聚合的
      // `textReader` BookReader, 不知道下面是哪个具体 reader。
      textReader: this.makeTextReader(),
      translation: this.translation,
      noteWriter: this.noteWriter,
      bookBytesLoader: this.makeBookBytesLoader(),
      settingsProvider: () => this.loadReaderSettings(),
      onBookOpened: (entry) => void this.covers.ensureCoverFor(entry.book, this.makeBookBytesLoader()),
      // P0-2: 透传 LibraryService, 让 ReaderView.openSession 完成后调
      // refreshMetadata 把真 title / author 写回 store.
      library: this.library
    };
  }

  /**
   * Build a `BookReader` that dispatches `open` / `extractCover` based on
   * `book.locator.format`. The dispatcher's API matches `BookReader` so
   * the reader-side code (ReaderView, CoverCache) doesn't need to know
   * it's a multiplexer.
   */
  private makeTextReader(): BookReader {
    return {
      open: async (book, host, appearance, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.open(book, host, appearance, loader);
        }
        return this.txtReader.open(book, host, appearance, loader);
      },
      extractCover: async (book, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.extractCover(book, loader);
        }
        return this.txtReader.extractCover(book, loader);
      },
      readMetadata: async (book, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.readMetadata(book, loader);
        }
        return this.txtReader.readMetadata(book, loader);
      }
    };
  }

  private async loadReaderSettings(): Promise<{
    defaultAppearance: ReaderAppearance;
    shortcuts: KeyboardShortcuts;
    twoPagesByDefault: boolean;
    immersiveOnTablet: boolean;
    translationLocale: Locale;
    rememberProgress: boolean;
  }> {
    const settings = await this.annotationStore.listSettings();
    return {
      defaultAppearance: settings.defaultAppearance ?? DEFAULT_READER_APPEARANCE,
      shortcuts: settings.keyboardShortcuts ?? DEFAULT_KEYBOARD_SHORTCUTS,
      twoPagesByDefault: settings.twoPagesByDefault ?? false,
      immersiveOnTablet: settings.immersiveOnTablet ?? false,
      translationLocale: (settings.translation?.targetLocale as Locale) ?? "zh-CN",
      rememberProgress: settings.rememberProgress !== false
    };
  }

  /**
   * v0.3.3: 读 `readerOpenMode` 设置 (设置页"打开阅读器方式"下拉框)。
   *
   * 单开一个方法而不是塞进 `loadReaderSettings`: 后者是 ReaderView 的
   * `settingsProvider`, 每次开书都要 await 一遍, 而打开方式只被
   * `openReader` 用一次。读失败 / 字段缺失一律 fallback `"tab"` ——
   * 这是**默认值也是 Obsidian 的标准行为**, 猜错的话用户会得到一个
   * 凭空弹出、抢焦点的窗口, 比"没生效"糟糕得多。
   */
  private async loadReaderOpenMode(): Promise<ReaderOpenMode> {
    try {
      const settings = await this.annotationStore.listSettings();
      return settings.readerOpenMode === "window" ? "window" : "tab";
    } catch {
      return "tab";
    }
  }

  private async handleProtocol(params: Record<string, string>): Promise<void> {
    const bookId = params.book ?? params.path;
    const excerptId = params.annotation;
    if (!bookId) return;
    const entry = this.library.get(bookId);
    if (!entry) {
      new Notice(`找不到书: ${bookId}`);
      return;
    }
    const isPdf = entry.book.locator.format === "pdf";
    try {
      // 先标记"在读"
      await this.withTimeout(this.reading.openBook(entry.book.id), 5000, "reading.openBook");
      // P0 修复: PDF 走 Obsidian 内置 viewer, 在 pdf leaf 里. 之前的 handleProtocol
      // 只查 READER_VIEW_TYPE leaf, 永远找不到 PDF, 调用 openExcerptById 时
      // fallback 到 "getLeavesOfType(READER_VIEW_TYPE)[0]" — 拿到完全不相干
      // 的另一本书的 reader leaf, 或者 undefined 静默失败. 用户从 vault 笔记点
      // "返回原文" link 跳 PDF 完全无效. 现在按 format 路由:
      //   - PDF  → 找已经挂载 PdfOverlay 的 pdf leaf, 调 overlay.jumpToExcerpt
      //   - 其他 → 找 reader leaf, 调 ReaderView.openExcerptById
      if (isPdf) {
        await this.openReader(entry);
        // 给 PDF++ / Obsidian PDFView 足够的初始化时间 — 大 PDF + 网络慢时
        // 视图 mount + first paint 可能要 5s+. waitForPdfOverlay 默认 3s, 给
        // PDF++ net::ERR_CONNECTION_CLOSED 这类 transient error 留恢复窗口.
        const overlay = await this.waitForPdfOverlay(entry.book.locator.path, 6000);
        if (overlay && excerptId) {
          await this.withTimeout(overlay.jumpToExcerpt(excerptId), 10000, "pdf.jumpToExcerpt");
        } else if (!overlay) {
          // Overlay 没挂上 — 这通常意味着 PdfOverlay 的 mount() throw 了
          // (PDF++ 接管后改 DOM,我们的 querySelector 选不到 .pdf-viewer).
          // P0 fallback: 直接用 Obsidian PDFView 的 URL hash 跳页 (#page=N).
          // 用户至少能跳到那一页, 而不是完全失败. Highlight 重画 / jump 退化为
          // 翻页, 但比"打开 PDF 不跳"已经好得多.
          const excerpt = await this.tryGetExcerpt(bookId, excerptId);
          if (excerpt && excerpt.locator.position.kind === "pdf") {
            await this.fallbackJumpPdfLeaf(entry.book.locator.path, excerpt.locator.position.page);
          } else {
            console.warn("[ez-reader] handleProtocol: PdfOverlay not found for", bookId);
          }
        }
        return;
      }
      // 非 PDF: 走原来的 ReaderView.openExcerptById 流程
      const existingLeaf = this.findReaderLeafForBook(bookId);
      if (existingLeaf && existingLeaf.view instanceof ReaderView) {
        if (excerptId) {
          await this.withTimeout(existingLeaf.view.openExcerptById(excerptId), 30000, "openExcerptById");
        }
        await this.app.workspace.revealLeaf(existingLeaf);
        this.app.workspace.setActiveLeaf(existingLeaf);
        return;
      }
      await this.withTimeout(this.openReader(entry), 8000, "openReader");
      if (excerptId) {
        // v0.3.3: 只认**这本书**的 leaf。之前的兜底
        // `?? getLeavesOfType(READER_VIEW_TYPE)[0]` 会抓一个完全不相干的
        // reader leaf —— 用户正开着 B 书, 点 A 书笔记里的"返回原文",
        // 旧代码会跳到 B 的 ReaderView 上, 然后 `openExcerptById` 拿
        // A 的 excerptId 去 B 的书库里查。查不到就静默什么都不做, 用户
        // 看到的是"点了没反应"; 万一撞上 id 相同(极低但非零), 就在
        // 错的书上跳。
        // v0.3.3 兜底: 认不出来就不跳, 而不是跳到错误的书。
        const leaf = this.findReaderLeafForBook(bookId);
        if (leaf?.view instanceof ReaderView) {
          await this.withTimeout(leaf.view.openExcerptById(excerptId), 30000, "openExcerptById");
        } else {
          console.warn("[ez-reader] handleProtocol: reader leaf for book not found", bookId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`无法打开笔记链接: ${message}`);
      console.error("[ez-reader] handleProtocol failed", { bookId, excerptId, error });
    }
  }

  /**
   * 等待 PdfOverlay 在指定 PDF 文件的 leaf 上 mount. PDF++ / Obsidian PDFView
   * 从 openLinkText 到 PdfOverlay 挂上, 中间要跑 view 创建 + PDF 渲染首帧
   * + extractCover 完成 + overlay.mount(), 异步, 大文件可能要 1-3 秒.
   * 重试 100ms 间隔直到找到或超时.
   */
  private async waitForPdfOverlay(bookPath: string, timeoutMs: number): Promise<import("./ui/reader/pdfOverlay").PdfOverlay | undefined> {
    const { findPdfOverlayForLeaf } = await import("./ui/reader/pdfOverlay");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
      for (const leaf of pdfLeaves) {
        const viewFile = (leaf.view as { file?: { path?: string } }).file;
        if (viewFile?.path !== bookPath) continue;
        const overlay = findPdfOverlayForLeaf(leaf);
        if (overlay) return overlay;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
    return undefined;
  }

  /** Fallback: overlay 没挂上时, 用 Obsidian PDFView 的 URL hash 跳页. */
  private async fallbackJumpPdfLeaf(bookPath: string, pageNumber: number): Promise<void> {
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
    for (const leaf of pdfLeaves) {
      const viewFile = (leaf.view as { file?: { path?: string } }).file;
      if (viewFile?.path !== bookPath) continue;
      // Obsidian PDFView 的 view 接受 setEphemeralState({ url }) 切 hash —
      // 但 pdf 类型 leaf 的 view 通常是 PDFView class. setEphemeralState 不一定
      // 存在, 试一下, 不存在就 warn.
      const view = leaf.view as { setEphemeralState?: (state: { url?: string }) => void };
      if (typeof view.setEphemeralState === "function") {
        try {
          view.setEphemeralState({ url: `#page=${pageNumber}` });
          return;
        } catch (error) {
          console.warn("[ez-reader] fallbackJumpPdfLeaf setEphemeralState failed", error);
        }
      }
      // 终极 fallback: 重新 openLinkText 带 hash (会触发 PDFView 内部跳页).
      try {
        await this.app.workspace.openLinkText(`${bookPath}#page=${pageNumber}`, "", false);
        return;
      } catch (error) {
        console.warn("[ez-reader] fallbackJumpPdfLeaf openLinkText failed", error);
      }
    }
  }

  /** Best-effort: 读 excerpt by id. 失败不影响主流程. */
  private async tryGetExcerpt(bookId: string, excerptId: string | undefined): Promise<Excerpt | undefined> {
    if (!excerptId) return undefined;
    try {
      const excerpts = await this.reading.listExcerpts(bookId);
      return excerpts.find((e) => e.id === excerptId);
    } catch {
      return undefined;
    }
  }

  private findReaderLeafForBook(bookId: string): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)) {
      const view = leaf.view;
      const viewBookId = view instanceof ReaderView ? view.getCurrentBookId() : undefined;
      const layoutState = leaf.getViewState()?.state;
      if (readerLeafMatchesBook(layoutState, viewBookId, bookId)) {
        return leaf;
      }
    }
    return null;
  }

  /** Race a promise against a deadline. Rejects with a friendly message on timeout. */
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = globalThis.setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms);
        })
      ]);
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  }

  /**
   * Adapter-level bridge from the BookReader port to the Obsidian Vault.
   * The renderer cannot `fetch()` an `obsidian://` URL, so we hand each
   * reader engine a function that resolves the file's bytes through the
   * Vault API instead.
   */
  private makeBookBytesLoader(): BookBytesLoader {
    return async (path: string): Promise<ArrayBuffer> => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        throw new Error(`Book file not found: ${path}`);
      }
      return this.app.vault.readBinary(file);
    };
  }

  private async openShelf(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SHELF_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: SHELF_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }


  private async openReader(entry: LibraryEntry): Promise<void> {
    // PDF 走 Obsidian 自带 PDFViewer — 通过 openLinkText 触发, 通常会被 PDF++
    // 这类增强插件接管。ez-reader 不再自己渲染 PDF (P1 之后)。
    if (entry.book.locator.format === "pdf") {
      await this.openInBuiltInViewer(entry);
      return;
    }
    // v0.3.3: 已经开着这本书就复用那个 leaf, 不要新开一个。之前无条件
    // `getLeaf("tab")`, 后果是: 用户书架上点第 5 次同一本书 → 标签页越开越多,
    // 每个都持有独立的 foliate iframe / PagedTextSession, 内存直接翻几倍,
    // 而且切到哪个 leaf 进度会互相打架 (各自 debounce 写同一个 bookId)。
    const reusable = this.findReaderLeafForBook(entry.book.id);
    if (reusable) {
      await this.app.workspace.revealLeaf(reusable);
      this.app.workspace.setActiveLeaf(reusable);
      return;
    }
    // EPUB 走 ez-reader 自己的 ReaderView
    //
    // v0.3.3: 真正读 `readerOpenMode` 设置了。之前 Plugin 硬编码
    // `getLeaf("tab")`, 设置里的"在新窗口中打开"是个纯装饰的下拉框。
    const mode = await this.loadReaderOpenMode();
    const leaf = this.app.workspace.getLeaf(mode === "window" ? "window" : "tab");
    await leaf.setViewState({
      type: READER_VIEW_TYPE,
      // 存 bookId 而不是 path —— 两者在 ObsidianBookSource.resolveId 里
      // 是同一个值 (resolveId(locator) => locator.path), 但 ReaderView
      // 是拿这个字段去 `library.get(...)` 查的, 语义上是 id, 写 path
      // 只是碰巧相等。
      state: { file: entry.book.id },
      active: true
    });
    const view = leaf.view;
    if (view instanceof ReaderView) {
      view.setEntry(entry);
    }
    // 把焦点切到 reader — 让键盘快捷键和划词立即可用
    this.app.workspace.setActiveLeaf(leaf);
  }

  /**
   * 用 Obsidian 自带 PDFViewer 打开 PDF — 通过 openLinkText 触发 Obsidian
   * 内置的 markdown/pdf 渲染器。这是 Obsidian自己处理 PDF 的方式, 稳定可靠。
   *
   * P4 起我们在 PDFView 上挂 PdfOverlay (选词菜单 / 笔记面板)。overlay
   * 不动 PDFView 自身, 只在它的 containerEl 里追加浮层元素。
   */
  private async openInBuiltInViewer(entry: LibraryEntry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.book.locator.path);
    if (!(file instanceof TFile)) {
      new Notice(`找不到文件: ${entry.book.locator.path}`);
      return;
    }
    await this.app.workspace.openLinkText(file.path, "", true);
    // 等一帧让 Obsidian 创建好 leaf + view
    await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    // 找最近的 PDFView leaf — openLinkText 已经把 active leaf 切到 PDF 上
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
    const target = pdfLeaves.find((leaf) => {
      const view = leaf.view as { file?: { path?: string } };
      return view.file?.path === file.path;
    }) ?? this.app.workspace.getMostRecentLeaf();
    if (!target) return;
    // 挂 overlay
    await this.attachOverlayToPdfLeafIfLibraryBook(target);
  }

  /**
   * 给已存在的 PDF leaf 挂 overlay, 当且仅当:
   *   1. 该 leaf 还没挂过 (WeakMap ATTACHED 查不到)
   *   2. 该 leaf 里的 PDF 文件路径在书架里 (LibraryService.list() 能找到)
   *
   * 第二条故意收窄 — 我们不想让插件给 vault 里每一个随机 PDF 都塞选词菜单 /
   * 翻译弹窗 / 笔记侧栏按钮, 用户的心智模型是「EzReader 只管书架里的书」。
   * 想读 vault 里的其他 PDF, 先加到书架再开。
   *
   * 三处 caller 共用:
   *   1. `openInBuiltInViewer` — 从书架打开
   *   2. `attachOverlaysToOpenLibraryPdfs` — onLayoutReady 时扫一遍已打开 leaf
   *   3. `active-leaf-change` listener — 用户从书架外点开 PDF 时兜底
   */
  private async attachOverlayToPdfLeafIfLibraryBook(leaf: WorkspaceLeaf): Promise<void> {
    const { findPdfOverlayForLeaf, PdfOverlay } = await import("./ui/reader/pdfOverlay");
    if (findPdfOverlayForLeaf(leaf)) return;
    const view = leaf.view as { file?: { path?: string } };
    const filePath = view.file?.path;
    if (!filePath) return;
    const entry = this.library.list().find((e) => e.book.locator.path === filePath);
    if (!entry) return;
    try {
      const overlay = new PdfOverlay({
        app: this.app,
        pdfLeaf: leaf,
        bookPath: filePath,
        reading: this.reading,
        translation: this.translation,
        library: this.library,
        noteWriter: this.noteWriter
      });
      await overlay.resolveBook();
      overlay.mount();
    } catch (error) {
      console.warn("[ez-reader] failed to attach PdfOverlay", error);
    }
  }

  /**
   * 扫描当前 workspace 里所有 PDF leaf, 给书架里的 PDF 补挂 overlay.
   * 主要场景: Obsidian 重启后自动恢复上次打开的 PDF leaf, 但 overlay 没存
   * 盘, 只能重建.
   */
  private async attachOverlaysToOpenLibraryPdfs(): Promise<void> {
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
    for (const leaf of pdfLeaves) {
      await this.attachOverlayToPdfLeafIfLibraryBook(leaf);
    }
  }

  /** Removed openPicker — 跟"打开个人图书馆"功能重叠, ribbon 上不需要第二个入口. */

  /**
   * v0.3.0: 一次性迁移老 `notesDirectory/` → 新 `<vault>/ezreader/notes/`
   * 布局。跑过一次后写 `migratedToV030 = true`,后续启动跳过。
   *
   * P1 修复两点:
   *
   * 1. 标志写错层。旧代码用 `patchSettings` 写,落在 `settings.migratedToV030`,
   *    而 `load()` 读的是顶层 `migratedToV030` — 守卫永远不触发,老笔记
   *    迁移**每次启动都重跑一遍**(重新 list + read 整个老目录)。现在走
   *    `setMigratedToV030`,写在顶层。
   *
   * 2. 失败也写标志。旧代码在 catch 里也写 `true`,理由是"避免重试风暴",
   *    但对 Syncthing 用户这是错的:新设备上老目录可能还没同步下来,
   *    此时迁移静默跳过并被永久标记为完成,老笔记从此再也搬不过去。
   *    现在失败时保持 `false` 并计数重试,最多 {@link MIGRATION_MAX_ATTEMPTS}
   *    次 —— 既能等到同步完成,又不会对着一个永远不存在的目录无限重扫。
   *
   * 为什么不删老目录:留给用户 review。LibraryWriter.migrateLegacyNotes
   * 只把 `.md` 文件搬走,空目录用户可以自己 `rm -r`。
   */
  private async runV030Migration(): Promise<void> {
    try {
      const snapshot = await this.annotationStore.load();
      if (snapshot.migratedToV030 === true) return;
      const attempts = snapshot.migratedToV030Attempts ?? 0;
      if (attempts >= MIGRATION_MAX_ATTEMPTS) {
        if (attempts === MIGRATION_MAX_ATTEMPTS) {
          new Notice(
            `EzReader 迁移已重试 ${attempts} 次仍未完成,已停止重试。老笔记仍在 ` +
              `${snapshot.settings.notesDirectory?.trim() || "ezreader-notes/阅读笔记"},` +
              "可手动移动到 ezreader/notes/,或把 data.json 的 migratedToV030Attempts 归零后重启。"
          );
          // 记到上限,避免每次启动都再弹一次
          await this.annotationStore.setMigratedToV030(false, MIGRATION_MAX_ATTEMPTS + 1);
        }
        return;
      }
      // 老 settings.notesDirectory 没值就 fallback 到 hardcoded 默认值
      // (v0.2.x 的 `DEFAULT_PLUGIN_SETTINGS.notesDirectory`)。
      const legacyDir = snapshot.settings.notesDirectory?.trim() || "ezreader-notes/阅读笔记";
      const result = await this.noteWriter.migrateLegacyNotes({ legacyNotesDir: legacyDir });
      const clean = result.failedNotes === 0;
      if (result.migratedNotes > 0 || result.failedNotes > 0) {
        new Notice(
          `EzReader 0.3.0 迁移: ${result.migratedNotes} 个笔记搬到 ezreader/notes/${
            result.failedNotes > 0 ? `,${result.failedNotes} 个失败(将在下次启动重试)` : ""
          }`
        );
      }
      // 清空老字段(避免用户后续调试时困惑);标志写在顶层。
      await this.annotationStore.patchSettings((s) => ({ ...s, notesDirectory: "" }));
      await this.annotationStore.setMigratedToV030(clean, attempts + 1);
      console.info(
        `[ez-reader] v0.3.0 migration attempt ${attempts + 1}: ${result.migratedNotes} migrated, ${result.failedNotes} failed`
      );
    } catch (error) {
      console.warn("[ez-reader] v0.3.0 migration failed", error);
      // 失败保持 migratedToV030 = false,下次启动重试(有次数上限)。
      try {
        const snapshot = await this.annotationStore.load();
        await this.annotationStore.setMigratedToV030(false, (snapshot.migratedToV030Attempts ?? 0) + 1);
      } catch (innerError) {
        console.warn("[ez-reader] could not persist migratedToV030 flag", innerError);
      }
    }
  }

  /**
   * Mirrors `enableAllBookFormatsInFileExplorer` from the upstream plugin:
   * turns on Obsidian's "Detect all file extensions" so `vault.getFiles()`
   * returns PDF and EPUB files. Without this, those file types are hidden
   * from the file explorer and excluded from scans.
   */
  private async enableAllBookFormatsInFileExplorer(): Promise<void> {
    const vaultWithConfig = this.app.vault as typeof this.app.vault & {
      getConfig?: (key: string) => unknown;
      setConfig?: (key: string, value: boolean) => Promise<void> | void;
    };
    // 记下用户原本的值, onunload 时恢复
    const previous = vaultWithConfig.getConfig?.("showUnsupportedFiles");
    this.__ezReaderPreviousShowUnsupported = typeof previous === "boolean" ? previous : undefined;
    if (previous === true) return;
    try {
      await vaultWithConfig.setConfig?.("showUnsupportedFiles", true);
    } catch (error) {
      console.warn("[ez-reader] could not enable showUnsupportedFiles; scans may miss PDF/EPUB", error);
    }
  }
}