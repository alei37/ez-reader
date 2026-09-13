import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { App } from "obsidian";
import type { LibraryEntry, LibraryService } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import type { FoliateBookReader } from "../../adapters/foliate/FoliateBookReader";
import type { PdfjsBookReader } from "../../adapters/pdfjs/PdfjsBookReader";
import type { BookReader, ReaderSession } from "../../core/ports/BookReader";
import { DEFAULT_SORT, emptyFilter, type ShelfFilter, type SortCriterion } from "../../core/types/ShelfFilter";
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
        }
      },
      this.toolbarState()
    );
    container.append(this.toolbar.root);

    this.body = container.createDiv({ cls: "ez-reader__shelf__body" });
    this.emptyState = container.createDiv({ cls: "ez-reader__shelf__empty" });
    this.emptyState.setText("这里会显示你的电子书。先把 EPUB 或 PDF 复制到 Vault 里试试。");

    this.unsubscribe = this.deps.library.subscribe(() => this.refresh());
    this.refresh();
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
    const total = this.deps.library.stats().total;
    const visible = this.deps.library.list(this.filter, this.sort).length;
    return {
      mode: this.mode,
      filter: this.filter,
      sort: this.sort,
      totalCount: total,
      visibleCount: visible
    };
  }

  private refresh(): void {
    const entries = this.deps.library.list(this.filter, this.sort);
    this.body.empty();
    this.body.removeClass("is-grid", "is-list");
    this.body.addClass(this.mode === "grid" ? "is-grid" : "is-list");

    if (entries.length === 0) {
      this.emptyState.removeClass("is-hidden");
    } else {
      this.emptyState.addClass("is-hidden");
      for (const entry of entries) {
        const node =
          this.mode === "grid"
            ? renderGridItem(entry, {
                onOpen: (item) => void this.openBook(item),
                onShowInfo: (item) => this.showInfo(item)
              })
            : renderListItem(entry, { onOpen: (item) => void this.openBook(item) });
        this.body.append(node);
      }
    }
    this.toolbar.update(this.toolbarState());
  }

  private async openBook(entry: LibraryEntry): Promise<void> {
    await this.deps.reading.openBook(entry.book.id);
    await this.deps.openReader(entry);
  }

  private showInfo(entry: LibraryEntry): void {
    const file = this.deps.app.vault.getAbstractFileByPath(entry.book.locator.path);
    if (file instanceof TFile) {
      this.deps.app.workspace.openLinkText(file.path, "", true);
    }
  }

  private openFilters(): void {
    const modal = new ShelfFiltersModal(this.deps.app, this.filter);
    void modal.openAndGetResult().then((next) => {
      this.filter = next;
      this.refresh();
    });
  }
}