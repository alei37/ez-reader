import { PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { AnnotationStore } from "../../core/ports/AnnotationStore";
import { isUiLocale, UI_LOCALES, type UiLocale } from "../../core/types/Locale";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly annotations: AnnotationStore) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
      .setName("翻译")
      .setHeading();
    new Setting(containerEl)
      .setName("翻译 API key")
      .setDesc("翻译是本插件唯一会访问网络的特性。留空 = 不联网。")
      .addText((text) => {
        void this.annotations.listSettings().then((settings) => {
          text.setValue(settings.translation?.apiKey ?? "");
        });
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          const settings = await this.annotations.listSettings();
          const next = value
            ? {
                providerId: settings.translation?.providerId ?? "google-translation-v3",
                apiKey: value,
                sourceLocale: settings.translation?.sourceLocale ?? "auto",
                targetLocale: settings.translation?.targetLocale ?? "en"
              }
            : null;
          await this.annotations.saveSettings({ ...settings, translation: next });
        });
      });
  }
}