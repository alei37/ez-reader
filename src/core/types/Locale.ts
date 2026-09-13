/**
 * BCP-47 locale code. Stored as a string rather than an enum so that
 * translation providers can return their own supported locales without
 * mapping back to a fixed list.
 *
 * Examples: `"zh-CN"`, `"zh-TW"`, `"en"`, `"fr"`, `"ja"`, `"auto"`.
 */
export type Locale = string;

/** Sentinel value for "let the provider decide the source language". */
export const AUTO_LOCALE: Locale = "auto";

/** Locales the plugin UI itself ships with. */
export const UI_LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" }
];

export type UiLocale = "zh-CN" | "zh-TW" | "en" | "fr";

export const isUiLocale = (value: string): value is UiLocale =>
  value === "zh-CN" || value === "zh-TW" || value === "en" || value === "fr";

export const defaultUiLocale: UiLocale = "zh-CN";