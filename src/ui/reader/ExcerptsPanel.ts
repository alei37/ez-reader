import type { Excerpt } from "../../core/entities/Excerpt";

export interface ExcerptsPanelHandlers {
  onJump: (excerpt: Excerpt) => void;
  onRemove: (excerpt: Excerpt) => void;
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

  private render(): void {
    this.root.empty();
    this.root.createEl("h3", { text: "摘录" });
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