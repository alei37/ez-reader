import type { AnnotationStore } from "../ports/AnnotationStore";
import type { TranslationProvider, TranslationRequest, TranslationResult, TranslationService as ITranslationService } from "../ports/TranslationProvider";
import type { PluginSettings } from "../types/ReaderSettings";
import type { Locale } from "../types/Locale";

/**
 * 翻译输入的最大字符数。
 *
 * 为什么需要上限: 翻译是本插件**唯一**的联网功能, 而且用的是用户自己的
 * API key / 额度。用户误把整章(甚至整本书)选中, 或者 PDF 里选区失控,
 * 就是几万字符直接打出去 —— 有道按字符计费, OpenAI 兼容的按 token 计费,
 * 一次误操作可能烧掉大半个额度。
 *
 * 为什么是拒绝而不是截断:
 *   - 截断 = 静默改变语义。用户选的是一整段话, 拿回的是前 2000 字的前半段
 *     译文, 界面上完全看不出少了东西, 这跟"静默返回错误结果"一样危险。
 *   - 拒绝 = 一次明确的、可行动的反馈("太长了, 只选一句")。
 * 定在 5000: 一段话 / 一页纸能覆盖真实查词场景, 而 5000 字符 ≈ 3500 token,
 * 远低于任何主流模型和翻译 API 的单次上限, 不会因为超限被服务端拒。
 */
export const MAX_TRANSLATION_CHARS = 5_000;

/**
 * Coordinator that picks the configured provider, validates the key, and
 * hands the request off. Translation is the only network feature in the
 * plugin and is gated on having settings configured.
 */
export class TranslationCoordinator implements ITranslationService {
  private readonly providers = new Map<string, TranslationProvider>();

  /**
   * Short-TTL cache of `listSettings()`. Settings are read on every
   * translate() call but rarely change — caching for ~30s avoids the
   * IO hit on rapid translation requests (e.g. user translating
   * multiple selections in succession). `invalidate()` lets settings-tab
   * saves bust the cache immediately.
   */
  private cachedSettings: { value: PluginSettings; fetchedAt: number } | null = null;
  private static readonly SETTINGS_CACHE_TTL_MS = 30_000;

  /**
   * In-flight requests keyed by `providerId|target|text`.
   *
   * 为什么需要: 同一个词可能被**同时**从三个入口触发 —— 选词浮层菜单
   * (`ReaderSelectionMenu`)、翻译抽屉 (`TranslationDrawer`)、PDF 覆盖层
   * (`PdfOverlay`)。用户划一次词, 三处都可能各发一次, 于是:
   *   1. 同一段原文被打 3 次 → 白烧 3 倍 API 额度(用户的 key!)
   *   2. 三次响应**乱序**回来, 后到的覆盖先到的, 抽屉里最终显示的可能
   *      是最慢那次的结果, 用户看到"点了没反应"或内容闪变。
   *
   * 只在 in-flight 期间共享, 请求结束立刻移除 —— 所以这不是缓存: 用户
   * 之后再查同一个词会真的重新请求, 不会拿到几分钟前的旧译文。
   */
  private readonly inFlight = new Map<string, Promise<TranslationResult>>();

  constructor(
    private readonly annotations: AnnotationStore,
    providers: ReadonlyArray<TranslationProvider>
  ) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  listProviders(): ReadonlyArray<TranslationProvider> {
    return [...this.providers.values()];
  }

  /** Drop the settings cache. Called by Plugin after saveSettings. */
  invalidate(): void {
    this.cachedSettings = null;
  }

  private async getSettings(): Promise<PluginSettings> {
    const now = Date.now();
    if (
      this.cachedSettings &&
      now - this.cachedSettings.fetchedAt < TranslationCoordinator.SETTINGS_CACHE_TTL_MS
    ) {
      return this.cachedSettings.value;
    }
    const value = await this.annotations.listSettings();
    this.cachedSettings = { value, fetchedAt: now };
    return value;
  }

  async translate(text: string, source: Locale, target: Locale): Promise<TranslationResult> {
    if (text.length > MAX_TRANSLATION_CHARS) {
      // 中文提示: 抛给 UI 层由抽屉渲染, 用户看到的是"选太长了"而不是 HTTP 400。
      throw new Error(
        `待翻译文本过长: ${text.length} 字符,上限 ${MAX_TRANSLATION_CHARS} 字符。请只选中句子或段落后重试。`
      );
    }
    const settings = await this.getSettings();
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

    // 去重的 key 必须包含最终 request 的三个维度, 否则"同一段原文译到不同语言"
    // 会被错误合并成一个结果。
    const key = `${provider.id}\u0000${request.target}\u0000${request.text}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const apiKey = settings.translation.apiKey;
    // 注意: 这里**不能**写成 `async () => provider.translate(...)` 再立刻
    // `finally` 里 delete —— promise 还没被 await 时 finally 已经跑完了,
    // 去重表瞬间失效。必须挂在一个自引用 promise 的 finally 上。
    const pending: Promise<TranslationResult> = (async () => {
      try {
        return await provider.translate(apiKey, request);
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, pending);
    return pending;
  }
}