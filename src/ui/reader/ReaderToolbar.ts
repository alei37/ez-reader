import { setIcon } from "obsidian";
import type { ReadingState } from "../../core/entities/ReadingState";
import { statusLabel } from "../shelf/shelfFormatters";

export interface ReaderToolbarHandlers {
  onPrev: () => void;
  onNext: () => void;
  onProgressChange: (fraction: number) => void;
  onAddBookmark: () => void;
  onToggleBookmarks: () => void;
  onToggleExcerpts: () => void;
  onToggleToc: () => void;
  onToggleNotes: () => void;
  onToggleImmersive: () => void;
  onClose: () => void;
  onShowFontSettings: () => void;
  /** 点击状态 pill — 轮询切换 reading → finished → abandoned → unread → reading. */
  onCycleStatus: () => void;
  /** 点击收藏按钮 — 切换当前书的收藏状态。 */
  onToggleFavorite: () => void;
}

export interface ReaderToolbarState {
  readonly fraction: number;
  readonly chapter: string;
  readonly status: ReadingState["status"];
  readonly showingBookmarks: boolean;
  readonly showingExcerpts: boolean;
  readonly showingNotes: boolean;
  readonly showingToc: boolean;
  readonly showingImmersive: boolean;
  readonly showFontSettings?: boolean;
  /** 当前书的书签数, 用于 toolbar badge. */
  readonly bookmarkCount?: number;
  /** 当前书的摘录数, 用于 toolbar badge. */
  readonly excerptCount?: number;
  /** Whether the current book is in the user's favorites. */
  readonly favorite?: boolean;
}

/**
 * Compact reader header. Layout:
 *
 *   [×] [状态] [★]  [◀ ▶ ▬▬▬▬ 42%]  [+书签 Aa 摘 标 笔记 目录 沉浸]
 *
 * Designed for both desktop and tablet: progress bar is fixed-width so the
 * page always lines up, and actions stay visible without overflow on a
 * 700px-wide column. PDF zoom is intentionally absent — the PDF overlay
 * exposes its own zoom controls inside the PDF viewer.
 */
export class ReaderToolbar {
  readonly root: HTMLElement;
  private readonly handlers: ReaderToolbarHandlers;
  private readonly fractionInput: HTMLInputElement;
  private readonly fractionValue: HTMLElement;
  private readonly chapterLabel: HTMLElement;
  private readonly statusPill: HTMLElement;
  private readonly favoriteButton: HTMLButtonElement;
  private readonly bookmarkToggle: HTMLButtonElement;
  private readonly excerptToggle: HTMLButtonElement;
  private readonly bookmarkBadge: HTMLElement;
  private readonly excerptBadge: HTMLElement;
  private readonly fontButton: HTMLButtonElement;
  /** 目录按钮挪到 toolbar 最左 (`tocLeft`), 不再 render 在 actions group.
   *  field 保留让 update() 仍能 sync is-active state (无 DOM 时 no-op). */
  private readonly tocToggle?: HTMLButtonElement;
  private readonly notesToggle: HTMLButtonElement;
  private readonly immersiveToggle: HTMLButtonElement;
  /**
   * 用户正在拖动进度条时为 true. 期间不走 relocate 回写 (会抖动),
   * 也不二次触发 progress change (input 事件已经触发了).
   */
  private isDragging = false;

  constructor(handlers: ReaderToolbarHandlers, initial: ReaderToolbarState) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__reader-toolbar");

    // P1 修复: 重做 toolbar 布局, 把目录按钮(icon)放最左边, 关闭按钮(icon)放
    // 最右边. 之前 close × 在最左是 web 习惯, 但 iOS/微信读书这类移动端范式
    // 是"次要操作右侧, 主操作中心", 目录是阅读器最高频入口放最左更顺手.
    // 不用汉字 — 全部用 Obsidian 内置 lucide icon (`setIcon` 在 HTMLElement
    // 里塞 <svg>), i18n 安全 + 视觉一致.
    const tocLeft = this.root.createEl("button", { attr: { type: "button", title: "显示目录 (T)", "aria-label": "目录" } });
    tocLeft.addClass("ez-reader__reader-toolbar__toc-left");
    setIcon(tocLeft, "list");
    tocLeft.addEventListener("click", () => handlers.onToggleToc());

    // 状态 pill — 紧贴 close 按钮, 用户一眼能看到当前阅读状态.
    // 点击轮询切换 reading → finished → abandoned → unread → reading.
    // 注意: 这里只反映 status, 不混 favorite 状态 — favorite 拆到独立
    // 按钮, 不然"★ 在读"既是 status pill 又是 favorite 入口, 语义混淆.
    this.statusPill = this.root.createEl("button", {
      text: "在读",
      attr: { type: "button", title: "点击切换阅读状态", "aria-label": "阅读状态" }
    });
    this.statusPill.addClass("ez-reader__status-pill", "is-clickable");
    this.statusPill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onCycleStatus();
    });

    // 收藏按钮 — 独立于 status pill, 避免 status pill 同时表达两个语义.
    this.favoriteButton = this.root.createEl("button", {
      text: "★",
      attr: { type: "button", title: "收藏 / 取消收藏", "aria-label": "收藏" }
    });
    this.favoriteButton.addClass("ez-reader__reader-toolbar__favorite-btn", "is-clickable");
    this.favoriteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onToggleFavorite();
    });

    // --- Middle: navigation + compact progress ---
    const navGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__nav-group" });

    // 章节标题小字 — 永久显示在 nav-group 顶部一行 (微信读书风格).
    const navLabel = navGroup.createDiv({ cls: "ez-reader__reader-toolbar__nav-label" });
    this.chapterLabel = navLabel.createEl("span", { text: "" });
    this.chapterLabel.addClass("ez-reader__reader-toolbar__chapter");

    const navRow = navGroup.createDiv({ cls: "ez-reader__reader-toolbar__nav-row" });
    const prev = navRow.createEl("button", { text: "◀", attr: { type: "button", title: "上一页", "aria-label": "上一页" } });
    prev.addClass("ez-reader__reader-toolbar__nav");
    prev.addEventListener("click", () => handlers.onPrev());

    this.fractionInput = navRow.createEl("input", {
      attr: { type: "range", min: "0", max: "1000", step: "1", title: "跳转阅读进度", "aria-label": "进度" }
    });
    this.fractionInput.addClass("ez-reader__reader-toolbar__progress");
    // 拖动期间实时更新百分比显示, 释放时才真正 seek 到 foliate (避免
    // 拖动过程中反复跳转). 任何 onPointerOut 都会丢失 pointerup, 留个
    // 兜底 timeout 防止 isDragging flag 永远 true 不重置.
    this.fractionInput.addEventListener("input", () => {
      const fraction = Number(this.fractionInput.value) / 1000;
      this.fractionValue.setText(`${Math.round(clampFraction(fraction) * 100)}%`);
    });
    this.fractionInput.addEventListener("pointerdown", () => {
      this.isDragging = true;
      globalThis.setTimeout(() => {
        // 兜底: pointerup 没收到 (例如在 input 边缘拖出) 时强制重置,
        // 否则 relocate 回写会一直被这个 flag 挡住.
        this.isDragging = false;
      }, 5000);
    });
    const endDrag = (): void => {
      if (!this.isDragging) return;
      this.isDragging = false;
      const fraction = Number(this.fractionInput.value) / 1000;
      handlers.onProgressChange(clampFraction(fraction));
    };
    this.fractionInput.addEventListener("pointerup", endDrag);
    this.fractionInput.addEventListener("pointercancel", endDrag);
    this.fractionInput.addEventListener("change", () => {
      // change 在键盘交互时会触发; 鼠标拖动走 pointerup 不走这里.
      // 但防一手: 如果 isDragging=true 还收到 change, 也算 (兜底).
      endDrag();
    });

    const next = navRow.createEl("button", { text: "▶", attr: { type: "button", title: "下一页", "aria-label": "下一页" } });
    next.addClass("ez-reader__reader-toolbar__nav");
    next.addEventListener("click", () => handlers.onNext());

    this.fractionValue = navRow.createEl("span", { text: "0%" });
    this.fractionValue.addClass("ez-reader__reader-toolbar__progress-value");

    // --- Right: actions ---
    const actionsGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__actions" });

    const addBookmark = actionsGroup.createEl("button", { text: "+书签", attr: { type: "button", title: "添加书签", "aria-label": "添加书签", "data-shortcut": "add-bookmark" } });
    addBookmark.addClass("ez-reader__reader-toolbar__action");
    addBookmark.addEventListener("click", () => handlers.onAddBookmark());

    this.fontButton = actionsGroup.createEl("button", { text: "Aa", attr: { type: "button", title: "字号 / 行距 / 主题", "aria-label": "字号 / 行距 / 主题", "data-shortcut": "font" } });
    this.fontButton.addClass("ez-reader__reader-toolbar__action");
    this.fontButton.addEventListener("click", () => handlers.onShowFontSettings());

    // P1 修复: 删掉 actionsGroup 里原来的"目录"按钮 — 现在 tocLeft(目录 icon)
    // 在 toolbar 最左, 这里再放一个重复按钮占空间且 i18n 渲染别扭. tocToggle
    // 字段保留 (toggleToc/toggleTocTocIcon 用), 但 DOM 上不再 render.

    this.notesToggle = actionsGroup.createEl("button", { text: "笔记", attr: { type: "button", title: "显示笔记侧边栏 (S)", "aria-label": "笔记", "data-shortcut": "notes" } });
    this.notesToggle.addClass("ez-reader__reader-toolbar__action");
    this.notesToggle.addEventListener("click", () => handlers.onToggleNotes());

    this.immersiveToggle = actionsGroup.createEl("button", { text: "沉浸", attr: { type: "button", title: "切换沉浸模式 (Shift+F, Pad 全屏)", "aria-label": "沉浸模式", "data-shortcut": "immersive" } });
    this.immersiveToggle.addClass("ez-reader__reader-toolbar__action");
    this.immersiveToggle.addEventListener("click", () => handlers.onToggleImmersive());

    this.excerptToggle = actionsGroup.createEl("button", { text: "摘录", attr: { type: "button", title: "显示摘录", "aria-label": "摘录", "data-shortcut": "excerpt" } });
    this.excerptToggle.addClass("ez-reader__reader-toolbar__action");
    this.excerptBadge = this.excerptToggle.createEl("span", { cls: "ez-reader__reader-toolbar__badge", text: "" });
    this.excerptBadge.addClass("is-hidden");
    this.excerptToggle.addEventListener("click", () => handlers.onToggleExcerpts());

    this.bookmarkToggle = actionsGroup.createEl("button", { text: "书签", attr: { type: "button", title: "显示书签", "aria-label": "书签", "data-shortcut": "bookmarks" } });
    this.bookmarkToggle.addClass("ez-reader__reader-toolbar__action");
    this.bookmarkBadge = this.bookmarkToggle.createEl("span", { cls: "ez-reader__reader-toolbar__badge", text: "" });
    this.bookmarkBadge.addClass("is-hidden");
    this.bookmarkToggle.addEventListener("click", () => handlers.onToggleBookmarks());

    // --- Right: close (icon, 永远在 toolbar 最右) ---
    const close = this.root.createEl("button", { attr: { type: "button", title: "关闭阅读器", "aria-label": "关闭" } });
    close.addClass("ez-reader__reader-toolbar__close");
    setIcon(close, "x");
    close.addEventListener("click", () => handlers.onClose());

    this.update(initial);
  }

  update(state: ReaderToolbarState): void {
    // 拖动期间不要用 relocate 事件回写 input.value — 用户拖到 60% 时,
    // relocate 触发 update() 把 value 又设回 30% (实际跳转还没完成),
    // 体验是 bar 在抖动. 用 isDragging flag 守住.
    if (!this.isDragging) {
      this.fractionInput.value = String(Math.round(state.fraction * 1000));
    }
    this.fractionValue.setText(`${Math.round(state.fraction * 100)}%`);
    this.chapterLabel.setText(state.chapter);
    // statusPill 只反映 status, 不再混 favorite; favorite 由独立按钮表达.
    this.statusPill.setText(statusLabel(state.status));
    this.statusPill.removeClass("is-reading", "is-finished", "is-abandoned", "is-unread");
    this.statusPill.addClass(`is-${state.status}`);
    this.favoriteButton.toggleClass("is-favorite", state.favorite === true);
    this.favoriteButton.setText(state.favorite ? "★" : "☆");
    this.bookmarkToggle.toggleClass("is-active", state.showingBookmarks);
    this.excerptToggle.toggleClass("is-active", state.showingExcerpts);
    this.tocToggle?.toggleClass("is-active", state.showingToc);
    this.notesToggle.toggleClass("is-active", state.showingNotes);
    this.immersiveToggle.toggleClass("is-active", state.showingImmersive);
    this.fontButton.toggleClass("is-hidden", state.showFontSettings !== true);
    this.updateBadge(this.bookmarkBadge, state.bookmarkCount);
    this.updateBadge(this.excerptBadge, state.excerptCount);
  }

  /** Show a small number badge on a button. Hide when 0/undefined. */
  private updateBadge(el: HTMLElement, count: number | undefined): void {
    if (typeof count !== "number" || count <= 0) {
      el.addClass("is-hidden");
      el.setText("");
      return;
    }
    el.removeClass("is-hidden");
    el.setText(count > 99 ? "99+" : String(count));
  }
}

const clampFraction = (value: number): number => Math.max(0, Math.min(1, value));