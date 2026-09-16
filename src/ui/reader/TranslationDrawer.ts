import type { TranslationService } from "../../core/ports/TranslationProvider";
import type { Locale } from "../../core/types/Locale";

export interface TranslationDrawerHandlers {
  onSaveAsNote: (text: string, translation: string) => void;
}

/**
 * Side drawer that shows a translation in-place while the user keeps
 * reading. We avoid the modal pattern (which steals focus) — the drawer
 * docks to the right of the reader and can be dismissed / re-opened
 * without losing the user's reading position.
 */
export class TranslationDrawer {
  readonly root: HTMLElement;
  private readonly handlers: TranslationDrawerHandlers;
  private readonly service: TranslationService | undefined;
  private currentSource = "auto";
  private currentTarget: Locale = "zh-CN";
  private abortController: AbortController | null = null;
  /**
   * Generation token used to drop stale results. `service.translate()` is
   * a regular promise (we don't actually cancel the network request —
   * AbortController on fetch is not wired through here), so a new
   * translate() call wouldn't otherwise prevent the old one from
   * resolving and clobbering the new loading state.
   */
  private translateGeneration = 0;

  constructor(
    handlers: TranslationDrawerHandlers,
    service: TranslationService | undefined,
    host: HTMLElement,
    initial: { source: Locale; target: Locale }
  ) {
    this.handlers = handlers;
    this.service = service;
    this.currentSource = initial.source;
    this.currentTarget = initial.target;
    this.root = host.createDiv({ cls: "ez-reader__translation-drawer is-hidden" });
    this.renderShell();
  }

  setLanguages(source: Locale, target: Locale): void {
    this.currentSource = source;
    this.currentTarget = target;
  }

  show(): void {
    this.root.removeClass("is-hidden");
  }

  hide(): void {
    this.root.addClass("is-hidden");
    this.abortController?.abort();
    this.abortController = null;
  }

  toggle(): void {
    this.root.toggleClass("is-hidden", !this.root.hasClass("is-hidden"));
  }

  isVisible(): boolean {
    return !this.root.hasClass("is-hidden");
  }

  /** Translate a piece of text and render the result. */
  async translate(text: string): Promise<void> {
    // Generation token — every call increments, the await chain only
    // commits results for the latest generation. Old in-flight translate()
    // calls (started before this one) silently drop their result.
    const generation = ++this.translateGeneration;
    this.show();
    this.renderLoading(text);
    this.abortController?.abort();
    this.abortController = new AbortController();
    if (!this.service) {
      this.renderError(text, "翻译服务未配置。请在插件设置里添加 API key。");
      return;
    }
    try {
      const result = await this.service.translate(text, this.currentSource, this.currentTarget);
      if (generation !== this.translateGeneration) return; // stale result
      this.renderResult(text, result.text, result.detectedSource, result.providerId);
    } catch (error) {
      if (generation !== this.translateGeneration) return; // stale error
      const message = error instanceof Error ? error.message : String(error);
      this.renderError(text, message);
    }
  }

  private renderShell(): void {
    this.root.empty();
    const header = this.root.createDiv({ cls: "ez-reader__translation-drawer__header" });
    header.createEl("h3", { text: "翻译" });
    const close = header.createEl("button", { text: "×", attr: { type: "button", title: "关闭翻译面板" } });
    close.addClass("ez-reader__translation-drawer__close");
    close.onclick = () => this.hide();
    this.root.createDiv({ cls: "ez-reader__translation-drawer__body" });
  }

  private renderLoading(sourceText: string): void {
    const body = this.root.querySelector<HTMLElement>(".ez-reader__translation-drawer__body");
    if (!body) return;
    body.empty();
    body.createEl("blockquote", { text: sourceText });
    const loading = body.createDiv({ cls: "ez-reader__translation-drawer__loading" });
    loading.setText("正在翻译…");
  }

  private renderResult(sourceText: string, translated: string, detected: string | null, providerId: string): void {
    const body = this.root.querySelector<HTMLElement>(".ez-reader__translation-drawer__body");
    if (!body) return;
    body.empty();
    body.createEl("blockquote", { text: sourceText });
    body.createDiv({ cls: "ez-reader__translation-drawer__translation", text: translated });
    const meta = body.createDiv({ cls: "ez-reader__translation-drawer__meta" });
    meta.createEl("span", {
      text: `${detected ? `检测到 ${detected}` : ""} · ${providerId} · → ${this.currentTarget}`,
      cls: "ez-reader__translation-drawer__provider"
    });
    const actionsRow = body.createDiv({ cls: "ez-reader__translation-drawer__actions" });
    const saveBtn = actionsRow.createEl("button", {
      text: "保存为笔记",
      attr: { type: "button", title: "把翻译连同原文一起存到笔记" }
    });
    saveBtn.onclick = () => this.handlers.onSaveAsNote(sourceText, translated);
    const retryBtn = actionsRow.createEl("button", {
      text: "换语言重译",
      attr: { type: "button", title: "切换目标语言后重新翻译" }
    });
    retryBtn.onclick = () => this.cycleTargetAndTranslate(sourceText);
  }

  private async cycleTargetAndTranslate(text: string): Promise<void> {
    const cycle: Locale[] = ["zh-CN", "en", "ja", "ko", "fr", "de"];
    const currentIdx = cycle.indexOf(this.currentTarget);
    const next = cycle[(currentIdx + 1) % cycle.length] ?? "zh-CN";
    this.currentTarget = next;
    await this.translate(text);
  }

  private renderError(sourceText: string, message: string): void {
    const body = this.root.querySelector<HTMLElement>(".ez-reader__translation-drawer__body");
    if (!body) return;
    body.empty();
    body.createEl("blockquote", { text: sourceText });
    const err = body.createDiv({ cls: "ez-reader__translation-drawer__error" });
    err.setText(message);
  }
}
