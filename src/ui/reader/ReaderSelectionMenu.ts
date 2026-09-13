export interface SelectionMenuHandlers {
  onExcerpt: () => void;
  onThought: () => void;
  onCopy: () => void;
  onTranslate: () => void;
}

/**
 * Floating action menu that appears below a selection. Designed to be
 * triggered automatically by the `selection-change` event from the
 * reader session — no need for the user to first tap a "tools" button.
 *
 * Layout: [想法] [摘录] [翻译] [复制]
 * "想法" is the primary CTA because reading → thinking is the most
 * common flow. We auto-dismiss on outside click / selection collapse.
 */
export class ReaderSelectionMenu {
  readonly root: HTMLElement;
  private readonly handlers: SelectionMenuHandlers;
  private currentRect: DOMRect | null = null;
  private readonly documentMouseDown: (event: MouseEvent) => void;
  private readonly documentSelectionChange: () => void;

  constructor(handlers: SelectionMenuHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__selection-menu");
    this.root.addClass("is-hidden");
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "选中文本操作");

    const make = (label: string, title: string, key: keyof SelectionMenuHandlers, primary = false): HTMLButtonElement => {
      const btn = this.root.createEl("button", {
        text: label,
        attr: { type: "button", title, "aria-label": title, "aria-keyshortcuts": key }
      });
      if (primary) btn.addClass("is-primary");
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
        // 主动清掉选区,避免 modal 关闭后 selectionchange 又把菜单弹出来
        const sel = document.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
        this.handlers[key]();
      });
      return btn;
    };

    make("想法", "为这段文字写想法(自动记到侧边栏笔记)", "onThought", true);
    make("摘录", "保存为摘录(高亮 + 笔记)", "onExcerpt");
    make("翻译", "调用翻译服务翻译这段文字", "onTranslate");
    make("复制", "复制到剪贴板", "onCopy");

    document.body.append(this.root);

    // Auto-dismiss handlers. We listen at the document level so clicking
    // anywhere outside the menu closes it; selection-collapse also closes.
    this.documentMouseDown = (event: MouseEvent) => {
      if (this.root.contains(event.target as Node)) return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) return; // user is making a new selection
      this.hide();
    };
    this.documentSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) {
        this.hide();
      }
    };
    document.addEventListener("mousedown", this.documentMouseDown);
    document.addEventListener("selectionchange", this.documentSelectionChange);
  }

  show(rect: DOMRect): void {
    this.currentRect = rect;
    this.root.removeClass("is-hidden");
    // Position above the selection if it would overflow the viewport bottom;
    // below otherwise. Pick whichever keeps the menu fully on-screen.
    const margin = 8;
    const menuRect = this.root.getBoundingClientRect();
    const below = rect.bottom + 6 + menuRect.height <= window.innerHeight - margin;
    const top = below ? rect.bottom + window.scrollY + 6 : rect.top + window.scrollY - menuRect.height - 6;
    let left = rect.left + window.scrollX;
    const overflowRight = left + menuRect.width - (window.innerWidth - margin);
    if (overflowRight > 0) left = Math.max(margin, left - overflowRight);
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
    document.removeEventListener("mousedown", this.documentMouseDown);
    document.removeEventListener("selectionchange", this.documentSelectionChange);
    this.root.remove();
  }
}
