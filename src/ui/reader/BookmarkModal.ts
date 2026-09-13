import { Modal } from "obsidian";
import type { App } from "obsidian";

/**
 * Simple Modal that asks the user for an optional bookmark label. The host
 * resolves with the entered string (possibly empty) on submit, or
 * with an empty string on cancel / Esc / overlay click.
 */
export class BookmarkModal extends Modal {
  private resolver: ((label: string) => void) | null = null;

  constructor(app: App, private readonly initialLabel = "") {
    super(app);
  }

  openAndWait(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private settle(label: string): void {
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
      this.settle("");
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
    // Esc / overlay click: 视为取消(空 label). 不调 resolver 会让
    // openAndWait() 的 Promise 永远 pending.
    if (this.resolver) this.settle("");
  }
}
