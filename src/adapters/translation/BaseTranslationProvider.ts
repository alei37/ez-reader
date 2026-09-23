import { requestUrl } from "obsidian";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from "../../core/ports/TranslationProvider";

/**
 * Base class for HTTP-based translation providers. Handles the three
 * things every provider ends up duplicating:
 *
 *   1. `formatError(error: unknown)` — safely stringify a thrown value.
 *   2. `fetchJson<T>(url, init)`      — requestUrl + JSON parse + HTTP error
 *                                       mapping, with consistent Chinese
 *                                       error messages.
 *   3. `checkEmptyKey(apiKey)`        — trim + non-empty check.
 *
 * Subclasses implement `validateKey` and `translate`, plus
 * `providerName` (used in error messages) and `formatHttpError` (HTTP
 * status → Chinese explanation).
 *
 * Subclass-specific bits that intentionally stay in the subclass:
 *   - locale mapping (`toXxxLocale`)
 *   - auth (API-key header, OAuth token, signed form body)
 *   - response shape handling
 *
 * Why `requestUrl` and not `fetch`?
 * --------------------------------
 * Obsidian's renderer process has a Content-Security-Policy that blocks
 * raw `fetch()` to external hosts — calling `fetch()` returns "Failed to
 * fetch" because the renderer doesn't have a network grant for `https://`.
 * `requestUrl` is Obsidian's blessed HTTP client: it goes through the
 * main process / Node's net stack, sidesteps the renderer CSP, and is
 * the documented API for plugins (see AGENTS.md §3.7 locked-rule note).
 */
export abstract class BaseTranslationProvider implements TranslationProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly signupUrl: string;
  abstract readonly signupHint: string;

  abstract validateKey(
    apiKey: string
  ): Promise<{ ok: true } | { ok: false; reason: string }>;

  abstract translate(
    apiKey: string,
    request: TranslationRequest
  ): Promise<TranslationResult>;

  /** Display name for error messages (e.g. "DeepL", "有道", "Google"). */
  protected abstract readonly providerName: string;

  /** Map HTTP status + parsed JSON payload to a Chinese error message. */
  protected abstract formatHttpError(status: number, payload: unknown): string;

  /** Stringify an unknown thrown value for error messages. */
  protected formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * HTTP call + parse JSON + translate HTTP failure into a Chinese error
   * message. Returns the parsed payload on success.
   *
   * `options.providerName` overrides the error prefix for this one call —
   * used by Google's auth step to emit "Google 鉴权" instead of "Google"
   * so the user knows which subsystem failed.
   *
   * Uses Obsidian's `requestUrl` (not raw `fetch`) — see class doc for
   * why. `throw: false` keeps error mapping consistent across all HTTP
   * status codes (otherwise requestUrl throws before we can extract the
   * body for `formatHttpError`).
   */
  protected async fetchJson<T>(
    url: string,
    init: RequestInit,
    options?: { providerName?: string }
  ): Promise<T> {
    const name = options?.providerName ?? this.providerName;
    let response: { status: number; text: string };
    try {
      response = await requestUrl({
        url,
        method: typeof init.method === "string" ? init.method : "GET",
        headers: this.stringifyHeaders(init.headers),
        body: typeof init.body === "string" ? init.body : undefined,
        throw: false
      });
    } catch (error) {
      // requestUrl throws when throw:true AND for connection-level failures
      // (DNS, refused, reset, TLS). Wrap with our Chinese prefix so the user
      // sees consistent error wording.
      throw new Error(`网络请求失败: ${this.formatError(error)}`);
    }
    let payload: T;
    try {
      payload = JSON.parse(response.text) as T;
    } catch (error) {
      throw new Error(
        `${name} 返回了非 JSON 响应 (HTTP ${response.status}): ${this.formatError(error)}`
      );
    }
    if (response.status >= 400) {
      throw new Error(this.formatHttpError(response.status, payload));
    }
    return payload;
  }

  /**
   * Trim the key and reject empty input. Returns the trimmed key on success
   * or `null` if empty (so the subclass can throw a specific message).
   */
  protected checkEmptyKey(apiKey: string): string | null {
    const trimmed = apiKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * `Headers | Record<string, string> | undefined` → flat string record.
   * requestUrl takes `Record<string, string>`; convert Headers / array
   * tuples for callers that pass those.
   */
  private stringifyHeaders(
    headers: RequestInit["headers"]
  ): Record<string, string> | undefined {
    if (!headers) return undefined;
    if (headers instanceof Headers) {
      const out: Record<string, string> = {};
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    if (Array.isArray(headers)) {
      const out: Record<string, string> = {};
      for (const [key, value] of headers) out[key] = value;
      return out;
    }
    return headers;
  }
}
