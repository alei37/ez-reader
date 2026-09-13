import { Modal } from "obsidian";
import type { App } from "obsidian";

export interface ExcerptInput {
  text: string;
}

export interface ExcerptSubmit {
  note: string;
  tags: ReadonlyArray<string>;
}

export class ExcerptModal extends Modal {
  private readonly input: ExcerptInput;
  private resolver: ((result: ExcerptSubmit | null) => void) | null = null;

  constructor(app: App, input: ExcerptInput) {
    super(app);
    this.input = input;
  }

  openAndWait(): Promise<ExcerptSubmit | null> {
    return new Promise<ExcerptSubmit | null>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private settle(result: ExcerptSubmit | null): void {
    const r = this.resolver;
    this.resolver = null;
    r?.(result);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "保存摘录" });
    contentEl.createEl("p", { text: "所选文字会保存到插件数据;不会修改原始电子书。" });
    contentEl.createEl("blockquote", { text: this.input.text });
    const noteInput = contentEl.createEl("textarea");
    noteInput.addClass("ez-reader__excerpt-input");
    noteInput.placeholder = "可选:为这段摘录写下随想";
    const tagsInput = contentEl.createEl("input", { attr: { type: "text" } });
    tagsInput.addClass("ez-reader__excerpt-tags");
    tagsInput.placeholder = "主题标签(可选,用空格或逗号分隔)";
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.onclick = () => {
      this.settle(null);
      this.close();
    };
    const submit = actions.createEl("button", { text: "保存摘录", attr: { type: "button" } });
    submit.addClass("mod-cta");
    submit.onclick = () => {
      this.settle({
        note: noteInput.value.trim(),
        tags: parseTags(tagsInput.value)
      });
      this.close();
    };
    noteInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit.click();
      }
    });
    window.setTimeout(() => noteInput.focus(), 0);
  }

  onClose(): void {
    // Esc / overlay click 视为取消.
    if (this.resolver) this.settle(null);
  }
}

const parseTags = (raw: string): string[] => {
  const tokens = raw.split(/[\s,，]+/);
  const seen = new Set<string>();
  for (const token of tokens) {
    const cleaned = token.replace(/^#+/, "").replace(/[^\p{L}\p{N}_/-]/gu, "").slice(0, 60);
    if (cleaned) seen.add(cleaned);
    if (seen.size >= 12) break;
  }
  return [...seen];
};
