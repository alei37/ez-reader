import { Modal, Notice, setTooltip } from "obsidian";
import type { App } from "obsidian";
import type { BookId } from "../../core/entities/Book";
import type { LibraryEntry, LibraryService, RichLibraryEntry } from "../../core/services/LibraryService";
import { statusLabel } from "./shelfFormatters";
import type { BookInfo } from "../../core/entities/BookInfo";
import type { DailyReadingTime, ReadingSession } from "../../core/entities/ReadingSession";
import type { ReadingStatus } from "../../core/entities/ReadingState";

/**
 * v0.3.0: Book detail modal. Shows everything EzReader knows about one book:
 *
 * - Header (cover + title + authors + primary actions)
 * - Meta (publisher / published / language / ISBN / pages / format / size /
 *   path / added / last opened)
 * - Progress (status / favorite / pinned / progress bar / total reading time)
 * - Time stats (today / 7-day / 30-day totals, streak, 30-day bar chart)
 * - Recent sessions (up to 10 most recent)
 * - Footer (open notes.md / open info.md)
 *
 * Data is sourced from `LibraryService.getRichEntry(bookId)`. Missing fields
 * (info.md never written, sessions.jsonl empty) render as "—" rather than
 * throwing — modal stays usable on partial data.
 */

export interface BookInfoModalDeps {
  readonly app: App;
  readonly library: LibraryService;
  readonly openReader: (entry: LibraryEntry) => Promise<void> | void;
}

/** Placeholder shown for missing optional fields. */
const DASH = "—";

/** YYYY-MM-DD date in local time. */
const formatDate = (ms: number | null | undefined): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return DASH;
  const d = new Date(ms);
  // toISOString gives UTC; we want local so the user recognises the date.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

/** YYYY-MM-DD HH:mm local time. */
const formatDateTime = (ms: number | null | undefined): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return DASH;
  const d = new Date(ms);
  const date = formatDate(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
};

/** Human-friendly byte size (KB/MB/GB). */
const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return DASH;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} ${units[unit]}`;
};

/** Compact reading time: "2h 30m" / "25m" / "—" — different style than the toolbar (which says "X 分钟"). */
const formatReadingShort = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return DASH;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes - hours * 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
};

/** Long-form reading time: "2 小时 30 分钟" / "25 分钟". */
const formatReadingLong = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return DASH;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes - hours * 60;
  if (rem === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rem} 分钟`;
};

/**
 * Sanitize a title for use inside an Obsidian wiki link filename
 * (`[[<safeTitle>-<id>]]`). Matches the library's file-naming policy so the
 * link actually points to the same file the plugin would have written.
 */
const sanitizeWikiTitle = (raw: string): string => {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
};

/** Status chip label + marker for progress section. */
const statusBadge = (status: ReadingStatus): { label: string; cls: string } => {
  switch (status) {
    case "reading":
      return { label: "在读", cls: "is-reading" };
    case "finished":
      return { label: "已读完", cls: "is-finished" };
    case "abandoned":
      return { label: "暂弃", cls: "is-abandoned" };
    default:
      return { label: statusLabel(status), cls: "is-unread" };
  }
};

export class BookInfoModal extends Modal {
  private readonly deps: BookInfoModalDeps;
  private readonly bookId: BookId;
  /** Loading state — `null` while `getRichEntry` is in-flight. */
  private rich: RichLibraryEntry | null = null;
  /** True when getRichEntry returned null (book removed mid-flight). */
  private missing = false;
  /** Active load promise so re-opening the modal re-fetches. */
  private readonly loadPromise: Promise<void>;
  /** Set of copy-feedback timers so onClose can cancel them. */
  private readonly copyTimers = new Set<number>();

  constructor(app: App, bookId: BookId, deps: BookInfoModalDeps) {
    super(app);
    this.deps = deps;
    this.bookId = bookId;
    // Fire the fetch eagerly so the modal has data ready by the time
    // Obsidian paints it. onOpen just renders the snapshot we already have.
    this.loadPromise = this.load();
  }

  private async load(): Promise<void> {
    try {
      const result = await this.deps.library.getRichEntry(this.bookId);
      if (result === null) {
        this.missing = true;
      } else {
        this.rich = result;
      }
      // If the modal already opened before us, re-render now.
      if (this.contentEl.children.length > 0) {
        this.render();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`加载书籍详情失败: ${message}`);
      this.missing = true;
      if (this.contentEl.children.length > 0) this.render();
    }
  }

  onOpen(): void {
    // Match OnboardingModal pattern — add the modal-level class to
    // contentEl so the inner width drives the modal's outer width.
    this.modalEl.addClass("ez-reader__modal");
    this.contentEl.addClass("ez-reader__book-info-modal");
    this.render();
  }

  onClose(): void {
    // Cancel pending "✓ 已复制" timers so we don't mutate a detached DOM.
    for (const id of this.copyTimers) {
      window.clearTimeout(id);
    }
    this.copyTimers.clear();
  }

  /** Top-level render dispatch. */
  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (this.missing) {
      this.renderMissing();
      return;
    }
    if (this.rich === null) {
      this.renderLoading();
      return;
    }
    const rich = this.rich;
    const entry = rich.entry;
    // LibraryService always fills a fallback BookInfo when info.md is
    // missing (see `buildFallbackBookInfo` in LibraryService.ts), so
    // `rich.bookInfo` is never null in practice. The type allows null
    // because the public `readBookInfo` port can fail. Treat null the
    // same way as the missing-book state — bail to the loading view.
    if (rich.bookInfo === null) {
      this.renderLoading();
      return;
    }
    const info = rich.bookInfo;

    // Title attribute on the modal container (used by Obsidian's modal frame
    // for the accessibility tree).
    this.titleEl.setText(info.title);

    // Header — cover + title + authors + primary action row.
    this.renderHeader(contentEl, rich, entry);

    // Meta section — publisher, ISBN, file path, etc.
    this.renderMeta(contentEl, info);

    // Progress section — status, favorite, pinned, progress bar, total reading time.
    this.renderProgress(contentEl, rich, info);

    // Time stats section — today / 7-day / 30-day totals, streak, 30-day bar chart.
    this.renderTimeStats(contentEl, rich);

    // Sessions list — up to 10 most recent.
    this.renderSessions(contentEl, rich);

    // Footer — open notes.md / info.md in Obsidian.
    this.renderFooter(contentEl, info);
  }

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------

  private renderHeader(root: HTMLElement, rich: RichLibraryEntry, entry: LibraryEntry): void {
    const header = root.createDiv({ cls: "ez-reader__book-info-header" });

    // Cover (120×160 area). Falls back to a placeholder div if no cover.
    const coverPath = rich.bookInfo?.coverPath ?? entry.book.coverPath;
    const filePath = rich.bookInfo?.filePath ?? entry.book.locator.path;
    const cover = header.createDiv({ cls: "ez-reader__book-info-header__cover-wrap" });
    if (coverPath) {
      // `coverPath` from BookInfo / Book is already an `app://...` resource URL.
      cover.createEl("img", {
        cls: "ez-reader__book-info-header__cover",
        attr: { src: coverPath, alt: rich.bookInfo?.title ?? "" }
      });
    } else {
      // Vault-relative file path → resolve via adapter so we get an `app://`
      // URL with a fresh session token. Old resource URLs expire when the app
      // restarts.
      try {
        const resourcePath = this.deps.app.vault.adapter.getResourcePath(filePath);
        cover.createEl("img", {
          cls: "ez-reader__book-info-header__cover",
          attr: { src: resourcePath, alt: rich.bookInfo?.title ?? "" }
        });
      } catch {
        // No cover — leave the placeholder empty so the CSS shows bg color.
      }
    }

    const text = header.createDiv({ cls: "ez-reader__book-info-header__text" });
    text.createEl("h2", {
      cls: "ez-reader__book-info-header__title",
      text: rich.bookInfo?.title ?? entry.book.metadata?.title ?? entry.book.locator.path
    });
    const authors = rich.bookInfo?.authors ?? entry.book.metadata?.authors ?? [];
    const authorsLine = authors.length > 0 ? authors.join(" · ") : "作者未知";
    text.createEl("div", {
      cls: "ez-reader__book-info-header__authors",
      text: authorsLine
    });

    // Action row — open reader / open file / copy wiki link.
    const actions = text.createDiv({ cls: "ez-reader__book-info-header__actions" });
    const openBtn = actions.createEl("button", {
      text: "📖 打开",
      attr: { type: "button" }
    });
    openBtn.addClass("ez-reader__book-info-header__action");
    openBtn.onclick = (): void => {
      void this.deps.openReader(entry);
      this.close();
    };

    const viewBtn = actions.createEl("button", {
      text: "📄 查看",
      attr: { type: "button" }
    });
    viewBtn.addClass("ez-reader__book-info-header__action");
    viewBtn.onclick = (): void => {
      void this.deps.app.workspace.openLinkText(filePath, "", true);
      this.close();
    };

    const copyBtn = actions.createEl("button", {
      text: "🔗 复制",
      attr: { type: "button" }
    });
    copyBtn.addClass("ez-reader__book-info-header__action");
    setTooltip(copyBtn, "复制 Obsidian wiki-link");
    copyBtn.onclick = (): void => {
      void this.copyWikiLink(rich, copyBtn);
    };
  }

  /**
   * Build the wiki link the plugin uses for notes / info files and copy it
   * to the clipboard. Falls back to a Notice on copy failure (clipboard API
   * rejects in insecure contexts).
   */
  private async copyWikiLink(rich: RichLibraryEntry, btn: HTMLElement): Promise<void> {
    const title = rich.bookInfo?.title ?? rich.entry.book.metadata?.title ?? rich.entry.book.locator.path;
    const safeTitle = sanitizeWikiTitle(title);
    const idTag = rich.entry.book.id.slice(0, 8);
    const link = `[[${safeTitle}-${idTag}]]`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        throw new Error("clipboard unavailable");
      }
      this.setCopiedFeedback(btn, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`复制失败: ${message}`);
      this.setCopiedFeedback(btn, false);
    }
  }

  /** Briefly show "✓ 已复制" on the copy button, then revert to "🔗 复制". */
  private setCopiedFeedback(btn: HTMLElement, ok: boolean): void {
    btn.addClass("is-copied");
    btn.setText(ok ? "✓ 已复制" : "✗ 失败");
    const id = window.setTimeout(() => {
      this.copyTimers.delete(id);
      btn.removeClass("is-copied");
      btn.setText("🔗 复制");
    }, 1500);
    this.copyTimers.add(id);
  }

  // ---------------------------------------------------------------------------
  // Meta
  // ---------------------------------------------------------------------------

  private renderMeta(root: HTMLElement, info: BookInfo): void {
    const section = root.createDiv({ cls: "ez-reader__book-info-section" });
    section.createEl("h4", {
      cls: "ez-reader__book-info-section__title",
      text: "元信息"
    });

    const dl = section.createEl("dl", { cls: "ez-reader__book-info-meta-grid" });
    this.metaRow(dl, "出版社", info?.publisher);
    this.metaRow(dl, "出版日期", info?.published);
    const lang = info?.language;
    this.metaRow(
      dl,
      "语言",
      lang ? lang : DASH
    );
    this.metaRow(dl, "ISBN", info?.isbn);
    this.metaRow(
      dl,
      "页数",
      typeof info?.pageCount === "number" && info.pageCount > 0 ? String(info.pageCount) : DASH
    );

    // Format / size on one row.
    const format = info?.format ?? "";
    const sizeStr = info ? formatBytes(info.fileSizeBytes) : DASH;
    this.metaRow(dl, "格式 · 大小", `${format.toUpperCase() || DASH} · ${sizeStr}`);

    this.metaRow(dl, "路径", info?.filePath);

    const added = info ? formatDate(info.addedToLibraryAt) : DASH;
    const lastOpened = info ? formatDate(info.lastOpenedAt) : "从未打开";
    this.metaRow(dl, "加入 · 最后打开", `${added} · ${lastOpened}`);
  }

  /** Render one `<dt>label</dt><dd>value</dd>` pair, handling missing values. */
  private metaRow(dl: HTMLElement, label: string, value: string | null | undefined): void {
    dl.createEl("dt", { text: label });
    dl.createEl("dd", { text: value ?? DASH });
  }

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  private renderProgress(root: HTMLElement, rich: RichLibraryEntry, info: BookInfo): void {
    const section = root.createDiv({ cls: "ez-reader__book-info-section" });
    section.createEl("h4", {
      cls: "ez-reader__book-info-section__title",
      text: "阅读进度"
    });

    const status = info?.status ?? rich.entry.reading.status;
    const badge = statusBadge(status);

    // Status row — chip + favorite + pinned.
    const statusRow = section.createDiv({ cls: "ez-reader__book-info-progress__status-row" });
    const chip = statusRow.createSpan({ cls: "ez-reader__book-info-progress__status-chip" });
    chip.addClass(badge.cls);
    chip.setText(`状态: ${badge.label}`);

    if (info?.favorite) {
      statusRow.createSpan({
        cls: "ez-reader__book-info-progress__flag",
        text: "⭐ 收藏"
      });
    }
    if (info?.pinnedAt) {
      statusRow.createSpan({
        cls: "ez-reader__book-info-progress__flag",
        text: "📌 置顶"
      });
    }

    // Progress bar.
    const frac = clampFraction(info?.progressFraction ?? 0);
    const pageCount = info?.pageCount;
    const currentPage =
      pageCount && pageCount > 0 ? Math.round(frac * pageCount) : null;
    const totalPageLabel =
      typeof pageCount === "number" && pageCount > 0 ? String(pageCount) : DASH;

    const barWrap = section.createDiv({ cls: "ez-reader__book-info-progress__bar" });
    const fill = barWrap.createDiv({ cls: "ez-reader__book-info-progress__fill" });
    fill.style.width = `${(frac * 100).toFixed(1)}%`;

    const pct = Math.round(frac * 100);
    const progressLabel =
      currentPage !== null
        ? `${pct}% (${currentPage} / ${totalPageLabel} 页)`
        : `${pct}%`;
    section.createDiv({
      cls: "ez-reader__book-info-progress__label",
      text: progressLabel
    });

    // Total reading time.
    section.createDiv({
      cls: "ez-reader__book-info-progress__total",
      text: `总阅读时长: ${formatReadingLong(info?.totalReadingMs ?? 0)}`
    });
  }

  // ---------------------------------------------------------------------------
  // Time stats
  // ---------------------------------------------------------------------------

  private renderTimeStats(root: HTMLElement, rich: RichLibraryEntry): void {
    const section = root.createDiv({ cls: "ez-reader__book-info-section" });
    section.createEl("h4", {
      cls: "ez-reader__book-info-section__title",
      text: "阅读时长统计"
    });

    // Three stat tiles — today / 7 days / 30 days.
    const tiles = section.createDiv({ cls: "ez-reader__book-info-time-stats" });
    this.statTile(tiles, "今天", formatReadingShort(rich.todayReadingMs));
    this.statTile(tiles, "最近 7 天", formatReadingShort(rich.lastWeekReadingMs));
    this.statTile(tiles, "最近 30 天", formatReadingShort(rich.lastMonthReadingMs));

    // Streak chip — hidden when 0.
    if (rich.readingStreakDays > 0) {
      const streak = section.createSpan({
        cls: "ez-reader__book-info-streak",
        text: `连续 ${rich.readingStreakDays} 天 🔥`
      });
      setTooltip(streak, "连续阅读天数(按 local-time 切日)");
    }

    // Bar chart — 30 buckets (newest-first from API).
    const buckets = rich.dailyReadingTime;
    const maxMs = buckets.reduce((acc, b) => (b.totalMs > acc ? b.totalMs : acc), 0);
    const chart = section.createDiv({ cls: "ez-reader__book-info-bar-chart" });
    // P0 fix: 当 LibraryService 返回 30 个 zero-buckets (sessions 全空但
    // API 还是返回 days=30 条) 时,光检查 `buckets.length === 0` 永远 false,
    // 用户看到的全是灰色 2px bar,没有"暂无阅读记录"占位提示. 改成检查
    // 是否有任何数据 — 任一 bucket.totalMs > 0 才算有活动.
    const hasAnyActivity = buckets.some((b) => b.totalMs > 0 || b.sessionCount > 0);
    if (buckets.length === 0 || !hasAnyActivity) {
      chart.addClass("is-empty");
      chart.createDiv({
        cls: "ez-reader__book-info-bar-chart__placeholder",
        text: "暂无阅读记录 — 在阅读器里读一会儿就会出现在这里"
      });
      // Styles live in styles.css (`.ez-reader__book-info-bar-chart__placeholder`)
      // — Obsidian lint `no-static-styles-assignment` forbids inline style.X = Y.
    } else {
      // We want newest on the RIGHT (chronological left→right). The API
      // returns newest-first, so reverse for display.
      const ordered = [...buckets].reverse();
      const lastIndex = ordered.length - 1;
      for (let i = 0; i < ordered.length; i += 1) {
        const bucket = ordered[i];
        const bar = chart.createDiv({
          cls: "ez-reader__book-info-bar-chart__bar"
        });
        const heightPx = maxMs === 0 ? 2 : Math.max(2, Math.round((bucket.totalMs / maxMs) * 56));
        bar.style.height = `${heightPx}px`;
        // Today = last bucket after reversal.
        if (i === lastIndex) bar.addClass("is-today");
        this.attachBarTooltip(bar, bucket);
      }
    }
  }

  private statTile(parent: HTMLElement, label: string, value: string): void {
    const tile = parent.createDiv({ cls: "ez-reader__book-info-time-stat" });
    tile.createDiv({ cls: "ez-reader__book-info-time-stat__value", text: value });
    tile.createDiv({ cls: "ez-reader__book-info-time-stat__label", text: label });
  }

  /** Wire hover + click tooltips onto a single bucket bar. */
  private attachBarTooltip(bar: HTMLElement, bucket: DailyReadingTime): void {
    const minutes = Math.round(bucket.totalMs / 60_000);
    const summary =
      bucket.totalMs <= 0
        ? `${bucket.date}: 无阅读记录`
        : `${bucket.date}: ${minutes} 分钟 (${bucket.sessionCount} sessions)`;
    setTooltip(bar, summary);
    // Mirror on click so the user can see it without hovering (mobile / quick look).
    bar.setAttribute("aria-label", summary);
  }

  // ---------------------------------------------------------------------------
  // Recent sessions
  // ---------------------------------------------------------------------------

  private renderSessions(root: HTMLElement, rich: RichLibraryEntry): void {
    const section = root.createDiv({ cls: "ez-reader__book-info-section" });
    section.createEl("h4", {
      cls: "ez-reader__book-info-section__title",
      text: "最近 session 明细"
    });

    const list = section.createDiv({ cls: "ez-reader__book-info-sessions" });
    if (rich.recentSessions.length === 0) {
      list.addClass("is-empty");
      list.createDiv({
        cls: "ez-reader__book-info-sessions__placeholder",
        text: "暂无 session 记录 — sessions.jsonl 在第一次关闭阅读器时创建"
      });
      return;
    }
    for (const session of rich.recentSessions) {
      list.append(this.renderSessionRow(session));
    }
  }

  private renderSessionRow(session: ReadingSession): HTMLElement {
    const row = createDiv({ cls: "ez-reader__book-info-session-row" });
    const start = formatDateTime(session.startedAt);
    const end = formatDateTime(session.endedAt);
    const duration = formatReadingShort(session.durationMs);
    const pctStart = Math.round(session.progressStart * 100);
    const pctEnd = Math.round(session.progressEnd * 100);
    row.createSpan({
      cls: "ez-reader__book-info-session-row__time",
      text: `${start} → ${end}`
    });
    row.createSpan({
      cls: "ez-reader__book-info-session-row__duration",
      text: `(${duration}, ${pctStart}%→${pctEnd}%)`
    });
    return row;
  }

  // ---------------------------------------------------------------------------
  // Footer
  // ---------------------------------------------------------------------------

  private renderFooter(root: HTMLElement, info: BookInfo): void {
    const footer = root.createDiv({ cls: "ez-reader__book-info-footer" });

    const basePath = `ezreader/notes/${sanitizeWikiTitle(info.title)}-${info.bookId.slice(0, 8)}.md`;
    const notesBtn = footer.createEl("button", {
      text: "📝 打开 notes.md",
      attr: { type: "button" }
    });
    notesBtn.onclick = (): void => {
      void this.deps.app.workspace.openLinkText(basePath, "", true);
      this.close();
    };

    const infoPath = `ezreader/info/${sanitizeWikiTitle(info.title)}-${info.bookId.slice(0, 8)}.md`;
    const infoBtn = footer.createEl("button", {
      text: "📊 打开 info.md",
      attr: { type: "button" }
    });
    infoBtn.onclick = (): void => {
      void this.deps.app.workspace.openLinkText(infoPath, "", true);
      this.close();
    };
  }

  // ---------------------------------------------------------------------------
  // Loading / missing
  // ---------------------------------------------------------------------------

  private renderLoading(): void {
    const { contentEl } = this;
    contentEl.empty();
    const section = contentEl.createDiv({ cls: "ez-reader__book-info-section" });
    section.createDiv({
      cls: "ez-reader__book-info-loading",
      text: "加载中…"
    });
    this.titleEl.setText("书籍详情");
  }

  private renderMissing(): void {
    const { contentEl } = this;
    contentEl.empty();
    const section = contentEl.createDiv({ cls: "ez-reader__book-info-section" });
    section.createEl("p", {
      text: "找不到这本书 — 可能已被移除或刷新过库。"
    });
    this.titleEl.setText("书籍详情");
  }
}

/** Clamp a fraction to [0, 1]. Mirrors the toolbar's helper. */
const clampFraction = (value: number): number => Math.max(0, Math.min(1, value));