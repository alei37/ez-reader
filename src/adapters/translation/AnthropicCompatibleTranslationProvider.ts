import type { Locale } from "../../core/types/Locale";
import type { TranslationRequest, TranslationResult } from "../../core/ports/TranslationProvider";
import { BaseTranslationProvider } from "./BaseTranslationProvider";

/**
 * Generic Anthropic-Messages-API-compatible provider. Works with any
 * service that exposes `POST {baseUrl}/v1/messages` with the
 * `{ model, max_tokens, system, messages }` body shape — Anthropic
 * itself plus Anthropic-compatible proxies (e.g. MiniMax's
 * `https://api.minimax.cn/anthropic`).
 *
 * - Endpoint: `{baseUrl}/v1/messages`
 * - Method: POST JSON
 * - Auth: `x-api-key: <key>` header + `anthropic-version: 2023-06-01`
 * - Body: `{ model, max_tokens, system, messages: [{role, content}] }`
 * - Response: `{ content: [{ type: "text", text: "..." }], stop_reason }`
 *
 * Three knobs (baseUrl / apiKey / model) are stored as JSON in
 * `translation.apiKey`, matching the Youdao and OpenAI-compatible
 * patterns.
 *
 * Reference: https://docs.anthropic.com/en/api/messages
 */
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * BCP-47 → natural-language label. Same rationale as the OpenAI
 * provider: smaller models grok "Simplified Chinese" better than "zh-CN".
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

interface AnthropicCompatibleConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export class AnthropicCompatibleTranslationProvider extends BaseTranslationProvider {
  readonly id = "anthropic-compatible";
  readonly displayName = "自定义 LLM (Anthropic 兼容)";
  readonly signupUrl = "https://platform.anthropic.com/settings/keys";
  readonly signupHint = "Anthropic Messages API 兼容格式。例如 MiniMax 用 https://api.minimax.cn/anthropic。填 baseUrl + Key + 模型名";

  protected readonly providerName = "LLM";

  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return { ok: false, reason: "请填 API 基础地址、Key、模型名(三个都需要)。" };
    }
    const parsed = this.parseConfig(trimmed);
    if (!parsed) {
      return {
        ok: false,
        reason: '配置必须是 JSON 格式: {"baseUrl": "https://...", "apiKey": "...", "model": "..."}'
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
    const config = this.parseConfig(rawConfig);
    if (!config) {
      throw new Error("Anthropic 兼容 provider 配置缺失或损坏,请在插件设置重新填写。");
    }
    const baseUrl = config.baseUrl.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/v1/messages`;

    const targetLabel = toLocaleLabel(request.target);
    const sourceLabel = toLocaleLabel(request.source);

    // Anthropic takes the system prompt as a top-level field, separate
    // from the user/assistant message thread. We keep the same two-step
    // translation instruction as the OpenAI provider so users get
    // comparable quality across providers.
    const systemPrompt =
      "You are a professional translator. Translate the user's text accurately and naturally. " +
      "Preserve the original meaning, tone, and formatting (paragraph breaks, lists, code). " +
      "Output ONLY the translation — no preamble, no explanations, no quotation marks around it. " +
      "If the input is already in the target language, return it unchanged.";
    const userPrompt =
      request.source === "auto"
        ? `Translate the following text into ${targetLabel}:\n\n"""${request.text}"""`
        : `Translate the following text from ${sourceLabel} into ${targetLabel}:\n\n"""${request.text}"""`;

    // Anthropic's max_tokens is required (unlike OpenAI where it's
    // optional). Scale with input — CJK is denser, multiply by 4; cap at
    // 4096 to stay within typical model context windows.
    const maxTokens = Math.max(256, Math.min(4096, request.text.length * 4));

    const body = {
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    };

    const success = await this.fetchJson<AnthropicResponse>(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });

    // Anthropic returns content as an array of typed blocks. We pick the
    // first text block; ignore tool_use / image blocks (won't appear
    // here, but defensive).
    const textBlock = success.content?.find((b) => b.type === "text");
    const translated = textBlock?.text?.trim();
    if (!translated) {
      const stopReason = success.stop_reason ?? "unknown";
      throw new Error(`${this.providerName} 返回了空的翻译结果 (stop_reason=${stopReason})。可能是 max_tokens 不够,试试调大或缩短输入。`);
    }
    return {
      text: translated,
      detectedSource: null,
      providerId: this.id
    };
  }

  private parseConfig(raw: string): AnthropicCompatibleConfig | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as Partial<AnthropicCompatibleConfig>;
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
        ? ((body as { error?: { message?: string; type?: string } }).error?.message ?? "Unknown error from LLM API.")
        : "Unknown error from LLM API.";
    switch (status) {
      case 401:
        return `LLM 鉴权失败 (HTTP ${status}): ${message}。请检查 API Key 是否正确。`;
      case 403:
        return `LLM 鉴权失败 (HTTP ${status}): ${message}`;
      case 404:
        return `LLM endpoint 404: ${message}。请检查 API 基础地址(常见: 漏了 /anthropic 后缀)。`;
      case 429:
        return `LLM 频率/额度限制: ${message}`;
      case 400:
        return `LLM 请求参数错误: ${message}。可能是模型名写错或 max_tokens 不够大。`;
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

interface AnthropicResponse {
  readonly content?: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
  readonly stop_reason?: string;
}