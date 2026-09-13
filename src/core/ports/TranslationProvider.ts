import type { Locale } from "../types/Locale";

/** Input the translation service sends to a provider. */
export interface TranslationRequest {
  readonly text: string;
  readonly source: Locale;
  readonly target: Locale;
}

/** Successful translation. */
export interface TranslationResult {
  readonly text: string;
  readonly detectedSource: Locale | null;
  readonly providerId: string;
}

/** Errors a provider can surface to the UI. */
export type TranslationError =
  | { readonly kind: "missing-key" }
  | { readonly kind: "network"; readonly cause: string }
  | { readonly kind: "provider"; readonly message: string }
  | { readonly kind: "unsupported-pair"; readonly source: Locale; readonly target: Locale };

/**
 * A cloud translation provider. Implementations wrap Google Translate,
 * DeepL, OpenAI, a local Ollama instance, or anything else.
 *
 * The port intentionally hides API specifics; callers pass a `Locale` string
 * and the provider figures out the endpoint.
 */
export interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;

  /** Validate an API key without performing a translation. */
  validateKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }>;

  /** Translate a request. */
  translate(apiKey: string, request: TranslationRequest): Promise<TranslationResult>;
}

/** Service that coordinates one or more providers. */
export interface TranslationService {
  /** Translate using the configured provider and key. */
  translate(text: string, source: Locale, target: Locale): Promise<TranslationResult>;
}