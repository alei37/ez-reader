import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml } from "../../src/core/utils/sanitizeHtml";

/**
 * Locks the XSS defense for the MOBI/AZW3 reader path. The mobi parser
 * hands us HTML strings that PagedTextSession injects via innerHTML;
 * sanitizeHtml is the only barrier between an attacker-controlled mobi
 * file and arbitrary script execution in the Obsidian renderer.
 *
 * Whenever you tweak the sanitizer, add a test here describing what
 * must keep working / what must keep being blocked.
 */

test("sanitizeHtml: passes through structural tags", () => {
  const input = '<p class="intro">Hello <strong>world</strong></p>';
  const out = sanitizeHtml(input);
  assert.match(out, /<p\s+class="intro">/);
  assert.match(out, /Hello/);
  assert.match(out, /<strong>world<\/strong>/);
});

test("sanitizeHtml: drops script tags entirely", () => {
  const input = '<p>before</p><script>alert(1)</script><p>after</p>';
  const out = sanitizeHtml(input);
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /alert\(1\)/);
  assert.match(out, /<p>before<\/p>/);
  assert.match(out, /<p>after<\/p>/);
});

test("sanitizeHtml: drops iframe / object / embed", () => {
  const input = '<iframe src="evil.html"></iframe><object data="x"></object><embed src="y">';
  const out = sanitizeHtml(input);
  assert.doesNotMatch(out, /<iframe/i);
  assert.doesNotMatch(out, /<object/i);
  assert.doesNotMatch(out, /<embed/i);
});

test("sanitizeHtml: strips on* event handler attributes", () => {
  const cases = [
    '<img src="x.png" onerror="alert(1)">',
    '<a href="#" onclick="alert(2)">click</a>',
    '<svg onload="alert(3)"></svg>',
    '<body onload="alert(4)">',
    '<p onmouseover="alert(5)">text</p>'
  ];
  for (const input of cases) {
    const out = sanitizeHtml(input);
    assert.doesNotMatch(out, /\bon\w+\s*=/i, `event handler leaked through: ${out}`);
  }
});

test("sanitizeHtml: blocks javascript: URLs in href/src", () => {
  const cases = [
    '<a href="javascript:alert(1)">click</a>',
    '<a href="JAVASCRIPT:alert(2)">click</a>',
    '<a href="  javascript:alert(3)">click</a>',
    '<img src="JaVaScRiPt:alert(4)">',
    '<iframe src="javascript:alert(5)"></iframe>',
    '<a href="data:text/html,<script>alert(6)</script>">click</a>'
  ];
  for (const input of cases) {
    const out = sanitizeHtml(input);
    assert.doesNotMatch(out, /javascript:/i, `js URL leaked: ${out}`);
    assert.doesNotMatch(out, /data:text\/html/i, `data URL leaked: ${out}`);
  }
});

test("sanitizeHtml: strips remote http(s) URLs but keeps relative ones", () => {
  // P0 fix: this used to assert that `https://` survives. Book content is
  // untrusted and the reader has no use for a remote reference, so keeping
  // one was a silent outbound request — a beacon leaking the user's IP and
  // the fact that they are reading a given book, contradicting
  // PRIVACY.md's "EzReader never transmits" claim. Link text and the
  // relative image are preserved; only the fetching URL is dropped.
  const input = '<a href="https://example.com/foo">ok</a><img src="/relative.png">';
  const out = sanitizeHtml(input);
  assert.doesNotMatch(out, /https:\/\/example\.com/, "remote URL must not survive");
  assert.match(out, />ok<\/a>/, "link text is preserved");
  assert.match(out, /src="\/relative\.png"/, "relative URLs are not requests");
});

test("sanitizeHtml: keeps inline data:image but drops data:image/svg+xml", () => {
  // MOBI cover art legitimately arrives as an inline data URL. SVG is
  // excluded because it can carry script.
  assert.match(sanitizeHtml('<img src="data:image/png;base64,iVBOR">'), /data:image\/png/);
  assert.doesNotMatch(sanitizeHtml('<img src="data:image/svg+xml;base64,AAA">'), /svg\+xml/);
});

test("sanitizeHtml: srcset / ping / background cannot beacon", () => {
  // These three fetched without a click and were missing from URL_ATTRS
  // entirely, so they bypassed the check before the fix.
  assert.doesNotMatch(sanitizeHtml('<img srcset="https://attacker.example/b?1 1x">'), /attacker/);
  assert.doesNotMatch(sanitizeHtml('<a href="#x" ping="https://attacker.example/t">x</a>'), /attacker/);
  assert.doesNotMatch(sanitizeHtml('<div background="https://attacker.example/bg.png">x</div>'), /attacker/);
});

test("sanitizeHtml: srcset checks every candidate, not just the first", () => {
  // A mixed list would smuggle a remote candidate past a first-only check.
  assert.doesNotMatch(sanitizeHtml('<img srcset="a.png 1x, https://attacker.example/x.png 2x">'), /attacker/);
  // ...while an all-relative list is legitimate and must survive.
  assert.match(sanitizeHtml('<img srcset="a.png 1x, b.png 2x">'), /a\.png 1x/);
});

test("sanitizeHtml: scheme detection is not fooled by control characters", () => {
  // Browsers strip control chars before resolving the scheme.
  assert.doesNotMatch(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>'), /href=/);
  assert.doesNotMatch(sanitizeHtml('<img src="  https://attacker.example/x">'), /attacker/);
});

test("sanitizeHtml: drops malformed / unquoted attribute tags", () => {
  // Real book HTML always quotes attribute values; tags with bare
  // attributes are suspicious and we drop them outright.
  const input = '<p onclick=alert(1) class="ok">text</p>';
  const out = sanitizeHtml(input);
  assert.doesNotMatch(out, /<p[^>]*onclick/i);
});

test("sanitizeHtml: drops style tag (CSS injection vector)", () => {
  const input = '<style>body{background:url("javascript:alert(1)")}</style><p>after</p>';
  const out = sanitizeHtml(input);
  assert.doesNotMatch(out, /<style/i);
  assert.doesNotMatch(out, /javascript:/i);
  assert.match(out, /<p>after<\/p>/);
});

test("sanitizeHtml: preserves legitimate tables and formatting", () => {
  const input = '<table><tr><td><em>cell</em></td></tr></table>';
  const out = sanitizeHtml(input);
  assert.match(out, /<table>/);
  assert.match(out, /<td>/);
  assert.match(out, /<em>cell<\/em>/);
});

test("sanitizeHtml: handles empty / whitespace input", () => {
  assert.equal(sanitizeHtml(""), "");
  assert.equal(sanitizeHtml("   "), "   ");
});

test("sanitizeHtml: text content is escaped if it contains raw '<'", () => {
  // If a text node has a `<`, we don't want a later parser pass to treat
  // it as a tag. (Browsers don't re-parse text content, but defense in
  // depth.)
  const input = "5 < 10 and 10 > 5";
  const out = sanitizeHtml(input);
  assert.match(out, /5 &lt; 10/);
});

test("sanitizeHtml: drops comments and doctype", () => {
  const input = '<!-- secret --><p>visible</p><!DOCTYPE html><p>after</p>';
  const out = sanitizeHtml(input);
  assert.doesNotMatch(out, /<!--/);
  assert.doesNotMatch(out, /<!doctype/i);
  assert.match(out, /<p>visible<\/p>/);
  assert.match(out, /<p>after<\/p>/);
});

test("sanitizeHtml: <a href> is renamed to data-ez-reader-href (P1 polish)", () => {
  // MOBI chapters use <a href="chapter2.xhtml"> for cross-refs. Without
  // rewriting, browser default navigates away from the reader. With the
  // rewrite, href is gone, the original is on data-ez-reader-href, and the
  // reader intercepts clicks via its own handler.
  const out = sanitizeHtml('<p><a href="chapter02.xhtml#section-1">see chapter 2</a></p>');
  // Match ` href="` exactly (with leading space) — distinguishes from
  // `data-ez-reader-href="` which also contains `href="`.
  assert.doesNotMatch(out, / href="chapter02/);
  assert.match(out, /data-ez-reader-href="chapter02\.xhtml#section-1"/);
  assert.match(out, /see chapter 2/);
});

test("sanitizeHtml: <a href> with javascript: drops href but still keeps link text", () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(out, /href/);
  assert.match(out, /click/);
});

test("sanitizeHtml: <a href> with fragment keeps #href (intra-document anchor)", () => {
  // Fragment-only links are page-internal; we keep them as href so the
  // browser handles in-page jumps natively. (We don't currently wire up
  // scroll-to for these, but at least the href remains usable.)
  const out = sanitizeHtml('<a href="#footnote-1">see footnote</a>');
  assert.match(out, /href="#footnote-1"/);
});

test("sanitizeHtml: <a> without href is unchanged", () => {
  const out = sanitizeHtml("<a>plain anchor</a>");
  assert.match(out, /<a>plain anchor<\/a>/);
});
