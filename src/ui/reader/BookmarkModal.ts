import { Modal } from "obsidian";
import type { App } from "obsidian";

/**
 * Simple Modal that asks the user for an optional bookmark label. The host
 * resolves with the entered string on submit, or `null` on cancel / Esc /
 * overlay click. Returning `null` (not empty string) is what lets the
 * caller distinguish "user cancelled" from "user submitted blank label".
 *
 * Previously this returned `""` for cancellation, which made the host's
 * `if (label === null) return` guard useless — empty-label bookmarks
 * were being created on every cancel.
 */
export class BookmarkModal extends Modal {
  private resolver: ((label: string | null) => void) | null = null;

  constructor(app: App, private readonly initialLabel = "") {
    super(app);
  }

  openAndWait(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
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
    contentEl.createEl("p", { text: "可选：为书签填写名称或简短说明。" });
    const input = contentEl.createEl("input", { attr: { type: "text" } });
    input.value = this.initialLabel;
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
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    // Esc / overlay click: 视为取消. resolve(null) 让 caller 能区分
    // "用户提交了空 label" 跟 "用户取消".
    if (this.resolver) this.settle(null);
  }
}