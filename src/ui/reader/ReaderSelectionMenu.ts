export interface SelectionMenuHandlers {
  onExcerpt: () => void;
  onThought: () => void;
  onCopy: () => void;
  onTranslate: () => void;
}

import { computeSelectionMenuPosition } from "./selectionMenuPosition";

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

  show(rect: DOMRect, hostOffset?: { x: number; y: number }): void {
    // P0 修复: EPUB 的 selection rect 是 iframe-viewport 相对,需要加上
    // iframe 在 host 页面里的 offset 才能转到 host viewport 坐标. 之前
    // 直接用 host viewport 算位置,菜单飘到屏幕左上角.
    const adjusted: DOMRect = hostOffset
      ? offsetRect(rect, hostOffset.x, hostOffset.y)
      : rect;
    this.currentRect = adjusted;
    this.root.removeClass("is-hidden");
    // 纯函数计算位置 — 测试覆盖各种 viewport / rect 组合, 见
    // tests/core/SelectionMenuPosition.test.ts.
    const menuRect = this.root.getBoundingClientRect();
    const pos = computeSelectionMenuPosition(adjusted, menuRect, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    // P0 修复: 之前 `pos.top + window.scrollY` 把 viewport 坐标错误转成
    // 文档坐标, 但 menu 元素 `position: absolute` 挂在 document.body
    // (没有 positioned 祖先), initial containing block 是 viewport —
    // top/left 必须是 viewport 坐标, 不需要加 scrollX/scrollY. 加了导致
    // 用户在 main window 滚到 reader 区域时, 菜单相对选区偏 scrollY 像素
    // (用户报告的"跳窗口"现象).
    this.root.style.top = `${pos.top}px`;
    this.root.style.left = `${pos.left}px`;
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

const offsetRect = (rect: DOMRect, dx: number, dy: number): DOMRect => {
  // DOMRect is a live viewport-relative box; constructor with offsets
  // gives us a translated copy without mutating the original.
  return new DOMRect(rect.left + dx, rect.top + dy, rect.width, rect.height);
};
