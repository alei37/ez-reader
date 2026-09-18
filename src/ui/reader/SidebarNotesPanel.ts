import type { App } from "obsidian";
import type { Excerpt } from "../../core/entities/Excerpt";
import { ConfirmModal } from "./ConfirmModal";

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
  private readonly app: App | undefined;
  private entries: ReadonlyArray<Excerpt> = [];
  private query: string = "";
  /** Tag filter — single tag, used to scope the list. Cleared on close. */
  private tagFilter: string | null = null;
  private flashId: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  /** Debounce timer for the search box. */
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchInput: HTMLInputElement | undefined;
  /** Set of excerpt ids whose note region is currently expanded. */
  private expandedNotes = new Set<string>();

  constructor(handlers: SidebarNotesHandlers & { app?: App }, host: HTMLElement) {
    this.handlers = handlers;
    this.app = handlers.app;
    this.root = host.createDiv({ cls: "ez-reader__notes-panel" });
    this.render();
  }

  /**
   * Tear down listeners + timers. The host should call this when the
   * reader view is closed; previously `flashTimer` could fire after
   * detach and write to a dead DOM.
   */
  dispose(): void {
    if (this.flashTimer !== undefined) {
      globalThis.clearTimeout(this.flashTimer);
      this.flashTimer = undefined;
    }
    if (this.searchTimer !== undefined) {
      globalThis.clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
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

    // P1: 标签 filter active 时显示 chip — 用户能直观看到当前过滤.
    if (this.tagFilter) {
      const chip = this.root.createDiv({ cls: "ez-reader__notes-panel__tag-filter-chip" });
      chip.createSpan({ text: `标签过滤: #${this.tagFilter}` });
      const clearBtn = chip.createEl("button", {
        text: "×",
        attr: { type: "button", title: "清除过滤", "aria-label": "清除过滤" }
      });
      clearBtn.addClass("ez-reader__notes-panel__tag-filter-clear");
      clearBtn.addEventListener("click", () => {
        this.tagFilter = null;
        this.render();
      });
    }

    // 搜索框: 超过 5 条笔记才显示,避免噪音
    if (this.entries.length >= 5) {
      const searchWrap = this.root.createDiv({ cls: "ez-reader__notes-panel__search" });
      const search = searchWrap.createEl("input", {
        attr: { type: "search", placeholder: "搜索笔记内容、标签、章节……", "aria-label": "搜索笔记" }
      });
      this.searchInput = search;
      search.value = this.query;
      // 150ms debounce — 用户连击输入不会每按一字符全量重建笔记列表.
      search.addEventListener("input", () => {
        if (this.searchTimer !== undefined) {
          globalThis.clearTimeout(this.searchTimer);
        }
        this.searchTimer = globalThis.setTimeout(() => {
          this.searchTimer = undefined;
          this.query = search.value.trim().toLocaleLowerCase();
          this.renderList();
        }, 150);
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
        const tagWrap = meta.createSpan({ cls: "ez-reader__notes-panel__tags" });
        for (const tag of entry.tags) {
          const tagBtn = tagWrap.createEl("button", {
            text: `#${tag}`,
            attr: { type: "button", title: `只看标签 ${tag}`, "aria-label": `过滤标签 ${tag}` }
          });
          tagBtn.addClass("ez-reader__notes-panel__tag-btn");
          tagBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 切换: 当前 active 就清空, 否则切到新标签
            this.tagFilter = this.tagFilter === tag ? null : tag;
            this.render();
          });
        }
      }
      if (entry.note) {
        const isExpanded = this.expandedNotes.has(entry.id);
        const toggle = card.createDiv({ cls: "ez-reader__notes-panel__note-toggle" });
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        const previewText = entry.note.length > 60 ? `${entry.note.slice(0, 60)}…` : entry.note;
        const label = isExpanded ? "收起想法" : `💭 想法 · ${previewText}`;
        toggle.createSpan({ text: label, cls: "ez-reader__notes-panel__note-toggle-label" });
        toggle.createSpan({ text: isExpanded ? "▾" : "▸", cls: "ez-reader__notes-panel__note-toggle-arrow" });
        const note = card.createEl("p", { text: entry.note });
        note.addClass("ez-reader__notes-panel__note");
        if (isExpanded) {
          toggle.addClass("is-expanded");
          note.addClass("is-expanded");
        } else {
          note.addClass("is-collapsed");
        }
        const flip = () => {
          if (this.expandedNotes.has(entry.id)) {
            this.expandedNotes.delete(entry.id);
            toggle.classList.remove("is-expanded");
            note.classList.remove("is-expanded");
            note.classList.add("is-collapsed");
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-label")!.textContent = `💭 想法 · ${previewText}`;
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-arrow")!.textContent = "▸";
          } else {
            this.expandedNotes.add(entry.id);
            toggle.classList.add("is-expanded");
            note.classList.remove("is-collapsed");
            note.classList.add("is-expanded");
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-label")!.textContent = "收起想法";
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-arrow")!.textContent = "▾";
          }
        };
        toggle.addEventListener("click", flip);
        toggle.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            flip();
          }
        });
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
      remove.onclick = async () => {
        // P1 修复: 之前用 globalThis.confirm, 在 Obsidian 移动端 WebView
        // 表现不一致. 改用 Obsidian Modal, 通过 SidebarNotesPanel 的
        // handlers.app 注入 (ReaderView 已经持有 app).
        if (!this.app) {
          this.handlers.onRemove(entry);
          return;
        }
        const ok = await new ConfirmModal(
          this.app,
          "删除这条笔记?",
          "原文高亮也会被移除。读书进度、书签、其它笔记不受影响。",
          "删除"
        ).openAndWait();
        if (ok) this.handlers.onRemove(entry);
      };
    }
    this.refreshFlashStyles();
  }

  private filteredEntries(): ReadonlyArray<Excerpt> {
    let result = this.entries;
    if (this.tagFilter) {
      result = result.filter((ex) => ex.tags.includes(this.tagFilter!));
    }
    if (!this.query) return result;
    const needle = this.query;
    return result.filter((ex) => {
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
