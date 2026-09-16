import { Modal } from "obsidian";
import type { App } from "obsidian";

export type OnboardingChoice = "addBooks" | "later";

/**
 * First-launch onboarding modal. Surfaces once the very first time a user
 * opens the shelf on a fresh vault. Explains what the plugin does, then
 * either drops them straight into the AddToLibrary flow (the most common
 * path) or dismisses with a "later" button.
 *
 * State ("have we shown this already?") is persisted on the
 * AnnotationSnapshot — see `AnnotationStore.saveOnboardingDismissed`.
 */
export class OnboardingModal extends Modal {
  private resolver: ((choice: OnboardingChoice | null) => void) | null = null;

  constructor(app: App) {
    super(app);
  }

  /**
   * Resolves to the user's choice, or null if they closed the modal
   * without picking anything (Esc / overlay click / X button).
   */
  openAndWait(): Promise<OnboardingChoice | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__onboarding");

    contentEl.createEl("h2", { text: "欢迎使用 EzReader" });
    contentEl.createEl("p", {
      cls: "ez-reader__onboarding__lede",
      text: "在 Obsidian 里读你 Vault 里的电子书,支持 EPUB 和 PDF,带进度、书签、摘录与翻译。"
    });

    const steps = contentEl.createDiv({ cls: "ez-reader__onboarding__steps" });
    const step = (n: number, title: string, body: string): void => {
      const row = steps.createDiv({ cls: "ez-reader__onboarding__step" });
      row.createEl("span", { text: String(n), cls: "ez-reader__onboarding__step-num" });
      const text = row.createDiv({ cls: "ez-reader__onboarding__step-text" });
      text.createEl("strong", { text: title });
      text.createEl("p", { text: body });
    };

    step(
      1,
      "把书放进 Vault",
      "EPUB 或 PDF 都可以。放在 Vault 内任意子目录都行 — 不会移动原文件。"
    );
    step(
      2,
      "加入你的第一本书",
      "在工具栏点击 + 加入书籍(或点这里下面的按钮),从候选列表勾选想追踪的书。"
    );
    step(
      3,
      "点击封面进入阅读器",
      "支持字号、行距、主题、选词翻译 / 摘录 / 复制,进度自动保存。"
    );

    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const later = actions.createEl("button", { text: "稍后", attr: { type: "button" } });
    later.onclick = () => this.settle("later");
    const add = actions.createEl("button", { text: "开始加书", attr: { type: "button" } });
    add.addClass("mod-cta");
    add.onclick = () => this.settle("addBooks");
  }

  onClose(): void {
    // Esc / overlay click — treat as "later" so we don't nag again next
    // time the shelf opens.
    if (this.resolver) this.settle("later");
  }

  private settle(choice: OnboardingChoice): void {
    const r = this.resolver;
    this.resolver = null;
    this.close();
    r?.(choice);
  }
}