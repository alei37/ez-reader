/**
 * 测试用的"剥掉注释"helper。
 *
 * 为什么需要:本项目的源码注释里**故意**引用了它替换掉的旧代码
 * (比如 `resolveId(locator) => locator.path`、`bookId.slice(0, 8)`、
 * `replace(/[^A-Za-z0-9._-]/g, "_")`)。源码级断言如果直接 `includes()`,
 * 就会去匹配注释里的那句话, 测试退化成"注释里有没有这句话"的检查,
 * 真正的代码删了它照样绿 —— 这是最糟的一类假绿。
 *
 * 为什么不能用正则:
 * 之前各测试文件里各自复制的版本是
 *   `source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")`
 * 它有一个真实的 bug —— 顺序反了。行注释里含有块注释起始符的那种行
 * (本项目里就有, 形如 `sessions/<star>.jsonl 从没写过` 的路径举例),
 * 会被块注释正则当成块注释开头, 一路吞到文件里下一个闭合符为止,
 * 中间**所有真实代码一起消失**。实测把 `src/Plugin.ts` 从 32498 字符
 * 砍到 19250 字符, 整整 `onunload` / `registerView` 两个方法连同中间
 * 所有代码被吃掉, 而测试还是绿的。
 *
 * (顺带一提: 上面这段说明自己也踩过同一个坑 —— 在 JSDoc 里直接写
 *  `*&#47;jsonl` 会提前闭合注释, esbuild 报 `Expected ";" but found "src"`。
 *  写注释时提到注释符号本身必须转义或拆词。)
 *
 * 所以这里手写一个单趟扫描器: 只在"不在字符串里"的前提下识别注释起始符。
 * 行注释 / 块注释直接跳过 (块注释里的换行保留, 保证行号对齐); 引号里的
 * 内容原样保留 —— 断言经常需要看字符串字面量。
 *
 * 已知局限: 不识别正则字面量。含 `"` 的正则 (例如 `/"/`) 会被误判成
 * 字符串起始。本项目源码里没有这种正则, 真出现了再加。
 */

export const codeOnly = (source: string): string => {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i] as string;
    const d = source[i + 1];
    // 行注释: 跳到行尾 (换行符留给下一轮输出, 行结构因此不变)
    if (c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    // 块注释: 跳到闭合的 */, 但把里面的换行吐出来, 免得后面的行号偏移
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    // 字符串 / 模板字面量: 原样保留, 内部不再解释注释符号
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < n) {
        const ch = source[i] as string;
        if (ch === "\\") {
          out += ch + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
        if (ch === c) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
};
