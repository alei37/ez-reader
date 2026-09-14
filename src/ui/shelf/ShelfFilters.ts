import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { ShelfFilter, ProgressBucket, RecencyBucket } from "../../core/types/ShelfFilter";
import type { ReadingStatus } from "../../core/entities/ReadingState";

const STATUS_LABELS: Record<ReadingStatus, string> = {
  unread: "未开始",
  reading: "在读",
  finished: "已读完",
  abandoned: "暂弃"
};

const PROGRESS_LABELS: Record<ProgressBucket, string> = {
  untouched: "未读",
  early: "0-33%",
  middle: "33-66%",
  late: "66-95%",
  finished: "已读完"
};

const RECENCY_LABELS: Record<RecencyBucket, string> = {
  today: "今天",
  thisWeek: "本周",
  thisMonth: "本月",
  older: "更早",
  never: "从未"
};

const FORMAT_LABELS: Record<"epub" | "pdf" | "mobi" | "txt", string> = {
  epub: "EPUB",
  pdf: "PDF",
  mobi: "MOBI",
  txt: "TXT"
};

const COMMON_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de"] as const;

export class ShelfFiltersModal extends Modal {
  private result: ShelfFilter;
  private resolver: ((filter: ShelfFilter | null) => void) | null = null;

  constructor(app: App, initial: ShelfFilter) {
    super(app);
    this.result = clone(initial);
  }

  openAndGetResult(): Promise<ShelfFilter | null> {
    return new Promise<ShelfFilter | null>((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private settle(filter: ShelfFilter | null): void {
    const r = this.resolver;
    this.resolver = null;
    r?.(filter);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "筛选" });
    this.renderStatusSection(contentEl);
    this.renderFormatSection(contentEl);
    this.renderLanguageSection(contentEl);
    this.renderProgressSection(contentEl);
    this.renderRecencySection(contentEl);
    this.renderActions(contentEl);
  }

  onClose(): void {
    // Esc / overlay click 视为取消 — 防止 openAndGetResult 永久 pending
    if (this.resolver) this.settle(null);
  }

  private toggleSetValue<T>(current: ReadonlyArray<T> | undefined, value: T): T[] | undefined {
    const arr = current ? [...current] : [];
    const next = arr.includes(value)
      ? arr.filter((x) => x !== value)
      : [...arr, value];
    return next.length > 0 ? next : undefined;
  }

  private renderStatusSection(host: HTMLElement): void {
    host.createEl("h3", { text: "阅读状态" });
    const wrap = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const status of Object.keys(STATUS_LABELS) as ReadonlyArray<ReadingStatus>) {
      const button = wrap.createEl("button", { text: STATUS_LABELS[status], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.statuses?.includes(status) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.statuses, status);
        this.result = { ...this.result, statuses: next };
        button.toggleClass("is-active", next?.includes(status) ?? false);
      });
    }
  }

  private renderFormatSection(host: HTMLElement): void {
    host.createEl("h3", { text: "文件格式" });
    const wrap = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const format of Object.keys(FORMAT_LABELS) as Array<keyof typeof FORMAT_LABELS>) {
      const button = wrap.createEl("button", {
        text: FORMAT_LABELS[format],
        attr: { type: "button" }
      });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.formats?.includes(format) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.formats, format);
        this.result = { ...this.result, formats: next };
        button.toggleClass("is-active", next?.includes(format) ?? false);
      });
    }
  }

  private renderLanguageSection(host: HTMLElement): void {
    host.createEl("h3", { text: "语言" });
    const wrap = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const lang of COMMON_LANGUAGES) {
      const button = wrap.createEl("button", { text: lang, attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.languages?.includes(lang) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.languages, lang);
        this.result = { ...this.result, languages: next };
        button.toggleClass("is-active", next?.includes(lang) ?? false);
      });
    }
  }

  private renderProgressSection(host: HTMLElement): void {
    host.createEl("h3", { text: "进度范围" });
    const wrap = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const bucket of Object.keys(PROGRESS_LABELS) as ReadonlyArray<ProgressBucket>) {
      const button = wrap.createEl("button", { text: PROGRESS_LABELS[bucket], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.progressBuckets?.includes(bucket) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.progressBuckets, bucket);
        this.result = { ...this.result, progressBuckets: next };
        button.toggleClass("is-active", next?.includes(bucket) ?? false);
      });
    }
  }

  private renderRecencySection(host: HTMLElement): void {
    host.createEl("h3", { text: "最近打开时间" });
    const wrap = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const bucket of Object.keys(RECENCY_LABELS) as ReadonlyArray<RecencyBucket>) {
      const button = wrap.createEl("button", { text: RECENCY_LABELS[bucket], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.recency === bucket);
      button.addEventListener("click", () => {
        this.result = { ...this.result, recency: this.result.recency === bucket ? undefined : bucket };
        Array.from(wrap.children).forEach((child) => child.toggleClass("is-active", false));
        button.toggleClass("is-active", true);
      });
    }
  }

  private renderActions(host: HTMLElement): void {
    const row = host.createDiv({ cls: "ez-reader__shelf-filters__actions" });
    const clear = row.createEl("button", { text: "清除全部", attr: { type: "button" } });
    clear.onclick = () => {
      this.result = {};
      this.close();
    };
    const apply = row.createEl("button", { text: "应用", attr: { type: "button" } });
    apply.addClass("mod-cta");
    apply.onclick = () => {
      this.settle(clone(this.result));
      this.close();
    };
  }
}

const clone = (filter: ShelfFilter): ShelfFilter => ({
  statuses: filter.statuses ? [...filter.statuses] : undefined,
  languages: filter.languages ? [...filter.languages] : undefined,
  formats: filter.formats ? [...filter.formats] : undefined,
  progressBuckets: filter.progressBuckets ? [...filter.progressBuckets] : undefined,
  recency: filter.recency,
  query: filter.query
});
