import type { Locale } from "../../core/types/Locale";
import type { TranslationRequest, TranslationResult } from "../../core/ports/TranslationProvider";
import { BaseTranslationProvider } from "./BaseTranslationProvider";

/**
 * Youdao (有道智云) text translation API.
 *
 * - Endpoint: `https://openapi.youdao.com/api`
 * - Method: POST form-encoded
 * - Auth: appKey + appSecret (sent as `appKey` query/form param, `appSecret` is
 *   used to compute the SHA-256 signature)
 * - Sign type v3 — `sign = sha256(appKey + input + salt + curtime + appSecret)`
 *   where `input = q.length <= 20 ? q : q[0..10] + q.length + q[length-10..]`
 *
 * `apiKey` here is a JSON object literal: `{ "appKey": "...", "appSecret": "..." }`.
 * The pair lives together inside the plugin settings blob so the user only has
 * one field to fill.
 *
 * Reference: https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html
 */
interface YoudaoCredentials {
  readonly appKey: string;
  readonly appSecret: string;
}

const YOUDAO_ENDPOINT = "https://openapi.youdao.com/api";

/**
 * Maps a BCP-47-ish locale (as the plugin UI uses it) to a Youdao language
 * code. Youdao accepts `auto` for source, but otherwise expects the codes
 * listed in their supported-language table. Anything not in the map is
 * forwarded verbatim so a future Youdao addition can still work.
 */
const YOUDAO_LOCALE_MAP: Readonly<Record<string, string>> = {
  "zh-CN": "zh-CHS",
  "zh-TW": "zh-CHT",
  "zh-HK": "zh-CHT",
  "en": "en",
  "en-US": "en",
  "en-GB": "en",
  "ja": "ja",
  "ja-JP": "ja",
  "ko": "ko",
  "ko-KR": "ko",
  "fr": "fr",
  "fr-FR": "fr",
  "de": "de",
  "de-DE": "de",
  "es": "es",
  "es-ES": "es",
  "pt": "pt",
  "pt-PT": "pt",
  "pt-BR": "pt",
  "ru": "ru",
  "ru-RU": "ru",
  "it": "it",
  "it-IT": "it",
  "nl": "nl",
  "nl-NL": "nl",
  "ar": "ar",
  "id": "id",
  "th": "th",
  "vi": "vi",
  "auto": "auto"
};

const toYoudaoLocale = (locale: Locale): string => YOUDAO_LOCALE_MAP[locale] ?? locale;

/** Decode Youdao's `l` field (e.g. `"EN2zh-CHS"`) into the detected source. */
const parseDetectedSource = (l: string | undefined, requestedFrom: string): Locale | null => {
  if (!l) return null;
  // The "from" half of an l field is always uppercase; normalise it to the
  // BCP-47-ish casing we use everywhere else.
  const parts = l.split("2");
  if (parts.length !== 2) return null;
  const sourceCode = parts[0].toLowerCase();
  if (requestedFrom === "auto") {
    // Map common lowercase codes back to BCP-47.
    if (sourceCode === "zh-chs") return "zh-CN";
    if (sourceCode === "zh-cht") return "zh-TW";
    return sourceCode;
  }
  return requestedFrom;
};

export class YoudaoTranslationProvider extends BaseTranslationProvider {
  readonly id = "youdao";
  readonly displayName = "有道智云 · 文本翻译";
  readonly signupUrl = "https://ai.youdao.com/console/#/service-singleton/text";
  readonly signupHint = "注册有道智云账号 → 创建应用 → 选「文本翻译」 → 复制应用 ID 和应用密钥,分别填到下面两个框";

  protected readonly providerName = "有道";

  /**
   * Youdao expects the key as JSON `{"appKey": "...", "appSecret": "..."}` so
   * both halves ride along inside the single password-style plugin field.
   */
  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) return { ok: false, reason: "API key 不能为空。" };
    try {
      const parsed = JSON.parse(trimmed) as Partial<YoudaoCredentials>;
      if (!parsed.appKey || !parsed.appSecret) {
        return { ok: false, reason: "JSON 必须同时包含 appKey 和 appSecret 两个字段。" };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: '有道 API key 必须为 JSON 格式: {"appKey": "你的应用ID", "appSecret": "你的应用密钥"}'
      };
    }
  }

  async translate(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    const creds = this.parseCredentials(apiKey);
    const from = toYoudaoLocale(request.source);
    const to = toYoudaoLocale(request.target);
    if (!creds) {
      throw new Error('有道 API key 格式不正确,需要 {"appKey":"...","appSecret":"..."}。');
    }
    const salt = crypto.randomUUID();
    const curtime = Math.floor(Date.now() / 1000);
    const sign = await this.computeSign(creds.appKey, creds.appSecret, request.text, salt, curtime);

    // Youdao accepts GET/POST. POST with form-encoded body is the safest
    // choice for non-ASCII text and matches their reference Node.js demo.
    const body = new URLSearchParams({
      q: request.text,
      from,
      to,
      appKey: creds.appKey,
      salt,
      curtime: String(curtime),
      sign,
      signType: "v3"
    });

    const payload = await this.fetchJson<YoudaoResponse>(YOUDAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString()
    });

    const code = payload.errorCode ?? "unknown";
    if (code !== "0" && code !== "00") {
      throw new Error(`有道 API 错误 ${code}: ${YOUDAO_ERROR_MESSAGES[code] ?? "未知错误"}`);
    }
    const translated = (payload.translation ?? []).join("").trim();
    if (!translated) {
      throw new Error(`有道返回了空的翻译结果 (errorCode=${code})`);
    }
    return {
      text: translated,
      detectedSource: parseDetectedSource(payload.l, request.source),
      providerId: this.id
    };
  }

  private parseCredentials(apiKey: string): YoudaoCredentials | null {
    const trimmed = apiKey.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as Partial<YoudaoCredentials>;
      if (typeof parsed.appKey === "string" && typeof parsed.appSecret === "string") {
        return { appKey: parsed.appKey, appSecret: parsed.appSecret };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * SHA-256 signature per the Youdao v3 spec. The body the digest is computed
   * over is `appKey + input + salt + curtime + appSecret`. `input` is the
   * query truncated as: first 10 chars + length + last 10 chars (when the
   * query is longer than 20 chars) — otherwise it's the query as-is.
   */
  private async computeSign(
    appKey: string,
    appSecret: string,
    text: string,
    salt: string,
    curtime: number
  ): Promise<string> {
    const input = text.length <= 20 ? text : text.slice(0, 10) + text.length + text.slice(-10);
    const payload = `${appKey}${input}${salt}${curtime}${appSecret}`;
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return this.toHex(new Uint8Array(digest));
  }

  private toHex(bytes: Uint8Array): string {
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  }

  /**
   * Youdao 把 HTTP 错误跟业务错误(errorCode)拆开: HTTP 4xx/5xx 时 body 仍
   * 是 JSON, 错误消息从 `message` 字段拿 — 而 200 OK + errorCode != "0"
   * 是另一种错误 (translate 里处理)。这里只覆盖 HTTP 错误。
   */
  protected formatHttpError(status: number, body: unknown): string {
    const message =
      body && typeof body === "object" && "errorCode" in body
        ? String((body as { errorCode?: unknown }).errorCode)
        : "未知";
    return `有道 HTTP 错误 ${status}: ${message}`;
  }
}

interface YoudaoResponse {
  readonly errorCode?: string;
  readonly translation?: ReadonlyArray<string>;
  readonly l?: string;
}

/**
 * Subset of Youdao's error-code table that the user is likely to see in this
 * plugin (signature problems, quota, IP whitelist, language support).
 * Anything not listed surfaces as "未知错误" with the raw code attached.
 */
const YOUDAO_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "101": "缺少必填参数,请检查表单字段。",
  "102": "不支持的语言类型。",
  "103": "翻译文本过长(单次最多 5000 字符)。",
  "108": "应用 ID 无效。",
  "110": "应用未绑定文本翻译服务。",
  "111": "开发者账号无效。",
  "113": "查询文本 q 不能为空。",
  "202": "签名校验失败,请确认 appKey/appSecret 与 q 的 UTF-8 编码正确。",
  "203": "访问 IP 不在白名单内。",
  "206": "时间戳无效导致签名失败。",
  "207": "重放请求 (salt+curtime 命中防重放缓存)。",
  "302": "翻译查询失败。",
  "303": "服务端异常。",
  "304": "翻译失败,请联系有道技术支持。",
  "401": "账户已欠费,请充值后再使用。",
  "411": "访问频率受限,请稍后再试。",
  "412": "长请求过于频繁,请稍后再试。"
};
