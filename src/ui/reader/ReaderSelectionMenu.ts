export interface SelectionMenuHandlers {
  onExcerpt: () => void;
  onCopy: () => void;
  onTranslate: () => void;
}

/**
 * Floating menu that appears beneath a selected range. The host positions it
 * by giving us the bounding rect of the selection on every update.
 */
export class ReaderSelectionMenu {
  readonly root: HTMLElement;
  private readonly handlers: SelectionMenuHandlers;
  private currentRect: DOMRect | null = null;

  constructor(handlers: SelectionMenuHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__selection-menu");
    this.root.addClass("is-hidden");
    const excerpt = this.root.createEl("button", { text: "摘录", attr: { type: "button" } });
    excerpt.addEventListener("click", () => {
      this.hide();
      this.handlers.onExcerpt();
    });
    const copy = this.root.createEl("button", { text: "复制", attr: { type: "button" } });
    copy.addEventListener("click", () => {
      this.hide();
      this.handlers.onCopy();
    });
    const translate = this.root.createEl("button", { text: "翻译", attr: { type: "button" } });
    translate.addEventListener("click", () => {
      this.hide();
      this.handlers.onTranslate();
    });
    document.body.append(this.root);
  }

  show(rect: DOMRect): void {
    this.currentRect = rect;
    this.root.removeClass("is-hidden");
    const top = rect.bottom + window.scrollY + 6;
    const left = rect.left + window.scrollX;
    this.root.style.top = `${top}px`;
    this.root.style.left = `${left}px`;
  }

  hide(): void {
    this.currentRect = null;
    this.root.addClass("is-hidden");
  }

  isVisible(): boolean {
    return this.currentRect !== null;
  }

  destroy(): void {
    this.root.remove();
  }
}