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
 *   2. `fetchJson<T>(url, init)`      — fetch + JSON parse + HTTP error mapping,
 *                                       with consistent Chinese error messages.
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
   * Fetch + parse JSON + translate HTTP failure into a Chinese error message.
   * Returns the parsed payload on success.
   *
   * `options.providerName` overrides the error prefix for this one call —
   * used by Google's auth step to emit "Google 鉴权" instead of "Google"
   * so the user knows which subsystem failed.
   */
  protected async fetchJson<T>(
    url: string,
    init: RequestInit,
    options?: { providerName?: string }
  ): Promise<T> {
    const name = options?.providerName ?? this.providerName;
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error(`网络请求失败: ${this.formatError(error)}`);
    }
    let payload: T;
    try {
      payload = (await response.json()) as T;
    } catch (error) {
      throw new Error(
        `${name} 返回了非 JSON 响应 (HTTP ${response.status}): ${this.formatError(error)}`
      );
    }
    if (!response.ok) {
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
}
