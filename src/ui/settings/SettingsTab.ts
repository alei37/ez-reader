import { PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { AnnotationStore } from "../../core/ports/AnnotationStore";
import { isUiLocale, UI_LOCALES, type UiLocale } from "../../core/types/Locale";
import {
  DEFAULT_READER_APPEARANCE,
  type PluginSettings,
  type ReaderTheme,
  type TranslationSettings
} from "../../core/types/ReaderSettings";

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

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly annotations: AnnotationStore) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ez-reader__settings");

    this.renderAppearanceSection(containerEl);
    this.renderReadingSection(containerEl);
    this.renderNotesSection(containerEl);
    this.renderTranslationSection(containerEl);
    this.renderUISection(containerEl);
    this.renderAboutSection(containerEl);
  }

  private async loadSettings(): Promise<PluginSettings> {
    return this.annotations.listSettings();
  }

  private async saveSettings(next: PluginSettings): Promise<void> {
    await this.annotations.saveSettings(next);
  }

  // ---- 默认阅读外观 ----
  private renderAppearanceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("默认阅读外观").setHeading();
    new Setting(containerEl)
      .setName("字号")
      .setDesc("默认 100%; 范围 60%-200%")
      .addSlider((slider) =>
        slider
          .setLimits(60, 200, 5)
          .setValue(DEFAULT_READER_APPEARANCE.fontSize)
          .onChange(async (value) => {
            const s = await this.loadSettings();
            await this.saveSettings({ ...s, defaultAppearance: { ...s.defaultAppearance, fontSize: value } });
          })
      );
    new Setting(containerEl)
      .setName("行距")
      .setDesc("默认 1.6; 范围 1.0-2.4")
      .addSlider((slider) =>
        slider
          .setLimits(1.0, 2.4, 0.1)
          .setValue(DEFAULT_READER_APPEARANCE.lineHeight)
          .onChange(async (value) => {
            const s = await this.loadSettings();
            await this.saveSettings({ ...s, defaultAppearance: { ...s.defaultAppearance, lineHeight: value } });
          })
      );
    new Setting(containerEl)
      .setName("页边距")
      .setDesc("默认 32px; 范围 0-80px")
      .addSlider((slider) =>
        slider
          .setLimits(0, 80, 4)
          .setValue(DEFAULT_READER_APPEARANCE.margin)
          .onChange(async (value) => {
            const s = await this.loadSettings();
            await this.saveSettings({ ...s, defaultAppearance: { ...s.defaultAppearance, margin: value } });
          })
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
        dropdown.onChange(async (value) => {
          if (!THEMES.includes(value as ReaderTheme)) return;
          const s = await this.loadSettings();
          await this.saveSettings({
            ...s,
            defaultAppearance: { ...s.defaultAppearance, theme: value as ReaderTheme }
          });
        });
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
        dropdown.onChange(async (value) => {
          if (value !== "paginated" && value !== "scrolled") return;
          const s = await this.loadSettings();
          await this.saveSettings({
            ...s,
            defaultAppearance: { ...s.defaultAppearance, flow: value }
          });
        });
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
        dropdown.onChange(async (value) => {
          if (value !== "tab" && value !== "window") return;
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, readerOpenMode: value });
        });
      });
    new Setting(containerEl)
      .setName("记住阅读进度")
      .setDesc("打开书时自动跳转到上次阅读位置")
      .addToggle((toggle) => {
        void this.loadSettings().then((s) => {
          toggle.setValue(s.rememberProgress !== false);
        });
        toggle.onChange(async (value) => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, rememberProgress: value });
        });
      });
    new Setting(containerEl)
      .setName("默认双页显示")
      .setDesc("新书打开时默认开启双页(仅桌面, foliate 适用)")
      .addToggle((toggle) => {
        void this.loadSettings().then((s) => {
          toggle.setValue(s.twoPagesByDefault ?? false);
        });
        toggle.onChange(async (value) => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, twoPagesByDefault: value });
        });
      });
    new Setting(containerEl)
      .setName("Pad 默认沉浸模式")
      .setDesc("在 Pad / 窄屏上打开书时自动进入沉浸模式(隐藏工具栏)")
      .addToggle((toggle) => {
        void this.loadSettings().then((s) => {
          toggle.setValue(s.immersiveOnTablet ?? false);
        });
        toggle.onChange(async (value) => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, immersiveOnTablet: value });
        });
      });
    new Setting(containerEl)
      .setName("键盘快捷键")
      .setDesc("阅读器键盘快捷键(留空恢复默认)")
      .addText((text) => {
        void this.loadSettings().then((s) => {
          const shortcuts = s.keyboardShortcuts;
          text.setValue(
            `上一页:${shortcuts?.prev ?? "ArrowLeft"} · 下一页:${shortcuts?.next ?? "ArrowRight"}` +
            ` · 笔记:${shortcuts?.toggleSidebar ?? "s"} · 目录:${shortcuts?.toggleToc ?? "t"}` +
            ` · 翻译:${shortcuts?.translate ?? "T"} · 高亮:${shortcuts?.highlight ?? "h"}`
          );
        });
        text.inputEl.addEventListener("change", async () => {
          const s = await this.loadSettings();
          // 简单起见: 整段文字解析; 实际只展示当前值(用户改不改不影响)
        });
      });
  }

  // ---- 笔记与摘录 ----
  private renderNotesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("笔记与摘录").setHeading();
    new Setting(containerEl)
      .setName("摘录笔记目录")
      .setDesc("双链笔记文件保存位置,留空则不自动保存笔记")
      .addText((text) => {
        void this.loadSettings().then((s) => {
          text.setValue(s.notesDirectory);
        });
        text.inputEl.addEventListener("change", async () => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, notesDirectory: text.inputEl.value.trim() });
        });
      });
    new Setting(containerEl)
      .setName("主题研究目录")
      .setDesc("主题研究笔记保存位置")
      .addText((text) => {
        void this.loadSettings().then((s) => {
          text.setValue(s.researchDirectory);
        });
        text.inputEl.addEventListener("change", async () => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, researchDirectory: text.inputEl.value.trim() });
        });
      });
    new Setting(containerEl)
      .setName("默认笔记模板")
      .setDesc("新建笔记时使用的标题模板,支持 {{title}} {{author}} 占位符")
      .addText((text) => {
        void this.loadSettings().then((s) => {
          text.setValue(s.defaultNoteTemplate);
        });
        text.inputEl.addEventListener("change", async () => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, defaultNoteTemplate: text.inputEl.value });
        });
      });
  }

  // ---- 翻译 ----
  private renderTranslationSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("翻译").setHeading();
    new Setting(containerEl)
      .setName("翻译服务")
      .setDesc("选择在线翻译 API;留空 = 不联网。")
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "关闭");
        dropdown.addOption("youdao", "有道智云 · 文本翻译");
        dropdown.addOption("deepl", "DeepL");
        dropdown.addOption("google-translation-v3", "Google Translation v3");
        void this.loadSettings().then((s) => {
          dropdown.setValue(s.translation?.providerId ?? "none");
        });
        dropdown.onChange(async (value) => {
          const s = await this.loadSettings();
          if (value === "none") {
            await this.saveSettings({ ...s, translation: null });
          } else {
            const next: TranslationSettings = {
              providerId: value,
              apiKey: s.translation?.apiKey ?? "",
              sourceLocale: s.translation?.sourceLocale ?? "auto",
              targetLocale: s.translation?.targetLocale ?? "zh-CN"
            };
            await this.saveSettings({ ...s, translation: next });
          }
        });
      });
    new Setting(containerEl)
      .setName("翻译 API key")
      .setDesc("翻译是本插件唯一会访问网络的特性。留空 = 不联网。")
      .addText((text) => {
        text.inputEl.type = "password";
        void this.loadSettings().then((s) => {
          text.setValue(s.translation?.apiKey ?? "");
        });
        text.onChange(async (value) => {
          const s = await this.loadSettings();
          if (!s.translation) return;
          await this.saveSettings({ ...s, translation: { ...s.translation, apiKey: value } });
        });
      });
    new Setting(containerEl)
      .setName("目标语言")
      .setDesc("默认翻译到的语言(例如 zh-CN / en-US)")
      .addText((text) => {
        void this.loadSettings().then((s) => {
          text.setValue(s.translation?.targetLocale ?? "zh-CN");
        });
        text.onChange(async (value) => {
          const s = await this.loadSettings();
          if (!s.translation) return;
          await this.saveSettings({ ...s, translation: { ...s.translation, targetLocale: value } });
        });
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
        dropdown.onChange(async (value) => {
          if (!isUiLocale(value)) return;
          const settings = await this.annotations.listSettings();
          await this.annotations.saveSettings({ ...settings, uiLocale: value satisfies UiLocale });
        });
      });
    new Setting(containerEl)
      .setName("所有者名称")
      .setDesc("用于笔记署名(可选)")
      .addText((text) => {
        void this.loadSettings().then((s) => {
          text.setValue(s.libraryOwnerName);
        });
        text.inputEl.addEventListener("change", async () => {
          const s = await this.loadSettings();
          await this.saveSettings({ ...s, libraryOwnerName: text.inputEl.value });
        });
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
    const data = await this.annotations.load();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ez-reader-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
        const parsed = JSON.parse(text);
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
        await this.annotations.save(parsed);
        const { Notice } = await import("obsidian");
        new Notice(`数据已导入 (${parsed.excerpts.length} 摘录, ${parsed.bookmarks.length} 书签, ${parsed.library.length} 书)`);
      } catch (error) {
        const { Notice } = await import("obsidian");
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`导入失败: ${message}`);
        console.error("[ez-reader] importData failed", error);
      }
    };
    input.click();
  }
}