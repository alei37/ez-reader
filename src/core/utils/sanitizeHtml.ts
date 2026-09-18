/**
 * Strip dangerous content from an HTML string before we feed it to
 * `innerHTML`. MOBI/AZW3 books can come from anywhere — a friend, a
 * random download, an unvetted Calibre mirror — so we treat the parser's
 * output as untrusted and apply the same baseline sanitization here that
 * a browser would do for a `srcdoc` iframe.
 *
 * What we strip:
 *   - Whole elements (including their text content): `<script>`,
 *     `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`,
 *     `<form>`, `<input>`, `<button>`, `<svg>`, `<math>`. Even if the
 *     parser doesn't emit them, an adversarial mobi container might
 *     inject one — and the JS payload hidden inside `<script>text</script>`
 *     must not survive just because we dropped the tag wrapper.
 *   - Event handler attributes (`on*`) — these execute JS on DOM events.
 *   - `javascript:` and `data:text/html` URLs in `href` / `src` /
 *     `xlink:href` — classic XSS vectors via anchor and image.
 *
 * What we keep (intentionally permissive — mobi text needs it):
 *   - Structural tags: p, br, div, span, h1-h6, blockquote, ul, ol, li
 *   - Inline formatting: b, i, em, strong, u, sub, sup, code, pre
 *   - Links and images (with safe URL check). Anchors with a non-fragment
 *     href have it renamed to `data-ez-reader-href` and the `href` stripped
 *     so the browser doesn't navigate to an external URL on click — the
 *     reader will intercept the click via its own handler and resolve
 *     intra-book links to spine / page offsets.
 *   - Tables: table, thead, tbody, tr, th, td
 *   - Custom class / id / style attributes — mobi CSS classes are how
 *     chapters look right; stripping them would flatten the visual
 *     hierarchy. We only strip the genuinely dangerous stuff.
 *
 * This is intentionally NOT a full HTML5 sanitiser (that would mean
 * pulling in DOMPurify or implementing the spec). For a reader that
 * already constrains user input to "books they imported", the above
 * covers the real attack surface. EPUB is rendered in a sandboxed
 * iframe with its own CSP, so it never hits this path.
 *
 * Pure string-in/string-out — no DOM, no obsidian imports — so unit
 * tests can lock down behaviour.
 */
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "svg",
  "math",
  "base",
  "frame",
  "frameset"
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href", "formaction", "action"]);

const isDangerousUrl = (raw: string): boolean => {
  // Normalize: strip control chars + leading whitespace + lowercase,
  // because browsers ignore leading whitespace and case in the scheme.
  const normalized = raw.replace(/[\u0000-\u001F\u007F]+/g, "").trim().toLowerCase();
  if (normalized.startsWith("javascript:")) return true;
  if (normalized.startsWith("data:text/html")) return true;
  if (normalized.startsWith("vbscript:")) return true;
  return false;
};

interface Segment {
  readonly kind: "text" | "tag";
  readonly value: string;
}

/**
 * Segment the input into "tag-like" and "text" pieces. A "tag-like"
 * piece runs from one `<` to the next `>` (skipping quotes inside
 * attributes). Anything between is text.
 *
 * We deliberately do NOT validate tag syntax here — `<` that doesn't
 * resolve to a real tag is treated as text. Otherwise an attacker could
 * confuse the parser by sending malformed markup.
 */
const segmentize = (input: string): Segment[] => {
  const out: Segment[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] !== "<") {
      // Accumulate text up to next `<` or EOF.
      const next = input.indexOf("<", i);
      const end = next === -1 ? input.length : next;
      out.push({ kind: "text", value: input.slice(i, end) });
      i = end;
      continue;
    }
    // We're at `<`. Find the matching `>` (or end-of-input).
    const end = findTagEnd(input, i);
    if (end === -1) {
      // Unterminated `<` — treat the rest as text. We escape it on output.
      out.push({ kind: "text", value: input.slice(i) });
      i = input.length;
      continue;
    }
    out.push({ kind: "tag", value: input.slice(i, end + 1) });
    i = end + 1;
  }
  return out;
};

/** Locate the closing `>` for a tag, honouring quoted attribute values.
 *  Returns -1 if no closing `>` exists (unterminated tag). */
const findTagEnd = (input: string, start: number): number => {
  let inQuote: string | null = null;
  for (let i = start + 1; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
};

/** Extract the tag name and attribute string from `<tag attrs>` or `</tag>`. */
const parseTag = (
  raw: string
): { name: string; attrs: string; isClosing: boolean; isComment: boolean; isDoctype: boolean } | null => {
  // Strip the angle brackets.
  const inner = raw.slice(1, -1);
  if (inner.startsWith("!--")) return { name: "", attrs: "", isClosing: false, isComment: true, isDoctype: false };
  if (inner.startsWith("!DOCTYPE") || inner.startsWith("!doctype")) {
    return { name: "", attrs: "", isClosing: false, isComment: false, isDoctype: true };
  }
  const isClosing = inner.startsWith("/");
  const body = isClosing ? inner.slice(1) : inner;
  // Match `name` then optional whitespace + attrs.
  const m = /^([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/.exec(body);
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), attrs: m[2] ?? "", isClosing, isComment: false, isDoctype: false };
};

const sanitizeAttrs = (rawAttrs: string): string | null => {
  // Match one attribute at a time: `name`, `name="value"`, `name='value'`,
  // or boolean attribute (`name` alone). Unquoted values are rejected
  // outright — they almost always indicate malformed/hostile markup.
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'))?/g;
  let result = "";
  let cursor = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(rawAttrs)) !== null) {
    matched = true;
    if (m.index !== cursor) {
      // Skip whitespace between attributes; reject anything else.
      const gap = rawAttrs.slice(cursor, m.index);
      if (/\S/.test(gap)) return null;
    }
    cursor = m.index + m[0].length;
    const name = m[1]!.toLowerCase();
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    if (name.startsWith("on")) {
      // Event handler — drop the attribute, keep the tag.
      continue;
    }
    if (URL_ATTRS.has(name) && isDangerousUrl(value)) {
      // javascript: / data:text/html URL — drop the attribute.
      continue;
    }
    // Re-emit with double quotes. We escape `&` and `"` in the value
    // so a malicious value can't break out of the attribute.
    const safeValue = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    // P1 polish: <a href="..."> rewrites. MOBI chapters use href to point
    // at other chapters / anchors (intra-book links). Browser default
    // would navigate away from the reader; we strip href and stash the
    // value on data-ez-reader-href so the reader can intercept clicks
    // and resolve them via the book's spine. Same for src on img if it's
    // a non-fragment URL — but for simplicity we keep img src as-is since
    // images have no click handler that would navigate.
    if (name === "href" && !value.startsWith("#") && !isDangerousUrl(value)) {
      // Treat as intra-book link target. Stash on data-* attribute.
      result += ` data-ez-reader-href="${safeValue}"`;
      continue;
    }
    result += ` ${name}="${safeValue}"`;
  }
  return result;
};

const escapeText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const sanitizeHtml = (input: string): string => {
  if (!input) return "";
  const segments = segmentize(input);
  let output = "";
  let skipUntil: string | null = null;
  for (const seg of segments) {
    if (skipUntil) {
      if (seg.kind === "tag") {
        const parsed = parseTag(seg.value);
        if (parsed && parsed.isClosing && parsed.name === skipUntil) {
          skipUntil = null;
        }
      }
      continue;
    }
    if (seg.kind === "text") {
      output += escapeText(seg.value);
      continue;
    }
    const parsed = parseTag(seg.value);
    if (!parsed) {
      // Malformed tag (e.g. `<` with no name, or `<` followed by a digit,
      // or unterminated markup). Browsers parse it as text; we do the
      // same by feeding it back through escapeText so any embedded `<`
      // stays as a literal character rather than disappearing silently.
      output += escapeText(seg.value);
      continue;
    }
    if (parsed.isComment || parsed.isDoctype) continue;
    if (DANGEROUS_TAGS.has(parsed.name)) {
      if (!parsed.isClosing) {
        // Drop the open tag AND everything until the matching close tag.
        skipUntil = parsed.name;
      }
      // Closing tags of dangerous elements while NOT inside a skip
      // window are orphans — drop them silently.
      continue;
    }
    if (parsed.isClosing) {
      output += `</${parsed.name}>`;
      continue;
    }
    const cleanedAttrs = sanitizeAttrs(parsed.attrs);
    if (cleanedAttrs === null) {
      // Malformed / unquoted attributes — drop the tag entirely.
      continue;
    }
    output += `<${parsed.name}${cleanedAttrs}>`;
  }
  return output;
};
