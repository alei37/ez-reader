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

test("sanitizeHtml: allows safe http(s) URLs", () => {
  const input = '<a href="https://example.com/foo">ok</a><img src="/relative.png">';
  const out = sanitizeHtml(input);
  assert.match(out, /href="https:\/\/example\.com\/foo"/);
  assert.match(out, /src="\/relative\.png"/);
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
