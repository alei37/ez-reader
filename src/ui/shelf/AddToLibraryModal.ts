import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import type { Book } from "../../core/entities/Book";
import type { LibraryEntry, LibraryService } from "../../core/services/LibraryService";
import type { BookBytesLoader } from "../../core/ports/BookReader";
import type { CoverCache } from "../../adapters/obsidian/CoverCache";

export interface AddToLibraryResult {
  readonly added: ReadonlyArray<string>;
  readonly totalScanned: number;
}

/**
 * Modal that lists every book the scanner knows about but the user has not
 * added to their library yet. The user multi-selects and confirms; the
 * underlying file stays where it is in the Vault.
 *
 * Covers are extracted lazily for the candidates the user is currently
 * looking at, so the modal feels alive without spending cycles on books
 * the user will never open.
 */
export class AddToLibraryModal extends Modal {
  private readonly service: LibraryService;
  private readonly covers: CoverCache | undefined;
  private readonly loader: BookBytesLoader | undefined;
  private candidates: LibraryEntry[] = [];
  private readonly selected = new Set<string>();
  private readonly searchInput: HTMLInputElement;
  private unsubscribe: (() => void) | undefined;
  private lastRendered: HTMLElement | undefined;
  private coverFetchInFlight = new Set<string>();

  constructor(app: App, service: LibraryService, options?: { covers?: CoverCache; loader?: BookBytesLoader }) {
    super(app);
    this.service = service;
    this.covers = options?.covers;
    this.loader = options?.loader;
    this.searchInput = document.createElement("input");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "按标题或路径筛选…";
    this.searchInput.addClass("ez-reader__add-modal__search");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__add-modal");
    contentEl.createEl("h2", { text: "加入个人图书馆" });
    contentEl.createEl("p", {
      cls: "ez-reader__add-modal__hint",
      text: "勾选要加入的书。封面会按需提取。加入后,这些书会出现在书架上,原始文件保留在 Vault。"
    });

    this.candidates = [...this.service.list({}, "titleAsc", true)].filter(
      (entry) => entry.book.addedToLibraryAt === null
    );

    // 订阅 library 变更,等封面提取完后即时刷新
    this.unsubscribe = this.service.subscribe(() => {
      if (this.lastRendered) this.renderList(this.lastRendered);
    });

    const header = contentEl.createDiv({ cls: "ez-reader__add-modal__header" });
    header.append(this.searchInput);
    const selectAll = header.createEl("button", { text: "全选", attr: { type: "button" } });
    selectAll.onclick = () => this.toggleAll(true);
    const selectNone = header.createEl("button", { text: "全不选", attr: { type: "button" } });
    selectNone.onclick = () => this.toggleAll(false);
    const addAll = header.createEl("button", { text: "加入全部", attr: { type: "button" } });
    addAll.addClass("mod-cta");
    addAll.onclick = () => void this.confirmAddAll();

    const list = contentEl.createDiv({ cls: "ez-reader__add-modal__list" });
    this.renderList(list);

    this.searchInput.addEventListener("input", () => this.renderList(list));
    // 初始触发可见候选的封面提取
    this.maybeExtractCovers(this.filteredCandidates());

    const summary = contentEl.createDiv({ cls: "ez-reader__add-modal__summary" });
    summary.createEl("span", {
      text: `共 ${this.candidates.length} 本候选 · 已选 ${this.selected.size} 本`,
      cls: "ez-reader__add-modal__summary-text"
    });

    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.onclick = () => this.close();
    const confirm = actions.createEl("button", { text: "加入所选", attr: { type: "button" } });
    confirm.addClass("mod-cta");
    // 锁定所有 action 按钮防双击, confirm handler 完成后解锁.
    const setActionsBusy = (busy: boolean): void => {
      const btns: HTMLButtonElement[] = [confirm, addAll, selectAll, selectNone];
      for (const btn of btns) btn.disabled = busy;
    };
    confirm.onclick = () => void this.confirmSelection(setActionsBusy);
    addAll.onclick = () => void this.confirmAddAll(setActionsBusy);
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    // P1 修复: 之前 coverFetchInFlight 在 modal 关闭后仍可能 self-clean,
    // 但如果有 worker promise 还没 resolve, set 一直占着, 内存中多个 modal
    // 实例化会导致 leak. 显式清空 + 拒绝新启动.
    this.coverFetchInFlight.clear();
  }

  private filteredCandidates(): LibraryEntry[] {
    const query = this.searchInput.value.trim().toLocaleLowerCase();
    return this.candidates.filter((entry) => {
      if (!query) return true;
      const haystack = `${entry.book.metadata?.title ?? ""} ${entry.book.locator.path}`.toLocaleLowerCase();
      return haystack.includes(query);
    });
  }

  private renderList(host: HTMLElement): void {
    this.lastRendered = host;
    host.empty();
    const filtered = this.filteredCandidates();
    const summaryEl = this.contentEl.querySelector(".ez-reader__add-modal__summary-text");
    if (summaryEl) summaryEl.textContent = `共 ${this.candidates.length} 本候选 · 已选 ${this.selected.size} 本`;

    if (filtered.length === 0) {
      host.createDiv({ cls: "ez-reader__add-modal__empty", text: "没有可加入的书(可能已经全部加入,或 Vault 里没有支持的格式)。" });
      return;
    }

    for (const entry of filtered) {
      const row = host.createDiv({ cls: "ez-reader__add-modal__row" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selected.has(entry.book.id);
      checkbox.onchange = () => {
        if (checkbox.checked) this.selected.add(entry.book.id);
        else this.selected.delete(entry.book.id);
        if (summaryEl) summaryEl.textContent = `共 ${this.candidates.length} 本候选 · 已选 ${this.selected.size} 本`;
      };
      // 封面缩略图(占位 / 已提取 / 提取中)
      const cover = row.createDiv({ cls: "ez-reader__add-modal__row__cover" });
      const coverPath = entry.book.coverPath;
      if (coverPath) {
        cover.addClass("has-image");
        cover.createEl("img", { attr: { src: coverPath, alt: entry.book.metadata?.title ?? "" } });
      } else {
        cover.addClass("is-placeholder");
        const title = entry.book.metadata?.title ?? entry.book.locator.path;
        cover.createEl("span", { text: title.charAt(0).toLocaleUpperCase(), cls: "ez-reader__add-modal__row__glyph" });
      }
      const info = row.createDiv({ cls: "ez-reader__add-modal__row__info" });
      info.createEl("span", {
        text: entry.book.metadata?.title ?? entry.book.locator.path,
        cls: "ez-reader__add-modal__row__title"
      });
      const pathRow = info.createDiv({ cls: "ez-reader__add-modal__row__path-row" });
      pathRow.createEl("span", { text: entry.book.locator.path, cls: "ez-reader__add-modal__row__path" });
      row.createEl("span", { text: entry.book.locator.format.toUpperCase(), cls: "ez-reader__add-modal__row__format" });
    }

    this.maybeExtractCovers(filtered);
  }

  /**
   * Trigger cover extraction for books the user is currently looking at.
   * Concurrency capped at 3 and a single book is only fetched once per
   * modal open even if the user filters back and forth.
   */
  private maybeExtractCovers(books: ReadonlyArray<LibraryEntry>): void {
    if (!this.covers || !this.loader) return;
    const queue = books
      .map((b) => b.book)
      .filter((b) => !b.coverPath && !this.coverFetchInFlight.has(b.id))
      .slice(0, 12);
    if (queue.length === 0) return;
    let index = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const book = queue[index++];
        if (!book) break;
        this.coverFetchInFlight.add(book.id);
        try {
          await this.covers!.ensureCoverFor(book, this.loader!);
        } catch {
          // ignore; 提取失败也无所谓
        } finally {
          this.coverFetchInFlight.delete(book.id);
        }
      }
    });
    void Promise.all(workers);
  }

  private toggleAll(value: boolean): void {
    const filtered = this.filteredCandidates();
    for (const entry of filtered) {
      if (value) this.selected.add(entry.book.id);
      else this.selected.delete(entry.book.id);
    }
    const list = this.contentEl.querySelector<HTMLElement>(".ez-reader__add-modal__list");
    if (list) this.renderList(list);
  }

  private async confirmSelection(setActionsBusy: (busy: boolean) => void = () => {}): Promise<void> {
    const ids = [...this.selected];
    if (ids.length === 0) {
      this.close();
      return;
    }
    setActionsBusy(true);
    // P0 修复: 用 finally + withTimeout 兜底, 之前 setActionsBusy(false) 只在
    // catch 路径调用. 如果 extractCover 因 reader bug 永不 resolve (例如损坏的
    // EPUB 让 foliate.getCover() 卡死), confirmSelection 永远不 close, 按钮
    // 永远 disabled — 用户唯一的选择是关闭整个 Obsidian 重启.
    let timedOut = false;
    const timeoutMs = 30_000;
    const timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      console.error(`[ez-reader] confirmSelection timed out after ${timeoutMs}ms — closing modal forcibly`);
    }, timeoutMs);
    try {
      // 并行 addToLibrary: ObsidianAnnotationStore.writeChain 内部串行化
      // write,但读 + 准备可以并行 — N 本书的 IO 不再 N 倍耗时.
      await this.raceWithTimeout(
        Promise.all(ids.map((id) => this.service.addToLibrary(id))),
        timeoutMs,
        "confirmSelection.addToLibrary"
      );
      if (timedOut) throw new Error("addToLibrary 超时");
      const books = ids
        .map((id) => this.service.get(id)?.book)
        .filter((b): b is Book => Boolean(b));
      await this.raceWithTimeout(this.extractCoversFor(books), timeoutMs, "confirmSelection.extractCoversFor");
      if (timedOut) throw new Error("extractCoversFor 超时");
    } catch (error) {
      console.error("[ez-reader] confirmSelection failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`加入失败: ${message}`);
      setActionsBusy(false);
      return;
    } finally {
      globalThis.clearTimeout(timeoutHandle);
      // 即使 timeout 触发或 throw, 也要解锁按钮 + 关 modal — 不让 UI 卡死.
      setActionsBusy(false);
      // 二次防御: 在 finally 里强制 close, 避免任何漏掉的 return 路径让 modal 留着.
      // close() 是 idempotent (Obsidian 内部已经处理), 重复调用安全.
      if (timedOut) this.close();
    }
    this.close();
  }

  private async confirmAddAll(setActionsBusy: (busy: boolean) => void = () => {}): Promise<void> {
    setActionsBusy(true);
    let timedOut = false;
    const timeoutMs = 60_000;
    const timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      console.error(`[ez-reader] confirmAddAll timed out after ${timeoutMs}ms — closing modal forcibly`);
    }, timeoutMs);
    try {
      const before = new Set(this.service.list({}, "titleAsc", true).map((entry) => entry.book.id));
      await this.raceWithTimeout(this.service.addAllToLibrary(), timeoutMs, "confirmAddAll.addAllToLibrary");
      if (timedOut) throw new Error("addAllToLibrary 超时");
      const newlyAdded = this.service
        .list({}, "titleAsc", true)
        .filter((entry) => !before.has(entry.book.id))
        .map((entry) => entry.book);
      await this.raceWithTimeout(this.extractCoversFor(newlyAdded), timeoutMs, "confirmAddAll.extractCoversFor");
      if (timedOut) throw new Error("extractCoversFor 超时");
    } catch (error) {
      console.error("[ez-reader] confirmAddAll failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`全部加入失败: ${message}`);
      setActionsBusy(false);
      return;
    } finally {
      globalThis.clearTimeout(timeoutHandle);
      setActionsBusy(false);
      if (timedOut) this.close();
    }
    this.close();
  }

  /**
   * Race a promise against a deadline. 跟 Plugin.withTimeout 一样的语义, 但
   * 用在这里避免 modal 调用 Plugin 的私有方法. Promise 自身不 reject (超时
   * 不会被外部 catch 看到), 只让外层的 `timedOut` flag 翻起来走关闭路径.
   */
  private raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      let resolved = false;
      const timer = globalThis.setTimeout(() => {
        if (resolved) return;
        console.warn(`[ez-reader] ${label} exceeded ${ms}ms — leaving promise pending`);
        resolve(undefined);
      }, ms);
      promise.then(
        (value) => {
          if (resolved) return;
          resolved = true;
          globalThis.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (resolved) return;
          resolved = true;
          globalThis.clearTimeout(timer);
          // 把 reject 翻成 resolve(undefined) — 让调用方根据 timedOut flag
          // 决定是否重 throw 或直接走关闭路径, 避免 race-with-resolve 的反模式.
          console.warn(`[ez-reader] ${label} rejected`, error);
          resolve(undefined);
        }
      );
    });
  }

  private async extractCoversFor(books: ReadonlyArray<Book>): Promise<void> {
    if (!this.covers || !this.loader || books.length === 0) return;
    await this.covers.ensureCoversBatch(books, this.loader);
  }
}
