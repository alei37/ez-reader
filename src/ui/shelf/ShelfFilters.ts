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

export class ShelfFiltersModal extends Modal {
  private result: ShelfFilter;

  constructor(app: App, initial: ShelfFilter) {
    super(app);
    this.result = clone(initial);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "筛选" });
    this.renderStatusSection(contentEl);
    this.renderProgressSection(contentEl);
    this.renderRecencySection(contentEl);
    this.renderActions(contentEl);
  }

  openAndGetResult(): Promise<ShelfFilter> {
    return new Promise<ShelfFilter>((resolve) => {
      const originalClose = this.close.bind(this);
      this.close = () => {
        originalClose();
        resolve(this.result);
      };
      this.open();
    });
  }

  private renderStatusSection(host: HTMLElement): void {
    host.createEl("h3", { text: "阅读状态" });
    const wrap = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const status of Object.keys(STATUS_LABELS) as ReadonlyArray<ReadingStatus>) {
      const button = wrap.createEl("button", { text: STATUS_LABELS[status], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.statuses?.includes(status) ?? false);
      button.addEventListener("click", () => {
        const current = this.result.statuses ?? [];
        const next = current.includes(status)
          ? current.filter((value) => value !== status)
          : [...current, status];
        this.result = { ...this.result, statuses: next.length > 0 ? next : undefined };
        button.toggleClass("is-active", !current.includes(status));
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
        const current = this.result.progressBuckets ?? [];
        const next = current.includes(bucket)
          ? current.filter((value) => value !== bucket)
          : [...current, bucket];
        this.result = { ...this.result, progressBuckets: next.length > 0 ? next : undefined };
        button.toggleClass("is-active", !current.includes(bucket));
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
    apply.onclick = () => this.close();
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