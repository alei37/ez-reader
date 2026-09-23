import type { Bookmark } from "../../core/entities/Bookmark";

export interface BookmarksPanelHandlers {
  onJump: (bookmark: Bookmark) => void;
  onRemove: (bookmark: Bookmark) => void;
  /** Close button on panel header — user-facing escape hatch. */
  onClose?: () => void;
}

/**
 * P1 polish: 书签面板现在每条显示
 *   - chapter (e.g. "Chapter 3: Wave Propagation") + percentage
 *   - 创建时间
 *   - 主按钮 text 是 label (e.g. "第三章的关键论点"), 右下角 × 删除
 * 之前只显示 label, 用户点之前不知道是哪个位置的书签.
 */
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
    titleRow.createSpan({
      text: `(${this.bookmarks.length})`,
      cls: "ez-reader__panel-header-count"
    });
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
    // newest first
    const ordered = [...this.bookmarks].sort((a, b) => b.createdAt - a.createdAt);
    for (const bookmark of ordered) {
      const row = this.root.createDiv({ cls: "ez-reader__bookmark-row" });
      // 上下文 (chapter + percentage + 时间) — 让用户知道是哪个位置的书签
      const contextLine = row.createDiv({ cls: "ez-reader__bookmark-row__context" });
      if (bookmark.locator.chapter) {
        contextLine.createSpan({
          text: bookmark.locator.chapter,
          cls: "ez-reader__bookmark-row__chapter"
        });
      }
      const fraction = bookmark.locator.position.kind === "reflow"
        ? bookmark.locator.position.fraction
        : bookmark.locator.position.kind === "text"
        ? bookmark.locator.position.fraction
        : 0;
      contextLine.createSpan({
        text: `${Math.round(fraction * 100)}%`,
        cls: "ez-reader__bookmark-row__fraction"
      });
      contextLine.createSpan({
        text: new Date(bookmark.createdAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        cls: "ez-reader__bookmark-row__time"
      });
      // P1: jump + remove 同一行 (actionRow), 之前 remove 单独一行浪费纵向空间.
      // jump flex:1 占满, remove 在最右 — 微信读书 / Apple Books 风格.
      const actionRow = row.createDiv({ cls: "ez-reader__bookmark-row__action-row" });
      const jump = actionRow.createEl("button", {
        text: bookmark.label || "未命名书签",
        attr: { type: "button", title: bookmark.locator.chapter ? `跳到 ${bookmark.locator.chapter} (${Math.round(fraction * 100)}%)` : "跳到此书签" }
      });
      jump.addClass("ez-reader__bookmark-row__jump");
      jump.onclick = () => this.handlers.onJump(bookmark);
      // 右下角删除 — P1 改灰色, 之前是默认色, 跟"待办"易混淆
      const remove = actionRow.createEl("button", {
        text: "×",
        attr: { type: "button", title: "删除书签", "aria-label": "删除书签" }
      });
      remove.addClass("ez-reader__bookmark-row__remove");
      remove.onclick = () => this.handlers.onRemove(bookmark);
    }
  }
}
