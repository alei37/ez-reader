import type { Locale } from "../../core/types/Locale";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from "../../core/ports/TranslationProvider";

/**
 * Google Cloud Translation v3 implementation. Requires the caller to supply
 * a JSON-formatted API key string (the service account JSON is parsed and
 * cached on the first call).
 *
 * The key is intentionally opaque from the port side — callers only see a
 * string. We make no attempt to support the legacy v2 `key=` API.
 */
export class GoogleTranslationProvider implements TranslationProvider {
  readonly id = "google-translation-v3";
  readonly displayName = "Google Translate (Cloud v3)";

  async validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const creds = JSON.parse(apiKey) as { client_email?: string; private_key?: string };
      if (!creds.client_email || !creds.private_key) {
        return { ok: false, reason: "Service account JSON must contain client_email and private_key." };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "API key must be a JSON service account key from Google Cloud." };
    }
  }

  async translate(apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    // Implementation deferred to Phase 1.3. We throw a clear error so the
    // user sees what's missing instead of getting a misleading success.
    throw new Error("GoogleTranslationProvider.translate is not implemented yet.");
  }
}