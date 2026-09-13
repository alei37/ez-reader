import type { Locale } from "./Locale";

/** User-tunable reader appearance, scoped per book unless `scope === "default"`. */
export interface ReaderAppearance {
  /** Font size as a percentage of the reader default. 100 = unchanged. */
  readonly fontSize: number;
  /** Line height multiplier. */
  readonly lineHeight: number;
  /** Horizontal page margin in CSS pixels. */
  readonly margin: number;
  readonly theme: ReaderTheme;
  readonly flow: ReaderFlow;
}

export type ReaderTheme = "system" | "light" | "dark" | "sepia";
export type ReaderFlow = "paginated" | "scrolled";

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = Object.freeze({
  fontSize: 100,
  lineHeight: 1.6,
  margin: 32,
  theme: "system",
  flow: "paginated"
});

/** Plugin-wide preferences, not per-book. */
export interface PluginSettings {
  readonly uiLocale: Locale;
  readonly translation: TranslationSettings | null;
  readonly defaultAppearance: ReaderAppearance;
  readonly notesDirectory: string;
  readonly researchDirectory: string;
  readonly libraryOwnerName: string;
  readonly defaultNoteTemplate: string;
  readonly readerOpenMode: ReaderOpenMode;
}

export type ReaderOpenMode = "tab" | "window";

export interface TranslationSettings {
  readonly providerId: string;
  readonly apiKey: string;
  readonly sourceLocale: Locale;
  readonly targetLocale: Locale;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = Object.freeze({
  uiLocale: "zh-CN",
  translation: null,
  defaultAppearance: DEFAULT_READER_APPEARANCE,
  notesDirectory: "zz_阅读与研究/阅读笔记",
  researchDirectory: "zz_阅读与研究/主题研究",
  libraryOwnerName: "",
  defaultNoteTemplate: "# {{title}}\n",
  readerOpenMode: "tab"
});