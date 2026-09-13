import type { Bookmark } from "../../core/entities/Bookmark";

export interface BookmarksPanelHandlers {
  onJump: (bookmark: Bookmark) => void;
  onRemove: (bookmark: Bookmark) => void;
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

  private render(): void {
    this.root.empty();
    this.root.createEl("h3", { text: "书签" });
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