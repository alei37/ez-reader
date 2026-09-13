import type { ReadingState } from "../../core/entities/ReadingState";

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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onShowFontSettings: () => void;
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
  /** Current zoom level (1.0 = fit-width). Only meaningful for PDFs. */
  readonly zoom?: number;
  /** Whether to show zoom controls (true for PDFs, false otherwise). */
  readonly showZoomControls?: boolean;
  readonly showFontSettings?: boolean;
}

/**
 * Compact reader header. Layout (single row, no wrap):
 *
 *   [×] [◀ ▶ ▬▬▬▬ 42%] [Aa · 摘 · 标] [− + 适宽]
 *
 * Designed for both desktop and tablet: progress bar is fixed-width so the
 * page always lines up, zoom controls cluster together on the right, and
 * actions stay visible without overflow on a 700px-wide column.
 */
export class ReaderToolbar {
  readonly root: HTMLElement;
  private readonly handlers: ReaderToolbarHandlers;
  private readonly fractionInput: HTMLInputElement;
  private readonly fractionValue: HTMLElement;
  private readonly chapterLabel: HTMLElement;
  private readonly statusPill: HTMLElement;
  private readonly bookmarkToggle: HTMLButtonElement;
  private readonly excerptToggle: HTMLButtonElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly zoomReset: HTMLButtonElement;
  private readonly zoomGroup: HTMLElement;
  private readonly fontButton: HTMLButtonElement;
  private readonly tocToggle: HTMLButtonElement;
  private readonly notesToggle: HTMLButtonElement;
  private readonly immersiveToggle: HTMLButtonElement;

  constructor(handlers: ReaderToolbarHandlers, initial: ReaderToolbarState) {
    this.handlers = handlers;
    this.root = createDiv({ cls: "ez-reader__reader-toolbar" });

    // --- Left: close ---
    const close = this.root.createEl("button", { text: "×", attr: { type: "button", title: "关闭阅读器", "aria-label": "关闭" } });
    close.addClass("ez-reader__reader-toolbar__close");
    close.addEventListener("click", () => handlers.onClose());

    // --- Middle: navigation + compact progress ---
    const navGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__nav-group" });

    const prev = navGroup.createEl("button", { text: "◀", attr: { type: "button", title: "上一页", "aria-label": "上一页" } });
    prev.addClass("ez-reader__reader-toolbar__nav");
    prev.addEventListener("click", () => handlers.onPrev());

    this.fractionInput = navGroup.createEl("input", {
      attr: { type: "range", min: "0", max: "1000", step: "1", title: "跳转阅读进度", "aria-label": "进度" }
    });
    this.fractionInput.addClass("ez-reader__reader-toolbar__progress");
    this.fractionInput.addEventListener("change", () => {
      const fraction = Number(this.fractionInput.value) / 1000;
      handlers.onProgressChange(clampFraction(fraction));
    });

    const next = navGroup.createEl("button", { text: "▶", attr: { type: "button", title: "下一页", "aria-label": "下一页" } });
    next.addClass("ez-reader__reader-toolbar__nav");
    next.addEventListener("click", () => handlers.onNext());

    this.fractionValue = navGroup.createEl("span", { text: "0%" });
    this.fractionValue.addClass("ez-reader__reader-toolbar__progress-value");

    // Chapter label + status pill — share a small subtitle row above nav.
    const meta = this.root.createDiv({ cls: "ez-reader__reader-toolbar__meta" });
    this.chapterLabel = meta.createEl("span", { text: "" });
    this.chapterLabel.addClass("ez-reader__reader-toolbar__chapter");
    this.statusPill = meta.createEl("span", { text: "在读" });
    this.statusPill.addClass("ez-reader__status-pill");

    // --- Right: actions + zoom ---
    const actionsGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__actions" });

    const addBookmark = actionsGroup.createEl("button", { text: "+书签", attr: { type: "button", title: "添加书签", "aria-label": "添加书签" } });
    addBookmark.addClass("ez-reader__reader-toolbar__action");
    addBookmark.addEventListener("click", () => handlers.onAddBookmark());

    this.fontButton = actionsGroup.createEl("button", { text: "Aa", attr: { type: "button", title: "字号 / 行距 / 主题", "aria-label": "字号 / 行距 / 主题" } });
    this.fontButton.addClass("ez-reader__reader-toolbar__action");
    this.fontButton.addEventListener("click", () => handlers.onShowFontSettings());

    this.tocToggle = actionsGroup.createEl("button", { text: "目录", attr: { type: "button", title: "显示目录 (T)", "aria-label": "目录" } });
    this.tocToggle.addClass("ez-reader__reader-toolbar__action");
    this.tocToggle.addEventListener("click", () => handlers.onToggleToc());

    this.notesToggle = actionsGroup.createEl("button", { text: "笔记", attr: { type: "button", title: "显示笔记侧边栏 (S)", "aria-label": "笔记" } });
    this.notesToggle.addClass("ez-reader__reader-toolbar__action");
    this.notesToggle.addEventListener("click", () => handlers.onToggleNotes());

    this.immersiveToggle = actionsGroup.createEl("button", { text: "沉浸", attr: { type: "button", title: "切换沉浸模式 (Pad 全屏)", "aria-label": "沉浸模式" } });
    this.immersiveToggle.addClass("ez-reader__reader-toolbar__action");
    this.immersiveToggle.addEventListener("click", () => handlers.onToggleImmersive());

    this.excerptToggle = actionsGroup.createEl("button", { text: "摘录", attr: { type: "button", title: "显示摘录", "aria-label": "摘录" } });
    this.excerptToggle.addClass("ez-reader__reader-toolbar__action");
    this.excerptToggle.addEventListener("click", () => handlers.onToggleExcerpts());

    this.bookmarkToggle = actionsGroup.createEl("button", { text: "书签", attr: { type: "button", title: "显示书签", "aria-label": "书签" } });
    this.bookmarkToggle.addClass("ez-reader__reader-toolbar__action");
    this.bookmarkToggle.addEventListener("click", () => handlers.onToggleBookmarks());

    // Zoom cluster — only shown when the session supports it (PDFs).
    this.zoomGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__zoom" });

    this.zoomOut = this.zoomGroup.createEl("button", { text: "−", attr: { type: "button", title: "缩小", "aria-label": "缩小" } });
    this.zoomOut.addClass("ez-reader__reader-toolbar__zoom-btn");
    this.zoomOut.addEventListener("click", () => handlers.onZoomOut());

    this.zoomReset = this.zoomGroup.createEl("button", { text: "适宽", attr: { type: "button", title: "适宽(还原)", "aria-label": "适宽" } });
    this.zoomReset.addClass("ez-reader__reader-toolbar__zoom-btn ez-reader__reader-toolbar__zoom-btn--reset");
    this.zoomReset.addEventListener("click", () => handlers.onZoomReset());

    this.zoomIn = this.zoomGroup.createEl("button", { text: "+", attr: { type: "button", title: "放大", "aria-label": "放大" } });
    this.zoomIn.addClass("ez-reader__reader-toolbar__zoom-btn");
    this.zoomIn.addEventListener("click", () => handlers.onZoomIn());

    this.update(initial);
  }

  update(state: ReaderToolbarState): void {
    this.fractionInput.value = String(Math.round(state.fraction * 1000));
    this.fractionValue.setText(`${Math.round(state.fraction * 100)}%`);
    this.chapterLabel.setText(state.chapter);
    this.statusPill.setText(statusLabel(state.status));
    this.statusPill.removeClass("is-reading", "is-finished", "is-abandoned", "is-unread");
    this.statusPill.addClass(`is-${state.status}`);
    this.bookmarkToggle.toggleClass("is-active", state.showingBookmarks);
    this.excerptToggle.toggleClass("is-active", state.showingExcerpts);
    this.tocToggle.toggleClass("is-active", state.showingToc);
    this.notesToggle.toggleClass("is-active", state.showingNotes);
    this.immersiveToggle.toggleClass("is-active", state.showingImmersive);
    this.zoomGroup.toggleClass("is-hidden", state.showZoomControls !== true);
    this.fontButton.toggleClass("is-hidden", state.showFontSettings !== true);
    if (typeof state.zoom === "number") {
      this.zoomReset.setText(state.zoom >= 0.95 && state.zoom <= 1.05 ? "适宽" : `${Math.round(state.zoom * 100)}%`);
    } else {
      this.zoomReset.setText("适宽");
    }
  }
}

const clampFraction = (value: number): number => Math.max(0, Math.min(1, value));

const statusLabel = (status: ReadingState["status"]): string => {
  switch (status) {
    case "reading":
      return "在读";
    case "finished":
      return "已读完";
    case "abandoned":
      return "暂弃";
    default:
      return "未开始";
  }
};

const createDiv = (options: { cls?: string } = {}): HTMLElement => {
  const div = document.createElement("div");
  if (options.cls) div.addClass(options.cls);
  return div;
};