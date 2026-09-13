import type { TocItem } from "../../core/ports/BookReader";

export interface TocPanelHandlers {
  onJump: (item: TocItem) => void;
}

/**
 * Top-of-page table of contents panel. Mirrors BookmarksPanel.ts style:
 * a collapsible section that toggles via a class. Items render with
 * per-depth indentation so the chapter hierarchy reads top-down.
 */
export class TocPanel {
  readonly root: HTMLElement;
  private readonly handlers: TocPanelHandlers;
  private items: ReadonlyArray<TocItem> = [];
  private activeId: string | null = null;

  constructor(handlers: TocPanelHandlers, host: HTMLElement) {
    this.handlers = handlers;
    this.root = host.createDiv({ cls: "ez-reader__reader-panel ez-reader__reader-panel--toc is-hidden" });
    this.render();
  }

  setToc(items: ReadonlyArray<TocItem>): void {
    this.items = items;
    this.render();
  }

  setActive(id: string | null): void {
    this.activeId = id;
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
    this.root.createEl("h3", { text: "目录" });
    if (this.items.length === 0) {
      this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: "本书没有可用目录。"
      });
      return;
    }
    const list = this.root.createDiv({ cls: "ez-reader__toc-list" });
    for (const item of this.items) {
      const button = list.createEl("button", {
        text: item.label,
        attr: { type: "button", "data-toc-id": item.id, title: item.label }
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
