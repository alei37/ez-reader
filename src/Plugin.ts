import { Plugin, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { CoverCache } from "./adapters/obsidian/CoverCache";
import { ObsidianAnnotationStore } from "./adapters/obsidian/ObsidianAnnotationStore";
import { ObsidianBookSource } from "./adapters/obsidian/ObsidianBookSource";
import { ObsidianNoteWriter } from "./adapters/obsidian/ObsidianNoteWriter";
import { FoliateBookReader } from "./adapters/foliate/FoliateBookReader";
import { PdfjsBookReader } from "./adapters/pdfjs/PdfjsBookReader";
import { GoogleTranslationProvider } from "./adapters/translation/GoogleTranslationProvider";
import { YoudaoTranslationProvider } from "./adapters/translation/YoudaoTranslationProvider";
import { DeeplTranslationProvider } from "./adapters/translation/DeeplTranslationProvider";
import { LibraryService } from "./core/services/LibraryService";
import { ReadingService } from "./core/services/ReadingService";
import { TranslationCoordinator } from "./core/services/TranslationService";
import type { LibraryEntry } from "./core/services/LibraryService";
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
  private pdfjs!: BookReader;
  private covers!: CoverCache;
  private noteWriter!: NoteWriter;

  async onload(): Promise<void> {
    this.bookSource = new ObsidianBookSource(this.app);
    this.annotationStore = new ObsidianAnnotationStore(this);
    // Local Book Reader upstream opens Obsidian's "Detect all file
    // extensions" setting so `vault.getFiles()` returns PDF/EPUB alongside
    // markdown. We do the same before initializing the library.
    await this.enableAllBookFormatsInFileExplorer();
    this.library = new LibraryService(this.bookSource, this.annotationStore);
    this.reading = new ReadingService(this.annotationStore);
    this.translation = new TranslationCoordinator(this.annotationStore, [
      new YoudaoTranslationProvider(),
      new DeeplTranslationProvider(),
      new GoogleTranslationProvider()
    ]);
    this.foliate = new FoliateBookReader();
    this.pdfjs = new PdfjsBookReader();
    this.covers = new CoverCache(this.app, this, this.library, this.foliate, this.pdfjs, this.annotationStore);
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
    this.addRibbonIcon("book-open", "从书库打开电子书", () => {
      void this.openPicker();
    });

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
    const previous = (this as unknown as { __ezReaderPreviousShowUnsupported?: unknown }).__ezReaderPreviousShowUnsupported;
    if (typeof previous === "boolean") {
      const vault = this.app.vault as typeof this.app.vault & {
        setConfig?: (key: string, value: boolean) => Promise<void> | void;
      };
      void vault.setConfig?.("showUnsupportedFiles", previous);
    }
  }

  private deps(): ConstructorParameters<typeof ShelfView>[1] {
    return {
      app: this.app,
      library: this.library,
      reading: this.reading,
      foliate: this.foliate,
      pdfjs: this.pdfjs,
      openReader: (entry: LibraryEntry) => this.openReader(entry),
      covers: this.covers,
      bookBytesLoader: this.makeBookBytesLoader()
    };
  }

  private readerDeps(): ConstructorParameters<typeof ReaderView>[1] {
    return {
      app: this.app,
      reading: this.reading,
      foliate: this.foliate,
      pdfjs: this.pdfjs,
      translation: this.translation,
      noteWriter: this.noteWriter,
      bookBytesLoader: this.makeBookBytesLoader(),
      settingsProvider: () => this.loadReaderSettings(),
      onBookOpened: (entry) => void this.covers.ensureCoverFor(entry.book, this.makeBookBytesLoader())
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
      const { Notice } = await import("obsidian");
      new Notice(`找不到书: ${bookId}`);
      return;
    }
    try {
      // 找现有的 reader leaf 装同一本书 — 如果有就复用, 不开新 tab
      const existingLeaf = this.findReaderLeafForBook(bookId);
      if (existingLeaf && existingLeaf.view instanceof ReaderView) {
        // 同步 ShelfView.openBook 的行为: 先标记"在读"
        await this.withTimeout(this.reading.openBook(entry.book.id), 5000, "reading.openBook");
        if (excerptId) {
          await this.withTimeout(existingLeaf.view.openExcerptById(excerptId), 30000, "openExcerptById");
        }
        this.app.workspace.revealLeaf(existingLeaf);
        this.app.workspace.setActiveLeaf(existingLeaf);
        return;
      }
      // 同步 ShelfView.openBook 的行为: 先标记"在读"
      await this.withTimeout(this.reading.openBook(entry.book.id), 5000, "reading.openBook");
      await this.withTimeout(this.openReader(entry), 8000, "openReader");
      if (excerptId) {
        // openExcerptById 内部 whenReady() 会等 session 就绪(最多 30s),
        // 不再用固定 setTimeout,避免大 PDF 时序竞争
        const leaf = this.findReaderLeafForBook(bookId) ?? this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)[0];
        if (leaf?.view instanceof ReaderView) {
          await this.withTimeout(leaf.view.openExcerptById(excerptId), 30000, "openExcerptById");
        }
      }
    } catch (error) {
      const { Notice } = await import("obsidian");
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`无法打开笔记链接: ${message}`);
      console.error("[ez-reader] handleProtocol failed", { bookId, excerptId, error });
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
    // PDF 走 Obsidian 自带 PDFViewer — 自己写 PDF.js 渲染搞不定排版/分页/字体 hinting
    // 等问题, 反正 Obsidian 自己的 PDFViewer 已经在 Electron 里调通了
    if (entry.book.locator.format === "pdf") {
      await this.openInBuiltInViewer(entry);
      return;
    }
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
   * 内置的 markdown/pdf 渲染器。这是 Obsidian 自己处理 PDF 的方式, 稳定可靠。
   *
   * 代价: 失去我们自定义的 PDF 阅读功能 (高亮/批注/翻译/侧栏笔记)。
   * 但 PDF 自带 viewer 在 Obsidian 内部已经调通, 远比我们重写一个稳定。
   * 后续如果需要 PDF 上的批注, 可以参考 PDF++ 的做法: hook Obsidian 的
   * MarkdownPostProcessor "pdf" 类型, 在 PDFViewer 上叠 layer。
   */
  private async openInBuiltInViewer(entry: LibraryEntry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.book.locator.path);
    if (!(file instanceof TFile)) {
      const { Notice } = await import("obsidian");
      new Notice(`找不到文件: ${entry.book.locator.path}`);
      return;
    }
    // openLinkText 第三个参数 newLeaf 决定是否开新 leaf — 传 false 复用当前激活的,
    // 传 true 强制新 tab。我们传 false 让 Obsidian 自己判断 (通常新 tab)。
    await this.app.workspace.openLinkText(file.path, "", false);
  }

  private async openPicker(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
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
    (this as unknown as { __ezReaderPreviousShowUnsupported?: unknown }).__ezReaderPreviousShowUnsupported = previous;
    if (previous === true) return;
    try {
      await vaultWithConfig.setConfig?.("showUnsupportedFiles", true);
    } catch (error) {
      console.warn("[ez-reader] could not enable showUnsupportedFiles; scans may miss PDF/EPUB", error);
    }
  }
}