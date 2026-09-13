import { Modal } from "obsidian";
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
 */
export class AddToLibraryModal extends Modal {
  private readonly service: LibraryService;
  private readonly covers: CoverCache | undefined;
  private readonly loader: BookBytesLoader | undefined;
  private candidates: LibraryEntry[] = [];
  private readonly selected = new Set<string>();
  private readonly searchInput: HTMLInputElement;

  constructor(app: App, service: LibraryService, options?: { covers?: CoverCache; loader?: BookBytesLoader }) {
    super(app);
    this.service = service;
    this.covers = options?.covers;
    this.loader = options?.loader;
    this.searchInput = document.createElement("input");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "按路径筛选…";
    this.searchInput.addClass("ez-reader__add-modal__search");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__add-modal");
    contentEl.createEl("h2", { text: "加入个人图书馆" });
    contentEl.createEl("p", {
      cls: "ez-reader__add-modal__hint",
      text: "勾选要加入的书。加入后,这些书会出现在书架上,原始文件保留在 Vault。"
    });

    this.candidates = [...this.service.list({}, "titleAsc", true)].filter(
      (entry) => entry.book.addedToLibraryAt === null
    );

    const header = contentEl.createDiv({ cls: "ez-reader__add-modal__header" });
    header.append(this.searchInput);
    const selectAll = header.createEl("button", { text: "全选", attr: { type: "button" } });
    selectAll.onclick = () => this.toggleAll(true);
    const selectNone = header.createEl("button", { text: "全不选", attr: { type: "button" } });
    selectNone.onclick = () => this.toggleAll(false);
    const addAll = header.createEl("button", { text: "加入全部", attr: { type: "button" } });
    addAll.addClass("mod-cta");
    addAll.onclick = () => this.confirmAddAll();

    const list = contentEl.createDiv({ cls: "ez-reader__add-modal__list" });
    this.renderList(list);

    this.searchInput.addEventListener("input", () => this.renderList(list));

    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.onclick = () => this.close();
    const confirm = actions.createEl("button", { text: "加入所选", attr: { type: "button" } });
    confirm.addClass("mod-cta");
    confirm.onclick = () => void this.confirmSelection();
  }

  private renderList(host: HTMLElement): void {
    host.empty();
    const query = this.searchInput.value.trim().toLocaleLowerCase();
    const filtered = this.candidates.filter((entry) => {
      if (!query) return true;
      const haystack = `${entry.book.metadata?.title ?? ""} ${entry.book.locator.path}`.toLocaleLowerCase();
      return haystack.includes(query);
    });

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
      };
      const info = row.createDiv({ cls: "ez-reader__add-modal__row__info" });
      info.createEl("span", {
        text: entry.book.metadata?.title ?? entry.book.locator.path,
        cls: "ez-reader__add-modal__row__title"
      });
      info.createEl("span", {
        text: entry.book.locator.path,
        cls: "ez-reader__add-modal__row__path"
      });
      row.createEl("span", { text: entry.book.locator.format.toUpperCase(), cls: "ez-reader__add-modal__row__format" });
    }
  }

  private toggleAll(value: boolean): void {
    const query = this.searchInput.value.trim().toLocaleLowerCase();
    const filtered = this.candidates.filter((entry) => {
      if (!query) return true;
      const haystack = `${entry.book.metadata?.title ?? ""} ${entry.book.locator.path}`.toLocaleLowerCase();
      return haystack.includes(query);
    });
    for (const entry of filtered) {
      if (value) this.selected.add(entry.book.id);
      else this.selected.delete(entry.book.id);
    }
    const list = this.contentEl.querySelector<HTMLElement>(".ez-reader__add-modal__list");
    if (list) this.renderList(list);
  }

  private async confirmSelection(): Promise<void> {
    const ids = [...this.selected];
    for (const id of ids) {
      await this.service.addToLibrary(id);
    }
    const books = ids
      .map((id) => this.service.get(id)?.book)
      .filter((b): b is Book => Boolean(b));
    await this.extractCoversFor(books);
    this.close();
  }

  private async confirmAddAll(): Promise<void> {
    const before = new Set(this.service.list({}, "titleAsc", true).map((entry) => entry.book.id));
    await this.service.addAllToLibrary();
    const newlyAdded = this.service
      .list({}, "titleAsc", true)
      .filter((entry) => !before.has(entry.book.id))
      .map((entry) => entry.book);
    await this.extractCoversFor(newlyAdded);
    this.close();
  }

  private async extractCoversFor(books: ReadonlyArray<Book>): Promise<void> {
    if (!this.covers || !this.loader || books.length === 0) return;
    await this.covers.ensureCoversBatch(books, this.loader);
  }
}