/**
 * v0.3.3 架构批 A/B: ReaderView workspace 状态持久化 + leaf 复用。
 *
 * 覆盖三个 bug:
 *  A1 ReaderView 没有 getState/setState → 重启后恢复的阅读器标签页是空壳
 *  A2 findReaderLeafForBook 只查 layout state → 同一 leaf 换书后永远查不到
 *  B  Plugin.onunload 不卸载 PdfOverlay → 禁用插件后 60fps rAF + observer 泄漏
 *  C  openReader 无条件 getLeaf("tab") → 重复开同一本书标签页无限增长
 *     且 readerOpenMode 设置是个死设置
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildReaderViewState,
  parseReaderViewState
} from "../../src/ui/reader/ReaderView";
import { readerLeafMatchesBook } from "../../src/ui/reader/readerLeafState";
import { codeOnly } from "./codeOnly";

const readSrc = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * 剥掉注释再断言 —— 见 `codeOnly.ts` 顶部关于"为什么必须剥"的说明。
 * (注意: 各测试文件里**不要**再各自复制一份正则版本, 那个版本有 bug:
 *  行注释里出现的块注释起始符会被当成块注释开头, 吞掉后面所有真实代码。)
 */

const readerViewSrc = codeOnly(readSrc("../../../src/ui/reader/ReaderView.ts"));
const pluginSrc = codeOnly(readSrc("../../../src/Plugin.ts"));

// ─────────────────────────────────────────────────────────────
// A1: ReaderView 的 workspace 状态序列化
// ─────────────────────────────────────────────────────────────

test("buildReaderViewState: 有书时 file 就是 bookId", () => {
  assert.deepEqual(
    buildReaderViewState({ bookId: "books/地震学导论.pdf", immersive: false }),
    { file: "books/地震学导论.pdf", immersive: false }
  );
});

test("buildReaderViewState: 没打开书时 file 是空串而不是 undefined", () => {
  // undefined 会在 workspace.json 里被 JSON.stringify 直接丢掉, 恢复时
  // 变成"这个 key 不存在", 跟"用户开了个空阅读器"无法区分。空串能扛过
  // 一轮 JSON 往返。
  assert.deepEqual(buildReaderViewState({ bookId: undefined, immersive: false }), {
    file: "",
    immersive: false
  });
});

test("buildReaderViewState: 沉浸状态被带进 state", () => {
  assert.equal(buildReaderViewState({ bookId: "a.epub", immersive: true }).immersive, true);
});

test("buildReaderViewState: 不持久化 fraction / locator", () => {
  // 续读位置的唯一真相源是 data.json 的 ReadingState.position。workspace
  // state 里再存一份就产生第二个真相源, data.json 往后走而 workspace
  // state 停在退出那一刻, 谁新谁旧说不清。
  // `ReaderViewState` 只有 file / immersive 两个字段, 压根没有 fraction /
  // locator —— 之前靠 `as Record<string, unknown>` 硬转才能去读那两个 key
  // (TS2352: 两种类型没有足够重叠). 用 `in` 运算符直接问"这个 key 在不在",
  // 既不用强转, 断言还更严 (原写法在"属性存在但值是 undefined"时也会通过).
  const state = buildReaderViewState({ bookId: "a.epub", immersive: false });
  assert.equal("fraction" in state, false, "workspace state must not carry progress");
  assert.equal("locator" in state, false, "workspace state must not carry the locator");
});

// ─────────────────────────────────────────────────────────────
// A1: 反序列化必须校验, 不能直接 cast
// ─────────────────────────────────────────────────────────────

test("parseReaderViewState: 接受合法 shape", () => {
  assert.deepEqual(parseReaderViewState({ file: "books/a.epub", immersive: true }), {
    file: "books/a.epub",
    immersive: true
  });
});

test("parseReaderViewState: 非对象一律 null", () => {
  for (const bad of [null, undefined, 42, "books/a.epub", true, [{ file: "x" }]]) {
    assert.equal(parseReaderViewState(bad), null, `应拒绝: ${JSON.stringify(bad)}`);
  }
});

test("parseReaderViewState: file 缺失或不是 string 一律 null", () => {
  // workspace state 存在 workspace.json 里, 用户手改 / 跨版本升级 /
  // Obsidian 自己的 schema 变更都可能送来任意形状。直接 cast 会让
  // `library.get(undefined)` 去查一张以文件名为 key 的 Map, 拿到一个
  // 用户完全看不懂的失败。
  assert.equal(parseReaderViewState({}), null);
  assert.equal(parseReaderViewState({ immersive: true }), null);
  assert.equal(parseReaderViewState({ file: 123 }), null);
  assert.equal(parseReaderViewState({ file: null }), null);
  assert.equal(parseReaderViewState({ file: ["a"] }), null);
});

test("parseReaderViewState: immersive 非 true 时归一成 undefined", () => {
  // 只有字面量 true 才算沉浸。"true" / 1 / {} 都是 workspace.json 里的脏数据,
  // 宁可当普通模式也不要误进沉浸 —— 误进沉浸会隐藏唯一的退出按钮。
  assert.equal(parseReaderViewState({ file: "a", immersive: "true" })?.immersive, undefined);
  assert.equal(parseReaderViewState({ file: "a", immersive: 1 })?.immersive, undefined);
  assert.equal(parseReaderViewState({ file: "a", immersive: false })?.immersive, undefined);
  assert.equal(parseReaderViewState({ file: "a" })?.immersive, undefined);
});

test("parseReaderViewState: 空串 file 是合法的空阅读器", () => {
  // 跟 buildReaderViewState 的空串输出配对 —— 不能把它判成 null, 否则
  // getState/setState 不对称。
  assert.deepEqual(parseReaderViewState({ file: "", immersive: false }), {
    file: "",
    immersive: undefined
  });
});

// ─────────────────────────────────────────────────────────────
// A1: 类真的把两个纯函数接到了 Obsidian 契约上
// ─────────────────────────────────────────────────────────────

test("ReaderView 覆写了 getState 并委托给 buildReaderViewState", () => {
  assert.match(readerViewSrc, /getState\(\)\s*:\s*Record<string, unknown>\s*\{/);
  assert.match(readerViewSrc, /buildReaderViewState\(\{/);
});

test("ReaderView 覆写了 setState 并委托给 parseReaderViewState", () => {
  assert.match(
    readerViewSrc,
    /async setState\(rawState:\s*unknown,\s*result:\s*ViewStateResult\)/
  );
  assert.match(readerViewSrc, /parseReaderViewState\(rawState\)/);
});

test("ReaderView 暴露 getCurrentBookId 给 Plugin 做第二重匹配", () => {
  assert.match(readerViewSrc, /getCurrentBookId\(\)\s*:\s*string \| undefined/);
});

test("setState 走 library.get(bookId) 而不是自己造 entry", () => {
  // 自己造 entry 就绕开了书库里的 metadata / reading 状态, 恢复出来的
  // 阅读器会没有书名、没有续读位置 —— 而"重启后读的位置没了"正是这个
  // bug 要解决的。
  assert.match(readerViewSrc, /this\.deps\.library\?\.get\(parsed\.file\)/);
});

test("setState 等自己的 host-ready 信号, 没用 result.loaded", () => {
  // Obsidian 的 ViewStateResult 上只有 history: boolean, 没有 loaded。
  // 社区插件里常见的 `await result.loaded` 在本项目的 obsidian.d.ts 上
  // 根本不存在 —— 照抄会编译失败, 改通则会退化成永远不 resolve。
  assert.doesNotMatch(readerViewSrc, /result\.loaded/);
  assert.match(readerViewSrc, /await this\.whenHostReady\(\)/);
  assert.match(readerViewSrc, /private whenHostReady\(\): Promise<void>/);
});

test("host-ready 信号在 onOpen 末尾发, 在 onClose 重置", () => {
  const openIdx = readerViewSrc.indexOf("async onOpen()");
  const closeIdx = readerViewSrc.indexOf("async onClose()");
  assert.ok(openIdx >= 0 && closeIdx > openIdx, "应能定位 onOpen / onClose");
  // 发信号
  assert.match(readerViewSrc.slice(openIdx, closeIdx), /hostReadyResolve\?\.\(\)/);
  // 重置 —— 不重置的话同一个 view 实例被 Obsidian 复用时, 第二次 onOpen
  // 之后 whenHostReady() 返回一个早就 resolve 的旧 promise, 恢复路径静默卡住。
  assert.match(
    readerViewSrc.slice(closeIdx),
    /this\.hostReadyPromise = undefined;[\s\S]{0,200}this\.hostReadyResolve = undefined;/
  );
});

test("onunload 卸载所有 PdfOverlay", () => {
  // 不卸载的后果: 用户禁用插件后, 每个 PDF leaf 上仍跑着 60fps rAF +
  // 2 个 MutationObserver + 6 个 document/window listener, 而且它们闭包
  // 持有 view, 对应页面永远无法 GC。
  assert.match(pluginSrc, /onunload\(\)\s*:\s*void\s*\{/);
  const unloadIdx = pluginSrc.indexOf("onunload(): void {");
  assert.ok(unloadIdx >= 0);
  const body = pluginSrc.slice(unloadIdx, unloadIdx + 2000);
  assert.match(body, /unmountAllPdfOverlays\(\)/);
  // 动态 import 必须 catch —— pdfOverlay.ts 是重模块, 用户从没开过 PDF 时
  // import 本身是唯一会失败的一步, 失败不能阻断后面的清理。
  assert.match(body, /\.catch\(/);
});

// ─────────────────────────────────────────────────────────────
// A2: readerLeafMatchesBook
// ─────────────────────────────────────────────────────────────

test("readerLeafMatchesBook: view 上的 bookId 优先于 layout", () => {
  // 关键场景: 用户在同一个 leaf 里从 A 换到 B。layout 还写着 A,
  // view 已经是 B。此时问 B, 必须命中。
  assert.equal(readerLeafMatchesBook({ file: "A.epub" }, "B.epub", "B.epub"), true);
  // 反过来问 A —— view 是权威, layout 的 A 已经过期, 不该再命中,
  // 否则 openReader 会"复用"一个其实正显示着 B 的 leaf。
  assert.equal(readerLeafMatchesBook({ file: "A.epub" }, "B.epub", "A.epub"), false);
});

test("readerLeafMatchesBook: view 没有书时退回 layout", () => {
  assert.equal(readerLeafMatchesBook({ file: "A.epub" }, undefined, "A.epub"), true);
  assert.equal(readerLeafMatchesBook({ file: "A.epub" }, "", "A.epub"), true);
  assert.equal(readerLeafMatchesBook({ file: "A.epub" }, undefined, "B.epub"), false);
});

test("readerLeafMatchesBook: 脏 layout state 一律不匹配", () => {
  for (const bad of [null, undefined, 0, "A.epub", [], [1], { file: 1 }, {}]) {
    assert.equal(readerLeafMatchesBook(bad, undefined, "A.epub"), false);
  }
});

test("Plugin.findReaderLeafForBook 真的用上了这个纯函数", () => {
  assert.match(pluginSrc, /readerLeafMatchesBook\(layoutState, viewBookId, bookId\)/);
});

// ─────────────────────────────────────────────────────────────
// C: openReader 复用 leaf + readerOpenMode 不是死设置
// ─────────────────────────────────────────────────────────────

test("openReader 先查已有 leaf, 命中就复用不新开", () => {
  const idx = pluginSrc.indexOf("private async openReader(");
  assert.ok(idx >= 0, "应能定位 openReader");
  const body = pluginSrc.slice(idx, idx + 2200);
  const reuseIdx = body.indexOf("findReaderLeafForBook");
  const newLeafIdx = body.indexOf("getLeaf(");
  assert.ok(reuseIdx >= 0, "openReader 应查已有 leaf");
  assert.ok(newLeafIdx >= 0, "openReader 仍需要开新 leaf 的路径");
  assert.ok(
    reuseIdx < newLeafIdx,
    "复用判断必须排在 getLeaf 之前, 否则先开了新标签页再谈复用"
  );
  // 查的时候必须传**这本**书的 id。传个常量或不传, 复用判断就永远不成立,
  // 而上面那几条只查文本形状的断言照样会绿 —— 这是本条断言存在的理由。
  assert.match(body, /findReaderLeafForBook\(entry\.book\.id\)/);
  assert.match(body, /if \(reusable\)/);
});

test("恢复出来的阅读器不往导航历史里塞一条空记录", () => {
  // `result.history = true` 会让 Obsidian 记一条后退记录, 用户按后退
  // 回到的是一个还没加载完的空壳阅读器。
  const idx = readerViewSrc.indexOf("async setState(");
  assert.ok(idx >= 0);
  const body = readerViewSrc.slice(idx, idx + 1500);
  assert.match(body, /result\.history = false;/);
});

test("readerOpenMode 不再是死设置", () => {
  const idx = pluginSrc.indexOf("private async openReader(");
  const body = pluginSrc.slice(idx, idx + 2200);
  // 设置页有"打开阅读器方式: 在标签页中打开 / 在新窗口中打开"下拉框,
  // Plugin 之前硬编码 getLeaf("tab"), 那个下拉框是纯装饰。
  assert.doesNotMatch(body, /getLeaf\("tab"\)/);
  assert.match(body, /loadReaderOpenMode\(\)/);
  assert.match(body, /getLeaf\(mode === "window" \? "window" : "tab"\)/);
  // 设置读取必须有兜底: 读失败时 fallback "tab"。猜成 window 会凭空弹出
  // 一个抢焦点的窗口, 比"设置没生效"糟糕得多。
  assert.match(pluginSrc, /return settings\.readerOpenMode === "window" \? "window" : "tab";/);
});

test("setViewState 存的 state 用 bookId 而不是 locator.path", () => {
  // 两者在 ObsidianBookSource.resolveId 里相等 (resolveId(locator) =>
  // locator.path), 但 ReaderView 是拿这个字段去 library.get() 查的,
  // 语义上是 id。写成 path 只是碰巧相等。
  const idx = pluginSrc.indexOf("private async openReader(");
  const body = pluginSrc.slice(idx, idx + 2200);
  assert.match(body, /state:\s*\{\s*file:\s*entry\.book\.id\s*\}/);
  assert.doesNotMatch(body, /state:\s*\{\s*file:\s*entry\.book\.locator\.path\s*\}/);
});

test("协议跳转的兜底不再抓不相干的 reader leaf", () => {
  // 旧的 `?? getLeavesOfType(READER_VIEW_TYPE)[0]` 会抓一个完全不相干的
  // leaf, 拿 A 的 excerptId 去 B 的书库里查 —— 静默什么都不做。
  assert.doesNotMatch(
    pluginSrc,
    /findReaderLeafForBook\(bookId\) \?\? this\.app\.workspace\.getLeavesOfType\(READER_VIEW_TYPE\)\[0\]/
  );
});
