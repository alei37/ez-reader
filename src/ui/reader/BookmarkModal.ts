import { Modal } from "obsidian";
import type { App } from "obsidian";

/**
 * P1: BookmarkModal 现在显示位置上下文 (chapter + percentage + 时间 + 当前选中文字),
 * 帮用户知道"这个书签是哪个位置的", 而不是输入框 + submit 之后才知道.
 *
 * Returns `null` on cancel / Esc / overlay click so the caller can
 * distinguish "user cancelled" from "user submitted blank label".
 */
export interface BookmarkModalContext {
  /** Current chapter label (e.g. "Chapter 3: Wave Propagation"). */
  readonly chapter: string;
  /** Reading progress 0..1. */
  readonly fraction: number;
  /** Optional preview text — currently-selected text or nearby sentence.
   *  Used as default label and shown in the modal as visual context. */
  readonly preview: string;
  /** ISO-style timestamp for the bookmark being created. */
  readonly timestamp: number;
}

export class BookmarkModal extends Modal {
  private resolver: ((label: string | null) => void) | null = null;
  private readonly context: BookmarkModalContext;
  private readonly fallbackLabel: string;

  constructor(app: App, context: BookmarkModalContext, initialLabel = "") {
    super(app);
    this.context = context;
    this.fallbackLabel = initialLabel || context.preview || context.chapter || "未命名书签";
  }

  openAndWait(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private settle(label: string | null): void {
    const r = this.resolver;
    this.resolver = null;
    r?.(label);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "添加书签" });

    // 位置上下文 — 让用户立即看到"在哪儿加书签"
    const contextBox = contentEl.createDiv({ cls: "ez-reader__bookmark-modal__context" });
    const metaRow = contextBox.createDiv({ cls: "ez-reader__bookmark-modal__meta" });
    if (this.context.chapter) {
      metaRow.createSpan({ text: this.context.chapter, cls: "ez-reader__bookmark-modal__chapter" });
    }
    metaRow.createSpan({
      text: `${Math.round(this.context.fraction * 100)}%`,
      cls: "ez-reader__bookmark-modal__progress"
    });
    metaRow.createSpan({
      text: new Date(this.context.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      cls: "ez-reader__bookmark-modal__time"
    });
    if (this.context.preview) {
      const preview = contextBox.createDiv({ cls: "ez-reader__bookmark-modal__preview" });
      preview.createEl("blockquote", { text: this.context.preview });
    }

    const inputLabel = contentEl.createEl("p", { text: "书签名称 (可改):", cls: "ez-reader__bookmark-modal__label" });
    const input = contentEl.createEl("input", { attr: { type: "text" } });
    input.value = this.fallbackLabel;
    input.addClass("ez-reader__bookmark-input");
    input.placeholder = "例如:第三章的关键论点";
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.onclick = () => {
      this.settle(null);
      this.close();
    };
    const submit = actions.createEl("button", { text: "添加", attr: { type: "button" } });
    submit.addClass("mod-cta");
    submit.onclick = () => {
      this.settle(input.value);
      this.close();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.settle(input.value);
        this.close();
      }
    });
    window.setTimeout(() => {
      try {
        input.focus();
        // 全选 label 让用户立即覆盖 default
        input.select();
      } catch (error) {
        // C5 修复: modal 在 timer fire 前已关闭 — input 被 detach, focus
        // 抛 InvalidStateError. 静默吞: 用户体验: modal 已关, 不是错误.
        console.debug("[ez-reader] bookmark focus skipped — modal closed", error);
      }
    }, 0);
  }

  onClose(): void {
    // Esc / overlay click: 视为取消. resolve(null) 让 caller 能区分
    // "用户提交了空 label" 跟 "用户取消".
    if (this.resolver) this.settle(null);
  }
}
