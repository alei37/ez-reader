/**
 * v0.3.3: 测试环境用到的第三方模块的最小类型声明。
 *
 * 为什么手写而不是装 `@types/jsdom`:那会给插件项目新增一个 devDependency,
 * 而我们只用 `new JSDOM(html)` 和 `dom.window` 两个东西。为两个 API 拉一个
 * 类型包不值, 而且版本一漂就可能跟 esbuild 实际 bundle 的版本对不上。
 *
 * 声明越松, 这份文件越没用 —— 所以这里刻意只声明"我们真的用到的形状",
 * 让 `window.document` 之类仍然带着 DOM 类型 (而不是塌成 any),
 * 这样 jsdom 环境里的测试仍能获得基本的类型检查。
 *
 * 注: `tests/stubs/obsidian-stub.mjs` 的类型**不**在这里声明 ——
 * TypeScript 不支持在 `declare module` 里写相对路径, 那样写了也不生效。
 * 改用 `tsconfig.test.json` 里的 `allowJs`, 让 tsc 自己从 .mjs 推断导出。
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        url?: string;
        pretendToBeVisual?: boolean;
        runScripts?: "dangerously" | "outside-only";
      }
    );
    readonly window: Window & typeof globalThis & { close(): void };
  }
}
