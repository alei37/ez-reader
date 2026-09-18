/**
 * Stub for the `obsidian` package used in test bundles.
 *
 * `obsidian` is types-only in this repo — it ships `.d.ts` files but
 * no runtime JS. Tests that import UI components (which transitively
 * `import { Modal, App, ... } from "obsidian"`) need a placeholder so
 * the bundle resolves.
 *
 * Also exports `installObsidianDomHelpers(HTMLElementCtor)` — call it
 * from the test after copying `globalThis.HTMLElement = newJSDOM.window.HTMLElement`,
 * and the factory methods (createDiv / createEl / createSpan) get
 * installed on that prototype so panel code can run.
 *
 * Why not auto-install? Each test creates its own JSDOM instance with
 * a separate HTMLElement prototype; the stub runs at module load before
 * any test setup. Tests that don't share prototypes are isolated, so
 * we let each test opt in.
 */

const factoryMethods = {
  createDiv: function (options) {
    const doc = this.ownerDocument;
    const el = doc.createElement("div");
    if (options && options.cls) el.className = options.cls;
    if (options && options.text != null) el.textContent = options.text;
    if (options && options.attr) for (const k of Object.keys(options.attr)) {
      el.setAttribute(k, String(options.attr[k]));
    }
    this.append(el);
    return el;
  },
  createEl: function (tag, options) {
    // Obsidian's runtime createEl auto-appends to `this` (despite the
    // .d.ts not documenting this). The plugin's panel code relies on
    // auto-append, so we mimic the runtime behavior here. (createDiv and
    // createSpan definitely auto-append per d.ts; createEl auto-appends
    // in practice.)
    const doc = this.ownerDocument;
    const el = doc.createElement(tag);
    if (options && options.cls) el.className = options.cls;
    if (options && options.text != null) el.textContent = options.text;
    if (options && options.attr) for (const k of Object.keys(options.attr)) {
      el.setAttribute(k, String(options.attr[k]));
    }
    this.append(el);
    return el;
  },
  createSpan: function (options) {
    const doc = this.ownerDocument;
    const el = doc.createElement("span");
    if (options && options.cls) el.className = options.cls;
    if (options && options.text != null) el.textContent = options.text;
    if (options && options.attr) for (const k of Object.keys(options.attr)) {
      el.setAttribute(k, String(options.attr[k]));
    }
    this.append(el);
    return el;
  },
  empty: function () {
    while (this.firstChild) this.removeChild(this.firstChild);
    return this;
  },
  addClass: function (...classes) {
    for (const c of classes) if (c) this.classList.add(c);
    return this;
  },
  removeClass: function (...classes) {
    for (const c of classes) if (c) this.classList.remove(c);
    return this;
  },
  toggleClass: function (cls, force) {
    if (force === true) this.classList.add(cls);
    else if (force === false) this.classList.remove(cls);
    else this.classList.toggle(cls);
    return this;
  },
  setText: function (text) {
    this.textContent = text;
    return this;
  }
};

/** Install createDiv / createEl / createSpan / empty / addClass / ...
 *  on the given HTMLElement constructor's prototype. Idempotent —
 *  repeated calls are no-ops. */
export function installObsidianDomHelpers(HTMLElementCtor) {
  if (!HTMLElementCtor || !HTMLElementCtor.prototype) return;
  const proto = HTMLElementCtor.prototype;
  if (typeof proto.createDiv !== "function") {
    for (const key of Object.keys(factoryMethods)) {
      Object.defineProperty(proto, key, {
        value: factoryMethods[key],
        writable: true,
        configurable: true
      });
    }
  }
}

export class Modal {
  constructor() {}
  open() {}
  close() {}
}
export class App {}
export class Plugin {}
export class Setting {}
export class Notice {
  constructor() {}
}
/**
 * P1: 额外补齐几个 ReaderView.ts 用的类型. 测试 import ReaderView
 * 测纯函数 (composeQuickBookmarkLabel / truncateExcerptText) 时会顺带
 * 拽进整个 UI 类. 这些 stub class 不会被实际调用, 只让 esbuild 解析
 * 名字通过. 如果后续某个测试真要 instantiate 这些, 需要扩展 stub.
 */
export class ItemView {}
export class WorkspaceLeaf {}
export class TFile {}
export const Platform = {};
export const setIcon = () => {};
export const setTooltip = () => {};
export default {};
