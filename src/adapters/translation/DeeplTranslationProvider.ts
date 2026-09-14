import type { Locale } from "../../core/types/Locale";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from "../../core/ports/TranslationProvider";

/**
 * DeepL translation API. Free keys end with `:fx` and must hit the
 * `api-free.deepl.com` host; Pro keys have no suffix and must hit
 * `api.deepl.com`. We auto-detect the endpoint from the key suffix so the
 * user only has to paste the key.
 *
 * - Endpoint: `https://api-free.deepl.com/v2/translate` (Free) or
 *   `https://api.deepl.com/v2/translate` (Pro)
 * - Method: POST
 * - Auth: `Authorization: DeepL-Auth-Key <key>` header
 * - Body: JSON `{ text: string[], target_lang, source_lang?, ... }`
 *
 * Reference: https://developers.deepl.com/docs/api-reference/translate
 */

const DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_ENDPOINT = "https://api.deepl.com/v2/translate";

/**
 * DeepL uses uppercase ISO-639-1 codes; some languages have a region suffix.
 * BCP-47 codes used by the UI are normalised here. Anything outside this map
 * is uppercased and forwarded — DeepL's error response will be more
 * diagnostic than a silent fallback.
 */
const DEEPL_LOCALE_MAP: Readonly<Record<string, string>> = {
  "auto": "",
  "zh-CN": "ZH",
  "zh-TW": "ZH",
  "zh": "ZH",
  "en": "EN",
  "en-US": "EN-US",
  "en-GB": "EN-GB",
  "ja": "JA",
  "ja-JP": "JA",
  "ko": "KO",
  "ko-KR": "KO",
  "fr": "FR",
  "fr-FR": "FR",
  "de": "DE",
  "de-DE": "DE",
  "es": "ES",
  "es-ES": "ES",
  "pt": "PT-BR",
  "pt-BR": "PT-BR",
  "pt-PT": "PT-PT",
  "ru": "RU",
  "ru-RU": "RU",
  "it": "IT",
  "it-IT": "IT",
  "nl": "NL",
  "nl-NL": "NL",
  "pl": "PL",
  "pl-PL": "PL",
  "tr": "TR",
  "tr-TR": "TR",
  "uk": "UK",
  "sv": "SV",
  "sv-SE": "SV",
  "da": "DA",
  "da-DK": "DA",
  "fi": "FI",
  "fi-FI": "FI",
  "nb": "NB",
  "no": "NB",
  "el": "EL",
  "el-GR": "EL",
  "hu": "HU",
  "hu-HU": "HU",
  "cs": "CS",
  "cs-CZ": "CS",
  "ro": "RO",
  "ro-RO": "RO",
  "sk": "SK",
  "sk-SK": "SK",
  "sl": "SL",
  "sl-SI": "SL",
  "et": "ET",
  "et-EE": "ET",
  "lv": "LV",
  "lv-LV": "LV",
  "lt": "LT",
  "lt-LT": "LT",
  "id": "ID",
  "id-ID": "ID",
  "bg": "BG",
  "ar": "AR"
};

const toDeeplLocale = (locale: Locale): string => {
  const mapped = DEEPL_LOCALE_MAP[locale];
  if (mapped !== undefined) return mapped;
  // Strip a region tag if present, then uppercase the remainder.
  const base = locale.split("-")[0] ?? locale;
  return base.toUpperCase();
};

const isFreeKey = (key: string): boolean => key.trim().endsWith(":fx");

const resolveEndpoint = (key: string): string =>
  isFreeKey(key) ? DEEPL_FREE_ENDPOINT : DEEPL_PRO_ENDPOINT;

export class DeeplTranslationProvider implements TranslationProvider {
  readonly id = "deepl";
  readonly displayName = "DeepL";
  readonly signupUrl = "https://www.deepl.com/pro-api";
  readonly signupHint = "DeepL Pro API 有免费层(每月 50 万字符);注册后从账户页获取 Authentication Key";

  /**
   * The DeepL key is opaque; we only sanity-check length and trim. DeepL
   * itself rejects malformed keys with HTTP 403 the first time you call the
   * API, so we surface that as the real validation result.
   */
  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) return { ok: false, reason: "API key 不能为空。" };
    if (trimmed.length < 8) {
      return { ok: false, reason: "API key 太短,请检查是否完整粘贴。" };
    }
    return { ok: true };
  }

  async translate(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      throw new Error("DeepL API key 不能为空,请在插件设置中填写。");
    }
    const endpoint = resolveEndpoint(trimmedKey);
    const targetLang = toDeeplLocale(request.target);
    if (!targetLang) {
      throw new Error("DeepL 必须显式指定目标语言。");
    }
    const sourceLangRaw = toDeeplLocale(request.source);
    // DeepL omits `source_lang` to mean "auto-detect". An empty mapping for
    // the source "auto" sentinel also becomes "omit".
    const useAutoSource = !sourceLangRaw || request.source === "auto";

    const body: Record<string, unknown> = {
      text: [request.text],
      target_lang: targetLang,
      // Preserve the original formatting markers (XML/HTML); DeepL keeps
      // surrounding tags intact and only translates the content between
      // them. Safe default for the reader use case.
      tag_handling: "html",
      ignore_tags: "pre,code"
    };
    if (!useAutoSource) body.source_lang = sourceLangRaw;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `DeepL-Auth-Key ${trimmedKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(`网络请求失败: ${this.formatError(error)}`);
    }

    let payload: DeeplResponse | DeeplErrorResponse;
    try {
      payload = (await response.json()) as DeeplResponse | DeeplErrorResponse;
    } catch (error) {
      throw new Error(`DeepL 返回了非 JSON 响应 (HTTP ${response.status}): ${this.formatError(error)}`);
    }
    if (!response.ok) {
      throw new Error(this.formatHttpError(response.status, payload));
    }
    const success = payload as DeeplResponse;
    const first = success.translations?.[0];
    if (!first) {
      throw new Error("DeepL 返回了空的翻译结果。");
    }
    return {
      text: first.text,
      detectedSource: first.detected_source_language ?? null,
      providerId: this.id
    };
  }

  /**
   * Map DeepL's HTTP status to a human-readable Chinese explanation. The
   * DeepL docs are explicit that the human-readable `message` field can
   * change wording, so we don't try to branch on it.
   */
  private formatHttpError(status: number, body: DeeplResponse | DeeplErrorResponse): string {
    const message = "message" in body && typeof body.message === "string" ? body.message : undefined;
    switch (status) {
      case 400:
        return `DeepL 请求参数错误: ${message ?? "请检查 source_lang/target_lang 等字段。"}`;
      case 403:
        return "DeepL 鉴权失败,请检查 API key 是否正确,免费 key 必须以 :fx 结尾。";
      case 404:
        return `DeepL 接口路径错误 (HTTP 404)。endpoint=${message ?? "unknown"}`;
      case 413:
        return "DeepL 请求体过大,请缩短待翻译文本。";
      case 414:
        return "DeepL 请求 URL 过长。";
      case 429:
        return "DeepL 访问频率受限,请稍后再试。";
      case 456:
        return "DeepL 字符配额已用完。";
      case 500:
      case 504:
      case 529:
        return `DeepL 服务暂时不可用 (HTTP ${status})。`;
      default:
        return `DeepL HTTP 错误 ${status}: ${message ?? "未知"}`;
    }
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

interface DeeplResponse {
  readonly translations?: ReadonlyArray<{
    readonly detected_source_language?: string;
    readonly text: string;
    readonly billed_characters?: number;
  }>;
}

interface DeeplErrorResponse {
  readonly message?: string;
  readonly code?: string;
  readonly error?: { readonly message?: string };
}
