import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

import { bytesFromBufferSource, hexFromBuffer, sha1Bytes } from "../../src/platform/Sha1";
// Namespace import on purpose: `createFallbackSubtle` does not exist yet in
// the pre-fix source, and a named import of a missing export is an esbuild
// BUILD ERROR (which would make the red run inconclusive instead of a real
// assertion failure). A namespace import resolves at runtime, so the test
// fails on `typeof … === "function"` — a genuine assertion failure.
import * as polyfillsModule from "../../src/platform/polyfills";
import { SettingsTab } from "../../src/ui/settings/SettingsTab";
// 同 polyfills: 命名 import 一个尚不存在的导出 = esbuild BUILD ERROR
// (那种红叫 INCONCLUSIVE), 所以用 namespace import 在运行时取。
import * as settingsModule from "../../src/ui/settings/SettingsTab";
import { TranslationCoordinator } from "../../src/core/services/TranslationService";
import { ObsidianBookSource } from "../../src/adapters/obsidian/ObsidianBookSource";
import { TFile } from "obsidian";
import { codeOnly } from "./codeOnly";

import type { AnnotationStore } from "../../src/core/ports/AnnotationStore";
import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from "../../src/core/ports/TranslationProvider";
import type { PluginSettings } from "../../src/core/types/ReaderSettings";
import type { BookFormat } from "../../src/core/entities/Book";
import type { App } from "obsidian";

/** SettingsTab 新导出的纯函数 (运行期取, 见上面 namespace import 的理由)。 */
const describeSaveFailure = (settingsModule as unknown as Record<string, unknown>)
  .describeSaveFailure as (error: unknown) => string;

/**
 * Batch-7 misc fixes. 每个 case 对应一个 review 出来的真实缺陷, 全部先红后绿:
 *   1. SettingsTab 没有 hide() 覆写 → 关闭设置弹窗时 debounce 里的改动丢失
 *   2. Sha1.bytesFromBufferSource 注释说 UTF-8, 实际做 Latin-1 (`& 0xff`)
 *   3. crypto.subtle 的 polyfill 只有 SHA-1 digest → 有道 / Google 老设备直接崩
 *   4. SettingsTab 里 9 处 async onChange 没有 .catch() → unhandled rejection
 *   5. exportData 没有 try/catch → 点了导出没反应, 不知道成没成
 *   6. TranslationService 没有 in-flight 去重 + 输入长度无上限 → 烧 API 配额
 *   7. ObsidianBookSource.scan() 递归进 .obsidian/ 和 .trash/
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");

// 剥注释用项目共享的扫描器 (tests/core/codeOnly.ts) —— 自己用正则写的那版
// 有顺序 bug, 会把行注释里含块注释起始符的那一段连同真实代码一起吞掉。

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * 严格模式下 DOM lib 认为 `Uint8Array<ArrayBufferLike>` 不能当 `BufferSource`
 * —— 因为它的 buffer 可能是 SharedArrayBuffer。生产代码里 Google provider
 * 已经有同名的 `toStandaloneBuffer` helper 解决这个, 这里照抄同一套做法,
 * 而不是到处写 `as BufferSource`(那样会把类型错误一起盖掉)。
 */
const buf = (u: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(u.byteLength);
  new Uint8Array(copy).set(u);
  return copy;
};
/** BufferSource 版本的 utf8 —— 大部分 subtle.* 调用要的是这个。 */
const utf8Buf = (s: string): ArrayBuffer => buf(utf8(s));

const sha1Hex = (bytes: Uint8Array): string => hexFromBuffer(sha1Bytes(bytes));

// ===========================================================================
// 1. SettingsTab.hide() flushes pending debounced writes
// ===========================================================================

class FakeDebouncer {
  flushCount = 0;
  cancelCount = 0;
  async flush(): Promise<void> {
    this.flushCount += 1;
  }
  cancel(): void {
    this.cancelCount += 1;
  }
}

/** AnnotationStore 只需要 listSettings / patchSettings / load 就能构造出 tab. */
const fakeStore = (overrides: Partial<Record<string, unknown>> = {}): AnnotationStore =>
  ({
    listSettings: async () => ({}),
    patchSettings: async () => undefined,
    load: async () => ({}),
    ...overrides
  }) as unknown as AnnotationStore;

const makeTab = (store: AnnotationStore = fakeStore()): SettingsTab =>
  new SettingsTab({} as unknown as App, {} as never, store, []);

test("bug1: SettingsTab 自己覆写了 hide() (基类那个空实现不会 flush 任何东西)", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(SettingsTab.prototype, "hide"),
    "SettingsTab 必须覆写 hide(), 否则关闭设置弹窗时 activeDebouncers 里的定时器随 UI 一起被丢掉"
  );
});

test("bug1: 暴露一个可被外部调用的 flush 方法(Plugin.onunload 也能用)", () => {
  const tab = makeTab() as unknown as Record<string, unknown>;
  assert.equal(
    typeof tab.flushPendingSaves,
    "function",
    "需要一个 public 的 flush 方法, 让 SettingsTab 之外(例如 Plugin.onunload)也能提交待写改动"
  );
});

test("bug1: flushPendingSaves 会真的把待写 debounce 跑掉, 并且清空列表", async () => {
  const tab = makeTab();
  const pending = new FakeDebouncer();
  (tab as unknown as { activeDebouncers: FakeDebouncer[] }).activeDebouncers = [pending];
  const flush = (tab as unknown as Record<string, unknown>).flushPendingSaves as
    | (() => Promise<void>)
    | undefined;
  assert.equal(typeof flush, "function", "flushPendingSaves 必须存在");
  await (flush as () => Promise<void>).call(tab);
  assert.equal(pending.flushCount, 1, "待写改动必须被 flush 一次");
  assert.equal(pending.cancelCount, 0, "不能用 cancel —— 那正是丢改动的老行为");
  assert.deepEqual(
    (tab as unknown as { activeDebouncers: FakeDebouncer[] }).activeDebouncers,
    [],
    "flush 之后要把列表清空, 避免下一次 display()/hide() 重复写盘"
  );
});

test("bug1: 调 hide() 会 flush 待写改动(用户改完 baseUrl 直接关弹窗的场景)", async () => {
  const tab = makeTab();
  const pending = new FakeDebouncer();
  (tab as unknown as { activeDebouncers: FakeDebouncer[] }).activeDebouncers = [pending];
  tab.hide();
  // hide() 在 Obsidian 里是同步 void, 但 flush 是 async 的 —— 给它一个宏任务
  // 的时间落地, 模拟"关闭弹窗后 debounce 定时器仍然跑完"。
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pending.flushCount, 1, "hide() 必须触发一次 flush");
});

test("bug1: 没有待写改动时 flush 是 no-op, 不抛错", async () => {
  const tab = makeTab();
  (tab as unknown as { activeDebouncers: FakeDebouncer[] }).activeDebouncers = [];
  const flush = (tab as unknown as Record<string, unknown>).flushPendingSaves as
    | (() => Promise<void>)
    | undefined;
  assert.equal(typeof flush, "function", "flushPendingSaves 必须存在");
  await (flush as () => Promise<void>).call(tab);
});

// ===========================================================================
// 2. Sha1.bytesFromBufferSource 必须是 UTF-8, 不是 Latin-1
// ===========================================================================

test("bug2: 字符串按 UTF-8 编码(中文 3 字节), 不是每个 charCode 截断成 1 字节", () => {
  const out = bytesFromBufferSource("中文");
  assert.deepEqual(
    [...out],
    [...utf8("中文")],
    "U+4E2D 的 UTF-8 是 e4 b8 ad; `& 0xff` 截断只剩 2d —— 那是 Latin-1 语义"
  );
  assert.equal(out.length, 6, "两个中文字符 = 6 字节");
});

test("bug2: 只保留低 8 位会让两个不同汉字塌缩成同一个字节", () => {
  // 丁 = U+4E01, 企 = U+4F01 —— 低 8 位都是 0x01, 但 UTF-8 完全不同。
  assert.equal("丁".charCodeAt(0) & 0xff, "企".charCodeAt(0) & 0xff, "测试前提: 低 8 位确实相同");
  assert.notEqual(
    sha1Hex(bytesFromBufferSource("书库/丁.epub")),
    sha1Hex(bytesFromBufferSource("书库/企.epub")),
    "两个不同的中文书名必须算出不同的 hash, 否则 bookIdTag 会让封面文件互相覆盖"
  );
});

test("bug2: ASCII 与代理对(Emoji)的 UTF-8 编码与 TextEncoder 一致", () => {
  for (const sample of ["", "abc", "book.epub", "😀 中 A", "\u0000\u007f\u0080\u07ff\u0800\uffff"]) {
    assert.deepEqual(
      [...bytesFromBufferSource(sample)],
      [...utf8(sample)],
      `样本 ${JSON.stringify(sample)} 的编码必须和 TextEncoder 一致`
    );
  }
});

test("bug2: 注释不再声称是 Latin-1 (源码级)", () => {
  const source = read("src/platform/Sha1.ts");
  // 旧注释写着 "UTF-8 (Latin-1) encode" —— 自相矛盾, 就是在骗读代码的人。
  assert.doesNotMatch(
    source,
    /UTF-8 \(Latin-1\)/,
    "注释必须和实际行为一致, 不能一边说 UTF-8 一边说 Latin-1"
  );
});

// ===========================================================================
// 3. crypto.subtle polyfill: SHA-256 + importKey/sign/verify/exportKey
// ===========================================================================

const createFallbackSubtle = (): SubtleCrypto => {
  const factory = (polyfillsModule as unknown as Record<string, unknown>).createFallbackSubtle;
  assert.equal(
    typeof factory,
    "function",
    "polyfills 必须导出一个可测的 subtle 工厂 (老 WebView 上有道需要 SHA-256, Google 需要 importKey/sign)"
  );
  return (factory as () => SubtleCrypto)();
};

/** Google 翻译在 service-account 路径上真正用到的那几个方法。 */
const requireWebCryptoSurface = (subtle: SubtleCrypto): void => {
  for (const method of ["importKey", "sign", "verify", "exportKey"] as const) {
    assert.equal(
      typeof (subtle as unknown as Record<string, unknown>)[method],
      "function",
      `crypto.subtle.${method} 缺失 → 老 Android WebView 上选 Google 翻译必崩`
    );
  }
};

test("bug3: SHA-256 digest 结果与 WebCrypto 一致 (有道智云签名依赖它)", async () => {
  const subtle = createFallbackSubtle();
  // FIPS 180-4 / NIST "abc" 向量
  const ours = hexFromBuffer(await subtle.digest("SHA-256", utf8Buf("abc")));
  assert.equal(ours, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("bug3: SHA-256 digest 与 Node WebCrypto 逐字节一致 (长输入 / 边界长度)", async () => {
  const subtle = createFallbackSubtle();
  for (const len of [0, 1, 55, 56, 63, 64, 65, 200]) {
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) data[i] = (i * 37) & 0xff;
    const ours = new Uint8Array(await subtle.digest("SHA-256", buf(data)));
    const reference = new Uint8Array(await webcrypto.subtle.digest("SHA-256", buf(data)));
    assert.deepEqual([...ours], [...reference], `长度 ${len} 的输入必须一致`);
  }
});

test("bug3: SHA-1 digest 仍然可用 (foliate 的 EPUB CFI 依赖它)", async () => {
  const subtle = createFallbackSubtle();
  const ours = hexFromBuffer(await subtle.digest("SHA-1", utf8Buf("abc")));
  const reference = hexFromBuffer(await webcrypto.subtle.digest("SHA-1", utf8Buf("abc")));
  assert.equal(ours, reference);
});

test("bug3: 不支持的算法 throw, 而不是静默返回错误结果", async () => {
  const subtle = createFallbackSubtle();
  await assert.rejects(
    () => subtle.digest("SHA-512", utf8Buf("abc")),
    /SHA-512/,
    "静默返回一个错的 hash 比抛错危险得多 —— 签名会带着错误结果发出去"
  );
  await assert.rejects(
    () => subtle.sign({ name: "ECDSA", hash: "SHA-256" }, {} as CryptoKey, utf8Buf("x")),
    /ECDSA|not supported|不支持/i
  );
});

// Google provider 的真实调用链: importKey("pkcs8") → sign(RSASSA-PKCS1-v1_5/SHA-256)
const rsaKeyFixture = async (): Promise<{
  pkcs8: Uint8Array;
  spki: Uint8Array;
  publicKey: CryptoKey;
}> => {
  const pair = (await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await webcrypto.subtle.exportKey("spki", pair.publicKey));
  return { pkcs8, spki, publicKey: pair.publicKey };
};

test("bug3: importKey(pkcs8) + sign(RSASSA-PKCS1-v1_5) 产出的签名能被真实 WebCrypto 验签", async () => {
  const subtle = createFallbackSubtle();
  requireWebCryptoSurface(subtle);
  const { pkcs8, publicKey } = await rsaKeyFixture();
  const key = await subtle.importKey(
    "pkcs8",
    pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  assert.equal(key.type, "private");
  assert.equal(key.algorithm.name, "RSASSA-PKCS1-v1_5");

  // 就是 Google provider 在签的那串 JWT header.payload
  const signingInput = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJtZUBleGFtcGxlIn0";
  const signature = await subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    key,
    utf8Buf(signingInput)
  );
  const ok = await webcrypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    utf8Buf(signingInput)
  );
  assert.equal(ok, true, "老设备上签出来的 JWT 必须和桌面端签出来的一模一样, 否则 Google 401");
});

test("bug3: verify() 用自己的公钥验自己的签名, 被篡改的签名要返回 false", async () => {
  const subtle = createFallbackSubtle();
  requireWebCryptoSurface(subtle);
  const { pkcs8, spki } = await rsaKeyFixture();
  const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
    u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  const priv = await subtle.importKey(
    "pkcs8",
    toArrayBuffer(pkcs8),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  // 公钥从 Node 那边拿 SPKI —— 真实 WebCrypto 也不允许 exportKey("spki", 私钥),
  // 所以不能"从私钥导出公钥"来造测试数据。
  const pub = await subtle.importKey(
    "spki",
    toArrayBuffer(spki),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
  const data = utf8Buf("hello.signing.input");
  const signature = await subtle.sign({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, priv, data);
  assert.equal(
    await subtle.verify({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, pub, signature, data),
    true
  );
  const tampered = new Uint8Array(signature);
  tampered[0] ^= 0xff;
  assert.equal(
    await subtle.verify({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, pub, tampered, data),
    false,
    "验签失败必须返回 false, 不能返回 true"
  );
});

test("bug3: exportKey(pkcs8) 能把导入的私钥原样导回来", async () => {
  const subtle = createFallbackSubtle();
  requireWebCryptoSurface(subtle);
  const { pkcs8 } = await rsaKeyFixture();
  const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
    u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  const imported = await subtle.importKey(
    "pkcs8",
    toArrayBuffer(pkcs8),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"]
  );
  const roundTrip = new Uint8Array(await subtle.exportKey("pkcs8", imported));
  assert.deepEqual([...roundTrip], [...pkcs8], "导出必须是逐字节可逆的");
});

// ===========================================================================
// 4. SettingsTab 的 async onChange 必须有 .catch()
// ===========================================================================

test("bug4: 9 处 async onChange 全部走统一的安全包装, 不再有裸 async 回调", () => {
  const code = codeOnly(read("src/ui/settings/SettingsTab.ts"));
  const bare = code.match(/\.onChange\(\s*async/g) ?? [];
  assert.deepEqual(bare, [], "裸 async onChange 会产生 unhandled rejection —— 用户完全无感");
  const guarded = code.match(/this\.runSafely\(/g) ?? [];
  // codeOnly 已经剥掉注释, 所以这里数到的就是**真实调用点**: 9 处 onChange
  // 各包一层。方法定义是 `private async runSafely(`(不带 this.), 不计入。
  // (之前误按"定义 + 调用"写成 >= 10, 于是永远差一个 —— 典型的把计数写错
  // 当成代码有问题。)
  assert.equal(guarded.length, 9, `期望 9 处 onChange 各包一层 runSafely, 实际 ${guarded.length}`);
});

test("bug4: 安全包装会把异常吃掉(不产生 unhandled rejection)", async () => {
  const tab = makeTab() as unknown as {
    runSafely: (label: string, fn: () => Promise<void>) => Promise<void>;
  };
  assert.equal(typeof tab.runSafely, "function");
  // 不加 catch 的话这里会 reject → 变成 unhandled rejection。
  await tab.runSafely("保存主题", async () => {
    throw new Error("boom");
  });
});

test("bug4: https 拦截错误被翻译成可读中文, 不把英文 Error 直接怼到界面", () => {
  // 这条 message 来自 OpenAICompatibleTranslationProvider 的安全闸门。
  const raw =
    'API 基础地址必须是 https://(当前: "http://10.0.0.2/v1")。为避免 API key 明文外发, 已拒绝发送。';
  const described = describeSaveFailure(new Error(raw));
  assert.notEqual(described, raw, "不能原样透传底层 Error");
  assert.match(described, /https/, "提示里要保留 https 这个用户要改的关键信息");
  assert.match(described, /API 基础地址/, "提示要指向具体要改的设置项");
  assert.ok(!/已拒绝发送。$/.test(described), "英文技术描述不该直接出现在提示末尾");
});

test("bug4: 未知异常也能给出中文前缀 + 原始原因", () => {
  assert.match(describeSaveFailure(new Error("disk full")), /保存设置失败/);
  assert.match(describeSaveFailure(new Error("disk full")), /disk full/, "原始原因要留着, 否则没法排查");
  assert.match(describeSaveFailure("纯字符串错误"), /保存设置失败/);
});

// ===========================================================================
// 5. exportData 失败要告诉用户
// ===========================================================================

test("bug5: 导出失败时不再静默 —— exportData 自己 resolve, 而不是把异常抛出去", async () => {
  const boom = new Error("adapter.writeBinary failed");
  const store = fakeStore({
    load: async () => {
      throw boom;
    }
  });
  const tab = makeTab(store);
  assert.equal(
    typeof (tab as unknown as Record<string, unknown>).exportData,
    "function",
    "exportData 必须被 try/catch 包住"
  );
  await assert.doesNotReject(
    () => (tab as unknown as { exportData: () => Promise<void> }).exportData(),
    "点击导出按钮的 handler 是 void this.exportData(), 抛出去就是 unhandled rejection"
  );
});

test("bug5: 导出失败走的是「导出失败」提示", () => {
  const code = codeOnly(read("src/ui/settings/SettingsTab.ts"));
  assert.match(code, /new Notice\(\s*`?导出失败/, "导出失败必须有中文提示");
});

// ===========================================================================
// 6. TranslationService: in-flight 去重 + 输入长度上限
// ===========================================================================

class RecordingProvider implements TranslationProvider {
  readonly id = "youdao";
  readonly displayName = "Youdao";
  calls: TranslationRequest[] = [];
  /** 每个请求人为延迟, 让并发窗口真的重叠。 */
  constructor(private readonly delayMs = 5) {}
  async validateKey(): Promise<{ ok: true }> {
    return { ok: true };
  }
  async translate(_apiKey: string, request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(request);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { text: `[${request.text}]`, detectedSource: null, providerId: this.id };
  }
}

/**
 * `targetLocale: ""` 是刻意的 —— `TranslationCoordinator` 走
 * `settings.translation.targetLocale || target`, 空串时才会 fall back 到调用方
 * 传入的 target。测试要区分"译到 zh-CN"和"译到 en-US"两个 key, 就必须让
 * 调用方的 target 真的生效, 否则两次调用会被强行归一成同一个目标语言。
 */
const translationSettings = (targetLocale = ""): PluginSettings =>
  ({
    uiLocale: "zh-CN",
    translation: {
      providerId: "youdao",
      apiKey: "{}",
      sourceLocale: "auto",
      targetLocale
    },
    defaultAppearance: {}
  }) as unknown as PluginSettings;

const makeCoordinator = (
  provider: TranslationProvider,
  targetLocale = ""
): TranslationCoordinator =>
  new TranslationCoordinator(
    fakeStore({ listSettings: async () => translationSettings(targetLocale) }) as AnnotationStore,
    [provider]
  );

test("bug6: 同一个词的并发翻译共享一次 provider 调用 (选词菜单 + 抽屉 + PDF overlay)", async () => {
  const provider = new RecordingProvider();
  const coordinator = makeCoordinator(provider);
  const [a, b, c] = await Promise.all([
    coordinator.translate("量子纠缠", "auto", "zh-CN"),
    coordinator.translate("量子纠缠", "auto", "zh-CN"),
    coordinator.translate("量子纠缠", "auto", "zh-CN")
  ]);
  assert.equal(provider.calls.length, 1, `同一个 key 只应该打一次 API, 实际 ${provider.calls.length} 次 (烧用户配额)`);
  assert.equal(a.text, b.text);
  assert.equal(b.text, c.text);
});

test("bug6: 文本不同则不共享, 目标语言不同也不共享", async () => {
  const provider = new RecordingProvider();
  const coordinator = makeCoordinator(provider);
  await Promise.all([
    coordinator.translate("量子纠缠", "auto", "zh-CN"),
    coordinator.translate("薛定谔的猫", "auto", "zh-CN"),
    coordinator.translate("量子纠缠", "auto", "en-US")
  ]);
  assert.equal(provider.calls.length, 3, "key = 原文 + 目标语言 + provider, 不同 key 不能合并");
});

test("bug6: 请求结束后去重表清空, 之后再翻同一个词会真的重新请求", async () => {
  const provider = new RecordingProvider(1);
  const coordinator = makeCoordinator(provider);
  await coordinator.translate("熵", "auto", "zh-CN");
  await coordinator.translate("熵", "auto", "zh-CN");
  assert.equal(provider.calls.length, 2, "去重只针对 in-flight, 不能变成永久缓存");
});

test("bug6: 失败的请求不会污染去重表(重试能再打一次)", async () => {
  let attempt = 0;
  const flaky: TranslationProvider = {
    id: "youdao",
    displayName: "Youdao",
    async validateKey() {
      return { ok: true };
    },
    async translate(): Promise<TranslationResult> {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return { text: "ok", detectedSource: null, providerId: "youdao" };
    }
  };
  const coordinator = makeCoordinator(flaky);
  await assert.rejects(() => coordinator.translate("熵", "auto", "zh-CN"), /network down/);
  const ok = await coordinator.translate("熵", "auto", "zh-CN");
  assert.equal(ok.text, "ok", "失败后必须能重试, 不能一直返回同一个 rejected promise");
});

test("bug6: 超过长度上限的输入直接拒绝, 不打 API", async () => {
  const provider = new RecordingProvider();
  const coordinator = makeCoordinator(provider);
  const tooLong = "字".repeat(100_000);
  await assert.rejects(
    () => coordinator.translate(tooLong, "auto", "zh-CN"),
    (error: Error) => {
      assert.match(error.message, /上限/, "错误信息要说清是长度上限, 而不是/provider 报的错");
      assert.ok(!/[a-z]/.test(error.message) || /[一-鿿]/.test(error.message), "提示要是中文");
      return true;
    }
  );
  assert.equal(provider.calls.length, 0, "超长输入一个 token 都不该烧");
});

test("bug6: 上限之内的正常长度照常翻译", async () => {
  const provider = new RecordingProvider();
  const coordinator = makeCoordinator(provider);
  const result = await coordinator.translate("熵增定律", "auto", "zh-CN");
  assert.equal(result.text, "[熵增定律]");
  assert.equal(provider.calls.length, 1);
});

test("bug6: core 层不许 import obsidian (Notice 只能在 ui 层用)", () => {
  const source = read("src/core/services/TranslationService.ts");
  assert.doesNotMatch(codeOnly(source), /from\s+"obsidian"/, "core/ 反向依赖 adapters 是分层铁律的破坏");
  assert.doesNotMatch(codeOnly(source), /from\s+"\.\.\/\.\.\/adapters/, "core/ 不许 import adapters/");
});

// ===========================================================================
// 7. ObsidianBookSource.scan() 必须跳过元目录
// ===========================================================================

interface FakeVaultEntry {
  path: string;
}

const makeFakeFile = (path: string): TFile => {
  const file = new TFile();
  const dot = path.lastIndexOf(".");
  return Object.assign(file, {
    path,
    name: path.split("/").pop() ?? path,
    basename: (path.split("/").pop() ?? path).split(".")[0] ?? path,
    extension: dot >= 0 ? path.slice(dot + 1) : "",
    stat: { size: 1024, mtime: 1 }
  }) as TFile;
};

/**
 * 造一个假 vault: `files` 是 getFiles() 直接能看到的, `tree` 是
 * adapter.list(folder) 的返回值 (folder → { files, folders }).
 */
const makeFakeApp = (
  files: FakeVaultEntry[],
  tree: Record<string, { files: string[]; folders: string[] }>
): App => {
  const known = new Map<string, TFile>();
  for (const entry of files) known.set(entry.path, makeFakeFile(entry.path));
  // `adapter.list(folder)` 的 files[] 和 folders[] **都**是 vault 相对全路径
  // (AGENTS.md §3.2; 生产代码直接把 subFolder 塞进下一次 list() 的入参, 说明
  // Obsidian 给的确实是全路径), 所以 fixture 里全部写全路径, 不在这里拼。
  for (const listing of Object.values(tree)) {
    for (const p of listing.files) if (!known.has(p)) known.set(p, makeFakeFile(p));
  }
  return {
    vault: {
      // 只返回显式给的那些 —— 其余文件必须靠 adapter 分支才发现得到
      getFiles: () => files.map((entry) => known.get(entry.path)).filter((f): f is TFile => !!f),
      getAbstractFileByPath: (path: string) => known.get(path) ?? null,
      readBinary: async () => new ArrayBuffer(0),
      adapter: {
        list: async (folder: string) => {
          const hit = tree[folder];
          if (!hit) return { files: [], folders: [] };
          return { files: hit.files, folders: hit.folders };
        }
      },
      on: () => ({}),
      offref: () => undefined
    }
  } as unknown as App;
};

const scanAll = async (app: App, formats: BookFormat[] = ["pdf"]): Promise<string[]> => {
  const source = new ObsidianBookSource(app);
  const out: string[] = [];
  for await (const locator of source.scan(new Set<BookFormat>(formats))) {
    out.push(locator.path);
  }
  return out;
};
test("bug7: scan() 不返回 .trash/ 里用户已经删掉的书", async () => {
  const app = makeFakeApp([{ path: "books/地震学导论.pdf" }, { path: ".trash/books/地震学导论.pdf" }], {
    ".trash": { files: [".trash/books/地震学导论.pdf"], folders: [".trash/books"] },
    ".trash/books": { files: [".trash/books/地震学导论.pdf"], folders: [] },
    books: { files: ["books/地震学导论.pdf"], folders: [] }
  });
  const found = await scanAll(app);
  assert.deepEqual(found, ["books/地震学导论.pdf"], `.trash/ 里的书必须被跳过, 实际扫到 ${JSON.stringify(found)}`);
});

test("bug7: scan() 不返回 .obsidian/ 里的插件缓存/数据文件", async () => {
  const app = makeFakeApp(
    [{ path: "books/a.pdf" }, { path: ".obsidian/plugins/ez-reader/data/covers/b.pdf" }],
    {
      ".obsidian": { files: [], folders: [".obsidian/plugins"] },
      ".obsidian/plugins": { files: [], folders: [".obsidian/plugins/ez-reader"] },
      ".obsidian/plugins/ez-reader": { files: [], folders: [".obsidian/plugins/ez-reader/data"] },
      ".obsidian/plugins/ez-reader/data": { files: [], folders: [".obsidian/plugins/ez-reader/data/covers"] },
      ".obsidian/plugins/ez-reader/data/covers": { files: [".obsidian/plugins/ez-reader/data/covers/b.pdf"], folders: [] },
      books: { files: ["books/a.pdf"], folders: [] }
    }
  );
  const found = await scanAll(app);
  assert.deepEqual(found, ["books/a.pdf"]);
});

test("bug7: Syncthing 冲突副本目录也被跳过", async () => {
  const app = makeFakeApp([{ path: "books/a.pdf" }, { path: ".stversions/books/a.sync-conflict-20240101.pdf" }], {
    ".stversions": { files: [".stversions/books/a.sync-conflict-20240101.pdf"], folders: [] },
    books: { files: ["books/a.pdf"], folders: [] }
  });
  const found = await scanAll(app);
  assert.deepEqual(found, ["books/a.pdf"]);
});

test("bug7: adapter fallback 分支也跳过元目录 (getFiles() 没加载到的那些)", async () => {
  const app = makeFakeApp([], {
    "": { files: [], folders: [".obsidian", ".trash", "books"] },
    ".obsidian": { files: [".obsidian/x.pdf"], folders: [] },
    ".trash": { files: [".trash/y.pdf"], folders: [] },
    books: { files: ["books/z.pdf"], folders: [] }
  });
  const found = await scanAll(app);
  assert.deepEqual(found, ["books/z.pdf"]);
});

test("bug7: 只有一个顶层目录的 vault 不被误伤", async () => {
  // 用户把书全放在 `我的书库/04-resources/books/` 下, 不能因为"里面有很多层"就跳过。
  const app = makeFakeApp([], {
    "": { files: [], folders: ["我的书库"] },
    "我的书库": { files: [], folders: ["我的书库/04-resources"] },
    "我的书库/04-resources": { files: [], folders: ["我的书库/04-resources/books"] },
    "我的书库/04-resources/books": { files: ["我的书库/04-resources/books/深入理解计算机系统.pdf"], folders: [] }
  });
  const found = await scanAll(app);
  assert.deepEqual(found, ["我的书库/04-resources/books/深入理解计算机系统.pdf"]);
});

test("bug7: 根目录里名字像 .trash 的书不会被误伤", async () => {
  const app = makeFakeApp(
    [{ path: "trash.pdf" }, { path: ".hidden-notes.pdf" }],
    {}
  );
  const found = await scanAll(app);
  assert.deepEqual(
    found.sort(),
    [".hidden-notes.pdf", "trash.pdf"].sort(),
    "只按目录段名跳过, 不能按文件名前缀跳过"
  );
});

test("bug7: 导出的是一个可复用的纯函数 (源码级)", () => {
  const code = codeOnly(read("src/adapters/obsidian/ObsidianBookSource.ts"));
  assert.match(code, /IGNORED_VAULT_DIRS/, "跳过规则要是一个具名常量, 方便调用方和测试复用");
});
