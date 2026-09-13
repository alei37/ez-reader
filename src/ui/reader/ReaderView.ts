import { ItemView, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { BookReader, ReaderSession } from "../../core/ports/BookReader";
import type { LibraryEntry } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import { DEFAULT_READER_APPEARANCE } from "../../core/types/ReaderSettings";

export const READER_VIEW_TYPE = "ez-reader-view";

interface ReaderViewDeps {
  readonly app: App;
  readonly reading: ReadingService;
  readonly foliate: BookReader;
  readonly pdfjs: BookReader;
}

export class ReaderView extends ItemView {
  private readonly deps: ReaderViewDeps;
  private entry: LibraryEntry | undefined;
  private session: ReaderSession | undefined;
  private host: HTMLElement | undefined;

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
    this.host = container.createDiv({ cls: "ez-reader__reader__stage" });
    if (this.entry) {
      await this.openSession();
    }
  }

  async onClose(): Promise<void> {
    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }
    this.host = undefined;
  }

  /** Wire a new entry into the view; open the session once the leaf is ready. */
  setEntry(entry: LibraryEntry): void {
    this.entry = entry;
    if (this.host) {
      void this.openSession();
    }
  }

  private async openSession(): Promise<void> {
    if (!this.entry || !this.host) return;
    const engine = this.entry.book.locator.format === "pdf" ? this.deps.pdfjs : this.deps.foliate;
    this.session = await engine.open(this.entry.book, this.host, DEFAULT_READER_APPEARANCE);
  }
}