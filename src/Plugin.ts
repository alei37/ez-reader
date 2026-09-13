import { Plugin, TFile } from "obsidian";
import type { App } from "obsidian";
import { ObsidianAnnotationStore } from "./adapters/obsidian/ObsidianAnnotationStore";
import { ObsidianBookSource } from "./adapters/obsidian/ObsidianBookSource";
import { FoliateBookReader } from "./adapters/foliate/FoliateBookReader";
import { PdfjsBookReader } from "./adapters/pdfjs/PdfjsBookReader";
import { GoogleTranslationProvider } from "./adapters/translation/GoogleTranslationProvider";
import { LibraryService } from "./core/services/LibraryService";
import { ReadingService } from "./core/services/ReadingService";
import { TranslationCoordinator } from "./core/services/TranslationService";
import type { LibraryEntry } from "./core/services/LibraryService";
import type { BookReader } from "./core/ports/BookReader";
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

    await this.library.initialize();

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
      openReader: (entry: LibraryEntry) => this.openReader(entry)
    };
  }

  private readerDeps(): ConstructorParameters<typeof ReaderView>[1] {
    return {
      app: this.app,
      reading: this.reading,
      foliate: this.foliate,
      pdfjs: this.pdfjs,
      translation: this.translation
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