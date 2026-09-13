import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { TranslationService } from "../../core/ports/TranslationProvider";
import type { Locale } from "../../core/types/Locale";

export interface TranslationInput {
  text: string;
  source: Locale;
  target: Locale;
}

export type TranslationOutcome =
  | { kind: "ok"; text: string; detectedSource: string | null; provider: string }
  | { kind: "error"; message: string };

/**
 * Modal that asks the translation coordinator for a translation and renders
 * the result in-place. Phase 1.2 keeps the modal wired up; the underlying
 * provider only carries real network code in Phase 1.3.
 */
export class TranslationModal extends Modal {
  private readonly input: TranslationInput;

  constructor(
    app: App,
    private readonly service: TranslationService,
    input: TranslationInput
  ) {
    super(app);
    this.input = input;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "翻译" });
    contentEl.createEl("blockquote", { text: this.input.text });
    const resultEl = contentEl.createDiv({ cls: "ez-reader__translation-result" });
    resultEl.setText("正在调用翻译服务…");
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const close = actions.createEl("button", { text: "关闭", attr: { type: "button" } });
    close.onclick = () => this.close();

    void this.service
      .translate(this.input.text, this.input.source, this.input.target)
      .then((result) => {
        resultEl.empty();
        resultEl.createEl("p", { text: result.text, cls: "ez-reader__translation-result__text" });
        if (result.detectedSource) {
          resultEl.createEl("p", {
            text: `检测到源语言: ${result.detectedSource} · 提供方: ${result.providerId}`,
            cls: "ez-reader__translation-result__meta"
          });
        }
      })
      .catch((error: unknown) => {
        resultEl.empty();
        const message = error instanceof Error ? error.message : String(error);
        resultEl.createEl("p", { text: message, cls: "ez-reader__translation-result__error" });
      });
  }
}