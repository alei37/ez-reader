import { ItemView, Menu, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { LibraryEntry, LibraryService } from "../../core/services/LibraryService";
import type { ReadingService } from "../../core/services/ReadingService";
import type { BookReader } from "../../core/ports/BookReader";
import type { CoverCache } from "../../adapters/obsidian/CoverCache";
import { DEFAULT_SORT, emptyFilter, type ShelfFilter, type SortCriterion } from "../../core/types/ShelfFilter";
import { AddToLibraryModal } from "./AddToLibraryModal";
import { OnboardingModal } from "./OnboardingModal";
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
  readonly openReader: (entry: LibraryEntry) => Promise<void>;
  readonly covers?: CoverCache;
  readonly bookBytesLoader?: (path: string) => Promise<ArrayBuffer>;
  /** Used by the first-launch onboarding modal to persist dismissal. */
  readonly annotationStore?: {
    hasOnboardingBeenDismissed(): Promise<boolean>;
    markOnboardingDismissed(): Promise<void>;
  };
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
          // 搜索 debounce — 用户敲字符时立即更新 filter state (但)
          // renderRefresh 推迟 150ms, 避免连击输入触发十几次全量重渲染
          // (500 本书的 shelf 重建一次约 30-50ms).
          this.scheduleSearchRefresh();
        },
        onFilterOpen: () => this.openFilters(),
        onViewModeChange: (mode) => {
          this.mode = mode;
          this.renderRefresh();
        },
        onSortChange: (sort) => {
          this.sort = sort;
          this.renderRefresh();
        },
        onAddToLibrary: () => this.openAddToLibrary(),
        onAddAllToLibrary: () => void this.addAllToLibrary()
      },
      this.toolbarState()
    );
    container.append(this.toolbar.root);

    this.bindShelfShortcuts();

    this.body = container.createDiv({ cls: "ez-reader__shelf__body" });
    this.emptyState = container.createDiv({ cls: "ez-reader__shelf__empty" });

    // library.subscribe 走 scheduleRefresh (100ms debounce), 防止一次性加 100 本书
    // 导致 100 次 renderRefresh. 用户主动 search / sort 走 renderRefresh (即时).
    this.unsubscribe = this.deps.library.subscribe(() => this.scheduleRefresh());
    this.renderRefresh();
    this.maybePromptForFirstImport();
  }

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) globalThis.clearTimeout(this.refreshTimer);
    this.refreshTimer = globalThis.setTimeout(() => {
      this.refreshTimer = undefined;
      this.renderRefresh();
    }, 100);
  }
  /** Debounced search refresh — 150ms 是用户在 <input type=search> 上能感知的
   *  最短延迟, 慢于这个就开始觉得"卡".  短于 150ms 反而像是抖动. */
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduleSearchRefresh(): void {
    if (this.searchTimer !== undefined) globalThis.clearTimeout(this.searchTimer);
    this.searchTimer = globalThis.setTimeout(() => {
      this.searchTimer = undefined;
      this.renderRefresh();
    }, 150);
  }
  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.refreshTimer !== undefined) {
      globalThis.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.searchTimer !== undefined) {
      globalThis.clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    this.clearPendingG();
    if (this.shortcutsHandler !== undefined) {
      this.containerEl.removeEventListener("keydown", this.shortcutsHandler);
      this.shortcutsHandler = undefined;
    }
  }

  private shortcutsHandler: ((event: KeyboardEvent) => void) | undefined;
  // g g 序列状态: pendingG timer 跟一次性 capture-phase listener 提到
  // class 字段, onClose 统一清掉. 之前是闭包变量, view 关闭后 listener
  // 仍然挂在 document 上, 下一个 g 会触发已 detach view 的回调.
  private pendingG: ReturnType<typeof setTimeout> | undefined;
  private pendingGOnce: ((event: KeyboardEvent) => void) | undefined;

  /**
   * Shelf-level keyboard shortcuts. We listen on the view container so
   * these work regardless of which child element has focus — but we bail
   * out when focus is already inside an input / textarea so the user can
   * still type freely.
   *
   * Currently bound:
   *   `/`     — focus the search box (fwd `/` into the input is allowed
   *             naturally because we bail on input-focused targets first)
   *   `g g`   — toggle grid / list view (Gmail-style prefix sequence)
   *   `f`     — open the filter modal
   *   `Esc`   — clear the active search query and refocus the shelf
   */
  private bindShelfShortcuts(): void {
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        this.toolbar.focus();
        return;
      }
      if (key === "escape") {
        if (this.filter.query) {
          event.preventDefault();
          this.filter = { ...this.filter, query: "" };
          // 同步清掉 toolbar 的 input 文字 (user 期待清空就真的是空),
          // 而不只是清 filter 状态.
          this.toolbar.setQuery("");
          this.renderRefresh();
        }
        return;
      }
      if (key === "f") {
        event.preventDefault();
        this.openFilters();
        return;
      }
      if (key === "g") {
        event.preventDefault();
        this.clearPendingG();
        this.pendingG = globalThis.setTimeout(() => {
          this.pendingG = undefined;
        }, 800);
        // 等下一个键 — 用 capture phase 拦截后续 keydown
        this.pendingGOnce = (next: KeyboardEvent): void => {
          this.clearPendingG();
          if (next.key.toLowerCase() === "g") {
            // g g = toggle grid/list
            const newMode = this.mode === "grid" ? "list" : "grid";
            this.mode = newMode;
            this.renderRefresh();
          }
        };
        document.addEventListener("keydown", this.pendingGOnce, true);
      }
    };
    this.containerEl.addEventListener("keydown", handler);
    this.shortcutsHandler = handler;
  }

  /** Remove any in-flight `g g` timer and the matching capture-phase listener. */
  private clearPendingG(): void {
    if (this.pendingG !== undefined) {
      globalThis.clearTimeout(this.pendingG);
      this.pendingG = undefined;
    }
    if (this.pendingGOnce) {
      document.removeEventListener("keydown", this.pendingGOnce, true);
      this.pendingGOnce = undefined;
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

  private renderRefresh(): void {
    const entries = this.deps.library.list(this.filter, this.sort);
    this.body.empty();
    this.body.removeClass("is-grid", "is-list");
    this.body.addClass(this.mode === "grid" ? "is-grid" : "is-list");

    if (entries.length === 0) {
      this.renderEmptyState();
    } else {
      this.emptyState.addClass("is-hidden");
      for (const entry of entries) {
        const coverPath = entry.book.coverPath ?? undefined;
        const node =
          this.mode === "grid"
            ? renderGridItem(entry, {
                onOpen: (item) => void this.openBook(item),
                onContextMenu: (item, event) => this.openItemMenu(item, event)
              }, coverPath)
            : renderListItem(entry, {
                onOpen: (item) => void this.openBook(item),
                onContextMenu: (item, event) => this.openItemMenu(item, event)
              }, coverPath);
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
        text: "Vault 里没找到可识别的电子书文件。试着把 EPUB、PDF 放进 Vault。文件需放在 Vault 内任意位置。"
      });
      // 没有候选时不显示"加入书籍"按钮 — modal 会空跑
      return;
    }
    if (available === 0) {
      this.emptyState.createEl("p", {
        text: "所有发现的书都已加入,但筛选条件过滤掉了当前结果。"
      });
      return;
    }
    this.emptyState.createEl("p", {
      text: `已发现 ${stats.total} 本书,但还没有加入任何一本。点击下面的按钮挑选加入。`
    });
    const add = this.emptyState.createEl("button", { text: "+ 加入书籍", attr: { type: "button" } });
    add.addClass("mod-cta");
    add.onclick = () => this.openAddToLibrary();
  }

  private async openBook(entry: LibraryEntry): Promise<void> {
    try {
      await this.deps.reading.openBook(entry.book.id);
      await this.deps.openReader(entry);
    } catch (error) {
      // 错误展示 — 之前 silent fail 用户不知道为什么点书没反应
// [ez-reader] Notice moved to top-level import (esbuild won't externalize dynamic obsidian imports).
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`打开《${entry.book.metadata?.title ?? entry.book.locator.path}》失败: ${message}`);
      console.error("[ez-reader] openBook failed", entry.book.locator.path, error);
    }
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
    // 状态切换 — 让用户标记"想重读"或"已完成"
    const currentStatus = entry.reading.status;
    menu.addItem((item) =>
      item
        .setTitle(currentStatus === "reading" ? "✓ 在读" : "标记为在读")
        .setIcon("play")
        .onClick(() => void this.setStatus(entry, "reading"))
    );
    menu.addItem((item) =>
      item
        .setTitle(currentStatus === "finished" ? "✓ 已读完" : "标记为已读完")
        .setIcon("check")
        .onClick(() => void this.setStatus(entry, "finished"))
    );
    menu.addItem((item) =>
      item
        .setTitle(currentStatus === "abandoned" ? "✓ 暂弃" : "标记为暂弃")
        .setIcon("x")
        .onClick(() => void this.setStatus(entry, "abandoned"))
    );
    menu.addItem((item) =>
      item.setTitle("收藏").setIcon("star").onClick(() => void this.toggleFavorite(entry))
    );
    // P1 新功能: 置顶/取消置顶 — 跟 favorite 同一类"快速标记", 跟状态切换
    // 分组. 标题在已置顶时改为 "✓ 已置顶" 让用户立即看到当前状态.
    const isPinned = entry.book.pinnedAt !== null;
    menu.addItem((item) =>
      item
        .setTitle(isPinned ? "✓ 已置顶" : "置顶到最前")
        .setIcon("pin")
        .onClick(() => void this.togglePin(entry))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("从图书馆移除").setIcon("trash").setWarning(true).onClick(() => void this.removeFromLibrary(entry))
    );
    menu.showAtMouseEvent(event);
  }

  private async togglePin(entry: LibraryEntry): Promise<void> {
    const wasPinned = entry.book.pinnedAt !== null;
    try {
      await this.deps.library.togglePin(entry.book.id);
      new Notice(wasPinned ? "已取消置顶" : "已置顶到最前");
    } catch (error) {
      console.warn("[ez-reader] togglePin failed", error);
      new Notice("置顶失败");
    }
  }

  private async setStatus(entry: LibraryEntry, status: "reading" | "finished" | "abandoned"): Promise<void> {
    await this.deps.reading.setStatus(entry.book.id, status);
  }

  private async toggleFavorite(entry: LibraryEntry): Promise<void> {
    await this.deps.reading.toggleFavorite(entry.book.id);
  }

  private async removeFromLibrary(entry: LibraryEntry): Promise<void> {
    const title = entry.book.metadata?.title ?? entry.book.locator.path;
// [ez-reader] Notice moved to top-level import (esbuild won't externalize dynamic obsidian imports).
    // 二次确认: 删除不可逆(读书进度、书签、摘录都不会删除, 但书从书架消失)
    const confirm = new Modal(this.deps.app);
    confirm.contentEl.createEl("h3", { text: `从图书馆移除《${title}》?` });
    confirm.contentEl.createEl("p", {
      text: "书将从个人图书馆消失。原始文件、阅读进度、书签、摘录都不会删除 — 重新加入即可恢复。"
    });
    const actions = confirm.contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancelBtn.onclick = () => confirm.close();
    const removeBtn = actions.createEl("button", { text: "移除", attr: { type: "button" } });
    removeBtn.addClass("mod-warning");
    removeBtn.onclick = () => {
      confirm.close();
      void this.deps.library.removeFromLibrary(entry.book.id).then(() => {
        new Notice(`已从图书馆移除《${title}》`);
      });
    };
    confirm.open();
  }

  private openFilters(): void {
    const modal = new ShelfFiltersModal(this.deps.app, this.filter);
    void modal.openAndGetResult().then((next) => {
      // Esc / overlay click resolves null — leave filter unchanged
      if (next === null) return;
      this.filter = next;
      this.renderRefresh();
    });
  }

  private openAddToLibrary(): void {
    new AddToLibraryModal(this.deps.app, this.deps.library, {
      covers: this.deps.covers,
      loader: this.deps.bookBytesLoader
    }).open();
  }

  /**
   * Bulk-add every discovered-but-unadded book. Bypasses the picker modal
   * for users who just want the whole vault's worth of EPUB/PDF on the
   * shelf. `addAllToLibrary` is idempotent so re-running is safe.
   */
  private addingAll = false;
  private async addAllToLibrary(): Promise<void> {
    if (this.addingAll) return; // 防双击
    const stats = this.deps.library.stats();
    if (stats.total - stats.inLibrary <= 0) return;
    this.addingAll = true;
    this.toolbar.setAddAllBusy(true);
// [ez-reader] Notice moved to top-level import (esbuild won't externalize dynamic obsidian imports).
    // P0 修复: 用 withTimeout 兜底, 之前 addAllToLibrary 触发 2N 串行
    // saveData + subscribe listener → renderList 链, 万一任何一步 hang
    // 按钮永远 disabled. 90s 是给超大 library 的余量 (100 本书 × 2N
    // mutations × 50ms ≈ 10s); 超过说明真有 hang, 让用户先能再次点击.
    let timedOut = false;
    const timeoutMs = 90_000;
    const timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      console.error(`[ez-reader] shelf addAllToLibrary timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    try {
      const count = await this.withTimeout(
        this.deps.library.addAllToLibrary(),
        timeoutMs,
        "shelf.addAllToLibrary"
      );
      if (count === undefined || timedOut) {
        new Notice(timedOut ? "加入超时,请重试" : "加入失败 (未知)");
      } else {
        new Notice(`已加入 ${count} 本书到图书馆。`);
      }
    } catch (error) {
      console.error("[ez-reader] addAllToLibrary failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`全部加入失败: ${message}`);
    } finally {
      globalThis.clearTimeout(timeoutHandle);
      this.addingAll = false;
      this.toolbar.setAddAllBusy(false);
    }
  }

  /** Race a promise against a deadline. Returns undefined on timeout so
   *  callers can decide what to surface (Notice vs throw). */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn(`[ez-reader] ${label} exceeded ${ms}ms — leaving promise pending`);
        resolve(undefined);
      }, ms);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          console.warn(`[ez-reader] ${label} rejected`, error);
          resolve(undefined);
        }
      );
    });
  }

  /**
   * When the user opens an empty library for the first time, surface the
   * AddToLibrary modal so the empty state doesn't feel dead. We only do
   * this once per leaf to avoid nagging on every re-open.
   *
   * P1 修复: 没有 annotationStore (测试场景) 时, 用 module-level flag 而
   * 不是 instance flag 避免热重载反复弹 picker. 已 dismiss 的 vault 也不
   * 再自动开 picker (dismiss = "我已经知道, 别再打扰我").
   */
  private static promptedForFirstImportWithoutStore = false;
  private maybePromptForFirstImport(): void {
    if (this.promptedForFirstImport) return;
    this.promptedForFirstImport = true;
    const store = this.deps.annotationStore;
    if (!store) {
      // 测试 / 旧调用方不带 annotationStore — module-level flag 防热重载反复弹.
      if (ShelfView.promptedForFirstImportWithoutStore) return;
      ShelfView.promptedForFirstImportWithoutStore = true;
      return;
    }
    void this.runOnboarding(store);
  }

  /**
   * First-launch onboarding. 顺序:
   * 1. 检查持久化的 dismissed 标志, 已 dismiss 就完全跳过.
   * 2. 显示 OnboardingModal — 解释插件 + 给"开始加书"按钮.
   * 3. 任何路径 (选择 / 关闭) 都写 dismissed=true, 避免重复打扰.
   *
   * 用户点 OnboardingModal 的"开始加书"按钮 → 直接开 AddToLibraryModal
   * 串起来, 首次体验连贯: 解释 → 进入加书流程.
   */
  private async runOnboarding(store: {
    hasOnboardingBeenDismissed(): Promise<boolean>;
    markOnboardingDismissed(): Promise<void>;
  }): Promise<void> {
    let alreadyDismissed = false;
    try {
      alreadyDismissed = await store.hasOnboardingBeenDismissed();
    } catch (error) {
      console.warn("[ez-reader] onboarding check failed", error);
      alreadyDismissed = false;
    }
    if (alreadyDismissed) return;

    let choice: "addBooks" | "later" | null = null;
    try {
      choice = await new OnboardingModal(this.deps.app).openAndWait();
    } catch (error) {
      console.warn("[ez-reader] onboarding modal failed", error);
    }
    try {
      await store.markOnboardingDismissed();
    } catch (error) {
      console.warn("[ez-reader] could not persist onboarding dismissal", error);
    }

    if (choice === "addBooks") {
      this.openAddToLibrary();
    }
  }
}