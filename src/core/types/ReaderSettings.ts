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
  /**
   * Font family token. Maps to a preset CSS font-family list. The five
   * presets (`sans` / `serif` / `mono` / `song` / `kai`) cover the common
   * CJK reading preferences — keeps the UI simple (no font picker per
   * installed font) while still letting the user switch between sans,
   * serif, monospace, and traditional CJK faces.
   */
  readonly fontFamily?: ReaderFontFamily;
  /**
   * Letter-spacing in `em` units. Default 0. Increase to 0.02-0.05 for
   * CJK body text — adds breathing room without breaking word layout.
   */
  readonly letterSpacing?: number;
  /**
   * Maximum content width in CSS pixels. Wide screens stretch lines too
   * long; clamping to ~720px keeps reading comfortable (about 75
   * characters at default font size).
   */
  readonly maxWidth?: number;
}

export type ReaderTheme = "system" | "light" | "dark" | "sepia";
export type ReaderFlow = "paginated" | "scrolled";
export type ReaderFontFamily = "sans" | "serif" | "mono" | "song" | "kai";

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = Object.freeze({
  fontSize: 100,
  lineHeight: 1.6,
  margin: 32,
  theme: "system",
  flow: "paginated",
  twoPages: false,
  immersive: false,
  fontFamily: "serif",
  letterSpacing: 0,
  maxWidth: 720
});

/**
 * CSS font-family stacks for the `ReaderFontFamily` presets. Keep these
 * in one place so the modal, the adapter CSS, and tests stay in sync.
 *
 * Each stack starts with platform fonts (system / PingFang / Microsoft YaHei
 * / Hiragino) and falls back to generic family names.
 */
export const READER_FONT_FAMILY_STACKS: Readonly<Record<ReaderFontFamily, string>> = Object.freeze({
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif: '"Source Serif Pro", "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", "Songti SC", "STSong", serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  song: '"Songti SC", "STSong", "SimSun", "Source Han Serif SC", serif',
  kai: '"Kaiti SC", "STKaiti", "BiauKai", "Noto Serif CJK TC", serif'
});

export const READER_FONT_FAMILY_LABELS: Readonly<Record<ReaderFontFamily, string>> = Object.freeze({
  sans: "无衬线",
  serif: "衬线",
  mono: "等宽",
  song: "宋体",
  kai: "楷体"
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
  /** 书架封面密度(网格/列表共用)。默认 default */
  readonly shelfDensity?: ShelfDensity;
}

export type ReaderOpenMode = "tab" | "window";

/**
 * Shelf cover density — controls how big book covers render on the
 * personal-library shelf (both grid and list views). Four discrete steps
 * keep the UI simple: a cycle button on the toolbar + a dropdown in
 * settings, no continuous slider.
 *
 * - `compact`   — many small covers per row; list covers are tiny
 * - `default`   — original sizing (220px grid min, 40px list)
 * - `spacious`  — bigger covers; ~280px grid min, 56px list
 * - `large`     — cover-art style; ~340px grid min, 72px list
 */
export type ShelfDensity = "compact" | "default" | "spacious" | "large";

export const SHELF_DENSITIES: ReadonlyArray<ShelfDensity> = ["compact", "default", "spacious", "large"];

export const SHELF_DENSITY_LABELS: Readonly<Record<ShelfDensity, string>> = Object.freeze({
  compact: "紧凑",
  default: "默认",
  spacious: "宽松",
  large: "超大"
});

export interface KeyboardShortcuts {
  readonly prev: string;
  readonly next: string;
  readonly toggleSidebar: string;
  readonly toggleToc: string;
  readonly translate: string;
  readonly highlight: string;
  /** Find-in-book 快捷键 — 默认 Ctrl/Cmd+F (不可改, 跟 OS 习惯一致)。 */
  readonly find?: string;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = Object.freeze({
  prev: "ArrowLeft",
  next: "ArrowRight",
  toggleSidebar: "s",
  toggleToc: "t",
  translate: "T",
  highlight: "h",
  find: "/"
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
  // 默认放在 vault 顶层一个统一目录 `ezreader-notes/` 下,两
  // 个子目录分别存摘录笔记和主题研究。ObsidianNoteWriter
  // 在第一次写笔记时会递归创建路径, 用户无需手动 mkdir.
  notesDirectory: "ezreader-notes/阅读笔记",
  researchDirectory: "ezreader-notes/主题研究",
  libraryOwnerName: "",
  defaultNoteTemplate: "# {{title}}\n",
  readerOpenMode: "tab",
  twoPagesByDefault: false,
  immersiveOnTablet: false,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  rememberProgress: true,
  shelfDensity: "default"
});