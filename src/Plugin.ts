import { Plugin, TFile } from "obsidian";
import type { App } from "obsidian";
import { CoverCache } from "./adapters/obsidian/CoverCache";
import { ObsidianAnnotationStore } from "./adapters/obsidian/ObsidianAnnotationStore";
import { ObsidianBookSource } from "./adapters/obsidian/ObsidianBookSource";
import { FoliateBookReader } from "./adapters/foliate/FoliateBookReader";
import { PdfjsBookReader } from "./adapters/pdfjs/PdfjsBookReader";
import { GoogleTranslationProvider } from "./adapters/translation/GoogleTranslationProvider";
import { LibraryService } from "./core/services/LibraryService";
import { ReadingService } from "./core/services/ReadingService";
import { TranslationCoordinator } from "./core/services/TranslationService";
import type { LibraryEntry } from "./core/services/LibraryService";
import type { BookBytesLoader, BookReader } from "./core/ports/BookReader";
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

  async onload(): Promise<void> {
    this.bookSource = new ObsidianBookSource(this.app);
    this.annotationStore = new ObsidianAnnotationStore(this);
    // Local Book Reader upstream opens Obsidian's "Detect all file
    // extensions" setting so `vault.getFiles()` returns PDF/EPUB alongside
    // markdown. We do the same before initializing the library.
    await this.enableAllBookFormatsInFileExplorer();
    this.library = new LibraryService(this.bookSource, this.annotationStore);
    this.reading = new ReadingService(this.annotationStore);
    this.translation = new TranslationCoordinator(this.annotationStore, [new GoogleTranslationProvider()]);
    this.foliate = new FoliateBookReader();
    this.pdfjs = new PdfjsBookReader();
    this.covers = new CoverCache(this.app, this, this.library, this.foliate, this.pdfjs);

    // Obsidian loads files asynchronously. `vault.getFiles()` returns an
    // empty list until the layout is ready and the initial vault scan has
    // finished. Wait for that moment before doing the first library scan,
    // matching the upstream plugin's pattern.
    this.app.workspace.onLayoutReady(() => {
      void this.library.initialize();
      void this.covers.hydrateCovers();
    });

    this.addSettingTab(new SettingsTab(this.app, this, this.annotationStore));

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
  }

  onunload(): void {
    this.library?.dispose();
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
      bookBytesLoader: this.makeBookBytesLoader(),
      onBookOpened: (entry) => void this.covers.ensureCoverFor(entry.book, this.makeBookBytesLoader())
    };
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
    if (vaultWithConfig.getConfig?.("showUnsupportedFiles") === true) return;
    try {
      await vaultWithConfig.setConfig?.("showUnsupportedFiles", true);
    } catch (error) {
      console.warn("[ez-reader] could not enable showUnsupportedFiles; scans may miss PDF/EPUB", error);
    }
  }
}