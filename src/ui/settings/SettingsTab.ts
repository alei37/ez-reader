import { Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type { App, Plugin } from "obsidian";
import { ConfirmModal } from "../reader/ConfirmModal";
import type { AnnotationStore } from "../../core/ports/AnnotationStore";
import type { TranslationProvider } from "../../core/ports/TranslationProvider";
import { isUiLocale, UI_LOCALES, type UiLocale } from "../../core/types/Locale";
import {
  DEFAULT_READER_APPEARANCE,
  SHELF_DENSITIES,
  SHELF_DENSITY_LABELS,
  type PluginSettings,
  type ReaderTheme,
  type ShelfDensity,
  type TranslationSettings
} from "../../core/types/ReaderSettings";

/**
 * Strip credentials from a snapshot before it leaves the vault.
 *
 * The exported JSON is a file the user emails, syncs, or commits to a
 * notes repo. `settings.translation.apiKey` is a plaintext credential —
 * for the Google provider it is a full service-account JSON including a
 * `private_key`. Shipping it in a "data backup" is how keys end up in
 * git history.
 *
 * The key is replaced with an empty string plus a marker so that
 * `restoreExportedKeys` can tell "intentionally blanked by the exporter"
 * apart from "user genuinely has no key". Import then keeps whatever key
 * the vault already has, which makes export → import a safe round-trip.
 */
export const redactSecrets = <T>(snapshot: T): T => {
  const copy = structuredCloneCompat(snapshot) as {
    settings?: { translation?: RedactableTranslation | null };
  };
  const translation = copy?.settings?.translation;
  if (translation && typeof translation === "object") {
    translation.apiKey = "";
    translation.__redactedApiKey = true;
  }
  return copy as T;
};

/**
 * Re-apply the current API key when importing a file that was produced by
 * {@link redactSecrets}. Never overwrites a key the user actually set.
 */
export const restoreExportedKeys = <T>(incoming: T, current: T): T => {
  const next = incoming as { settings?: { translation?: RedactableTranslation | null } };
  const nextTranslation = next?.settings?.translation;
  if (!nextTranslation || nextTranslation.__redactedApiKey !== true) return incoming;
  const currentKey = (current as { settings?: { translation?: TranslationSettings | null } })
    ?.settings?.translation?.apiKey;
  nextTranslation.apiKey = currentKey ?? "";
  delete nextTranslation.__redactedApiKey;
  return incoming;
};

/** Translation settings plus the marker `redactSecrets` stamps on export. */
type RedactableTranslation = {
  -readonly [K in keyof TranslationSettings]: TranslationSettings[K];
} & { __redactedApiKey?: boolean };

const structuredCloneCompat = <T>(value: T): T => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const THEMES: ReaderTheme[] = ["system", "light", "dark", "sepia"];

const themeLabel = (theme: ReaderTheme): string => {
  switch (theme) {
    case "light":
      return "浅色";
    case "dark":
      return "深色";
    case "sepia":
      return "米黄";
    default:
      return "跟随系统";
  }
};

/**
 * Trailing-edge debounce for slider / text onChange. Slider drag fires
 * dozens of events per second; without this every fire does one disk
 * write and saturates IO.
 *
 * `flush()` is exposed so the host can commit any pending write before
 * the settings tab closes (otherwise the last drag tick is lost — the
 * settings tab's `display()` and `hide()` both use `flush()` instead of
 * `cancel()`).
 */
const debounceAsync = <T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
  ms = 300
): ((...args: T) => void) & { flush(): Promise<void>; cancel(): void } => {
  let timer: number | undefined;
  let pendingArgs: T | undefined;
  let hasPending = false;
  const invoke = async (): Promise<void> => {
    timer = undefined;
    if (hasPending && pendingArgs) {
      hasPending = false;
      const args = pendingArgs;
      pendingArgs = undefined;
      try {
        await fn(...args);
      } catch (error) {
        // debounce 内部的失败走 Notice 而不是 console: Obsidian 的 `no-console`
        // 是锁死 rule, 而且用户看不到 console —— 他只会觉得"改了没生效"。
        new Notice(`保存设置失败: ${describeSaveFailure(error)}`);
      }
    }
  };
  const debounced = (...args: T): void => {
    pendingArgs = args;
    hasPending = true;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => void invoke(), ms);
  };
  debounced.flush = async (): Promise<void> => {
    if (timer !== undefined) window.clearTimeout(timer);
    await invoke();
  };
  debounced.cancel = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    hasPending = false;
    pendingArgs = undefined;
  };
  return debounced;
};

/**
 * Turn a thrown value into a Chinese, user-actionable sentence.
 *
 * 为什么需要它: 设置页的保存路径上真的会抛 —— 上一个 commit 给
 * `OpenAICompatibleTranslationProvider` 加了"baseUrl 非 https 就拒绝发送"的
 * 安全闸门, `patchSettings` 之外的校验失败、磁盘满、vault 只读也都会抛。
 * 这些 Error 的 message 是给开发者看的英文技术描述, 直接
 * `new Notice(String(err.message))` 怼到界面上, 用户既看不懂也不知道该改哪。
 *
 * 特殊处理 https 那条: 它包含当前填错的地址和原因, 但那半句是英文,
 * 所以换成人话 + 明确指出要改哪个设置项。
 */
export const describeSaveFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/https:\/\//i.test(message) || message.includes("API 基础地址")) {
    return "API 基础地址必须是以 https:// 开头的网址(为避免 API key 明文外发, 已拒绝发送)。请在「翻译服务 → LLM · API 基础地址」里改掉。";
  }
  return `保存设置失败: ${message}`;
};

export class SettingsTab extends PluginSettingTab {
  // TODO(community-plugin-review): PluginSettingTab 建议实现 getSettingDefinitions()
  // 以走 Obsidian 的声明式设置 API。当前我们手写 render() 路径,
  // 重构成声明式是较大的改动 — 留作后续 P2 polish, 本次 lint 清理不改行为.
  private readonly providerMap: Map<string, TranslationProvider>;
  // Slider drag + continuous text input fire dozens of onChange per
  // second. Without debouncing they race against each other in IO. Each
  // render() creates fresh debouncers and we cancel the previous batch so
  // pending writes from the previous render don't leak after the user
  // navigates to a different tab.
  private activeDebouncers: Array<{ flush: () => Promise<void>; cancel: () => void }> = [];

  constructor(app: App, plugin: Plugin, private readonly annotations: AnnotationStore, providers: ReadonlyArray<TranslationProvider> = []) {
    super(app, plugin);
    this.providerMap = new Map(providers.map((p) => [p.id, p]));
  }

  private findProviderMeta(providerId: string): { signupUrl?: string; signupHint?: string } | null {
    if (providerId === "none") return null;
    const provider = this.providerMap.get(providerId);
    if (!provider) return null;
    return {
      signupUrl: provider.signupUrl,
      signupHint: provider.signupHint
    };
  }

  display(): void {
    const { containerEl } = this;
    // Flush any pending debounced writes from the previous render BEFORE
    // tearing down the controls. Previously we called `cancel()` here,
    // which silently dropped the user's last slider drag — they moved the
    // slider, switched tabs, and the value never landed. `flush()` is
    // awaitable but the SettingsTab render is synchronous, so we kick it
    // off and let the in-flight debouncers settle on the previous DOM.
    const flushes = this.activeDebouncers.map((d) => d.flush());
    this.activeDebouncers = [];
    void Promise.allSettled(flushes);
    containerEl.empty();
    containerEl.addClass("ez-reader__settings");

    this.renderAppearanceSection(containerEl);
    this.renderReadingSection(containerEl);
    this.renderNotesSection(containerEl);
    this.renderTranslationSection(containerEl);
    this.renderUISection(containerEl);
    this.renderAboutSection(containerEl);
  }

  /**
   * Flush every pending debounced write. Public so the host can commit
   * before teardown — `Plugin.onunload()` has the same problem as `hide()`
   * (an in-flight 300ms timer dies with the process), and that file is
   * outside this fix's write scope.
   *
   * Must never reject: callers fire-and-forget it (`void this.x()`), and a
   * rejection here would itself become an unhandled rejection.
   */
  async flushPendingSaves(): Promise<void> {
    const pending = this.activeDebouncers;
    // 先清空再 flush: flush() 是 async 的, 期间如果用户又触发一次 display(),
    // 新的 debouncer 会注册进来; 提前清空可以避免把那批也一起提前提交
    // (它们还不到 debounce 窗口, 提前提交会让滑块每一帧都写一次盘)。
    this.activeDebouncers = [];
    if (pending.length === 0) return;
    await Promise.allSettled(pending.map((d) => d.flush()));
  }

  /**
   * Obsidian closes the settings modal by calling `hide()`, and the base
   * implementation does nothing. Without this override, the debounced
   * writes for the last edit (a slider drag, or the LLM `baseUrl` text
   * field) die with the modal: the user typed a value, closed settings,
   * and it was never written to `data.json`. `display()` already flushes
   * on tab switches; this covers the close-the-whole-modal path.
   */
  hide(): void {
    void this.flushPendingSaves();
  }

  /**
   * Run an async settings mutation, converting any rejection into a Notice.
   *
   * Every `onChange(async …)` in this file used to be unhandled: it is
   * handed to Obsidian's dropdown/toggle, which neither awaits nor catches
   * it. A rejection there is an unhandled promise rejection — invisible to
   * the user, and `no-console` means there's not even a log line. These
   * handlers really do throw now (the provider's https security gate, disk
   * errors from `patchSettings`), so every one of them is wrapped here.
   *
   * Resolves (never rejects) so callers can `void this.runSafely(…)`.
   */
  async runSafely(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      new Notice(`${label}失败: ${describeSaveFailure(error)}`);
    }
  }

  /**
   * Wrap an async save function in a trailing-edge debouncer and register
   * it for cancellation on the next render(). Toggle / dropdown changes
   * are discrete and don't need this — only sliders and continuous text
   * inputs do.
   */
  private debounceSave<T extends unknown[]>(
    fn: (...args: T) => Promise<void>,
    ms = 300
  ): (...args: T) => void {
    const d = debounceAsync(fn, ms);
    this.activeDebouncers.push(d);
    return d;
  }

  private async loadSettings(): Promise<PluginSettings> {
    return this.annotations.listSettings();
  }

  // ---- 默认阅读外观 ----
  private renderAppearanceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("默认阅读外观").setHeading();
    // All slider / text debouncers use patchSettings instead of the old
    // loadSettings() + saveSettings() pair. patchSettings runs the
    // read-modify-write atomically inside the store's write chain, so
    // concurrent drags can't overwrite each other's fields.
    const saveFontSize = this.debounceSave(async (value: number) => {
      await this.annotations.patchSettings((s) => ({
        ...s,
        defaultAppearance: { ...s.defaultAppearance, fontSize: value }
      }));
    });
    const saveLineHeight = this.debounceSave(async (value: number) => {
      await this.annotations.patchSettings((s) => ({
        ...s,
        defaultAppearance: { ...s.defaultAppearance, lineHeight: value }
      }));
    });
    const saveMargin = this.debounceSave(async (value: number) => {
      await this.annotations.patchSettings((s) => ({
        ...s,
        defaultAppearance: { ...s.defaultAppearance, margin: value }
      }));
    });
    new Setting(containerEl)
      .setName("字号")
      .setDesc("默认 100%; 范围 60%-200%")
      .addSlider((slider) =>
        slider
          .setLimits(60, 200, 5)
          .setValue(DEFAULT_READER_APPEARANCE.fontSize)
          .onChange((value) => saveFontSize(value))
      );
    new Setting(containerEl)
      .setName("行距")
      .setDesc("默认 1.6; 范围 1.0-2.4")
      .addSlider((slider) =>
        slider
          .setLimits(1.0, 2.4, 0.1)
          .setValue(DEFAULT_READER_APPEARANCE.lineHeight)
          .onChange((value) => saveLineHeight(value))
      );
    new Setting(containerEl)
      .setName("页边距")
      .setDesc("默认 32px; 范围 0-80px")
      .addSlider((slider) =>
        slider
          .setLimits(0, 80, 4)
          .setValue(DEFAULT_READER_APPEARANCE.margin)
          .onChange((value) => saveMargin(value))
      );
    new Setting(containerEl)
      .setName("默认主题")
      .setDesc("新书打开时使用的主题")
      .addDropdown((dropdown) => {
        for (const theme of THEMES) {
          dropdown.addOption(theme, themeLabel(theme));
        }
        void this.loadSettings().then((s) => {
          dropdown.setValue(s.defaultAppearance.theme);
        });
        dropdown.onChange((value) =>
          this.runSafely("保存默认主题", async () => {
            if (!THEMES.includes(value as ReaderTheme)) return;
            await this.annotations.patchSettings((s) => ({
              ...s,
              defaultAppearance: { ...s.defaultAppearance, theme: value as ReaderTheme }
            }));
          })
        );
      });
    new Setting(containerEl)
      .setName("默认排版")
      .setDesc("paginated = 单页翻页; scrolled = 滚屏")
      .addDropdown((dropdown) => {
        dropdown.addOption("paginated", "单页翻页");
        dropdown.addOption("scrolled", "连续滚屏");
        void this.loadSettings().then((s) => {
          dropdown.setValue(s.defaultAppearance.flow);
        });
        dropdown.onChange((value) =>
          this.runSafely("保存默认排版", async () => {
            if (value !== "paginated" && value !== "scrolled") return;
            await this.annotations.patchSettings((s) => ({
              ...s,
              defaultAppearance: { ...s.defaultAppearance, flow: value }
            }));
          })
        );
      });
  }

  // ---- 阅读体验 ----
  private renderReadingSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("阅读体验").setHeading();
    new Setting(containerEl)
      .setName("打开阅读器方式")
      .setDesc("在当前标签页打开 / 弹窗打开")
      .addDropdown((dropdown) => {
        dropdown.addOption("tab", "在标签页中打开");
        dropdown.addOption("window", "在新窗口中打开");
        void this.loadSettings().then((s) => {
          dropdown.setValue(s.readerOpenMode);
        });
        dropdown.onChange((value) =>
          this.runSafely("保存阅读器打开方式", async () => {
            if (value !== "tab" && value !== "window") return;
            await this.annotations.patchSettings((s) => ({ ...s, readerOpenMode: value }));
          })
        );
      });
    new Setting(containerEl)
      .setName("记住阅读进度")
      .setDesc("打开书时自动跳转到上次阅读位置")
      .addToggle((toggle) => {
        void this.loadSettings().then((s) => {
          toggle.setValue(s.rememberProgress !== false);
        });
        toggle.onChange((value) =>
          this.runSafely("保存阅读进度选项", async () => {
            await this.annotations.patchSettings((s) => ({ ...s, rememberProgress: value }));
          })
        );
      });
    new Setting(containerEl)
      .setName("默认双页显示")
      .setDesc("新书打开时默认开启双页(仅桌面, foliate 适用)")
      .addToggle((toggle) => {
        void this.loadSettings().then((s) => {
          toggle.setValue(s.twoPagesByDefault ?? false);
        });
        toggle.onChange((value) =>
          this.runSafely("保存双页显示选项", async () => {
            await this.annotations.patchSettings((s) => ({ ...s, twoPagesByDefault: value }));
          })
        );
      });
    new Setting(containerEl)
      .setName("Pad 默认沉浸模式")
      .setDesc("在 Pad / 窄屏上打开书时自动进入沉浸模式(隐藏工具栏)")
      .addToggle((toggle) => {
        void this.loadSettings().then((s) => {
          toggle.setValue(s.immersiveOnTablet ?? false);
        });
        toggle.onChange((value) =>
          this.runSafely("保存沉浸模式选项", async () => {
            await this.annotations.patchSettings((s) => ({ ...s, immersiveOnTablet: value }));
          })
        );
      });
    // 键盘快捷键当前展示但不可编辑 — 自定义 UI 在路线图里. 这里给个只读
    // summary, 用户能看到当前生效的快捷键.
    const shortcutSummary = new Setting(containerEl)
      .setName("键盘快捷键")
      .setDesc("阅读器键盘快捷键(当前只读;自定义编辑器在路线图里)");
    void this.loadSettings().then((s) => {
      const shortcuts = s.keyboardShortcuts;
      shortcutSummary.controlEl.createDiv({
        cls: "ez-reader__settings-readonly",
        text:
          `上一页:${shortcuts?.prev ?? "ArrowLeft"} · 下一页:${shortcuts?.next ?? "ArrowRight"}` +
          ` · 笔记:${shortcuts?.toggleSidebar ?? "s"} · 目录:${shortcuts?.toggleToc ?? "t"}` +
          ` · 翻译:${shortcuts?.translate ?? "T"} · 高亮:${shortcuts?.highlight ?? "h"}`
      });
    });
  }

  // ---- 笔记与摘录 ----
  //
  // v0.3.0: 不再有可配置的"摘录笔记目录" / "主题研究目录" / "笔记模板"。
  // 文件布局固定为 `<vault>/ezreader/{notes,info,sessions}/<title>-<id>.md`,
  // header hardcoded (不再支持 `{{title}} {{author}}` 占位符)。
  // 这里只展示一段说明文字,让用户知道结构。
  private renderNotesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("笔记与摘录").setHeading();
    const desc = containerEl.createDiv({ cls: "ez-reader__settings-readonly" });
    desc.createEl("p", {
      text: "v0.3.0 起,所有 EzReader 文件统一放在 vault 根的 `ezreader/` 目录下:"
    });
    const list = desc.createEl("ul");
    list.createEl("li", {
      text: "`ezreader/notes/<title>-<id>.md` — 摘录与想法笔记 (双链 + 块 ID)"
    });
    list.createEl("li", {
      text: "`ezreader/info/<title>-<id>.md` — 书籍基本信息 (YAML frontmatter)"
    });
    list.createEl("li", {
      text: "`ezreader/sessions/<title>-<id>.jsonl` — 阅读时长 session 明细 (append-only)"
    });
    desc.createEl("p", {
      text: "从 v0.2.x 升级的用户,首次启动会自动把 `ezreader-notes/阅读笔记/` 下的笔记搬过来。"
    });
  }

  // ---- 翻译 ----
  private renderTranslationSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("翻译").setHeading();
    // 选完翻译服务后, 在原 setting 下面追加一行 hint + 跳转链接
    // (Obsidian Setting 没原生支持内嵌 <a>, 我们手动追加 .ez-reader__settings-hint)
    const providerSetting = new Setting(containerEl)
      .setName("翻译服务")
      .setDesc("选择在线翻译 API;留空 = 不联网。")
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "关闭");
        dropdown.addOption("youdao", "有道智云 · 文本翻译");
        dropdown.addOption("deepl", "DeepL");
        dropdown.addOption("google-translation-v3", "Google Translate (Cloud v3)");
        dropdown.addOption("mymemory", "MyMemory (免费, 无需注册)");
        dropdown.addOption("openai-compatible", "自定义 LLM (OpenAI 兼容)");
        dropdown.addOption("anthropic-compatible", "自定义 LLM (Anthropic 兼容)");
        void this.loadSettings().then((s) => {
          dropdown.setValue(s.translation?.providerId ?? "none");
        });
        dropdown.onChange((value) =>
          this.runSafely("保存翻译服务", async () => {
            await this.annotations.patchSettings((s) => {
              if (value === "none") {
                return { ...s, translation: null };
              }
              // 切 provider 时清掉旧 key: 有道是 JSON {appKey, appSecret},
              // DeepL 是裸字符串, Google 是另一种 JSON. 三者不通用, 留着只会
              // 让用户看到下一屏"格式不对"的报错, 不如直接清掉让重新填.
              const prevProvider = s.translation?.providerId;
              const next: TranslationSettings = {
                providerId: value,
                apiKey: prevProvider === value ? (s.translation?.apiKey ?? "") : "",
                sourceLocale: s.translation?.sourceLocale ?? "auto",
                targetLocale: s.translation?.targetLocale ?? "zh-CN"
              };
              return { ...s, translation: next };
            });
            // patchSettings 已经 await, 这时 disk 上是新 provider. 立即重渲染
            // API key 输入区(有道 = 两个, 其他 = 一个), 老 DOM 留着用户会被旧
            // placeholder 误导.
            await this.renderTranslationApiKeyUi(containerEl);
          })
        );
      });
    const hint = providerSetting.settingEl.createDiv({ cls: "ez-reader__settings-hint is-hidden" });
    const refreshHint = (providerId: string): void => {
      const meta = this.findProviderMeta(providerId);
      hint.empty();
      hint.removeClass("is-hidden");
      if (!meta) {
        hint.addClass("is-hidden");
        return;
      }
      if (meta.signupHint) {
        hint.createEl("span", { text: meta.signupHint, cls: "ez-reader__settings-hint__text" });
      }
      if (meta.signupUrl) {
        const link = hint.createEl("a", {
          text: meta.signupUrl,
          attr: { href: meta.signupUrl, target: "_blank", rel: "noopener noreferrer" }
        });
        link.addClass("ez-reader__settings-hint__link");
      }
    };
    // 初次显示当前选中的 provider
    void this.loadSettings().then((s) => refreshHint(s.translation?.providerId ?? "none"));
    // dropdown 变化时刷新 hint
    providerSetting.controlEl.querySelector("select")?.addEventListener("change", (event) => {
      const value = (event.target as HTMLSelectElement).value;
      refreshHint(value);
    });
    // 渲染 API key 输入区(根据 provider 决定是两字段还是有道模式)
    void this.renderTranslationApiKeyUi(containerEl);
    new Setting(containerEl)
      .setName("目标语言")
      .setDesc("默认翻译到的语言(例如 zh-CN / en-US)")
      .addText((text) => {
        const saveTargetLocale = this.debounceSave(async (value: string) => {
          await this.annotations.patchSettings((s) => {
            if (!s.translation) return s;
            return { ...s, translation: { ...s.translation, targetLocale: value } };
          });
        });
        void this.loadSettings().then((s) => {
          text.setValue(s.translation?.targetLocale ?? "zh-CN");
        });
        text.onChange((value) => saveTargetLocale(value));
      });
  }

  /**
   * 渲染"翻译 API key"输入块 — 根据 provider 动态决定是两字段(有道)还是
   * 单字段(DeepL/Google). API key 在底层仍以 JSON 字符串存 (provider
   * 接口契约不变), UI 只是把 JSON 的两个字段拆出来让用户更好填.
   *
   * @param containerEl 设置页根容器,API key 输入区插在「翻译服务」+「目标语言」之间
   */
  private async renderTranslationApiKeyUi(containerEl: HTMLElement): Promise<void> {
    // 清掉上一次的渲染残留(切 provider 时旧的两/单字段都要摘掉)
    containerEl.querySelectorAll(".ez-reader__translation-apikey").forEach((node) => node.remove());
    const settings = await this.loadSettings();
    const providerId = settings.translation?.providerId ?? "none";

    if (providerId === "none") {
      // 没选 provider 不显示 API key 输入框 — 用户没必要填
      return;
    }

    const anchor = containerEl.querySelector(".ez-reader__settings-hint");
    const wrap = document.createElement("div");
    wrap.addClass("ez-reader__translation-apikey");
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    } else {
      containerEl.appendChild(wrap);
    }

    if (providerId === "youdao") {
      this.renderYoudaoKeyFields(wrap, settings);
    } else if (providerId === "mymemory") {
      // MyMemory 是公共匿名 API, 完全不需要 key — 显示一个"无需 key"的提示,
      // 不渲染输入框. 选 MyMemory 时 provider 切换逻辑会清掉旧 apiKey, 这里
      // 不需要再 patch.
      this.renderNoKeyHint(wrap, "MyMemory 是公共免费翻译服务,无需注册也无需 API key。每日每个 IP 1 万字符额度,适合偶尔查词。");
    } else if (providerId === "openai-compatible") {
      this.renderLLMConfigFields(wrap, settings, {
        baseUrlHint: "https://api.openai.com/v1",
        title: "LLM · API 基础地址",
        desc: "OpenAI 兼容格式的 /v1 端点。例如 https://api.openai.com/v1, https://api.deepseek.com/v1",
        examples: [
          "DeepSeek: https://api.deepseek.com/v1 + model=deepseek-chat",
          "智谱 GLM: https://open.bigmodel.cn/api/paas/v4 + model=glm-4-flash (免费)",
          "通义千问: https://dashscope.aliyuncs.com/compatible-mode/v1 + model=qwen-turbo",
          "OpenAI: https://api.openai.com/v1 + model=gpt-4o-mini"
        ]
      });
    } else if (providerId === "anthropic-compatible") {
      this.renderLLMConfigFields(wrap, settings, {
        baseUrlHint: "https://api.minimax.cn/anthropic",
        title: "LLM · API 基础地址",
        desc: "Anthropic Messages API 兼容端点 (会自动追加 /v1/messages)。例如 https://api.minimax.cn/anthropic",
        examples: [
          "MiniMax: https://api.minimax.cn/anthropic + model=MiniMax-Text",
          "Anthropic: https://api.anthropic.com + model=claude-3-5-sonnet-20241022"
        ]
      });
    } else {
      this.renderSingleKeyField(wrap, settings);
    }
  }

  /**
   * 给"无需 API key"的 provider (e.g. MyMemory) 显示一段说明 — 不渲染输入
   * 框, 让用户知道为什么没看到 key 字段不是因为 bug.
   */
  private renderNoKeyHint(wrap: HTMLElement, text: string): void {
    const note = wrap.createDiv({ cls: "ez-reader__translation-apikey__no-key" });
    note.setText(text);
  }

  /**
   * 有道: 两个 password 字段分别填 appKey 和 appSecret, 在用户输入时合并成
   * JSON `{"appKey":"...","appSecret":"..."}` 存到 settings.translation.apiKey。
   * 这样底层 provider 接口(`apiKey: string`)不需要改, 老数据(已经是 JSON
   * 格式)也能直接读到两个字段里.
   */
  private renderYoudaoKeyFields(wrap: HTMLElement, settings: PluginSettings): void {
    let stored: { appKey: string; appSecret: string } = { appKey: "", appSecret: "" };
    const raw = settings.translation?.apiKey ?? "";
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Partial<{ appKey: string; appSecret: string }>;
        stored = {
          appKey: typeof parsed.appKey === "string" ? parsed.appKey : "",
          appSecret: typeof parsed.appSecret === "string" ? parsed.appSecret : ""
        };
      } catch {
        // 老数据可能是裸字符串 / 损坏 JSON, 留空让用户重新填
      }
    }
    const persist = this.debounceSave(async (next: { appKey: string; appSecret: string }) => {
      const json = JSON.stringify(next);
      await this.annotations.patchSettings((s) => {
        if (!s.translation) return s;
        return { ...s, translation: { ...s.translation, apiKey: json } };
      });
    });
    // 输入框右侧加「👁 显示」按钮 — 默认 password 类型(掩码), 点一下切到 text
    // 类型, 方便用户校对粘错/漏字符. 再点一次切回 password.
    const addPasswordField = (label: string, desc: string, key: "appKey" | "appSecret"): void => {
      new Setting(wrap)
        .setName(label)
        .setDesc(desc)
        .addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.inputEl.spellcheck = false;
          text.setPlaceholder(key === "appKey" ? "应用 ID, 16 位字符串" : "应用密钥, 只在创建时显示一次");
          text.setValue(stored[key]);
          const update = (value: string): void => {
            const next = { appKey: stored.appKey, appSecret: stored.appSecret };
            next[key] = value.trim();
            stored = next;
            void persist(next);
          };
          text.onChange((value) => update(value));
        })
        .addExtraButton((button) => {
          button.setIcon("eye");
          button.setTooltip("显示 / 隐藏");
          button.onClick(() => {
            const inputs = wrap.querySelectorAll<HTMLInputElement>(".ez-reader__translation-apikey input");
            const idx = key === "appKey" ? 0 : 1;
            const target = inputs[idx];
            if (!target) return;
            const isHidden = target.type === "password";
            target.type = isHidden ? "text" : "password";
            button.setIcon(isHidden ? "eye-off" : "eye");
          });
        });
    };
    addPasswordField(
      "有道 · 应用 ID (appKey)",
      "在有道智云控制台 → 我的应用 → 应用详情 查看",
      "appKey"
    );
    addPasswordField(
      "有道 · 应用密钥 (appSecret)",
      "只在创建应用时显示一次,丢失请重置密钥",
      "appSecret"
    );
  }

  /**
   * DeepL / Google: 单字段输入(DeepL 是裸 key, Google 是 service account JSON).
   * 用户切换到这两个 provider 时刚才选这个编辑旧的 JSON apiKey 字段会被 provider 切换清空.
   */
  /**
   * 自定义 LLM provider 通用三字段渲染 — OpenAI 兼容 / Anthropic 兼容 共用
   * 这个 UI. 内部用 JSON `{"baseUrl":"...","apiKey":"...","model":"..."}`
   * 存到 settings.translation.apiKey, provider 接口(apiKey: string)不变.
   *
   * @param opts.baseUrlHint  baseUrl 字段的 placeholder, 不同 provider 不同
   * @param opts.title        第一个字段的标题(目前都叫 "LLM · API 基础地址")
   * @param opts.desc         第一个字段的描述(讲 endpoint 路径约定)
   * @param opts.examples     末尾示例数组, 一行一个
   */
  private renderLLMConfigFields(
    wrap: HTMLElement,
    settings: PluginSettings,
    opts: { baseUrlHint: string; title: string; desc: string; examples: string[] }
  ): void {
    let stored = { baseUrl: "", apiKey: "", model: "" };
    const raw = settings.translation?.apiKey ?? "";
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Partial<{ baseUrl: string; apiKey: string; model: string }>;
        stored = {
          baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
          apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
          model: typeof parsed.model === "string" ? parsed.model : ""
        };
      } catch {
        // 老 JSON 损坏 — 留空让用户重填
      }
    }
    const persist = this.debounceSave(async (next: { baseUrl: string; apiKey: string; model: string }) => {
      const json = JSON.stringify(next);
      await this.annotations.patchSettings((s) => {
        if (!s.translation) return s;
        return { ...s, translation: { ...s.translation, apiKey: json } };
      });
    });
    const update = (patch: Partial<typeof stored>): void => {
      const next = { ...stored, ...patch };
      stored = next;
      void persist(next);
    };
    new Setting(wrap)
      .setName(opts.title)
      .setDesc(opts.desc)
      .addText((text) => {
        text.inputEl.type = "text";
        text.inputEl.autocomplete = "off";
        text.inputEl.placeholder = opts.baseUrlHint;
        text.setValue(stored.baseUrl);
        text.onChange((value) => update({ baseUrl: value.trim() }));
      });
    new Setting(wrap)
      .setName("LLM · API Key")
      .setDesc("对应 API 基础地址的密钥")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.inputEl.spellcheck = false;
        text.setPlaceholder("sk-...");
        text.setValue(stored.apiKey);
        text.onChange((value) => update({ apiKey: value.trim() }));
      })
      .addExtraButton((button) => {
        button.setIcon("eye");
        button.setTooltip("显示 / 隐藏");
        button.onClick(() => {
          const input = wrap.querySelector<HTMLInputElement>(".ez-reader__translation-apikey input[type='password']");
          if (!input) return;
          const isHidden = input.type === "password";
          input.type = isHidden ? "text" : "password";
          button.setIcon(isHidden ? "eye-off" : "eye");
        });
      });
    new Setting(wrap)
      .setName("LLM · 模型名")
      .setDesc("具体模型标识, 见下方示例或供应商控制台")
      .addText((text) => {
        text.inputEl.type = "text";
        text.inputEl.autocomplete = "off";
        text.inputEl.placeholder = "model-id";
        text.setValue(stored.model);
        text.onChange((value) => update({ model: value.trim() }));
      });
    const examples = wrap.createDiv({ cls: "ez-reader__translation-apikey__examples" });
    examples.setText("常用示例:\n" + opts.examples.map((line) => `  ${line}`).join("\n"));
  }

  private renderSingleKeyField(wrap: HTMLElement, settings: PluginSettings): void {
    const desc = settings.translation?.providerId === "google-translation-v3"
      ? "Google: 粘贴 service account JSON 的完整内容({...}),不是 API key。"
      : "DeepL: 在 DeepL Pro 控制台 → Account → Authentication key 复制。";
    new Setting(wrap)
      .setName("翻译 API key")
      .setDesc(desc)
      .addText((text) => {
        text.inputEl.type = "password";
        const saveKey = this.debounceSave(async (value: string) => {
          await this.annotations.patchSettings((s) => {
            if (!s.translation) {
              if (!value) return s;
              return {
                ...s,
                translation: {
                  providerId: settings.translation?.providerId ?? "deepl",
                  apiKey: value,
                  sourceLocale: "auto",
                  targetLocale: "zh-CN"
                }
              };
            }
            return { ...s, translation: { ...s.translation, apiKey: value } };
          });
        });
        text.setValue(settings.translation?.apiKey ?? "");
        text.onChange((value) => saveKey(value));
      });
  }

  // ---- 界面 ----
  private renderUISection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("界面").setHeading();
    new Setting(containerEl)
      .setName("界面语言")
      .setDesc("选择插件界面语言;切换后会重新打开已经打开的页面。")
      .addDropdown((dropdown) => {
        for (const { code, label } of UI_LOCALES) {
          dropdown.addOption(code, label);
        }
        void this.annotations.listSettings().then((settings) => {
          dropdown.setValue(isUiLocale(settings.uiLocale) ? settings.uiLocale : "zh-CN");
        });
        dropdown.onChange((value) =>
          this.runSafely("保存界面语言", async () => {
            if (!isUiLocale(value)) return;
            await this.annotations.patchSettings((s) => ({ ...s, uiLocale: value satisfies UiLocale }));
            // UI 翻译是 patch 完 settings 不会自动应用 — i18n 字符串
            // (button / label / desc) 已经在构造时定下来了. 提示用户
            // 重启让翻译生效. (Obsidian 本身没有 plugin 自刷新 API).
            new Notice("界面语言将在重启后生效");
          })
        );
      });
    new Setting(containerEl)
      .setName("书架封面密度")
      .setDesc("影响网格列数和列表封面尺寸。紧凑=每行多本,超大=每行一本大封面。")
      .addDropdown((dropdown) => {
        for (const density of SHELF_DENSITIES) {
          dropdown.addOption(density, SHELF_DENSITY_LABELS[density]);
        }
        void this.loadSettings().then((s) => {
          const raw = s.shelfDensity ?? "default";
          dropdown.setValue(SHELF_DENSITIES.includes(raw) ? raw : "default");
        });
        dropdown.onChange((value) =>
          this.runSafely("保存封面密度", async () => {
            if (!SHELF_DENSITIES.includes(value as ShelfDensity)) return;
            await this.annotations.patchSettings((s) => ({ ...s, shelfDensity: value as ShelfDensity }));
          })
        );
      });
  }

  // ---- 关于 ----
  private renderAboutSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("关于").setHeading();
    const about = containerEl.createDiv({ cls: "ez-reader__settings-about" });
    about.createEl("p", {
      text: "EzReader — 在 Obsidian 中阅读本地电子书,自动生成双链笔记与摘录。"
    });
    about.createEl("p", {
      text: "项目地址: github.com/alei37/ez-reader"
    });
    const actions = about.createDiv({ cls: "ez-reader__settings-about__actions" });
    const exportBtn = actions.createEl("button", { text: "导出全部数据 (JSON)", attr: { type: "button" } });
    exportBtn.onclick = () => void this.exportData();
    const importBtn = actions.createEl("button", { text: "导入数据 (JSON)", attr: { type: "button" } });
    importBtn.onclick = () => void this.importData();
  }

  private async exportData(): Promise<void> {
    // 整个导出流程包 try/catch: 调用方是 `exportBtn.onclick = () => void this.exportData()`,
    // 抛出去就是 unhandled rejection —— 用户点了按钮, 屏幕上什么也没发生,
    // 也没任何提示, 只能反复点。失败时至少要说一句"导出失败: <原因>"。
    try {
      const data = await this.annotations.load();
      // P0 fix: never write the API key into the exported file. See
      // `redactSecrets` — for the Google provider that field is a full
      // service-account JSON with a private key.
      const json = JSON.stringify(redactSecrets(data), null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `ez-reader-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // 无论 click 成功与否都回收 blob —— 之前失败路径上 URL 永远不释放,
        // 反复点几次导出就把内存撑住了。
        URL.revokeObjectURL(url);
      }
      const hadKey = typeof (data as { settings?: { translation?: { apiKey?: string } } })
        ?.settings?.translation?.apiKey === "string" &&
        !!(data as { settings?: { translation?: { apiKey?: string } } })?.settings?.translation?.apiKey;
      new Notice(
        hadKey
          ? "数据已导出 (API key 已脱敏, 不会写入备份文件)"
          : "数据已导出"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`导出失败: ${message}`);
    }
  }

  private async importData(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        // JSON.parse returns unknown (typed as any here for ESLint compliance).
        const parsed: Record<string, unknown> = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("文件不是合法 JSON 对象");
        }
        // 必备字段校验 — 缺失则拒绝 (避免把空数据写入 plugin data)
        const required = ["version", "settings", "library", "reading", "bookmarks", "excerpts"];
        for (const key of required) {
          if (!(key in parsed)) {
            throw new Error(`缺失字段: ${key} (这可能不是 ez-reader 导出文件)`);
          }
        }
        if (!Array.isArray(parsed.library) || !Array.isArray(parsed.reading) ||
            !Array.isArray(parsed.bookmarks) || !Array.isArray(parsed.excerpts)) {
          throw new Error("library/reading/bookmarks/excerpts 必须是数组");
        }
        const merged = restoreExportedKeys(
      parsed as unknown as Record<string, unknown>,
      (await this.annotations.load()) as unknown as Record<string, unknown>
    );
    const counts = parsed as { excerpts: unknown[]; bookmarks: unknown[]; library: unknown[] };

        // P0 安全修复: 到这一步为止**什么都还没写**, 是最后一道闸门。
        // 之前的流程是 `save(merged)` 直接整份覆盖 data.json, 然后弹
        // 「数据已导入」—— 没有二次确认, 没有备份, 没有 undo。校验只看
        // 6 个字段名在不在, 所以任何"字段齐全但内容不是 ez-reader 数据"的
        // JSON(另一份同样结构的备份、手改过的导出、从 Git 里挑错的文件)
        // 都会被整份写进去, 而用户全部的书架 / 进度 / 书签 / 摘录就此消失。
        // 弹窗文案还写着"导入", 更像追加而不是替换。
        const ok = await new ConfirmModal(
          this.app,
          "导入数据",
          `将用该文件**整份替换**当前数据:\n\n` +
            `  书 ${counts.library.length} · 摘录 ${counts.excerpts.length} · 书签 ${counts.bookmarks.length}\n\n` +
            `现有的书架 / 阅读进度 / 书签 / 摘录会被覆盖, 无法撤销。\n` +
            `继续前会先把当前数据备份一份到插件目录。`,
          "覆盖导入",
          "取消"
        ).openAndWait();
        if (!ok) {
          new Notice("已取消导入");
          return;
        }

        // 备份。写盘之前先留一份, 万一文件本身有问题还能捞回来。
        await this.backupCurrentData();

        await this.annotations.save(merged as never);
        new Notice(`数据已导入 (${counts.excerpts.length} 摘录, ${counts.bookmarks.length} 书签, ${counts.library.length} 书)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`导入失败: ${message}`);
        console.error("[ez-reader] importData failed", error);
      }
    };
    input.click();
  }

  /**
   * Write the current `data.json` aside before a destructive import.
   *
   * Uses `adapter.writeBinary` on a timestamped path under the plugin's own
   * folder, so it never touches the user's notes and never routes through the
   * AnnotationStore (whose `mutate` is exactly what we are about to disturb).
   * A backup that cannot be written downgrades to a warning rather than
   * blocking the import — the confirm modal already carries the warning.
   */
  private async backupCurrentData(): Promise<void> {
    try {
      const snapshot = await this.annotations.load();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = "ezreader/backups";
      const target = normalizePath(`${dir}/data-${stamp}.json`);
      await this.app.vault.adapter.mkdir(dir);
      await this.app.vault.adapter.writeBinary(
        target,
        new TextEncoder().encode(JSON.stringify(snapshot, null, 2)).buffer as ArrayBuffer
      );
      console.info(`[ez-reader] pre-import backup written to ${target}`);
    } catch (error) {
      console.warn("[ez-reader] pre-import backup failed", error);
      new Notice("⚠️ 备份失败,导入仍会继续");
    }
  }
}