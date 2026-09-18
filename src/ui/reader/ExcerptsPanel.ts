import type { App } from "obsidian";
import type { Excerpt } from "../../core/entities/Excerpt";
import { ConfirmModal } from "./ConfirmModal";

export interface ExcerptsPanelHandlers {
  onJump: (excerpt: Excerpt) => void;
  onRemove: (excerpt: Excerpt) => void;
  /** Close button on panel header — user-facing escape hatch. */
  onClose?: () => void;
}

/**
 * P1 polish: 摘录面板现在每条清晰显示
 *   - chapter (从 locator.chapter) + 创建时间
 *   - 摘录原文 (blockquote, 浅灰底); 自由想法 (text 为空) 显示 "💭 自由想法"
 *     badge 替代空白 blockquote
 *   - note / 想法 (如果有, 浅黄底, 跟原文视觉区分)
 *   - tags
 *   - 右下角动作: 跳到原文 / 删除 (灰色按钮, 不像待办)
 * 之前只有原文 + note + 跳转/删除, 用户看不出"摘录到哪 + 评论在哪".
 * P1 修复: 之前空 text 的"自由想法"摘录在 panel 里只显示空白 blockquote —
 * 因为 openFreeThoughtModal 创建的 excerpt.text 为 "". 现在统一在 panel
 * 里用 badge 显示, SidebarNotesPanel 仍然独立展示想法.
 * 删除走 ConfirmModal (跟 SidebarNotesPanel 一致) — Obsidian 移动端 WebView
 * 不用 globalThis.confirm().
 */
export class ExcerptsPanel {
  readonly root: HTMLElement;
  private readonly handlers: ExcerptsPanelHandlers;
  private readonly app: App | null;
  private excerpts: ReadonlyArray<Excerpt> = [];

  constructor(handlers: ExcerptsPanelHandlers & { app?: App }, host: HTMLElement) {
    this.handlers = handlers;
    this.app = handlers.app ?? null;
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
    titleRow.createSpan({
      text: `(${this.excerpts.length})`,
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
    if (this.excerpts.length === 0) {
      this.root.createDiv({ cls: "ez-reader__reader-panel__empty", text: "本书还没有摘录。" });
      return;
    }
    // newest first
    const ordered = [...this.excerpts].sort((a, b) => b.createdAt - a.createdAt);
    for (const excerpt of ordered) {
      const card = this.root.createDiv({ cls: "ez-reader__excerpt-card" });

      // 上下文 (chapter + 时间) — 让用户立即知道摘录在哪
      const metaLine = card.createDiv({ cls: "ez-reader__excerpt-card__meta" });
      if (excerpt.locator.chapter) {
        metaLine.createSpan({
          text: excerpt.locator.chapter,
          cls: "ez-reader__excerpt-card__chapter"
        });
      }
      const ts = new Date(excerpt.createdAt).toLocaleDateString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      metaLine.createSpan({ text: ts, cls: "ez-reader__excerpt-card__time" });

      // 摘录原文 (blockquote, 浅灰底). 如果 text 为空说明是"自由想法"
      // (notes panel 的 +想法 走 openFreeThoughtModal, 不传 selection text),
      // 用浅黄底 placeholder 标识, 不渲染空白 blockquote.
      if (excerpt.text && excerpt.text.trim()) {
        const quote = card.createEl("blockquote", {
          text: excerpt.text,
          cls: "ez-reader__excerpt-card__quote"
        });
        quote.setAttribute("title", excerpt.text);
      } else {
        const placeholder = card.createDiv({
          cls: "ez-reader__excerpt-card__thought-badge"
        });
        placeholder.setText("💭 自由想法");
      }

      // note / 想法 (如果有, 浅黄底)
      if (excerpt.note) {
        card.createEl("p", {
          text: excerpt.note,
          cls: "ez-reader__excerpt-card__note"
        });
      }

      // tags
      if (excerpt.tags.length > 0) {
        const tagsLine = card.createDiv({ cls: "ez-reader__excerpt-card__tags" });
        for (const tag of excerpt.tags) {
          tagsLine.createSpan({ text: `#${tag}`, cls: "ez-reader__excerpt-card__tag" });
        }
      }

      // 动作 — 跳到原文 / 删除
      const actions = card.createDiv({ cls: "ez-reader__excerpt-card__actions" });
      const jump = actions.createEl("button", {
        text: "跳到原文",
        attr: { type: "button", title: "跳到摘录所在位置", "aria-label": "跳到原文" }
      });
      jump.addClass("ez-reader__excerpt-card__btn");
      jump.onclick = () => this.handlers.onJump(excerpt);
      const remove = actions.createEl("button", {
        text: "删除",
        attr: { type: "button", title: "删除摘录(笔记 / 高亮也会删除)", "aria-label": "删除摘录" }
      });
      remove.addClass("ez-reader__excerpt-card__btn");
      remove.addClass("ez-reader__excerpt-card__btn--danger");
      remove.onclick = async () => {
        const doRemove = async (): Promise<void> => this.handlers.onRemove(excerpt);
        if (this.app) {
          const ok = await new ConfirmModal(
            this.app,
            "删除这条摘录?",
            "笔记 + 高亮也会删除。进度、书签、其它笔记不受影响。",
            "删除"
          ).openAndWait();
          if (ok) await doRemove();
        } else {
          // 退化路径 — 没有 app 也能删 (仅测试环境)
          await doRemove();
        }
      };
    }
  }
}
