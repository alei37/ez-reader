import { Modal } from "obsidian";
import type { App } from "obsidian";

export interface ThoughtInput {
  /** Optional: the text the user had selected when "想法" was tapped. */
  readonly text: string;
  /** Pre-filled chapter / location for context. */
  readonly chapter?: string;
}

export interface ThoughtSubmit {
  note: string;
  tags: ReadonlyArray<string>;
}

/**
 * Two-mode modal:
 *   - "thought" (no selection) — captures a free-floating idea while
 *     reading. Saves with a `^thought-<timestamp>` block ID.
 *   - "annotation" (with selection) — captures a thought that's bound
 *     to a specific excerpt. Saves with `^<excerptId>` block ID so the
 *     thought is part of the same Obsidian block as the excerpt.
 */
export class ThoughtModal extends Modal {
  private readonly input: ThoughtInput;
  private resolver!: (result: ThoughtSubmit | null) => void;

  constructor(app: App, input: ThoughtInput) {
    super(app);
    this.input = input;
  }

  openAndWait(): Promise<ThoughtSubmit | null> {
    return new Promise<ThoughtSubmit | null>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__thought-modal");
    contentEl.createEl("h2", { text: this.input.text ? "为这段文字写下想法" : "写下你的想法" });
    if (this.input.text) {
      contentEl.createEl("blockquote", { text: this.input.text });
    }
    if (this.input.chapter) {
      contentEl.createEl("p", {
        cls: "ez-reader__thought-modal__chapter",
        text: `所在: ${this.input.chapter}`
      });
    }
    const noteInput = contentEl.createEl("textarea");
    noteInput.addClass("ez-reader__thought-modal__input");
    noteInput.placeholder = "你的想法……";
    const tagsInput = contentEl.createEl("input", { attr: { type: "text" } });
    tagsInput.addClass("ez-reader__thought-modal__tags");
    tagsInput.placeholder = "主题标签(可选,用空格或逗号分隔)";

    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.onclick = () => {
      this.resolver(null);
      this.close();
    };
    const submit = actions.createEl("button", { text: "保存想法", attr: { type: "button" } });
    submit.addClass("mod-cta");
    submit.onclick = () => {
      this.resolver({
        note: noteInput.value.trim(),
        tags: parseTags(tagsInput.value)
      });
      this.close();
    };

    window.setTimeout(() => noteInput.focus(), 0);
    noteInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        submit.click();
      }
    });
  }
}

const parseTags = (raw: string): string[] => {
  const tokens = raw.split(/[\s,,]+/);
  const seen = new Set<string>();
  for (const token of tokens) {
    const cleaned = token.replace(/^#+/, "").replace(/[^\p{L}\p{N}_/-]/gu, "").slice(0, 60);
    if (cleaned) seen.add(cleaned);
    if (seen.size >= 12) break;
  }
  return [...seen];
};
