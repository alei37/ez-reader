import type { Locale } from "../../core/types/Locale";
import type { TranslationRequest, TranslationResult } from "../../core/ports/TranslationProvider";
import { BaseTranslationProvider } from "./BaseTranslationProvider";

/**
 * Generic OpenAI-compatible chat-completions provider. Works with any
 * service that exposes `POST {baseUrl}/chat/completions` with the
 * `{ model, messages }` body shape — including OpenAI itself plus all
 * the major Chinese LLM APIs (DeepSeek / GLM / Moonshot / Qwen / Doubao,
 * all of which are OpenAI-compatible).
 *
 * - Endpoint: `{baseUrl}/chat/completions`
 * - Method: POST JSON
 * - Auth: `Authorization: Bearer <apiKey>` header
 * - Body: `{ model, messages: [{role:"system"}, {role:"user", ...}], temperature, max_tokens }`
 * - Response: `{ choices: [{ message: { content: "..." } }] }`
 *
 * The three required knobs (baseUrl / apiKey / model) are configured in
 * the plugin settings as a JSON object stored in `translation.apiKey`,
 * matching the Youdao pattern. Each field has its own UI input for
 * easier editing — see SettingsTab.ts.
 */
const OPENAI_COMPATIBLE_DEFAULTS: OpenAICompatibleConfig = Object.freeze({
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini"
});

interface OpenAICompatibleConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * BCP-47 → natural-language label. LLMs work better when you tell them
 * "translate to Simplified Chinese" than "translate to zh-CN" (some
 * smaller models don't grok BCP-47).
 */
const LOCALE_LABEL_MAP: Readonly<Record<string, string>> = {
  auto: "the source language (auto-detect)",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  "zh-HK": "Traditional Chinese (Hong Kong)",
  zh: "Chinese",
  en: "English",
  "en-US": "English (American)",
  "en-GB": "English (British)",
  ja: "Japanese",
  "ja-JP": "Japanese",
  ko: "Korean",
  "ko-KR": "Korean",
  fr: "French",
  "fr-FR": "French",
  de: "German",
  "de-DE": "German",
  es: "Spanish",
  "es-ES": "Spanish (European)",
  pt: "Portuguese",
  "pt-BR": "Portuguese (Brazilian)",
  "pt-PT": "Portuguese (European)",
  ru: "Russian",
  "ru-RU": "Russian",
  it: "Italian",
  "it-IT": "Italian",
  nl: "Dutch",
  "nl-NL": "Dutch",
  ar: "Arabic",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese"
};

const toLocaleLabel = (locale: Locale): string => LOCALE_LABEL_MAP[locale] ?? locale;

export class OpenAICompatibleTranslationProvider extends BaseTranslationProvider {
  readonly id = "openai-compatible";
  readonly displayName = "自定义 LLM (OpenAI 兼容)";
  readonly signupUrl = "https://platform.openai.com/api-keys";
  readonly signupHint = "通用 OpenAI 兼容格式: 填 API 基础地址、Key、模型名。DeepSeek / 智谱 / 通义 / OpenAI 都支持。";

  protected readonly providerName = "LLM";

  /**
   * The apiKey slot in settings is JSON `{baseUrl, apiKey, model}`. Empty
   * strings are valid only when the user hasn't configured anything yet.
   * We accept the JSON if all three fields are non-empty.
   */
  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return { ok: false, reason: "请填 API 基础地址、Key、模型名(三个都需要)。" };
    }
    const parsed = this.parseConfig(trimmed);
    if (!parsed) {
      return {
        ok: false,
        reason: '配置必须是 JSON 格式: {"baseUrl": "https://...", "apiKey": "sk-...", "model": "..."}'
      };
    }
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) {
      return {
        ok: false,
        reason: "三个字段都必填: API 基础地址、API Key、模型名。"
      };
    }
    if (!this.isValidHttpUrl(parsed.baseUrl)) {
      return {
        ok: false,
        reason: `API 基础地址格式不对: "${parsed.baseUrl}"。需要 https:// 开头的 URL。`
      };
    }
    return { ok: true };
  }

  async translate(rawConfig: string, request: TranslationRequest): Promise<TranslationResult> {
    const config = this.parseConfig(rawConfig) ?? OPENAI_COMPATIBLE_DEFAULTS;
    const baseUrl = config.baseUrl.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/chat/completions`;

    const targetLabel = toLocaleLabel(request.target);
    const sourceLabel = toLocaleLabel(request.source);

    // Two-message prompt: system sets the role, user gives the task +
    // text. Putting the text in the user message (not system) avoids the
    // classic prompt-injection trap where a user pastes "ignore previous
    // instructions and..." into the source.
    const systemPrompt =
      "You are a professional translator. Translate the user's text accurately and naturally. " +
      "Preserve the original meaning, tone, and formatting (paragraph breaks, lists, code). " +
      "Output ONLY the translation — no preamble, no explanations, no quotation marks around it. " +
      "If the input is already in the target language, return it unchanged.";
    const userPrompt =
      request.source === "auto"
        ? `Translate the following text into ${targetLabel}:\n\n"""${request.text}"""`
        : `Translate the following text from ${sourceLabel} into ${targetLabel}:\n\n"""${request.text}"""`;

    const body = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      // Low temperature for deterministic translation; max_tokens scales
      // with input length (input*4 is a rough upper bound for non-English
      // — CJK is denser).
      temperature: 0.2,
      max_tokens: Math.max(256, Math.min(4096, request.text.length * 4))
    };

    const success = await this.fetchJson<OpenAIResponse>(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });

    const choice = success.choices?.[0]?.message?.content;
    if (!choice) {
      throw new Error(`${this.providerName} 返回了空的选择 (choices 为空或缺少 content 字段)。`);
    }
    const translated = choice.trim();
    if (!translated) {
      throw new Error(`${this.providerName} 返回了空的翻译结果。`);
    }
    return {
      text: translated,
      detectedSource: null,
      providerId: this.id
    };
  }

  private parseConfig(raw: string): OpenAICompatibleConfig | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as Partial<OpenAICompatibleConfig>;
      return {
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "",
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
        model: typeof parsed.model === "string" ? parsed.model.trim() : ""
      };
    } catch {
      return null;
    }
  }

  private isValidHttpUrl(s: string): boolean {
    try {
      const url = new URL(s);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  protected formatHttpError(status: number, body: unknown): string {
    const message =
      body && typeof body === "object" && "error" in body
        ? ((body as { error?: { message?: string } }).error?.message ?? "Unknown error from LLM API.")
        : "Unknown error from LLM API.";
    switch (status) {
      case 401:
      case 403:
        return `LLM 鉴权失败 (HTTP ${status}): ${message}。请检查 API Key 是否正确。`;
      case 404:
        return `LLM endpoint 404: ${message}。请检查 API 基础地址(常见: 漏了 /v1 后缀或路径写错)。`;
      case 429:
        return `LLM 频率/额度限制: ${message}`;
      case 400:
        return `LLM 请求参数错误: ${message}`;
      case 500:
      case 502:
      case 503:
      case 504:
        return `LLM 服务暂时不可用 (HTTP ${status}): ${message}`;
      default:
        return `LLM HTTP 错误 ${status}: ${message}`;
    }
  }
}

interface OpenAIResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
  }>;
}