export interface SearchBarHandlers {
  /** User submitted a new query — reset to first match. */
  onSearchFromStart: (query: string) => void;
  /** User pressed Enter on the same query — advance to next match. */
  onSearch: (query: string) => void;
  /** User dismissed the bar (Esc / × button). */
  onClose: () => void;
}

/**
 * Floating search bar pinned to the top center of the reader. Mirrors
 * `ReaderSelectionMenu`'s "always in body, viewport-fixed" pattern so
 * PDF / EPUB / paged-text engines can all share it without worrying
 * about iframe boundaries.
 *
 * Layout: [input..............] [↑] [↓] [×]
 *  - Enter (current query)   → onSearch (next match)
 *  - Enter on new query      → onSearchFromStart
 *  - Shift+Enter             → onSearchFromStart (cycle back to first)
 *  - Esc                     → onClose
 */
export class SearchBar {
  readonly root: HTMLElement;
  private readonly handlers: SearchBarHandlers;
  private readonly input: HTMLInputElement;
  private currentQuery = "";
  private isVisible = false;
  // C5 修复: show() 里 50ms 延迟 focus 的 setTimeout handle, 让 destroy() clear.
  private focusTimer: number | undefined;
  private readonly documentKeydown: (event: KeyboardEvent) => void;
  private readonly inputKeydown: (event: KeyboardEvent) => void;

  constructor(handlers: SearchBarHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__search-bar");
    this.root.addClass("is-hidden");
    this.root.setAttribute("role", "search");
    this.root.setAttribute("aria-label", "搜索书内文字");

    this.input = this.root.createEl("input", {
      attr: { type: "search", placeholder: "搜索书内文字……", "aria-label": "搜索" }
    });
    this.input.addClass("ez-reader__search-bar__input");

    const nextBtn = this.root.createEl("button", {
      text: "↓",
      attr: { type: "button", title: "下一处匹配 (Enter)", "aria-label": "下一处" }
    });
    nextBtn.addClass("ez-reader__search-bar__btn");
    nextBtn.addEventListener("click", (event) => {
      event.preventDefault();
      this.commit(false);
    });

    const prevBtn = this.root.createEl("button", {
      text: "↑",
      attr: { type: "button", title: "上一处匹配 (Shift+Enter)", "aria-label": "上一处" }
    });
    prevBtn.addClass("ez-reader__search-bar__btn");
    prevBtn.addEventListener("click", (event) => {
      event.preventDefault();
      this.commit(true);
    });

    const closeBtn = this.root.createEl("button", {
      text: "×",
      attr: { type: "button", title: "关闭搜索 (Esc)", "aria-label": "关闭" }
    });
    closeBtn.addClass("ez-reader__search-bar__btn", "ez-reader__search-bar__close");
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      this.handlers.onClose();
    });

    this.inputKeydown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.commit(event.shiftKey);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onClose();
      }
    };
    this.input.addEventListener("keydown", this.inputKeydown);

    // 防止输入文字时 reader 的全局快捷键 handler 拦截 — 当 input
    // 聚焦时, keydown 也会 bubble 到 containerEl 触发 prev/next. 用
    // 一个 document 级的 capture listener 拦截 escape 等全局键。
    this.documentKeydown = (event: KeyboardEvent) => {
      if (!this.isVisible) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onClose();
      }
    };
    document.addEventListener("keydown", this.documentKeydown, true);

    document.body.append(this.root);
  }

  show(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    this.root.removeClass("is-hidden");
    this.input.value = this.currentQuery;
    // C5 修复: 存 setTimeout handle 让 destroy() clear. show → 立即 destroy()
    // 序列 (例如 user 在 50ms 内切到笔记) 不会让 focus 在 detached input
    // 上 throw DOMException. 同 100ms 延迟 — 让 CSS transition 跑完, 否则
    // 动画期间的 focus 在某些 WebView 上会让动画卡顿。
    if (this.focusTimer !== undefined) {
      window.clearTimeout(this.focusTimer);
    }
    this.focusTimer = window.setTimeout(() => {
      this.focusTimer = undefined;
      try {
        this.input.focus();
        this.input.select();
      } catch (error) {
        console.debug("[ez-reader] search bar focus skipped — destroyed", error);
      }
    }, 50);
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.root.addClass("is-hidden");
    this.input.blur();
  }

  /** Set / reset the displayed query — used when the host runs an
   *  external search and wants the bar to reflect the active term. */
  setQuery(query: string): void {
    this.currentQuery = query;
    if (this.isVisible) this.input.value = query;
  }

  destroy(): void {
    if (this.focusTimer !== undefined) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = undefined;
    }
    document.removeEventListener("keydown", this.documentKeydown, true);
    this.root.remove();
  }

  private commit(fromStart: boolean): void {
    const value = this.input.value.trim();
    this.currentQuery = value;
    if (fromStart) this.handlers.onSearchFromStart(value);
    else this.handlers.onSearch(value);
  }
}
