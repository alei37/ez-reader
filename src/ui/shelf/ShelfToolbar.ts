import type { ShelfFilter, SortCriterion } from "../../core/types/ShelfFilter";

export type ViewMode = "grid" | "list";

export interface ShelfToolbarHandlers {
  onQueryChange: (query: string) => void;
  onFilterOpen: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSortChange: (sort: SortCriterion) => void;
}

export interface ShelfToolbarState {
  readonly mode: ViewMode;
  readonly filter: ShelfFilter;
  readonly sort: SortCriterion;
  readonly totalCount: number;
  readonly visibleCount: number;
}

const SORT_LABELS: Record<SortCriterion, string> = {
  titleAsc: "标题 A→Z",
  titleDesc: "标题 Z→A",
  authorAsc: "作者",
  addedDesc: "最近添加",
  openedDesc: "最近打开",
  progressDesc: "进度"
};

/** Header for the shelf view: search + filter button + view-mode toggle + sort. */
export class ShelfToolbar {
  readonly root: HTMLElement;
  private readonly handlers: ShelfToolbarHandlers;
  private readonly searchInput: HTMLInputElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly filterBadge: HTMLElement;
  private readonly countLabel: HTMLElement;
  private readonly gridButton: HTMLButtonElement;
  private readonly listButton: HTMLButtonElement;

  constructor(handlers: ShelfToolbarHandlers, initial: ShelfToolbarState) {
    this.handlers = handlers;
    this.root = createDiv({ cls: "ez-reader__shelf-toolbar" });
    this.searchInput = this.root.createEl("input", {
      attr: { type: "search", placeholder: "搜索书名、作者或标识符…" }
    });
    this.searchInput.addClass("ez-reader__shelf-toolbar__search");
    this.searchInput.addEventListener("input", () => this.handlers.onQueryChange(this.searchInput.value));

    this.filterBadge = this.root.createEl("button", {
      text: "筛选",
      attr: { type: "button", "aria-label": "打开筛选面板" }
    });
    this.filterBadge.addClass("ez-reader__shelf-toolbar__filter");
    this.filterBadge.addEventListener("click", () => this.handlers.onFilterOpen());

    this.sortSelect = this.root.createEl("select");
    this.sortSelect.addClass("ez-reader__shelf-toolbar__sort");
    for (const [value, label] of Object.entries(SORT_LABELS)) {
      this.sortSelect.createEl("option", { value, text: `排序: ${label}` });
    }
    this.sortSelect.value = initial.sort;
    this.sortSelect.addEventListener("change", () => this.handlers.onSortChange(this.sortSelect.value as SortCriterion));

    this.gridButton = this.root.createEl("button", { text: "网格", attr: { type: "button", title: "网格视图" } });
    this.listButton = this.root.createEl("button", { text: "列表", attr: { type: "button", title: "列表视图" } });
    this.gridButton.addClass("ez-reader__shelf-toolbar__toggle");
    this.listButton.addClass("ez-reader__shelf-toolbar__toggle");
    this.gridButton.addEventListener("click", () => this.handlers.onViewModeChange("grid"));
    this.listButton.addEventListener("click", () => this.handlers.onViewModeChange("list"));

    this.countLabel = this.root.createEl("span", { text: "" });
    this.countLabel.addClass("ez-reader__shelf-toolbar__count");
    this.update(initial);
  }

  update(state: ShelfToolbarState): void {
    this.gridButton.toggleClass("is-active", state.mode === "grid");
    this.listButton.toggleClass("is-active", state.mode === "list");
    const filterActive = countActiveFilters(state.filter) > 0;
    this.filterBadge.toggleClass("is-active", filterActive);
    this.countLabel.setText(`${state.visibleCount} / ${state.totalCount}`);
  }

  focus(): void {
    this.searchInput.focus();
  }
}

const countActiveFilters = (filter: ShelfFilter): number => {
  let count = 0;
  if (filter.statuses && filter.statuses.length > 0) count += 1;
  if (filter.languages && filter.languages.length > 0) count += 1;
  if (filter.formats && filter.formats.length > 0) count += 1;
  if (filter.progressBuckets && filter.progressBuckets.length > 0) count += 1;
  if (filter.recency) count += 1;
  return count;
};

// Re-export createDiv so the file stands alone.
const createDiv = (options: { cls?: string } = {}): HTMLElement => {
  const div = document.createElement("div");
  if (options.cls) div.addClass(options.cls);
  return div;
};