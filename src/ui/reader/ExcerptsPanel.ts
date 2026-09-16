import type { Excerpt } from "../../core/entities/Excerpt";

export interface ExcerptsPanelHandlers {
  onJump: (excerpt: Excerpt) => void;
  onRemove: (excerpt: Excerpt) => void;
  /** Close button on panel header — user-facing escape hatch. */
  onClose?: () => void;
}

export class ExcerptsPanel {
  readonly root: HTMLElement;
  private readonly handlers: ExcerptsPanelHandlers;
  private excerpts: ReadonlyArray<Excerpt> = [];

  constructor(handlers: ExcerptsPanelHandlers, host: HTMLElement) {
    this.handlers = handlers;
    this.root = host.createDiv({ cls: "ez-reader__reader-panel is-hidden" });
    this.render();
  }

  setExcerpts(excerpts: ReadonlyArray<Excerpt>): void {
    this.excerpts = excerpts;
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
    titleRow.createEl("h3", { text: "摘录" });
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
    if (this.excerpts.length === 0) {
      this.root.createDiv({ cls: "ez-reader__reader-panel__empty", text: "本书还没有摘录。" });
      return;
    }
    for (const excerpt of this.excerpts) {
      const row = this.root.createDiv({ cls: "ez-reader__excerpt-row" });
      row.createEl("blockquote", { text: excerpt.text });
      if (excerpt.note) row.createEl("p", { text: excerpt.note, cls: "ez-reader__excerpt-row__note" });
      const actions = row.createDiv({ cls: "ez-reader__excerpt-row__actions" });
      const jump = actions.createEl("button", { text: "跳到位置", attr: { type: "button" } });
      jump.onclick = () => this.handlers.onJump(excerpt);
      const remove = actions.createEl("button", { text: "删除", attr: { type: "button" } });
      remove.onclick = () => this.handlers.onRemove(excerpt);
    }
  }
}