import { Modal } from "obsidian";
import type { App } from "obsidian";

/**
 * Lightweight confirmation modal. Replaces `globalThis.confirm()` calls
 * inside the reader — `confirm()` doesn't render well in Obsidian's
 * mobile WebView and is inconsistent with the rest of the plugin's UI.
 */
export class ConfirmModal extends Modal {
  private resolver: ((ok: boolean) => void) | null = null;

  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel = "确定",
    private readonly cancelLabel = "取消"
  ) {
    super(app);
  }

  openAndWait(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: this.cancelLabel, attr: { type: "button" } });
    cancel.onclick = () => {
      const r = this.resolver;
      this.resolver = null;
      this.close();
      r?.(false);
    };
    const confirm = actions.createEl("button", { text: this.confirmLabel, attr: { type: "button" } });
    confirm.addClass("mod-warning");
    confirm.onclick = () => {
      const r = this.resolver;
      this.resolver = null;
      this.close();
      r?.(true);
    };
    window.setTimeout(() => confirm.focus(), 0);
  }

  onClose(): void {
    if (this.resolver) {
      const r = this.resolver;
      this.resolver = null;
      r?.(false);
    }
  }
}