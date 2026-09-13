import { ItemView, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { Bookmark } from "../../core/entities/Bookmark";
import type { Book } from "../../core/entities/Book";
import type { Excerpt } from "../../core/entities/Excerpt";
import type { ReadingPosition } from "../../core/entities/ReadingState";
import type { BookReader, ReaderSession } from "../../core/ports/BookReader";
import type { LibraryEntry } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import { BookmarkModal } from "./BookmarkModal";
import { BookmarksPanel } from "./BookmarksPanel";
import { ExcerptModal } from "./ExcerptModal";
import { ExcerptsPanel } from "./ExcerptsPanel";
import { ReaderSelectionMenu } from "./ReaderSelectionMenu";
import { ReaderToolbar } from "./ReaderToolbar";
import { TranslationModal } from "./TranslationModal";
import { DEFAULT_READER_APPEARANCE } from "../../core/types/ReaderSettings";
import type { BookBytesLoader } from "../../core/ports/BookReader";
import type { TranslationService } from "../../core/ports/TranslationProvider";

export const READER_VIEW_TYPE = "ez-reader-view";

interface ReaderViewDeps {
  readonly app: App;
  readonly reading: ReadingService;
  readonly foliate: BookReader;
  readonly pdfjs: BookReader;
  readonly translation: TranslationService;
  readonly bookBytesLoader: BookBytesLoader;
  readonly onBookOpened?: (entry: LibraryEntry) => void;
}

interface ActiveSelection {
  text: string;
  rect: DOMRect;
}

/**
 * ItemView that holds one reader session. The session lives for the
 * lifetime of the leaf; switching books closes the old session and opens
 * a new one.
 */
export class ReaderView extends ItemView {
  private readonly deps: ReaderViewDeps;
  private entry: LibraryEntry | undefined;
  private session: ReaderSession | undefined;
  private host: HTMLElement | undefined;
  private toolbar: ReaderToolbar | undefined;
  private bookmarksPanel: BookmarksPanel | undefined;
  private excerptsPanel: ExcerptsPanel | undefined;
  private selectionMenu: ReaderSelectionMenu | undefined;
  private showingBookmarks = false;
  private showingExcerpts = false;
  private fraction = 0;
  private chapter = "";
  private pendingSelection: ActiveSelection | undefined;

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
        onZoomReset: () => void this.zoomReset()
      },
      {
        fraction: 0,
        chapter: "",
        status: this.entry?.reading.status ?? "unread",
        showingBookmarks: false,
        showingExcerpts: false
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

    this.selectionMenu = new ReaderSelectionMenu({
      onExcerpt: () => void this.saveExcerptFromSelection(),
      onCopy: () => this.copySelectionToClipboard(),
      onTranslate: () => this.requestTranslation()
    });

    this.host = container.createDiv({ cls: "ez-reader__reader__stage" });
    this.bindSwipeGestures();
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

  /**
   * Bind swipe gestures on the reader stage. Horizontal swipes flip pages;
   * the threshold is conservative so accidental taps while selecting text
   * never trigger a page change. We attach to `this.host` once, but the
   * `once: true` listener is removed in onClose via `this.register(...)`.
   */
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

  setEntry(entry: LibraryEntry): void {
    this.entry = entry;
    if (this.host) {
      void this.openSession();
    }
  }

  private get isPdf(): boolean {
    return this.entry?.book.locator.format === "pdf";
  }

  private async zoomIn(): Promise<void> {
    if (!this.session?.setScale) return;
    const current = this.session.currentScale?.() ?? 1.5;
    await this.session.setScale(current * 1.25);
  }

  private async zoomOut(): Promise<void> {
    if (!this.session?.setScale) return;
    const current = this.session.currentScale?.() ?? 1.5;
    await this.session.setScale(current / 1.25);
  }

  private async zoomReset(): Promise<void> {
    if (!this.session?.setFitWidth) return;
    await this.session.setFitWidth();
  }

  private async openSession(): Promise<void> {
    if (!this.entry || !this.host) return;
    const book = this.entry.book;
    const engine = this.bookReaderFor(book);
    this.session = await engine.open(book, this.host, DEFAULT_READER_APPEARANCE, this.deps.bookBytesLoader);
    this.deps.onBookOpened?.(this.entry);

    const fraction = await this.session.currentFraction();
    this.fraction = fraction;
    this.toolbar?.update(this.toolbarState());

    const offRelocate = this.session.on("relocate", (event) => {
      const detail = (event as CustomEvent<{ fraction?: number; tocItem?: { label?: string } }>).detail;
      if (typeof detail?.fraction === "number") {
        this.fraction = detail.fraction;
        this.chapter = typeof detail.tocItem?.label === "string" ? detail.tocItem.label : "";
        this.toolbar?.update(this.toolbarState());
        void this.persistProgress(detail.fraction);
      }
    });

    const offSelect = this.session.on("selection-change", (event) => {
      const detail = (event as CustomEvent<{ text: string; locator?: string }>).detail;
      if (!detail?.text) {
        this.selectionMenu?.hide();
        return;
      }
      const range = window.getSelection()?.getRangeAt(0);
      const rect = range?.getBoundingClientRect() ?? null;
      if (!rect) return;
      this.pendingSelection = { text: detail.text, rect };
      this.selectionMenu?.show(rect);
    });

    const disposeOn = () => {
      offRelocate();
      offSelect();
    };
    this.register(disposeOn);
  }

  private toolbarState(): Parameters<NonNullable<typeof this.toolbar>["update"]>[0] {
    return {
      fraction: this.fraction,
      chapter: this.chapter,
      status: this.entry?.reading.status ?? "unread",
      showingBookmarks: this.showingBookmarks,
      showingExcerpts: this.showingExcerpts
    };
  }

  private bookReaderFor(book: Book): BookReader {
    return book.locator.format === "pdf" ? this.deps.pdfjs : this.deps.foliate;
  }

  private async goToNext(direction: -1 | 1): Promise<void> {
    if (!this.session) return;
    await this.session.goTo(direction === 1 ? { kind: "next" } : { kind: "previous" });
  }

  private async seekFraction(fraction: number): Promise<void> {
    if (!this.session) return;
    await this.session.goTo({ kind: "fraction", fraction });
  }

  private async persistProgress(fraction: number): Promise<void> {
    if (!this.entry) return;
    const locator = await this.session?.exportLocator();
    const position: ReadingPosition = locator
      ? { kind: "reflow", fraction, cfi: locator }
      : { kind: "reflow", fraction };
    await this.deps.reading.updatePosition(this.entry.book.id, position);
  }

  private async addBookmarkAtCurrentPosition(): Promise<void> {
    if (!this.entry) return;
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
    this.showingBookmarks = !this.showingBookmarks;
    if (this.showingBookmarks) {
      this.bookmarksPanel.show();
      await this.refreshPanels();
    } else {
      this.bookmarksPanel.hide();
    }
    this.toolbar?.update(this.toolbarState());
  }

  private async toggleExcerpts(): Promise<void> {
    if (!this.excerptsPanel) return;
    this.showingExcerpts = !this.showingExcerpts;
    if (this.showingExcerpts) {
      this.excerptsPanel.show();
      await this.refreshPanels();
    } else {
      this.excerptsPanel.hide();
    }
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
    if (excerpt.locator.position.kind === "reflow" && excerpt.locator.position.cfi) {
      await this.session.goTo({ kind: "identifier", value: excerpt.locator.position.cfi });
    }
  }

  private async removeExcerpt(excerpt: Excerpt): Promise<void> {
    if (!this.entry) return;
    await this.deps.reading.removeExcerpt(this.entry.book.id, excerpt.id);
    await this.refreshPanels();
  }

  private async saveExcerptFromSelection(): Promise<void> {
    if (!this.entry || !this.pendingSelection) return;
    const locator = await this.session?.exportLocator();
    if (!locator) return;
    const modal = new ExcerptModal(this.deps.app, { text: this.pendingSelection.text });
    const submit = await modal.openAndWait();
    if (!submit) return;
    await this.deps.reading.addExcerpt({
      id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bookId: this.entry.book.id,
      text: this.pendingSelection.text,
      locator: { position: { kind: "reflow", fraction: this.fraction, cfi: locator }, chapter: this.chapter },
      note: submit.note,
      tags: submit.tags,
      createdAt: Date.now()
    });
    await this.refreshPanels();
  }

  private copySelectionToClipboard(): void {
    const selection = this.pendingSelection?.text;
    if (!selection) return;
    void navigator.clipboard.writeText(selection);
  }

  private requestTranslation(): void {
    if (!this.entry || !this.pendingSelection) return;
    const modal = new TranslationModal(this.deps.app, this.deps.translation, {
      text: this.pendingSelection.text,
      source: "auto",
      target: "en"
    });
    modal.open();
  }
}