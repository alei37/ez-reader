import type { Locale } from "../../core/types/Locale";
import type { TranslationRequest, TranslationResult } from "../../core/ports/TranslationProvider";
import { BaseTranslationProvider } from "./BaseTranslationProvider";

/**
 * MyMemory (mymemory.translated.net) translation provider.
 *
 * - **Truly free, no signup, no API key**. MyMemory is a public machine-
 *   translation aggregator backed by the EU. Their anonymous endpoint
 *   serves 10,000 characters per day per IP — enough for casual reading.
 * - Endpoint: `https://api.mymemory.translated.net/get`
 * - Method: GET (query string)
 * - Auth: none. The API does accept an optional `key=<email>` param to
 *   bump the daily quota; we leave it off so users don't have to register.
 * - Response: JSON `{ responseData: { translatedText, match }, responseStatus, responseDetails }`
 * - Errors: `responseStatus` 403 = quota exceeded, 429 = rate-limited.
 *
 * Reference: https://mymemory.translated.net/doc/spec.php
 *
 * Trade-offs vs the other providers:
 *   + zero setup, zero cost, no API key to leak
 *   + ~80 language pairs supported
 *   − quality is OK but lower than DeepL / Google / Youdao (it's a meta-
 *     search across multiple MT backends, picking the best match)
 *   − 10K chars/day anonymous cap (~5000 English words)
 *   − best-effort SLA — no uptime guarantee
 */
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

/**
 * MyMemory uses two-letter ISO-639-1 codes with optional region suffix.
 * BCP-47 codes used by the plugin UI are normalised here. Anything we
 * don't list is forwarded verbatim — MyMemory will return a clear
 * "INVALID LANGUAGE" error in `responseDetails` if it doesn't understand.
 */
const MYMEMORY_LOCALE_MAP: Readonly<Record<string, string>> = {
  auto: "Autodetect",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  "zh-HK": "zh-TW",
  zh: "zh-CN",
  en: "en-US",
  "en-US": "en-US",
  "en-GB": "en-GB",
  ja: "ja",
  "ja-JP": "ja",
  ko: "ko",
  "ko-KR": "ko",
  fr: "fr",
  "fr-FR": "fr",
  de: "de",
  "de-DE": "de",
  es: "es",
  "es-ES": "es",
  pt: "pt-PT",
  "pt-BR": "pt-BR",
  "pt-PT": "pt-PT",
  ru: "ru",
  "ru-RU": "ru",
  it: "it",
  "it-IT": "it",
  nl: "nl",
  "nl-NL": "nl",
  ar: "ar",
  id: "id",
  th: "th",
  vi: "vi"
};

const toMyMemoryLocale = (locale: Locale): string => MYMEMORY_LOCALE_MAP[locale] ?? locale;

/**
 * Detect a plausible source language from MyMemory's match quality score.
 * `match` is a 0-1 float; MyMemory doesn't return a separate detected-
 * language field, so we can't tell what it inferred. We return `null` and
 * let the UI render "unknown source" — better than guessing wrong.
 */
const parseDetectedSource = (_match: number | undefined, _requestedFrom: Locale): Locale | null => null;

export class MyMemoryTranslationProvider extends BaseTranslationProvider {
  readonly id = "mymemory";
  readonly displayName = "MyMemory (免费, 无需注册)";
  readonly signupUrl = "https://mymemory.translated.net/";
  readonly signupHint = "完全免费,无需注册也无需 API key。每天每个 IP 1 万字符额度,适合偶尔查词。质量略低于 DeepL/Google";

  protected readonly providerName = "MyMemory";

  /**
   * MyMemory has no key. We accept any non-empty string (the plugin
   * settings still requires an `apiKey` field for consistency, so we
   * treat the literal "anonymous" as the default marker).
   */
  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    // apiKey is ignored; any value is fine. But the settings UI may
    // default it to empty when the user picks this provider — accept that.
    return { ok: true };
  }

  async translate(_apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    const from = toMyMemoryLocale(request.source);
    const to = toMyMemoryLocale(request.target);
    // MyMemory caps a single query at ~500 chars; longer inputs are
    // truncated server-side. For the reader use case (single sentence /
    // phrase per translate action) this is plenty.
    const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(request.text)}&langpair=${encodeURIComponent(`${from}|${to}`)}&de=email@example.com`;

    const success = await this.fetchJson<MyMemoryResponse>(url, {
      method: "GET"
    });

    const status = success.responseStatus;
    if (status !== 200 && status !== undefined) {
      // MyMemory surfaces business errors via responseStatus (HTTP body is
      // still 200 OK). Translate the common ones; pass through the rest.
      const detail = success.responseDetails ?? "未知错误";
      throw new Error(this.formatMyMemoryError(status, detail));
    }

    const translated = success.responseData?.translatedText?.trim();
    if (!translated) {
      throw new Error("MyMemory 返回了空的翻译结果。");
    }

    return {
      text: translated,
      detectedSource: parseDetectedSource(success.responseData?.match, request.source),
      providerId: this.id
    };
  }

  private formatMyMemoryError(status: number, detail: string): string {
    switch (status) {
      case 403:
        return "MyMemory 每日免费额度已用完(每个 IP 1 万字符)。明天重置,或换有道/DeepL/Google。";
      case 429:
        return "MyMemory 频率限制:稍等几秒重试。";
      case 400:
        return `MyMemory 请求无效: ${detail}`;
      default:
        return `MyMemory 错误 ${status}: ${detail}`;
    }
  }

  protected formatHttpError(status: number, body: unknown): string {
    const message =
      body && typeof body === "object" && "responseDetails" in body
        ? String((body as { responseDetails?: unknown }).responseDetails ?? "")
        : "未知";
    return `MyMemory HTTP 错误 ${status}: ${message || "未知错误"}`;
  }
}

interface MyMemoryResponse {
  readonly responseData?: {
    readonly translatedText?: string;
    readonly match?: number;
  };
  readonly responseStatus?: number;
  readonly responseDetails?: string;
}