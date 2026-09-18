import { test } from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import type { Bookmark } from "../../src/core/entities/Bookmark";
import type { Excerpt } from "../../src/core/entities/Excerpt";
import { BookmarksPanel } from "../../src/ui/reader/BookmarksPanel";
import { ExcerptsPanel } from "../../src/ui/reader/ExcerptsPanel";
import { SidebarNotesPanel } from "../../src/ui/reader/SidebarNotesPanel";
import { installObsidianDomHelpers } from "../stubs/obsidian-stub.mjs";

// Copy jsdom DOM globals onto globalThis so the panel constructors can
// use document / HTMLElement / etc.
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const DOM_GLOBALS = [
  "document", "window", "Node", "NodeFilter", "DocumentFragment",
  "Range", "HTMLElement", "HTMLStyleElement", "Text", "requestAnimationFrame"
];
for (const key of DOM_GLOBALS) {
  (globalThis as Record<string, unknown>)[key] = (dom.window as unknown as Record<string, unknown>)[key];
}
// Install Obsidian-style factory methods (createDiv / createEl /
// createSpan) on the test's HTMLElement prototype. Without this, panels
// crash with "host.createDiv is not a function".
installObsidianDomHelpers(globalThis.HTMLElement);

/** Each panel needs an HTMLElement host; createElement+append gives the
 *  needed createDiv/createEl helpers. */
const makeHost = (): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
};

test("BookmarksPanel: shows chapter, percentage, and timestamp per bookmark (P1 polish)", () => {
  const bookmarks: Bookmark[] = [
    {
      id: "bm-1",
      bookId: "book-x",
      label: "关键论点",
      locator: {
        position: { kind: "reflow", fraction: 0.42, cfi: "epubcfi(/6/14!/4/2/1:0)" },
        chapter: "Chapter 3: Wave Propagation"
      },
      createdAt: new Date("2026-09-16T10:30:00Z").getTime()
    }
  ];
  const panel = new BookmarksPanel({
    onJump: () => {},
    onRemove: () => {},
    onClose: () => {}
  }, makeHost());
  panel.setBookmarks(bookmarks);
  const html = panel.root.innerHTML;
  assert.match(html, /Chapter 3: Wave Propagation/, "chapter label rendered");
  assert.match(html, /42%/, "percentage rendered");
  assert.match(html, /关键论点/, "bookmark label rendered as button text");
  assert.match(html, /ez-reader__panel-close/, "close button rendered in header");
  assert.match(html, /ez-reader__bookmark-row__context/, "context line rendered");
});

test("BookmarksPanel: orders bookmarks newest first", () => {
  const now = Date.now();
  const bookmarks: Bookmark[] = [
    {
      id: "bm-old",
      bookId: "book-x",
      label: "Old bookmark",
      locator: { position: { kind: "reflow", fraction: 0.1 }, chapter: "Ch 1" },
      createdAt: now - 10000
    },
    {
      id: "bm-new",
      bookId: "book-x",
      label: "New bookmark",
      locator: { position: { kind: "reflow", fraction: 0.9 }, chapter: "Ch 9" },
      createdAt: now
    }
  ];
  const panel = new BookmarksPanel({
    onJump: () => {}, onRemove: () => {}, onClose: undefined
  }, makeHost());
  panel.setBookmarks(bookmarks);
  const html = panel.root.innerHTML;
  const newIdx = html.indexOf("New bookmark");
  const oldIdx = html.indexOf("Old bookmark");
  assert.ok(newIdx < oldIdx, `new should appear before old (new=${newIdx} old=${oldIdx})`);
});

test("ExcerptsPanel: shows chapter, quote, note, tags, and action buttons per excerpt", () => {
  const excerpts: Excerpt[] = [
    {
      id: "ex-1",
      bookId: "book-x",
      text: "所有的大人都曾经是小孩",
      note: "这句让我想起童年",
      tags: ["哲学", "回忆"],
      locator: {
        position: { kind: "reflow", fraction: 0.32, cfi: "epubcfi(/6/10!/4/2/1:0)" },
        chapter: "Chapter 2"
      },
      createdAt: Date.now()
    }
  ];
  const panel = new ExcerptsPanel(
    {
      app: undefined,
      onJump: () => {},
      onRemove: () => {},
      onClose: undefined
    },
    makeHost()
  );
  panel.setExcerpts(excerpts);
  const html = panel.root.innerHTML;
  assert.match(html, /Chapter 2/, "chapter rendered");
  assert.match(html, /所有的大人都曾经是小孩/, "quote text rendered");
  assert.match(html, /这句让我想起童年/, "note rendered");
  assert.match(html, /#哲学/, "tag rendered");
  assert.match(html, /跳到原文/, "jump button rendered");
  assert.match(html, /删除/, "delete button rendered");
  assert.match(html, /ez-reader__excerpt-card__btn/, "buttons have card-btn class");
  assert.match(html, /ez-reader__excerpt-card__quote/, "quote in card-quote class");
  assert.match(html, /ez-reader__excerpt-card__note/, "note in card-note class");
});

test("ExcerptsPanel: skip note section when excerpt has no note", () => {
  const excerpts: Excerpt[] = [
    {
      id: "ex-2",
      bookId: "book-x",
      text: "Plain excerpt with no note",
      note: "",
      tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 }, chapter: "Ch 5" },
      createdAt: Date.now()
    }
  ];
  const panel = new ExcerptsPanel({
    app: undefined,
    onJump: () => {}, onRemove: () => {}, onClose: undefined
  }, makeHost());
  panel.setExcerpts(excerpts);
  const html = panel.root.innerHTML;
  assert.match(html, /Plain excerpt with no note/);
  assert.doesNotMatch(html, /ez-reader__excerpt-card__note/, "no note block when note is empty");
});

test("SidebarNotesPanel: header has × close button when onClose is provided (P1 polish)", () => {
  const excerpts: Excerpt[] = [
    {
      id: "ex-n1",
      bookId: "book-x",
      text: "Test note",
      note: "",
      tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 } },
      createdAt: Date.now()
    }
  ];
  let closeCalled = false;
  const panel = new SidebarNotesPanel({
    app: undefined,
    onJump: () => {},
    onRemove: () => {},
    onEdit: () => {},
    onAddThought: () => {},
    onClose: () => { closeCalled = true; }
  }, makeHost());
  panel.setEntries(excerpts);
  const html = panel.root.innerHTML;
  assert.match(html, /ez-reader__panel-close/, "close button rendered in header");
  assert.match(html, /ez-reader__notes-panel__title-row/, "title row layout rendered");
  const closeBtn = panel.root.querySelector(".ez-reader__panel-close");
  assert.ok(closeBtn, "close button present");
  closeBtn?.dispatchEvent(new dom.window.Event("click"));
  assert.ok(closeCalled, "onClose fired");
});

test("SidebarNotesPanel: no × button when onClose is undefined (desktop-wide layout)", () => {
  const panel = new SidebarNotesPanel({
    app: undefined,
    onJump: () => {},
    onRemove: () => {},
    onEdit: () => {},
    onAddThought: () => {}
  }, makeHost());
  const html = panel.root.innerHTML;
  assert.doesNotMatch(html, /ez-reader__panel-close/, "no close button when onClose undefined");
});

test("ExcerptsPanel: jump button triggers onJump handler", () => {
  const excerpts: Excerpt[] = [
    {
      id: "ex-3",
      bookId: "book-x",
      text: "Jump target",
      note: "",
      tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 }, chapter: "Ch 5" },
      createdAt: Date.now()
    }
  ];
  let jumped: Excerpt | null = null;
  const panel = new ExcerptsPanel({
    app: undefined,
    onJump: (ex) => { jumped = ex; },
    onRemove: () => {},
    onClose: undefined
  }, makeHost());
  panel.setExcerpts(excerpts);
  const jumpBtn = panel.root.querySelector<HTMLElement>(".ez-reader__excerpt-card__btn");
  assert.ok(jumpBtn, "jump button exists");
  jumpBtn?.dispatchEvent(new dom.window.Event("click"));
  assert.ok(jumped, "onJump fired");
  assert.equal(jumped?.id, "ex-3");
});

test("BookmarksPanel: empty state shows helper text", () => {
  const panel = new BookmarksPanel({
    onJump: () => {}, onRemove: () => {}, onClose: undefined
  }, makeHost());
  panel.setBookmarks([]);
  const html = panel.root.innerHTML;
  assert.match(html, /本书还没有书签/);
});

// ===== P2 round 2: chapter tracking fix + layout + thought badge =====

test("BookmarksPanel: jump and remove buttons are on the same action-row (P2 layout)", () => {
  // 用户反馈 #5: "删除键单独占一行也太多了" — 现在 jump + remove 共一行.
  const bookmarks: Bookmark[] = [
    {
      id: "bm-r",
      bookId: "book-x",
      label: "行内测试",
      locator: {
        position: { kind: "reflow", fraction: 0.5, cfi: "epubcfi(/6/10!/4/2/1:0)" },
        chapter: "Ch X"
      },
      createdAt: Date.now()
    }
  ];
  const panel = new BookmarksPanel({
    onJump: () => {}, onRemove: () => {}, onClose: undefined
  }, makeHost());
  panel.setBookmarks(bookmarks);
  const actionRow = panel.root.querySelector(".ez-reader__bookmark-row__action-row");
  assert.ok(actionRow, "action-row exists wrapping jump + remove");
  const jump = actionRow?.querySelector(".ez-reader__bookmark-row__jump");
  const remove = actionRow?.querySelector(".ez-reader__bookmark-row__remove");
  assert.ok(jump, "jump inside action-row");
  assert.ok(remove, "remove inside action-row");
});

test("BookmarksPanel: missing chapter renders only fraction+time (P2 fallback for old bookmarks)", () => {
  // 用户反馈 #1: "整个书签能不能加个章节" — 修复了 chapter 写入路径,
  // 但旧书签的 chapter 是空字符串. 现在空 chapter 时不渲染 chapter span,
  // 只显示 % + 时间 (不显示空白 chip).
  const bookmarks: Bookmark[] = [
    {
      id: "bm-old",
      bookId: "book-x",
      label: "旧书签 (chapter 空)",
      locator: {
        position: { kind: "reflow", fraction: 0.357, cfi: "epubcfi(/6/14!/4/2/1:0)" },
        chapter: ""
      },
      createdAt: Date.now() - 60000
    }
  ];
  const panel = new BookmarksPanel({
    onJump: () => {}, onRemove: () => {}, onClose: undefined
  }, makeHost());
  panel.setBookmarks(bookmarks);
  const html = panel.root.innerHTML;
  assert.match(html, /36%/, "percentage still rendered");
  // chapter span class 在 DOM 里没有 → 不会出现 <span class="ez-reader__bookmark-row__chapter"></span>
  assert.doesNotMatch(html, /ez-reader__bookmark-row__chapter/, "no empty chapter span");
});

test("ExcerptsPanel: thought (empty text) renders badge instead of blank blockquote (P2)", () => {
  // 用户反馈 #3: "摘录中还是没有显示原文,而是空白" — "+想法" 走
  // openFreeThoughtModal 创建的 excerpt.text 是 "" (只有 note). 之前
  // 渲染空白 blockquote 让用户困惑, 现在显示 "💭 自由想法" badge.
  const excerpts: Excerpt[] = [
    {
      id: "th-1",
      bookId: "book-x",
      text: "",
      note: "测试一下想法",
      tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 }, chapter: "Ch 7" },
      createdAt: Date.now()
    }
  ];
  const panel = new ExcerptsPanel({
    app: undefined,
    onJump: () => {}, onRemove: () => {}, onClose: undefined
  }, makeHost());
  panel.setExcerpts(excerpts);
  const html = panel.root.innerHTML;
  assert.match(html, /自由想法/, "thought badge label rendered");
  assert.match(html, /测试一下想法/, "note text rendered");
  assert.doesNotMatch(html, /ez-reader__excerpt-card__quote/, "no blockquote when text empty");
  assert.match(html, /ez-reader__excerpt-card__thought-badge/, "thought-badge class present");
});

// ===== P2 round 3: notes panel tabs + inline note patch =====

test("SidebarNotesPanel: top tabs (全部 / 想法 / 摘录) with counts (P2)", () => {
  const excerpts: Excerpt[] = [
    {
      id: "th-1", bookId: "book-x", text: "", note: "自由想法 A",
      tags: [], locator: { position: { kind: "reflow", fraction: 0.1 } },
      createdAt: Date.now() - 3000
    },
    {
      id: "th-2", bookId: "book-x", text: "", note: "自由想法 B",
      tags: [], locator: { position: { kind: "reflow", fraction: 0.2 } },
      createdAt: Date.now() - 2000
    },
    {
      id: "ex-1", bookId: "book-x", text: "选中的原文段落", note: "我的评论",
      tags: [], locator: { position: { kind: "reflow", fraction: 0.5 } },
      createdAt: Date.now() - 1000
    }
  ];
  const panel = new SidebarNotesPanel({
    app: undefined,
    onJump: () => {}, onRemove: () => {}, onEdit: () => {}, onAddThought: () => {}
  }, makeHost());
  panel.setEntries(excerpts);
  const html = panel.root.innerHTML;
  // 三个 tab 都在
  assert.match(html, /ez-reader__notes-panel__tabs/, "tabs container present");
  assert.match(html, /ez-reader__notes-panel__tab/, "tab buttons present");
  // 计数 — 全部 3, 想法 2, 摘录 1
  const allCount = html.match(/ez-reader__notes-panel__tab-count[^>]*>(\d+)</);
  assert.ok(allCount && allCount[1] === "3", `全部 tab count = 3 (got ${allCount?.[1]})`);
});

test("SidebarNotesPanel: clicking 想法 tab filters to thoughts only", () => {
  const excerpts: Excerpt[] = [
    { id: "th-1", bookId: "book-x", text: "", note: "想法 A", tags: [],
      locator: { position: { kind: "reflow", fraction: 0.1 } }, createdAt: Date.now() - 2000 },
    { id: "ex-1", bookId: "book-x", text: "原文段落", note: "评论", tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 } }, createdAt: Date.now() - 1000 }
  ];
  const panel = new SidebarNotesPanel({
    app: undefined,
    onJump: () => {}, onRemove: () => {}, onEdit: () => {}, onAddThought: () => {}
  }, makeHost());
  panel.setEntries(excerpts);
  // 找到"想法" tab 按钮
  const tabs = panel.root.querySelectorAll<HTMLElement>(".ez-reader__notes-panel__tab");
  const thoughtTab = Array.from(tabs).find((t) => t.textContent?.startsWith("想法"));
  assert.ok(thoughtTab, "想法 tab exists");
  thoughtTab?.dispatchEvent(new dom.window.Event("click"));
  const html = panel.root.innerHTML;
  // 想法 A 在列表里
  assert.match(html, /想法 A/, "thought entry visible");
  // 原文段落不在列表里 (被过滤)
  assert.doesNotMatch(html, /原文段落/, "excerpt entry filtered out");
});

test("SidebarNotesPanel: clicking 摘录 tab filters to excerpts only", () => {
  const excerpts: Excerpt[] = [
    { id: "th-1", bookId: "book-x", text: "", note: "想法 A", tags: [],
      locator: { position: { kind: "reflow", fraction: 0.1 } }, createdAt: Date.now() - 2000 },
    { id: "ex-1", bookId: "book-x", text: "原文段落", note: "评论", tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 } }, createdAt: Date.now() - 1000 }
  ];
  const panel = new SidebarNotesPanel({
    app: undefined,
    onJump: () => {}, onRemove: () => {}, onEdit: () => {}, onAddThought: () => {}
  }, makeHost());
  panel.setEntries(excerpts);
  const tabs = panel.root.querySelectorAll<HTMLElement>(".ez-reader__notes-panel__tab");
  const excerptTab = Array.from(tabs).find((t) => t.textContent?.startsWith("摘录"));
  assert.ok(excerptTab, "摘录 tab exists");
  excerptTab?.dispatchEvent(new dom.window.Event("click"));
  const html = panel.root.innerHTML;
  assert.match(html, /原文段落/, "excerpt entry visible");
  assert.doesNotMatch(html, /想法 A/, "thought entry filtered out");
});

test("SidebarNotesPanel: onUpdateNote wired; toggle-commit saves inline edit (P2)", () => {
  // 简化的 inline edit 测试 — 验证 wiring 正确 (editing sentinel 设上,
  // DOM contenteditable 准备好, handlers.onUpdateNote 会被调).
  // 完整 blur 流程涉及真实 DOM focus state, jsdom 不完整支持 — 用户
  // 在 Obsidian 真实环境验证最终体验. 这里我们只确认:
  //   1. 展开 toggle → note 进入编辑态 (data-editing=1 + contentEditable=true)
  //   2. 收起 toggle 时如果有未保存改动 → finish(false) → 还原文字
  //   3. onUpdateNote 函数引用被持有 (用户后续改字 + blur 在真实环境触发)
  const excerpts: Excerpt[] = [
    { id: "th-1", bookId: "book-x", text: "", note: "原始想法", tags: [],
      locator: { position: { kind: "reflow", fraction: 0.5 } }, createdAt: Date.now() }
  ];
  let saved = null;
  const panel = new SidebarNotesPanel({
    app: undefined,
    onJump: () => {}, onRemove: () => {}, onEdit: () => {}, onAddThought: () => {},
    onUpdateNote: (excerpt, note) => {
      saved = { excerpt, note };
      
      return Promise.resolve();
    }
  }, makeHost());
  panel.setEntries(excerpts);

  // 1. 初始态: note 收起 (无 data-editing)
  const note = panel.root.querySelector<HTMLElement>(".ez-reader__notes-panel__note");
  assert.ok(note, "note element exists");
  assert.equal(note?.getAttribute("data-editing"), null, "initially not editing");

  // 2. 点 toggle → 展开 + 自动进 edit (data-editing=1)
  const toggle = panel.root.querySelector<HTMLElement>(".ez-reader__notes-panel__note-toggle");
  toggle?.dispatchEvent(new dom.window.Event("click"));
  assert.equal(note?.getAttribute("data-editing"), "1", "editing sentinel set after expand");
  // contentEditable 在 jsdom 里也支持 (我们之前的 min repro 验证过)
  // 这里不强求 is-editing class — jsdom 的 addClass 是 ok 的

  // 3. 模拟用户改字 + 再点 toggle 收起 → 等同于 blur → commit 路径
  // (跟 Notion / Apple Notes 一致: 收起 = 保存)
  note.textContent = "更新后的想法";
  toggle?.dispatchEvent(new dom.window.Event("click"));
  // 保存是 async 的 — 等 microtask 完成
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(() => {
      assert.ok(saved, "onUpdateNote called on toggle-collapse");
      assert.equal(saved?.note, "更新后的想法", "new note text passed");
      resolve();
    }, 50);
  });
});
