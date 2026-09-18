import { Notice, Plugin, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { CoverCache } from "./adapters/obsidian/CoverCache";
import { ObsidianAnnotationStore } from "./adapters/obsidian/ObsidianAnnotationStore";
import { ObsidianBookSource } from "./adapters/obsidian/ObsidianBookSource";
import { ObsidianNoteWriter } from "./adapters/obsidian/ObsidianNoteWriter";
import { FoliateBookReader } from "./adapters/foliate/FoliateBookReader";
import { TxtBookReader } from "./adapters/text/TxtBookReader";
import { MobiBookReader } from "./adapters/text/MobiBookReader";
import { PdfCoverExtractor } from "./adapters/obsidian/PdfCoverExtractor";
import { GoogleTranslationProvider } from "./adapters/translation/GoogleTranslationProvider";
import { YoudaoTranslationProvider } from "./adapters/translation/YoudaoTranslationProvider";
import { DeeplTranslationProvider } from "./adapters/translation/DeeplTranslationProvider";
import { LibraryService } from "./core/services/LibraryService";
import { ReadingService } from "./core/services/ReadingService";
import { TranslationCoordinator } from "./core/services/TranslationService";
import type { LibraryEntry } from "./core/services/LibraryService";
import type { Excerpt } from "./core/entities/Excerpt";
import type { BookBytesLoader, BookReader } from "./core/ports/BookReader";
import type { NoteWriter } from "./core/ports/NoteWriter";
import type {
  KeyboardShortcuts,
  ReaderAppearance
} from "./core/types/ReaderSettings";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_READER_APPEARANCE
} from "./core/types/ReaderSettings";
import type { Locale } from "./core/types/Locale";
import { ShelfView, SHELF_VIEW_TYPE } from "./ui/shelf/ShelfView";
import { READER_VIEW_TYPE, ReaderView } from "./ui/reader/ReaderView";
import { SettingsTab } from "./ui/settings/SettingsTab";

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
  private noteWriter!: NoteWriter;
  /**
   * Cached value of the user's original `showUnsupportedFiles` setting,
   * so onunload can restore it. Stored as a private field instead of
   * pinned to `this` via cast to keep the type contract honest.
   */
  private __ezReaderPreviousShowUnsupported: boolean | undefined;

  async onload(): Promise<void> {
    this.bookSource = new ObsidianBookSource(this.app);
    this.annotationStore = new ObsidianAnnotationStore(this);
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
      this.makeBookBytesLoader()
    );
    this.reading = new ReadingService(
      this.annotationStore,
      // 同步 LibraryService.entries + emit shelf refresh, 否则 reader 翻页
      // 写完 data.json 后 shelf 仍然显示旧进度, 关闭 → 重开 reader 也不
      // resume (entry.reading 是 library.entries 的旧快照).
      (state) => this.library.updateReading(state)
    );
    this.translation = new TranslationCoordinator(this.annotationStore, [
      new YoudaoTranslationProvider(),
      new DeeplTranslationProvider(),
      new GoogleTranslationProvider()
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
    this.noteWriter = new ObsidianNoteWriter(this.app, this, this.annotationStore);

    // Obsidian loads files asynchronously. `vault.getFiles()` returns an
    // empty list until the layout is ready and the initial vault scan has
    // finished. Wait for that moment before doing the first library scan,
    // matching the upstream plugin's pattern.
    this.app.workspace.onLayoutReady(async () => {
      await this.library.initialize();
      // Cover hydration must run after the library has populated its
      // entries — slug → bookId mapping needs them to exist.
      await this.covers.hydrateCovers();
    });

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
        this.app.workspace.revealLeaf(existingLeaf);
        this.app.workspace.setActiveLeaf(existingLeaf);
        return;
      }
      await this.withTimeout(this.openReader(entry), 8000, "openReader");
      if (excerptId) {
        const leaf = this.findReaderLeafForBook(bookId) ?? this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)[0];
        if (leaf?.view instanceof ReaderView) {
          await this.withTimeout(leaf.view.openExcerptById(excerptId), 30000, "openExcerptById");
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
      const state = leaf.getViewState();
      if (state.state && (state.state as { file?: unknown }).file === bookId) {
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
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: SHELF_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }


  private async openReader(entry: LibraryEntry): Promise<void> {
    // PDF 走 Obsidian 自带 PDFViewer — 通过 openLinkText 触发, 通常会被 PDF++
    // 这类增强插件接管。ez-reader 不再自己渲染 PDF (P1 之后)。
    if (entry.book.locator.format === "pdf") {
      await this.openInBuiltInViewer(entry);
      return;
    }
    // EPUB 走 ez-reader 自己的 ReaderView
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: READER_VIEW_TYPE,
      state: { file: entry.book.locator.path },
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
    try {
      const { PdfOverlay } = await import("./ui/reader/pdfOverlay");
      const overlay = new PdfOverlay({
        app: this.app,
        pdfLeaf: target,
        bookPath: entry.book.locator.path,
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

  /** Removed openPicker — 跟"打开个人图书馆"功能重叠, ribbon 上不需要第二个入口. */

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