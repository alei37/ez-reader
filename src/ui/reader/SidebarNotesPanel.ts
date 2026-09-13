import type { Excerpt } from "../../core/entities/Excerpt";

export interface SidebarNotesHandlers {
  /** Jump the reader to the position the excerpt was captured at. */
  onJump: (excerpt: Excerpt) => void;
  /** Delete the excerpt from the AnnotationStore. */
  onRemove: (excerpt: Excerpt) => void;
  /** Edit the note attached to an existing excerpt. */
  onEdit: (excerpt: Excerpt) => void;
  /** Add a free-standing thought (not tied to a selection). */
  onAddThought: () => void;
}

/**
 * Side panel of in-reading notes. Each entry shows the excerpt as a
 * quote block, the user's note underneath (if any), and a small action
 * row. Newest entries are prepended so the most recent idea is at the
 * top — typical notebook behaviour.
 *
 * A search field at the top filters by quote / note / tag / chapter
 * substring. Useful when a single book accumulates dozens of entries.
 */
export class SidebarNotesPanel {
  readonly root: HTMLElement;
  private readonly handlers: SidebarNotesHandlers;
  private entries: ReadonlyArray<Excerpt> = [];
  private query: string = "";
  private flashId: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(handlers: SidebarNotesHandlers, host: HTMLElement) {
    this.handlers = handlers;
    this.root = host.createDiv({ cls: "ez-reader__notes-panel" });
    this.render();
  }

  setEntries(entries: ReadonlyArray<Excerpt>): void {
    this.entries = entries;
    this.render();
  }

  show(): void {
    this.root.removeClass("is-hidden");
  }

  hide(): void {
    this.root.addClass("is-hidden");
  }

  toggle(): void {
    this.root.toggleClass("is-hidden", !this.root.hasClass("is-hidden"));
  }

  isVisible(): boolean {
    return !this.root.hasClass("is-hidden");
  }

  /** Briefly highlight a freshly added entry — gives the user feedback. */
  flashLast(excerptId: string): void {
    this.flashId = excerptId;
    this.refreshFlashStyles();
    if (this.flashTimer !== undefined) {
      globalThis.clearTimeout(this.flashTimer);
    }
    this.flashTimer = globalThis.setTimeout(() => {
      this.flashId = null;
      this.refreshFlashStyles();
      this.flashTimer = undefined;
    }, 1800);
  }

  private render(): void {
    this.root.empty();
    const header = this.root.createDiv({ cls: "ez-reader__notes-panel__header" });
    header.createEl("h3", { text: "笔记" });
    const count = header.createEl("span", {
      cls: "ez-reader__notes-panel__count",
      text: `(${this.entries.length})`
    });
    const add = header.createEl("button", {
      text: "+ 想法",
      attr: { type: "button", title: "添加自由想法(不需选中文字)", "aria-label": "添加自由想法" }
    });
    add.addClass("ez-reader__notes-panel__add");
    add.onclick = () => this.handlers.onAddThought();

    if (this.entries.length === 0) {
      this.root.createDiv({
        cls: "ez-reader__notes-panel__empty",
        text: "选中文字后,在弹窗里选择「想法」,笔记会自动出现在这里。"
      });
      return;
    }

    // 搜索框: 超过 5 条笔记才显示,避免噪音
    if (this.entries.length >= 5) {
      const searchWrap = this.root.createDiv({ cls: "ez-reader__notes-panel__search" });
      const search = searchWrap.createEl("input", {
        attr: { type: "search", placeholder: "搜索笔记内容、标签、章节……", "aria-label": "搜索笔记" }
      });
      search.value = this.query;
      search.addEventListener("input", () => {
        this.query = search.value.trim().toLocaleLowerCase();
        this.renderList();
      });
      this.renderList();
    } else {
      this.renderList();
    }
  }

  private renderList(): void {
    // 移除旧的 list 节点
    const oldList = this.root.querySelector(".ez-reader__notes-panel__list");
    if (oldList) oldList.remove();

    const filtered = this.filteredEntries();
    const list = this.root.createDiv({ cls: "ez-reader__notes-panel__list" });
    if (filtered.length === 0) {
      list.createDiv({
        cls: "ez-reader__notes-panel__empty",
        text: `没有匹配的笔记 (${this.query}).`
      });
      return;
    }
    // newest first
    const ordered = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
    for (const entry of ordered) {
      const card = list.createDiv({ cls: "ez-reader__notes-panel__entry" });
      card.setAttribute("data-excerpt-id", entry.id);
      const quote = card.createEl("blockquote", { text: entry.text });
      quote.addClass("ez-reader__notes-panel__quote");
      const meta = card.createDiv({ cls: "ez-reader__notes-panel__meta" });
      const chapter = entry.locator.chapter ? ` · ${entry.locator.chapter}` : "";
      const ts = formatTimestamp(entry.createdAt);
      meta.createEl("span", { text: `${ts}${chapter}`, cls: "ez-reader__notes-panel__meta-text" });
      if (entry.tags.length > 0) {
        meta.createEl("span", {
          text: entry.tags.map((t) => `#${t}`).join(" "),
          cls: "ez-reader__notes-panel__tags"
        });
      }
      if (entry.note) {
        const note = card.createEl("p", { text: entry.note });
        note.addClass("ez-reader__notes-panel__note");
      }
      const actions = card.createDiv({ cls: "ez-reader__notes-panel__actions" });
      const jump = actions.createEl("button", {
        text: "↩",
        attr: { type: "button", title: "跳到原文位置", "aria-label": "跳到原文位置" }
      });
      jump.onclick = () => this.handlers.onJump(entry);
      const edit = actions.createEl("button", {
        text: "✎",
        attr: { type: "button", title: "编辑想法", "aria-label": "编辑想法" }
      });
      edit.onclick = () => this.handlers.onEdit(entry);
      const remove = actions.createEl("button", {
        text: "×",
        attr: { type: "button", title: "删除这条笔记", "aria-label": "删除这条笔记" }
      });
      remove.onclick = () => {
        if (globalThis.confirm("确定删除这条笔记? 原书高亮也会被移除。")) {
          this.handlers.onRemove(entry);
        }
      };
    }
    this.refreshFlashStyles();
  }

  private filteredEntries(): ReadonlyArray<Excerpt> {
    if (!this.query) return this.entries;
    const needle = this.query;
    return this.entries.filter((ex) => {
      const haystack = [
        ex.text,
        ex.note,
        ex.tags.join(" "),
        ex.locator.chapter ?? ""
      ].join("\n").toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }

  private refreshFlashStyles(): void {
    const cards = this.root.querySelectorAll<HTMLElement>(".ez-reader__notes-panel__entry");
    cards.forEach((card) => {
      card.toggleClass("is-flashing", card.getAttribute("data-excerpt-id") === this.flashId);
    });
  }
}

const formatTimestamp = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
