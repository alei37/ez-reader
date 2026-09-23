import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { KeyboardShortcuts } from "../../core/types/ReaderSettings";

/**
 * P2: 完整的快捷键帮助面板 — 替代之前用 Notice 弹出长文本, Notice
 * 在 Obsidian 上会被截断 / 自动消失, 用户来不及读完. 现在做成 Modal:
 *
 *   - 分组: 翻页 / 注释 / 面板 / 沉浸 / 搜索 / 其它
 *   - 用户自定义的快捷键在 label 里高亮 ("你设的: T")
 *   - Esc / overlay click 关闭
 *
 * 设计参考 macOS Preview / Adobe Reader 的快捷键列表 — 表格 + 分组 + 简短
 * 描述. 用户能快速扫一眼找到想要的.
 */
export class ShortcutHelpModal extends Modal {
  constructor(app: App, private readonly shortcuts: KeyboardShortcuts) {
    super(app);
    this.modalEl.addClass("ez-reader__shortcut-help");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "EzReader 快捷键" });

    contentEl.createEl("p", {
      text: "在阅读器内直接按以下键(无需 Ctrl/Cmd)。按 Esc 关闭此面板。",
      cls: "ez-reader__shortcut-help__intro"
    });

    // 用户自定义的快捷键 — 显示在 label 后面, 用户能看出"我改过这个".
    const tPrev = this.shortcuts.prev;
    const tNext = this.shortcuts.next;
    const tSidebar = this.shortcuts.toggleSidebar;
    const tToc = this.shortcuts.toggleToc;
    const tTranslate = this.shortcuts.translate;
    const tHighlight = this.shortcuts.highlight;

    const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
      {
        title: "翻页",
        rows: [
          ["← / PageUp", "上一页"],
          ["→ / PageDown / Space", "下一页"],
          ["Shift + Space", "上一页"],
          ["Home / End", "跳到首 / 末"]
        ]
      },
      {
        title: "注释 — 一键保存(不弹窗)",
        rows: [
          ["H", "快速高亮(选中文本后按 H,直接保存)"],
          ["B", "快速加书签(自动用当前章节 + 百分比命名)"],
          ["Shift + " + tHighlight, "保存摘录(弹出 note + tags 输入)"]
        ]
      },
      {
        title: "注释 — 翻译 / 复制",
        rows: [
          ["Shift + " + tTranslate, "翻译选词"],
          ["C", "复制选区"]
        ]
      },
      {
        title: "面板 / 沉浸",
        rows: [
          [tSidebar.toUpperCase(), "切换笔记侧栏"],
          [tToc.toUpperCase(), "切换目录"],
          ["F", "切换沉浸模式"],
          ["Esc", "关闭打开的面板 / 选区菜单 / 翻译抽屉"]
        ]
      },
      {
        title: "搜索 / 其它",
        rows: [
          ["Ctrl/Cmd + F  或  /", "搜索书内文字"],
          ["?", "再次打开此帮助"]
        ]
      }
    ];

    for (const group of groups) {
      const section = contentEl.createDiv({ cls: "ez-reader__shortcut-help__section" });
      section.createEl("h3", { text: group.title });
      const table = section.createEl("table", { cls: "ez-reader__shortcut-help__table" });
      const tbody = table.createTBody();
      for (const [key, desc] of group.rows) {
        const tr = tbody.createEl("tr");
        const keyCell = tr.createEl("td", { cls: "ez-reader__shortcut-help__key" });
        // 键名 kbd 风格
        const kbd = keyCell.createEl("kbd", { text: key });
        kbd.addClass("ez-reader__shortcut-help__kbd");
        tr.createEl("td", { text: desc, cls: "ez-reader__shortcut-help__desc" });
      }
    }

    // 底注 — 自定义提示
    const footer = contentEl.createEl("p", {
      cls: "ez-reader__shortcut-help__footer"
    });
    footer.setText(
      `当前翻页键:${tPrev} / ${tNext} · 侧栏:${tSidebar} · 目录:${tToc} · 翻译:Shift+${tTranslate} · 高亮:Shift+${tHighlight}`
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
