import type { ReadingState } from "../../core/entities/ReadingState";

export interface ReaderToolbarHandlers {
  onPrev: () => void;
  onNext: () => void;
  onProgressChange: (fraction: number) => void;
  onAddBookmark: () => void;
  onToggleBookmarks: () => void;
  onToggleExcerpts: () => void;
  onClose: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onShowFontSettings?: () => void;
}

export interface ReaderToolbarState {
  readonly fraction: number;
  readonly chapter: string;
  readonly status: ReadingState["status"];
  readonly showingBookmarks: boolean;
  readonly showingExcerpts: boolean;
  readonly zoom?: number;
  readonly showZoomControls?: boolean;
  readonly showFontSettings?: boolean;
}

/** Header strip that lives above the reader stage. */
export class ReaderToolbar {
  readonly root: HTMLElement;
  private readonly handlers: ReaderToolbarHandlers;
  private readonly fractionInput: HTMLInputElement;
  private readonly fractionValue: HTMLElement;
  private readonly chapterLabel: HTMLElement;
  private readonly statusPill: HTMLElement;
  private readonly bookmarkToggle: HTMLButtonElement;
  private readonly excerptToggle: HTMLButtonElement;

  constructor(handlers: ReaderToolbarHandlers, initial: ReaderToolbarState) {
    this.handlers = handlers;
    this.root = createDiv({ cls: "ez-reader__reader-toolbar" });

    const close = this.root.createEl("button", { text: "关闭", attr: { type: "button", title: "关闭阅读器" } });
    close.addClass("ez-reader__reader-toolbar__close");
    close.addEventListener("click", () => handlers.onClose());

    const prev = this.root.createEl("button", { text: "上一页", attr: { type: "button" } });
    prev.addClass("ez-reader__reader-toolbar__nav");
    prev.addEventListener("click", () => handlers.onPrev());

    const next = this.root.createEl("button", { text: "下一页", attr: { type: "button" } });
    next.addClass("ez-reader__reader-toolbar__nav");
    next.addEventListener("click", () => handlers.onNext());

    this.fractionInput = this.root.createEl("input", {
      attr: { type: "range", min: "0", max: "1000", step: "1", title: "跳转阅读进度" }
    });
    this.fractionInput.addClass("ez-reader__reader-toolbar__progress");
    this.fractionInput.addEventListener("change", () => {
      const fraction = Number(this.fractionInput.value) / 1000;
      handlers.onProgressChange(clampFraction(fraction));
    });

    this.fractionValue = this.root.createEl("span", { text: "0%" });
    this.fractionValue.addClass("ez-reader__reader-toolbar__progress-value");

    this.chapterLabel = this.root.createEl("span", { text: "" });
    this.chapterLabel.addClass("ez-reader__reader-toolbar__chapter");

    this.statusPill = this.root.createEl("span", { text: "在读" });
    this.statusPill.addClass("ez-reader__status-pill");

    const addBookmark = this.root.createEl("button", { text: "+ 书签", attr: { type: "button" } });
    addBookmark.addClass("ez-reader__reader-toolbar__action");
    addBookmark.addEventListener("click", () => handlers.onAddBookmark());

    this.bookmarkToggle = this.root.createEl("button", { text: "书签", attr: { type: "button", title: "显示书签" } });
    this.bookmarkToggle.addClass("ez-reader__reader-toolbar__action");
    this.bookmarkToggle.addEventListener("click", () => handlers.onToggleBookmarks());

    this.excerptToggle = this.root.createEl("button", { text: "摘录", attr: { type: "button", title: "显示摘录" } });
    this.excerptToggle.addClass("ez-reader__reader-toolbar__action");
    this.excerptToggle.addEventListener("click", () => handlers.onToggleExcerpts());

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