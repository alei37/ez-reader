import type { ShelfFilter, SortCriterion } from "../../core/types/ShelfFilter";
import { SHELF_DENSITIES, SHELF_DENSITY_LABELS, type ShelfDensity } from "../../core/types/ReaderSettings";

export type ViewMode = "grid" | "list";

export interface ShelfToolbarHandlers {
  onQueryChange: (query: string) => void;
  onFilterOpen: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSortChange: (sort: SortCriterion) => void;
  onAddToLibrary: () => void;
  /** Bulk-add every discovered-but-unadded book. */
  onAddAllToLibrary?: () => void;
  /** Cycle to the next shelf cover density (compact → default → spacious → large → compact). */
  onCycleShelfDensity?: () => void;
}

export interface ShelfToolbarState {
  readonly mode: ViewMode;
  readonly filter: ShelfFilter;
  readonly sort: SortCriterion;
  readonly totalCount: number;
  readonly visibleCount: number;
  readonly availableCount: number;
  readonly shelfDensity: ShelfDensity;
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
  private readonly addAllButton: HTMLButtonElement;
  private readonly densityButton: HTMLButtonElement;

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

    const addButton = this.root.createEl("button", {
      text: "+ 加入",
      attr: { type: "button", title: "挑选 Vault 中的书加入个人图书馆" }
    });
    addButton.addClass("ez-reader__shelf-toolbar__add");
    addButton.addEventListener("click", () => this.handlers.onAddToLibrary());

    // "全部加入" — 把 vault 里所有发现的书一次性加入, 比逐个挑选快得多.
    // 没传入 handler 时不显示 (避免点空 handler).
    this.addAllButton = this.root.createEl("button", {
      text: "全部加入",
      attr: { type: "button", title: "把所有发现的电子书都加入图书馆" }
    });
    this.addAllButton.addClass("ez-reader__shelf-toolbar__add-all");
    if (this.handlers.onAddAllToLibrary) {
      this.addAllButton.addEventListener("click", () => {
        if (this.addAllButton.disabled) return;
        this.handlers.onAddAllToLibrary!();
      });
    } else {
      this.addAllButton.addClass("is-hidden");
    }

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

    // Density cycle button: 紧凑 → 默认 → 宽松 → 超大 → 紧凑 …
    // 用 SVG 而不是 lucide setIcon 是因为 toolbar 不直接依赖 obsidian
    // (setIcon 由 caller 注不注入都可, 这里用 inline svg 保证可移植)
    this.densityButton = this.root.createEl("button", {
      attr: { type: "button", "aria-label": "切换封面密度", title: "点击循环切换封面密度" }
    });
    this.densityButton.addClass("ez-reader__shelf-toolbar__density");
    this.densityButton.addEventListener("click", () => {
      if (this.handlers.onCycleShelfDensity) this.handlers.onCycleShelfDensity();
    });

    this.countLabel = this.root.createEl("span", { text: "" });
    this.countLabel.addClass("ez-reader__shelf-toolbar__count");
    this.update(initial);
  }

  update(state: ShelfToolbarState): void {
    this.gridButton.toggleClass("is-active", state.mode === "grid");
    this.listButton.toggleClass("is-active", state.mode === "list");
    const filterActive = countActiveFilters(state.filter) > 0;
    this.filterBadge.toggleClass("is-active", filterActive);
    // availableCount > 0 才显示"全部加入" — 否则点了没效果, 误导用户.
    this.addAllButton.toggleClass("is-hidden", state.availableCount <= 0);
    if (state.availableCount > 0) {
      this.countLabel.setText(`${state.visibleCount} / ${state.totalCount} · ${state.availableCount} 本未加入`);
    } else {
      this.countLabel.setText(`${state.visibleCount} / ${state.totalCount}`);
    }
    this.renderDensityButton(state.shelfDensity);
  }

  private renderDensityButton(density: ShelfDensity): void {
    // 重建内容 — 简单可靠, 4 个档位不值得搞 diff. SVG icon 用 2×2/3×3 grid
    // 暗示密度, 当前档位用 label 文字明确. SVG markup comes from our
    // own densityIconSvg() helper (no user input), but we still parse it
    // through DOMParser rather than assigning to innerHTML directly to
    // satisfy the Obsidian auto-review "do not write to DOM directly
    // using innerHTML/outerHTML" lint rule.
    this.densityButton.empty();
    const iconWrap = this.densityButton.createDiv({ cls: "ez-reader__shelf-toolbar__density__icon" });
    const parsedIcon = new DOMParser().parseFromString(densityIconSvg(density), "image/svg+xml")
      .documentElement;
    iconWrap.replaceChildren(parsedIcon);
    this.densityButton.createSpan({ text: SHELF_DENSITY_LABELS[density] });
    this.densityButton.setAttribute("title", `封面密度: ${SHELF_DENSITY_LABELS[density]} (点击循环)`);
  }

  focus(): void {
    this.searchInput.focus();
  }

  /** Clear the search input field. Called from shortcuts / Esc clear flow. */
  setQuery(value: string): void {
    this.searchInput.value = value;
  }

  /** Toggle the "全部加入" button's disabled state. */
  setAddAllBusy(busy: boolean): void {
    this.addAllButton.disabled = busy;
    this.addAllButton.toggleClass("is-busy", busy);
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

/**
 * Tiny SVG glyph showing how many cover cells fit a row at each density.
 * 4 cells = compact (lots of small covers), 1 cell = large (one big
 * cover per row). Pure inline SVG so the toolbar doesn't pull in a
 * icon library.
 */
const densityIconSvg = (density: ShelfDensity): string => {
  switch (density) {
    case "compact":
      return `<svg viewBox="0 0 14 14"><rect x="0" y="2" width="3" height="10" rx="0.5"/><rect x="4" y="2" width="3" height="10" rx="0.5"/><rect x="8" y="2" width="3" height="10" rx="0.5"/></svg>`;
    case "default":
      return `<svg viewBox="0 0 14 14"><rect x="0" y="2" width="6" height="10" rx="0.5"/><rect x="8" y="2" width="6" height="10" rx="0.5"/></svg>`;
    case "spacious":
      return `<svg viewBox="0 0 14 14"><rect x="1" y="2" width="5" height="10" rx="0.5"/><rect x="8" y="2" width="5" height="10" rx="0.5"/></svg>`;
    case "large":
      return `<svg viewBox="0 0 14 14"><rect x="3" y="2" width="8" height="10" rx="0.5"/></svg>`;
  }
};

/**
 * Cycle helper exported so ShelfView can persist the change to
 * PluginSettings via patchSettings. 4 discrete steps only — no custom
 * values; the slider would be too fine-grained for a viewport-relative
 * property like cover size.
 */
export const nextShelfDensity = (current: ShelfDensity): ShelfDensity => {
  const idx = SHELF_DENSITIES.indexOf(current);
  const safeIdx = idx >= 0 ? idx : 1;
  const nextIdx = (safeIdx + 1) % SHELF_DENSITIES.length;
  return SHELF_DENSITIES[nextIdx] ?? "default";
};

// Re-export createDiv so the file stands alone.
const createDiv = (options: { cls?: string } = {}): HTMLElement => {
  const div = document.createElement("div");
  if (options.cls) div.addClass(options.cls);
  return div;
};