import type { AnnotationStore } from "../ports/AnnotationStore";
import type { TranslationProvider, TranslationRequest, TranslationResult, TranslationService as ITranslationService } from "../ports/TranslationProvider";
import type { Locale } from "../types/Locale";

/**
 * Coordinator that picks the configured provider, validates the key, and
 * hands the request off. Translation is the only network feature in the
 * plugin and is gated on having settings configured.
 */
export class TranslationCoordinator implements ITranslationService {
  private readonly providers = new Map<string, TranslationProvider>();

  constructor(
    private readonly annotations: AnnotationStore,
    providers: ReadonlyArray<TranslationProvider>
  ) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  listProviders(): ReadonlyArray<TranslationProvider> {
    return [...this.providers.values()];
  }

  async translate(text: string, source: Locale, target: Locale): Promise<TranslationResult> {
    const settings = await this.annotations.listSettings();
    if (!settings.translation) {
      throw new Error("Translation is not configured. Add an API key in plugin settings first.");
    }
    const provider = this.providers.get(settings.translation.providerId);
    if (!provider) {
      throw new Error(`Unknown translation provider: ${settings.translation.providerId}`);
    }
    const request: TranslationRequest = {
      text,
      source: settings.translation.sourceLocale || source,
      target: settings.translation.targetLocale || target
    };
    return provider.translate(settings.translation.apiKey, request);
  }
}