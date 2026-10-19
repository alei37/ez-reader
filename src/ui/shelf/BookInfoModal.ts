import { Modal, Notice, setTooltip } from "obsidian";
import type { App } from "obsidian";
import type { BookId } from "../../core/entities/Book";
import type { LibraryEntry, LibraryService, RichLibraryEntry } from "../../core/services/LibraryService";
import { statusLabel } from "./shelfFormatters";
import type { BookInfo } from "../../core/entities/BookInfo";
import type { DailyReadingTime, ReadingSession } from "../../core/entities/ReadingSession";
import type { ReadingStatus } from "../../core/entities/ReadingState";
import { bookIdTag, sanitizeFileBase } from "../../adapters/obsidian/ObsidianLibraryWriter";

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
 * Per-book filename, derived from the *same* helpers `ObsidianLibraryWriter`
 * uses to create the file.
 *
 * This used to be a local `sanitizeWikiTitle` plus `bookId.slice(0, 8)`.
 * The sanitizer was character-for-character identical to the writer's, but
 * the id half was not: the writer tags files with `bookIdTag(bookId)` (SHA-1
 * hex, 10 chars) since 0.3.x, while the modal kept slicing the raw bookId to
 * 8. Two unrelated schemes, so 📝 / 📊 / 🔗 all pointed at files that never
 * existed — and since bookId IS the vault path, `slice(0,8)` could even
 * contain a `/`, producing a nested path like `ezreader/notes/标题-books/fo.md`.
 *
 * Delegating both halves keeps the two in lockstep by construction.
 */
const bookFileStem = (title: string, bookId: string): string =>
  `${sanitizeFileBase(title)}-${bookIdTag(bookId)}`;

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

/**
 * 单个 per-book 文件的读取探测结果。
 *
 * 为什么需要它: `LibraryService.getRichEntry` 内部对 readBookInfo /
 * loadReadingSessions 都 `catch {}` 吞掉异常, 失败时返回一个**全空的快照**。
 * 于是 vault IO 真挂了(权限、同步冲突把文件搞坏)时, UI 拿到的形状跟
 * "用户从来没打开过这本书"**完全一样**。这等于告诉用户"你的阅读记录没了",
 * 而真相是"我们没读到"—— 掩盖数据丢失, 是最恶劣的一类 bug。
 *
 * LibraryService 在我的写入范围之外, 所以不改它, 而是在 modal 层自己
 * 再探一次磁盘。代价是多一次 exists + read(两个小文件, 只在打开弹窗时发生);
 * 换来的是"没读过"和"没读到"在 UI 上彻底分开。
 *
 * 四态:
 *  - `ok`      文件在, 读到了内容(或已在上游成功解析出数据)
 *  - `absent`  文件不在 / 是空文件 —— 这是**正常的没读过**
 *  - `error`   IO 失败, 或者"磁盘上有内容但上游没解析出来" —— 必须在 UI 上报警
 *  - `unknown` 这套探测跑不了(老 adapter / 没装 LibraryWriter) —— 保持沉默,
 *              不假装自己知道
 */
interface FileProbe {
  readonly state: "ok" | "absent" | "error" | "unknown";
  /** 探测用的 vault 相对路径, 出错时展示给用户方便排查。 */
  readonly path: string;
  /** state === "error" 时的可读原因。 */
  readonly message?: string;
}

/** Minimal shape of the vault adapter bits we touch. */
interface ProbeAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Readable label for the per-book file, shown in the warning banner. */
const PROBE_LABELS = {
  sessions: "阅读记录 (sessions)",
  info: "书籍信息 (info)"
} as const;

type ProbeKind = keyof typeof PROBE_LABELS;

export class BookInfoModal extends Modal {
  private readonly deps: BookInfoModalDeps;
  private readonly bookId: BookId;
  /** Loading state — `null` while `getRichEntry` is in-flight. */
  private rich: RichLibraryEntry | null = null;
  /** True when getRichEntry returned null (book removed mid-flight). */
  private missing = false;
  /**
   * Bug 3 修复: getRichEntry **reject**(加载失败) 的错误信息。
   *
   * 之前它和 `missing` 共用一个标记(失败时置 missing = true), 结果 vault
   * IO 挂掉时用户看到的是"找不到这本书 — 可能已被移除或刷新过库" ——
   * 把"插件没读到"说成"你的书没了", 用户第一反应是去 vault 里找文件,
   * 甚至以为自己误删了。两条路径必须分开: `missing` 只表示 getRichEntry
   * 正常返回了 null(书真的不在库里), `loadError` 才表示读取过程炸了。
   */
  private loadError: string | null = null;
  /** 磁盘探测结果 — 见 FileProbe 注释。null = 还没探测 / 探测不可用。 */
  private readonly probes = new Map<ProbeKind, FileProbe>();
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
        this.missing = false;
        this.loadError = null;
        // 拿到快照后再探磁盘 —— 顺序不能反: 探测结论要跟这份快照比对
        // ("磁盘有内容但快照是空的" 才是上游吞异常的证据)。
        await this.probeBookFiles(result);
      }
      // If the modal already opened before us, re-render now.
      if (this.contentEl.children.length > 0) {
        this.render();
      }
    } catch (error) {
      const message = describeError(error);
      new Notice(`加载书籍详情失败: ${message}`);
      // 注意: 这里**不**置 missing —— 见 loadError 字段注释。
      this.loadError = message;
      this.missing = false;
      if (this.contentEl.children.length > 0) this.render();
    }
  }

  /**
   * 自己再读一次 ezreader/ 下的 per-book 文件, 把 IO 状态和 LibraryService
   * 返回的快照对照, 从而区分"没读过"和"没读到"。
   */
  private async probeBookFiles(rich: RichLibraryEntry): Promise<void> {
    const title =
      rich.bookInfo?.title ?? rich.entry.book.metadata?.title ?? rich.entry.book.locator.path;
    const stem = bookFileStem(title, this.bookId);

    // sessions 额外传 hasUsableData: 磁盘上有内容但 recentSessions 是空数组,
    // 只能解释成上游 loadReadingSessions 抛了异常被 catch {} 吞掉 —— 判为 error。
    //
    // info 传 null: LibraryService 在 info.md 缺失时会用 buildFallbackBookInfo
    // 合成一份**看起来完全正常**的 BookInfo, 所以"快照非空"在这里不构成证据,
    // 只能靠探测本身有没有抛错。合成 vs 真实的区分需要 LibraryService 暴露
    // 更多字段, 已在上报里标注为需要改 core 的遗留项。
    const [sessions, info] = await Promise.all([
      this.probeBookFile(`ezreader/sessions/${stem}.jsonl`, {
        hasUsableData: rich.recentSessions.length > 0
      }),
      this.probeBookFile(`ezreader/info/${stem}.md`, { hasUsableData: null })
    ]);
    this.probes.set("sessions", sessions);
    this.probes.set("info", info);
  }

  /**
   * 探测单个文件。**绝不抛出** —— 探测本身失败就是它要报告的信息之一,
   * 任何意外都收敛成 state:"error" / "unknown", 不能让弹窗整个打不开。
   *
   * @param hasUsableData 上游是否真的解析出了数据。sessions 传布尔值:
   *   "磁盘有内容但 false" 只能解释成上游吞了异常, 判为 error。
   *   info 传 null: LibraryService 会用 fallback 合成一份看起来正常的
   *   BookInfo, 快照本身不构成证据(见 probeBookFiles 注释)。
   */
  private async probeBookFile(
    path: string,
    opts: { readonly hasUsableData: boolean | null }
  ): Promise<FileProbe> {
    const adapter = this.readProbeAdapter();
    // adapter 没有 exists/read → 探测不可用。保持 unknown(沉默), 绝不
    // 把"我探测不了"渲染成"读取失败"(那是在制造假警报) 或"没读过"。
    if (adapter === null) return { state: "unknown", path };
    try {
      const exists = await adapter.exists(path);
      if (!exists) return { state: "absent", path };
    } catch (error) {
      return { state: "error", path, message: describeError(error) };
    }
    try {
      const raw = await adapter.read(path);
      // 空白文件等价于没写过 —— 归到 absent(正常的"没读过")。
      if (raw.trim().length === 0) return { state: "absent", path };
      if (opts.hasUsableData === false) {
        return { state: "error", path, message: "文件里有内容, 但详情页没解析出来" };
      }
      return { state: "ok", path };
    } catch (error) {
      return { state: "error", path, message: describeError(error) };
    }
  }

  /** Grab the adapter, or null when it can't support the probe. */
  private readProbeAdapter(): ProbeAdapter | null {
    const adapter = this.deps.app?.vault?.adapter as unknown as Partial<ProbeAdapter> | undefined;
    if (!adapter) return null;
    if (typeof adapter.exists !== "function" || typeof adapter.read !== "function") return null;
    return adapter as ProbeAdapter;
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
    // Bug 3: 加载失败优先于"书被删了"。顺序有讲究: 失败时 rich 必然还是
    // null, 如果先判 rich === null 就会把加载失败渲染成"加载中…"——
    // 一个永远转不完的进度条, 比报错更让人困惑。
    if (this.loadError !== null) {
      this.renderLoadError();
      return;
    }
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

    // Bug 2: 磁盘探测发现的 IO 失败 —— 放在最上面, 用户不用往下翻就能看到
    // "下面这些数字可能不全", 而不是自己脑补为什么时长是 0。
    this.renderDataWarnings(contentEl);

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

  /**
   * Bug 2: 把"没读到"的文件集中告警一次。
   *
   * 为什么要有这层而不是各自在段落里提示: sessions 和 info 的失败会同时
   * 影响"阅读时长统计"和"最近 session 明细"两块, 用户看到的是两个都空,
   * 分不清是一个原因还是两个。集中一条横幅说清楚"哪些文件没读到", 比让
   * 用户自己拼图可靠。
   */
  private renderDataWarnings(root: HTMLElement): void {
    const failed: Array<{ readonly kind: ProbeKind; readonly probe: FileProbe }> = [];
    for (const kind of ["sessions", "info"] as const) {
      const probe = this.probes.get(kind);
      if (probe && probe.state === "error") failed.push({ kind, probe });
    }
    if (failed.length === 0) return;

    const alert = root.createDiv({ cls: "ez-reader__book-info-alert is-error" });
    alert.setAttribute("role", "alert");
    alert.createEl("p", {
      cls: "ez-reader__book-info-alert__title",
      // "读取失败" 四字跟 renderSessions 里的行内警告、renderLoadError 里的
      // 标题保持一致 —— 同一个概念在弹窗里只该有一种说法, 否则用户会以为是
      // 两个不同的问题。
      text: "⚠ 读取失败 — 有数据没能读出来, 下面的统计可能不完整。"
    });
    for (const { kind, probe } of failed) {
      alert.createEl("p", {
        cls: "ez-reader__book-info-alert__detail",
        text: `${PROBE_LABELS[kind]}: ${probe.message ?? "读取失败"} — ${probe.path}`
      });
    }
    // 刻意强调"不是你的错也不是数据没了": 用户看到空的时长统计第一反应
    // 是"我是不是白读了", 进而可能去删文件/重置库, 那才是真的制造损失。
    alert.createEl("p", {
      cls: "ez-reader__book-info-alert__hint",
      text:
        "这通常不是数据被删了 —— 更可能是 vault 同步冲突把文件搞坏、文件被其他程序占用, " +
        "或读写权限异常。建议检查 vault 里的 ezreader/ 目录, 确认这些文件完整, " +
        "关掉其他正在同步的客户端之后再打开一次。"
    });
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
    const link = `[[${bookFileStem(title, rich.entry.book.id)}]]`;
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
      // Bug 2: 同样的三态问题在这一处最误导人 —— 30 根 2px 的灰条配上
      // "暂无阅读记录", 视觉上就是"这人一次都没读过"。读失败时必须换文案。
      const sessionsFailed = this.probes.get("sessions")?.state === "error";
      chart.createDiv({
        cls: sessionsFailed
          ? "ez-reader__book-info-bar-chart__placeholder is-error"
          : "ez-reader__book-info-bar-chart__placeholder",
        text: sessionsFailed
          ? "⚠ 阅读记录没读出来 — 这张图可能不完整, 不代表你没有读过。"
          : "暂无阅读记录 — 在阅读器里读一会儿就会出现在这里"
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
      // Bug 2: 三态里的关键分叉。空数组有两种来源, 必须分开说:
      //   ① 磁盘上本来就没有记录(用户真没读过) —— 正常空态
      //   ② 磁盘上有但我们没读出来(IO 挂了)     —— 红色警告
      // 旧代码对两者一视同仁, 等于把"没读到"谎报成"你没读过"。
      const sessionsProbe = this.probes.get("sessions");
      if (sessionsProbe && sessionsProbe.state === "error") {
        list.addClass("is-error");
        list.createDiv({
          cls: "ez-reader__book-info-sessions__error",
          text:
            `⚠ 读取失败 — 没能读出这本书的阅读记录(${sessionsProbe.message ?? "未知原因"})。` +
            "你的记录很可能还在, 只是这次没读到; 请检查 vault 同步或 ezreader/sessions/ 目录后重新打开。"
        });
        return;
      }
      list.addClass("is-empty");
      list.createDiv({
        cls: "ez-reader__book-info-sessions__placeholder",
        text: "暂无 session 记录 — 读一会儿再关掉阅读器, 这里就会记下这次阅读。"
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

    const basePath = `ezreader/notes/${bookFileStem(info.title, info.bookId)}.md`;
    const notesBtn = footer.createEl("button", {
      text: "📝 打开 notes.md",
      attr: { type: "button" }
    });
    notesBtn.onclick = (): void => {
      void this.deps.app.workspace.openLinkText(basePath, "", true);
      this.close();
    };

    const infoPath = `ezreader/info/${bookFileStem(info.title, info.bookId)}.md`;
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

  /**
   * Bug 3: `getRichEntry` reject 的独立展示。
   *
   * 复用 renderMissing 的文案是这次 bug 的根源: 加载失败 ≠ 书被删。
   * 弹窗是从书架右键菜单打开的, 用户刚点完, 书十有八九还在库里 ——
   * 报"找不到这本书"会让用户跑去 vault 里翻文件, 甚至以为是自己误删的。
   *
   * 这里给重试按钮是因为加载失败往往是瞬时的(同步冲突 / 文件被占用),
   * 关掉重开要重新走一遍右键菜单, 成本比点一下高。
   */
  private renderLoadError(): void {
    const { contentEl } = this;
    contentEl.empty();
    const section = contentEl.createDiv({ cls: "ez-reader__book-info-section" });
    const alert = section.createDiv({ cls: "ez-reader__book-info-alert is-error" });
    alert.setAttribute("role", "alert");
    alert.createEl("p", {
      cls: "ez-reader__book-info-alert__title",
      text: "读取这本书的详情失败 — 你的书还在书架上, 是插件没能读出数据。"
    });
    alert.createEl("p", {
      cls: "ez-reader__book-info-alert__detail",
      text: `错误: ${this.loadError ?? "未知原因"}`
    });
    // 明确排除"用户自己的问题", 避免无谓的自责 + 乱动文件。
    alert.createEl("p", {
      cls: "ez-reader__book-info-alert__hint",
      text:
        "这通常不是你的操作问题 — 更可能是 vault 同步冲突、文件被其他程序占用, 或读写权限异常。" +
        "建议先点重试; 如果反复失败, 检查 vault 里的 ezreader/ 目录是否完整, " +
        "以及是否有多个同步客户端在同时写这个 vault。"
    });
    const retry = alert.createEl("button", { text: "重试", attr: { type: "button" } });
    retry.addClass("mod-cta");
    retry.onclick = (): void => {
      // 复位到 in-flight 态再拉一次。rich / probes 必须显式清掉:
      // load() 的成功路径只在 `contentEl.children.length > 0` 时才重渲染,
      // 而这里 contentEl 此刻非空, 所以复位是为了让 renderLoading() 拿到
      // 一个干净的快照 — 万一这次 load 又炸了, 用户看到的仍然是新的错误,
      // 而不是上一次的残留数据。
      this.loadError = null;
      this.missing = false;
      this.rich = null;
      this.probes.clear();
      this.renderLoading();
      void this.load();
    };
    this.titleEl.setText("书籍详情");
  }
}

/** Clamp a fraction to [0, 1]. Mirrors the toolbar's helper. */
const clampFraction = (value: number): number => Math.max(0, Math.min(1, value));