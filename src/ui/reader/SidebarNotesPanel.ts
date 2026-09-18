import type { App } from "obsidian";
import type { Excerpt } from "../../core/entities/Excerpt";
import { ConfirmModal } from "./ConfirmModal";

export interface SidebarNotesHandlers {
  /** Jump the reader to the position the excerpt was captured at. */
  onJump: (excerpt: Excerpt) => void;
  /** Delete the excerpt from the AnnotationStore. */
  onRemove: (excerpt: Excerpt) => void;
  /** Edit the note attached to an existing excerpt — opens the legacy modal flow. */
  onEdit: (excerpt: Excerpt) => void;
  /**
   * P2: inline note patch — 用户在 panel 里直接点 note 文字 → 出现 contenteditable
   * → blur 或 Cmd+Enter 保存 → 调这个, 只 patch note 字段. 不传 → 退回只读模式.
   */
  onUpdateNote?: (excerpt: Excerpt, note: string) => Promise<void>;
  /** Add a free-standing thought (not tied to a selection). */
  onAddThought: () => void;
  /** P1: Close button on panel header. Optional — desktop-wide layout
   *  always shows the notes panel, in which case there's no header ×. */
  onClose?: () => void;
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
  /** P2: type filter — "all" / "thought" / "excerpt". 跟 tab 一对一. */
  private typeFilter: "all" | "thought" | "excerpt" = "all";
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
    const titleRow = header.createDiv({ cls: "ez-reader__notes-panel__title-row" });
    titleRow.createEl("h3", { text: "笔记" });
    const count = titleRow.createEl("span", {
      cls: "ez-reader__notes-panel__count",
      text: `(${this.entries.length})`
    });
    // P1 修复: 之前 SidebarNotesPanel header 没有 × 按钮 (其他 panel
    // 都有). 用户反映"点击笔记侧栏右边出现, 没法退出" — 实际 Esc 和
    // toolbar 按钮都能关, 但用户找 × 按钮找不到. 现在 header 加 ×,
    // 跟 BookmarksPanel / ExcerptsPanel / TocPanel 行为一致.
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "×",
        attr: { type: "button", title: "关闭笔记 (Esc)", "aria-label": "关闭笔记" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
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

    // P2: 顶部 tabs (全部 / 想法 / 摘录) — 一眼区分两种 annotation.
    // thought = openFreeThoughtModal 创建的 (text 为空), excerpt = 选词保存的.
    // 任何数量都显示 tabs — 方便快速过滤, 不依赖数量阈值.
    const tabsBar = this.root.createDiv({ cls: "ez-reader__notes-panel__tabs" });
    const counts = {
      all: this.entries.length,
      thought: this.entries.filter((e) => !e.text?.trim()).length,
      excerpt: this.entries.filter((e) => !!e.text?.trim()).length
    };
    const makeTab = (
      key: "all" | "thought" | "excerpt",
      label: string
    ): HTMLButtonElement => {
      const btn = tabsBar.createEl("button", {
        text: label,
        attr: { type: "button", "aria-label": `只看 ${label}` }
      });
      btn.addClass("ez-reader__notes-panel__tab");
      if (this.typeFilter === key) btn.addClass("is-active");
      btn.createSpan({
        text: String(counts[key]),
        cls: "ez-reader__notes-panel__tab-count"
      });
      btn.addEventListener("click", () => {
        this.typeFilter = key;
        this.render();
      });
      return btn;
    };
    makeTab("all", "全部");
    makeTab("thought", "想法");
    makeTab("excerpt", "摘录");

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
      // P2: note 渲染 = collapsible preview + click-to-edit inline. 流程:
      //   1. 默认收起 (只显示 previewText + ▸)
      //   2. 点 ▸ / 文字 → 展开为 contenteditable, 自动 focus + select
      //   3. blur 或 Cmd/Ctrl+Enter → 调 handlers.onUpdateNote 保存
      //   4. Esc → 取消 (恢复原 note 文字)
      // 没有 onUpdateNote handler 时回退到只读 (跟之前一样, 不破坏现有测试).
      if (entry.note) {
        const isExpanded = this.expandedNotes.has(entry.id);
        const previewText = entry.note.length > 60 ? `${entry.note.slice(0, 60)}…` : entry.note;
        const toggle = card.createDiv({
          cls: `ez-reader__notes-panel__note-toggle${isExpanded ? " is-expanded" : ""}`
        });
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        toggle.createSpan({
          text: isExpanded ? "收起想法" : `💭 想法 · ${previewText}`,
          cls: "ez-reader__notes-panel__note-toggle-label"
        });
        toggle.createSpan({
          text: isExpanded ? "▾" : "▸",
          cls: "ez-reader__notes-panel__note-toggle-arrow"
        });
        const note = card.createEl("p", { text: entry.note });
        note.addClass("ez-reader__notes-panel__note");
        if (isExpanded) {
          note.addClass("is-expanded");
        } else {
          note.addClass("is-collapsed");
        }
        // inline edit — P2: contenteditable, blur 自动保存
        const beginEdit = (): void => {
          if (!this.handlers.onUpdateNote) return;
          // 用我们自己的 sentinel 标志, 不用 note.isContentEditable —
          // jsdom 不一定正确反映 contentEditable 属性 (bug: 静态属性
          // 不可观察, 设值后 isContentEditable 仍返回 false). 自己的
          // 标志可靠.
          if (note.getAttribute("data-editing") === "1") return;
          const original = entry.note ?? "";
          note.contentEditable = "true";
          note.setAttribute("data-editing", "1");
          note.addClass("is-editing");
          note.focus();
          // select 全文 — 跟 BookmarkModal 同样的 UX
          const sel = globalThis.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(note);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          const finish = async (commit: boolean): Promise<void> => {
            if (note.getAttribute("data-editing") !== "1") return;
            note.contentEditable = "false";
            note.removeAttribute("data-editing");
            note.removeClass("is-editing");
            const newText = note.textContent ?? "";
            if (commit && newText !== original) {
              try {
                const fn = this.handlers.onUpdateNote;
                if (fn) await fn(entry, newText);
              } catch (error) {
                // 失败回滚 — 不要让 DOM 跟 store 不一致
                note.textContent = original;
                console.warn("[ez-reader] inline note save failed", error);
              }
            } else {
              // 取消 / 没改动 — 还原文字
              note.textContent = original;
            }
          };
          const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              void finish(false);
            } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void finish(true);
            }
          };
          const onBlur = (): void => {
            void finish(true);
          };
          note.addEventListener("keydown", onKeyDown);
          note.addEventListener("blur", onBlur, { once: true });
        };
        const flip = (): void => {
          if (this.expandedNotes.has(entry.id)) {
            // P2: 收起前如果还在 edit 态, 先 finish (commit=true) — 等同于
            // blur 行为. 否则用户的改动会随元素 class 变化丢失.
            if (note.getAttribute("data-editing") === "1") {
              note.contentEditable = "false";
              note.removeAttribute("data-editing");
              note.removeClass("is-editing");
              const newText = note.textContent ?? "";
              const original = entry.note ?? "";
              if (newText !== original) {
                this.handlers.onUpdateNote?.(entry, newText)?.catch((error) => {
                  note.textContent = original;
                  console.warn("[ez-reader] inline note save failed", error);
                });
              }
            }
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
            // P2: 展开时自动进 inline edit — 用户点 ▸ 就是想改, 不用再点一次文字
            beginEdit();
          }
        };
        toggle.addEventListener("click", flip);
        toggle.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            flip();
          }
        });
        // P2: 直接点 note 文字也能开始编辑 (即使未展开)
        note.addEventListener("click", (event) => {
          if (!note.classList.contains("is-collapsed")) {
            // 已展开, 才允许 click → edit (避免跟 toggle 冲突)
            if (note.getAttribute("data-editing") !== "1") {
              event.stopPropagation();
              beginEdit();
            }
          } else {
            // 收起态: 点击展开 + 编辑
            event.stopPropagation();
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
    // P2: type filter (all / thought / excerpt) — 跟 tabs 一对一
    if (this.typeFilter !== "all") {
      const isThought = (ex: Excerpt): boolean => !ex.text?.trim();
      if (this.typeFilter === "thought") {
        result = result.filter(isThought);
      } else {
        result = result.filter((ex) => !isThought(ex));
      }
    }
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
