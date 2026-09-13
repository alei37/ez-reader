import type { TocItem } from "../../core/ports/BookReader";

export interface TocPanelHandlers {
  onJump: (item: TocItem) => void;
}

/**
 * Top-of-page table of contents panel. Mirrors BookmarksPanel.ts style:
 * a collapsible section that toggles via a class. Items render with
 * per-depth indentation so the chapter hierarchy reads top-down.
 *
 * Includes a quick-filter input at the top for books with deep TOC
 * hierarchies (a typical academic monograph has 30+ chapters).
 */
export class TocPanel {
  readonly root: HTMLElement;
  private readonly handlers: TocPanelHandlers;
  private items: ReadonlyArray<TocItem> = [];
  private query: string = "";
  private activeId: string | null = null;

  constructor(handlers: TocPanelHandlers, host: HTMLElement) {
    this.handlers = handlers;
    this.root = host.createDiv({ cls: "ez-reader__reader-panel ez-reader__reader-panel--toc is-hidden" });
    this.render();
  }

  setToc(items: ReadonlyArray<TocItem>): void {
    this.items = items;
    this.query = "";
    this.render();
  }

  setActive(id: string | null): void {
    this.activeId = id;
    // 旧 active 一定要清掉 — 不清会导致用户跳到一个不在当前过滤列表的章节时,
    // 上一章节仍然高亮, 视觉上没反应.
    this.refreshActiveStyles();
  }

  show(): void {
    this.root.removeClass("is-hidden");
  }

  hide(): void {
    this.root.addClass("is-hidden");
  }

  toggle(): void {
    this.root.toggleClass("is-hidden", this.root.hasClass("is-hidden") ? false : true);
  }

  isVisible(): boolean {
    return !this.root.hasClass("is-hidden");
  }

  private render(): void {
    this.root.empty();
    const headerRow = this.root.createDiv({ cls: "ez-reader__toc-header" });
    headerRow.createEl("h3", { text: "目录" });
    if (this.items.length >= 8) {
      const search = headerRow.createEl("input", {
        attr: { type: "search", placeholder: "搜索章节...", "aria-label": "搜索章节" }
      });
      search.addClass("ez-reader__toc-search");
      search.value = this.query;
      search.addEventListener("input", () => {
        this.query = search.value.trim().toLocaleLowerCase();
        this.renderList();
      });
    }
    if (this.items.length === 0) {
      this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: "本书没有可用目录。"
      });
      return;
    }
    this.renderList();
  }

  private renderList(): void {
    const old = this.root.querySelector(".ez-reader__toc-list");
    if (old) old.remove();
    const filtered = this.query
      ? this.items.filter((it) => it.label.toLocaleLowerCase().includes(this.query))
      : this.items;
    if (filtered.length === 0) {
      const empty = this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: `没有匹配的章节 (${this.query}).`
      });
      empty.addClass("ez-reader__toc-list");
      return;
    }
    const list = this.root.createDiv({ cls: "ez-reader__toc-list" });
    for (const item of filtered) {
      const button = list.createEl("button", {
        text: item.label,
        attr: { type: "button", "data-toc-id": item.id, title: item.label, "aria-label": `跳到 ${item.label}` }
      });
      button.addClass("ez-reader__toc-item");
      button.style.paddingInlineStart = `${0.5 + item.depth * 1}rem`;
      button.onclick = () => this.handlers.onJump(item);
    }
    this.refreshActiveStyles();
  }

  private refreshActiveStyles(): void {
    const buttons = this.root.querySelectorAll<HTMLButtonElement>(".ez-reader__toc-item");
    buttons.forEach((b) => {
      b.toggleClass("is-active", b.getAttribute("data-toc-id") === this.activeId);
    });
  }
}
