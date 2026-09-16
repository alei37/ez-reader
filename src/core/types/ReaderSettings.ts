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
  /** 双页模式: 桌面端用,EPUB 自动双列 */
  readonly twoPages?: boolean;
  /** 沉浸模式: pad 上隐藏工具栏,边距更小 */
  readonly immersive?: boolean;
}

export type ReaderTheme = "system" | "light" | "dark" | "sepia";
export type ReaderFlow = "paginated" | "scrolled";

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = Object.freeze({
  fontSize: 100,
  lineHeight: 1.6,
  margin: 32,
  theme: "system",
  flow: "paginated",
  twoPages: false,
  immersive: false
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
  /** 双页模式默认开关 */
  readonly twoPagesByDefault?: boolean;
  /** Pad 沉浸模式默认开关 */
  readonly immersiveOnTablet?: boolean;
  /** 翻页快捷键 */
  readonly keyboardShortcuts?: KeyboardShortcuts;
  /** 关闭"记住阅读进度"。默认 true. 关闭后打开书不再自动跳转到上次位置 */
  readonly rememberProgress?: boolean;
}

export type ReaderOpenMode = "tab" | "window";

export interface KeyboardShortcuts {
  readonly prev: string;
  readonly next: string;
  readonly toggleSidebar: string;
  readonly toggleToc: string;
  readonly translate: string;
  readonly highlight: string;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = Object.freeze({
  prev: "ArrowLeft",
  next: "ArrowRight",
  toggleSidebar: "s",
  toggleToc: "t",
  translate: "T",
  highlight: "h"
});

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
  readerOpenMode: "tab",
  twoPagesByDefault: false,
  immersiveOnTablet: false,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  rememberProgress: true
});