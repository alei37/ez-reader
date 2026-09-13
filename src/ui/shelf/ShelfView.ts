import { ItemView, WorkspaceLeaf, TFile, Menu } from "obsidian";
import type { App } from "obsidian";
import type { LibraryEntry, LibraryService } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import type { BookReader, ReaderSession } from "../../core/ports/BookReader";
import { DEFAULT_SORT, emptyFilter, type ShelfFilter, type SortCriterion } from "../../core/types/ShelfFilter";
import { AddToLibraryModal } from "./AddToLibraryModal";
import { ShelfFiltersModal } from "./ShelfFilters";
import { ShelfToolbar, type ViewMode } from "./ShelfToolbar";
import { renderGridItem } from "./ShelfGridItem";
import { renderListItem } from "./ShelfListItem";

export const SHELF_VIEW_TYPE = "ez-reader-shelf";

interface ShelfViewDeps {
  readonly app: App;
  readonly library: LibraryService;
  readonly reading: ReadingService;
  readonly foliate: BookReader;
  readonly pdfjs: BookReader;
  readonly openReader: (entry: LibraryEntry) => Promise<void>;
}

export class ShelfView extends ItemView {
  private readonly deps: ShelfViewDeps;
  private toolbar!: ShelfToolbar;
  private body!: HTMLElement;
  private emptyState!: HTMLElement;
  private mode: ViewMode = "grid";
  private filter: ShelfFilter = emptyFilter();
  private sort: SortCriterion = DEFAULT_SORT;
  private unsubscribe: (() => void) | undefined;
  private activeSession: ReaderSession | undefined;
  private promptedForFirstImport = false;

  constructor(leaf: WorkspaceLeaf, deps: ShelfViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return SHELF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "个人图书馆";
  }

  getIcon(): string {
    return "library";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ez-reader__shelf");

    this.toolbar = new ShelfToolbar(
      {
        onQueryChange: (query) => {
          this.filter = { ...this.filter, query };
          this.refresh();
        },
        onFilterOpen: () => this.openFilters(),
        onViewModeChange: (mode) => {
          this.mode = mode;
          this.refresh();
        },
        onSortChange: (sort) => {
          this.sort = sort;
          this.refresh();
        },
        onAddToLibrary: () => this.openAddToLibrary()
      },
      this.toolbarState()
    );
    container.append(this.toolbar.root);

    this.body = container.createDiv({ cls: "ez-reader__shelf__body" });
    this.emptyState = container.createDiv({ cls: "ez-reader__shelf__empty" });

    this.unsubscribe = this.deps.library.subscribe(() => this.refresh());
    this.refresh();
    this.maybePromptForFirstImport();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.activeSession) {
      await this.activeSession.close();
      this.activeSession = undefined;
    }
  }

  private toolbarState(): Parameters<ShelfToolbar["update"]>[0] {
    const stats = this.deps.library.stats();
    const visible = this.deps.library.list(this.filter, this.sort).length;
    return {
      mode: this.mode,
      filter: this.filter,
      sort: this.sort,
      totalCount: stats.inLibrary,
      visibleCount: visible,
      availableCount: stats.total - stats.inLibrary
    };
  }

  private refresh(): void {
    const entries = this.deps.library.list(this.filter, this.sort);
    this.body.empty();
    this.body.removeClass("is-grid", "is-list");
    this.body.addClass(this.mode === "grid" ? "is-grid" : "is-list");

    if (entries.length === 0) {
      this.renderEmptyState();
    } else {
      this.emptyState.addClass("is-hidden");
      for (const entry of entries) {
        const node =
          this.mode === "grid"
            ? renderGridItem(entry, {
                onOpen: (item) => void this.openBook(item),
                onContextMenu: (item, event) => this.openItemMenu(item, event)
              })
            : renderListItem(entry, {
                onOpen: (item) => void this.openBook(item),
                onContextMenu: (item, event) => this.openItemMenu(item, event)
              });
        this.body.append(node);
      }
    }
    this.toolbar.update(this.toolbarState());
  }

  private renderEmptyState(): void {
    this.emptyState.removeClass("is-hidden");
    this.emptyState.empty();
    const stats = this.deps.library.stats();
    const available = stats.total - stats.inLibrary;
    this.emptyState.createEl("h3", { text: "个人图书馆是空的" });
    if (stats.total === 0) {
      this.emptyState.createEl("p", {
        text: "Vault 里没找到可识别的电子书文件。试着把 EPUB、PDF 或 TXT 放进 Vault。"
      });
    } else if (available === 0) {
      this.emptyState.createEl("p", {
        text: "所有发现的书都已加入,但筛选条件过滤掉了当前结果。"
      });
    } else {
      this.emptyState.createEl("p", {
        text: `已发现 ${stats.total} 本书,但还没有加入任何一本。点击下面的按钮挑选加入。`
      });
    }
    const add = this.emptyState.createEl("button", { text: "+ 加入书籍", attr: { type: "button" } });
    add.addClass("mod-cta");
    add.onclick = () => this.openAddToLibrary();
  }

  private async openBook(entry: LibraryEntry): Promise<void> {
    await this.deps.reading.openBook(entry.book.id);
    await this.deps.openReader(entry);
  }

  private openItemMenu(entry: LibraryEntry, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("打开阅读器").setIcon("book-open").onClick(() => void this.openBook(entry)));
    menu.addItem((item) =>
      item.setTitle("在 Obsidian 中查看").setIcon("file-text").onClick(() => {
        const file = this.deps.app.vault.getAbstractFileByPath(entry.book.locator.path);
        if (file instanceof TFile) this.deps.app.workspace.openLinkText(file.path, "", true);
      })
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("从图书馆移除").setIcon("trash").setWarning(true).onClick(() => void this.removeFromLibrary(entry))
    );
    menu.showAtMouseEvent(event);
  }

  private async removeFromLibrary(entry: LibraryEntry): Promise<void> {
    await this.deps.library.removeFromLibrary(entry.book.id);
  }

  private openFilters(): void {
    const modal = new ShelfFiltersModal(this.deps.app, this.filter);
    void modal.openAndGetResult().then((next) => {
      this.filter = next;
      this.refresh();
    });
  }

  private openAddToLibrary(): void {
    new AddToLibraryModal(this.deps.app, this.deps.library).open();
  }

  /**
   * When the user opens an empty library for the first time, surface the
   * AddToLibrary modal so the empty state doesn't feel dead. We only do
   * this once per leaf to avoid nagging on every re-open.
   */
  private maybePromptForFirstImport(): void {
    if (this.promptedForFirstImport) return;
    const stats = this.deps.library.stats();
    if (stats.inLibrary === 0 && stats.total > 0) {
      this.promptedForFirstImport = true;
      this.openAddToLibrary();
    }
  }
}