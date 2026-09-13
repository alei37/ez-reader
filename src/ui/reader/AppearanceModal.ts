import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { ReaderAppearance, ReaderTheme } from "../../core/types/ReaderSettings";

const FONT_SIZE_MIN = 60;
const FONT_SIZE_MAX = 200;
const LINE_HEIGHT_MIN = 1.0;
const LINE_HEIGHT_MAX = 2.4;
const MARGIN_MIN = 0;
const MARGIN_MAX = 80;

const THEMES: ReaderTheme[] = ["system", "light", "dark", "sepia"];

const themeLabel = (theme: ReaderTheme): string => {
  switch (theme) {
    case "light":
      return "白";
    case "dark":
      return "黑";
    case "sepia":
      return "米黄";
    default:
      return "系统";
  }
};

/**
 * Simple inline modal for tuning reader appearance: font size, line height,
 * page margin, and theme. Resolves to the chosen appearance, or null if
 * the user cancelled.
 */
export class AppearanceModal extends Modal {
  private resolver: ((appearance: ReaderAppearance | null) => void) | null = null;
  private readonly initial: ReaderAppearance;
  private fontSizeInput!: HTMLInputElement;
  private fontSizeValue!: HTMLElement;
  private lineHeightInput!: HTMLInputElement;
  private lineHeightValue!: HTMLElement;
  private marginInput!: HTMLInputElement;
  private marginValue!: HTMLElement;
  private themeButtons: Map<ReaderTheme, HTMLButtonElement> = new Map();
  private chosenTheme: ReaderTheme;

  constructor(app: App, initial: ReaderAppearance) {
    super(app);
    this.initial = initial;
    this.chosenTheme = initial.theme;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__appearance-modal");
    contentEl.createEl("h3", { text: "阅读外观" });

    // --- Font size ---
    const fontRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    fontRow.createEl("label", { text: "字号" });
    this.fontSizeInput = fontRow.createEl("input", { attr: { type: "range", min: String(FONT_SIZE_MIN), max: String(FONT_SIZE_MAX), step: "5" } });
    this.fontSizeInput.value = String(this.initial.fontSize);
    this.fontSizeValue = fontRow.createEl("span", { text: `${this.initial.fontSize}%` });
    this.fontSizeInput.addEventListener("input", () => {
      this.fontSizeValue.setText(`${this.fontSizeInput.value}%`);
    });

    // --- Line height ---
    const lineRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    lineRow.createEl("label", { text: "行距" });
    this.lineHeightInput = lineRow.createEl("input", { attr: { type: "range", min: String(LINE_HEIGHT_MIN), max: String(LINE_HEIGHT_MAX), step: "0.1" } });
    this.lineHeightInput.value = String(this.initial.lineHeight);
    this.lineHeightValue = lineRow.createEl("span", { text: this.initial.lineHeight.toFixed(1) });
    this.lineHeightInput.addEventListener("input", () => {
      this.lineHeightValue.setText(Number(this.lineHeightInput.value).toFixed(1));
    });

    // --- Page margin ---
    const marginRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    marginRow.createEl("label", { text: "页边距" });
    this.marginInput = marginRow.createEl("input", { attr: { type: "range", min: String(MARGIN_MIN), max: String(MARGIN_MAX), step: "4" } });
    this.marginInput.value = String(this.initial.margin);
    this.marginValue = marginRow.createEl("span", { text: `${this.initial.margin}px` });
    this.marginInput.addEventListener("input", () => {
      this.marginValue.setText(`${this.marginInput.value}px`);
    });

    // --- Theme ---
    const themeRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    themeRow.createEl("label", { text: "主题" });
    const themeWrap = themeRow.createDiv({ cls: "ez-reader__appearance-modal__themes" });
    for (const theme of THEMES) {
      const btn = themeWrap.createEl("button", { text: themeLabel(theme), attr: { type: "button" } });
      btn.addClass("ez-reader__pill");
      btn.toggleClass("is-active", theme === this.chosenTheme);
      btn.addEventListener("click", () => {
        this.chosenTheme = theme;
        for (const [other, otherBtn] of this.themeButtons) {
          otherBtn.toggleClass("is-active", other === theme);
        }
      });
      this.themeButtons.set(theme, btn);
    }

    // --- Actions ---
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.cancel());
    const confirm = actions.createEl("button", { text: "确认", attr: { type: "button" } });
    confirm.addClass("mod-cta");
    confirm.addEventListener("click", () => this.confirm());
  }

  /**
   * Resolves to the chosen appearance, or null if the user cancelled (or
   * closed via Esc / overlay click).
   */
  openAndWait(): Promise<ReaderAppearance | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private confirm(): void {
    const resolver = this.resolver;
    this.resolver = null;
    const appearance: ReaderAppearance = {
      fontSize: Number(this.fontSizeInput.value),
      lineHeight: Number(this.lineHeightInput.value),
      margin: Number(this.marginInput.value),
      theme: this.chosenTheme,
      flow: this.initial.flow
    };
    this.close();
    resolver?.(appearance);
  }

  private cancel(): void {
    const resolver = this.resolver;
    this.resolver = null;
    this.close();
    resolver?.(null);
  }

  onClose(): void {
    if (this.resolver) {
      const resolver = this.resolver;
      this.resolver = null;
      resolver(null);
    }
  }
}