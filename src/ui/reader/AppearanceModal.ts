import { Modal } from "obsidian";
import type { App } from "obsidian";
import type {
  ReaderAppearance,
  ReaderFontFamily,
  ReaderTheme
} from "../../core/types/ReaderSettings";
import { READER_FONT_FAMILY_LABELS } from "../../core/types/ReaderSettings";

const FONT_SIZE_MIN = 60;
const FONT_SIZE_MAX = 200;
const LINE_HEIGHT_MIN = 1.0;
const LINE_HEIGHT_MAX = 2.4;
const MARGIN_MIN = 0;
const MARGIN_MAX = 80;
const LETTER_SPACING_MIN = 0;
const LETTER_SPACING_MAX = 0.1; // em
const MAX_WIDTH_MIN = 480;
const MAX_WIDTH_MAX = 1200;

const THEMES: ReaderTheme[] = ["system", "light", "dark", "sepia"];
const FONT_FAMILIES: ReaderFontFamily[] = ["sans", "serif", "mono", "song", "kai"];

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
 * page margin, theme, font family, letter spacing, and max content width.
 * Resolves to the chosen appearance, or null if the user cancelled.
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
  private fontFamilyButtons: Map<ReaderFontFamily, HTMLButtonElement> = new Map();
  private letterSpacingInput!: HTMLInputElement;
  private letterSpacingValue!: HTMLElement;
  private maxWidthInput!: HTMLInputElement;
  private maxWidthValue!: HTMLElement;
  private chosenTheme: ReaderTheme;
  private chosenFontFamily: ReaderFontFamily;

  constructor(app: App, initial: ReaderAppearance) {
    super(app);
    this.initial = initial;
    this.chosenTheme = initial.theme;
    // Defaults for fields that may be undefined on older saved appearances.
    this.chosenFontFamily = initial.fontFamily ?? "serif";
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

    // --- Font family ---
    const fontFamilyRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    fontFamilyRow.createEl("label", { text: "字体" });
    const fontFamilyWrap = fontFamilyRow.createDiv({ cls: "ez-reader__appearance-modal__font-families" });
    for (const family of FONT_FAMILIES) {
      const btn = fontFamilyWrap.createEl("button", { text: READER_FONT_FAMILY_LABELS[family], attr: { type: "button" } });
      btn.addClass("ez-reader__pill", `ez-reader__pill--font-${family}`);
      btn.toggleClass("is-active", family === this.chosenFontFamily);
      btn.addEventListener("click", () => {
        this.chosenFontFamily = family;
        for (const [other, otherBtn] of this.fontFamilyButtons) {
          otherBtn.toggleClass("is-active", other === family);
        }
      });
      this.fontFamilyButtons.set(family, btn);
    }

    // --- Letter spacing ---
    const letterSpacingRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    letterSpacingRow.createEl("label", { text: "字间距" });
    const initialLetterSpacing = this.initial.letterSpacing ?? 0;
    this.letterSpacingInput = letterSpacingRow.createEl("input", {
      attr: { type: "range", min: String(LETTER_SPACING_MIN), max: String(LETTER_SPACING_MAX), step: "0.01" }
    });
    this.letterSpacingInput.value = String(initialLetterSpacing);
    this.letterSpacingValue = letterSpacingRow.createEl("span", { text: `${initialLetterSpacing.toFixed(2)}em` });
    this.letterSpacingInput.addEventListener("input", () => {
      this.letterSpacingValue.setText(`${Number(this.letterSpacingInput.value).toFixed(2)}em`);
    });

    // --- Max content width ---
    const maxWidthRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    maxWidthRow.createEl("label", { text: "文本宽度" });
    const initialMaxWidth = this.initial.maxWidth ?? 720;
    this.maxWidthInput = maxWidthRow.createEl("input", {
      attr: { type: "range", min: String(MAX_WIDTH_MIN), max: String(MAX_WIDTH_MAX), step: "20" }
    });
    this.maxWidthInput.value = String(initialMaxWidth);
    this.maxWidthValue = maxWidthRow.createEl("span", { text: `${initialMaxWidth}px` });
    this.maxWidthInput.addEventListener("input", () => {
      this.maxWidthValue.setText(`${this.maxWidthInput.value}px`);
    });

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
      flow: this.initial.flow,
      fontFamily: this.chosenFontFamily,
      letterSpacing: Number(this.letterSpacingInput.value),
      maxWidth: Number(this.maxWidthInput.value)
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
