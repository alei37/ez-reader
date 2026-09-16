import type { Bookmark } from "../../core/entities/Bookmark";

export interface BookmarksPanelHandlers {
  onJump: (bookmark: Bookmark) => void;
  onRemove: (bookmark: Bookmark) => void;
  /** Close button on panel header — user-facing escape hatch. */
  onClose?: () => void;
}

export class BookmarksPanel {
  readonly root: HTMLElement;
  private readonly handlers: BookmarksPanelHandlers;
  private bookmarks: ReadonlyArray<Bookmark> = [];

  constructor(handlers: BookmarksPanelHandlers, host: HTMLElement) {
    this.handlers = handlers;
    this.root = host.createDiv({ cls: "ez-reader__reader-panel is-hidden" });
    this.render();
  }

  setBookmarks(bookmarks: ReadonlyArray<Bookmark>): void {
    this.bookmarks = bookmarks;
    this.render();
  }

  show(): void {
    this.root.removeClass("is-hidden");
  }

  hide(): void {
    this.root.addClass("is-hidden");
  }

  isVisible(): boolean {
    return !this.root.hasClass("is-hidden");
  }

  private render(): void {
    this.root.empty();
    const headerRow = this.root.createDiv({ cls: "ez-reader__panel-header" });
    const titleRow = headerRow.createDiv({ cls: "ez-reader__panel-header-title" });
    titleRow.createEl("h3", { text: "书签" });
    // P0 修复: 之前 panel 只能通过 toolbar 上的 toggle 按钮关闭, 沉浸模式
    // 下 toolbar 隐藏 → 用户完全卡住. 现在每个 panel header 加显式 × 按钮.
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "×",
        attr: { type: "button", title: "关闭面板 (Esc)", "aria-label": "关闭面板" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
    if (this.bookmarks.length === 0) {
      this.root.createDiv({ cls: "ez-reader__reader-panel__empty", text: "本书还没有书签。" });
      return;
    }
    for (const bookmark of this.bookmarks) {
      const row = this.root.createDiv({ cls: "ez-reader__bookmark-row" });
      const jump = row.createEl("button", { text: bookmark.label || "未命名书签", attr: { type: "button" } });
      jump.addClass("ez-reader__bookmark-row__jump");
      jump.onclick = () => this.handlers.onJump(bookmark);
      const remove = row.createEl("button", { text: "×", attr: { type: "button", title: "删除书签" } });
      remove.addClass("ez-reader__bookmark-row__remove");
      remove.onclick = () => this.handlers.onRemove(bookmark);
    }
  }
}