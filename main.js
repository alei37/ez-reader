"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/epubcfi.js
var findIndices, splitAt, concatArrays, isNumber, isCFI, escapeCFI, wrap, unwrap, lift, joinIndir, tokenizer, findTokens, parser, parserIndir, parse, partToString, toInnerString, toString, collapse, buildRange, isTextNode, isElementNode, getChildNodes, indexChildNodes, partsToNode, nodeToParts, fromRange, toRange, fromElements, toElement, fake;
var init_epubcfi = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/epubcfi.js"() {
    findIndices = (arr, f3) => arr.map((x3, i3, a3) => f3(x3, i3, a3) ? i3 : null).filter((x3) => x3 != null);
    splitAt = (arr, is) => [-1, ...is, arr.length].reduce(({ xs, a: a3 }, b3) => ({ xs: xs?.concat([arr.slice(a3 + 1, b3)]) ?? [], a: b3 }), {}).xs;
    concatArrays = (a3, b3) => a3.slice(0, -1).concat([a3[a3.length - 1].concat(b3[0])]).concat(b3.slice(1));
    isNumber = /\d/;
    isCFI = /^epubcfi\((.*)\)$/;
    escapeCFI = (str) => str.replace(/[\^[\](),;=]/g, "^$&");
    wrap = (x3) => isCFI.test(x3) ? x3 : `epubcfi(${x3})`;
    unwrap = (x3) => x3.match(isCFI)?.[1] ?? x3;
    lift = (f3) => (...xs) => `epubcfi(${f3(...xs.map((x3) => x3.match(isCFI)?.[1] ?? x3))})`;
    joinIndir = lift((...xs) => xs.join("!"));
    tokenizer = (str) => {
      const tokens = [];
      let state, escape, value = "";
      const push = (x3) => (tokens.push(x3), state = null, value = "");
      const cat = (x3) => (value += x3, escape = false);
      for (const char of Array.from(str.trim()).concat("")) {
        if (char === "^" && !escape) {
          escape = true;
          continue;
        }
        if (state === "!") push(["!"]);
        else if (state === ",") push([","]);
        else if (state === "/" || state === ":") {
          if (isNumber.test(char)) {
            cat(char);
            continue;
          } else push([state, parseInt(value)]);
        } else if (state === "~") {
          if (isNumber.test(char) || char === ".") {
            cat(char);
            continue;
          } else push(["~", parseFloat(value)]);
        } else if (state === "@") {
          if (char === ":") {
            push(["@", parseFloat(value)]);
            state = "@";
            continue;
          }
          if (isNumber.test(char) || char === ".") {
            cat(char);
            continue;
          } else push(["@", parseFloat(value)]);
        } else if (state === "[") {
          if (char === ";" && !escape) {
            push(["[", value]);
            state = ";";
          } else if (char === "," && !escape) {
            push(["[", value]);
            state = "[";
          } else if (char === "]" && !escape) push(["[", value]);
          else cat(char);
          continue;
        } else if (state?.startsWith(";")) {
          if (char === "=" && !escape) {
            state = `;${value}`;
            value = "";
          } else if (char === ";" && !escape) {
            push([state, value]);
            state = ";";
          } else if (char === "]" && !escape) push([state, value]);
          else cat(char);
          continue;
        }
        if (char === "/" || char === ":" || char === "~" || char === "@" || char === "[" || char === "!" || char === ",") state = char;
      }
      return tokens;
    };
    findTokens = (tokens, x3) => findIndices(tokens, ([t3]) => t3 === x3);
    parser = (tokens) => {
      const parts = [];
      let state;
      for (const [type, val] of tokens) {
        if (type === "/") parts.push({ index: val });
        else {
          const last = parts[parts.length - 1];
          if (type === ":") last.offset = val;
          else if (type === "~") last.temporal = val;
          else if (type === "@") last.spatial = (last.spatial ?? []).concat(val);
          else if (type === ";s") last.side = val;
          else if (type === "[") {
            if (state === "/" && val) last.id = val;
            else {
              last.text = (last.text ?? []).concat(val);
              continue;
            }
          }
        }
        state = type;
      }
      return parts;
    };
    parserIndir = (tokens) => splitAt(tokens, findTokens(tokens, "!")).map(parser);
    parse = (cfi) => {
      const tokens = tokenizer(unwrap(cfi));
      const commas = findTokens(tokens, ",");
      if (!commas.length) return parserIndir(tokens);
      const [parent, start, end] = splitAt(tokens, commas).map(parserIndir);
      return { parent, start, end };
    };
    partToString = ({ index, id, offset, temporal, spatial, text, side }) => {
      const param = side ? `;s=${side}` : "";
      return `/${index}` + (id ? `[${escapeCFI(id)}${param}]` : "") + (offset != null && index % 2 ? `:${offset}` : "") + (temporal ? `~${temporal}` : "") + (spatial ? `@${spatial.join(":")}` : "") + (text || !id && side ? "[" + (text?.map(escapeCFI)?.join(",") ?? "") + param + "]" : "");
    };
    toInnerString = (parsed) => parsed.parent ? [parsed.parent, parsed.start, parsed.end].map(toInnerString).join(",") : parsed.map((parts) => parts.map(partToString).join("")).join("!");
    toString = (parsed) => wrap(toInnerString(parsed));
    collapse = (x3, toEnd) => typeof x3 === "string" ? toString(collapse(parse(x3), toEnd)) : x3.parent ? concatArrays(x3.parent, x3[toEnd ? "end" : "start"]) : x3;
    buildRange = (from, to) => {
      if (typeof from === "string") from = parse(from);
      if (typeof to === "string") to = parse(to);
      from = collapse(from);
      to = collapse(to, true);
      const localFrom = from[from.length - 1], localTo = to[to.length - 1];
      const localParent = [], localStart = [], localEnd = [];
      let pushToParent = true;
      const len = Math.max(localFrom.length, localTo.length);
      for (let i3 = 0; i3 < len; i3++) {
        const a3 = localFrom[i3], b3 = localTo[i3];
        pushToParent &&= a3?.index === b3?.index && !a3?.offset && !b3?.offset;
        if (pushToParent) localParent.push(a3);
        else {
          if (a3) localStart.push(a3);
          if (b3) localEnd.push(b3);
        }
      }
      const parent = from.slice(0, -1).concat([localParent]);
      return toString({ parent, start: [localStart], end: [localEnd] });
    };
    isTextNode = ({ nodeType }) => nodeType === 3 || nodeType === 4;
    isElementNode = ({ nodeType }) => nodeType === 1;
    getChildNodes = (node, filter3) => {
      const nodes = Array.from(node.childNodes).filter((node2) => isTextNode(node2) || isElementNode(node2));
      return filter3 ? nodes.map((node2) => {
        const accept = filter3(node2);
        if (accept === NodeFilter.FILTER_REJECT) return null;
        else if (accept === NodeFilter.FILTER_SKIP) return getChildNodes(node2, filter3);
        else return node2;
      }).flat().filter((x3) => x3) : nodes;
    };
    indexChildNodes = (node, filter3) => {
      const nodes = getChildNodes(node, filter3).reduce((arr, node2) => {
        let last = arr[arr.length - 1];
        if (!last) arr.push(node2);
        else if (isTextNode(node2)) {
          if (Array.isArray(last)) last.push(node2);
          else if (isTextNode(last)) arr[arr.length - 1] = [last, node2];
          else arr.push(node2);
        } else {
          if (isElementNode(last)) arr.push(null, node2);
          else arr.push(node2);
        }
        return arr;
      }, []);
      if (isElementNode(nodes[0])) nodes.unshift("first");
      if (isElementNode(nodes[nodes.length - 1])) nodes.push("last");
      nodes.unshift("before");
      nodes.push("after");
      return nodes;
    };
    partsToNode = (node, parts, filter3) => {
      const { id } = parts[parts.length - 1];
      if (id) {
        const el = node.ownerDocument.getElementById(id);
        if (el) return { node: el, offset: 0 };
      }
      for (const { index } of parts) {
        const newNode = node ? indexChildNodes(node, filter3)[index] : null;
        if (newNode === "first") return { node: node.firstChild ?? node };
        if (newNode === "last") return { node: node.lastChild ?? node };
        if (newNode === "before") return { node, before: true };
        if (newNode === "after") return { node, after: true };
        node = newNode;
      }
      const { offset } = parts[parts.length - 1];
      if (!Array.isArray(node)) return { node, offset };
      let sum = 0;
      for (const n3 of node) {
        const { length } = n3.nodeValue;
        if (sum + length >= offset) return { node: n3, offset: offset - sum };
        sum += length;
      }
    };
    nodeToParts = (node, offset, filter3) => {
      const { parentNode, id } = node;
      const indexed = indexChildNodes(parentNode, filter3);
      const index = indexed.findIndex((x3) => Array.isArray(x3) ? x3.some((x4) => x4 === node) : x3 === node);
      const chunk = indexed[index];
      if (Array.isArray(chunk)) {
        let sum = 0;
        for (const x3 of chunk) {
          if (x3 === node) {
            sum += offset;
            break;
          } else sum += x3.nodeValue.length;
        }
        offset = sum;
      }
      const part = { id, index, offset };
      return (parentNode !== node.ownerDocument.documentElement ? nodeToParts(parentNode, null, filter3).concat(part) : [part]).filter((x3) => x3.index !== -1);
    };
    fromRange = (range, filter3) => {
      const { startContainer, startOffset, endContainer, endOffset } = range;
      const start = nodeToParts(startContainer, startOffset, filter3);
      if (range.collapsed) return toString([start]);
      const end = nodeToParts(endContainer, endOffset, filter3);
      return buildRange([start], [end]);
    };
    toRange = (doc, parts, filter3) => {
      const startParts = collapse(parts);
      const endParts = collapse(parts, true);
      const root = doc.documentElement;
      const start = partsToNode(root, startParts[0], filter3);
      const end = partsToNode(root, endParts[0], filter3);
      const range = doc.createRange();
      if (start.before) range.setStartBefore(start.node);
      else if (start.after) range.setStartAfter(start.node);
      else range.setStart(start.node, start.offset);
      if (end.before) range.setEndBefore(end.node);
      else if (end.after) range.setEndAfter(end.node);
      else range.setEnd(end.node, end.offset);
      return range;
    };
    fromElements = (elements) => {
      const results = [];
      const { parentNode } = elements[0];
      const parts = nodeToParts(parentNode);
      for (const [index, node] of indexChildNodes(parentNode).entries()) {
        const el = elements[results.length];
        if (node === el)
          results.push(toString([parts.concat({ id: el.id, index })]));
      }
      return results;
    };
    toElement = (doc, parts) => partsToNode(doc.documentElement, collapse(parts)).node;
    fake = {
      fromIndex: (index) => wrap(`/6/${(index + 1) * 2}`),
      toIndex: (parts) => parts?.at(-1).index / 2 - 1
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/progress.js
var assignIDs, flatten, TOCProgress, SectionProgress;
var init_progress = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/progress.js"() {
    assignIDs = (toc) => {
      let id = 0;
      const assignID = (item) => {
        item.id = id++;
        if (item.subitems) for (const subitem of item.subitems) assignID(subitem);
      };
      for (const item of toc) assignID(item);
      return toc;
    };
    flatten = (items) => items.map((item) => item.subitems?.length ? [item, flatten(item.subitems)].flat() : item).flat();
    TOCProgress = class {
      async init({ toc, ids, splitHref, getFragment }) {
        assignIDs(toc);
        const items = flatten(toc);
        const grouped = /* @__PURE__ */ new Map();
        for (const [i3, item] of items.entries()) {
          const [id, fragment] = await splitHref(item?.href) ?? [];
          const value = { fragment, item };
          if (grouped.has(id)) grouped.get(id).items.push(value);
          else grouped.set(id, { prev: items[i3 - 1], items: [value] });
        }
        const map = /* @__PURE__ */ new Map();
        for (const [i3, id] of ids.entries()) {
          if (grouped.has(id)) map.set(id, grouped.get(id));
          else map.set(id, map.get(ids[i3 - 1]));
        }
        this.ids = ids;
        this.map = map;
        this.getFragment = getFragment;
      }
      getProgress(index, range) {
        if (!this.ids) return;
        const id = this.ids[index];
        const obj = this.map.get(id);
        if (!obj) return null;
        const { prev, items } = obj;
        if (!items) return prev;
        if (!range || items.length === 1 && !items[0].fragment) return items[0].item;
        const doc = range.startContainer.getRootNode();
        for (const [i3, { fragment }] of items.entries()) {
          const el = this.getFragment(doc, fragment);
          if (!el) continue;
          if (range.comparePoint(el, 0) > 0)
            return items[i3 - 1]?.item ?? prev;
        }
        return items[items.length - 1].item;
      }
    };
    SectionProgress = class {
      constructor(sections, sizePerLoc, sizePerTimeUnit) {
        this.sizes = sections.map((s3) => s3.linear != "no" && s3.size > 0 ? s3.size : 0);
        this.sizePerLoc = sizePerLoc;
        this.sizePerTimeUnit = sizePerTimeUnit;
        this.sizeTotal = this.sizes.reduce((a3, b3) => a3 + b3, 0);
        this.sectionFractions = this.#getSectionFractions();
      }
      #getSectionFractions() {
        const { sizeTotal } = this;
        const results = [0];
        let sum = 0;
        for (const size of this.sizes) results.push((sum += size) / sizeTotal);
        return results;
      }
      // get progress given index of and fractions within a section
      getProgress(index, fractionInSection, pageFraction = 0) {
        const { sizes, sizePerLoc, sizePerTimeUnit, sizeTotal } = this;
        const sizeInSection = sizes[index] ?? 0;
        const sizeBefore = sizes.slice(0, index).reduce((a3, b3) => a3 + b3, 0);
        const size = sizeBefore + fractionInSection * sizeInSection;
        const nextSize = size + pageFraction * sizeInSection;
        const remainingTotal = sizeTotal - size;
        const remainingSection = (1 - fractionInSection) * sizeInSection;
        return {
          fraction: nextSize / sizeTotal,
          section: {
            current: index,
            total: sizes.length
          },
          location: {
            current: Math.floor(size / sizePerLoc),
            next: Math.floor(nextSize / sizePerLoc),
            total: Math.ceil(sizeTotal / sizePerLoc)
          },
          time: {
            section: remainingSection / sizePerTimeUnit,
            total: remainingTotal / sizePerTimeUnit
          }
        };
      }
      // the inverse of `getProgress`
      // get index of and fraction in section based on total fraction
      getSection(fraction) {
        if (fraction <= 0) return [0, 0];
        if (fraction >= 1) return [this.sizes.length - 1, 1];
        fraction = fraction + Number.EPSILON;
        const { sizeTotal } = this;
        let index = this.sectionFractions.findIndex((x3) => x3 > fraction) - 1;
        if (index < 0) return [0, 0];
        while (!this.sizes[index]) index++;
        const fractionInSection = (fraction - this.sectionFractions[index]) / (this.sizes[index] / sizeTotal);
        return [index, fractionInSection];
      }
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/overlayer.js
var createSVGElement, Overlayer;
var init_overlayer = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/overlayer.js"() {
    createSVGElement = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
    Overlayer = class {
      #svg = createSVGElement("svg");
      #map = /* @__PURE__ */ new Map();
      #doc = null;
      constructor(doc) {
        this.#doc = doc;
        Object.assign(this.#svg.style, {
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          pointerEvents: "none"
        });
      }
      get element() {
        return this.#svg;
      }
      get #zoom() {
        if (/^((?!chrome|android).)*AppleWebKit/i.test(navigator.userAgent) && !window.chrome) {
          return window.getComputedStyle(this.#doc.body).zoom || 1;
        }
        return 1;
      }
      #splitRangeByParagraph(range) {
        const ancestor = range.commonAncestorContainer;
        const paragraphs = Array.from(ancestor.querySelectorAll?.("p") || []);
        if (paragraphs.length === 0) return [range];
        const splitRanges = [];
        paragraphs.forEach((p3) => {
          const pRange = document.createRange();
          if (range.intersectsNode(p3)) {
            pRange.selectNodeContents(p3);
            if (pRange.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
              pRange.setStart(range.startContainer, range.startOffset);
            }
            if (pRange.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
              pRange.setEnd(range.endContainer, range.endOffset);
            }
            splitRanges.push(pRange);
          }
        });
        return splitRanges;
      }
      add(key, range, draw, options) {
        if (this.#map.has(key)) this.remove(key);
        if (typeof range === "function") range = range(this.#svg.getRootNode());
        const zoom = this.#zoom;
        let rects = [];
        this.#splitRangeByParagraph(range).forEach((pRange) => {
          const pRects = Array.from(pRange.getClientRects()).map((rect) => ({
            left: rect.left * zoom,
            top: rect.top * zoom,
            right: rect.right * zoom,
            bottom: rect.bottom * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom
          }));
          rects = rects.concat(pRects);
        });
        const element = draw(rects, options);
        this.#svg.append(element);
        this.#map.set(key, { range, draw, options, element, rects });
      }
      remove(key) {
        if (!this.#map.has(key)) return;
        this.#svg.removeChild(this.#map.get(key).element);
        this.#map.delete(key);
      }
      redraw() {
        for (const obj of this.#map.values()) {
          const { range, draw, options, element } = obj;
          this.#svg.removeChild(element);
          const zoom = this.#zoom;
          let rects = [];
          this.#splitRangeByParagraph(range).forEach((pRange) => {
            const pRects = Array.from(pRange.getClientRects()).map((rect) => ({
              left: rect.left * zoom,
              top: rect.top * zoom,
              right: rect.right * zoom,
              bottom: rect.bottom * zoom,
              width: rect.width * zoom,
              height: rect.height * zoom
            }));
            rects = rects.concat(pRects);
          });
          const el = draw(rects, options);
          this.#svg.append(el);
          obj.element = el;
          obj.rects = rects;
        }
      }
      hitTest({ x: x3, y: y3 }) {
        const arr = Array.from(this.#map.entries());
        for (let i3 = arr.length - 1; i3 >= 0; i3--) {
          const [key, obj] = arr[i3];
          for (const { left, top, right, bottom } of obj.rects)
            if (top <= y3 && left <= x3 && bottom > y3 && right > x3)
              return [key, obj.range];
        }
        return [];
      }
      static underline(rects, options = {}) {
        const { color = "red", width: strokeWidth = 2, padding = 0, writingMode } = options;
        const g3 = createSVGElement("g");
        g3.setAttribute("fill", color);
        if (writingMode === "vertical-rl" || writingMode === "vertical-lr")
          for (const { right, top, height } of rects) {
            const el = createSVGElement("rect");
            el.setAttribute("x", right - strokeWidth / 2 + padding);
            el.setAttribute("y", top);
            el.setAttribute("height", height);
            el.setAttribute("width", strokeWidth);
            g3.append(el);
          }
        else for (const { left, bottom, width } of rects) {
          const el = createSVGElement("rect");
          el.setAttribute("x", left);
          el.setAttribute("y", bottom - strokeWidth / 2 + padding);
          el.setAttribute("height", strokeWidth);
          el.setAttribute("width", width);
          g3.append(el);
        }
        return g3;
      }
      static strikethrough(rects, options = {}) {
        const { color = "red", width: strokeWidth = 2, writingMode } = options;
        const g3 = createSVGElement("g");
        g3.setAttribute("fill", color);
        if (writingMode === "vertical-rl" || writingMode === "vertical-lr")
          for (const { right, left, top, height } of rects) {
            const el = createSVGElement("rect");
            el.setAttribute("x", (right + left) / 2);
            el.setAttribute("y", top);
            el.setAttribute("height", height);
            el.setAttribute("width", strokeWidth);
            g3.append(el);
          }
        else for (const { left, top, bottom, width } of rects) {
          const el = createSVGElement("rect");
          el.setAttribute("x", left);
          el.setAttribute("y", (top + bottom) / 2);
          el.setAttribute("height", strokeWidth);
          el.setAttribute("width", width);
          g3.append(el);
        }
        return g3;
      }
      static squiggly(rects, options = {}) {
        const { color = "red", width: strokeWidth = 2, padding = 0, writingMode } = options;
        const g3 = createSVGElement("g");
        g3.setAttribute("fill", "none");
        g3.setAttribute("stroke", color);
        g3.setAttribute("stroke-width", strokeWidth);
        const block = strokeWidth * 1.5;
        if (writingMode === "vertical-rl" || writingMode === "vertical-lr")
          for (const { right, top, height } of rects) {
            const el = createSVGElement("path");
            const n3 = Math.round(height / block / 1.5);
            const inline = height / n3;
            const ls = Array.from(
              { length: n3 },
              (_2, i3) => `l${i3 % 2 ? -block : block} ${inline}`
            ).join("");
            el.setAttribute("d", `M${right - strokeWidth / 2 + padding} ${top}${ls}`);
            g3.append(el);
          }
        else for (const { left, bottom, width } of rects) {
          const el = createSVGElement("path");
          const n3 = Math.round(width / block / 1.5);
          const inline = width / n3;
          const ls = Array.from(
            { length: n3 },
            (_2, i3) => `l${inline} ${i3 % 2 ? block : -block}`
          ).join("");
          el.setAttribute("d", `M${left} ${bottom + strokeWidth / 2 + padding}${ls}`);
          g3.append(el);
        }
        return g3;
      }
      static highlight(rects, options = {}) {
        const { color = "red", padding = 0 } = options;
        const g3 = createSVGElement("g");
        g3.setAttribute("fill", color);
        g3.style.opacity = "var(--overlayer-highlight-opacity, .3)";
        g3.style.mixBlendMode = "var(--overlayer-highlight-blend-mode, normal)";
        for (const { left, top, height, width } of rects) {
          const el = createSVGElement("rect");
          el.setAttribute("x", left - padding);
          el.setAttribute("y", top - padding);
          el.setAttribute("height", height + padding * 2);
          el.setAttribute("width", width + padding * 2);
          g3.append(el);
        }
        return g3;
      }
      static outline(rects, options = {}) {
        const { color = "red", width: strokeWidth = 3, padding = 0, radius = 3 } = options;
        const g3 = createSVGElement("g");
        g3.setAttribute("fill", "none");
        g3.setAttribute("stroke", color);
        g3.setAttribute("stroke-width", strokeWidth);
        for (const { left, top, height, width } of rects) {
          const el = createSVGElement("rect");
          el.setAttribute("x", left - padding);
          el.setAttribute("y", top - padding);
          el.setAttribute("height", height + padding * 2);
          el.setAttribute("width", width + padding * 2);
          el.setAttribute("rx", radius);
          g3.append(el);
        }
        return g3;
      }
      // make an exact copy of an image in the overlay
      // one can then apply filters to the entire element, without affecting them;
      // it's a bit silly and probably better to just invert images twice
      // (though the color will be off in that case if you do heu-rotate)
      static copyImage([rect], options = {}) {
        const { src } = options;
        const image = createSVGElement("image");
        const { left, top, height, width } = rect;
        image.setAttribute("href", src);
        image.setAttribute("x", left);
        image.setAttribute("y", top);
        image.setAttribute("height", height);
        image.setAttribute("width", width);
        return image;
      }
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/text-walker.js
var walkRange, walkDocument, filter, acceptNode, textWalker;
var init_text_walker = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/text-walker.js"() {
    walkRange = (range, walker) => {
      const nodes = [];
      for (let node = walker.currentNode; node; node = walker.nextNode()) {
        const compare2 = range.comparePoint(node, 0);
        if (compare2 === 0) nodes.push(node);
        else if (compare2 > 0) break;
      }
      return nodes;
    };
    walkDocument = (_2, walker) => {
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node);
      return nodes;
    };
    filter = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION;
    acceptNode = (node) => {
      if (node.nodeType === 1) {
        const name = node.tagName.toLowerCase();
        if (name === "script" || name === "style") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    };
    textWalker = function* (x3, func) {
      const root = x3.commonAncestorContainer ?? x3.body ?? x3;
      const walker = document.createTreeWalker(root, filter, { acceptNode });
      const walk = x3.commonAncestorContainer ? walkRange : walkDocument;
      const nodes = walk(x3, walker);
      const strs = nodes.map((node) => node.nodeValue ?? "");
      const makeRange2 = (startIndex, startOffset, endIndex, endOffset) => {
        const range = document.createRange();
        range.setStart(nodes[startIndex], startOffset);
        range.setEnd(nodes[endIndex], endOffset);
        return range;
      };
      for (const match of func(strs, makeRange2)) yield match;
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/vendor/zip.js
var zip_exports = {};
__export(zip_exports, {
  BlobReader: () => ut,
  BlobWriter: () => dt,
  TextWriter: () => ft,
  ZipReader: () => Ht,
  configure: () => T
});
function d() {
  let e3, i3, r3, a3, d2, f3;
  function h3(e4, i4, s3, o3, l3, c2, h4, _3, w2, b3, p3) {
    let m3, g3, y3, x3, k3, v3, S2, z3, A3, U3, D2, E3, F2, T3, O2;
    U3 = 0, k3 = s3;
    do {
      r3[e4[i4 + U3]]++, U3++, k3--;
    } while (0 !== k3);
    if (r3[0] == s3) return h4[0] = -1, _3[0] = 0, 0;
    for (z3 = _3[0], v3 = 1; v3 <= u && 0 === r3[v3]; v3++) ;
    for (S2 = v3, z3 < v3 && (z3 = v3), k3 = u; 0 !== k3 && 0 === r3[k3]; k3--) ;
    for (y3 = k3, z3 > k3 && (z3 = k3), _3[0] = z3, T3 = 1 << v3; v3 < k3; v3++, T3 <<= 1) if ((T3 -= r3[v3]) < 0) return t;
    if ((T3 -= r3[k3]) < 0) return t;
    for (r3[k3] += T3, f3[1] = v3 = 0, U3 = 1, F2 = 2; 0 != --k3; ) f3[F2] = v3 += r3[U3], F2++, U3++;
    k3 = 0, U3 = 0;
    do {
      0 !== (v3 = e4[i4 + U3]) && (p3[f3[v3]++] = k3), U3++;
    } while (++k3 < s3);
    for (s3 = f3[y3], f3[0] = k3 = 0, U3 = 0, x3 = -1, E3 = -z3, d2[0] = 0, D2 = 0, O2 = 0; S2 <= y3; S2++) for (m3 = r3[S2]; 0 != m3--; ) {
      for (; S2 > E3 + z3; ) {
        if (x3++, E3 += z3, O2 = y3 - E3, O2 = O2 > z3 ? z3 : O2, (g3 = 1 << (v3 = S2 - E3)) > m3 + 1 && (g3 -= m3 + 1, F2 = S2, v3 < O2)) for (; ++v3 < O2 && !((g3 <<= 1) <= r3[++F2]); ) g3 -= r3[F2];
        if (O2 = 1 << v3, b3[0] + O2 > 1440) return t;
        d2[x3] = D2 = b3[0], b3[0] += O2, 0 !== x3 ? (f3[x3] = k3, a3[0] = v3, a3[1] = z3, v3 = k3 >>> E3 - z3, a3[2] = D2 - d2[x3 - 1] - v3, w2.set(a3, 3 * (d2[x3 - 1] + v3))) : h4[0] = D2;
      }
      for (a3[1] = S2 - E3, U3 >= s3 ? a3[0] = 192 : p3[U3] < o3 ? (a3[0] = p3[U3] < 256 ? 0 : 96, a3[2] = p3[U3++]) : (a3[0] = c2[p3[U3] - o3] + 16 + 64, a3[2] = l3[p3[U3++] - o3]), g3 = 1 << S2 - E3, v3 = k3 >>> E3; v3 < O2; v3 += g3) w2.set(a3, 3 * (D2 + v3));
      for (v3 = 1 << S2 - 1; k3 & v3; v3 >>>= 1) k3 ^= v3;
      for (k3 ^= v3, A3 = (1 << E3) - 1; (k3 & A3) != f3[x3]; ) x3--, E3 -= z3, A3 = (1 << E3) - 1;
    }
    return 0 !== T3 && 1 != y3 ? n : 0;
  }
  function _2(t3) {
    let n3;
    for (e3 || (e3 = [], i3 = [], r3 = new Int32Array(16), a3 = [], d2 = new Int32Array(u), f3 = new Int32Array(16)), i3.length < t3 && (i3 = []), n3 = 0; n3 < t3; n3++) i3[n3] = 0;
    for (n3 = 0; n3 < 16; n3++) r3[n3] = 0;
    for (n3 = 0; n3 < 3; n3++) a3[n3] = 0;
    d2.set(r3.subarray(0, u), 0), f3.set(r3.subarray(0, 16), 0);
  }
  this.inflate_trees_bits = function(r4, a4, s3, o3, l3) {
    let c2;
    return _2(19), e3[0] = 0, c2 = h3(r4, 0, 19, 19, null, null, s3, a4, o3, e3, i3), c2 == t ? l3.msg = "oversubscribed dynamic bit lengths tree" : c2 != n && 0 !== a4[0] || (l3.msg = "incomplete dynamic bit lengths tree", c2 = t), c2;
  }, this.inflate_trees_dynamic = function(r4, a4, u2, d3, f4, w2, b3, p3, m3) {
    let g3;
    return _2(288), e3[0] = 0, g3 = h3(u2, 0, r4, 257, s, o, w2, d3, p3, e3, i3), 0 != g3 || 0 === d3[0] ? (g3 == t ? m3.msg = "oversubscribed literal/length tree" : -4 != g3 && (m3.msg = "incomplete literal/length tree", g3 = t), g3) : (_2(288), g3 = h3(u2, r4, a4, 0, l, c, b3, f4, p3, e3, i3), 0 != g3 || 0 === f4[0] && r4 > 257 ? (g3 == t ? m3.msg = "oversubscribed distance tree" : g3 == n ? (m3.msg = "incomplete distance tree", g3 = t) : -4 != g3 && (m3.msg = "empty distance tree with lengths", g3 = t), g3) : 0);
  };
}
function f() {
  const n3 = this;
  let r3, a3, s3, o3, l3 = 0, c2 = 0, u2 = 0, d2 = 0, f3 = 0, h3 = 0, _2 = 0, w2 = 0, b3 = 0, p3 = 0;
  function m3(e3, n4, r4, a4, s4, o4, l4, c3) {
    let u3, d3, f4, h4, _3, w3, b4, p4, m4, g3, y3, x3, k3, v3, S2, z3;
    b4 = c3.next_in_index, p4 = c3.avail_in, _3 = l4.bitb, w3 = l4.bitk, m4 = l4.write, g3 = m4 < l4.read ? l4.read - m4 - 1 : l4.end - m4, y3 = i[e3], x3 = i[n4];
    do {
      for (; w3 < 20; ) p4--, _3 |= (255 & c3.read_byte(b4++)) << w3, w3 += 8;
      if (u3 = _3 & y3, d3 = r4, f4 = a4, z3 = 3 * (f4 + u3), 0 !== (h4 = d3[z3])) for (; ; ) {
        if (_3 >>= d3[z3 + 1], w3 -= d3[z3 + 1], 16 & h4) {
          for (h4 &= 15, k3 = d3[z3 + 2] + (_3 & i[h4]), _3 >>= h4, w3 -= h4; w3 < 15; ) p4--, _3 |= (255 & c3.read_byte(b4++)) << w3, w3 += 8;
          for (u3 = _3 & x3, d3 = s4, f4 = o4, z3 = 3 * (f4 + u3), h4 = d3[z3]; ; ) {
            if (_3 >>= d3[z3 + 1], w3 -= d3[z3 + 1], 16 & h4) {
              for (h4 &= 15; w3 < h4; ) p4--, _3 |= (255 & c3.read_byte(b4++)) << w3, w3 += 8;
              if (v3 = d3[z3 + 2] + (_3 & i[h4]), _3 >>= h4, w3 -= h4, g3 -= k3, m4 >= v3) S2 = m4 - v3, m4 - S2 > 0 && 2 > m4 - S2 ? (l4.win[m4++] = l4.win[S2++], l4.win[m4++] = l4.win[S2++], k3 -= 2) : (l4.win.set(l4.win.subarray(S2, S2 + 2), m4), m4 += 2, S2 += 2, k3 -= 2);
              else {
                S2 = m4 - v3;
                do {
                  S2 += l4.end;
                } while (S2 < 0);
                if (h4 = l4.end - S2, k3 > h4) {
                  if (k3 -= h4, m4 - S2 > 0 && h4 > m4 - S2) do {
                    l4.win[m4++] = l4.win[S2++];
                  } while (0 != --h4);
                  else l4.win.set(l4.win.subarray(S2, S2 + h4), m4), m4 += h4, S2 += h4, h4 = 0;
                  S2 = 0;
                }
              }
              if (m4 - S2 > 0 && k3 > m4 - S2) do {
                l4.win[m4++] = l4.win[S2++];
              } while (0 != --k3);
              else l4.win.set(l4.win.subarray(S2, S2 + k3), m4), m4 += k3, S2 += k3, k3 = 0;
              break;
            }
            if (64 & h4) return c3.msg = "invalid distance code", k3 = c3.avail_in - p4, k3 = w3 >> 3 < k3 ? w3 >> 3 : k3, p4 += k3, b4 -= k3, w3 -= k3 << 3, l4.bitb = _3, l4.bitk = w3, c3.avail_in = p4, c3.total_in += b4 - c3.next_in_index, c3.next_in_index = b4, l4.write = m4, t;
            u3 += d3[z3 + 2], u3 += _3 & i[h4], z3 = 3 * (f4 + u3), h4 = d3[z3];
          }
          break;
        }
        if (64 & h4) return 32 & h4 ? (k3 = c3.avail_in - p4, k3 = w3 >> 3 < k3 ? w3 >> 3 : k3, p4 += k3, b4 -= k3, w3 -= k3 << 3, l4.bitb = _3, l4.bitk = w3, c3.avail_in = p4, c3.total_in += b4 - c3.next_in_index, c3.next_in_index = b4, l4.write = m4, 1) : (c3.msg = "invalid literal/length code", k3 = c3.avail_in - p4, k3 = w3 >> 3 < k3 ? w3 >> 3 : k3, p4 += k3, b4 -= k3, w3 -= k3 << 3, l4.bitb = _3, l4.bitk = w3, c3.avail_in = p4, c3.total_in += b4 - c3.next_in_index, c3.next_in_index = b4, l4.write = m4, t);
        if (u3 += d3[z3 + 2], u3 += _3 & i[h4], z3 = 3 * (f4 + u3), 0 === (h4 = d3[z3])) {
          _3 >>= d3[z3 + 1], w3 -= d3[z3 + 1], l4.win[m4++] = d3[z3 + 2], g3--;
          break;
        }
      }
      else _3 >>= d3[z3 + 1], w3 -= d3[z3 + 1], l4.win[m4++] = d3[z3 + 2], g3--;
    } while (g3 >= 258 && p4 >= 10);
    return k3 = c3.avail_in - p4, k3 = w3 >> 3 < k3 ? w3 >> 3 : k3, p4 += k3, b4 -= k3, w3 -= k3 << 3, l4.bitb = _3, l4.bitk = w3, c3.avail_in = p4, c3.total_in += b4 - c3.next_in_index, c3.next_in_index = b4, l4.write = m4, 0;
  }
  n3.init = function(e3, t3, n4, i3, l4, c3) {
    r3 = 0, _2 = e3, w2 = t3, s3 = n4, b3 = i3, o3 = l4, p3 = c3, a3 = null;
  }, n3.proc = function(n4, g3, y3) {
    let x3, k3, v3, S2, z3, A3, U3, D2 = 0, E3 = 0, F2 = 0;
    for (F2 = g3.next_in_index, S2 = g3.avail_in, D2 = n4.bitb, E3 = n4.bitk, z3 = n4.write, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3; ; ) switch (r3) {
      case 0:
        if (A3 >= 258 && S2 >= 10 && (n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, y3 = m3(_2, w2, s3, b3, o3, p3, n4, g3), F2 = g3.next_in_index, S2 = g3.avail_in, D2 = n4.bitb, E3 = n4.bitk, z3 = n4.write, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3, 0 != y3)) {
          r3 = 1 == y3 ? 7 : 9;
          break;
        }
        u2 = _2, a3 = s3, c2 = b3, r3 = 1;
      case 1:
        for (x3 = u2; E3 < x3; ) {
          if (0 === S2) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
          y3 = 0, S2--, D2 |= (255 & g3.read_byte(F2++)) << E3, E3 += 8;
        }
        if (k3 = 3 * (c2 + (D2 & i[x3])), D2 >>>= a3[k3 + 1], E3 -= a3[k3 + 1], v3 = a3[k3], 0 === v3) {
          d2 = a3[k3 + 2], r3 = 6;
          break;
        }
        if (16 & v3) {
          f3 = 15 & v3, l3 = a3[k3 + 2], r3 = 2;
          break;
        }
        if (!(64 & v3)) {
          u2 = v3, c2 = k3 / 3 + a3[k3 + 2];
          break;
        }
        if (32 & v3) {
          r3 = 7;
          break;
        }
        return r3 = 9, g3.msg = "invalid literal/length code", y3 = t, n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
      case 2:
        for (x3 = f3; E3 < x3; ) {
          if (0 === S2) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
          y3 = 0, S2--, D2 |= (255 & g3.read_byte(F2++)) << E3, E3 += 8;
        }
        l3 += D2 & i[x3], D2 >>= x3, E3 -= x3, u2 = w2, a3 = o3, c2 = p3, r3 = 3;
      case 3:
        for (x3 = u2; E3 < x3; ) {
          if (0 === S2) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
          y3 = 0, S2--, D2 |= (255 & g3.read_byte(F2++)) << E3, E3 += 8;
        }
        if (k3 = 3 * (c2 + (D2 & i[x3])), D2 >>= a3[k3 + 1], E3 -= a3[k3 + 1], v3 = a3[k3], 16 & v3) {
          f3 = 15 & v3, h3 = a3[k3 + 2], r3 = 4;
          break;
        }
        if (!(64 & v3)) {
          u2 = v3, c2 = k3 / 3 + a3[k3 + 2];
          break;
        }
        return r3 = 9, g3.msg = "invalid distance code", y3 = t, n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
      case 4:
        for (x3 = f3; E3 < x3; ) {
          if (0 === S2) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
          y3 = 0, S2--, D2 |= (255 & g3.read_byte(F2++)) << E3, E3 += 8;
        }
        h3 += D2 & i[x3], D2 >>= x3, E3 -= x3, r3 = 5;
      case 5:
        for (U3 = z3 - h3; U3 < 0; ) U3 += n4.end;
        for (; 0 !== l3; ) {
          if (0 === A3 && (z3 == n4.end && 0 !== n4.read && (z3 = 0, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3), 0 === A3 && (n4.write = z3, y3 = n4.inflate_flush(g3, y3), z3 = n4.write, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3, z3 == n4.end && 0 !== n4.read && (z3 = 0, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3), 0 === A3))) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
          n4.win[z3++] = n4.win[U3++], A3--, U3 == n4.end && (U3 = 0), l3--;
        }
        r3 = 0;
        break;
      case 6:
        if (0 === A3 && (z3 == n4.end && 0 !== n4.read && (z3 = 0, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3), 0 === A3 && (n4.write = z3, y3 = n4.inflate_flush(g3, y3), z3 = n4.write, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3, z3 == n4.end && 0 !== n4.read && (z3 = 0, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3), 0 === A3))) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
        y3 = 0, n4.win[z3++] = d2, A3--, r3 = 0;
        break;
      case 7:
        if (E3 > 7 && (E3 -= 8, S2++, F2--), n4.write = z3, y3 = n4.inflate_flush(g3, y3), z3 = n4.write, A3 = z3 < n4.read ? n4.read - z3 - 1 : n4.end - z3, n4.read != n4.write) return n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
        r3 = 8;
      case 8:
        return y3 = 1, n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
      case 9:
        return y3 = t, n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
      default:
        return y3 = e, n4.bitb = D2, n4.bitk = E3, g3.avail_in = S2, g3.total_in += F2 - g3.next_in_index, g3.next_in_index = F2, n4.write = z3, n4.inflate_flush(g3, y3);
    }
  }, n3.free = function() {
  };
}
function _(r3, a3) {
  const s3 = this;
  let o3, l3 = 0, c2 = 0, u2 = 0, _2 = 0;
  const w2 = [0], b3 = [0], p3 = new f();
  let m3 = 0, g3 = new Int32Array(4320);
  const y3 = new d();
  s3.bitk = 0, s3.bitb = 0, s3.win = new Uint8Array(a3), s3.end = a3, s3.read = 0, s3.write = 0, s3.reset = function(e3, t3) {
    t3 && (t3[0] = 0), 6 == l3 && p3.free(e3), l3 = 0, s3.bitk = 0, s3.bitb = 0, s3.read = s3.write = 0;
  }, s3.reset(r3, null), s3.inflate_flush = function(e3, t3) {
    let i3, r4, a4;
    return r4 = e3.next_out_index, a4 = s3.read, i3 = (a4 <= s3.write ? s3.write : s3.end) - a4, i3 > e3.avail_out && (i3 = e3.avail_out), 0 !== i3 && t3 == n && (t3 = 0), e3.avail_out -= i3, e3.total_out += i3, e3.next_out.set(s3.win.subarray(a4, a4 + i3), r4), r4 += i3, a4 += i3, a4 == s3.end && (a4 = 0, s3.write == s3.end && (s3.write = 0), i3 = s3.write - a4, i3 > e3.avail_out && (i3 = e3.avail_out), 0 !== i3 && t3 == n && (t3 = 0), e3.avail_out -= i3, e3.total_out += i3, e3.next_out.set(s3.win.subarray(a4, a4 + i3), r4), r4 += i3, a4 += i3), e3.next_out_index = r4, s3.read = a4, t3;
  }, s3.proc = function(n3, r4) {
    let a4, f3, x3, k3, v3, S2, z3, A3;
    for (k3 = n3.next_in_index, v3 = n3.avail_in, f3 = s3.bitb, x3 = s3.bitk, S2 = s3.write, z3 = S2 < s3.read ? s3.read - S2 - 1 : s3.end - S2; ; ) {
      let U3, D2, E3, F2, T3, O2, C2, W2;
      switch (l3) {
        case 0:
          for (; x3 < 3; ) {
            if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
            r4 = 0, v3--, f3 |= (255 & n3.read_byte(k3++)) << x3, x3 += 8;
          }
          switch (a4 = 7 & f3, m3 = 1 & a4, a4 >>> 1) {
            case 0:
              f3 >>>= 3, x3 -= 3, a4 = 7 & x3, f3 >>>= a4, x3 -= a4, l3 = 1;
              break;
            case 1:
              U3 = [], D2 = [], E3 = [[]], F2 = [[]], d.inflate_trees_fixed(U3, D2, E3, F2), p3.init(U3[0], D2[0], E3[0], 0, F2[0], 0), f3 >>>= 3, x3 -= 3, l3 = 6;
              break;
            case 2:
              f3 >>>= 3, x3 -= 3, l3 = 3;
              break;
            case 3:
              return f3 >>>= 3, x3 -= 3, l3 = 9, n3.msg = "invalid block type", r4 = t, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          }
          break;
        case 1:
          for (; x3 < 32; ) {
            if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
            r4 = 0, v3--, f3 |= (255 & n3.read_byte(k3++)) << x3, x3 += 8;
          }
          if ((~f3 >>> 16 & 65535) != (65535 & f3)) return l3 = 9, n3.msg = "invalid stored block lengths", r4 = t, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          c2 = 65535 & f3, f3 = x3 = 0, l3 = 0 !== c2 ? 2 : 0 !== m3 ? 7 : 0;
          break;
        case 2:
          if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          if (0 === z3 && (S2 == s3.end && 0 !== s3.read && (S2 = 0, z3 = S2 < s3.read ? s3.read - S2 - 1 : s3.end - S2), 0 === z3 && (s3.write = S2, r4 = s3.inflate_flush(n3, r4), S2 = s3.write, z3 = S2 < s3.read ? s3.read - S2 - 1 : s3.end - S2, S2 == s3.end && 0 !== s3.read && (S2 = 0, z3 = S2 < s3.read ? s3.read - S2 - 1 : s3.end - S2), 0 === z3))) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          if (r4 = 0, a4 = c2, a4 > v3 && (a4 = v3), a4 > z3 && (a4 = z3), s3.win.set(n3.read_buf(k3, a4), S2), k3 += a4, v3 -= a4, S2 += a4, z3 -= a4, 0 != (c2 -= a4)) break;
          l3 = 0 !== m3 ? 7 : 0;
          break;
        case 3:
          for (; x3 < 14; ) {
            if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
            r4 = 0, v3--, f3 |= (255 & n3.read_byte(k3++)) << x3, x3 += 8;
          }
          if (u2 = a4 = 16383 & f3, (31 & a4) > 29 || (a4 >> 5 & 31) > 29) return l3 = 9, n3.msg = "too many length or distance symbols", r4 = t, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          if (a4 = 258 + (31 & a4) + (a4 >> 5 & 31), !o3 || o3.length < a4) o3 = [];
          else for (A3 = 0; A3 < a4; A3++) o3[A3] = 0;
          f3 >>>= 14, x3 -= 14, _2 = 0, l3 = 4;
        case 4:
          for (; _2 < 4 + (u2 >>> 10); ) {
            for (; x3 < 3; ) {
              if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
              r4 = 0, v3--, f3 |= (255 & n3.read_byte(k3++)) << x3, x3 += 8;
            }
            o3[h[_2++]] = 7 & f3, f3 >>>= 3, x3 -= 3;
          }
          for (; _2 < 19; ) o3[h[_2++]] = 0;
          if (w2[0] = 7, a4 = y3.inflate_trees_bits(o3, w2, b3, g3, n3), 0 != a4) return (r4 = a4) == t && (o3 = null, l3 = 9), s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          _2 = 0, l3 = 5;
        case 5:
          for (; a4 = u2, !(_2 >= 258 + (31 & a4) + (a4 >> 5 & 31)); ) {
            let e3, c3;
            for (a4 = w2[0]; x3 < a4; ) {
              if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
              r4 = 0, v3--, f3 |= (255 & n3.read_byte(k3++)) << x3, x3 += 8;
            }
            if (a4 = g3[3 * (b3[0] + (f3 & i[a4])) + 1], c3 = g3[3 * (b3[0] + (f3 & i[a4])) + 2], c3 < 16) f3 >>>= a4, x3 -= a4, o3[_2++] = c3;
            else {
              for (A3 = 18 == c3 ? 7 : c3 - 14, e3 = 18 == c3 ? 11 : 3; x3 < a4 + A3; ) {
                if (0 === v3) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
                r4 = 0, v3--, f3 |= (255 & n3.read_byte(k3++)) << x3, x3 += 8;
              }
              if (f3 >>>= a4, x3 -= a4, e3 += f3 & i[A3], f3 >>>= A3, x3 -= A3, A3 = _2, a4 = u2, A3 + e3 > 258 + (31 & a4) + (a4 >> 5 & 31) || 16 == c3 && A3 < 1) return o3 = null, l3 = 9, n3.msg = "invalid bit length repeat", r4 = t, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
              c3 = 16 == c3 ? o3[A3 - 1] : 0;
              do {
                o3[A3++] = c3;
              } while (0 != --e3);
              _2 = A3;
            }
          }
          if (b3[0] = -1, T3 = [], O2 = [], C2 = [], W2 = [], T3[0] = 9, O2[0] = 6, a4 = u2, a4 = y3.inflate_trees_dynamic(257 + (31 & a4), 1 + (a4 >> 5 & 31), o3, T3, O2, C2, W2, g3, n3), 0 != a4) return a4 == t && (o3 = null, l3 = 9), r4 = a4, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          p3.init(T3[0], O2[0], g3, C2[0], g3, W2[0]), l3 = 6;
        case 6:
          if (s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, 1 != (r4 = p3.proc(s3, n3, r4))) return s3.inflate_flush(n3, r4);
          if (r4 = 0, p3.free(n3), k3 = n3.next_in_index, v3 = n3.avail_in, f3 = s3.bitb, x3 = s3.bitk, S2 = s3.write, z3 = S2 < s3.read ? s3.read - S2 - 1 : s3.end - S2, 0 === m3) {
            l3 = 0;
            break;
          }
          l3 = 7;
        case 7:
          if (s3.write = S2, r4 = s3.inflate_flush(n3, r4), S2 = s3.write, z3 = S2 < s3.read ? s3.read - S2 - 1 : s3.end - S2, s3.read != s3.write) return s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
          l3 = 8;
        case 8:
          return r4 = 1, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
        case 9:
          return r4 = t, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
        default:
          return r4 = e, s3.bitb = f3, s3.bitk = x3, n3.avail_in = v3, n3.total_in += k3 - n3.next_in_index, n3.next_in_index = k3, s3.write = S2, s3.inflate_flush(n3, r4);
      }
    }
  }, s3.free = function(e3) {
    s3.reset(e3, null), s3.win = null, g3 = null;
  }, s3.set_dictionary = function(e3, t3, n3) {
    s3.win.set(e3.subarray(t3, t3 + n3), 0), s3.read = s3.write = n3;
  }, s3.sync_point = function() {
    return 1 == l3 ? 1 : 0;
  };
}
function p() {
  const i3 = this;
  function r3(t3) {
    return t3 && t3.istate ? (t3.total_in = t3.total_out = 0, t3.msg = null, t3.istate.mode = 7, t3.istate.blocks.reset(t3, null), 0) : e;
  }
  i3.mode = 0, i3.method = 0, i3.was = [0], i3.need = 0, i3.marker = 0, i3.wbits = 0, i3.inflateEnd = function(e3) {
    return i3.blocks && i3.blocks.free(e3), i3.blocks = null, 0;
  }, i3.inflateInit = function(t3, n3) {
    return t3.msg = null, i3.blocks = null, n3 < 8 || n3 > 15 ? (i3.inflateEnd(t3), e) : (i3.wbits = n3, t3.istate.blocks = new _(t3, 1 << n3), r3(t3), 0);
  }, i3.inflate = function(i4, r4) {
    let a3, s3;
    if (!i4 || !i4.istate || !i4.next_in) return e;
    const o3 = i4.istate;
    for (r4 = 4 == r4 ? n : 0, a3 = n; ; ) switch (o3.mode) {
      case 0:
        if (0 === i4.avail_in) return a3;
        if (a3 = r4, i4.avail_in--, i4.total_in++, 8 != (15 & (o3.method = i4.read_byte(i4.next_in_index++)))) {
          o3.mode = w, i4.msg = "unknown compression method", o3.marker = 5;
          break;
        }
        if (8 + (o3.method >> 4) > o3.wbits) {
          o3.mode = w, i4.msg = "invalid win size", o3.marker = 5;
          break;
        }
        o3.mode = 1;
      case 1:
        if (0 === i4.avail_in) return a3;
        if (a3 = r4, i4.avail_in--, i4.total_in++, s3 = 255 & i4.read_byte(i4.next_in_index++), ((o3.method << 8) + s3) % 31 != 0) {
          o3.mode = w, i4.msg = "incorrect header check", o3.marker = 5;
          break;
        }
        if (!(32 & s3)) {
          o3.mode = 7;
          break;
        }
        o3.mode = 2;
      case 2:
        if (0 === i4.avail_in) return a3;
        a3 = r4, i4.avail_in--, i4.total_in++, o3.need = (255 & i4.read_byte(i4.next_in_index++)) << 24 & 4278190080, o3.mode = 3;
      case 3:
        if (0 === i4.avail_in) return a3;
        a3 = r4, i4.avail_in--, i4.total_in++, o3.need += (255 & i4.read_byte(i4.next_in_index++)) << 16 & 16711680, o3.mode = 4;
      case 4:
        if (0 === i4.avail_in) return a3;
        a3 = r4, i4.avail_in--, i4.total_in++, o3.need += (255 & i4.read_byte(i4.next_in_index++)) << 8 & 65280, o3.mode = 5;
      case 5:
        return 0 === i4.avail_in ? a3 : (a3 = r4, i4.avail_in--, i4.total_in++, o3.need += 255 & i4.read_byte(i4.next_in_index++), o3.mode = 6, 2);
      case 6:
        return o3.mode = w, i4.msg = "need dictionary", o3.marker = 0, e;
      case 7:
        if (a3 = o3.blocks.proc(i4, a3), a3 == t) {
          o3.mode = w, o3.marker = 0;
          break;
        }
        if (0 == a3 && (a3 = r4), 1 != a3) return a3;
        a3 = r4, o3.blocks.reset(i4, o3.was), o3.mode = 12;
      case 12:
        return i4.avail_in = 0, 1;
      case w:
        return t;
      default:
        return e;
    }
  }, i3.inflateSetDictionary = function(t3, n3, i4) {
    let r4 = 0, a3 = i4;
    if (!t3 || !t3.istate || 6 != t3.istate.mode) return e;
    const s3 = t3.istate;
    return a3 >= 1 << s3.wbits && (a3 = (1 << s3.wbits) - 1, r4 = i4 - a3), s3.blocks.set_dictionary(n3, r4, a3), s3.mode = 7, 0;
  }, i3.inflateSync = function(i4) {
    let a3, s3, o3, l3, c2;
    if (!i4 || !i4.istate) return e;
    const u2 = i4.istate;
    if (u2.mode != w && (u2.mode = w, u2.marker = 0), 0 === (a3 = i4.avail_in)) return n;
    for (s3 = i4.next_in_index, o3 = u2.marker; 0 !== a3 && o3 < 4; ) i4.read_byte(s3) == b[o3] ? o3++ : o3 = 0 !== i4.read_byte(s3) ? 0 : 4 - o3, s3++, a3--;
    return i4.total_in += s3 - i4.next_in_index, i4.next_in_index = s3, i4.avail_in = a3, u2.marker = o3, 4 != o3 ? t : (l3 = i4.total_in, c2 = i4.total_out, r3(i4), i4.total_in = l3, i4.total_out = c2, u2.mode = 7, 0);
  }, i3.inflateSyncPoint = function(t3) {
    return t3 && t3.istate && t3.istate.blocks ? t3.istate.blocks.sync_point() : e;
  };
}
function m() {
}
function T(e3) {
  const { baseURL: t3, chunkSize: n3, maxWorkers: i3, terminateWorkerTimeout: r3, useCompressionStream: a3, useWebWorkers: s3, Deflate: o3, Inflate: l3, CompressionStream: c2, DecompressionStream: u2, workerScripts: d2 } = e3;
  if (O("baseURL", t3), O("chunkSize", n3), O("maxWorkers", i3), O("terminateWorkerTimeout", r3), O("useCompressionStream", a3), O("useWebWorkers", s3), o3 && (F.CompressionStream = new U(o3)), l3 && (F.DecompressionStream = new U(l3)), O("CompressionStream", c2), O("DecompressionStream", u2), d2 !== S) {
    const { deflate: e4, inflate: t4 } = d2;
    if ((e4 || t4) && (F.workerScripts || (F.workerScripts = {})), e4) {
      if (!Array.isArray(e4)) throw new Error("workerScripts.deflate must be an array");
      F.workerScripts.deflate = e4;
    }
    if (t4) {
      if (!Array.isArray(t4)) throw new Error("workerScripts.inflate must be an array");
      F.workerScripts.inflate = t4;
    }
  }
}
function O(e3, t3) {
  t3 !== S && (F[e3] = t3);
}
function Z(e3) {
  return V ? crypto.getRandomValues(e3) : B.getRandomValues(e3);
}
function _e(e3, t3, n3, i3, r3, a3) {
  const { ctr: s3, hmac: o3, pending: l3 } = e3, c2 = t3.length - r3;
  let u2;
  for (l3.length && (t3 = pe(l3, t3), n3 = (function(e4, t4) {
    if (t4 && t4 > e4.length) {
      const n4 = e4;
      (e4 = new Uint8Array(t4)).set(n4, 0);
    }
    return e4;
  })(n3, c2 - c2 % G)), u2 = 0; u2 <= c2 - G; u2 += G) {
    const e4 = ye(se, me(t3, u2, u2 + G));
    a3 && o3.update(e4);
    const r4 = s3.update(e4);
    a3 || o3.update(r4), n3.set(ge(se, r4), u2 + i3);
  }
  return e3.pending = me(t3, u2), n3;
}
async function we(e3, t3, n3, i3) {
  e3.password = null;
  const r3 = await (async function(e4, t4, n4, i4, r4) {
    if (!ue) return N.importKey(t4);
    try {
      return await re.importKey(e4, t4, n4, i4, r4);
    } catch (e5) {
      return ue = false, N.importKey(t4);
    }
  })("raw", n3, Q, false, Y), a3 = await (async function(e4, t4, n4) {
    if (!de) return N.pbkdf2(t4, e4.salt, X.iterations, n4);
    try {
      return await re.deriveBits(e4, t4, n4);
    } catch (i4) {
      return de = false, N.pbkdf2(t4, e4.salt, X.iterations, n4);
    }
  })(Object.assign({ salt: i3 }, X), r3, 8 * (2 * ee[t3] + 2)), s3 = new Uint8Array(a3), o3 = ye(se, me(s3, 0, ee[t3])), l3 = ye(se, me(s3, ee[t3], 2 * ee[t3])), c2 = me(s3, 2 * ee[t3]);
  return Object.assign(e3, { keys: { key: o3, authentication: l3, passwordVerification: c2 }, ctr: new le(new oe(o3), Array.from(ne)), hmac: new ce(l3) }), c2;
}
function be(e3, t3) {
  return t3 === S ? (function(e4) {
    if (typeof TextEncoder == z) {
      e4 = unescape(encodeURIComponent(e4));
      const t4 = new Uint8Array(e4.length);
      for (let n3 = 0; n3 < t4.length; n3++) t4[n3] = e4.charCodeAt(n3);
      return t4;
    }
    return new TextEncoder().encode(e4);
  })(e3) : t3;
}
function pe(e3, t3) {
  let n3 = e3;
  return e3.length + t3.length && (n3 = new Uint8Array(e3.length + t3.length), n3.set(e3, 0), n3.set(t3, e3.length)), n3;
}
function me(e3, t3, n3) {
  return e3.subarray(t3, n3);
}
function ge(e3, t3) {
  return e3.fromBits(t3);
}
function ye(e3, t3) {
  return e3.toBits(t3);
}
function Se(e3, t3) {
  const n3 = new Uint8Array(t3.length);
  for (let i3 = 0; i3 < t3.length; i3++) n3[i3] = De(e3) ^ t3[i3], Ue(e3, n3[i3]);
  return n3;
}
function ze(e3, t3) {
  const n3 = new Uint8Array(t3.length);
  for (let i3 = 0; i3 < t3.length; i3++) n3[i3] = De(e3) ^ t3[i3], Ue(e3, t3[i3]);
  return n3;
}
function Ae(e3, t3) {
  const n3 = [305419896, 591751049, 878082192];
  Object.assign(e3, { keys: n3, crcKey0: new W(n3[0]), crcKey2: new W(n3[2]) });
  for (let n4 = 0; n4 < t3.length; n4++) Ue(e3, t3.charCodeAt(n4));
}
function Ue(e3, t3) {
  let [n3, i3, r3] = e3.keys;
  e3.crcKey0.append([t3]), n3 = ~e3.crcKey0.get(), i3 = Fe(Math.imul(Fe(i3 + Ee(n3)), 134775813) + 1), e3.crcKey2.append([i3 >>> 24]), r3 = ~e3.crcKey2.get(), e3.keys = [n3, i3, r3];
}
function De(e3) {
  const t3 = 2 | e3.keys[2];
  return Ee(Math.imul(t3, 1 ^ t3) >>> 8);
}
function Ee(e3) {
  return 255 & e3;
}
function Fe(e3) {
  return 4294967295 & e3;
}
function We(e3) {
  return Le(e3, new TransformStream({ transform(e4, t3) {
    e4 && e4.length && t3.enqueue(e4);
  } }));
}
function je(e3, t3, n3) {
  t3 = Le(t3, new TransformStream({ flush: n3 })), Object.defineProperty(e3, "readable", { get: () => t3 });
}
function Me(e3, t3, n3, i3, r3) {
  try {
    e3 = Le(e3, new (t3 && i3 ? i3 : r3)(Te, n3));
  } catch (i4) {
    if (!t3) return e3;
    try {
      e3 = Le(e3, new r3(Te, n3));
    } catch (t4) {
      return e3;
    }
  }
  return e3;
}
function Le(e3, t3) {
  return e3.pipeThrough(t3);
}
async function Je(e3, ...t3) {
  try {
    await e3(...t3);
  } catch (e4) {
  }
}
function Qe(e3, t3) {
  return { run: () => (async function({ options: e4, readable: t4, writable: n3, onTaskFinished: i3 }, r3) {
    try {
      const i4 = new qe(e4, r3);
      await t4.pipeThrough(i4).pipeTo(n3, { preventClose: true, preventAbort: true });
      const { signature: a3, inputSize: s3, outputSize: o3 } = i4;
      return { signature: a3, inputSize: s3, outputSize: o3 };
    } finally {
      i3();
    }
  })(e3, t3) };
}
function Xe(e3, t3) {
  const { baseURL: n3, chunkSize: i3 } = t3;
  if (!e3.interface) {
    let r3;
    try {
      r3 = (function(e4, t4, n4) {
        const i4 = { type: "module" };
        let r4, a3;
        typeof e4 == A && (e4 = e4());
        try {
          r4 = new URL(e4, t4);
        } catch (t5) {
          r4 = e4;
        }
        if (Ye) try {
          a3 = new Worker(r4);
        } catch (e5) {
          Ye = false, a3 = new Worker(r4, i4);
        }
        else a3 = new Worker(r4, i4);
        return a3.addEventListener(Pe, ((e5) => (async function({ data: e6 }, t5) {
          const { type: n5, value: i5, messageId: r5, result: a4, error: s3 } = e6, { reader: o3, writer: l3, resolveResult: c2, rejectResult: u2, onTaskFinished: d2 } = t5;
          try {
            if (s3) {
              const { message: e7, stack: t6, code: n6, name: i6 } = s3, r6 = new Error(e7);
              Object.assign(r6, { stack: t6, code: n6, name: i6 }), f3(r6);
            } else {
              if (n5 == Be) {
                const { value: e7, done: n6 } = await o3.read();
                et({ type: Ie, value: e7, done: n6, messageId: r5 }, t5);
              }
              n5 == Ie && (await l3.ready, await l3.write(new Uint8Array(i5)), et({ type: "ack", messageId: r5 }, t5)), n5 == Ne && f3(null, a4);
            }
          } catch (s4) {
            et({ type: Ne, messageId: r5 }, t5), f3(s4);
          }
          function f3(e7, t6) {
            e7 ? u2(e7) : c2(t6), l3 && l3.releaseLock(), d2();
          }
        })(e5, n4))), a3;
      })(e3.scripts[0], n3, e3);
    } catch (n4) {
      return Ke = false, Qe(e3, t3);
    }
    Object.assign(e3, { worker: r3, interface: { run: () => (async function(e4, t4) {
      let n4, i4;
      const r4 = new Promise(((e5, t5) => {
        n4 = e5, i4 = t5;
      }));
      Object.assign(e4, { reader: null, writer: null, resolveResult: n4, rejectResult: i4, result: r4 });
      const { readable: a3, options: s3, scripts: o3 } = e4, { writable: l3, closed: c2 } = (function(e5) {
        let t5;
        const n5 = new Promise(((e6) => t5 = e6)), i5 = new WritableStream({ async write(t6) {
          const n6 = e5.getWriter();
          await n6.ready, await n6.write(t6), n6.releaseLock();
        }, close() {
          t5();
        }, abort: (t6) => e5.getWriter().abort(t6) });
        return { writable: i5, closed: n5 };
      })(e4.writable), u2 = et({ type: Re, scripts: o3.slice(1), options: s3, config: t4, readable: a3, writable: l3 }, e4);
      u2 || Object.assign(e4, { reader: a3.getReader(), writer: l3.getWriter() });
      const d2 = await r4;
      u2 || await l3.getWriter().close();
      return await c2, d2;
    })(e3, { chunkSize: i3 }) } });
  }
  return e3.interface;
}
function et(e3, { worker: t3, writer: n3, onTaskFinished: i3, transferStreams: r3 }) {
  try {
    const { value: n4, readable: i4, writable: a3 } = e3, s3 = [];
    if (n4 && (n4.byteLength < n4.buffer.byteLength ? e3.value = n4.buffer.slice(0, n4.byteLength) : e3.value = n4.buffer, s3.push(e3.value)), r3 && $e ? (i4 && s3.push(i4), a3 && s3.push(a3)) : e3.readable = e3.writable = null, s3.length) try {
      return t3.postMessage(e3, s3), true;
    } catch (n5) {
      $e = false, e3.readable = e3.writable = null, t3.postMessage(e3);
    }
    else t3.postMessage(e3);
  } catch (e4) {
    throw n3 && n3.releaseLock(), i3(), e4;
  }
}
async function rt(e3, t3) {
  const { options: n3, config: i3 } = t3, { transferStreams: r3, useWebWorkers: a3, useCompressionStream: s3, codecType: o3, compressed: l3, signed: c2, encrypted: u2 } = n3, { workerScripts: d2, maxWorkers: f3 } = i3;
  t3.transferStreams = r3 || r3 === S;
  const h3 = !(l3 || c2 || u2 || t3.transferStreams);
  return t3.useWebWorkers = !h3 && (a3 || a3 === S && i3.useWebWorkers), t3.scripts = t3.useWebWorkers && d2 ? d2[o3] : [], n3.useCompressionStream = s3 || s3 === S && i3.useCompressionStream, (await (async function() {
    const n4 = tt.find(((e4) => !e4.busy));
    if (n4) return at(n4), new Ze(n4, e3, t3, _2);
    if (tt.length < f3) {
      const n5 = { indexWorker: it };
      return it++, tt.push(n5), new Ze(n5, e3, t3, _2);
    }
    return new Promise(((n5) => nt.push({ resolve: n5, stream: e3, workerOptions: t3 })));
  })()).run();
  function _2(e4) {
    if (nt.length) {
      const [{ resolve: t4, stream: n4, workerOptions: i4 }] = nt.splice(0, 1);
      t4(new Ze(e4, n4, i4, _2));
    } else e4.worker ? (at(e4), (function(e5, t4) {
      const { config: n4 } = t4, { terminateWorkerTimeout: i4 } = n4;
      Number.isFinite(i4) && i4 >= 0 && (e5.terminated ? e5.terminated = false : e5.terminateTimeout = setTimeout((async () => {
        tt = tt.filter(((t5) => t5 != e5));
        try {
          await e5.terminate();
        } catch (e6) {
        }
      }), i4));
    })(e4, t3)) : tt = tt.filter(((t4) => t4 != e4));
  }
}
function at(e3) {
  const { terminateTimeout: t3 } = e3;
  t3 && (clearTimeout(t3), e3.terminateTimeout = null);
}
async function wt(e3, t3) {
  if (!e3.init || e3.initialized) return Promise.resolve();
  await e3.init(t3);
}
function bt(e3) {
  return Array.isArray(e3) && (e3 = new ht(e3)), e3 instanceof ReadableStream && (e3 = { readable: e3 }), e3;
}
function pt(e3, t3, n3, i3) {
  return e3.readUint8Array(t3, n3, i3);
}
function yt(e3, t3) {
  return t3 && "cp437" == t3.trim().toLowerCase() ? (function(e4) {
    if (gt) {
      let t4 = "";
      for (let n3 = 0; n3 < e4.length; n3++) t4 += mt[e4[n3]];
      return t4;
    }
    return new TextDecoder().decode(e4);
  })(e3) : new TextDecoder(t3).decode(e3);
}
function Zt(e3, t3, n3) {
  const i3 = e3.rawBitFlag = en(t3, n3 + 2), r3 = !(1 & ~i3), a3 = tn(t3, n3 + 6);
  Object.assign(e3, { encrypted: r3, version: en(t3, n3), bitFlag: { level: (6 & i3) >> 1, dataDescriptor: !(8 & ~i3), languageEncodingFlag: !(2048 & ~i3) }, rawLastModDate: a3, lastModDate: Xt(a3), filenameLength: en(t3, n3 + 22), extraFieldLength: en(t3, n3 + 24) });
}
function Gt(e3, t3, n3, i3, r3) {
  const { rawExtraField: a3 } = t3, s3 = t3.extraField = /* @__PURE__ */ new Map(), o3 = rn(new Uint8Array(a3));
  let l3 = 0;
  try {
    for (; l3 < a3.length; ) {
      const e4 = en(o3, l3), t4 = en(o3, l3 + 2);
      s3.set(e4, { type: e4, data: a3.slice(l3 + 4, l3 + 4 + t4) }), l3 += 4 + t4;
    }
  } catch (e4) {
  }
  const c2 = en(n3, i3 + 4);
  Object.assign(t3, { signature: tn(n3, i3 + 10), uncompressedSize: tn(n3, i3 + 18), compressedSize: tn(n3, i3 + 14) });
  const u2 = s3.get(1);
  u2 && (!(function(e4, t4) {
    t4.zip64 = true;
    const n4 = rn(e4.data), i4 = Vt.filter((([e5, n5]) => t4[e5] == n5));
    for (let r4 = 0, a4 = 0; r4 < i4.length; r4++) {
      const [s4, o4] = i4[r4];
      if (t4[s4] == o4) {
        const i5 = qt[o4];
        t4[s4] = e4[s4] = i5.getValue(n4, a4), a4 += i5.bytes;
      } else if (e4[s4]) throw new Error(Pt);
    }
  })(u2, t3), t3.extraFieldZip64 = u2);
  const d2 = s3.get(28789);
  d2 && (Jt(d2, xt, kt, t3, e3), t3.extraFieldUnicodePath = d2);
  const f3 = s3.get(25461);
  f3 && (Jt(f3, vt, St, t3, e3), t3.extraFieldUnicodeComment = f3);
  const h3 = s3.get(39169);
  h3 ? (!(function(e4, t4, n4) {
    const i4 = rn(e4.data), r4 = $t(i4, 4);
    Object.assign(e4, { vendorVersion: $t(i4, 0), vendorId: $t(i4, 2), strength: r4, originalCompressionMethod: n4, compressionMethod: en(i4, 5) }), t4.compressionMethod = e4.compressionMethod;
  })(h3, t3, c2), t3.extraFieldAES = h3) : t3.compressionMethod = c2;
  const _2 = s3.get(10);
  _2 && (!(function(e4, t4) {
    const n4 = rn(e4.data);
    let i4, r4 = 4;
    try {
      for (; r4 < e4.data.length && !i4; ) {
        const t5 = en(n4, r4), a4 = en(n4, r4 + 2);
        1 == t5 && (i4 = e4.data.slice(r4 + 4, r4 + 4 + a4)), r4 += 4 + a4;
      }
    } catch (e5) {
    }
    try {
      if (i4 && 24 == i4.length) {
        const n5 = rn(i4), r5 = n5.getBigUint64(0, true), a4 = n5.getBigUint64(8, true), s4 = n5.getBigUint64(16, true);
        Object.assign(e4, { rawLastModDate: r5, rawLastAccessDate: a4, rawCreationDate: s4 });
        const o4 = Yt(r5), l4 = Yt(a4), c3 = { lastModDate: o4, lastAccessDate: l4, creationDate: Yt(s4) };
        Object.assign(e4, c3), Object.assign(t4, c3);
      }
    } catch (e5) {
    }
  })(_2, t3), t3.extraFieldNTFS = _2);
  const w2 = s3.get(21589);
  w2 && (!(function(e4, t4, n4) {
    const i4 = rn(e4.data), r4 = $t(i4, 0), a4 = [], s4 = [];
    n4 ? (1 & ~r4 || (a4.push(Et), s4.push(Ft)), 2 & ~r4 || (a4.push(Tt), s4.push(Ot)), 4 & ~r4 || (a4.push(Ct), s4.push(Wt))) : e4.data.length >= 5 && (a4.push(Et), s4.push(Ft));
    let o4 = 1;
    a4.forEach(((n5, r5) => {
      if (e4.data.length >= o4 + 4) {
        const a5 = tn(i4, o4);
        t4[n5] = e4[n5] = new Date(1e3 * a5);
        const l4 = s4[r5];
        e4[l4] = a5;
      }
      o4 += 4;
    }));
  })(w2, t3, r3), t3.extraFieldExtendedTimestamp = w2);
  const b3 = s3.get(6534);
  b3 && (t3.extraFieldUSDZ = b3);
}
function Jt(e3, t3, n3, i3, r3) {
  const a3 = rn(e3.data), s3 = new W();
  s3.append(r3[n3]);
  const o3 = rn(new Uint8Array(4));
  o3.setUint32(0, s3.get(), true);
  const l3 = tn(a3, 1);
  Object.assign(e3, { version: $t(a3, 0), [t3]: yt(e3.data.subarray(5)), valid: !r3.bitFlag.languageEncodingFlag && l3 == tn(o3, 0) }), e3.valid && (i3[t3] = e3[t3], i3[t3 + "UTF8"] = true);
}
function Qt(e3, t3, n3) {
  return t3[n3] === S ? e3.options[n3] : t3[n3];
}
function Xt(e3) {
  const t3 = (4294901760 & e3) >> 16, n3 = 65535 & e3;
  try {
    return new Date(1980 + ((65024 & t3) >> 9), ((480 & t3) >> 5) - 1, 31 & t3, (63488 & n3) >> 11, (2016 & n3) >> 5, 2 * (31 & n3), 0);
  } catch (e4) {
  }
}
function Yt(e3) {
  return new Date(Number(e3 / BigInt(1e4) - BigInt(116444736e5)));
}
function $t(e3, t3) {
  return e3.getUint8(t3);
}
function en(e3, t3) {
  return e3.getUint16(t3, true);
}
function tn(e3, t3) {
  return e3.getUint32(t3, true);
}
function nn(e3, t3) {
  return Number(e3.getBigUint64(t3, true));
}
function rn(e3) {
  return new DataView(e3.buffer);
}
var e, t, n, i, r, a, s, o, l, c, u, h, w, b, g, y, x, k, v, S, z, A, U, D, E, F, C, W, j, M, L, P, R, B, I, N, V, q, H, K, G, J, Q, X, Y, $, ee, te, ne, ie, re, ae, se, oe, le, ce, ue, de, fe, he, xe, ke, ve, Te, Oe, Ce, Pe, Re, Be, Ie, Ne, Ve, qe, He, Ke, Ze, Ge, Ye, $e, tt, nt, it, st, ot, lt, ct, ut, dt, ft, ht, _t, mt, gt, xt, kt, vt, St, zt, At, Ut, Dt, Et, Ft, Tt, Ot, Ct, Wt, jt, Mt, Lt, Pt, Rt, Bt, It, Nt, Vt, qt, Ht, Kt;
var init_zip = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/vendor/zip.js"() {
    e = -2;
    t = -3;
    n = -5;
    i = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535];
    r = [96, 7, 256, 0, 8, 80, 0, 8, 16, 84, 8, 115, 82, 7, 31, 0, 8, 112, 0, 8, 48, 0, 9, 192, 80, 7, 10, 0, 8, 96, 0, 8, 32, 0, 9, 160, 0, 8, 0, 0, 8, 128, 0, 8, 64, 0, 9, 224, 80, 7, 6, 0, 8, 88, 0, 8, 24, 0, 9, 144, 83, 7, 59, 0, 8, 120, 0, 8, 56, 0, 9, 208, 81, 7, 17, 0, 8, 104, 0, 8, 40, 0, 9, 176, 0, 8, 8, 0, 8, 136, 0, 8, 72, 0, 9, 240, 80, 7, 4, 0, 8, 84, 0, 8, 20, 85, 8, 227, 83, 7, 43, 0, 8, 116, 0, 8, 52, 0, 9, 200, 81, 7, 13, 0, 8, 100, 0, 8, 36, 0, 9, 168, 0, 8, 4, 0, 8, 132, 0, 8, 68, 0, 9, 232, 80, 7, 8, 0, 8, 92, 0, 8, 28, 0, 9, 152, 84, 7, 83, 0, 8, 124, 0, 8, 60, 0, 9, 216, 82, 7, 23, 0, 8, 108, 0, 8, 44, 0, 9, 184, 0, 8, 12, 0, 8, 140, 0, 8, 76, 0, 9, 248, 80, 7, 3, 0, 8, 82, 0, 8, 18, 85, 8, 163, 83, 7, 35, 0, 8, 114, 0, 8, 50, 0, 9, 196, 81, 7, 11, 0, 8, 98, 0, 8, 34, 0, 9, 164, 0, 8, 2, 0, 8, 130, 0, 8, 66, 0, 9, 228, 80, 7, 7, 0, 8, 90, 0, 8, 26, 0, 9, 148, 84, 7, 67, 0, 8, 122, 0, 8, 58, 0, 9, 212, 82, 7, 19, 0, 8, 106, 0, 8, 42, 0, 9, 180, 0, 8, 10, 0, 8, 138, 0, 8, 74, 0, 9, 244, 80, 7, 5, 0, 8, 86, 0, 8, 22, 192, 8, 0, 83, 7, 51, 0, 8, 118, 0, 8, 54, 0, 9, 204, 81, 7, 15, 0, 8, 102, 0, 8, 38, 0, 9, 172, 0, 8, 6, 0, 8, 134, 0, 8, 70, 0, 9, 236, 80, 7, 9, 0, 8, 94, 0, 8, 30, 0, 9, 156, 84, 7, 99, 0, 8, 126, 0, 8, 62, 0, 9, 220, 82, 7, 27, 0, 8, 110, 0, 8, 46, 0, 9, 188, 0, 8, 14, 0, 8, 142, 0, 8, 78, 0, 9, 252, 96, 7, 256, 0, 8, 81, 0, 8, 17, 85, 8, 131, 82, 7, 31, 0, 8, 113, 0, 8, 49, 0, 9, 194, 80, 7, 10, 0, 8, 97, 0, 8, 33, 0, 9, 162, 0, 8, 1, 0, 8, 129, 0, 8, 65, 0, 9, 226, 80, 7, 6, 0, 8, 89, 0, 8, 25, 0, 9, 146, 83, 7, 59, 0, 8, 121, 0, 8, 57, 0, 9, 210, 81, 7, 17, 0, 8, 105, 0, 8, 41, 0, 9, 178, 0, 8, 9, 0, 8, 137, 0, 8, 73, 0, 9, 242, 80, 7, 4, 0, 8, 85, 0, 8, 21, 80, 8, 258, 83, 7, 43, 0, 8, 117, 0, 8, 53, 0, 9, 202, 81, 7, 13, 0, 8, 101, 0, 8, 37, 0, 9, 170, 0, 8, 5, 0, 8, 133, 0, 8, 69, 0, 9, 234, 80, 7, 8, 0, 8, 93, 0, 8, 29, 0, 9, 154, 84, 7, 83, 0, 8, 125, 0, 8, 61, 0, 9, 218, 82, 7, 23, 0, 8, 109, 0, 8, 45, 0, 9, 186, 0, 8, 13, 0, 8, 141, 0, 8, 77, 0, 9, 250, 80, 7, 3, 0, 8, 83, 0, 8, 19, 85, 8, 195, 83, 7, 35, 0, 8, 115, 0, 8, 51, 0, 9, 198, 81, 7, 11, 0, 8, 99, 0, 8, 35, 0, 9, 166, 0, 8, 3, 0, 8, 131, 0, 8, 67, 0, 9, 230, 80, 7, 7, 0, 8, 91, 0, 8, 27, 0, 9, 150, 84, 7, 67, 0, 8, 123, 0, 8, 59, 0, 9, 214, 82, 7, 19, 0, 8, 107, 0, 8, 43, 0, 9, 182, 0, 8, 11, 0, 8, 139, 0, 8, 75, 0, 9, 246, 80, 7, 5, 0, 8, 87, 0, 8, 23, 192, 8, 0, 83, 7, 51, 0, 8, 119, 0, 8, 55, 0, 9, 206, 81, 7, 15, 0, 8, 103, 0, 8, 39, 0, 9, 174, 0, 8, 7, 0, 8, 135, 0, 8, 71, 0, 9, 238, 80, 7, 9, 0, 8, 95, 0, 8, 31, 0, 9, 158, 84, 7, 99, 0, 8, 127, 0, 8, 63, 0, 9, 222, 82, 7, 27, 0, 8, 111, 0, 8, 47, 0, 9, 190, 0, 8, 15, 0, 8, 143, 0, 8, 79, 0, 9, 254, 96, 7, 256, 0, 8, 80, 0, 8, 16, 84, 8, 115, 82, 7, 31, 0, 8, 112, 0, 8, 48, 0, 9, 193, 80, 7, 10, 0, 8, 96, 0, 8, 32, 0, 9, 161, 0, 8, 0, 0, 8, 128, 0, 8, 64, 0, 9, 225, 80, 7, 6, 0, 8, 88, 0, 8, 24, 0, 9, 145, 83, 7, 59, 0, 8, 120, 0, 8, 56, 0, 9, 209, 81, 7, 17, 0, 8, 104, 0, 8, 40, 0, 9, 177, 0, 8, 8, 0, 8, 136, 0, 8, 72, 0, 9, 241, 80, 7, 4, 0, 8, 84, 0, 8, 20, 85, 8, 227, 83, 7, 43, 0, 8, 116, 0, 8, 52, 0, 9, 201, 81, 7, 13, 0, 8, 100, 0, 8, 36, 0, 9, 169, 0, 8, 4, 0, 8, 132, 0, 8, 68, 0, 9, 233, 80, 7, 8, 0, 8, 92, 0, 8, 28, 0, 9, 153, 84, 7, 83, 0, 8, 124, 0, 8, 60, 0, 9, 217, 82, 7, 23, 0, 8, 108, 0, 8, 44, 0, 9, 185, 0, 8, 12, 0, 8, 140, 0, 8, 76, 0, 9, 249, 80, 7, 3, 0, 8, 82, 0, 8, 18, 85, 8, 163, 83, 7, 35, 0, 8, 114, 0, 8, 50, 0, 9, 197, 81, 7, 11, 0, 8, 98, 0, 8, 34, 0, 9, 165, 0, 8, 2, 0, 8, 130, 0, 8, 66, 0, 9, 229, 80, 7, 7, 0, 8, 90, 0, 8, 26, 0, 9, 149, 84, 7, 67, 0, 8, 122, 0, 8, 58, 0, 9, 213, 82, 7, 19, 0, 8, 106, 0, 8, 42, 0, 9, 181, 0, 8, 10, 0, 8, 138, 0, 8, 74, 0, 9, 245, 80, 7, 5, 0, 8, 86, 0, 8, 22, 192, 8, 0, 83, 7, 51, 0, 8, 118, 0, 8, 54, 0, 9, 205, 81, 7, 15, 0, 8, 102, 0, 8, 38, 0, 9, 173, 0, 8, 6, 0, 8, 134, 0, 8, 70, 0, 9, 237, 80, 7, 9, 0, 8, 94, 0, 8, 30, 0, 9, 157, 84, 7, 99, 0, 8, 126, 0, 8, 62, 0, 9, 221, 82, 7, 27, 0, 8, 110, 0, 8, 46, 0, 9, 189, 0, 8, 14, 0, 8, 142, 0, 8, 78, 0, 9, 253, 96, 7, 256, 0, 8, 81, 0, 8, 17, 85, 8, 131, 82, 7, 31, 0, 8, 113, 0, 8, 49, 0, 9, 195, 80, 7, 10, 0, 8, 97, 0, 8, 33, 0, 9, 163, 0, 8, 1, 0, 8, 129, 0, 8, 65, 0, 9, 227, 80, 7, 6, 0, 8, 89, 0, 8, 25, 0, 9, 147, 83, 7, 59, 0, 8, 121, 0, 8, 57, 0, 9, 211, 81, 7, 17, 0, 8, 105, 0, 8, 41, 0, 9, 179, 0, 8, 9, 0, 8, 137, 0, 8, 73, 0, 9, 243, 80, 7, 4, 0, 8, 85, 0, 8, 21, 80, 8, 258, 83, 7, 43, 0, 8, 117, 0, 8, 53, 0, 9, 203, 81, 7, 13, 0, 8, 101, 0, 8, 37, 0, 9, 171, 0, 8, 5, 0, 8, 133, 0, 8, 69, 0, 9, 235, 80, 7, 8, 0, 8, 93, 0, 8, 29, 0, 9, 155, 84, 7, 83, 0, 8, 125, 0, 8, 61, 0, 9, 219, 82, 7, 23, 0, 8, 109, 0, 8, 45, 0, 9, 187, 0, 8, 13, 0, 8, 141, 0, 8, 77, 0, 9, 251, 80, 7, 3, 0, 8, 83, 0, 8, 19, 85, 8, 195, 83, 7, 35, 0, 8, 115, 0, 8, 51, 0, 9, 199, 81, 7, 11, 0, 8, 99, 0, 8, 35, 0, 9, 167, 0, 8, 3, 0, 8, 131, 0, 8, 67, 0, 9, 231, 80, 7, 7, 0, 8, 91, 0, 8, 27, 0, 9, 151, 84, 7, 67, 0, 8, 123, 0, 8, 59, 0, 9, 215, 82, 7, 19, 0, 8, 107, 0, 8, 43, 0, 9, 183, 0, 8, 11, 0, 8, 139, 0, 8, 75, 0, 9, 247, 80, 7, 5, 0, 8, 87, 0, 8, 23, 192, 8, 0, 83, 7, 51, 0, 8, 119, 0, 8, 55, 0, 9, 207, 81, 7, 15, 0, 8, 103, 0, 8, 39, 0, 9, 175, 0, 8, 7, 0, 8, 135, 0, 8, 71, 0, 9, 239, 80, 7, 9, 0, 8, 95, 0, 8, 31, 0, 9, 159, 84, 7, 99, 0, 8, 127, 0, 8, 63, 0, 9, 223, 82, 7, 27, 0, 8, 111, 0, 8, 47, 0, 9, 191, 0, 8, 15, 0, 8, 143, 0, 8, 79, 0, 9, 255];
    a = [80, 5, 1, 87, 5, 257, 83, 5, 17, 91, 5, 4097, 81, 5, 5, 89, 5, 1025, 85, 5, 65, 93, 5, 16385, 80, 5, 3, 88, 5, 513, 84, 5, 33, 92, 5, 8193, 82, 5, 9, 90, 5, 2049, 86, 5, 129, 192, 5, 24577, 80, 5, 2, 87, 5, 385, 83, 5, 25, 91, 5, 6145, 81, 5, 7, 89, 5, 1537, 85, 5, 97, 93, 5, 24577, 80, 5, 4, 88, 5, 769, 84, 5, 49, 92, 5, 12289, 82, 5, 13, 90, 5, 3073, 86, 5, 193, 192, 5, 24577];
    s = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0];
    o = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 112, 112];
    l = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    c = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    u = 15;
    d.inflate_trees_fixed = function(e3, t3, n3, i3) {
      return e3[0] = 9, t3[0] = 5, n3[0] = r, i3[0] = a, 0;
    };
    h = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    w = 13;
    b = [0, 0, 255, 255];
    m.prototype = { inflateInit(e3) {
      const t3 = this;
      return t3.istate = new p(), e3 || (e3 = 15), t3.istate.inflateInit(t3, e3);
    }, inflate(t3) {
      const n3 = this;
      return n3.istate ? n3.istate.inflate(n3, t3) : e;
    }, inflateEnd() {
      const t3 = this;
      if (!t3.istate) return e;
      const n3 = t3.istate.inflateEnd(t3);
      return t3.istate = null, n3;
    }, inflateSync() {
      const t3 = this;
      return t3.istate ? t3.istate.inflateSync(t3) : e;
    }, inflateSetDictionary(t3, n3) {
      const i3 = this;
      return i3.istate ? i3.istate.inflateSetDictionary(i3, t3, n3) : e;
    }, read_byte(e3) {
      return this.next_in[e3];
    }, read_buf(e3, t3) {
      return this.next_in.subarray(e3, e3 + t3);
    } };
    g = 4294967295;
    y = 65535;
    x = 33639248;
    k = 101075792;
    v = 22;
    S = void 0;
    z = "undefined";
    A = "function";
    U = class {
      constructor(e3) {
        return class extends TransformStream {
          constructor(t3, n3) {
            const i3 = new e3(n3);
            super({ transform(e4, t4) {
              t4.enqueue(i3.append(e4));
            }, flush(e4) {
              const t4 = i3.flush();
              t4 && e4.enqueue(t4);
            } });
          }
        };
      }
    };
    D = 2;
    try {
      typeof navigator != z && navigator.hardwareConcurrency && (D = navigator.hardwareConcurrency);
    } catch (e3) {
    }
    E = { chunkSize: 524288, maxWorkers: D, terminateWorkerTimeout: 5e3, useWebWorkers: true, useCompressionStream: true, workerScripts: S, CompressionStreamNative: typeof CompressionStream != z && CompressionStream, DecompressionStreamNative: typeof DecompressionStream != z && DecompressionStream };
    F = Object.assign({}, E);
    C = [];
    for (let e3 = 0; e3 < 256; e3++) {
      let t3 = e3;
      for (let e4 = 0; e4 < 8; e4++) 1 & t3 ? t3 = t3 >>> 1 ^ 3988292384 : t3 >>>= 1;
      C[e3] = t3;
    }
    W = class {
      constructor(e3) {
        this.crc = e3 || -1;
      }
      append(e3) {
        let t3 = 0 | this.crc;
        for (let n3 = 0, i3 = 0 | e3.length; n3 < i3; n3++) t3 = t3 >>> 8 ^ C[255 & (t3 ^ e3[n3])];
        this.crc = t3;
      }
      get() {
        return ~this.crc;
      }
    };
    j = class extends TransformStream {
      constructor() {
        let e3;
        const t3 = new W();
        super({ transform(e4, n3) {
          t3.append(e4), n3.enqueue(e4);
        }, flush() {
          const n3 = new Uint8Array(4);
          new DataView(n3.buffer).setUint32(0, t3.get()), e3.value = n3;
        } }), e3 = this;
      }
    };
    M = { concat(e3, t3) {
      if (0 === e3.length || 0 === t3.length) return e3.concat(t3);
      const n3 = e3[e3.length - 1], i3 = M.getPartial(n3);
      return 32 === i3 ? e3.concat(t3) : M._shiftRight(t3, i3, 0 | n3, e3.slice(0, e3.length - 1));
    }, bitLength(e3) {
      const t3 = e3.length;
      if (0 === t3) return 0;
      const n3 = e3[t3 - 1];
      return 32 * (t3 - 1) + M.getPartial(n3);
    }, clamp(e3, t3) {
      if (32 * e3.length < t3) return e3;
      const n3 = (e3 = e3.slice(0, Math.ceil(t3 / 32))).length;
      return t3 &= 31, n3 > 0 && t3 && (e3[n3 - 1] = M.partial(t3, e3[n3 - 1] & 2147483648 >> t3 - 1, 1)), e3;
    }, partial: (e3, t3, n3) => 32 === e3 ? t3 : (n3 ? 0 | t3 : t3 << 32 - e3) + 1099511627776 * e3, getPartial: (e3) => Math.round(e3 / 1099511627776) || 32, _shiftRight(e3, t3, n3, i3) {
      for (void 0 === i3 && (i3 = []); t3 >= 32; t3 -= 32) i3.push(n3), n3 = 0;
      if (0 === t3) return i3.concat(e3);
      for (let r4 = 0; r4 < e3.length; r4++) i3.push(n3 | e3[r4] >>> t3), n3 = e3[r4] << 32 - t3;
      const r3 = e3.length ? e3[e3.length - 1] : 0, a3 = M.getPartial(r3);
      return i3.push(M.partial(t3 + a3 & 31, t3 + a3 > 32 ? n3 : i3.pop(), 1)), i3;
    } };
    L = { bytes: { fromBits(e3) {
      const t3 = M.bitLength(e3) / 8, n3 = new Uint8Array(t3);
      let i3;
      for (let r3 = 0; r3 < t3; r3++) 3 & r3 || (i3 = e3[r3 / 4]), n3[r3] = i3 >>> 24, i3 <<= 8;
      return n3;
    }, toBits(e3) {
      const t3 = [];
      let n3, i3 = 0;
      for (n3 = 0; n3 < e3.length; n3++) i3 = i3 << 8 | e3[n3], 3 & ~n3 || (t3.push(i3), i3 = 0);
      return 3 & n3 && t3.push(M.partial(8 * (3 & n3), i3)), t3;
    } } };
    P = { sha1: class {
      constructor(e3) {
        const t3 = this;
        t3.blockSize = 512, t3._init = [1732584193, 4023233417, 2562383102, 271733878, 3285377520], t3._key = [1518500249, 1859775393, 2400959708, 3395469782], e3 ? (t3._h = e3._h.slice(0), t3._buffer = e3._buffer.slice(0), t3._length = e3._length) : t3.reset();
      }
      reset() {
        const e3 = this;
        return e3._h = e3._init.slice(0), e3._buffer = [], e3._length = 0, e3;
      }
      update(e3) {
        const t3 = this;
        "string" == typeof e3 && (e3 = L.utf8String.toBits(e3));
        const n3 = t3._buffer = M.concat(t3._buffer, e3), i3 = t3._length, r3 = t3._length = i3 + M.bitLength(e3);
        if (r3 > 9007199254740991) throw new Error("Cannot hash more than 2^53 - 1 bits");
        const a3 = new Uint32Array(n3);
        let s3 = 0;
        for (let e4 = t3.blockSize + i3 - (t3.blockSize + i3 & t3.blockSize - 1); e4 <= r3; e4 += t3.blockSize) t3._block(a3.subarray(16 * s3, 16 * (s3 + 1))), s3 += 1;
        return n3.splice(0, 16 * s3), t3;
      }
      finalize() {
        const e3 = this;
        let t3 = e3._buffer;
        const n3 = e3._h;
        t3 = M.concat(t3, [M.partial(1, 1)]);
        for (let e4 = t3.length + 2; 15 & e4; e4++) t3.push(0);
        for (t3.push(Math.floor(e3._length / 4294967296)), t3.push(0 | e3._length); t3.length; ) e3._block(t3.splice(0, 16));
        return e3.reset(), n3;
      }
      _f(e3, t3, n3, i3) {
        return e3 <= 19 ? t3 & n3 | ~t3 & i3 : e3 <= 39 ? t3 ^ n3 ^ i3 : e3 <= 59 ? t3 & n3 | t3 & i3 | n3 & i3 : e3 <= 79 ? t3 ^ n3 ^ i3 : void 0;
      }
      _S(e3, t3) {
        return t3 << e3 | t3 >>> 32 - e3;
      }
      _block(e3) {
        const t3 = this, n3 = t3._h, i3 = Array(80);
        for (let t4 = 0; t4 < 16; t4++) i3[t4] = e3[t4];
        let r3 = n3[0], a3 = n3[1], s3 = n3[2], o3 = n3[3], l3 = n3[4];
        for (let e4 = 0; e4 <= 79; e4++) {
          e4 >= 16 && (i3[e4] = t3._S(1, i3[e4 - 3] ^ i3[e4 - 8] ^ i3[e4 - 14] ^ i3[e4 - 16]));
          const n4 = t3._S(5, r3) + t3._f(e4, a3, s3, o3) + l3 + i3[e4] + t3._key[Math.floor(e4 / 20)] | 0;
          l3 = o3, o3 = s3, s3 = t3._S(30, a3), a3 = r3, r3 = n4;
        }
        n3[0] = n3[0] + r3 | 0, n3[1] = n3[1] + a3 | 0, n3[2] = n3[2] + s3 | 0, n3[3] = n3[3] + o3 | 0, n3[4] = n3[4] + l3 | 0;
      }
    } };
    R = { aes: class {
      constructor(e3) {
        const t3 = this;
        t3._tables = [[[], [], [], [], []], [[], [], [], [], []]], t3._tables[0][0][0] || t3._precompute();
        const n3 = t3._tables[0][4], i3 = t3._tables[1], r3 = e3.length;
        let a3, s3, o3, l3 = 1;
        if (4 !== r3 && 6 !== r3 && 8 !== r3) throw new Error("invalid aes key size");
        for (t3._key = [s3 = e3.slice(0), o3 = []], a3 = r3; a3 < 4 * r3 + 28; a3++) {
          let e4 = s3[a3 - 1];
          (a3 % r3 == 0 || 8 === r3 && a3 % r3 == 4) && (e4 = n3[e4 >>> 24] << 24 ^ n3[e4 >> 16 & 255] << 16 ^ n3[e4 >> 8 & 255] << 8 ^ n3[255 & e4], a3 % r3 == 0 && (e4 = e4 << 8 ^ e4 >>> 24 ^ l3 << 24, l3 = l3 << 1 ^ 283 * (l3 >> 7))), s3[a3] = s3[a3 - r3] ^ e4;
        }
        for (let e4 = 0; a3; e4++, a3--) {
          const t4 = s3[3 & e4 ? a3 : a3 - 4];
          o3[e4] = a3 <= 4 || e4 < 4 ? t4 : i3[0][n3[t4 >>> 24]] ^ i3[1][n3[t4 >> 16 & 255]] ^ i3[2][n3[t4 >> 8 & 255]] ^ i3[3][n3[255 & t4]];
        }
      }
      encrypt(e3) {
        return this._crypt(e3, 0);
      }
      decrypt(e3) {
        return this._crypt(e3, 1);
      }
      _precompute() {
        const e3 = this._tables[0], t3 = this._tables[1], n3 = e3[4], i3 = t3[4], r3 = [], a3 = [];
        let s3, o3, l3, c2;
        for (let e4 = 0; e4 < 256; e4++) a3[(r3[e4] = e4 << 1 ^ 283 * (e4 >> 7)) ^ e4] = e4;
        for (let u2 = s3 = 0; !n3[u2]; u2 ^= o3 || 1, s3 = a3[s3] || 1) {
          let a4 = s3 ^ s3 << 1 ^ s3 << 2 ^ s3 << 3 ^ s3 << 4;
          a4 = a4 >> 8 ^ 255 & a4 ^ 99, n3[u2] = a4, i3[a4] = u2, c2 = r3[l3 = r3[o3 = r3[u2]]];
          let d2 = 16843009 * c2 ^ 65537 * l3 ^ 257 * o3 ^ 16843008 * u2, f3 = 257 * r3[a4] ^ 16843008 * a4;
          for (let n4 = 0; n4 < 4; n4++) e3[n4][u2] = f3 = f3 << 24 ^ f3 >>> 8, t3[n4][a4] = d2 = d2 << 24 ^ d2 >>> 8;
        }
        for (let n4 = 0; n4 < 5; n4++) e3[n4] = e3[n4].slice(0), t3[n4] = t3[n4].slice(0);
      }
      _crypt(e3, t3) {
        if (4 !== e3.length) throw new Error("invalid aes block size");
        const n3 = this._key[t3], i3 = n3.length / 4 - 2, r3 = [0, 0, 0, 0], a3 = this._tables[t3], s3 = a3[0], o3 = a3[1], l3 = a3[2], c2 = a3[3], u2 = a3[4];
        let d2, f3, h3, _2 = e3[0] ^ n3[0], w2 = e3[t3 ? 3 : 1] ^ n3[1], b3 = e3[2] ^ n3[2], p3 = e3[t3 ? 1 : 3] ^ n3[3], m3 = 4;
        for (let e4 = 0; e4 < i3; e4++) d2 = s3[_2 >>> 24] ^ o3[w2 >> 16 & 255] ^ l3[b3 >> 8 & 255] ^ c2[255 & p3] ^ n3[m3], f3 = s3[w2 >>> 24] ^ o3[b3 >> 16 & 255] ^ l3[p3 >> 8 & 255] ^ c2[255 & _2] ^ n3[m3 + 1], h3 = s3[b3 >>> 24] ^ o3[p3 >> 16 & 255] ^ l3[_2 >> 8 & 255] ^ c2[255 & w2] ^ n3[m3 + 2], p3 = s3[p3 >>> 24] ^ o3[_2 >> 16 & 255] ^ l3[w2 >> 8 & 255] ^ c2[255 & b3] ^ n3[m3 + 3], m3 += 4, _2 = d2, w2 = f3, b3 = h3;
        for (let e4 = 0; e4 < 4; e4++) r3[t3 ? 3 & -e4 : e4] = u2[_2 >>> 24] << 24 ^ u2[w2 >> 16 & 255] << 16 ^ u2[b3 >> 8 & 255] << 8 ^ u2[255 & p3] ^ n3[m3++], d2 = _2, _2 = w2, w2 = b3, b3 = p3, p3 = d2;
        return r3;
      }
    } };
    B = { getRandomValues(e3) {
      const t3 = new Uint32Array(e3.buffer), n3 = (e4) => {
        let t4 = 987654321;
        const n4 = 4294967295;
        return function() {
          t4 = 36969 * (65535 & t4) + (t4 >> 16) & n4;
          return (((t4 << 16) + (e4 = 18e3 * (65535 & e4) + (e4 >> 16) & n4) & n4) / 4294967296 + 0.5) * (Math.random() > 0.5 ? 1 : -1);
        };
      };
      for (let i3, r3 = 0; r3 < e3.length; r3 += 4) {
        const e4 = n3(4294967296 * (i3 || Math.random()));
        i3 = 987654071 * e4(), t3[r3 / 4] = 4294967296 * e4() | 0;
      }
      return e3;
    } };
    I = { ctrGladman: class {
      constructor(e3, t3) {
        this._prf = e3, this._initIv = t3, this._iv = t3;
      }
      reset() {
        this._iv = this._initIv;
      }
      update(e3) {
        return this.calculate(this._prf, e3, this._iv);
      }
      incWord(e3) {
        if (255 & ~(e3 >> 24)) e3 += 1 << 24;
        else {
          let t3 = e3 >> 16 & 255, n3 = e3 >> 8 & 255, i3 = 255 & e3;
          255 === t3 ? (t3 = 0, 255 === n3 ? (n3 = 0, 255 === i3 ? i3 = 0 : ++i3) : ++n3) : ++t3, e3 = 0, e3 += t3 << 16, e3 += n3 << 8, e3 += i3;
        }
        return e3;
      }
      incCounter(e3) {
        0 === (e3[0] = this.incWord(e3[0])) && (e3[1] = this.incWord(e3[1]));
      }
      calculate(e3, t3, n3) {
        let i3;
        if (!(i3 = t3.length)) return [];
        const r3 = M.bitLength(t3);
        for (let r4 = 0; r4 < i3; r4 += 4) {
          this.incCounter(n3);
          const i4 = e3.encrypt(n3);
          t3[r4] ^= i4[0], t3[r4 + 1] ^= i4[1], t3[r4 + 2] ^= i4[2], t3[r4 + 3] ^= i4[3];
        }
        return M.clamp(t3, r3);
      }
    } };
    N = { importKey: (e3) => new N.hmacSha1(L.bytes.toBits(e3)), pbkdf2(e3, t3, n3, i3) {
      if (n3 = n3 || 1e4, i3 < 0 || n3 < 0) throw new Error("invalid params to pbkdf2");
      const r3 = 1 + (i3 >> 5) << 2;
      let a3, s3, o3, l3, c2;
      const u2 = new ArrayBuffer(r3), d2 = new DataView(u2);
      let f3 = 0;
      const h3 = M;
      for (t3 = L.bytes.toBits(t3), c2 = 1; f3 < (r3 || 1); c2++) {
        for (a3 = s3 = e3.encrypt(h3.concat(t3, [c2])), o3 = 1; o3 < n3; o3++) for (s3 = e3.encrypt(s3), l3 = 0; l3 < s3.length; l3++) a3[l3] ^= s3[l3];
        for (o3 = 0; f3 < (r3 || 1) && o3 < a3.length; o3++) d2.setInt32(f3, a3[o3]), f3 += 4;
      }
      return u2.slice(0, i3 / 8);
    }, hmacSha1: class {
      constructor(e3) {
        const t3 = this, n3 = t3._hash = P.sha1, i3 = [[], []];
        t3._baseHash = [new n3(), new n3()];
        const r3 = t3._baseHash[0].blockSize / 32;
        e3.length > r3 && (e3 = new n3().update(e3).finalize());
        for (let t4 = 0; t4 < r3; t4++) i3[0][t4] = 909522486 ^ e3[t4], i3[1][t4] = 1549556828 ^ e3[t4];
        t3._baseHash[0].update(i3[0]), t3._baseHash[1].update(i3[1]), t3._resultHash = new n3(t3._baseHash[0]);
      }
      reset() {
        const e3 = this;
        e3._resultHash = new e3._hash(e3._baseHash[0]), e3._updated = false;
      }
      update(e3) {
        this._updated = true, this._resultHash.update(e3);
      }
      digest() {
        const e3 = this, t3 = e3._resultHash.finalize(), n3 = new e3._hash(e3._baseHash[1]).update(t3).finalize();
        return e3.reset(), n3;
      }
      encrypt(e3) {
        if (this._updated) throw new Error("encrypt on already updated hmac called!");
        return this.update(e3), this.digest(e3);
      }
    } };
    V = typeof crypto != z && typeof crypto.getRandomValues == A;
    q = "Invalid password";
    H = "Invalid signature";
    K = "zipjs-abort-check-password";
    G = 16;
    J = { name: "PBKDF2" };
    Q = Object.assign({ hash: { name: "HMAC" } }, J);
    X = Object.assign({ iterations: 1e3, hash: { name: "SHA-1" } }, J);
    Y = ["deriveBits"];
    $ = [8, 12, 16];
    ee = [16, 24, 32];
    te = 10;
    ne = [0, 0, 0, 0];
    ie = typeof crypto != z;
    re = ie && crypto.subtle;
    ae = ie && typeof re != z;
    se = L.bytes;
    oe = R.aes;
    le = I.ctrGladman;
    ce = N.hmacSha1;
    ue = ie && ae && typeof re.importKey == A;
    de = ie && ae && typeof re.deriveBits == A;
    fe = class extends TransformStream {
      constructor({ password: e3, rawPassword: t3, signed: n3, encryptionStrength: i3, checkPasswordOnly: r3 }) {
        super({ start() {
          Object.assign(this, { ready: new Promise(((e4) => this.resolveReady = e4)), password: be(e3, t3), signed: n3, strength: i3 - 1, pending: new Uint8Array() });
        }, async transform(e4, t4) {
          const n4 = this, { password: i4, strength: a3, resolveReady: s3, ready: o3 } = n4;
          i4 ? (await (async function(e5, t5, n5, i5) {
            const r4 = await we(e5, t5, n5, me(i5, 0, $[t5])), a4 = me(i5, $[t5]);
            if (r4[0] != a4[0] || r4[1] != a4[1]) throw new Error(q);
          })(n4, a3, i4, me(e4, 0, $[a3] + 2)), e4 = me(e4, $[a3] + 2), r3 ? t4.error(new Error(K)) : s3()) : await o3;
          const l3 = new Uint8Array(e4.length - te - (e4.length - te) % G);
          t4.enqueue(_e(n4, e4, l3, 0, te, true));
        }, async flush(e4) {
          const { signed: t4, ctr: n4, hmac: i4, pending: r4, ready: a3 } = this;
          if (i4 && n4) {
            await a3;
            const s3 = me(r4, 0, r4.length - te), o3 = me(r4, r4.length - te);
            let l3 = new Uint8Array();
            if (s3.length) {
              const e5 = ye(se, s3);
              i4.update(e5);
              const t5 = n4.update(e5);
              l3 = ge(se, t5);
            }
            if (t4) {
              const e5 = me(ge(se, i4.digest()), 0, te);
              for (let t5 = 0; t5 < te; t5++) if (e5[t5] != o3[t5]) throw new Error(H);
            }
            e4.enqueue(l3);
          }
        } });
      }
    };
    he = class extends TransformStream {
      constructor({ password: e3, rawPassword: t3, encryptionStrength: n3 }) {
        let i3;
        super({ start() {
          Object.assign(this, { ready: new Promise(((e4) => this.resolveReady = e4)), password: be(e3, t3), strength: n3 - 1, pending: new Uint8Array() });
        }, async transform(e4, t4) {
          const n4 = this, { password: i4, strength: r3, resolveReady: a3, ready: s3 } = n4;
          let o3 = new Uint8Array();
          i4 ? (o3 = await (async function(e5, t5, n5) {
            const i5 = Z(new Uint8Array($[t5])), r4 = await we(e5, t5, n5, i5);
            return pe(i5, r4);
          })(n4, r3, i4), a3()) : await s3;
          const l3 = new Uint8Array(o3.length + e4.length - e4.length % G);
          l3.set(o3, 0), t4.enqueue(_e(n4, e4, l3, o3.length, 0));
        }, async flush(e4) {
          const { ctr: t4, hmac: n4, pending: r3, ready: a3 } = this;
          if (n4 && t4) {
            await a3;
            let s3 = new Uint8Array();
            if (r3.length) {
              const e5 = t4.update(ye(se, r3));
              n4.update(e5), s3 = ge(se, e5);
            }
            i3.signature = ge(se, n4.digest()).slice(0, te), e4.enqueue(pe(s3, i3.signature));
          }
        } }), i3 = this;
      }
    };
    xe = 12;
    ke = class extends TransformStream {
      constructor({ password: e3, passwordVerification: t3, checkPasswordOnly: n3 }) {
        super({ start() {
          Object.assign(this, { password: e3, passwordVerification: t3 }), Ae(this, e3);
        }, transform(e4, t4) {
          const i3 = this;
          if (i3.password) {
            const t5 = Se(i3, e4.subarray(0, xe));
            if (i3.password = null, t5[11] != i3.passwordVerification) throw new Error(q);
            e4 = e4.subarray(xe);
          }
          n3 ? t4.error(new Error(K)) : t4.enqueue(Se(i3, e4));
        } });
      }
    };
    ve = class extends TransformStream {
      constructor({ password: e3, passwordVerification: t3 }) {
        super({ start() {
          Object.assign(this, { password: e3, passwordVerification: t3 }), Ae(this, e3);
        }, transform(e4, t4) {
          const n3 = this;
          let i3, r3;
          if (n3.password) {
            n3.password = null;
            const t5 = Z(new Uint8Array(xe));
            t5[11] = n3.passwordVerification, i3 = new Uint8Array(e4.length + t5.length), i3.set(ze(n3, t5), 0), r3 = xe;
          } else i3 = new Uint8Array(e4.length), r3 = 0;
          i3.set(ze(n3, e4), r3), t4.enqueue(i3);
        } });
      }
    };
    Te = "deflate-raw";
    Oe = class extends TransformStream {
      constructor(e3, { chunkSize: t3, CompressionStream: n3, CompressionStreamNative: i3 }) {
        super({});
        const { compressed: r3, encrypted: a3, useCompressionStream: s3, zipCrypto: o3, signed: l3, level: c2 } = e3, u2 = this;
        let d2, f3, h3 = We(super.readable);
        a3 && !o3 || !l3 || (d2 = new j(), h3 = Le(h3, d2)), r3 && (h3 = Me(h3, s3, { level: c2, chunkSize: t3 }, i3, n3)), a3 && (o3 ? h3 = Le(h3, new ve(e3)) : (f3 = new he(e3), h3 = Le(h3, f3))), je(u2, h3, (() => {
          let e4;
          a3 && !o3 && (e4 = f3.signature), a3 && !o3 || !l3 || (e4 = new DataView(d2.value.buffer).getUint32(0)), u2.signature = e4;
        }));
      }
    };
    Ce = class extends TransformStream {
      constructor(e3, { chunkSize: t3, DecompressionStream: n3, DecompressionStreamNative: i3 }) {
        super({});
        const { zipCrypto: r3, encrypted: a3, signed: s3, signature: o3, compressed: l3, useCompressionStream: c2 } = e3;
        let u2, d2, f3 = We(super.readable);
        a3 && (r3 ? f3 = Le(f3, new ke(e3)) : (d2 = new fe(e3), f3 = Le(f3, d2))), l3 && (f3 = Me(f3, c2, { chunkSize: t3 }, i3, n3)), a3 && !r3 || !s3 || (u2 = new j(), f3 = Le(f3, u2)), je(this, f3, (() => {
          if ((!a3 || r3) && s3) {
            const e4 = new DataView(u2.value.buffer);
            if (o3 != e4.getUint32(0, false)) throw new Error(H);
          }
        }));
      }
    };
    Pe = "message";
    Re = "start";
    Be = "pull";
    Ie = "data";
    Ne = "close";
    Ve = "inflate";
    qe = class extends TransformStream {
      constructor(e3, t3) {
        super({});
        const n3 = this, { codecType: i3 } = e3;
        let r3;
        i3.startsWith("deflate") ? r3 = Oe : i3.startsWith(Ve) && (r3 = Ce);
        let a3 = 0, s3 = 0;
        const o3 = new r3(e3, t3), l3 = super.readable, c2 = new TransformStream({ transform(e4, t4) {
          e4 && e4.length && (s3 += e4.length, t4.enqueue(e4));
        }, flush() {
          Object.assign(n3, { inputSize: s3 });
        } }), u2 = new TransformStream({ transform(e4, t4) {
          e4 && e4.length && (a3 += e4.length, t4.enqueue(e4));
        }, flush() {
          const { signature: e4 } = o3;
          Object.assign(n3, { signature: e4, outputSize: a3, inputSize: s3 });
        } });
        Object.defineProperty(n3, "readable", { get: () => l3.pipeThrough(c2).pipeThrough(o3).pipeThrough(u2) });
      }
    };
    He = class extends TransformStream {
      constructor(e3) {
        let t3;
        super({ transform: function n3(i3, r3) {
          if (t3) {
            const e4 = new Uint8Array(t3.length + i3.length);
            e4.set(t3), e4.set(i3, t3.length), i3 = e4, t3 = null;
          }
          i3.length > e3 ? (r3.enqueue(i3.slice(0, e3)), n3(i3.slice(e3), r3)) : t3 = i3;
        }, flush(e4) {
          t3 && t3.length && e4.enqueue(t3);
        } });
      }
    };
    Ke = typeof Worker != z;
    Ze = class {
      constructor(e3, { readable: t3, writable: n3 }, { options: i3, config: r3, streamOptions: a3, useWebWorkers: s3, transferStreams: o3, scripts: l3 }, c2) {
        const { signal: u2 } = a3;
        return Object.assign(e3, { busy: true, readable: t3.pipeThrough(new He(r3.chunkSize)).pipeThrough(new Ge(t3, a3), { signal: u2 }), writable: n3, options: Object.assign({}, i3), scripts: l3, transferStreams: o3, terminate: () => new Promise(((t4) => {
          const { worker: n4, busy: i4 } = e3;
          n4 ? (i4 ? e3.resolveTerminated = t4 : (n4.terminate(), t4()), e3.interface = null) : t4();
        })), onTaskFinished() {
          const { resolveTerminated: t4 } = e3;
          t4 && (e3.resolveTerminated = null, e3.terminated = true, e3.worker.terminate(), t4()), e3.busy = false, c2(e3);
        } }), (s3 && Ke ? Xe : Qe)(e3, r3);
      }
    };
    Ge = class extends TransformStream {
      constructor(e3, { onstart: t3, onprogress: n3, size: i3, onend: r3 }) {
        let a3 = 0;
        super({ async start() {
          t3 && await Je(t3, i3);
        }, async transform(e4, t4) {
          a3 += e4.length, n3 && await Je(n3, a3, i3), t4.enqueue(e4);
        }, async flush() {
          e3.size = a3, r3 && await Je(r3, a3);
        } });
      }
    };
    Ye = true;
    $e = true;
    tt = [];
    nt = [];
    it = 0;
    st = 65536;
    ot = "writable";
    lt = class {
      constructor() {
        this.size = 0;
      }
      init() {
        this.initialized = true;
      }
    };
    ct = class extends lt {
      get readable() {
        const e3 = this, { chunkSize: t3 = st } = e3, n3 = new ReadableStream({ start() {
          this.chunkOffset = 0;
        }, async pull(i3) {
          const { offset: r3 = 0, size: a3, diskNumberStart: s3 } = n3, { chunkOffset: o3 } = this, l3 = a3 === S ? t3 : Math.min(t3, a3 - o3), c2 = await pt(e3, r3 + o3, l3, s3);
          i3.enqueue(c2), o3 + t3 > a3 || a3 === S && !c2.length && l3 ? i3.close() : this.chunkOffset += t3;
        } });
        return n3;
      }
    };
    ut = class extends ct {
      constructor(e3) {
        super(), Object.assign(this, { blob: e3, size: e3.size });
      }
      async readUint8Array(e3, t3) {
        const n3 = this, i3 = e3 + t3, r3 = e3 || i3 < n3.size ? n3.blob.slice(e3, i3) : n3.blob;
        let a3 = await r3.arrayBuffer();
        return a3.byteLength > t3 && (a3 = a3.slice(e3, i3)), new Uint8Array(a3);
      }
    };
    dt = class extends lt {
      constructor(e3) {
        super();
        const t3 = new TransformStream(), n3 = [];
        e3 && n3.push(["Content-Type", e3]), Object.defineProperty(this, ot, { get: () => t3.writable }), this.blob = new Response(t3.readable, { headers: n3 }).blob();
      }
      getData() {
        return this.blob;
      }
    };
    ft = class extends dt {
      constructor(e3) {
        super(e3), Object.assign(this, { encoding: e3, utf8: !e3 || "utf-8" == e3.toLowerCase() });
      }
      async getData() {
        const { encoding: e3, utf8: t3 } = this, n3 = await super.getData();
        if (n3.text && t3) return n3.text();
        {
          const t4 = new FileReader();
          return new Promise(((i3, r3) => {
            Object.assign(t4, { onload: ({ target: e4 }) => i3(e4.result), onerror: () => r3(t4.error) }), t4.readAsText(n3, e3);
          }));
        }
      }
    };
    ht = class extends ct {
      constructor(e3) {
        super(), this.readers = e3;
      }
      async init() {
        const e3 = this, { readers: t3 } = e3;
        e3.lastDiskNumber = 0, e3.lastDiskOffset = 0, await Promise.all(t3.map((async (n3, i3) => {
          await n3.init(), i3 != t3.length - 1 && (e3.lastDiskOffset += n3.size), e3.size += n3.size;
        }))), super.init();
      }
      async readUint8Array(e3, t3, n3 = 0) {
        const i3 = this, { readers: r3 } = this;
        let a3, s3 = n3;
        -1 == s3 && (s3 = r3.length - 1);
        let o3 = e3;
        for (; o3 >= r3[s3].size; ) o3 -= r3[s3].size, s3++;
        const l3 = r3[s3], c2 = l3.size;
        if (o3 + t3 <= c2) a3 = await pt(l3, o3, t3);
        else {
          const r4 = c2 - o3;
          a3 = new Uint8Array(t3), a3.set(await pt(l3, o3, r4)), a3.set(await i3.readUint8Array(e3 + r4, t3 - r4, n3), r4);
        }
        return i3.lastDiskNumber = Math.max(s3, i3.lastDiskNumber), a3;
      }
    };
    _t = class extends lt {
      constructor(e3, t3 = 4294967295) {
        super();
        const n3 = this;
        let i3, r3, a3;
        Object.assign(n3, { diskNumber: 0, diskOffset: 0, size: 0, maxSize: t3, availableSize: t3 });
        const s3 = new WritableStream({ async write(t4) {
          const { availableSize: s4 } = n3;
          if (a3) t4.length >= s4 ? (await o3(t4.slice(0, s4)), await l3(), n3.diskOffset += i3.size, n3.diskNumber++, a3 = null, await this.write(t4.slice(s4))) : await o3(t4);
          else {
            const { value: s5, done: o4 } = await e3.next();
            if (o4 && !s5) throw new Error("Writer iterator completed too soon");
            i3 = s5, i3.size = 0, i3.maxSize && (n3.maxSize = i3.maxSize), n3.availableSize = n3.maxSize, await wt(i3), r3 = s5.writable, a3 = r3.getWriter(), await this.write(t4);
          }
        }, async close() {
          await a3.ready, await l3();
        } });
        async function o3(e4) {
          const t4 = e4.length;
          t4 && (await a3.ready, await a3.write(e4), i3.size += t4, n3.size += t4, n3.availableSize -= t4);
        }
        async function l3() {
          r3.size = i3.size, await a3.close();
        }
        Object.defineProperty(n3, ot, { get: () => s3 });
      }
    };
    mt = "\0\u263A\u263B\u2665\u2666\u2663\u2660\u2022\u25D8\u25CB\u25D9\u2642\u2640\u266A\u266B\u263C\u25BA\u25C4\u2195\u203C\xB6\xA7\u25AC\u21A8\u2191\u2193\u2192\u2190\u221F\u2194\u25B2\u25BC !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u2302\xC7\xFC\xE9\xE2\xE4\xE0\xE5\xE7\xEA\xEB\xE8\xEF\xEE\xEC\xC4\xC5\xC9\xE6\xC6\xF4\xF6\xF2\xFB\xF9\xFF\xD6\xDC\xA2\xA3\xA5\u20A7\u0192\xE1\xED\xF3\xFA\xF1\xD1\xAA\xBA\xBF\u2310\xAC\xBD\xBC\xA1\xAB\xBB\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580\u03B1\xDF\u0393\u03C0\u03A3\u03C3\xB5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229\u2261\xB1\u2265\u2264\u2320\u2321\xF7\u2248\xB0\u2219\xB7\u221A\u207F\xB2\u25A0 ".split("");
    gt = 256 == mt.length;
    xt = "filename";
    kt = "rawFilename";
    vt = "comment";
    St = "rawComment";
    zt = "uncompressedSize";
    At = "compressedSize";
    Ut = "offset";
    Dt = "diskNumberStart";
    Et = "lastModDate";
    Ft = "rawLastModDate";
    Tt = "lastAccessDate";
    Ot = "rawLastAccessDate";
    Ct = "creationDate";
    Wt = "rawCreationDate";
    jt = [xt, kt, At, zt, Et, Ft, vt, St, Tt, Ct, Ut, Dt, Dt, "internalFileAttribute", "internalFileAttributes", "externalFileAttribute", "externalFileAttributes", "msDosCompatible", "zip64", "encrypted", "version", "versionMadeBy", "zipCrypto", "directory", "executable", "bitFlag", "signature", "filenameUTF8", "commentUTF8", "compressionMethod", "extraField", "rawExtraField", "extraFieldZip64", "extraFieldUnicodePath", "extraFieldUnicodeComment", "extraFieldAES", "extraFieldNTFS", "extraFieldExtendedTimestamp"];
    Mt = class {
      constructor(e3) {
        jt.forEach(((t3) => this[t3] = e3[t3]));
      }
    };
    Lt = "File format is not recognized";
    Pt = "Zip64 extra field not found";
    Rt = "Compression method not supported";
    Bt = "Split zip file";
    It = "utf-8";
    Nt = "cp437";
    Vt = [[zt, g], [At, g], [Ut, g], [Dt, y]];
    qt = { [y]: { getValue: tn, bytes: 4 }, [g]: { getValue: nn, bytes: 8 } };
    Ht = class {
      constructor(e3, t3 = {}) {
        Object.assign(this, { reader: bt(e3), options: t3, config: F });
      }
      async *getEntriesGenerator(e3 = {}) {
        const t3 = this;
        let { reader: n3 } = t3;
        const { config: i3 } = t3;
        if (await wt(n3), n3.size !== S && n3.readUint8Array || (n3 = new ut(await new Response(n3.readable).blob()), await wt(n3)), n3.size < v) throw new Error(Lt);
        n3.chunkSize = (function(e4) {
          return Math.max(e4.chunkSize, 64);
        })(i3);
        const r3 = await (async function(e4, t4, n4, i4, r4) {
          const a4 = new Uint8Array(4);
          !(function(e5, t5, n5) {
            e5.setUint32(t5, n5, true);
          })(rn(a4), 0, t4);
          const s4 = i4 + r4;
          return await o4(i4) || await o4(Math.min(s4, n4));
          async function o4(t5) {
            const r5 = n4 - t5, s5 = await pt(e4, r5, t5);
            for (let e5 = s5.length - i4; e5 >= 0; e5--) if (s5[e5] == a4[0] && s5[e5 + 1] == a4[1] && s5[e5 + 2] == a4[2] && s5[e5 + 3] == a4[3]) return { offset: r5 + e5, buffer: s5.slice(e5, e5 + i4).buffer };
          }
        })(n3, 101010256, n3.size, v, 1048560);
        if (!r3) {
          throw 134695760 == tn(rn(await pt(n3, 0, 4))) ? new Error(Bt) : new Error("End of central directory not found");
        }
        const a3 = rn(r3);
        let s3 = tn(a3, 12), o3 = tn(a3, 16);
        const l3 = r3.offset, c2 = en(a3, 20), u2 = l3 + v + c2;
        let d2 = en(a3, 4);
        const f3 = n3.lastDiskNumber || 0;
        let h3 = en(a3, 6), _2 = en(a3, 8), w2 = 0, b3 = 0;
        if (o3 == g || s3 == g || _2 == y || h3 == y) {
          const e4 = rn(await pt(n3, r3.offset - 20, 20));
          if (117853008 == tn(e4, 0)) {
            o3 = nn(e4, 8);
            let t4 = await pt(n3, o3, 56, -1), i4 = rn(t4);
            const a4 = r3.offset - 20 - 56;
            if (tn(i4, 0) != k && o3 != a4) {
              const e5 = o3;
              o3 = a4, w2 = o3 - e5, t4 = await pt(n3, o3, 56, -1), i4 = rn(t4);
            }
            if (tn(i4, 0) != k) throw new Error("End of Zip64 central directory locator not found");
            d2 == y && (d2 = tn(i4, 16)), h3 == y && (h3 = tn(i4, 20)), _2 == y && (_2 = nn(i4, 32)), s3 == g && (s3 = nn(i4, 40)), o3 -= s3;
          }
        }
        if (o3 >= n3.size && (w2 = n3.size - o3 - s3 - v, o3 = n3.size - s3 - v), f3 != d2) throw new Error(Bt);
        if (o3 < 0) throw new Error(Lt);
        let p3 = 0, m3 = await pt(n3, o3, s3, h3), z3 = rn(m3);
        if (s3) {
          const e4 = r3.offset - s3;
          if (tn(z3, p3) != x && o3 != e4) {
            const t4 = o3;
            o3 = e4, w2 += o3 - t4, m3 = await pt(n3, o3, s3, h3), z3 = rn(m3);
          }
        }
        const A3 = r3.offset - o3 - (n3.lastDiskOffset || 0);
        if (s3 != A3 && A3 >= 0 && (s3 = A3, m3 = await pt(n3, o3, s3, h3), z3 = rn(m3)), o3 < 0 || o3 >= n3.size) throw new Error(Lt);
        const U3 = Qt(t3, e3, "filenameEncoding"), D2 = Qt(t3, e3, "commentEncoding");
        for (let r4 = 0; r4 < _2; r4++) {
          const a4 = new Kt(n3, i3, t3.options);
          if (tn(z3, p3) != x) throw new Error("Central directory header not found");
          Zt(a4, z3, p3 + 6);
          const s4 = Boolean(a4.bitFlag.languageEncodingFlag), o4 = p3 + 46, l4 = o4 + a4.filenameLength, c3 = l4 + a4.extraFieldLength, u3 = en(z3, p3 + 4), d3 = !(u3 >> 8), f4 = u3 >> 8 == 3, h4 = m3.subarray(o4, l4), g3 = en(z3, p3 + 32), y3 = c3 + g3, k3 = m3.subarray(c3, y3), v3 = s4, A4 = s4, E4 = tn(z3, p3 + 38), F3 = d3 && !(16 & ~$t(z3, p3 + 38)) || f4 && !(16384 & ~(E4 >> 16)) || h4.length && h4[h4.length - 1] == "/".charCodeAt(0), T3 = f4 && !(73 & ~(E4 >> 16)), O2 = tn(z3, p3 + 42) + w2;
          Object.assign(a4, { versionMadeBy: u3, msDosCompatible: d3, compressedSize: 0, uncompressedSize: 0, commentLength: g3, directory: F3, offset: O2, diskNumberStart: en(z3, p3 + 34), internalFileAttributes: en(z3, p3 + 36), externalFileAttributes: E4, rawFilename: h4, filenameUTF8: v3, commentUTF8: A4, rawExtraField: m3.subarray(l4, c3), executable: T3 }), a4.internalFileAttribute = a4.internalFileAttributes, a4.externalFileAttribute = a4.externalFileAttributes;
          const C2 = Qt(t3, e3, "decodeText") || yt, W2 = v3 ? It : U3 || Nt, j2 = A4 ? It : D2 || Nt;
          let M2 = C2(h4, W2);
          M2 === S && (M2 = yt(h4, W2));
          let L2 = C2(k3, j2);
          L2 === S && (L2 = yt(k3, j2)), Object.assign(a4, { rawComment: k3, filename: M2, comment: L2, directory: F3 || M2.endsWith("/") }), b3 = Math.max(O2, b3), Gt(a4, a4, z3, p3 + 6), a4.zipCrypto = a4.encrypted && !a4.extraFieldAES;
          const P2 = new Mt(a4);
          P2.getData = (e4, t4) => a4.getData(e4, P2, t4), p3 = y3;
          const { onprogress: R2 } = e3;
          if (R2) try {
            await R2(r4 + 1, _2, new Mt(a4));
          } catch (e4) {
          }
          yield P2;
        }
        const E3 = Qt(t3, e3, "extractPrependedData"), F2 = Qt(t3, e3, "extractAppendedData");
        return E3 && (t3.prependedData = b3 > 0 ? await pt(n3, 0, b3) : new Uint8Array()), t3.comment = c2 ? await pt(n3, l3 + v, c2) : new Uint8Array(), F2 && (t3.appendedData = u2 < n3.size ? await pt(n3, u2, n3.size - u2) : new Uint8Array()), true;
      }
      async getEntries(e3 = {}) {
        const t3 = [];
        for await (const n3 of this.getEntriesGenerator(e3)) t3.push(n3);
        return t3;
      }
      async close() {
      }
    };
    Kt = class {
      constructor(e3, t3, n3) {
        Object.assign(this, { reader: e3, config: t3, options: n3 });
      }
      async getData(e3, t3, n3 = {}) {
        const i3 = this, { reader: r3, offset: a3, diskNumberStart: s3, extraFieldAES: o3, compressionMethod: l3, config: c2, bitFlag: u2, signature: d2, rawLastModDate: f3, uncompressedSize: h3, compressedSize: _2 } = i3, w2 = t3.localDirectory = {}, b3 = rn(await pt(r3, a3, 30, s3));
        let p3 = Qt(i3, n3, "password"), m3 = Qt(i3, n3, "rawPassword");
        const g3 = Qt(i3, n3, "passThrough");
        if (p3 = p3 && p3.length && p3, m3 = m3 && m3.length && m3, o3 && 99 != o3.originalCompressionMethod) throw new Error(Rt);
        if (0 != l3 && 8 != l3 && !g3) throw new Error(Rt);
        if (67324752 != tn(b3, 0)) throw new Error("Local file header not found");
        Zt(w2, b3, 4), w2.rawExtraField = w2.extraFieldLength ? await pt(r3, a3 + 30 + w2.filenameLength, w2.extraFieldLength, s3) : new Uint8Array(), Gt(i3, w2, b3, 4, true), Object.assign(t3, { lastAccessDate: w2.lastAccessDate, creationDate: w2.creationDate });
        const y3 = i3.encrypted && w2.encrypted && !g3, x3 = y3 && !o3;
        if (g3 || (t3.zipCrypto = x3), y3) {
          if (!x3 && o3.strength === S) throw new Error("Encryption method not supported");
          if (!p3 && !m3) throw new Error("File contains encrypted entry");
        }
        const k3 = a3 + 30 + w2.filenameLength + w2.extraFieldLength, v3 = _2, z3 = r3.readable;
        Object.assign(z3, { diskNumberStart: s3, offset: k3, size: v3 });
        const U3 = Qt(i3, n3, "signal"), D2 = Qt(i3, n3, "checkPasswordOnly");
        D2 && (e3 = new WritableStream()), e3 = (function(e4) {
          e4.writable === S && typeof e4.next == A && (e4 = new _t(e4)), e4 instanceof WritableStream && (e4 = { writable: e4 });
          const { writable: t4 } = e4;
          return t4.size === S && (t4.size = 0), e4 instanceof _t || Object.assign(e4, { diskNumber: 0, diskOffset: 0, availableSize: 1 / 0, maxSize: 1 / 0 }), e4;
        })(e3), await wt(e3, g3 ? _2 : h3);
        const { writable: E3 } = e3, { onstart: F2, onprogress: T3, onend: O2 } = n3, C2 = { options: { codecType: Ve, password: p3, rawPassword: m3, zipCrypto: x3, encryptionStrength: o3 && o3.strength, signed: Qt(i3, n3, "checkSignature") && !g3, passwordVerification: x3 && (u2.dataDescriptor ? f3 >>> 8 & 255 : d2 >>> 24 & 255), signature: d2, compressed: 0 != l3 && !g3, encrypted: i3.encrypted && !g3, useWebWorkers: Qt(i3, n3, "useWebWorkers"), useCompressionStream: Qt(i3, n3, "useCompressionStream"), transferStreams: Qt(i3, n3, "transferStreams"), checkPasswordOnly: D2 }, config: c2, streamOptions: { signal: U3, size: v3, onstart: F2, onprogress: T3, onend: O2 } };
        let W2 = 0;
        try {
          ({ outputSize: W2 } = await rt({ readable: z3, writable: E3 }, C2));
        } catch (e4) {
          if (!D2 || e4.message != K) throw e4;
        } finally {
          const e4 = Qt(i3, n3, "preventClose");
          E3.size += W2, e4 || E3.locked || await E3.getWriter().close();
        }
        return D2 ? S : e3.getData ? e3.getData() : E3;
      }
    };
    T({ Inflate: function(e3) {
      const t3 = new m(), i3 = e3 && e3.chunkSize ? Math.floor(2 * e3.chunkSize) : 131072, r3 = new Uint8Array(i3);
      let a3 = false;
      t3.inflateInit(), t3.next_out = r3, this.append = function(e4, s3) {
        const o3 = [];
        let l3, c2, u2 = 0, d2 = 0, f3 = 0;
        if (0 !== e4.length) {
          t3.next_in_index = 0, t3.next_in = e4, t3.avail_in = e4.length;
          do {
            if (t3.next_out_index = 0, t3.avail_out = i3, 0 !== t3.avail_in || a3 || (t3.next_in_index = 0, a3 = true), l3 = t3.inflate(0), a3 && l3 === n) {
              if (0 !== t3.avail_in) throw new Error("inflating: bad input");
            } else if (0 !== l3 && 1 !== l3) throw new Error("inflating: " + t3.msg);
            if ((a3 || 1 === l3) && t3.avail_in === e4.length) throw new Error("inflating: bad input");
            t3.next_out_index && (t3.next_out_index === i3 ? o3.push(new Uint8Array(r3)) : o3.push(r3.subarray(0, t3.next_out_index))), f3 += t3.next_out_index, s3 && t3.next_in_index > 0 && t3.next_in_index != u2 && (s3(t3.next_in_index), u2 = t3.next_in_index);
          } while (t3.avail_in > 0 || 0 === t3.avail_out);
          return o3.length > 1 ? (c2 = new Uint8Array(f3), o3.forEach((function(e5) {
            c2.set(e5, d2), d2 += e5.length;
          }))) : c2 = o3[0] ? new Uint8Array(o3[0]) : new Uint8Array(), c2;
        }
      }, this.flush = function() {
        t3.inflateEnd();
      };
    } });
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/epub.js
var epub_exports = {};
__export(epub_exports, {
  EPUB: () => EPUB
});
var NS, MIME, PREFIX, RELATORS, ONIX5, camel, normalizeWhitespace, filterAttribute, getAttributes, getElementText, childGetter, resolveURL, isExternal, pathRelative, pathDirname, replaceSeries, regexEscape, tidy, getPrefixes, getPropertyURL, getMetadata, parseNav, parseNCX, parseClock, MediaOverlay, isUUID, getUUID, getIdentifier, deobfuscate, WebCryptoSHA1, deobfuscators, Encryption, Resources, Loader, getHTMLFragment, getPageSpread, getDisplayOptions, EPUB;
var init_epub = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/epub.js"() {
    init_epubcfi();
    NS = {
      CONTAINER: "urn:oasis:names:tc:opendocument:xmlns:container",
      XHTML: "http://www.w3.org/1999/xhtml",
      OPF: "http://www.idpf.org/2007/opf",
      EPUB: "http://www.idpf.org/2007/ops",
      DC: "http://purl.org/dc/elements/1.1/",
      DCTERMS: "http://purl.org/dc/terms/",
      ENC: "http://www.w3.org/2001/04/xmlenc#",
      NCX: "http://www.daisy.org/z3986/2005/ncx/",
      XLINK: "http://www.w3.org/1999/xlink",
      SMIL: "http://www.w3.org/ns/SMIL"
    };
    MIME = {
      XML: "application/xml",
      NCX: "application/x-dtbncx+xml",
      XHTML: "application/xhtml+xml",
      HTML: "text/html",
      CSS: "text/css",
      SVG: "image/svg+xml",
      JS: /\/(x-)?(javascript|ecmascript)/
    };
    PREFIX = {
      a11y: "http://www.idpf.org/epub/vocab/package/a11y/#",
      dcterms: "http://purl.org/dc/terms/",
      marc: "http://id.loc.gov/vocabulary/",
      media: "http://www.idpf.org/epub/vocab/overlays/#",
      onix: "http://www.editeur.org/ONIX/book/codelists/current.html#",
      rendition: "http://www.idpf.org/vocab/rendition/#",
      schema: "http://schema.org/",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      msv: "http://www.idpf.org/epub/vocab/structure/magazine/#",
      prism: "http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#"
    };
    RELATORS = {
      art: "artist",
      aut: "author",
      clr: "colorist",
      edt: "editor",
      ill: "illustrator",
      nrt: "narrator",
      trl: "translator",
      pbl: "publisher"
    };
    ONIX5 = {
      "02": "isbn",
      "06": "doi",
      "15": "isbn",
      "26": "doi",
      "34": "issn"
    };
    camel = (x3) => x3.toLowerCase().replace(/[-:](.)/g, (_2, g3) => g3.toUpperCase());
    normalizeWhitespace = (str) => str ? str.replace(/[\t\n\f\r ]+/g, " ").replace(/^[\t\n\f\r ]+/, "").replace(/[\t\n\f\r ]+$/, "") : "";
    filterAttribute = (attr, value, isList) => isList ? (el) => el.getAttribute(attr)?.split(/\s/)?.includes(value) : typeof value === "function" ? (el) => value(el.getAttribute(attr)) : (el) => el.getAttribute(attr) === value;
    getAttributes = (...xs) => (el) => el ? Object.fromEntries(xs.map((x3) => [camel(x3), el.getAttribute(x3)])) : null;
    getElementText = (el) => normalizeWhitespace(el?.textContent);
    childGetter = (doc, ns) => {
      const useNS = doc.lookupNamespaceURI(null) === ns || doc.lookupPrefix(ns);
      const f3 = useNS ? (el, name) => (el2) => el2.namespaceURI === ns && el2.localName === name : (el, name) => (el2) => el2.localName === name;
      return {
        $: (el, name) => [...el.children].find(f3(el, name)),
        $$: (el, name) => [...el.children].filter(f3(el, name)),
        $$$: useNS ? (el, name) => [...el.getElementsByTagNameNS(ns, name)] : (el, name) => [...el.getElementsByTagName(name)]
      };
    };
    resolveURL = (url, relativeTo) => {
      try {
        url = url.replace(/%2c/, ",");
        if (relativeTo.includes(":") && !relativeTo.startsWith("OEBPS")) return new URL(url, relativeTo);
        const root = "https://invalid.invalid/";
        const obj = new URL(url, root + relativeTo);
        obj.search = "";
        return decodeURI(obj.href.replace(root, ""));
      } catch (e3) {
        console.warn(e3);
        return url;
      }
    };
    isExternal = (uri) => /^(?!blob)\w+:/i.test(uri);
    pathRelative = (from, to) => {
      if (!from) return to;
      const as = from.replace(/\/$/, "").split("/");
      const bs = to.replace(/\/$/, "").split("/");
      const i3 = (as.length > bs.length ? as : bs).findIndex((_2, i4) => as[i4] !== bs[i4]);
      return i3 < 0 ? "" : Array(as.length - i3).fill("..").concat(bs.slice(i3)).join("/");
    };
    pathDirname = (str) => str.slice(0, str.lastIndexOf("/") + 1);
    replaceSeries = async (str, regex, f3) => {
      const matches2 = [];
      str.replace(regex, (...args) => (matches2.push(args), null));
      const results = [];
      for (const args of matches2) results.push(await f3(...args));
      return str.replace(regex, () => results.shift());
    };
    regexEscape = (str) => str.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    tidy = (obj) => {
      for (const [key, val] of Object.entries(obj))
        if (val == null) delete obj[key];
        else if (Array.isArray(val)) {
          obj[key] = val.filter((x3) => x3).map((x3) => typeof x3 === "object" && !Array.isArray(x3) ? tidy(x3) : x3);
          if (!obj[key].length) delete obj[key];
          else if (obj[key].length === 1) obj[key] = obj[key][0];
        } else if (typeof val === "object") {
          obj[key] = tidy(val);
          if (!Object.keys(val).length) delete obj[key];
        }
      const keys = Object.keys(obj);
      if (keys.length === 1 && keys[0] === "name") return obj[keys[0]];
      return obj;
    };
    getPrefixes = (doc) => {
      const map = new Map(Object.entries(PREFIX));
      const value = doc.documentElement.getAttributeNS(NS.EPUB, "prefix") || doc.documentElement.getAttribute("prefix");
      if (value) for (const [, prefix, url] of value.matchAll(/(.+): +(.+)[ \t\r\n]*/g)) map.set(prefix, url);
      return map;
    };
    getPropertyURL = (value, prefixes) => {
      if (!value) return null;
      const [a3, b3] = value.split(":");
      const prefix = b3 ? a3 : null;
      const reference = b3 ? b3 : a3;
      const baseURL = prefixes.get(prefix);
      return baseURL ? baseURL + reference : null;
    };
    getMetadata = (opf) => {
      const { $: $2 } = childGetter(opf, NS.OPF);
      const $metadata = $2(opf.documentElement, "metadata");
      const els = Object.groupBy($metadata.children, (el) => el.namespaceURI === NS.DC ? "dc" : el.namespaceURI === NS.OPF && el.localName === "meta" ? el.hasAttribute("name") ? "legacyMeta" : "meta" : "");
      const baseLang = $metadata.getAttribute("xml:lang") ?? opf.documentElement.getAttribute("xml:lang") ?? "und";
      const prefixes = getPrefixes(opf);
      const parse2 = (el) => {
        const property = el.getAttribute("property");
        const scheme = el.getAttribute("scheme");
        return {
          property: getPropertyURL(property, prefixes) ?? property,
          scheme: getPropertyURL(scheme, prefixes) ?? scheme,
          lang: el.getAttribute("xml:lang"),
          value: getElementText(el),
          props: getProperties(el),
          // `opf:` attributes from EPUB 2 & EPUB 3.1 (removed in EPUB 3.2)
          attrs: Object.fromEntries(Array.from(el.attributes).filter((attr) => attr.namespaceURI === NS.OPF).map((attr) => [attr.localName, attr.value]))
        };
      };
      const refines = Map.groupBy(els.meta ?? [], (el) => el.getAttribute("refines"));
      const getProperties = (el) => {
        const els2 = refines.get(el ? "#" + el.getAttribute("id") : null);
        if (!els2) return null;
        return Object.groupBy(els2.map(parse2), (x3) => x3.property);
      };
      const dc = Object.fromEntries(Object.entries(Object.groupBy(els.dc || [], (el) => el.localName)).map(([name, els2]) => [name, els2.map(parse2)]));
      const properties = getProperties() ?? {};
      const legacyMeta = Object.fromEntries(els.legacyMeta?.map((el) => [el.getAttribute("name"), el.getAttribute("content")]) ?? []);
      const one = (x3) => x3?.[0]?.value;
      const prop = (x3, p3) => one(x3?.props?.[p3]);
      const makeLanguageMap = (x3) => {
        if (!x3) return null;
        const alts = x3.props?.["alternate-script"] ?? [];
        const altRep = x3.attrs["alt-rep"];
        if (!alts.length && (!x3.lang || x3.lang === baseLang) && !altRep) return x3.value;
        const map = { [x3.lang ?? baseLang]: x3.value };
        if (altRep) map[x3.attrs["alt-rep-lang"]] = altRep;
        for (const y3 of alts) map[y3.lang] ??= y3.value;
        return map;
      };
      const makeContributor = (x3) => x3 ? {
        name: makeLanguageMap(x3),
        sortAs: makeLanguageMap(x3.props?.["file-as"]?.[0]) ?? x3.attrs["file-as"],
        role: x3.props?.role?.filter((x4) => x4.scheme === PREFIX.marc + "relators")?.map((x4) => x4.value) ?? [x3.attrs.role],
        code: prop(x3, "term") ?? x3.attrs.term,
        scheme: prop(x3, "authority") ?? x3.attrs.authority
      } : null;
      const makeCollection = (x3) => ({
        name: makeLanguageMap(x3),
        // NOTE: webpub requires number but EPUB allows values like "2.2.1"
        position: one(x3.props?.["group-position"])
      });
      const makeAltIdentifier = (x3) => {
        const { value } = x3;
        if (/^urn:/i.test(value)) return value;
        if (/^doi:/i.test(value)) return `urn:${value}`;
        const type = x3.props?.["identifier-type"];
        if (!type) {
          const scheme = x3.attrs.scheme;
          if (!scheme) return value;
          if (/^(doi|isbn|uuid)$/i.test(scheme)) return `urn:${scheme}:${value}`;
          return { scheme, value };
        }
        if (type.scheme === PREFIX.onix + "codelist5") {
          const nid = ONIX5[type.value];
          if (nid) return `urn:${nid}:${value}`;
        }
        return value;
      };
      const belongsTo = Object.groupBy(
        properties["belongs-to-collection"] ?? [],
        (x3) => prop(x3, "collection-type") === "series" ? "series" : "collection"
      );
      const mainTitle = dc.title?.find((x3) => prop(x3, "title-type") === "main") ?? dc.title?.[0];
      const metadata = {
        identifier: getIdentifier(opf),
        title: makeLanguageMap(mainTitle),
        sortAs: makeLanguageMap(mainTitle?.props?.["file-as"]?.[0]) ?? mainTitle?.attrs?.["file-as"] ?? legacyMeta?.["calibre:title_sort"],
        subtitle: dc.title?.find((x3) => prop(x3, "title-type") === "subtitle")?.value,
        language: dc.language?.map((x3) => x3.value),
        description: one(dc.description),
        publisher: makeContributor(dc.publisher?.[0]),
        published: dc.date?.find((x3) => x3.attrs.event === "publication")?.value ?? one(dc.date),
        modified: one(properties[PREFIX.dcterms + "modified"]) ?? dc.date?.find((x3) => x3.attrs.event === "modification")?.value,
        subject: dc.subject?.map(makeContributor),
        belongsTo: {
          collection: belongsTo.collection?.map(makeCollection),
          series: belongsTo.series?.map(makeCollection) ?? legacyMeta?.["calibre:series"] ? {
            name: legacyMeta?.["calibre:series"],
            position: parseFloat(legacyMeta?.["calibre:series_index"])
          } : null
        },
        altIdentifier: dc.identifier?.map(makeAltIdentifier),
        source: dc.source?.map(makeAltIdentifier),
        // NOTE: not in webpub schema
        rights: one(dc.rights)
        // NOTE: not in webpub schema
      };
      const remapContributor = (defaultKey) => (x3) => {
        const keys = new Set(x3.role?.map((role) => RELATORS[role] ?? defaultKey));
        return [keys.size ? keys : [defaultKey], x3];
      };
      for (const [keys, val] of [].concat(
        dc.creator?.map(makeContributor)?.map(remapContributor("author")) ?? [],
        dc.contributor?.map(makeContributor)?.map(remapContributor("contributor")) ?? []
      ))
        for (const key of keys)
          if (metadata[key]) metadata[key].push(val);
          else metadata[key] = [val];
      tidy(metadata);
      if (metadata.altIdentifier === metadata.identifier)
        delete metadata.altIdentifier;
      const rendition = {};
      const media = {};
      for (const [key, val] of Object.entries(properties)) {
        if (key.startsWith(PREFIX.rendition))
          rendition[camel(key.replace(PREFIX.rendition, ""))] = one(val);
        else if (key.startsWith(PREFIX.media))
          media[camel(key.replace(PREFIX.media, ""))] = one(val);
      }
      if (media.duration) media.duration = parseClock(media.duration);
      return { metadata, rendition, media };
    };
    parseNav = (doc, resolve = (f3) => f3) => {
      const { $: $2, $$, $$$ } = childGetter(doc, NS.XHTML);
      const resolveHref = (href) => href ? decodeURI(resolve(href)) : null;
      const parseLI = (getType) => ($li) => {
        const $a = $2($li, "a") ?? $2($li, "span");
        const $ol = $2($li, "ol");
        const href = resolveHref($a?.getAttribute("href"));
        const label = getElementText($a) || $a?.getAttribute("title");
        const result = { label, href, subitems: parseOL($ol) };
        if (getType) result.type = $a?.getAttributeNS(NS.EPUB, "type")?.split(/\s/);
        return result;
      };
      const parseOL = ($ol, getType) => $ol ? $$($ol, "li").map(parseLI(getType)) : null;
      const parseNav2 = ($nav, getType) => parseOL($2($nav, "ol"), getType);
      const $$nav = $$$(doc, "nav");
      let toc = null, pageList = null, landmarks = null, others = [];
      for (const $nav of $$nav) {
        const type = $nav.getAttributeNS(NS.EPUB, "type")?.split(/\s/) ?? [];
        if (type.includes("toc")) toc ??= parseNav2($nav);
        else if (type.includes("page-list")) pageList ??= parseNav2($nav);
        else if (type.includes("landmarks")) landmarks ??= parseNav2($nav, true);
        else others.push({
          label: getElementText($nav.firstElementChild),
          type,
          list: parseNav2($nav)
        });
      }
      return { toc, pageList, landmarks, others };
    };
    parseNCX = (doc, resolve = (f3) => f3) => {
      const { $: $2, $$ } = childGetter(doc, NS.NCX);
      const resolveHref = (href) => href ? decodeURI(resolve(href)) : null;
      const parseItem = (el) => {
        const $label = $2(el, "navLabel");
        const $content = $2(el, "content");
        const label = getElementText($label);
        const href = resolveHref($content.getAttribute("src"));
        if (el.localName === "navPoint") {
          const els = $$(el, "navPoint");
          return { label, href, subitems: els.length ? els.map(parseItem) : null };
        }
        return { label, href };
      };
      const parseList = (el, itemName) => $$(el, itemName).map(parseItem);
      const getSingle = (container, itemName) => {
        const $container = $2(doc.documentElement, container);
        return $container ? parseList($container, itemName) : null;
      };
      return {
        toc: getSingle("navMap", "navPoint"),
        pageList: getSingle("pageList", "pageTarget"),
        others: $$(doc.documentElement, "navList").map((el) => ({
          label: getElementText($2(el, "navLabel")),
          list: parseList(el, "navTarget")
        }))
      };
    };
    parseClock = (str) => {
      if (!str) return;
      const parts = str.split(":").map((x4) => parseFloat(x4));
      if (parts.length === 3) {
        const [h3, m3, s3] = parts;
        return h3 * 60 * 60 + m3 * 60 + s3;
      }
      if (parts.length === 2) {
        const [m3, s3] = parts;
        return m3 * 60 + s3;
      }
      const [x3, unit] = str.split(/(?=[^\d.])/);
      const n3 = parseFloat(x3);
      const f3 = unit === "h" ? 60 * 60 : unit === "min" ? 60 : unit === "ms" ? 1e-3 : 1;
      return n3 * f3;
    };
    MediaOverlay = class extends EventTarget {
      #entries;
      #lastMediaOverlayItem;
      #sectionIndex;
      #audioIndex;
      #itemIndex;
      #audio;
      #volume = 1;
      #rate = 1;
      #state;
      constructor(book, loadXML) {
        super();
        this.book = book;
        this.loadXML = loadXML;
      }
      async #loadSMIL(item) {
        if (this.#lastMediaOverlayItem === item) return;
        const doc = await this.loadXML(item.href);
        const resolve = (href) => href ? resolveURL(href, item.href) : null;
        const { $: $2, $$$ } = childGetter(doc, NS.SMIL);
        this.#audioIndex = -1;
        this.#itemIndex = -1;
        this.#entries = $$$(doc, "par").reduce((arr, $par) => {
          const text = resolve($2($par, "text")?.getAttribute("src"));
          const $audio = $2($par, "audio");
          if (!text || !$audio) return arr;
          const src = resolve($audio.getAttribute("src"));
          const begin = parseClock($audio.getAttribute("clipBegin"));
          const end = parseClock($audio.getAttribute("clipEnd"));
          const last = arr.at(-1);
          if (last?.src === src) last.items.push({ text, begin, end });
          else arr.push({ src, items: [{ text, begin, end }] });
          return arr;
        }, []);
        this.#lastMediaOverlayItem = item;
      }
      get #activeAudio() {
        return this.#entries[this.#audioIndex];
      }
      get #activeItem() {
        return this.#activeAudio?.items?.[this.#itemIndex];
      }
      #error(e3) {
        console.error(e3);
        this.dispatchEvent(new CustomEvent("error", { detail: e3 }));
      }
      #highlight() {
        this.dispatchEvent(new CustomEvent("highlight", { detail: this.#activeItem }));
      }
      #unhighlight() {
        this.dispatchEvent(new CustomEvent("unhighlight", { detail: this.#activeItem }));
      }
      async #play(audioIndex, itemIndex) {
        this.#stop();
        this.#audioIndex = audioIndex;
        this.#itemIndex = itemIndex;
        const src = this.#activeAudio?.src;
        if (!src || !this.#activeItem) return this.start(this.#sectionIndex + 1);
        const url = URL.createObjectURL(await this.book.loadBlob(src));
        const audio = new Audio(url);
        this.#audio = audio;
        audio.volume = this.#volume;
        audio.playbackRate = this.#rate;
        audio.addEventListener("timeupdate", () => {
          if (audio.paused) return;
          const t3 = audio.currentTime;
          const { items } = this.#activeAudio;
          if (t3 > this.#activeItem?.end) {
            this.#unhighlight();
            if (this.#itemIndex === items.length - 1) {
              this.#play(this.#audioIndex + 1, 0).catch((e3) => this.#error(e3));
              return;
            }
          }
          const oldIndex = this.#itemIndex;
          while (items[this.#itemIndex + 1]?.begin <= t3) this.#itemIndex++;
          if (this.#itemIndex !== oldIndex) this.#highlight();
        });
        audio.addEventListener("error", () => this.#error(new Error(`Failed to load ${src}`)));
        audio.addEventListener("playing", () => this.#highlight());
        audio.addEventListener("ended", () => {
          this.#unhighlight();
          URL.revokeObjectURL(url);
          this.#audio = null;
          this.#play(audioIndex + 1, 0).catch((e3) => this.#error(e3));
        });
        if (this.#state === "paused") {
          this.#highlight();
          audio.currentTime = this.#activeItem.begin ?? 0;
        } else audio.addEventListener("canplaythrough", () => {
          audio.currentTime = this.#activeItem.begin ?? 0;
          this.#state = "playing";
          audio.play().catch((e3) => this.#error(e3));
        }, { once: true });
      }
      async start(sectionIndex, filter3 = () => true) {
        this.#audio?.pause();
        const section = this.book.sections[sectionIndex];
        const href = section?.id;
        if (!href) return;
        const { mediaOverlay } = section;
        if (!mediaOverlay) return this.start(sectionIndex + 1);
        this.#sectionIndex = sectionIndex;
        await this.#loadSMIL(mediaOverlay);
        for (let i3 = 0; i3 < this.#entries.length; i3++) {
          const { items } = this.#entries[i3];
          for (let j2 = 0; j2 < items.length; j2++) {
            if (items[j2].text.split("#")[0] === href && filter3(items[j2], j2, items))
              return this.#play(i3, j2).catch((e3) => this.#error(e3));
          }
        }
      }
      pause() {
        this.#state = "paused";
        this.#audio?.pause();
      }
      resume() {
        this.#state = "playing";
        this.#audio?.play().catch((e3) => this.#error(e3));
      }
      #stop() {
        if (this.#audio) {
          this.#audio.pause();
          URL.revokeObjectURL(this.#audio.src);
          this.#audio = null;
          this.#unhighlight();
        }
      }
      stop() {
        this.#state = "stopped";
        this.#stop();
      }
      prev() {
        if (this.#itemIndex > 0) this.#play(this.#audioIndex, this.#itemIndex - 1);
        else if (this.#audioIndex > 0) this.#play(
          this.#audioIndex - 1,
          this.#entries[this.#audioIndex - 1].items.length - 1
        );
        else if (this.#sectionIndex > 0)
          this.start(this.#sectionIndex - 1, (_2, i3, items) => i3 === items.length - 1);
      }
      next() {
        this.#play(this.#audioIndex, this.#itemIndex + 1);
      }
      setVolume(volume) {
        this.#volume = volume;
        if (this.#audio) this.#audio.volume = volume;
      }
      setRate(rate) {
        this.#rate = rate;
        if (this.#audio) this.#audio.playbackRate = rate;
      }
    };
    isUUID = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/;
    getUUID = (opf) => {
      for (const el of opf.getElementsByTagNameNS(NS.DC, "identifier")) {
        const [id] = getElementText(el).split(":").slice(-1);
        if (isUUID.test(id)) return id;
      }
      return "";
    };
    getIdentifier = (opf) => getElementText(
      opf.getElementById(opf.documentElement.getAttribute("unique-identifier")) ?? opf.getElementsByTagNameNS(NS.DC, "identifier")[0]
    );
    deobfuscate = async (key, length, blob) => {
      const array = new Uint8Array(await blob.slice(0, length).arrayBuffer());
      length = Math.min(length, array.length);
      for (var i3 = 0; i3 < length; i3++) array[i3] = array[i3] ^ key[i3 % key.length];
      return new Blob([array, blob.slice(length)], { type: blob.type });
    };
    WebCryptoSHA1 = async (str) => {
      const data = new TextEncoder().encode(str);
      const buffer = await globalThis.crypto.subtle.digest("SHA-1", data);
      return new Uint8Array(buffer);
    };
    deobfuscators = (sha1 = WebCryptoSHA1) => ({
      "http://www.idpf.org/2008/embedding": {
        key: (opf) => sha1(getIdentifier(opf).replaceAll(/[\u0020\u0009\u000d\u000a]/g, "")),
        decode: (key, blob) => deobfuscate(key, 1040, blob)
      },
      "http://ns.adobe.com/pdf/enc#RC": {
        key: (opf) => {
          const uuid = getUUID(opf).replaceAll("-", "");
          return Uint8Array.from({ length: 16 }, (_2, i3) => parseInt(uuid.slice(i3 * 2, i3 * 2 + 2), 16));
        },
        decode: (key, blob) => deobfuscate(key, 1024, blob)
      }
    });
    Encryption = class {
      #uris = /* @__PURE__ */ new Map();
      #decoders = /* @__PURE__ */ new Map();
      #algorithms;
      constructor(algorithms) {
        this.#algorithms = algorithms;
      }
      async init(encryption, opf) {
        if (!encryption) return;
        const data = Array.from(
          encryption.getElementsByTagNameNS(NS.ENC, "EncryptedData"),
          (el) => ({
            algorithm: el.getElementsByTagNameNS(NS.ENC, "EncryptionMethod")[0]?.getAttribute("Algorithm"),
            uri: el.getElementsByTagNameNS(NS.ENC, "CipherReference")[0]?.getAttribute("URI")
          })
        );
        for (const { algorithm, uri } of data) {
          if (!this.#decoders.has(algorithm)) {
            const algo = this.#algorithms[algorithm];
            if (!algo) {
              console.warn("Unknown encryption algorithm");
              continue;
            }
            const key = await algo.key(opf);
            this.#decoders.set(algorithm, (blob) => algo.decode(key, blob));
          }
          this.#uris.set(uri, algorithm);
        }
      }
      getDecoder(uri) {
        return this.#decoders.get(this.#uris.get(uri)) ?? ((x3) => x3);
      }
    };
    Resources = class {
      constructor({ opf, resolveHref }) {
        this.opf = opf;
        const { $: $2, $$, $$$ } = childGetter(opf, NS.OPF);
        const $manifest = $2(opf.documentElement, "manifest");
        const $spine = $2(opf.documentElement, "spine");
        const $$itemref = $$($spine, "itemref");
        this.manifest = $$($manifest, "item").map(getAttributes("href", "id", "media-type", "properties", "media-overlay")).map((item) => {
          item.href = resolveHref(item.href);
          item.properties = item.properties?.split(/\s/);
          return item;
        });
        this.spine = $$itemref.map(getAttributes("idref", "id", "linear", "properties")).map((item) => (item.properties = item.properties?.split(/\s/), item));
        this.pageProgressionDirection = $spine.getAttribute("page-progression-direction");
        this.navPath = this.getItemByProperty("nav")?.href;
        this.ncxPath = (this.getItemByID($spine.getAttribute("toc")) ?? this.manifest.find((item) => item.mediaType === MIME.NCX))?.href;
        const $guide = $2(opf.documentElement, "guide");
        if ($guide) this.guide = $$($guide, "reference").map(getAttributes("type", "title", "href")).map(({ type, title, href }) => ({
          label: title,
          type: type.split(/\s/),
          href: resolveHref(href)
        }));
        this.cover = this.getItemByProperty("cover-image") ?? this.getItemByID($$$(opf, "meta").find(filterAttribute("name", "cover"))?.getAttribute("content")) ?? this.manifest.find((item) => item.href.includes("cover") && item.mediaType.startsWith("image")) ?? this.getItemByHref(this.guide?.find((ref) => ref.type.includes("cover"))?.href);
        this.cfis = fromElements($$itemref);
      }
      getItemByID(id) {
        return this.manifest.find((item) => item.id === id);
      }
      getItemByHref(href) {
        return this.manifest.find((item) => item.href === href);
      }
      getItemByProperty(prop) {
        return this.manifest.find((item) => item.properties?.includes(prop));
      }
      resolveCFI(cfi) {
        const parts = parse(cfi);
        const top = (parts.parent ?? parts).shift();
        let $itemref = toElement(this.opf, top);
        if ($itemref && $itemref.nodeName !== "idref") {
          top.at(-1).id = null;
          $itemref = toElement(this.opf, top);
        }
        const idref = $itemref?.getAttribute("idref");
        const index = this.spine.findIndex((item) => item.idref === idref);
        const anchor = (doc) => toRange(doc, parts);
        return { index, anchor };
      }
    };
    Loader = class {
      #cache = /* @__PURE__ */ new Map();
      #children = /* @__PURE__ */ new Map();
      #refCount = /* @__PURE__ */ new Map();
      allowScript = false;
      eventTarget = new EventTarget();
      constructor({ loadText, loadBlob, resources }) {
        this.loadText = loadText;
        this.loadBlob = loadBlob;
        this.manifest = resources.manifest;
        this.assets = resources.manifest;
      }
      async createURL(href, data, type, parent) {
        if (!data) return "";
        const detail = { data, type };
        Object.defineProperty(detail, "name", { value: href });
        const event = new CustomEvent("data", { detail });
        this.eventTarget.dispatchEvent(event);
        const newData = await event.detail.data;
        const newType = await event.detail.type;
        const url = URL.createObjectURL(new Blob([newData], { type: newType }));
        this.#cache.set(href, url);
        this.#refCount.set(href, 1);
        if (parent) {
          const childList = this.#children.get(parent);
          if (childList) childList.push(href);
          else this.#children.set(parent, [href]);
        }
        return url;
      }
      ref(href, parent) {
        const childList = this.#children.get(parent);
        if (!childList?.includes(href)) {
          this.#refCount.set(href, this.#refCount.get(href) + 1);
          if (childList) childList.push(href);
          else this.#children.set(parent, [href]);
        }
        return this.#cache.get(href);
      }
      unref(href) {
        if (!this.#refCount.has(href)) return;
        const count = this.#refCount.get(href) - 1;
        if (count < 1) {
          URL.revokeObjectURL(this.#cache.get(href));
          this.#cache.delete(href);
          this.#refCount.delete(href);
          const childList = this.#children.get(href);
          if (childList) while (childList.length) this.unref(childList.pop());
          this.#children.delete(href);
        } else this.#refCount.set(href, count);
      }
      // load manifest item, recursively loading all resources as needed
      async loadItem(item, parents = []) {
        if (!item) return null;
        const { href, mediaType } = item;
        const isScript = MIME.JS.test(item.mediaType);
        if (isScript && !this.allowScript) return null;
        const parent = parents.at(-1);
        if (this.#cache.has(href)) return this.ref(href, parent);
        const shouldReplace = (isScript || [MIME.XHTML, MIME.HTML, MIME.CSS, MIME.SVG].includes(mediaType)) && parents.every((p3) => p3 !== href);
        if (shouldReplace) return this.loadReplaced(item, parents);
        const tryLoadBlob = Promise.resolve().then(() => this.loadBlob(href));
        return this.createURL(href, tryLoadBlob, mediaType, parent);
      }
      async loadHref(href, base, parents = []) {
        if (isExternal(href)) return href;
        const path = resolveURL(href, base);
        const item = this.manifest.find((item2) => item2.href === path);
        if (!item) return href;
        return this.loadItem(item, parents.concat(base));
      }
      async loadReplaced(item, parents = []) {
        const { href, mediaType } = item;
        const parent = parents.at(-1);
        let str = "";
        try {
          str = await this.loadText(href);
        } catch (e3) {
          return this.createURL(href, Promise.reject(e3), mediaType, parent);
        }
        if (!str) return null;
        if ([MIME.XHTML, MIME.HTML, MIME.SVG].includes(mediaType)) {
          let doc = new DOMParser().parseFromString(str, mediaType);
          if (mediaType === MIME.XHTML && (doc.querySelector("parsererror") || !doc.documentElement?.namespaceURI)) {
            console.warn(doc.querySelector("parsererror")?.innerText ?? "Invalid XHTML");
            item.mediaType = MIME.HTML;
            doc = new DOMParser().parseFromString(str, item.mediaType);
          }
          if ([MIME.XHTML, MIME.SVG].includes(item.mediaType)) {
            let child = doc.firstChild;
            while (child instanceof ProcessingInstruction) {
              if (child.data) {
                const replacedData = await replaceSeries(
                  child.data,
                  /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i,
                  (_2, p1, p22, p3) => this.loadHref(p22, href, parents).then((p23) => `${p1}${p23}${p3}`)
                );
                child.replaceWith(doc.createProcessingInstruction(
                  child.target,
                  replacedData
                ));
              }
              child = child.nextSibling;
            }
          }
          const replace = async (el, attr) => el.setAttribute(
            attr,
            await this.loadHref(el.getAttribute(attr), href, parents)
          );
          for (const el of doc.querySelectorAll("link[href]")) await replace(el, "href");
          for (const el of doc.querySelectorAll("[src]")) await replace(el, "src");
          for (const el of doc.querySelectorAll("[poster]")) await replace(el, "poster");
          for (const el of doc.querySelectorAll("object[data]")) await replace(el, "data");
          for (const el of doc.querySelectorAll("[*|href]:not([href])"))
            el.setAttributeNS(NS.XLINK, "href", await this.loadHref(
              el.getAttributeNS(NS.XLINK, "href"),
              href,
              parents
            ));
          for (const el of doc.querySelectorAll("style"))
            if (el.textContent) el.textContent = await this.replaceCSS(el.textContent, href, parents);
          for (const el of doc.querySelectorAll("[style]"))
            el.setAttribute(
              "style",
              await this.replaceCSS(el.getAttribute("style"), href, parents)
            );
          for (const el of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
            const cssHref = el.getAttribute("href");
            const url = await this.loadHref(cssHref, href, parents);
            const cssText = await fetch(url).then((r3) => r3.text()).catch(() => "");
            const style2 = doc.createElement("style");
            style2.dataset["ezReaderInlinedFrom"] = cssHref;
            style2.textContent = cssText;
            el.replaceWith(style2);
          }
          for (const el of doc.getElementsByTagNameNS("*", "script")) el.remove();
          for (const el of doc.getElementsByTagNameNS("*", "iframe")) el.remove();
          for (const el of doc.getElementsByTagNameNS("*", "frame")) el.remove();
          for (const el of doc.querySelectorAll("*")) {
            for (const attr of Array.from(el.attributes)) {
              if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
              if ((attr.name === "href" || attr.name === "src" || attr.name === "action" || attr.name === "formaction" || attr.name === "poster" || attr.name === "data" || attr.name === "xlink:href") && /^\s*javascript:/i.test(attr.value)) {
                el.removeAttribute(attr.name);
              }
            }
          }
          const result2 = new XMLSerializer().serializeToString(doc);
          return this.createURL(href, result2, item.mediaType, parent);
        }
        const result = mediaType === MIME.CSS ? await this.replaceCSS(str, href, parents) : await this.replaceString(str, href, parents);
        return this.createURL(href, result, mediaType, parent);
      }
      async replaceCSS(str, href, parents = []) {
        const importRe = /@import\s*["']([^"'\n]*?)["']/gi;
        const importMatches = [...str.matchAll(importRe)];
        if (importMatches.length > 0) {
          const inlines = await Promise.all(importMatches.map(
            (m3) => this.loadHref(m3[1], href, parents).then((url) => fetch(url).then((r3) => r3.text()).catch(() => ""))
          ));
          let i3 = 0;
          str = str.replace(importRe, () => inlines[i3++] ?? "");
        }
        return replaceSeries(
          str,
          /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi,
          (_2, url) => this.loadHref(url, href, parents).then((url2) => `url("${url2}")`)
        );
      }
      // find & replace all possible relative paths for all assets without parsing
      replaceString(str, href, parents = []) {
        const assetMap = /* @__PURE__ */ new Map();
        const urls = this.assets.map((asset) => {
          if (asset.href === href) return;
          const relative = pathRelative(pathDirname(href), asset.href);
          const relativeEnc = encodeURI(relative);
          const rootRelative = "/" + asset.href;
          const rootRelativeEnc = encodeURI(rootRelative);
          const set = /* @__PURE__ */ new Set([relative, relativeEnc, rootRelative, rootRelativeEnc]);
          for (const url of set) assetMap.set(url, asset);
          return Array.from(set);
        }).flat().filter((x3) => x3);
        if (!urls.length) return str;
        const regex = new RegExp(urls.map(regexEscape).join("|"), "g");
        return replaceSeries(str, regex, async (match) => this.loadItem(
          assetMap.get(match.replace(/^\//, "")),
          parents.concat(href)
        ));
      }
      unloadItem(item) {
        this.unref(item?.href);
      }
      destroy() {
        for (const url of this.#cache.values()) URL.revokeObjectURL(url);
      }
    };
    getHTMLFragment = (doc, id) => doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`);
    getPageSpread = (properties) => {
      for (const p3 of properties) {
        if (p3 === "page-spread-left" || p3 === "rendition:page-spread-left")
          return "left";
        if (p3 === "page-spread-right" || p3 === "rendition:page-spread-right")
          return "right";
        if (p3 === "rendition:page-spread-center") return "center";
      }
    };
    getDisplayOptions = (doc) => {
      if (!doc) return null;
      return {
        fixedLayout: getElementText(doc.querySelector('option[name="fixed-layout"]')),
        openToSpread: getElementText(doc.querySelector('option[name="open-to-spread"]'))
      };
    };
    EPUB = class {
      parser = new DOMParser();
      #loader;
      #encryption;
      constructor({ loadText, loadBlob, getSize, sha1 }) {
        this.loadText = loadText;
        this.loadBlob = loadBlob;
        this.getSize = getSize;
        this.#encryption = new Encryption(deobfuscators(sha1));
      }
      async #loadXML(uri) {
        const str = await this.loadText(uri);
        if (!str) return null;
        const doc = this.parser.parseFromString(str, MIME.XML);
        if (doc.querySelector("parsererror"))
          throw new Error(`XML parsing error: ${uri}
${doc.querySelector("parsererror").innerText}`);
        return doc;
      }
      async init() {
        const $container = await this.#loadXML("META-INF/container.xml");
        if (!$container) throw new Error("Failed to load container file");
        const opfs = Array.from(
          $container.getElementsByTagNameNS(NS.CONTAINER, "rootfile"),
          getAttributes("full-path", "media-type")
        ).filter((file) => file.mediaType === "application/oebps-package+xml");
        if (!opfs.length) throw new Error("No package document defined in container");
        const opfPath = opfs[0].fullPath;
        const opf = await this.#loadXML(opfPath);
        if (!opf) throw new Error("Failed to load package document");
        const $encryption = await this.#loadXML("META-INF/encryption.xml");
        await this.#encryption.init($encryption, opf);
        this.resources = new Resources({
          opf,
          resolveHref: (url) => resolveURL(url, opfPath)
        });
        this.#loader = new Loader({
          loadText: this.loadText,
          loadBlob: (uri) => Promise.resolve(this.loadBlob(uri)).then(this.#encryption.getDecoder(uri)),
          resources: this.resources
        });
        this.transformTarget = this.#loader.eventTarget;
        this.sections = this.resources.spine.map((spineItem, index) => {
          const { idref, linear, properties = [] } = spineItem;
          const item = this.resources.getItemByID(idref);
          if (!item) {
            console.warn(`Could not find item with ID "${idref}" in manifest`);
            return null;
          }
          return {
            id: item.href,
            load: () => this.#loader.loadItem(item),
            unload: () => this.#loader.unloadItem(item),
            createDocument: () => this.loadDocument(item),
            size: this.getSize(item.href),
            cfi: this.resources.cfis[index],
            linear,
            pageSpread: getPageSpread(properties),
            resolveHref: (href) => resolveURL(href, item.href),
            mediaOverlay: item.mediaOverlay ? this.resources.getItemByID(item.mediaOverlay) : null
          };
        }).filter((s3) => s3);
        const { navPath, ncxPath } = this.resources;
        if (navPath) try {
          const resolve = (url) => resolveURL(url, navPath);
          const nav = parseNav(await this.#loadXML(navPath), resolve);
          this.toc = nav.toc;
          this.pageList = nav.pageList;
          this.landmarks = nav.landmarks;
        } catch (e3) {
          console.warn(e3);
        }
        if (!this.toc && ncxPath) try {
          const resolve = (url) => resolveURL(url, ncxPath);
          const ncx = parseNCX(await this.#loadXML(ncxPath), resolve);
          this.toc = ncx.toc;
          this.pageList = ncx.pageList;
        } catch (e3) {
          console.warn(e3);
        }
        this.landmarks ??= this.resources.guide;
        const { metadata, rendition, media } = getMetadata(opf);
        this.metadata = metadata;
        this.rendition = rendition;
        this.media = media;
        this.dir = this.resources.pageProgressionDirection;
        const displayOptions = getDisplayOptions(
          await this.#loadXML("META-INF/com.apple.ibooks.display-options.xml") ?? await this.#loadXML("META-INF/com.kobobooks.display-options.xml")
        );
        if (displayOptions) {
          if (displayOptions.fixedLayout === "true")
            this.rendition.layout ??= "pre-paginated";
          if (displayOptions.openToSpread === "false") this.sections.find((section) => section.linear !== "no").pageSpread ??= this.dir === "rtl" ? "left" : "right";
        }
        return this;
      }
      async loadDocument(item) {
        const str = await this.loadText(item.href);
        return this.parser.parseFromString(str, item.mediaType);
      }
      getMediaOverlay() {
        return new MediaOverlay(this, this.#loadXML.bind(this));
      }
      resolveCFI(cfi) {
        return this.resources.resolveCFI(cfi);
      }
      resolveHref(href) {
        const [path, hash] = href.split("#");
        const item = this.resources.getItemByHref(decodeURI(path));
        if (!item) return null;
        const index = this.resources.spine.findIndex(({ idref }) => idref === item.id);
        const anchor = hash ? (doc) => getHTMLFragment(doc, hash) : () => 0;
        return { index, anchor };
      }
      splitTOCHref(href) {
        return href?.split("#") ?? [];
      }
      getTOCFragment(doc, id) {
        return doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`);
      }
      isExternal(uri) {
        return isExternal(uri);
      }
      async getCover() {
        const cover = this.resources?.cover;
        return cover?.href ? new Blob([await this.loadBlob(cover.href)], { type: cover.mediaType }) : null;
      }
      async getCalibreBookmarks() {
        const txt = await this.loadText("META-INF/calibre_bookmarks.txt");
        const magic = "encoding=json+base64:";
        if (txt?.startsWith(magic)) {
          const json = atob(txt.slice(magic.length));
          return JSON.parse(json);
        }
      }
      destroy() {
        this.#loader?.destroy();
      }
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/comic-book.js
var comic_book_exports = {};
__export(comic_book_exports, {
  makeComicBook: () => makeComicBook
});
var makeComicBook;
var init_comic_book = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/comic-book.js"() {
    makeComicBook = async ({ entries, loadBlob, getSize, getComment }, file) => {
      const cache2 = /* @__PURE__ */ new Map();
      const urls = /* @__PURE__ */ new Map();
      const load = async (name) => {
        if (cache2.has(name)) return cache2.get(name);
        const src = URL.createObjectURL(await loadBlob(name));
        const page = URL.createObjectURL(
          new Blob([`<body style="margin: 0"><img src="${src}">`], { type: "text/html" })
        );
        urls.set(name, [src, page]);
        cache2.set(name, page);
        return page;
      };
      const unload = (name) => {
        urls.get(name)?.forEach?.((url) => URL.revokeObjectURL(url));
        urls.delete(name);
        cache2.delete(name);
      };
      const exts = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".jxl", ".avif"];
      const files = entries.map((entry) => entry.filename).filter((name) => exts.some((ext) => name.endsWith(ext))).sort();
      if (!files.length) throw new Error("No supported image files in archive");
      const book = {};
      try {
        const jsonComment = JSON.parse(await getComment() || "");
        const info = jsonComment["ComicBookInfo/1.0"];
        if (info) {
          const year = info.publicationYear;
          const month = info.publicationMonth;
          const mm = month && month >= 1 && month <= 12 ? String(month).padStart(2, "0") : null;
          book.metadata = {
            title: info.title || file.name,
            publisher: info.publisher,
            language: info.language || info.lang,
            author: info.credits ? info.credits.map((c2) => `${c2.person} (${c2.role})`).join(", ") : "",
            published: year && month ? `${year}-${mm}` : void 0
          };
        } else {
          book.metadata = { title: file.name };
        }
      } catch {
        book.metadata = { title: file.name };
      }
      book.getCover = () => loadBlob(files[0]);
      book.sections = files.map((name) => ({
        id: name,
        load: () => load(name),
        unload: () => unload(name),
        size: getSize(name)
      }));
      book.toc = files.map((name) => ({ label: name, href: name }));
      book.rendition = { layout: "pre-paginated" };
      book.resolveHref = (href) => ({ index: book.sections.findIndex((s3) => s3.id === href) });
      book.splitTOCHref = (href) => [href, null];
      book.getTOCFragment = (doc) => doc.documentElement;
      book.destroy = () => {
        for (const arr of urls.values())
          for (const url of arr) URL.revokeObjectURL(url);
      };
      return book;
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/fb2.js
var fb2_exports = {};
__export(fb2_exports, {
  makeFB2: () => makeFB2
});
var normalizeWhitespace2, getElementText2, NS2, MIME2, STYLE, TABLE, POEM, SECTION, BODY, FB2Converter, parseXML, style, template, dataID, makeFB2;
var init_fb2 = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/fb2.js"() {
    normalizeWhitespace2 = (str) => str ? str.replace(/[\t\n\f\r ]+/g, " ").replace(/^[\t\n\f\r ]+/, "").replace(/[\t\n\f\r ]+$/, "") : "";
    getElementText2 = (el) => normalizeWhitespace2(el?.textContent);
    NS2 = {
      XLINK: "http://www.w3.org/1999/xlink",
      EPUB: "http://www.idpf.org/2007/ops"
    };
    MIME2 = {
      XML: "application/xml",
      XHTML: "application/xhtml+xml"
    };
    STYLE = {
      "strong": ["strong", "self"],
      "emphasis": ["em", "self"],
      "style": ["span", "self"],
      "a": "anchor",
      "strikethrough": ["s", "self"],
      "sub": ["sub", "self"],
      "sup": ["sup", "self"],
      "code": ["code", "self"],
      "image": "image"
    };
    TABLE = {
      "tr": ["tr", {
        "th": ["th", STYLE, ["colspan", "rowspan", "align", "valign"]],
        "td": ["td", STYLE, ["colspan", "rowspan", "align", "valign"]]
      }, ["align"]]
    };
    POEM = {
      "epigraph": ["blockquote"],
      "subtitle": ["h2", STYLE],
      "text-author": ["p", STYLE],
      "date": ["p", STYLE],
      "stanza": "stanza"
    };
    SECTION = {
      "title": ["header", {
        "p": ["h1", STYLE],
        "empty-line": ["br"]
      }],
      "epigraph": ["blockquote", "self"],
      "image": "image",
      "annotation": ["aside"],
      "section": ["section", "self"],
      "p": ["p", STYLE],
      "poem": ["blockquote", POEM],
      "subtitle": ["h2", STYLE],
      "cite": ["blockquote", "self"],
      "empty-line": ["br"],
      "table": ["table", TABLE],
      "text-author": ["p", STYLE]
    };
    POEM["epigraph"].push(SECTION);
    BODY = {
      "image": "image",
      "title": ["section", {
        "p": ["h1", STYLE],
        "empty-line": ["br"]
      }],
      "epigraph": ["section", SECTION],
      "section": ["section", SECTION]
    };
    FB2Converter = class {
      constructor(fb2) {
        this.fb2 = fb2;
        this.doc = document.implementation.createDocument(NS2.XHTML, "html");
        this.bins = new Map(Array.from(
          this.fb2.getElementsByTagName("binary"),
          (el) => [el.id, el]
        ));
      }
      getImageSrc(el) {
        const href = el.getAttributeNS(NS2.XLINK, "href");
        if (!href) return "data:,";
        const [, id] = href.split("#");
        if (!id) return href;
        const bin = this.bins.get(id);
        return bin ? `data:${bin.getAttribute("content-type")};base64,${bin.textContent}` : href;
      }
      image(node) {
        const el = this.doc.createElement("img");
        el.alt = node.getAttribute("alt");
        el.title = node.getAttribute("title");
        el.setAttribute("src", this.getImageSrc(node));
        return el;
      }
      anchor(node) {
        const el = this.convert(node, { "a": ["a", STYLE] });
        el.setAttribute("href", node.getAttributeNS(NS2.XLINK, "href"));
        if (node.getAttribute("type") === "note")
          el.setAttributeNS(NS2.EPUB, "epub:type", "noteref");
        return el;
      }
      stanza(node) {
        const el = this.convert(node, {
          "stanza": ["p", {
            "title": ["header", {
              "p": ["strong", STYLE],
              "empty-line": ["br"]
            }],
            "subtitle": ["p", STYLE]
          }]
        });
        for (const child of node.children) if (child.nodeName === "v") {
          el.append(this.doc.createTextNode(child.textContent));
          el.append(this.doc.createElement("br"));
        }
        return el;
      }
      convert(node, def) {
        if (node.nodeType === 3) return this.doc.createTextNode(node.textContent);
        if (node.nodeType === 4) return this.doc.createCDATASection(node.textContent);
        if (node.nodeType === 8) return this.doc.createComment(node.textContent);
        const d2 = def?.[node.nodeName];
        if (!d2) return null;
        if (typeof d2 === "string") return this[d2](node);
        const [name, opts, attrs] = d2;
        const el = this.doc.createElement(name);
        if (node.id) el.id = node.id;
        el.classList.add(node.nodeName);
        if (Array.isArray(attrs)) for (const attr of attrs) {
          const value = node.getAttribute(attr);
          if (value) el.setAttribute(attr, value);
        }
        const childDef = opts === "self" ? def : opts;
        let child = node.firstChild;
        while (child) {
          const childEl = this.convert(child, childDef);
          if (childEl) el.append(childEl);
          child = child.nextSibling;
        }
        return el;
      }
    };
    parseXML = async (blob) => {
      const buffer = await blob.arrayBuffer();
      const str = new TextDecoder("utf-8").decode(buffer);
      const parser2 = new DOMParser();
      const doc = parser2.parseFromString(str, MIME2.XML);
      const encoding = doc.xmlEncoding || str.match(/^<\?xml\s+version\s*=\s*["']1.\d+"\s+encoding\s*=\s*["']([A-Za-z0-9._-]*)["']/)?.[1];
      if (encoding && encoding.toLowerCase() !== "utf-8") {
        const str2 = new TextDecoder(encoding).decode(buffer);
        return parser2.parseFromString(str2, MIME2.XML);
      }
      return doc;
    };
    style = URL.createObjectURL(new Blob([`
@namespace epub "http://www.idpf.org/2007/ops";
body > img, section > img {
    display: block;
    margin: auto;
}
.title h1 {
    text-align: center;
}
body > section > .title, body.notesBodyType > .title {
    margin: 3em 0;
}
body.notesBodyType > section .title h1 {
    text-align: start;
}
body.notesBodyType > section .title {
    margin: 1em 0;
}
p {
    text-indent: 1em;
    margin: 0;
}
:not(p) + p, p:first-child {
    text-indent: 0;
}
.poem p {
    text-indent: 0;
    margin: 1em 0;
}
.text-author, .date {
    text-align: end;
}
.text-author:before {
    content: "\u2014";
}
table {
    border-collapse: collapse;
}
td, th {
    padding: .25em;
}
a[epub|type~="noteref"] {
    font-size: .75em;
    vertical-align: super;
}
body:not(.notesBodyType) > .title, body:not(.notesBodyType) > .epigraph {
    margin: 3em 0;
}
`], { type: "text/css" }));
    template = (html) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
    <head><link href="${style}" rel="stylesheet" type="text/css"/></head>
    <body>${html}</body>
</html>`;
    dataID = "data-foliate-id";
    makeFB2 = async (blob) => {
      const book = {};
      const doc = await parseXML(blob);
      const converter = new FB2Converter(doc);
      const $2 = (x3) => doc.querySelector(x3);
      const $$ = (x3) => [...doc.querySelectorAll(x3)];
      const getPerson = (el) => {
        const nick = getElementText2(el.querySelector("nickname"));
        if (nick) return nick;
        const first = getElementText2(el.querySelector("first-name"));
        const middle = getElementText2(el.querySelector("middle-name"));
        const last = getElementText2(el.querySelector("last-name"));
        const name = [first, middle, last].filter((x3) => x3).join(" ");
        const sortAs = last ? [last, [first, middle].filter((x3) => x3).join(" ")].join(", ") : null;
        return { name, sortAs };
      };
      const getDate = (el) => el?.getAttribute("value") ?? getElementText2(el);
      const annotation = $2("title-info annotation");
      book.metadata = {
        title: getElementText2($2("title-info book-title")),
        identifier: getElementText2($2("document-info id")),
        language: getElementText2($2("title-info lang")),
        author: $$("title-info author").map(getPerson),
        translator: $$("title-info translator").map(getPerson),
        contributor: $$("document-info author").map(getPerson).concat($$("document-info program-used").map(getElementText2)).map((x3) => Object.assign(
          typeof x3 === "string" ? { name: x3 } : x3,
          { role: "bkp" }
        )),
        publisher: getElementText2($2("publish-info publisher")),
        published: getDate($2("title-info date")),
        modified: getDate($2("document-info date")),
        description: annotation ? converter.convert(
          annotation,
          { annotation: ["div", SECTION] }
        ).innerHTML : null,
        subject: $$("title-info genre").map(getElementText2)
      };
      if ($2("coverpage image")) {
        const src = converter.getImageSrc($2("coverpage image"));
        book.getCover = () => fetch(src).then((res) => res.blob());
      } else book.getCover = () => null;
      const bodyData = Array.from(doc.querySelectorAll("body"), (body) => {
        const converted = converter.convert(body, { body: ["body", BODY] });
        return [Array.from(converted.children, (el) => {
          const ids = [el, ...el.querySelectorAll("[id]")].map((el2) => el2.id);
          return { el, ids };
        }), converted];
      });
      const urls = [];
      const sectionData = bodyData[0][0].map(({ el, ids }) => {
        const titles = Array.from(
          el.querySelectorAll(":scope > section > .title"),
          (el2, index) => {
            el2.setAttribute(dataID, index);
            return { title: getElementText2(el2), index };
          }
        );
        return { ids, titles, el };
      }).concat(bodyData.slice(1).map(([sections, body]) => {
        const ids = sections.map((s3) => s3.ids).flat();
        body.classList.add("notesBodyType");
        return { ids, el: body, linear: "no" };
      })).map(({ ids, titles, el, linear }) => {
        const str = template(el.outerHTML);
        const blob2 = new Blob([str], { type: MIME2.XHTML });
        const url = URL.createObjectURL(blob2);
        urls.push(url);
        const title = normalizeWhitespace2(
          el.querySelector(".title, .subtitle, p")?.textContent ?? (el.classList.contains("title") ? el.textContent : "")
        );
        return {
          ids,
          title,
          titles,
          load: () => url,
          createDocument: () => new DOMParser().parseFromString(str, MIME2.XHTML),
          // doo't count image data as it'd skew the size too much
          size: blob2.size - Array.from(
            el.querySelectorAll("[src]"),
            (el2) => el2.getAttribute("src")?.length ?? 0
          ).reduce((a3, b3) => a3 + b3, 0),
          linear
        };
      });
      const idMap = /* @__PURE__ */ new Map();
      book.sections = sectionData.map((section, index) => {
        const { ids, load, createDocument, size, linear } = section;
        for (const id of ids) if (id) idMap.set(id, index);
        return { id: index, load, createDocument, size, linear };
      });
      book.toc = sectionData.map(({ title, titles }, index) => {
        const id = index.toString();
        return {
          label: title,
          href: id,
          subitems: titles?.length ? titles.map(({ title: title2, index: index2 }) => ({
            label: title2,
            href: `${id}#${index2}`
          })) : null
        };
      }).filter((item) => item);
      book.resolveHref = (href) => {
        const [a3, b3] = href.split("#");
        return a3 ? { index: Number(a3), anchor: (doc2) => doc2.querySelector(`[${dataID}="${b3}"]`) } : { index: idMap.get(b3), anchor: (doc2) => doc2.getElementById(b3) };
      };
      book.splitTOCHref = (href) => href?.split("#")?.map((x3) => Number(x3)) ?? [];
      book.getTOCFragment = (doc2, id) => doc2.querySelector(`[${dataID}="${id}"]`);
      book.destroy = () => {
        for (const url of urls) URL.revokeObjectURL(url);
      };
      return book;
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/mobi.js
var mobi_exports = {};
__export(mobi_exports, {
  MOBI: () => MOBI,
  isMOBI: () => isMOBI
});
var unescapeHTML, MIME3, PDB_HEADER, PALMDOC_HEADER, MOBI_HEADER, KF8_HEADER, EXTH_HEADER, INDX_HEADER, TAGX_HEADER, HUFF_HEADER, CDIC_HEADER, FDST_HEADER, FONT_HEADER, MOBI_ENCODING, EXTH_RECORD_TYPE, MOBI_LANG, concatTypedArray, concatTypedArray3, decoder, getString, getUint, getStruct, getDecoder, getVarLen, getVarLenFromEnd, countBitsSet, countUnsetEnd, decompressPalmDOC, read32Bits, huffcdic, getIndexData, getNCX, getEXTH, getFont, isMOBI, PDB, MOBI, mbpPagebreakRegex, fileposRegex, getIndent, MOBI6, kindleResourceRegex, kindlePosRegex, parseResourceURI, parsePosURI, makePosURI, getFragmentSelector, replaceSeries2, getPageSpread2, KF8;
var init_mobi = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/mobi.js"() {
    unescapeHTML = (str) => {
      if (!str) return "";
      const textarea = document.createElement("textarea");
      textarea.innerHTML = str;
      return textarea.value;
    };
    MIME3 = {
      XML: "application/xml",
      XHTML: "application/xhtml+xml",
      HTML: "text/html",
      CSS: "text/css",
      SVG: "image/svg+xml"
    };
    PDB_HEADER = {
      name: [0, 32, "string"],
      type: [60, 4, "string"],
      creator: [64, 4, "string"],
      numRecords: [76, 2, "uint"]
    };
    PALMDOC_HEADER = {
      compression: [0, 2, "uint"],
      numTextRecords: [8, 2, "uint"],
      recordSize: [10, 2, "uint"],
      encryption: [12, 2, "uint"]
    };
    MOBI_HEADER = {
      magic: [16, 4, "string"],
      length: [20, 4, "uint"],
      type: [24, 4, "uint"],
      encoding: [28, 4, "uint"],
      uid: [32, 4, "uint"],
      version: [36, 4, "uint"],
      titleOffset: [84, 4, "uint"],
      titleLength: [88, 4, "uint"],
      localeRegion: [94, 1, "uint"],
      localeLanguage: [95, 1, "uint"],
      resourceStart: [108, 4, "uint"],
      huffcdic: [112, 4, "uint"],
      numHuffcdic: [116, 4, "uint"],
      exthFlag: [128, 4, "uint"],
      trailingFlags: [240, 4, "uint"],
      indx: [244, 4, "uint"]
    };
    KF8_HEADER = {
      resourceStart: [108, 4, "uint"],
      fdst: [192, 4, "uint"],
      numFdst: [196, 4, "uint"],
      frag: [248, 4, "uint"],
      skel: [252, 4, "uint"],
      guide: [260, 4, "uint"]
    };
    EXTH_HEADER = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      count: [8, 4, "uint"]
    };
    INDX_HEADER = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      type: [8, 4, "uint"],
      idxt: [20, 4, "uint"],
      numRecords: [24, 4, "uint"],
      encoding: [28, 4, "uint"],
      language: [32, 4, "uint"],
      total: [36, 4, "uint"],
      ordt: [40, 4, "uint"],
      ligt: [44, 4, "uint"],
      numLigt: [48, 4, "uint"],
      numCncx: [52, 4, "uint"]
    };
    TAGX_HEADER = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      numControlBytes: [8, 4, "uint"]
    };
    HUFF_HEADER = {
      magic: [0, 4, "string"],
      offset1: [8, 4, "uint"],
      offset2: [12, 4, "uint"]
    };
    CDIC_HEADER = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      numEntries: [8, 4, "uint"],
      codeLength: [12, 4, "uint"]
    };
    FDST_HEADER = {
      magic: [0, 4, "string"],
      numEntries: [8, 4, "uint"]
    };
    FONT_HEADER = {
      flags: [8, 4, "uint"],
      dataStart: [12, 4, "uint"],
      keyLength: [16, 4, "uint"],
      keyStart: [20, 4, "uint"]
    };
    MOBI_ENCODING = {
      1252: "windows-1252",
      65001: "utf-8"
    };
    EXTH_RECORD_TYPE = {
      100: ["creator", "string", true],
      101: ["publisher"],
      103: ["description"],
      104: ["isbn"],
      105: ["subject", "string", true],
      106: ["date"],
      108: ["contributor", "string", true],
      109: ["rights"],
      110: ["subjectCode", "string", true],
      112: ["source", "string", true],
      113: ["asin"],
      121: ["boundary", "uint"],
      122: ["fixedLayout"],
      125: ["numResources", "uint"],
      126: ["originalResolution"],
      127: ["zeroGutter"],
      128: ["zeroMargin"],
      129: ["coverURI"],
      132: ["regionMagnification"],
      201: ["coverOffset", "uint"],
      202: ["thumbnailOffset", "uint"],
      503: ["title"],
      524: ["language", "string", true],
      527: ["pageProgressionDirection"]
    };
    MOBI_LANG = {
      1: [
        "ar",
        "ar-SA",
        "ar-IQ",
        "ar-EG",
        "ar-LY",
        "ar-DZ",
        "ar-MA",
        "ar-TN",
        "ar-OM",
        "ar-YE",
        "ar-SY",
        "ar-JO",
        "ar-LB",
        "ar-KW",
        "ar-AE",
        "ar-BH",
        "ar-QA"
      ],
      2: ["bg"],
      3: ["ca"],
      4: ["zh", "zh-TW", "zh-CN", "zh-HK", "zh-SG"],
      5: ["cs"],
      6: ["da"],
      7: ["de", "de-DE", "de-CH", "de-AT", "de-LU", "de-LI"],
      8: ["el"],
      9: [
        "en",
        "en-US",
        "en-GB",
        "en-AU",
        "en-CA",
        "en-NZ",
        "en-IE",
        "en-ZA",
        "en-JM",
        null,
        "en-BZ",
        "en-TT",
        "en-ZW",
        "en-PH"
      ],
      10: [
        "es",
        "es-ES",
        "es-MX",
        null,
        "es-GT",
        "es-CR",
        "es-PA",
        "es-DO",
        "es-VE",
        "es-CO",
        "es-PE",
        "es-AR",
        "es-EC",
        "es-CL",
        "es-UY",
        "es-PY",
        "es-BO",
        "es-SV",
        "es-HN",
        "es-NI",
        "es-PR"
      ],
      11: ["fi"],
      12: ["fr", "fr-FR", "fr-BE", "fr-CA", "fr-CH", "fr-LU", "fr-MC"],
      13: ["he"],
      14: ["hu"],
      15: ["is"],
      16: ["it", "it-IT", "it-CH"],
      17: ["ja"],
      18: ["ko"],
      19: ["nl", "nl-NL", "nl-BE"],
      20: ["no", "nb", "nn"],
      21: ["pl"],
      22: ["pt", "pt-BR", "pt-PT"],
      23: ["rm"],
      24: ["ro"],
      25: ["ru"],
      26: ["hr", null, "sr"],
      27: ["sk"],
      28: ["sq"],
      29: ["sv", "sv-SE", "sv-FI"],
      30: ["th"],
      31: ["tr"],
      32: ["ur"],
      33: ["id"],
      34: ["uk"],
      35: ["be"],
      36: ["sl"],
      37: ["et"],
      38: ["lv"],
      39: ["lt"],
      41: ["fa"],
      42: ["vi"],
      43: ["hy"],
      44: ["az"],
      45: ["eu"],
      46: ["hsb"],
      47: ["mk"],
      48: ["st"],
      49: ["ts"],
      50: ["tn"],
      52: ["xh"],
      53: ["zu"],
      54: ["af"],
      55: ["ka"],
      56: ["fo"],
      57: ["hi"],
      58: ["mt"],
      59: ["se"],
      62: ["ms"],
      63: ["kk"],
      65: ["sw"],
      67: ["uz", null, "uz-UZ"],
      68: ["tt"],
      69: ["bn"],
      70: ["pa"],
      71: ["gu"],
      72: ["or"],
      73: ["ta"],
      74: ["te"],
      75: ["kn"],
      76: ["ml"],
      77: ["as"],
      78: ["mr"],
      79: ["sa"],
      82: ["cy", "cy-GB"],
      83: ["gl", "gl-ES"],
      87: ["kok"],
      97: ["ne"],
      98: ["fy"]
    };
    concatTypedArray = (a3, b3) => {
      const result = new a3.constructor(a3.length + b3.length);
      result.set(a3);
      result.set(b3, a3.length);
      return result;
    };
    concatTypedArray3 = (a3, b3, c2) => {
      const result = new a3.constructor(a3.length + b3.length + c2.length);
      result.set(a3);
      result.set(b3, a3.length);
      result.set(c2, a3.length + b3.length);
      return result;
    };
    decoder = new TextDecoder();
    getString = (buffer) => decoder.decode(buffer);
    getUint = (buffer) => {
      if (!buffer) return;
      const l3 = buffer.byteLength;
      const func = l3 === 4 ? "getUint32" : l3 === 2 ? "getUint16" : "getUint8";
      return new DataView(buffer)[func](0);
    };
    getStruct = (def, buffer) => Object.fromEntries(Array.from(Object.entries(def)).map(([key, [start, len, type]]) => [
      key,
      (type === "string" ? getString : getUint)(buffer.slice(start, start + len))
    ]));
    getDecoder = (x3) => new TextDecoder(MOBI_ENCODING[x3]);
    getVarLen = (byteArray, i3 = 0) => {
      let value = 0, length = 0;
      for (const byte of byteArray.subarray(i3, i3 + 4)) {
        value = value << 7 | (byte & 127) >>> 0;
        length++;
        if (byte & 128) break;
      }
      return { value, length };
    };
    getVarLenFromEnd = (byteArray) => {
      let value = 0;
      for (const byte of byteArray.subarray(-4)) {
        if (byte & 128) value = 0;
        value = value << 7 | byte & 127;
      }
      return value;
    };
    countBitsSet = (x3) => {
      let count = 0;
      for (; x3 > 0; x3 = x3 >> 1) if ((x3 & 1) === 1) count++;
      return count;
    };
    countUnsetEnd = (x3) => {
      let count = 0;
      while ((x3 & 1) === 0) x3 = x3 >> 1, count++;
      return count;
    };
    decompressPalmDOC = (array) => {
      let output = [];
      for (let i3 = 0; i3 < array.length; i3++) {
        const byte = array[i3];
        if (byte === 0) output.push(0);
        else if (byte <= 8)
          for (const x3 of array.subarray(i3 + 1, (i3 += byte) + 1))
            output.push(x3);
        else if (byte <= 127) output.push(byte);
        else if (byte <= 191) {
          const bytes = byte << 8 | array[i3++ + 1];
          const distance = (bytes & 16383) >>> 3;
          const length = (bytes & 7) + 3;
          for (let j2 = 0; j2 < length; j2++)
            output.push(output[output.length - distance]);
        } else output.push(32, byte ^ 128);
      }
      return Uint8Array.from(output);
    };
    read32Bits = (byteArray, from) => {
      const startByte = from >> 3;
      const end = from + 32;
      const endByte = end >> 3;
      let bits2 = 0n;
      for (let i3 = startByte; i3 <= endByte; i3++)
        bits2 = bits2 << 8n | BigInt(byteArray[i3] ?? 0);
      return bits2 >> 8n - BigInt(end & 7) & 0xffffffffn;
    };
    huffcdic = async (mobi, loadRecord) => {
      const huffRecord = await loadRecord(mobi.huffcdic);
      const { magic, offset1, offset2 } = getStruct(HUFF_HEADER, huffRecord);
      if (magic !== "HUFF") throw new Error("Invalid HUFF record");
      const table1 = Array.from({ length: 256 }, (_2, i3) => offset1 + i3 * 4).map((offset) => getUint(huffRecord.slice(offset, offset + 4))).map((x3) => [x3 & 128, x3 & 31, x3 >>> 8]);
      const table2 = [null].concat(Array.from({ length: 32 }, (_2, i3) => offset2 + i3 * 8).map((offset) => [
        getUint(huffRecord.slice(offset, offset + 4)),
        getUint(huffRecord.slice(offset + 4, offset + 8))
      ]));
      const dictionary = [];
      for (let i3 = 1; i3 < mobi.numHuffcdic; i3++) {
        const record = await loadRecord(mobi.huffcdic + i3);
        const cdic = getStruct(CDIC_HEADER, record);
        if (cdic.magic !== "CDIC") throw new Error("Invalid CDIC record");
        const n3 = Math.min(1 << cdic.codeLength, cdic.numEntries - dictionary.length);
        const buffer = record.slice(cdic.length);
        for (let i4 = 0; i4 < n3; i4++) {
          const offset = getUint(buffer.slice(i4 * 2, i4 * 2 + 2));
          const x3 = getUint(buffer.slice(offset, offset + 2));
          const length = x3 & 32767;
          const decompressed = x3 & 32768;
          const value = new Uint8Array(
            buffer.slice(offset + 2, offset + 2 + length)
          );
          dictionary.push([value, decompressed]);
        }
      }
      const decompress = (byteArray) => {
        let output = new Uint8Array();
        const bitLength = byteArray.byteLength * 8;
        for (let i3 = 0; i3 < bitLength; ) {
          const bits2 = Number(read32Bits(byteArray, i3));
          let [found, codeLength, value] = table1[bits2 >>> 24];
          if (!found) {
            while (bits2 >>> 32 - codeLength < table2[codeLength][0])
              codeLength += 1;
            value = table2[codeLength][1];
          }
          if ((i3 += codeLength) > bitLength) break;
          const code = value - (bits2 >>> 32 - codeLength);
          let [result, decompressed] = dictionary[code];
          if (!decompressed) {
            result = decompress(result);
            dictionary[code] = [result, true];
          }
          output = concatTypedArray(output, result);
        }
        return output;
      };
      return decompress;
    };
    getIndexData = async (indxIndex, loadRecord) => {
      const indxRecord = await loadRecord(indxIndex);
      const indx = getStruct(INDX_HEADER, indxRecord);
      if (indx.magic !== "INDX") throw new Error("Invalid INDX record");
      const decoder3 = getDecoder(indx.encoding);
      const tagxBuffer = indxRecord.slice(indx.length);
      const tagx = getStruct(TAGX_HEADER, tagxBuffer);
      if (tagx.magic !== "TAGX") throw new Error("Invalid TAGX section");
      const numTags = (tagx.length - 12) / 4;
      const tagTable = Array.from({ length: numTags }, (_2, i3) => new Uint8Array(tagxBuffer.slice(12 + i3 * 4, 12 + i3 * 4 + 4)));
      const cncx = {};
      let cncxRecordOffset = 0;
      for (let i3 = 0; i3 < indx.numCncx; i3++) {
        const record = await loadRecord(indxIndex + indx.numRecords + i3 + 1);
        const array = new Uint8Array(record);
        for (let pos = 0; pos < array.byteLength; ) {
          const index = pos;
          const { value, length } = getVarLen(array, pos);
          pos += length;
          const result = record.slice(pos, pos + value);
          pos += value;
          cncx[cncxRecordOffset + index] = decoder3.decode(result);
        }
        cncxRecordOffset += 65536;
      }
      const table = [];
      for (let i3 = 0; i3 < indx.numRecords; i3++) {
        const record = await loadRecord(indxIndex + 1 + i3);
        const array = new Uint8Array(record);
        const indx2 = getStruct(INDX_HEADER, record);
        if (indx2.magic !== "INDX") throw new Error("Invalid INDX record");
        for (let j2 = 0; j2 < indx2.numRecords; j2++) {
          const offsetOffset = indx2.idxt + 4 + 2 * j2;
          const offset = getUint(record.slice(offsetOffset, offsetOffset + 2));
          const length = getUint(record.slice(offset, offset + 1));
          const name = getString(record.slice(offset + 1, offset + 1 + length));
          const tags = [];
          const startPos = offset + 1 + length;
          let controlByteIndex = 0;
          let pos = startPos + tagx.numControlBytes;
          for (const [tag, numValues, mask, end] of tagTable) {
            if (end & 1) {
              controlByteIndex++;
              continue;
            }
            const offset2 = startPos + controlByteIndex;
            const value = getUint(record.slice(offset2, offset2 + 1)) & mask;
            if (value === mask) {
              if (countBitsSet(mask) > 1) {
                const { value: value2, length: length2 } = getVarLen(array, pos);
                tags.push([tag, null, value2, numValues]);
                pos += length2;
              } else tags.push([tag, 1, null, numValues]);
            } else tags.push([tag, value >> countUnsetEnd(mask), null, numValues]);
          }
          const tagMap = {};
          for (const [tag, valueCount, valueBytes, numValues] of tags) {
            const values = [];
            if (valueCount != null) {
              for (let i4 = 0; i4 < valueCount * numValues; i4++) {
                const { value, length: length2 } = getVarLen(array, pos);
                values.push(value);
                pos += length2;
              }
            } else {
              let count = 0;
              while (count < valueBytes) {
                const { value, length: length2 } = getVarLen(array, pos);
                values.push(value);
                pos += length2;
                count += length2;
              }
            }
            tagMap[tag] = values;
          }
          table.push({ name, tagMap });
        }
      }
      return { table, cncx };
    };
    getNCX = async (indxIndex, loadRecord) => {
      const { table, cncx } = await getIndexData(indxIndex, loadRecord);
      const items = table.map(({ tagMap }, index) => ({
        index,
        offset: tagMap[1]?.[0],
        size: tagMap[2]?.[0],
        label: cncx[tagMap[3]] ?? "",
        headingLevel: tagMap[4]?.[0],
        pos: tagMap[6],
        parent: tagMap[21]?.[0],
        firstChild: tagMap[22]?.[0],
        lastChild: tagMap[23]?.[0]
      }));
      const getChildren = (item) => {
        if (item.firstChild == null) return item;
        item.children = items.filter((x3) => x3.parent === item.index).map(getChildren);
        return item;
      };
      return items.filter((item) => item.headingLevel === 0).map(getChildren);
    };
    getEXTH = (buf, encoding) => {
      const { magic, count } = getStruct(EXTH_HEADER, buf);
      if (magic !== "EXTH") throw new Error("Invalid EXTH header");
      const decoder3 = getDecoder(encoding);
      const results = {};
      let offset = 12;
      for (let i3 = 0; i3 < count; i3++) {
        const type = getUint(buf.slice(offset, offset + 4));
        const length = getUint(buf.slice(offset + 4, offset + 8));
        if (type in EXTH_RECORD_TYPE) {
          const [name, typ, many] = EXTH_RECORD_TYPE[type];
          const data = buf.slice(offset + 8, offset + length);
          const value = typ === "uint" ? getUint(data) : decoder3.decode(data);
          if (many) {
            results[name] ??= [];
            results[name].push(value);
          } else results[name] = value;
        }
        offset += length;
      }
      return results;
    };
    getFont = async (buf, unzlib) => {
      const { flags, dataStart, keyLength, keyStart } = getStruct(FONT_HEADER, buf);
      const array = new Uint8Array(buf.slice(dataStart));
      if (flags & 2) {
        const bytes = keyLength === 16 ? 1024 : 1040;
        const key = new Uint8Array(buf.slice(keyStart, keyStart + keyLength));
        const length = Math.min(bytes, array.length);
        for (var i3 = 0; i3 < length; i3++) array[i3] = array[i3] ^ key[i3 % key.length];
      }
      if (flags & 1) try {
        return await unzlib(array);
      } catch (e3) {
        console.warn(e3);
        console.warn("Failed to decompress font");
      }
      return array;
    };
    isMOBI = async (file) => {
      const magic = getString(await file.slice(60, 68).arrayBuffer());
      return magic === "BOOKMOBI";
    };
    PDB = class {
      #file;
      #offsets;
      pdb;
      async open(file) {
        this.#file = file;
        const pdb = getStruct(PDB_HEADER, await file.slice(0, 78).arrayBuffer());
        this.pdb = pdb;
        const buffer = await file.slice(78, 78 + pdb.numRecords * 8).arrayBuffer();
        this.#offsets = Array.from(
          { length: pdb.numRecords },
          (_2, i3) => getUint(buffer.slice(i3 * 8, i3 * 8 + 4))
        ).map((x3, i3, a3) => [x3, a3[i3 + 1]]);
      }
      loadRecord(index) {
        const offsets = this.#offsets[index];
        if (!offsets) throw new RangeError("Record index out of bounds");
        return this.#file.slice(...offsets).arrayBuffer();
      }
      async loadMagic(index) {
        const start = this.#offsets[index][0];
        return getString(await this.#file.slice(start, start + 4).arrayBuffer());
      }
    };
    MOBI = class extends PDB {
      #start = 0;
      #resourceStart;
      #decoder;
      #encoder;
      #decompress;
      #removeTrailingEntries;
      constructor({ unzlib }) {
        super();
        this.unzlib = unzlib;
      }
      async open(file) {
        await super.open(file);
        this.headers = this.#getHeaders(await super.loadRecord(0));
        this.#resourceStart = this.headers.mobi.resourceStart;
        let isKF8 = this.headers.mobi.version >= 8;
        if (!isKF8) {
          const boundary = this.headers.exth?.boundary;
          if (boundary < 4294967295) try {
            this.headers = this.#getHeaders(await super.loadRecord(boundary));
            this.#start = boundary;
            isKF8 = true;
          } catch (e3) {
            console.warn(e3);
            console.warn("Failed to open KF8; falling back to MOBI");
          }
        }
        await this.#setup();
        return isKF8 ? new KF8(this).init() : new MOBI6(this).init();
      }
      #getHeaders(buf) {
        const palmdoc = getStruct(PALMDOC_HEADER, buf);
        const mobi = getStruct(MOBI_HEADER, buf);
        if (mobi.magic !== "MOBI") throw new Error("Missing MOBI header");
        const { titleOffset, titleLength, localeLanguage, localeRegion } = mobi;
        mobi.title = buf.slice(titleOffset, titleOffset + titleLength);
        const lang = MOBI_LANG[localeLanguage];
        mobi.language = lang?.[localeRegion >> 2] ?? lang?.[0];
        const exth = mobi.exthFlag & 64 ? getEXTH(buf.slice(mobi.length + 16), mobi.encoding) : null;
        const kf8 = mobi.version >= 8 ? getStruct(KF8_HEADER, buf) : null;
        return { palmdoc, mobi, exth, kf8 };
      }
      async #setup() {
        const { palmdoc, mobi } = this.headers;
        this.#decoder = getDecoder(mobi.encoding);
        this.#encoder = new TextEncoder();
        const { compression } = palmdoc;
        this.#decompress = compression === 1 ? (f3) => f3 : compression === 2 ? decompressPalmDOC : compression === 17480 ? await huffcdic(mobi, this.loadRecord.bind(this)) : null;
        if (!this.#decompress) throw new Error("Unknown compression type");
        const { trailingFlags } = mobi;
        const multibyte = trailingFlags & 1;
        const numTrailingEntries = countBitsSet(trailingFlags >>> 1);
        this.#removeTrailingEntries = (array) => {
          for (let i3 = 0; i3 < numTrailingEntries; i3++) {
            const length = getVarLenFromEnd(array);
            array = array.subarray(0, -length);
          }
          if (multibyte) {
            const length = (array[array.length - 1] & 3) + 1;
            array = array.subarray(0, -length);
          }
          return array;
        };
      }
      decode(...args) {
        return this.#decoder.decode(...args);
      }
      encode(...args) {
        return this.#encoder.encode(...args);
      }
      loadRecord(index) {
        return super.loadRecord(this.#start + index);
      }
      loadMagic(index) {
        return super.loadMagic(this.#start + index);
      }
      loadText(index) {
        return this.loadRecord(index + 1).then((buf) => new Uint8Array(buf)).then(this.#removeTrailingEntries).then(this.#decompress);
      }
      async loadResource(index) {
        const buf = await super.loadRecord(this.#resourceStart + index);
        const magic = getString(buf.slice(0, 4));
        if (magic === "FONT") return getFont(buf, this.unzlib);
        if (magic === "VIDE" || magic === "AUDI") return buf.slice(12);
        return buf;
      }
      getNCX() {
        const index = this.headers.mobi.indx;
        if (index < 4294967295) return getNCX(index, this.loadRecord.bind(this));
      }
      getMetadata() {
        const { mobi, exth } = this.headers;
        return {
          identifier: mobi.uid.toString(),
          title: unescapeHTML(exth?.title || this.decode(mobi.title)),
          author: exth?.creator?.map(unescapeHTML),
          publisher: unescapeHTML(exth?.publisher),
          language: exth?.language ?? mobi.language,
          published: exth?.date,
          description: unescapeHTML(exth?.description),
          subject: exth?.subject?.map(unescapeHTML),
          rights: unescapeHTML(exth?.rights),
          contributor: exth?.contributor
        };
      }
      async getCover() {
        const { exth } = this.headers;
        const offset = exth?.coverOffset < 4294967295 ? exth?.coverOffset : exth?.thumbnailOffset < 4294967295 ? exth?.thumbnailOffset : null;
        if (offset != null) {
          const buf = await this.loadResource(offset);
          return new Blob([buf]);
        }
      }
    };
    mbpPagebreakRegex = /<\s*(?:mbp:)?pagebreak[^>]*>/gi;
    fileposRegex = /<[^<>]+filepos=['"]{0,1}(\d+)[^<>]*>/gi;
    getIndent = (el) => {
      let x3 = 0;
      while (el) {
        const parent = el.parentElement;
        if (parent) {
          const tag = parent.tagName.toLowerCase();
          if (tag === "p") x3 += 1.5;
          else if (tag === "blockquote") x3 += 2;
        }
        el = parent;
      }
      return x3;
    };
    MOBI6 = class {
      parser = new DOMParser();
      serializer = new XMLSerializer();
      #resourceCache = /* @__PURE__ */ new Map();
      #textCache = /* @__PURE__ */ new Map();
      #cache = /* @__PURE__ */ new Map();
      #sections;
      #fileposList = [];
      #type = MIME3.HTML;
      constructor(mobi) {
        this.mobi = mobi;
      }
      async init() {
        let array = new Uint8Array();
        for (let i3 = 0; i3 < this.mobi.headers.palmdoc.numTextRecords; i3++)
          array = concatTypedArray(array, await this.mobi.loadText(i3));
        const str = Array.from(
          new Uint8Array(array),
          (c2) => String.fromCharCode(c2)
        ).join("");
        this.#sections = [0].concat(Array.from(str.matchAll(mbpPagebreakRegex), (m3) => m3.index)).map((x3, i3, a3) => str.slice(x3, a3[i3 + 1])).map((str2) => Uint8Array.from(str2, (x3) => x3.charCodeAt(0))).map((raw) => ({ book: this, raw })).reduce((arr, x3) => {
          const last = arr[arr.length - 1];
          x3.start = last?.end ?? 0;
          x3.end = x3.start + x3.raw.byteLength;
          return arr.concat(x3);
        }, []);
        this.sections = this.#sections.map((section, index) => ({
          id: index,
          load: () => this.loadSection(section),
          createDocument: () => this.createDocument(section),
          size: section.end - section.start
        }));
        try {
          this.landmarks = await this.getGuide();
          const tocHref = this.landmarks.find(({ type }) => type?.includes("toc"))?.href;
          if (tocHref) {
            const { index } = this.resolveHref(tocHref);
            const doc = await this.sections[index].createDocument();
            let lastItem;
            let lastLevel = 0;
            let lastIndent = 0;
            const lastLevelOfIndent = /* @__PURE__ */ new Map();
            const lastParentOfLevel = /* @__PURE__ */ new Map();
            this.toc = Array.from(doc.querySelectorAll("a[filepos]")).reduce((arr, a3) => {
              const indent = getIndent(a3);
              const item = {
                label: a3.innerText?.trim() ?? "",
                href: `filepos:${a3.getAttribute("filepos")}`
              };
              const level = indent > lastIndent ? lastLevel + 1 : indent === lastIndent ? lastLevel : lastLevelOfIndent.get(indent) ?? Math.max(0, lastLevel - 1);
              if (level > lastLevel) {
                if (lastItem) {
                  lastItem.subitems ??= [];
                  lastItem.subitems.push(item);
                  lastParentOfLevel.set(level, lastItem);
                } else arr.push(item);
              } else {
                const parent = lastParentOfLevel.get(level);
                if (parent) parent.subitems.push(item);
                else arr.push(item);
              }
              lastItem = item;
              lastLevel = level;
              lastIndent = indent;
              lastLevelOfIndent.set(indent, level);
              return arr;
            }, []);
          }
        } catch (e3) {
          console.warn(e3);
        }
        this.#fileposList = [...new Set(
          Array.from(str.matchAll(fileposRegex), (m3) => m3[1])
        )].map((filepos) => ({ filepos, number: Number(filepos) })).sort((a3, b3) => a3.number - b3.number);
        this.metadata = this.mobi.getMetadata();
        this.getCover = this.mobi.getCover.bind(this.mobi);
        return this;
      }
      async getGuide() {
        const doc = await this.createDocument(this.#sections[0]);
        return Array.from(doc.getElementsByTagName("reference"), (ref) => ({
          label: ref.getAttribute("title"),
          type: ref.getAttribute("type")?.split(/\s/),
          href: `filepos:${ref.getAttribute("filepos")}`
        }));
      }
      async loadResource(index) {
        if (this.#resourceCache.has(index)) return this.#resourceCache.get(index);
        const raw = await this.mobi.loadResource(index);
        const url = URL.createObjectURL(new Blob([raw]));
        this.#resourceCache.set(index, url);
        return url;
      }
      async loadRecindex(recindex) {
        return this.loadResource(Number(recindex) - 1);
      }
      async replaceResources(doc) {
        for (const img of doc.querySelectorAll("img[recindex]")) {
          const recindex = img.getAttribute("recindex");
          try {
            img.src = await this.loadRecindex(recindex);
          } catch {
            console.warn(`Failed to load image ${recindex}`);
          }
        }
        for (const media of doc.querySelectorAll("[mediarecindex]")) {
          const mediarecindex = media.getAttribute("mediarecindex");
          const recindex = media.getAttribute("recindex");
          try {
            media.src = await this.loadRecindex(mediarecindex);
            if (recindex) media.poster = await this.loadRecindex(recindex);
          } catch {
            console.warn(`Failed to load media ${mediarecindex}`);
          }
        }
        for (const a3 of doc.querySelectorAll("[filepos]")) {
          const filepos = a3.getAttribute("filepos");
          a3.href = `filepos:${filepos}`;
        }
      }
      async loadText(section) {
        if (this.#textCache.has(section)) return this.#textCache.get(section);
        const { raw } = section;
        const fileposList = this.#fileposList.filter(({ number }) => number >= section.start && number < section.end).map((obj) => ({ ...obj, offset: obj.number - section.start }));
        let arr = raw;
        if (fileposList.length) {
          arr = raw.subarray(0, fileposList[0].offset);
          fileposList.forEach(({ filepos, offset }, i3) => {
            const next = fileposList[i3 + 1];
            const a3 = this.mobi.encode(`<a id="filepos${filepos}"></a>`);
            arr = concatTypedArray3(arr, a3, raw.subarray(offset, next?.offset));
          });
        }
        const str = this.mobi.decode(arr).replaceAll(mbpPagebreakRegex, "");
        this.#textCache.set(section, str);
        return str;
      }
      async createDocument(section) {
        const str = await this.loadText(section);
        return this.parser.parseFromString(str, this.#type);
      }
      async loadSection(section) {
        if (this.#cache.has(section)) return this.#cache.get(section);
        const doc = await this.createDocument(section);
        const style2 = doc.createElement("style");
        doc.head.append(style2);
        style2.append(doc.createTextNode(`blockquote {
            margin-block-start: 0;
            margin-block-end: 0;
            margin-inline-start: 1em;
            margin-inline-end: 0;
        }`));
        await this.replaceResources(doc);
        const result = this.serializer.serializeToString(doc);
        const url = URL.createObjectURL(new Blob([result], { type: this.#type }));
        this.#cache.set(section, url);
        return url;
      }
      resolveHref(href) {
        const filepos = href.match(/filepos:(.*)/)[1];
        const number = Number(filepos);
        const index = this.#sections.findIndex((section) => section.end > number);
        const anchor = (doc) => doc.getElementById(`filepos${filepos}`);
        return { index, anchor };
      }
      splitTOCHref(href) {
        const filepos = href.match(/filepos:(.*)/)[1];
        const number = Number(filepos);
        const index = this.#sections.findIndex((section) => section.end > number);
        return [index, `filepos${filepos}`];
      }
      getTOCFragment(doc, id) {
        return doc.getElementById(id);
      }
      isExternal(uri) {
        return /^(?!blob|filepos)\w+:/i.test(uri);
      }
      destroy() {
        for (const url of this.#resourceCache.values()) URL.revokeObjectURL(url);
        for (const url of this.#cache.values()) URL.revokeObjectURL(url);
      }
    };
    kindleResourceRegex = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/;
    kindlePosRegex = /kindle:pos:fid:(\w+):off:(\w+)/;
    parseResourceURI = (str) => {
      const [resourceType, id, type] = str.match(kindleResourceRegex).slice(1);
      return { resourceType, id: parseInt(id, 32), type };
    };
    parsePosURI = (str) => {
      const [fid, off] = str.match(kindlePosRegex).slice(1);
      return { fid: parseInt(fid, 32), off: parseInt(off, 32) };
    };
    makePosURI = (fid = 0, off = 0) => `kindle:pos:fid:${fid.toString(32).toUpperCase().padStart(4, "0")}:off:${off.toString(32).toUpperCase().padStart(10, "0")}`;
    getFragmentSelector = (str) => {
      const match = str.match(/\s(id|name|aid)\s*=\s*['"]([^'"]*)['"]/i);
      if (!match) return;
      const [, attr, value] = match;
      return `[${attr}="${CSS.escape(value)}"]`;
    };
    replaceSeries2 = async (str, regex, f3) => {
      const matches2 = [];
      str.replace(regex, (...args) => (matches2.push(args), null));
      const results = [];
      for (const args of matches2) results.push(await f3(...args));
      return str.replace(regex, () => results.shift());
    };
    getPageSpread2 = (properties) => {
      for (const p3 of properties) {
        if (p3 === "page-spread-left" || p3 === "rendition:page-spread-left")
          return "left";
        if (p3 === "page-spread-right" || p3 === "rendition:page-spread-right")
          return "right";
        if (p3 === "rendition:page-spread-center") return "center";
      }
    };
    KF8 = class {
      parser = new DOMParser();
      serializer = new XMLSerializer();
      #cache = /* @__PURE__ */ new Map();
      #fragmentOffsets = /* @__PURE__ */ new Map();
      #fragmentSelectors = /* @__PURE__ */ new Map();
      #tables = {};
      #sections;
      #fullRawLength;
      #rawHead = new Uint8Array();
      #rawTail = new Uint8Array();
      #lastLoadedHead = -1;
      #lastLoadedTail = -1;
      #type = MIME3.XHTML;
      #inlineMap = /* @__PURE__ */ new Map();
      constructor(mobi) {
        this.mobi = mobi;
      }
      async init() {
        const loadRecord = this.mobi.loadRecord.bind(this.mobi);
        const { kf8 } = this.mobi.headers;
        try {
          const fdstBuffer = await loadRecord(kf8.fdst);
          const fdst = getStruct(FDST_HEADER, fdstBuffer);
          if (fdst.magic !== "FDST") throw new Error("Missing FDST record");
          const fdstTable = Array.from(
            { length: fdst.numEntries },
            (_2, i3) => 12 + i3 * 8
          ).map((offset) => [
            getUint(fdstBuffer.slice(offset, offset + 4)),
            getUint(fdstBuffer.slice(offset + 4, offset + 8))
          ]);
          this.#tables.fdstTable = fdstTable;
          this.#fullRawLength = fdstTable[fdstTable.length - 1][1];
        } catch {
        }
        const skelTable = (await getIndexData(kf8.skel, loadRecord)).table.map(({ name, tagMap }, index) => ({
          index,
          name,
          numFrag: tagMap[1][0],
          offset: tagMap[6][0],
          length: tagMap[6][1]
        }));
        const fragData = await getIndexData(kf8.frag, loadRecord);
        const fragTable = fragData.table.map(({ name, tagMap }) => ({
          insertOffset: parseInt(name),
          selector: fragData.cncx[tagMap[2][0]],
          index: tagMap[4][0],
          offset: tagMap[6][0],
          length: tagMap[6][1]
        }));
        this.#tables.skelTable = skelTable;
        this.#tables.fragTable = fragTable;
        this.#sections = skelTable.reduce((arr, skel) => {
          const last = arr[arr.length - 1];
          const fragStart = last?.fragEnd ?? 0, fragEnd = fragStart + skel.numFrag;
          const frags = fragTable.slice(fragStart, fragEnd);
          const length = skel.length + frags.map((f3) => f3.length).reduce((a3, b3) => a3 + b3);
          const totalLength = (last?.totalLength ?? 0) + length;
          return arr.concat({ skel, frags, fragEnd, length, totalLength });
        }, []);
        const resources = await this.getResourcesByMagic(["RESC", "PAGE"]);
        const pageSpreads = /* @__PURE__ */ new Map();
        if (resources.RESC) {
          const buf = await this.mobi.loadRecord(resources.RESC);
          const str = this.mobi.decode(buf.slice(16)).replace(/\0/g, "");
          const index = str.search(/\?>/);
          const xmlStr = `<package>${str.slice(index)}</package>`;
          const opf = this.parser.parseFromString(xmlStr, MIME3.XML);
          for (const $itemref of opf.querySelectorAll("spine > itemref")) {
            const i3 = parseInt($itemref.getAttribute("skelid"));
            pageSpreads.set(i3, getPageSpread2(
              $itemref.getAttribute("properties")?.split(" ") ?? []
            ));
          }
        }
        this.sections = this.#sections.map((section, index) => section.frags.length ? {
          id: index,
          load: () => this.loadSection(section),
          createDocument: () => this.createDocument(section),
          size: section.length,
          pageSpread: pageSpreads.get(index)
        } : { linear: "no" });
        try {
          const ncx = await this.mobi.getNCX();
          const map = ({ label, pos, children }) => {
            const [fid, off] = pos;
            const href = makePosURI(fid, off);
            const arr = this.#fragmentOffsets.get(fid);
            if (arr) arr.push(off);
            else this.#fragmentOffsets.set(fid, [off]);
            return { label: unescapeHTML(label), href, subitems: children?.map(map) };
          };
          this.toc = ncx?.map(map);
          this.landmarks = await this.getGuide();
        } catch (e3) {
          console.warn(e3);
        }
        const { exth } = this.mobi.headers;
        this.dir = exth.pageProgressionDirection;
        this.rendition = {
          layout: exth.fixedLayout === "true" ? "pre-paginated" : "reflowable",
          viewport: Object.fromEntries(exth.originalResolution?.split("x")?.slice(0, 2)?.map((x3, i3) => [i3 ? "height" : "width", x3]) ?? [])
        };
        this.metadata = this.mobi.getMetadata();
        this.getCover = this.mobi.getCover.bind(this.mobi);
        return this;
      }
      // is this really the only way of getting to RESC, PAGE, etc.?
      async getResourcesByMagic(keys) {
        const results = {};
        const start = this.mobi.headers.kf8.resourceStart;
        const end = this.mobi.pdb.numRecords;
        for (let i3 = start; i3 < end; i3++) {
          try {
            const magic = await this.mobi.loadMagic(i3);
            const match = keys.find((key) => key === magic);
            if (match) results[match] = i3;
          } catch {
          }
        }
        return results;
      }
      async getGuide() {
        const index = this.mobi.headers.kf8.guide;
        if (index < 4294967295) {
          const loadRecord = this.mobi.loadRecord.bind(this.mobi);
          const { table, cncx } = await getIndexData(index, loadRecord);
          return table.map(({ name, tagMap }) => ({
            label: cncx[tagMap[1][0]] ?? "",
            type: name?.split(/\s/),
            href: makePosURI(tagMap[6]?.[0] ?? tagMap[3]?.[0])
          }));
        }
      }
      async loadResourceBlob(str) {
        const { resourceType, id, type } = parseResourceURI(str);
        const raw = resourceType === "flow" ? await this.loadFlow(id) : await this.mobi.loadResource(id - 1);
        const result = [MIME3.XHTML, MIME3.HTML, MIME3.CSS, MIME3.SVG].includes(type) ? await this.replaceResources(this.mobi.decode(raw)) : raw;
        const doc = type === MIME3.SVG ? this.parser.parseFromString(result, type) : null;
        return [
          new Blob([result], { type }),
          // SVG wrappers need to be inlined
          // as browsers don't allow external resources when loading SVG as an image
          doc?.getElementsByTagNameNS("http://www.w3.org/2000/svg", "image")?.length ? doc.documentElement : null
        ];
      }
      async loadResource(str) {
        if (this.#cache.has(str)) return this.#cache.get(str);
        const [blob, inline] = await this.loadResourceBlob(str);
        const url = inline ? str : URL.createObjectURL(blob);
        if (inline) this.#inlineMap.set(url, inline);
        this.#cache.set(str, url);
        return url;
      }
      replaceResources(str) {
        const regex = new RegExp(kindleResourceRegex, "g");
        return replaceSeries2(str, regex, this.loadResource.bind(this));
      }
      // NOTE: there doesn't seem to be a way to access text randomly?
      // how to know the decompressed size of the records without decompressing?
      // 4096 is just the maximum size
      async loadRaw(start, end) {
        const distanceHead = end - this.#rawHead.length;
        const distanceEnd = this.#fullRawLength == null ? Infinity : this.#fullRawLength - this.#rawTail.length - start;
        if (distanceHead < 0 || distanceHead < distanceEnd) {
          while (this.#rawHead.length < end) {
            const index = ++this.#lastLoadedHead;
            const data = await this.mobi.loadText(index);
            this.#rawHead = concatTypedArray(this.#rawHead, data);
          }
          return this.#rawHead.slice(start, end);
        }
        while (this.#fullRawLength - this.#rawTail.length > start) {
          const index = this.mobi.headers.palmdoc.numTextRecords - 1 - ++this.#lastLoadedTail;
          const data = await this.mobi.loadText(index);
          this.#rawTail = concatTypedArray(data, this.#rawTail);
        }
        const rawTailStart = this.#fullRawLength - this.#rawTail.length;
        return this.#rawTail.slice(start - rawTailStart, end - rawTailStart);
      }
      loadFlow(index) {
        if (index < 4294967295)
          return this.loadRaw(...this.#tables.fdstTable[index]);
      }
      async loadText(section) {
        const { skel, frags, length } = section;
        const raw = await this.loadRaw(skel.offset, skel.offset + length);
        let skeleton = raw.slice(0, skel.length);
        for (const frag of frags) {
          const insertOffset = frag.insertOffset - skel.offset;
          const offset = skel.length + frag.offset;
          const fragRaw = raw.slice(offset, offset + frag.length);
          skeleton = concatTypedArray3(
            skeleton.slice(0, insertOffset),
            fragRaw,
            skeleton.slice(insertOffset)
          );
          const offsets = this.#fragmentOffsets.get(frag.index);
          if (offsets) for (const offset2 of offsets) {
            const str = this.mobi.decode(fragRaw).slice(offset2);
            const selector = getFragmentSelector(str);
            this.#setFragmentSelector(frag.index, offset2, selector);
          }
        }
        return this.mobi.decode(skeleton);
      }
      async createDocument(section) {
        const str = await this.loadText(section);
        return this.parser.parseFromString(str, this.#type);
      }
      async loadSection(section) {
        if (this.#cache.has(section)) return this.#cache.get(section);
        const str = await this.loadText(section);
        const replaced = await this.replaceResources(str);
        let doc = this.parser.parseFromString(replaced, this.#type);
        if (doc.querySelector("parsererror") || !doc.documentElement?.namespaceURI) {
          this.#type = MIME3.HTML;
          doc = this.parser.parseFromString(replaced, this.#type);
        }
        for (const [url2, node] of this.#inlineMap) {
          for (const el of doc.querySelectorAll(`img[src="${url2}"]`))
            el.replaceWith(node);
        }
        const url = URL.createObjectURL(
          new Blob([this.serializer.serializeToString(doc)], { type: this.#type })
        );
        this.#cache.set(section, url);
        return url;
      }
      getIndexByFID(fid) {
        return this.#sections.findIndex((section) => section.frags.some((frag) => frag.index === fid));
      }
      #setFragmentSelector(id, offset, selector) {
        const map = this.#fragmentSelectors.get(id);
        if (map) map.set(offset, selector);
        else {
          const map2 = /* @__PURE__ */ new Map();
          this.#fragmentSelectors.set(id, map2);
          map2.set(offset, selector);
        }
      }
      async resolveHref(href) {
        const { fid, off } = parsePosURI(href);
        const index = this.getIndexByFID(fid);
        if (index < 0) return;
        const saved = this.#fragmentSelectors.get(fid)?.get(off);
        if (saved) return { index, anchor: (doc) => doc.querySelector(saved) };
        const { skel, frags } = this.#sections[index];
        const frag = frags.find((frag2) => frag2.index === fid);
        const offset = skel.offset + skel.length + frag.offset;
        const fragRaw = await this.loadRaw(offset, offset + frag.length);
        const str = this.mobi.decode(fragRaw).slice(off);
        const selector = getFragmentSelector(str);
        this.#setFragmentSelector(fid, off, selector);
        const anchor = (doc) => doc.querySelector(selector);
        return { index, anchor };
      }
      splitTOCHref(href) {
        const pos = parsePosURI(href);
        const index = this.getIndexByFID(pos.fid);
        return [index, pos];
      }
      getTOCFragment(doc, { fid, off }) {
        const selector = this.#fragmentSelectors.get(fid)?.get(off);
        return doc.querySelector(selector);
      }
      isExternal(uri) {
        return /^(?!blob|kindle)\w+:/i.test(uri);
      }
      destroy() {
        for (const url of this.#cache.values()) URL.revokeObjectURL(url);
      }
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/vendor/fflate.js
var fflate_exports = {};
__export(fflate_exports, {
  unzlibSync: () => A2
});
function A2(r3, a3) {
  return E2(r3.subarray((e3 = r3, n3 = a3 && a3.dictionary, (8 != (15 & e3[0]) || e3[0] >> 4 > 7 || (e3[0] << 8 | e3[1]) % 31) && T2(6, "invalid zlib data"), (e3[1] >> 5 & 1) == +!n3 && T2(6, "invalid zlib data: " + (32 & e3[1] ? "need" : "unexpected") + " dictionary"), 2 + (e3[1] >> 3 & 4)), -4), { i: 2 }, a3 && a3.out, a3 && a3.dictionary);
  var e3, n3;
}
var r2, a2, e2, n2, i2, t2, f2, o2, v2, l2, w2, u2, c2, d2, b2, s2, h2, y2, g2, p2, k2, m2, x2, T2, E2, z2, U2;
var init_fflate = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/vendor/fflate.js"() {
    r2 = Uint8Array;
    a2 = Uint16Array;
    e2 = Int32Array;
    n2 = new r2([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
    i2 = new r2([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
    t2 = new r2([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
    f2 = function(r3, n3) {
      for (var i3 = new a2(31), t3 = 0; t3 < 31; ++t3) i3[t3] = n3 += 1 << r3[t3 - 1];
      var f3 = new e2(i3[30]);
      for (t3 = 1; t3 < 30; ++t3) for (var o3 = i3[t3]; o3 < i3[t3 + 1]; ++o3) f3[o3] = o3 - i3[t3] << 5 | t3;
      return { b: i3, r: f3 };
    };
    o2 = f2(n2, 2);
    v2 = o2.b;
    l2 = o2.r;
    v2[28] = 258, l2[258] = 28;
    for (u2 = f2(i2, 0).b, c2 = new a2(32768), d2 = 0; d2 < 32768; ++d2) {
      w2 = (43690 & d2) >> 1 | (21845 & d2) << 1;
      w2 = (61680 & (w2 = (52428 & w2) >> 2 | (13107 & w2) << 2)) >> 4 | (3855 & w2) << 4, c2[d2] = ((65280 & w2) >> 8 | (255 & w2) << 8) >> 1;
    }
    b2 = function(r3, e3, n3) {
      for (var i3 = r3.length, t3 = 0, f3 = new a2(e3); t3 < i3; ++t3) r3[t3] && ++f3[r3[t3] - 1];
      var o3, v3 = new a2(e3);
      for (t3 = 1; t3 < e3; ++t3) v3[t3] = v3[t3 - 1] + f3[t3 - 1] << 1;
      if (n3) {
        o3 = new a2(1 << e3);
        var l3 = 15 - e3;
        for (t3 = 0; t3 < i3; ++t3) if (r3[t3]) for (var u2 = t3 << 4 | r3[t3], d2 = e3 - r3[t3], w2 = v3[r3[t3] - 1]++ << d2, b3 = w2 | (1 << d2) - 1; w2 <= b3; ++w2) o3[c2[w2] >> l3] = u2;
      } else for (o3 = new a2(i3), t3 = 0; t3 < i3; ++t3) r3[t3] && (o3[t3] = c2[v3[r3[t3] - 1]++] >> 15 - r3[t3]);
      return o3;
    };
    s2 = new r2(288);
    for (d2 = 0; d2 < 144; ++d2) s2[d2] = 8;
    for (d2 = 144; d2 < 256; ++d2) s2[d2] = 9;
    for (d2 = 256; d2 < 280; ++d2) s2[d2] = 7;
    for (d2 = 280; d2 < 288; ++d2) s2[d2] = 8;
    h2 = new r2(32);
    for (d2 = 0; d2 < 32; ++d2) h2[d2] = 5;
    y2 = b2(s2, 9, 1);
    g2 = b2(h2, 5, 1);
    p2 = function(r3) {
      for (var a3 = r3[0], e3 = 1; e3 < r3.length; ++e3) r3[e3] > a3 && (a3 = r3[e3]);
      return a3;
    };
    k2 = function(r3, a3, e3) {
      var n3 = a3 / 8 | 0;
      return (r3[n3] | r3[n3 + 1] << 8) >> (7 & a3) & e3;
    };
    m2 = function(r3, a3) {
      var e3 = a3 / 8 | 0;
      return (r3[e3] | r3[e3 + 1] << 8 | r3[e3 + 2] << 16) >> (7 & a3);
    };
    x2 = ["unexpected EOF", "invalid block type", "invalid length/literal", "invalid distance", "stream finished", "no stream handler", , "no callback", "invalid UTF-8 data", "extra field too long", "date not in range 1980-2099", "filename too long", "stream finishing", "invalid zip data"];
    T2 = function(r3, a3, e3) {
      var n3 = new Error(a3 || x2[r3]);
      if (n3.code = r3, Error.captureStackTrace && Error.captureStackTrace(n3, T2), !e3) throw n3;
      return n3;
    };
    E2 = function(a3, e3, f3, o3) {
      var l3 = a3.length, c2 = o3 ? o3.length : 0;
      if (!l3 || e3.f && !e3.l) return f3 || new r2(0);
      var d2 = !f3, w2 = d2 || 2 != e3.i, s3 = e3.i;
      d2 && (f3 = new r2(3 * l3));
      var h3 = function(a4) {
        var e4 = f3.length;
        if (a4 > e4) {
          var n3 = new r2(Math.max(2 * e4, a4));
          n3.set(f3), f3 = n3;
        }
      }, x3 = e3.f || 0, E3 = e3.p || 0, z3 = e3.b || 0, A3 = e3.l, U3 = e3.d, D2 = e3.m, F2 = e3.n, M2 = 8 * l3;
      do {
        if (!A3) {
          x3 = k2(a3, E3, 1);
          var S2 = k2(a3, E3 + 1, 3);
          if (E3 += 3, !S2) {
            var I2 = a3[(N2 = 4 + ((E3 + 7) / 8 | 0)) - 4] | a3[N2 - 3] << 8, O2 = N2 + I2;
            if (O2 > l3) {
              s3 && T2(0);
              break;
            }
            w2 && h3(z3 + I2), f3.set(a3.subarray(N2, O2), z3), e3.b = z3 += I2, e3.p = E3 = 8 * O2, e3.f = x3;
            continue;
          }
          if (1 == S2) A3 = y2, U3 = g2, D2 = 9, F2 = 5;
          else if (2 == S2) {
            var j2 = k2(a3, E3, 31) + 257, q2 = k2(a3, E3 + 10, 15) + 4, B2 = j2 + k2(a3, E3 + 5, 31) + 1;
            E3 += 14;
            for (var C2 = new r2(B2), G2 = new r2(19), H2 = 0; H2 < q2; ++H2) G2[t2[H2]] = k2(a3, E3 + 3 * H2, 7);
            E3 += 3 * q2;
            var J2 = p2(G2), K2 = (1 << J2) - 1, L2 = b2(G2, J2, 1);
            for (H2 = 0; H2 < B2; ) {
              var N2, P2 = L2[k2(a3, E3, K2)];
              if (E3 += 15 & P2, (N2 = P2 >> 4) < 16) C2[H2++] = N2;
              else {
                var Q2 = 0, R2 = 0;
                for (16 == N2 ? (R2 = 3 + k2(a3, E3, 3), E3 += 2, Q2 = C2[H2 - 1]) : 17 == N2 ? (R2 = 3 + k2(a3, E3, 7), E3 += 3) : 18 == N2 && (R2 = 11 + k2(a3, E3, 127), E3 += 7); R2--; ) C2[H2++] = Q2;
              }
            }
            var V2 = C2.subarray(0, j2), W2 = C2.subarray(j2);
            D2 = p2(V2), F2 = p2(W2), A3 = b2(V2, D2, 1), U3 = b2(W2, F2, 1);
          } else T2(1);
          if (E3 > M2) {
            s3 && T2(0);
            break;
          }
        }
        w2 && h3(z3 + 131072);
        for (var X2 = (1 << D2) - 1, Y2 = (1 << F2) - 1, Z2 = E3; ; Z2 = E3) {
          var $2 = (Q2 = A3[m2(a3, E3) & X2]) >> 4;
          if ((E3 += 15 & Q2) > M2) {
            s3 && T2(0);
            break;
          }
          if (Q2 || T2(2), $2 < 256) f3[z3++] = $2;
          else {
            if (256 == $2) {
              Z2 = E3, A3 = null;
              break;
            }
            var _2 = $2 - 254;
            if ($2 > 264) {
              var rr = n2[H2 = $2 - 257];
              _2 = k2(a3, E3, (1 << rr) - 1) + v2[H2], E3 += rr;
            }
            var ar = U3[m2(a3, E3) & Y2], er = ar >> 4;
            ar || T2(3), E3 += 15 & ar;
            W2 = u2[er];
            if (er > 3) {
              rr = i2[er];
              W2 += m2(a3, E3) & (1 << rr) - 1, E3 += rr;
            }
            if (E3 > M2) {
              s3 && T2(0);
              break;
            }
            w2 && h3(z3 + 131072);
            var nr = z3 + _2;
            if (z3 < W2) {
              var ir = c2 - W2, tr = Math.min(W2, nr);
              for (ir + z3 < 0 && T2(3); z3 < tr; ++z3) f3[z3] = o3[ir + z3];
            }
            for (; z3 < nr; ++z3) f3[z3] = f3[z3 - W2];
          }
        }
        e3.l = A3, e3.p = Z2, e3.b = z3, e3.f = x3, A3 && (x3 = 1, e3.m = D2, e3.d = U3, e3.n = F2);
      } while (!x3);
      return z3 != f3.length && d2 ? (function(a4, e4, n3) {
        return (null == n3 || n3 > a4.length) && (n3 = a4.length), new r2(a4.subarray(e4, n3));
      })(f3, 0, z3) : f3.subarray(0, z3);
    };
    z2 = new r2(0);
    U2 = "undefined" != typeof TextDecoder && new TextDecoder();
    try {
      U2.decode(z2, { stream: true });
    } catch (r3) {
    }
  }
});

// node_modules/.pnpm/construct-style-sheets-polyfill@3.1.0/node_modules/construct-style-sheets-polyfill/dist/adoptedStyleSheets.js
var init_adoptedStyleSheets = __esm({
  "node_modules/.pnpm/construct-style-sheets-polyfill@3.1.0/node_modules/construct-style-sheets-polyfill/dist/adoptedStyleSheets.js"() {
    (function() {
      "use strict";
      if (typeof document === "undefined" || "adoptedStyleSheets" in document) {
        return;
      }
      var hasShadyCss = "ShadyCSS" in window && !ShadyCSS.nativeShadow;
      var bootstrapper = document.implementation.createHTMLDocument("");
      var closedShadowRootRegistry = /* @__PURE__ */ new WeakMap();
      var _DOMException = typeof DOMException === "object" ? Error : DOMException;
      var defineProperty2 = Object.defineProperty;
      var forEach = Array.prototype.forEach;
      var importPattern = /@import.+?;?$/gm;
      function rejectImports(contents) {
        var _contents = contents.replace(importPattern, "");
        if (_contents !== contents) {
          console.warn("@import rules are not allowed here. See https://github.com/WICG/construct-stylesheets/issues/119#issuecomment-588352418");
        }
        return _contents.trim();
      }
      function isElementConnected(element) {
        return "isConnected" in element ? element.isConnected : document.contains(element);
      }
      function unique(arr) {
        return arr.filter(function(value, index) {
          return arr.indexOf(value) === index;
        });
      }
      function diff(arr1, arr2) {
        return arr1.filter(function(value) {
          return arr2.indexOf(value) === -1;
        });
      }
      function removeNode(node) {
        node.parentNode.removeChild(node);
      }
      function getShadowRoot(element) {
        return element.shadowRoot || closedShadowRootRegistry.get(element);
      }
      var cssStyleSheetMethods = [
        "addRule",
        "deleteRule",
        "insertRule",
        "removeRule"
      ];
      var NonConstructedStyleSheet = CSSStyleSheet;
      var nonConstructedProto = NonConstructedStyleSheet.prototype;
      nonConstructedProto.replace = function() {
        return Promise.reject(new _DOMException("Can't call replace on non-constructed CSSStyleSheets."));
      };
      nonConstructedProto.replaceSync = function() {
        throw new _DOMException("Failed to execute 'replaceSync' on 'CSSStyleSheet': Can't call replaceSync on non-constructed CSSStyleSheets.");
      };
      function isCSSStyleSheetInstance(instance) {
        return typeof instance === "object" ? proto$1.isPrototypeOf(instance) || nonConstructedProto.isPrototypeOf(instance) : false;
      }
      function isNonConstructedStyleSheetInstance(instance) {
        return typeof instance === "object" ? nonConstructedProto.isPrototypeOf(instance) : false;
      }
      var $basicStyleElement = /* @__PURE__ */ new WeakMap();
      var $locations = /* @__PURE__ */ new WeakMap();
      var $adoptersByLocation = /* @__PURE__ */ new WeakMap();
      var $appliedMethods = /* @__PURE__ */ new WeakMap();
      function addAdopterLocation(sheet, location) {
        var adopter = document.createElement("style");
        $adoptersByLocation.get(sheet).set(location, adopter);
        $locations.get(sheet).push(location);
        return adopter;
      }
      function getAdopterByLocation(sheet, location) {
        return $adoptersByLocation.get(sheet).get(location);
      }
      function removeAdopterLocation(sheet, location) {
        $adoptersByLocation.get(sheet).delete(location);
        $locations.set(sheet, $locations.get(sheet).filter(function(_location) {
          return _location !== location;
        }));
      }
      function restyleAdopter(sheet, adopter) {
        requestAnimationFrame(function() {
          adopter.textContent = $basicStyleElement.get(sheet).textContent;
          $appliedMethods.get(sheet).forEach(function(command) {
            return adopter.sheet[command.method].apply(adopter.sheet, command.args);
          });
        });
      }
      function checkInvocationCorrectness(self) {
        if (!$basicStyleElement.has(self)) {
          throw new TypeError("Illegal invocation");
        }
      }
      function ConstructedStyleSheet() {
        var self = this;
        var style2 = document.createElement("style");
        bootstrapper.body.appendChild(style2);
        $basicStyleElement.set(self, style2);
        $locations.set(self, []);
        $adoptersByLocation.set(self, /* @__PURE__ */ new WeakMap());
        $appliedMethods.set(self, []);
      }
      var proto$1 = ConstructedStyleSheet.prototype;
      proto$1.replace = function replace(contents) {
        try {
          this.replaceSync(contents);
          return Promise.resolve(this);
        } catch (e3) {
          return Promise.reject(e3);
        }
      };
      proto$1.replaceSync = function replaceSync(contents) {
        checkInvocationCorrectness(this);
        if (typeof contents === "string") {
          var self_1 = this;
          $basicStyleElement.get(self_1).textContent = rejectImports(contents);
          $appliedMethods.set(self_1, []);
          $locations.get(self_1).forEach(function(location) {
            if (location.isConnected()) {
              restyleAdopter(self_1, getAdopterByLocation(self_1, location));
            }
          });
        }
      };
      defineProperty2(proto$1, "cssRules", {
        configurable: true,
        enumerable: true,
        get: function cssRules() {
          checkInvocationCorrectness(this);
          return $basicStyleElement.get(this).sheet.cssRules;
        }
      });
      defineProperty2(proto$1, "media", {
        configurable: true,
        enumerable: true,
        get: function media() {
          checkInvocationCorrectness(this);
          return $basicStyleElement.get(this).sheet.media;
        }
      });
      cssStyleSheetMethods.forEach(function(method) {
        proto$1[method] = function() {
          var self = this;
          checkInvocationCorrectness(self);
          var args = arguments;
          $appliedMethods.get(self).push({ method, args });
          $locations.get(self).forEach(function(location) {
            if (location.isConnected()) {
              var sheet = getAdopterByLocation(self, location).sheet;
              sheet[method].apply(sheet, args);
            }
          });
          var basicSheet = $basicStyleElement.get(self).sheet;
          return basicSheet[method].apply(basicSheet, args);
        };
      });
      defineProperty2(ConstructedStyleSheet, Symbol.hasInstance, {
        configurable: true,
        value: isCSSStyleSheetInstance
      });
      var defaultObserverOptions = {
        childList: true,
        subtree: true
      };
      var locations = /* @__PURE__ */ new WeakMap();
      function getAssociatedLocation(element) {
        var location = locations.get(element);
        if (!location) {
          location = new Location(element);
          locations.set(element, location);
        }
        return location;
      }
      function attachAdoptedStyleSheetProperty(constructor) {
        defineProperty2(constructor.prototype, "adoptedStyleSheets", {
          configurable: true,
          enumerable: true,
          get: function() {
            return getAssociatedLocation(this).sheets;
          },
          set: function(sheets) {
            getAssociatedLocation(this).update(sheets);
          }
        });
      }
      function traverseWebComponents(node, callback) {
        var iter = document.createNodeIterator(
          node,
          NodeFilter.SHOW_ELEMENT,
          function(foundNode) {
            return getShadowRoot(foundNode) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
          null,
          false
        );
        for (var next = void 0; next = iter.nextNode(); ) {
          callback(getShadowRoot(next));
        }
      }
      var $element = /* @__PURE__ */ new WeakMap();
      var $uniqueSheets = /* @__PURE__ */ new WeakMap();
      var $observer = /* @__PURE__ */ new WeakMap();
      function isExistingAdopter(self, element) {
        return element instanceof HTMLStyleElement && $uniqueSheets.get(self).some(function(sheet) {
          return getAdopterByLocation(sheet, self);
        });
      }
      function getAdopterContainer(self) {
        var element = $element.get(self);
        return element instanceof Document ? element.body : element;
      }
      function adopt(self) {
        var styleList = document.createDocumentFragment();
        var sheets = $uniqueSheets.get(self);
        var observer = $observer.get(self);
        var container = getAdopterContainer(self);
        observer.disconnect();
        sheets.forEach(function(sheet) {
          styleList.appendChild(getAdopterByLocation(sheet, self) || addAdopterLocation(sheet, self));
        });
        container.insertBefore(styleList, null);
        observer.observe(container, defaultObserverOptions);
        sheets.forEach(function(sheet) {
          restyleAdopter(sheet, getAdopterByLocation(sheet, self));
        });
      }
      function Location(element) {
        var self = this;
        self.sheets = [];
        $element.set(self, element);
        $uniqueSheets.set(self, []);
        $observer.set(self, new MutationObserver(function(mutations, observer) {
          if (!document) {
            observer.disconnect();
            return;
          }
          mutations.forEach(function(mutation) {
            if (!hasShadyCss) {
              forEach.call(mutation.addedNodes, function(node) {
                if (!(node instanceof Element)) {
                  return;
                }
                traverseWebComponents(node, function(root) {
                  getAssociatedLocation(root).connect();
                });
              });
            }
            forEach.call(mutation.removedNodes, function(node) {
              if (!(node instanceof Element)) {
                return;
              }
              if (isExistingAdopter(self, node)) {
                adopt(self);
              }
              if (!hasShadyCss) {
                traverseWebComponents(node, function(root) {
                  getAssociatedLocation(root).disconnect();
                });
              }
            });
          });
        }));
      }
      Location.prototype = {
        isConnected: function() {
          var element = $element.get(this);
          return element instanceof Document ? element.readyState !== "loading" : isElementConnected(element.host);
        },
        connect: function() {
          var container = getAdopterContainer(this);
          $observer.get(this).observe(container, defaultObserverOptions);
          if ($uniqueSheets.get(this).length > 0) {
            adopt(this);
          }
          traverseWebComponents(container, function(root) {
            getAssociatedLocation(root).connect();
          });
        },
        disconnect: function() {
          $observer.get(this).disconnect();
        },
        update: function(sheets) {
          var self = this;
          var locationType = $element.get(self) === document ? "Document" : "ShadowRoot";
          if (!Array.isArray(sheets)) {
            throw new TypeError("Failed to set the 'adoptedStyleSheets' property on " + locationType + ": Iterator getter is not callable.");
          }
          if (!sheets.every(isCSSStyleSheetInstance)) {
            throw new TypeError("Failed to set the 'adoptedStyleSheets' property on " + locationType + ": Failed to convert value to 'CSSStyleSheet'");
          }
          if (sheets.some(isNonConstructedStyleSheetInstance)) {
            throw new TypeError("Failed to set the 'adoptedStyleSheets' property on " + locationType + ": Can't adopt non-constructed stylesheets");
          }
          self.sheets = sheets;
          var oldUniqueSheets = $uniqueSheets.get(self);
          var uniqueSheets = unique(sheets);
          var removedSheets = diff(oldUniqueSheets, uniqueSheets);
          removedSheets.forEach(function(sheet) {
            removeNode(getAdopterByLocation(sheet, self));
            removeAdopterLocation(sheet, self);
          });
          $uniqueSheets.set(self, uniqueSheets);
          if (self.isConnected() && uniqueSheets.length > 0) {
            adopt(self);
          }
        }
      };
      window.CSSStyleSheet = ConstructedStyleSheet;
      attachAdoptedStyleSheetProperty(Document);
      if ("ShadowRoot" in window) {
        attachAdoptedStyleSheetProperty(ShadowRoot);
        var proto = Element.prototype;
        var attach_1 = proto.attachShadow;
        proto.attachShadow = function attachShadow(init) {
          var root = attach_1.call(this, init);
          if (init.mode === "closed") {
            closedShadowRootRegistry.set(this, root);
          }
          return root;
        };
      }
      var documentLocation = getAssociatedLocation(document);
      if (documentLocation.isConnected()) {
        documentLocation.connect();
      } else {
        document.addEventListener("DOMContentLoaded", documentLocation.connect.bind(documentLocation));
      }
    })();
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/fixed-layout.js
var fixed_layout_exports = {};
__export(fixed_layout_exports, {
  FixedLayout: () => FixedLayout
});
var parseViewport, getViewport, FixedLayout;
var init_fixed_layout = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/fixed-layout.js"() {
    init_adoptedStyleSheets();
    parseViewport = (str) => str?.split(/[,;\s]/)?.filter((x3) => x3)?.map((x3) => x3.split("=").map((x4) => x4.trim()));
    getViewport = (doc, viewport) => {
      if (doc.documentElement.localName === "svg") {
        const [, , width, height] = doc.documentElement.getAttribute("viewBox")?.split(/\s/) ?? [];
        return { width, height };
      }
      const meta = parseViewport(doc.querySelector('meta[name="viewport"]')?.getAttribute("content"));
      if (meta) return Object.fromEntries(meta);
      if (typeof viewport === "string") return parseViewport(viewport);
      if (viewport) return viewport;
      const img = doc.querySelector("img");
      if (img) return { width: img.naturalWidth, height: img.naturalHeight };
      console.warn(new Error("Missing viewport properties"));
      return { width: 1e3, height: 2e3 };
    };
    FixedLayout = class extends HTMLElement {
      static observedAttributes = ["zoom"];
      #root = this.attachShadow({ mode: "closed" });
      #observer = new ResizeObserver(() => this.#render());
      #spreads;
      #index = -1;
      defaultViewport;
      spread;
      #portrait = false;
      #left;
      #right;
      #center;
      #side;
      #zoom;
      constructor() {
        super();
        const sheet = new CSSStyleSheet();
        this.#root.adoptedStyleSheets = [sheet];
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: auto;
        }`);
        this.#observer.observe(this);
      }
      attributeChangedCallback(name, _2, value) {
        switch (name) {
          case "zoom":
            this.#zoom = value !== "fit-width" && value !== "fit-page" ? parseFloat(value) : value;
            this.#render();
            break;
        }
      }
      async #createFrame({ index, src: srcOption }) {
        const srcOptionIsString = typeof srcOption === "string";
        const src = srcOptionIsString ? srcOption : srcOption?.src;
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom;
        const element = document.createElement("div");
        const iframe = document.createElement("iframe");
        element.append(iframe);
        Object.assign(iframe.style, {
          border: "0",
          display: "none",
          overflow: "hidden"
        });
        iframe.setAttribute("sandbox", "allow-same-origin");
        iframe.setAttribute("scrolling", "no");
        iframe.setAttribute("part", "filter");
        this.#root.append(element);
        if (!src) return { blank: true, element, iframe };
        return new Promise((resolve) => {
          iframe.addEventListener("load", () => {
            const doc = iframe.contentDocument;
            this.dispatchEvent(new CustomEvent("load", { detail: { doc, index } }));
            const { width, height } = getViewport(doc, this.defaultViewport);
            resolve({
              element,
              iframe,
              width: parseFloat(width),
              height: parseFloat(height),
              onZoom
            });
          }, { once: true });
          iframe.src = src;
        });
      }
      #render(side = this.#side) {
        if (!side) return;
        const left = this.#left ?? {};
        const right = this.#center ?? this.#right;
        const target = side === "left" ? left : right;
        const { width, height } = this.getBoundingClientRect();
        const portrait = this.spread !== "both" && this.spread !== "portrait" && height > width;
        this.#portrait = portrait;
        const blankWidth = left.width ?? right.width;
        const blankHeight = left.height ?? right.height;
        const scale = typeof this.#zoom === "number" && !isNaN(this.#zoom) ? this.#zoom : this.#zoom === "fit-width" ? portrait || this.#center ? width / (target.width ?? blankWidth) : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)) : portrait || this.#center ? Math.min(
          width / (target.width ?? blankWidth),
          height / (target.height ?? blankHeight)
        ) : Math.min(
          width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
          height / Math.max(
            left.height ?? blankHeight,
            right.height ?? blankHeight
          )
        );
        const transform = (frame) => {
          let { element, iframe, width: width2, height: height2, blank, onZoom } = frame;
          if (onZoom) onZoom({ doc: frame.iframe.contentDocument, scale });
          const iframeScale = onZoom ? scale : 1;
          Object.assign(iframe.style, {
            width: `${width2 * iframeScale}px`,
            height: `${height2 * iframeScale}px`,
            transform: onZoom ? "none" : `scale(${scale})`,
            transformOrigin: "top left",
            display: blank ? "none" : "block"
          });
          Object.assign(element.style, {
            width: `${(width2 ?? blankWidth) * scale}px`,
            height: `${(height2 ?? blankHeight) * scale}px`,
            overflow: "hidden",
            display: "block",
            flexShrink: "0",
            marginBlock: "auto"
          });
          if (portrait && frame !== target) {
            element.style.display = "none";
          }
        };
        if (this.#center) {
          transform(this.#center);
        } else {
          transform(left);
          transform(right);
        }
      }
      async #showSpread({ left, right, center, side }) {
        this.#root.replaceChildren();
        this.#left = null;
        this.#right = null;
        this.#center = null;
        if (center) {
          this.#center = await this.#createFrame(center);
          this.#side = "center";
          this.#render();
        } else {
          this.#left = await this.#createFrame(left);
          this.#right = await this.#createFrame(right);
          this.#side = this.#left.blank ? "right" : this.#right.blank ? "left" : side;
          this.#render();
        }
      }
      #goLeft() {
        if (this.#center || this.#left?.blank) return;
        if (this.#portrait && this.#left?.element?.style?.display === "none") {
          this.#right.element.style.display = "none";
          this.#left.element.style.display = "block";
          this.#side = "left";
          return true;
        }
      }
      #goRight() {
        if (this.#center || this.#right?.blank) return;
        if (this.#portrait && this.#right?.element?.style?.display === "none") {
          this.#left.element.style.display = "none";
          this.#right.element.style.display = "block";
          this.#side = "right";
          return true;
        }
      }
      open(book) {
        this.book = book;
        const { rendition } = book;
        this.spread = rendition?.spread;
        this.defaultViewport = rendition?.viewport;
        const rtl = book.dir === "rtl";
        const ltr = !rtl;
        this.rtl = rtl;
        if (rendition?.spread === "none")
          this.#spreads = book.sections.map((section) => ({ center: section }));
        else this.#spreads = book.sections.reduce((arr, section, i3) => {
          const last = arr[arr.length - 1];
          const { pageSpread } = section;
          const newSpread = () => {
            const spread = {};
            arr.push(spread);
            return spread;
          };
          if (pageSpread === "center") {
            const spread = last.left || last.right ? newSpread() : last;
            spread.center = section;
          } else if (pageSpread === "left") {
            const spread = last.center || last.left || ltr && i3 ? newSpread() : last;
            spread.left = section;
          } else if (pageSpread === "right") {
            const spread = last.center || last.right || rtl && i3 ? newSpread() : last;
            spread.right = section;
          } else if (ltr) {
            if (last.center || last.right) newSpread().left = section;
            else if (last.left || !i3) last.right = section;
            else last.left = section;
          } else {
            if (last.center || last.left) newSpread().right = section;
            else if (last.right || !i3) last.left = section;
            else last.right = section;
          }
          return arr;
        }, [{}]);
      }
      get index() {
        const spread = this.#spreads[this.#index];
        const section = spread?.center ?? (this.side === "left" ? spread.left ?? spread.right : spread.right ?? spread.left);
        return this.book.sections.indexOf(section);
      }
      #reportLocation(reason) {
        this.dispatchEvent(new CustomEvent("relocate", { detail: { reason, range: null, index: this.index, fraction: 0, size: 1 } }));
      }
      getSpreadOf(section) {
        const spreads = this.#spreads;
        for (let index = 0; index < spreads.length; index++) {
          const { left, right, center } = spreads[index];
          if (left === section) return { index, side: "left" };
          if (right === section) return { index, side: "right" };
          if (center === section) return { index, side: "center" };
        }
      }
      async goToSpread(index, side, reason) {
        if (index < 0 || index > this.#spreads.length - 1) return;
        if (index === this.#index) {
          this.#render(side);
          return;
        }
        this.#index = index;
        const spread = this.#spreads[index];
        if (spread.center) {
          const index2 = this.book.sections.indexOf(spread.center);
          const src = await spread.center?.load?.();
          await this.#showSpread({ center: { index: index2, src } });
        } else {
          const indexL = this.book.sections.indexOf(spread.left);
          const indexR = this.book.sections.indexOf(spread.right);
          const srcL = await spread.left?.load?.();
          const srcR = await spread.right?.load?.();
          const left = { index: indexL, src: srcL };
          const right = { index: indexR, src: srcR };
          await this.#showSpread({ left, right, side });
        }
        this.#reportLocation(reason);
      }
      async select(target) {
        await this.goTo(target);
      }
      async goTo(target) {
        const { book } = this;
        const resolved = await target;
        const section = book.sections[resolved.index];
        if (!section) return;
        const { index, side } = this.getSpreadOf(section);
        await this.goToSpread(index, side);
      }
      async next() {
        const s3 = this.rtl ? this.#goLeft() : this.#goRight();
        if (s3) this.#reportLocation("page");
        else return this.goToSpread(this.#index + 1, this.rtl ? "right" : "left", "page");
      }
      async prev() {
        const s3 = this.rtl ? this.#goRight() : this.#goLeft();
        if (s3) this.#reportLocation("page");
        else return this.goToSpread(this.#index - 1, this.rtl ? "left" : "right", "page");
      }
      getContents() {
        return Array.from(this.#root.querySelectorAll("iframe"), (frame) => ({
          doc: frame.contentDocument
          // TODO: index, overlayer
        }));
      }
      destroy() {
        this.#observer.unobserve(this);
      }
    };
    if (!customElements.get("foliate-fxl"))
      customElements.define("foliate-fxl", FixedLayout);
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/paginator.js
var paginator_exports = {};
__export(paginator_exports, {
  Paginator: () => Paginator
});
var wait, debounce, lerp, easeOutQuad, animate, uncollapse, makeRange, bisectNode, SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION, FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP, filter2, getBoundingClientRect, getVisibleRange, selectionIsBackward, setSelectionTo, getDirection, getBackground, makeMarginals, setStylesImportant, View, Paginator;
var init_paginator = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/paginator.js"() {
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    debounce = (f3, wait2, immediate) => {
      let timeout;
      return (...args) => {
        const later = () => {
          timeout = null;
          if (!immediate) f3(...args);
        };
        const callNow = immediate && !timeout;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(later, wait2);
        if (callNow) f3(...args);
      };
    };
    lerp = (min, max2, x3) => x3 * (max2 - min) + min;
    easeOutQuad = (x3) => 1 - (1 - x3) * (1 - x3);
    animate = (a3, b3, duration, ease, render) => new Promise((resolve) => {
      let start;
      const step = (now) => {
        start ??= now;
        const fraction = Math.min(1, (now - start) / duration);
        render(lerp(a3, b3, ease(fraction)));
        if (fraction < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    uncollapse = (range) => {
      if (!range?.collapsed) return range;
      const { endOffset, endContainer } = range;
      if (endContainer.nodeType === 1) {
        const node = endContainer.childNodes[endOffset];
        if (node?.nodeType === 1) return node;
        return endContainer;
      }
      if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1);
      else if (endOffset > 1) range.setStart(endContainer, endOffset - 1);
      else return endContainer.parentNode;
      return range;
    };
    makeRange = (doc, node, start, end = start) => {
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      return range;
    };
    bisectNode = (doc, node, cb, start = 0, end = node.nodeValue.length) => {
      if (end - start === 1) {
        const result2 = cb(makeRange(doc, node, start), makeRange(doc, node, end));
        return result2 < 0 ? start : end;
      }
      const mid = Math.floor(start + (end - start) / 2);
      const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end));
      return result < 0 ? bisectNode(doc, node, cb, start, mid) : result > 0 ? bisectNode(doc, node, cb, mid, end) : mid;
    };
    ({
      SHOW_ELEMENT,
      SHOW_TEXT,
      SHOW_CDATA_SECTION,
      FILTER_ACCEPT,
      FILTER_REJECT,
      FILTER_SKIP
    } = NodeFilter);
    filter2 = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION;
    getBoundingClientRect = (target) => {
      let top = Infinity, right = -Infinity, left = Infinity, bottom = -Infinity;
      for (const rect of target.getClientRects()) {
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      return new DOMRect(left, top, right - left, bottom - top);
    };
    getVisibleRange = (doc, start, end, mapRect) => {
      const acceptNode2 = (node) => {
        const name = node.localName?.toLowerCase();
        if (name === "script" || name === "style") return FILTER_REJECT;
        if (node.nodeType === 1) {
          const { left, right } = mapRect(node.getBoundingClientRect());
          if (right < start || left > end) return FILTER_REJECT;
          if (left >= start && right <= end) return FILTER_ACCEPT;
        } else {
          if (!node.nodeValue?.trim()) return FILTER_SKIP;
          const range2 = doc.createRange();
          range2.selectNodeContents(node);
          const { left, right } = mapRect(range2.getBoundingClientRect());
          if (right >= start && left <= end) return FILTER_ACCEPT;
        }
        return FILTER_SKIP;
      };
      const walker = doc.createTreeWalker(doc.body, filter2, { acceptNode: acceptNode2 });
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node);
      const from = nodes[0] ?? doc.body;
      const to = nodes[nodes.length - 1] ?? from;
      const startOffset = from.nodeType === 1 ? 0 : bisectNode(doc, from, (a3, b3) => {
        const p3 = mapRect(getBoundingClientRect(a3));
        const q2 = mapRect(getBoundingClientRect(b3));
        if (p3.right < start && q2.left > start) return 0;
        return q2.left > start ? -1 : 1;
      });
      const endOffset = to.nodeType === 1 ? 0 : bisectNode(doc, to, (a3, b3) => {
        const p3 = mapRect(getBoundingClientRect(a3));
        const q2 = mapRect(getBoundingClientRect(b3));
        if (p3.right < end && q2.left > end) return 0;
        return q2.left > end ? -1 : 1;
      });
      const range = doc.createRange();
      range.setStart(from, startOffset);
      range.setEnd(to, endOffset);
      return range;
    };
    selectionIsBackward = (sel) => {
      const range = document.createRange();
      range.setStart(sel.anchorNode, sel.anchorOffset);
      range.setEnd(sel.focusNode, sel.focusOffset);
      return range.collapsed;
    };
    setSelectionTo = (target, collapse2) => {
      let range;
      if (target.startContainer) range = target.cloneRange();
      else if (target.nodeType) {
        range = document.createRange();
        range.selectNode(target);
      }
      if (range) {
        const sel = range.startContainer.ownerDocument.defaultView.getSelection();
        sel.removeAllRanges();
        if (collapse2 === -1) range.collapse(true);
        else if (collapse2 === 1) range.collapse();
        sel.addRange(range);
      }
    };
    getDirection = (doc) => {
      const { defaultView } = doc;
      const { writingMode, direction } = defaultView.getComputedStyle(doc.body);
      const vertical = writingMode === "vertical-rl" || writingMode === "vertical-lr";
      const rtl = doc.body.dir === "rtl" || direction === "rtl" || doc.documentElement.dir === "rtl";
      return { vertical, rtl };
    };
    getBackground = (doc) => {
      const bodyStyle = doc.defaultView.getComputedStyle(doc.body);
      return bodyStyle.backgroundColor === "rgba(0, 0, 0, 0)" && bodyStyle.backgroundImage === "none" ? doc.defaultView.getComputedStyle(doc.documentElement).background : bodyStyle.background;
    };
    makeMarginals = (length, part) => Array.from({ length }, () => {
      const div = document.createElement("div");
      const child = document.createElement("div");
      div.append(child);
      child.setAttribute("part", part);
      return div;
    });
    setStylesImportant = (el, styles) => {
      const { style: style2 } = el;
      for (const [k3, v3] of Object.entries(styles)) style2.setProperty(k3, v3, "important");
    };
    View = class {
      #observer = new ResizeObserver(() => this.expand());
      #element = document.createElement("div");
      #iframe = document.createElement("iframe");
      #contentRange = document.createRange();
      #overlayer;
      #vertical = false;
      #rtl = false;
      #column = true;
      #size;
      #layout = {};
      constructor({ container, onExpand }) {
        this.container = container;
        this.onExpand = onExpand;
        this.#iframe.setAttribute("part", "filter");
        this.#element.append(this.#iframe);
        Object.assign(this.#element.style, {
          boxSizing: "content-box",
          position: "relative",
          overflow: "hidden",
          flex: "0 0 auto",
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        });
        Object.assign(this.#iframe.style, {
          overflow: "hidden",
          border: "0",
          display: "none",
          width: "100%",
          height: "100%"
        });
        this.#iframe.setAttribute("sandbox", "allow-same-origin");
        this.#iframe.setAttribute("scrolling", "no");
      }
      get element() {
        return this.#element;
      }
      get document() {
        return this.#iframe.contentDocument;
      }
      async load(src, afterLoad, beforeRender) {
        if (typeof src !== "string") throw new Error(`${src} is not string`);
        return new Promise((resolve) => {
          this.#iframe.addEventListener("load", () => {
            const doc = this.document;
            afterLoad?.(doc);
            this.#iframe.style.display = "block";
            const { vertical, rtl } = getDirection(doc);
            this.docBackground = getBackground(doc);
            doc.body.style.background = "none";
            const background = this.docBackground;
            this.#iframe.style.display = "none";
            this.#vertical = vertical;
            this.#rtl = rtl;
            this.#contentRange.selectNodeContents(doc.body);
            const layout = beforeRender?.({ vertical, rtl, background });
            this.#iframe.style.display = "block";
            this.render(layout);
            this.#observer.observe(doc.body);
            doc.fonts.ready.then(() => this.expand());
            resolve();
          }, { once: true });
          this.#iframe.src = src;
        });
      }
      render(layout) {
        if (!layout || !this.document) return;
        this.#column = layout.flow !== "scrolled";
        this.#layout = layout;
        if (this.#column) this.columnize(layout);
        else this.scrolled(layout);
      }
      scrolled({ margin, gap, columnWidth }) {
        const vertical = this.#vertical;
        const doc = this.document;
        setStylesImportant(doc.documentElement, {
          "box-sizing": "border-box",
          "padding": vertical ? `${margin * 1.5}px ${gap}px` : `0 ${gap}px`,
          "column-width": "auto",
          "height": "auto",
          "width": "auto"
        });
        setStylesImportant(doc.body, {
          [vertical ? "max-height" : "max-width"]: `${columnWidth}px`,
          "margin": "auto"
        });
        this.setImageSize();
        this.expand();
      }
      columnize({ width, height, margin, gap, columnWidth }) {
        const vertical = this.#vertical;
        this.#size = vertical ? height : width;
        const doc = this.document;
        setStylesImportant(doc.documentElement, {
          "box-sizing": "border-box",
          "column-width": `${Math.trunc(columnWidth)}px`,
          "column-gap": vertical ? `${margin}px` : `${gap}px`,
          "column-fill": "auto",
          ...vertical ? { "width": `${width}px` } : { "height": `${height}px` },
          "padding": vertical ? `${margin / 2}px ${gap}px` : `0 ${gap / 2}px`,
          "overflow": "hidden",
          // force wrap long words
          "overflow-wrap": "break-word",
          // reset some potentially problematic props
          "position": "static",
          "border": "0",
          "margin": "0",
          "max-height": "none",
          "max-width": "none",
          "min-height": "none",
          "min-width": "none",
          // fix glyph clipping in WebKit
          "-webkit-line-box-contain": "block glyphs replaced"
        });
        setStylesImportant(doc.body, {
          "max-height": "none",
          "max-width": "none",
          "margin": "0"
        });
        this.setImageSize();
        this.expand();
      }
      setImageSize() {
        const { width, height, margin } = this.#layout;
        const vertical = this.#vertical;
        const doc = this.document;
        for (const el of doc.body.querySelectorAll("img, svg, video")) {
          const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el);
          setStylesImportant(el, {
            "max-height": vertical ? maxHeight !== "none" && maxHeight !== "0px" ? maxHeight : "100%" : `${height - margin * 2}px`,
            "max-width": vertical ? `${width - margin * 2}px` : maxWidth !== "none" && maxWidth !== "0px" ? maxWidth : "100%",
            "object-fit": "contain",
            "page-break-inside": "avoid",
            "break-inside": "avoid",
            "box-sizing": "border-box"
          });
        }
      }
      expand() {
        const { documentElement } = this.document;
        if (this.#column) {
          const side = this.#vertical ? "height" : "width";
          const otherSide = this.#vertical ? "width" : "height";
          const contentRect = this.#contentRange.getBoundingClientRect();
          const rootRect = documentElement.getBoundingClientRect();
          const contentStart = this.#vertical ? 0 : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left;
          const contentSize = contentStart + contentRect[side];
          const pageCount = Math.ceil(contentSize / this.#size);
          const expandedSize = pageCount * this.#size;
          this.#element.style.padding = "0";
          this.#iframe.style[side] = `${expandedSize}px`;
          this.#element.style[side] = `${expandedSize + this.#size * 2}px`;
          this.#iframe.style[otherSide] = "100%";
          this.#element.style[otherSide] = "100%";
          documentElement.style[side] = `${this.#size}px`;
          if (this.#overlayer) {
            this.#overlayer.element.style.margin = "0";
            this.#overlayer.element.style.left = this.#vertical ? "0" : `${this.#size}px`;
            this.#overlayer.element.style.top = this.#vertical ? `${this.#size}px` : "0";
            this.#overlayer.element.style[side] = `${expandedSize}px`;
            this.#overlayer.redraw();
          }
        } else {
          const side = this.#vertical ? "width" : "height";
          const otherSide = this.#vertical ? "height" : "width";
          const contentSize = documentElement.getBoundingClientRect()[side];
          const expandedSize = contentSize;
          const { margin, gap } = this.#layout;
          const padding = this.#vertical ? `0 ${gap}px` : `${margin}px 0`;
          this.#element.style.padding = padding;
          this.#iframe.style[side] = `${expandedSize}px`;
          this.#element.style[side] = `${expandedSize}px`;
          this.#iframe.style[otherSide] = "100%";
          this.#element.style[otherSide] = "100%";
          if (this.#overlayer) {
            this.#overlayer.element.style.margin = padding;
            this.#overlayer.element.style.left = "0";
            this.#overlayer.element.style.top = "0";
            this.#overlayer.element.style[side] = `${expandedSize}px`;
            this.#overlayer.redraw();
          }
        }
        this.onExpand();
      }
      set overlayer(overlayer) {
        this.#overlayer = overlayer;
        this.#element.append(overlayer.element);
      }
      get overlayer() {
        return this.#overlayer;
      }
      destroy() {
        if (this.document) this.#observer.unobserve(this.document.body);
      }
    };
    Paginator = class extends HTMLElement {
      static observedAttributes = [
        "flow",
        "gap",
        "margin",
        "max-inline-size",
        "max-block-size",
        "max-column-count"
      ];
      #root = this.attachShadow({ mode: "closed" });
      #observer = new ResizeObserver(() => this.render());
      #top;
      #background;
      #container;
      #header;
      #footer;
      #view;
      #vertical = false;
      #rtl = false;
      #margin = 0;
      #index = -1;
      #anchor = 0;
      // anchor view to a fraction (0-1), Range, or Element
      #justAnchored = false;
      #locked = false;
      // while true, prevent any further navigation
      #styles;
      #styleMap = /* @__PURE__ */ new WeakMap();
      #mediaQuery = matchMedia("(prefers-color-scheme: dark)");
      #mediaQueryListener;
      #scrollBounds;
      #touchState;
      #touchScrolled;
      #lastVisibleRange;
      constructor() {
        super();
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin: 48px;
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                minmax(var(--_margin), 1fr)
                minmax(0, var(--_max-height))
                minmax(var(--_margin), 1fr);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 2;
            overflow: hidden;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: auto;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header, #footer {
            display: grid;
            height: var(--_margin);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container" part="container"></div>
            <div id="footer"></div>
        </div>
        `;
        this.#top = this.#root.getElementById("top");
        this.#background = this.#root.getElementById("background");
        this.#container = this.#root.getElementById("container");
        this.#header = this.#root.getElementById("header");
        this.#footer = this.#root.getElementById("footer");
        this.#observer.observe(this.#container);
        this.#container.addEventListener("scroll", () => this.dispatchEvent(new Event("scroll")));
        this.#container.addEventListener("scroll", debounce(() => {
          if (this.scrolled) {
            if (this.#justAnchored) this.#justAnchored = false;
            else this.#afterScroll("scroll");
          }
        }, 250));
        const opts = { passive: false };
        this.addEventListener("touchstart", this.#onTouchStart.bind(this), opts);
        this.addEventListener("touchmove", this.#onTouchMove.bind(this), opts);
        this.addEventListener("touchend", this.#onTouchEnd.bind(this));
        this.addEventListener("load", ({ detail: { doc } }) => {
          doc.addEventListener("touchstart", this.#onTouchStart.bind(this), opts);
          doc.addEventListener("touchmove", this.#onTouchMove.bind(this), opts);
          doc.addEventListener("touchend", this.#onTouchEnd.bind(this));
        });
        this.addEventListener("relocate", ({ detail }) => {
          if (detail.reason === "selection") setSelectionTo(this.#anchor, 0);
          else if (detail.reason === "navigation") {
            if (this.#anchor === 1) setSelectionTo(detail.range, 1);
            else if (typeof this.#anchor === "number")
              setSelectionTo(detail.range, -1);
            else setSelectionTo(this.#anchor, -1);
          }
        });
        const checkPointerSelection = debounce((range, sel) => {
          if (!sel.rangeCount) return;
          const selRange = sel.getRangeAt(0);
          const backward = selectionIsBackward(sel);
          if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
            this.prev();
          else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
            this.next();
        }, 700);
        this.addEventListener("load", ({ detail: { doc } }) => {
          let isPointerSelecting = false;
          doc.addEventListener("pointerdown", () => isPointerSelecting = true);
          doc.addEventListener("pointerup", () => isPointerSelecting = false);
          let isKeyboardSelecting = false;
          doc.addEventListener("keydown", () => isKeyboardSelecting = true);
          doc.addEventListener("keyup", () => isKeyboardSelecting = false);
          doc.addEventListener("selectionchange", () => {
            if (this.scrolled) return;
            const range = this.#lastVisibleRange;
            if (!range) return;
            const sel = doc.getSelection();
            if (!sel.rangeCount) return;
            if (isPointerSelecting && sel.type === "Range")
              checkPointerSelection(range, sel);
            else if (isKeyboardSelecting) {
              const selRange = sel.getRangeAt(0).cloneRange();
              const backward = selectionIsBackward(sel);
              if (!backward) selRange.collapse();
              this.#scrollToAnchor(selRange);
            }
          });
          doc.addEventListener("focusin", (e3) => this.scrolled ? null : (
            // NOTE: `requestAnimationFrame` is needed in WebKit
            requestAnimationFrame(() => this.#scrollToAnchor(e3.target))
          ));
        });
        this.#mediaQueryListener = () => {
          if (!this.#view) return;
          this.#replaceBackground(this.#view.docBackground, this.columnCount);
        };
        this.#mediaQuery.addEventListener("change", this.#mediaQueryListener);
      }
      attributeChangedCallback(name, _2, value) {
        switch (name) {
          case "flow":
            this.render();
            break;
          case "gap":
          case "margin":
          case "max-block-size":
          case "max-column-count":
            this.#top.style.setProperty("--_" + name, value);
            this.render();
            break;
          case "max-inline-size":
            this.#top.style.setProperty("--_" + name, value);
            this.render();
            break;
        }
      }
      open(book) {
        this.bookDir = book.dir;
        this.sections = book.sections;
        book.transformTarget?.addEventListener("data", ({ detail }) => {
          if (detail.type !== "text/css") return;
          const w2 = innerWidth;
          const h3 = innerHeight;
          detail.data = Promise.resolve(detail.data).then((data) => data.replace(/(?<=[{\s;])-epub-/gi, "").replace(/(\d*\.?\d+)vw/gi, (_2, d2) => parseFloat(d2) * w2 / 100 + "px").replace(/(\d*\.?\d+)vh/gi, (_2, d2) => parseFloat(d2) * h3 / 100 + "px").replace(/page-break-(after|before|inside)\s*:/gi, (_2, x3) => `-webkit-column-break-${x3}:`).replace(/break-(after|before|inside)\s*:\s*(avoid-)?page/gi, (_2, x3, y3) => `break-${x3}: ${y3 ?? ""}column`));
        });
      }
      #createView() {
        if (this.#view) {
          this.#view.destroy();
          this.#container.removeChild(this.#view.element);
        }
        this.#view = new View({
          container: this,
          onExpand: () => this.#scrollToAnchor(this.#anchor)
        });
        this.#container.append(this.#view.element);
        return this.#view;
      }
      #replaceBackground(background, columnCount) {
        const doc = this.#view?.document;
        if (!doc) return;
        const htmlStyle = doc.defaultView.getComputedStyle(doc.documentElement);
        const themeBgColor = htmlStyle.getPropertyValue("--theme-bg-color");
        if (background && themeBgColor) {
          const parsedBackground = background.split(/\s(?=(?:url|rgb|hsl|#[0-9a-fA-F]{3,6}))/);
          parsedBackground[0] = themeBgColor;
          background = parsedBackground.join(" ");
        }
        if (/cover.*fixed|fixed.*cover/.test(background)) {
          background = background.replace("cover", "auto 100%").replace("fixed", "");
        }
        this.#background.innerHTML = "";
        this.#background.style.display = "grid";
        this.#background.style.gridTemplateColumns = `repeat(${columnCount}, 1fr)`;
        for (let i3 = 0; i3 < columnCount; i3++) {
          const column = document.createElement("div");
          column.style.background = background;
          column.style.width = "100%";
          column.style.height = "100%";
          this.#background.appendChild(column);
        }
      }
      #beforeRender({ vertical, rtl, background }) {
        this.#vertical = vertical;
        this.#rtl = rtl;
        this.#top.classList.toggle("vertical", vertical);
        const { width, height } = this.#container.getBoundingClientRect();
        const size = vertical ? height : width;
        const style2 = getComputedStyle(this.#top);
        const maxInlineSize = parseFloat(style2.getPropertyValue("--_max-inline-size"));
        const maxColumnCount = parseInt(style2.getPropertyValue("--_max-column-count-spread"));
        const margin = parseFloat(style2.getPropertyValue("--_margin"));
        this.#margin = margin;
        const g3 = parseFloat(style2.getPropertyValue("--_gap")) / 100;
        const gap = -g3 / (g3 - 1) * size;
        const flow = this.getAttribute("flow");
        if (flow === "scrolled") {
          this.setAttribute("dir", vertical ? "rtl" : "ltr");
          this.#top.style.padding = "0";
          const columnWidth2 = maxInlineSize;
          this.heads = null;
          this.feet = null;
          this.#header.replaceChildren();
          this.#footer.replaceChildren();
          return { flow, margin, gap, columnWidth: columnWidth2 };
        }
        const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize));
        const columnWidth = vertical ? size / divisor - margin : size / divisor - gap;
        this.setAttribute("dir", rtl ? "rtl" : "ltr");
        this.columnCount = divisor;
        this.#replaceBackground(background, this.columnCount);
        const marginalDivisor = vertical ? Math.min(2, Math.ceil(width / maxInlineSize)) : divisor;
        const marginalStyle = {
          gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
          gap: `${gap}px`,
          direction: this.bookDir === "rtl" ? "rtl" : "ltr"
        };
        Object.assign(this.#header.style, marginalStyle);
        Object.assign(this.#footer.style, marginalStyle);
        const heads = makeMarginals(marginalDivisor, "head");
        const feet = makeMarginals(marginalDivisor, "foot");
        this.heads = heads.map((el) => el.children[0]);
        this.feet = feet.map((el) => el.children[0]);
        this.#header.replaceChildren(...heads);
        this.#footer.replaceChildren(...feet);
        return { height, width, margin, gap, columnWidth };
      }
      render() {
        if (!this.#view) return;
        this.#view.render(this.#beforeRender({
          vertical: this.#vertical,
          rtl: this.#rtl
        }));
        this.#scrollToAnchor(this.#anchor);
      }
      get scrolled() {
        return this.getAttribute("flow") === "scrolled";
      }
      get scrollProp() {
        const { scrolled } = this;
        return this.#vertical ? scrolled ? "scrollLeft" : "scrollTop" : scrolled ? "scrollTop" : "scrollLeft";
      }
      get sideProp() {
        const { scrolled } = this;
        return this.#vertical ? scrolled ? "width" : "height" : scrolled ? "height" : "width";
      }
      get size() {
        return this.#container.getBoundingClientRect()[this.sideProp];
      }
      get viewSize() {
        return this.#view.element.getBoundingClientRect()[this.sideProp];
      }
      get start() {
        return Math.abs(this.#container[this.scrollProp]);
      }
      get end() {
        return this.start + this.size;
      }
      get page() {
        return Math.floor((this.start + this.end) / 2 / this.size);
      }
      get pages() {
        return Math.round(this.viewSize / this.size);
      }
      // this is the current position of the container
      get containerPosition() {
        return this.#container[this.scrollProp];
      }
      // this is the new position of the containr
      set containerPosition(newVal) {
        this.#container[this.scrollProp] = newVal;
      }
      scrollBy(dx, dy) {
        const delta = this.#vertical ? dy : dx;
        const [offset, a3, b3] = this.#scrollBounds;
        const rtl = this.#rtl;
        const min = rtl ? offset - b3 : offset - a3;
        const max2 = rtl ? offset + a3 : offset + b3;
        this.containerPosition = Math.max(min, Math.min(
          max2,
          this.containerPosition + delta
        ));
      }
      snap(vx, vy) {
        const velocity = this.#vertical ? vy : vx;
        const [offset, a3, b3] = this.#scrollBounds;
        const { start, end, pages, size } = this;
        const min = Math.abs(offset) - a3;
        const max2 = Math.abs(offset) + b3;
        const d2 = velocity * (this.#rtl ? -size : size);
        const page = Math.floor(
          Math.max(min, Math.min(max2, (start + end) / 2 + (isNaN(d2) ? 0 : d2))) / size
        );
        this.#scrollToPage(page, "snap").then(() => {
          const dir = page <= 0 ? -1 : page >= pages - 1 ? 1 : null;
          if (dir) return this.#goTo({
            index: this.#adjacentIndex(dir),
            anchor: dir < 0 ? () => 1 : () => 0
          });
        });
      }
      #onTouchStart(e3) {
        const touch = e3.changedTouches[0];
        this.#touchState = {
          x: touch?.screenX,
          y: touch?.screenY,
          t: e3.timeStamp,
          vx: 0,
          xy: 0
        };
      }
      #onTouchMove(e3) {
        const state = this.#touchState;
        if (state.pinched) return;
        state.pinched = globalThis.visualViewport.scale > 1;
        if (this.scrolled || state.pinched) return;
        if (e3.touches.length > 1) {
          if (this.#touchScrolled) e3.preventDefault();
          return;
        }
        const doc = this.#view?.document;
        const selection = doc?.getSelection();
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
          return;
        }
        e3.preventDefault();
        const touch = e3.changedTouches[0];
        const x3 = touch.screenX, y3 = touch.screenY;
        const dx = state.x - x3, dy = state.y - y3;
        const dt2 = e3.timeStamp - state.t;
        state.x = x3;
        state.y = y3;
        state.t = e3.timeStamp;
        state.vx = dx / dt2;
        state.vy = dy / dt2;
        this.#touchScrolled = true;
        if (Math.abs(dx) >= Math.abs(dy)) {
          this.scrollBy(dx, 0);
        } else if (Math.abs(dy) > Math.abs(dx)) {
          this.scrollBy(0, dy);
        }
      }
      #onTouchEnd() {
        this.#touchScrolled = false;
        if (this.scrolled) return;
        requestAnimationFrame(() => {
          if (globalThis.visualViewport.scale === 1)
            this.snap(this.#touchState.vx, this.#touchState.vy);
        });
      }
      // allows one to process rects as if they were LTR and horizontal
      #getRectMapper() {
        if (this.scrolled) {
          const size = this.viewSize;
          const margin = this.#margin;
          return this.#vertical ? ({ left, right }) => ({ left: size - right - margin, right: size - left - margin }) : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin });
        }
        const pxSize = this.pages * this.size;
        return this.#rtl ? ({ left, right }) => ({ left: pxSize - right, right: pxSize - left }) : this.#vertical ? ({ top, bottom }) => ({ left: top, right: bottom }) : (f3) => f3;
      }
      async #scrollToRect(rect, reason) {
        if (this.scrolled) {
          const offset2 = this.#getRectMapper()(rect).left - this.#margin;
          return this.#scrollTo(offset2, reason);
        }
        const offset = this.#getRectMapper()(rect).left;
        return this.#scrollToPage(Math.floor(offset / this.size) + (this.#rtl ? -1 : 1), reason);
      }
      async #scrollTo(offset, reason, smooth) {
        const { size } = this;
        if (this.containerPosition === offset) {
          this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size];
          this.#afterScroll(reason);
          return;
        }
        if (this.scrolled && this.#vertical) offset = -offset;
        if ((reason === "snap" || smooth) && this.hasAttribute("animated")) return animate(
          this.containerPosition,
          offset,
          300,
          easeOutQuad,
          (x3) => this.containerPosition = x3
        ).then(() => {
          this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size];
          this.#afterScroll(reason);
        });
        else {
          this.containerPosition = offset;
          this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size];
          this.#afterScroll(reason);
        }
      }
      async #scrollToPage(page, reason, smooth) {
        const offset = this.size * (this.#rtl ? -page : page);
        return this.#scrollTo(offset, reason, smooth);
      }
      async scrollToAnchor(anchor, select) {
        return this.#scrollToAnchor(anchor, select ? "selection" : "navigation");
      }
      async #scrollToAnchor(anchor, reason = "anchor") {
        this.#anchor = anchor;
        const rects = uncollapse(anchor)?.getClientRects?.();
        if (rects) {
          const rect = Array.from(rects).find((r3) => r3.width > 0 && r3.height > 0) || rects[0];
          if (!rect) return;
          await this.#scrollToRect(rect, reason);
          return;
        }
        if (this.scrolled) {
          await this.#scrollTo(anchor * this.viewSize, reason);
          return;
        }
        const { pages } = this;
        if (!pages) return;
        const textPages = pages - 2;
        const newPage = Math.round(anchor * (textPages - 1));
        await this.#scrollToPage(newPage + 1, reason);
      }
      #getVisibleRange() {
        if (this.scrolled) return getVisibleRange(
          this.#view.document,
          this.start + this.#margin,
          this.end - this.#margin,
          this.#getRectMapper()
        );
        const size = this.#rtl ? -this.size : this.size;
        return getVisibleRange(
          this.#view.document,
          this.start - size,
          this.end - size,
          this.#getRectMapper()
        );
      }
      #afterScroll(reason) {
        const range = this.#getVisibleRange();
        this.#lastVisibleRange = range;
        if (reason !== "selection" && reason !== "navigation" && reason !== "anchor")
          this.#anchor = range;
        else this.#justAnchored = true;
        const index = this.#index;
        const detail = { reason, range, index };
        if (this.scrolled) detail.fraction = this.start / this.viewSize;
        else if (this.pages > 0) {
          const { page, pages } = this;
          this.#header.style.visibility = page > 1 ? "visible" : "hidden";
          detail.fraction = (page - 1) / (pages - 2);
          detail.size = 1 / (pages - 2);
        }
        this.dispatchEvent(new CustomEvent("relocate", { detail }));
      }
      async #display(promise) {
        const { index, src, anchor, onLoad, select } = await promise;
        this.#index = index;
        const hasFocus = this.#view?.document?.hasFocus();
        if (src) {
          const view = this.#createView();
          const afterLoad = (doc) => {
            if (doc.head) {
              const $styleBefore = doc.createElement("style");
              doc.head.prepend($styleBefore);
              const $style = doc.createElement("style");
              doc.head.append($style);
              this.#styleMap.set(doc, [$styleBefore, $style]);
            }
            onLoad?.({ doc, index });
          };
          const beforeRender = this.#beforeRender.bind(this);
          await view.load(src, afterLoad, beforeRender);
          this.dispatchEvent(new CustomEvent("create-overlayer", {
            detail: {
              doc: view.document,
              index,
              attach: (overlayer) => view.overlayer = overlayer
            }
          }));
          this.#view = view;
        }
        await this.scrollToAnchor((typeof anchor === "function" ? anchor(this.#view.document) : anchor) ?? 0, select);
        if (hasFocus) this.focusView();
      }
      #canGoToIndex(index) {
        return index >= 0 && index <= this.sections.length - 1;
      }
      async #goTo({ index, anchor, select }) {
        if (index === this.#index) await this.#display({ index, anchor, select });
        else {
          const oldIndex = this.#index;
          const onLoad = (detail) => {
            this.sections[oldIndex]?.unload?.();
            this.setStyles(this.#styles);
            this.dispatchEvent(new CustomEvent("load", { detail }));
          };
          await this.#display(Promise.resolve(this.sections[index].load()).then((src) => ({ index, src, anchor, onLoad, select })).catch((e3) => {
            console.warn(e3);
            console.warn(new Error(`Failed to load section ${index}`));
            return {};
          }));
        }
      }
      async goTo(target) {
        if (this.#locked) return;
        const resolved = await target;
        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved);
      }
      #scrollPrev(distance) {
        if (!this.#view) return true;
        if (this.scrolled) {
          if (this.start > 0) return this.#scrollTo(
            Math.max(0, this.start - (distance ?? this.size)),
            null,
            true
          );
          return !this.atStart;
        }
        if (this.atStart) return;
        const page = this.page - 1;
        return this.#scrollToPage(page, "page", true).then(() => page <= 0);
      }
      #scrollNext(distance) {
        if (!this.#view) return true;
        if (this.scrolled) {
          if (this.viewSize - this.end > 2) return this.#scrollTo(
            Math.min(this.viewSize, distance ? this.start + distance : this.end),
            null,
            true
          );
          return !this.atEnd;
        }
        if (this.atEnd) return;
        const page = this.page + 1;
        const pages = this.pages;
        return this.#scrollToPage(page, "page", true).then(() => page >= pages - 1);
      }
      get atStart() {
        return this.#adjacentIndex(-1) == null && this.page <= 1;
      }
      get atEnd() {
        return this.#adjacentIndex(1) == null && this.page >= this.pages - 2;
      }
      #adjacentIndex(dir) {
        for (let index = this.#index + dir; this.#canGoToIndex(index); index += dir)
          if (this.sections[index]?.linear !== "no") return index;
      }
      async #turnPage(dir, distance) {
        if (this.#locked) return;
        this.#locked = true;
        const prev = dir === -1;
        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance));
        if (shouldGo) await this.#goTo({
          index: this.#adjacentIndex(dir),
          anchor: prev ? () => 1 : () => 0
        });
        if (shouldGo || !this.hasAttribute("animated")) await wait(100);
        this.#locked = false;
      }
      async prev(distance) {
        return await this.#turnPage(-1, distance);
      }
      async next(distance) {
        return await this.#turnPage(1, distance);
      }
      prevSection() {
        return this.goTo({ index: this.#adjacentIndex(-1) });
      }
      nextSection() {
        return this.goTo({ index: this.#adjacentIndex(1) });
      }
      firstSection() {
        const index = this.sections.findIndex((section) => section.linear !== "no");
        return this.goTo({ index });
      }
      lastSection() {
        const index = this.sections.findLastIndex((section) => section.linear !== "no");
        return this.goTo({ index });
      }
      getContents() {
        if (this.#view) return [{
          index: this.#index,
          overlayer: this.#view.overlayer,
          doc: this.#view.document
        }];
        return [];
      }
      setStyles(styles) {
        this.#styles = styles;
        const $$styles = this.#styleMap.get(this.#view?.document);
        if (!$$styles) return;
        const [$beforeStyle, $style] = $$styles;
        if (Array.isArray(styles)) {
          const [beforeStyle, style2] = styles;
          $beforeStyle.textContent = beforeStyle;
          $style.textContent = style2;
        } else $style.textContent = styles;
        requestAnimationFrame(() => {
          this.#replaceBackground(this.#view.docBackground, this.columnCount);
        });
        this.#view?.document?.fonts?.ready?.then(() => this.#view.expand());
      }
      focusView() {
        this.#view.document.defaultView.focus();
      }
      destroy() {
        this.#observer.unobserve(this);
        this.#view.destroy();
        this.#view = null;
        this.sections[this.#index]?.unload?.();
        this.#mediaQuery.removeEventListener("change", this.#mediaQueryListener);
      }
    };
    if (!customElements.get("foliate-paginator"))
      customElements.define("foliate-paginator", Paginator);
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/search.js
var search_exports = {};
__export(search_exports, {
  search: () => search,
  searchMatcher: () => searchMatcher
});
var CONTEXT_LENGTH, normalizeWhitespace3, makeExcerpt, simpleSearch, segmenterSearch, search, searchMatcher;
var init_search = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/search.js"() {
    CONTEXT_LENGTH = 50;
    normalizeWhitespace3 = (str) => str.replace(/\s+/g, " ");
    makeExcerpt = (strs, { startIndex, startOffset, endIndex, endOffset }) => {
      const start = strs[startIndex];
      const end = strs[endIndex];
      const match = start === end ? start.slice(startOffset, endOffset) : start.slice(startOffset) + strs.slice(start + 1, end).join("") + end.slice(0, endOffset);
      const trimmedStart = normalizeWhitespace3(start.slice(0, startOffset)).trimStart();
      const trimmedEnd = normalizeWhitespace3(end.slice(endOffset)).trimEnd();
      const ellipsisPre = trimmedStart.length < CONTEXT_LENGTH ? "" : "\u2026";
      const ellipsisPost = trimmedEnd.length < CONTEXT_LENGTH ? "" : "\u2026";
      const pre = `${ellipsisPre}${trimmedStart.slice(-CONTEXT_LENGTH)}`;
      const post = `${trimmedEnd.slice(0, CONTEXT_LENGTH)}${ellipsisPost}`;
      return { pre, match, post };
    };
    simpleSearch = function* (strs, query, options = {}) {
      const { locales = "en", sensitivity } = options;
      const matchCase = sensitivity === "variant";
      const haystack = strs.join("");
      const lowerHaystack = matchCase ? haystack : haystack.toLocaleLowerCase(locales);
      const needle = matchCase ? query : query.toLocaleLowerCase(locales);
      const needleLength = needle.length;
      let index = -1;
      let strIndex = -1;
      let sum = 0;
      do {
        index = lowerHaystack.indexOf(needle, index + 1);
        if (index > -1) {
          while (sum <= index) sum += strs[++strIndex].length;
          const startIndex = strIndex;
          const startOffset = index - (sum - strs[strIndex].length);
          const end = index + needleLength;
          while (sum <= end) sum += strs[++strIndex].length;
          const endIndex = strIndex;
          const endOffset = end - (sum - strs[strIndex].length);
          const range = { startIndex, startOffset, endIndex, endOffset };
          yield { range, excerpt: makeExcerpt(strs, range) };
        }
      } while (index > -1);
    };
    segmenterSearch = function* (strs, query, options = {}) {
      const { locales = "en", granularity = "word", sensitivity = "base" } = options;
      let segmenter, collator;
      try {
        segmenter = new Intl.Segmenter(locales, { usage: "search", granularity });
        collator = new Intl.Collator(locales, { sensitivity });
      } catch (e3) {
        console.warn(e3);
        segmenter = new Intl.Segmenter("en", { usage: "search", granularity });
        collator = new Intl.Collator("en", { sensitivity });
      }
      const queryLength = Array.from(segmenter.segment(query)).length;
      const substrArr = [];
      let strIndex = 0;
      let segments = segmenter.segment(strs[strIndex])[Symbol.iterator]();
      main: while (strIndex < strs.length) {
        while (substrArr.length < queryLength) {
          const { done, value } = segments.next();
          if (done) {
            strIndex++;
            if (strIndex < strs.length) {
              segments = segmenter.segment(strs[strIndex])[Symbol.iterator]();
              continue;
            } else break main;
          }
          const { index, segment } = value;
          if (!/[^\p{Format}]/u.test(segment)) continue;
          if (/\s/u.test(segment)) {
            if (!/\s/u.test(substrArr[substrArr.length - 1]?.segment))
              substrArr.push({ strIndex, index, segment: " " });
            continue;
          }
          value.strIndex = strIndex;
          substrArr.push(value);
        }
        const substr = substrArr.map((x3) => x3.segment).join("");
        if (collator.compare(query, substr) === 0) {
          const endIndex = strIndex;
          const lastSeg = substrArr[substrArr.length - 1];
          const endOffset = lastSeg.index + lastSeg.segment.length;
          const startIndex = substrArr[0].strIndex;
          const startOffset = substrArr[0].index;
          const range = { startIndex, startOffset, endIndex, endOffset };
          yield { range, excerpt: makeExcerpt(strs, range) };
        }
        substrArr.shift();
      }
    };
    search = (strs, query, options) => {
      const { granularity = "grapheme", sensitivity = "base" } = options;
      if (!Intl?.Segmenter || granularity === "grapheme" && (sensitivity === "variant" || sensitivity === "accent"))
        return simpleSearch(strs, query, options);
      return segmenterSearch(strs, query, options);
    };
    searchMatcher = (textWalker2, opts) => {
      const { defaultLocale, matchCase, matchDiacritics, matchWholeWords } = opts;
      return function* (doc, query) {
        const iter = textWalker2(doc, function* (strs, makeRange2) {
          for (const result of search(strs, query, {
            locales: doc.body.lang || doc.documentElement.lang || defaultLocale || "en",
            granularity: matchWholeWords ? "word" : "grapheme",
            sensitivity: matchDiacritics && matchCase ? "variant" : matchDiacritics && !matchCase ? "accent" : !matchDiacritics && matchCase ? "case" : "base"
          })) {
            const { startIndex, startOffset, endIndex, endOffset } = result.range;
            result.range = makeRange2(startIndex, startOffset, endIndex, endOffset);
            yield result;
          }
        });
        for (const result of iter) yield result;
      };
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/tts.js
var tts_exports = {};
__export(tts_exports, {
  TTS: () => TTS
});
function* getBlocks(doc) {
  let last;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const name = node.tagName.toLowerCase();
    if (blockTags.has(name)) {
      if (last) {
        last.setEndBefore(node);
        if (!rangeIsEmpty(last)) yield last;
      }
      last = doc.createRange();
      last.setStart(node, 0);
    }
  }
  if (!last) {
    last = doc.createRange();
    last.setStart(doc.body.firstChild ?? doc.body, 0);
  }
  last.setEndAfter(doc.body.lastChild ?? doc.body);
  if (!rangeIsEmpty(last)) yield last;
}
var NS3, blockTags, getLang, getAlphabet, getSegmenter, fragmentToSSML, getFragmentWithMarks, rangeIsEmpty, ListIterator, TTS;
var init_tts = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/tts.js"() {
    NS3 = {
      XML: "http://www.w3.org/XML/1998/namespace",
      SSML: "http://www.w3.org/2001/10/synthesis"
    };
    blockTags = /* @__PURE__ */ new Set([
      "article",
      "aside",
      "audio",
      "blockquote",
      "caption",
      "details",
      "dialog",
      "div",
      "dl",
      "dt",
      "dd",
      "figure",
      "footer",
      "form",
      "figcaption",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "header",
      "hgroup",
      "hr",
      "li",
      "main",
      "math",
      "nav",
      "ol",
      "p",
      "pre",
      "section",
      "tr"
    ]);
    getLang = (el) => {
      const x3 = el.lang || el?.getAttributeNS?.(NS3.XML, "lang");
      return x3 ? x3 : el.parentElement ? getLang(el.parentElement) : null;
    };
    getAlphabet = (el) => {
      const x3 = el?.getAttributeNS?.(NS3.XML, "lang");
      return x3 ? x3 : el.parentElement ? getAlphabet(el.parentElement) : null;
    };
    getSegmenter = (lang = "en", granularity = "word") => {
      const segmenter = new Intl.Segmenter(lang, { granularity });
      const granularityIsWord = granularity === "word";
      return function* (strs, makeRange2) {
        const str = strs.join("").replace(/\r\n/g, "  ").replace(/\r/g, " ").replace(/\n/g, " ");
        let name = 0;
        let strIndex = -1;
        let sum = 0;
        const rawSegments = Array.from(segmenter.segment(str));
        const mergedSegments = [];
        for (let i3 = 0; i3 < rawSegments.length; i3++) {
          const current = rawSegments[i3];
          const next = rawSegments[i3 + 1];
          const segment = current.segment.trim();
          const nextSegment = next?.segment?.trim();
          const endsWithAbbr = /(?:^|\s)([A-Z][a-z]{1,5})\.$/.test(segment);
          const nextStartsWithCapital = /^[A-Z]/.test(nextSegment || "");
          if (endsWithAbbr && nextStartsWithCapital) {
            const mergedSegment = {
              index: current.index,
              segment: current.segment + (next?.segment || ""),
              isWordLike: true
            };
            mergedSegments.push(mergedSegment);
            i3++;
          } else {
            mergedSegments.push(current);
          }
        }
        for (const { index, segment, isWordLike } of mergedSegments) {
          if (granularityIsWord && !isWordLike) continue;
          while (sum <= index) sum += strs[++strIndex].length;
          const startIndex = strIndex;
          const startOffset = index - (sum - strs[strIndex].length);
          const end = index + segment.length - 1;
          if (end < str.length) while (sum <= end) sum += strs[++strIndex].length;
          const endIndex = strIndex;
          const endOffset = end - (sum - strs[strIndex].length) + 1;
          yield [
            (name++).toString(),
            makeRange2(startIndex, startOffset, endIndex, endOffset)
          ];
        }
      };
    };
    fragmentToSSML = (fragment, inherited) => {
      const ssml = document.implementation.createDocument(NS3.SSML, "speak");
      const { lang } = inherited;
      if (lang) ssml.documentElement.setAttributeNS(NS3.XML, "lang", lang);
      const convert = (node, parent, inheritedAlphabet) => {
        if (!node) return;
        if (node.nodeType === 3) return ssml.createTextNode(node.textContent);
        if (node.nodeType === 4) return ssml.createCDATASection(node.textContent);
        if (node.nodeType !== 1) return;
        let el;
        const nodeName = node.nodeName.toLowerCase();
        if (nodeName === "foliate-mark") {
          el = ssml.createElementNS(NS3.SSML, "mark");
          el.setAttribute("name", node.dataset.name);
        } else if (nodeName === "br")
          el = ssml.createElementNS(NS3.SSML, "break");
        else if (nodeName === "em" || nodeName === "strong")
          el = ssml.createElementNS(NS3.SSML, "emphasis");
        const lang2 = node.lang || node.getAttributeNS(NS3.XML, "lang");
        if (lang2) {
          if (!el) el = ssml.createElementNS(NS3.SSML, "lang");
          el.setAttributeNS(NS3.XML, "lang", lang2);
        }
        const alphabet = node.getAttributeNS(NS3.SSML, "alphabet") || inheritedAlphabet;
        if (!el) {
          const ph = node.getAttributeNS(NS3.SSML, "ph");
          if (ph) {
            el = ssml.createElementNS(NS3.SSML, "phoneme");
            if (alphabet) el.setAttribute("alphabet", alphabet);
            el.setAttribute("ph", ph);
          }
        }
        if (!el) el = parent;
        let child = node.firstChild;
        while (child) {
          const childEl = convert(child, el, alphabet);
          if (childEl && el !== childEl) el.append(childEl);
          child = child.nextSibling;
        }
        return el;
      };
      convert(fragment.firstChild, ssml.documentElement, inherited.alphabet);
      return ssml;
    };
    getFragmentWithMarks = (range, textWalker2, granularity) => {
      const lang = getLang(range.commonAncestorContainer);
      const alphabet = getAlphabet(range.commonAncestorContainer);
      const segmenter = getSegmenter(lang, granularity);
      const fragment = range.cloneContents();
      const entries = [...textWalker2(range, segmenter)];
      const fragmentEntries = [...textWalker2(fragment, segmenter)];
      for (const [name, range2] of fragmentEntries) {
        const mark = document.createElement("foliate-mark");
        mark.dataset.name = name;
        range2.insertNode(mark);
      }
      const ssml = fragmentToSSML(fragment, { lang, alphabet });
      return { entries, ssml };
    };
    rangeIsEmpty = (range) => !range.toString().trim();
    ListIterator = class {
      #arr = [];
      #iter;
      #index = -1;
      #f;
      constructor(iter, f3 = (x3) => x3) {
        this.#iter = iter;
        this.#f = f3;
      }
      current() {
        if (this.#arr[this.#index]) return this.#f(this.#arr[this.#index]);
      }
      first() {
        const newIndex = 0;
        if (this.#arr[newIndex]) {
          this.#index = newIndex;
          return this.#f(this.#arr[newIndex]);
        }
      }
      prev() {
        const newIndex = this.#index - 1;
        if (this.#arr[newIndex]) {
          this.#index = newIndex;
          return this.#f(this.#arr[newIndex]);
        }
      }
      next() {
        const newIndex = this.#index + 1;
        if (this.#arr[newIndex]) {
          this.#index = newIndex;
          return this.#f(this.#arr[newIndex]);
        }
        while (true) {
          const { done, value } = this.#iter.next();
          if (done) break;
          this.#arr.push(value);
          if (this.#arr[newIndex]) {
            this.#index = newIndex;
            return this.#f(this.#arr[newIndex]);
          }
        }
      }
      find(f3) {
        const index = this.#arr.findIndex((x3) => f3(x3));
        if (index > -1) {
          this.#index = index;
          return this.#f(this.#arr[index]);
        }
        while (true) {
          const { done, value } = this.#iter.next();
          if (done) break;
          this.#arr.push(value);
          if (f3(value)) {
            this.#index = this.#arr.length - 1;
            return this.#f(value);
          }
        }
      }
    };
    TTS = class {
      #list;
      #ranges;
      #lastMark;
      #serializer = new XMLSerializer();
      constructor(doc, textWalker2, highlight, granularity) {
        this.doc = doc;
        this.highlight = highlight;
        this.#list = new ListIterator(getBlocks(doc), (range) => {
          const { entries, ssml } = getFragmentWithMarks(range, textWalker2, granularity);
          this.#ranges = new Map(entries);
          return [ssml, range];
        });
      }
      #getMarkElement(doc, mark) {
        if (!mark) return null;
        return doc.querySelector(`mark[name="${CSS.escape(mark)}"`);
      }
      #speak(doc, getNode) {
        if (!doc) return;
        if (!getNode) return this.#serializer.serializeToString(doc);
        const ssml = document.implementation.createDocument(NS3.SSML, "speak");
        ssml.documentElement.replaceWith(ssml.importNode(doc.documentElement, true));
        let node = getNode(ssml)?.previousSibling;
        while (node) {
          const next = node.previousSibling ?? node.parentNode?.previousSibling;
          node.parentNode.removeChild(node);
          node = next;
        }
        return this.#serializer.serializeToString(ssml);
      }
      start() {
        this.#lastMark = null;
        const [doc] = this.#list.first() ?? [];
        if (!doc) return this.next();
        return this.#speak(doc, (ssml) => this.#getMarkElement(ssml, this.#lastMark));
      }
      resume() {
        const [doc] = this.#list.current() ?? [];
        if (!doc) return this.next();
        return this.#speak(doc, (ssml) => this.#getMarkElement(ssml, this.#lastMark));
      }
      prev(paused) {
        this.#lastMark = null;
        const [doc, range] = this.#list.prev() ?? [];
        if (paused && range) this.highlight(range.cloneRange());
        return this.#speak(doc);
      }
      next(paused) {
        this.#lastMark = null;
        const [doc, range] = this.#list.next() ?? [];
        if (paused && range) this.highlight(range.cloneRange());
        return this.#speak(doc);
      }
      from(range) {
        this.#lastMark = null;
        const [doc] = this.#list.find((range_) => range.compareBoundaryPoints(Range.END_TO_START, range_) <= 0);
        let mark;
        for (const [name, range_] of this.#ranges.entries())
          if (range.compareBoundaryPoints(Range.START_TO_START, range_) <= 0) {
            mark = name;
            break;
          }
        return this.#speak(doc, (ssml) => this.#getMarkElement(ssml, mark));
      }
      setMark(mark) {
        const range = this.#ranges.get(mark);
        if (range) {
          this.#lastMark = mark;
          this.highlight(range.cloneRange());
        }
      }
    };
  }
});

// node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/view.js
var view_exports = {};
__export(view_exports, {
  NotFoundError: () => NotFoundError,
  ResponseError: () => ResponseError,
  UnsupportedTypeError: () => UnsupportedTypeError,
  View: () => View2,
  makeBook: () => makeBook
});
var SEARCH_PREFIX, isZip, isCBZ, isFB2, isFBZ, makeZipLoader, getFileEntries, makeDirectoryLoader, ResponseError, NotFoundError, UnsupportedTypeError, fetchFile, makeBook, CursorAutohider, History, languageInfo, View2;
var init_view = __esm({
  "node_modules/.pnpm/foliate-js@1.0.1_patch_hash=518859ab3100a602b45969098042d3dfb0fdba2d31522003837fc698d0381610/node_modules/foliate-js/view.js"() {
    init_epubcfi();
    init_progress();
    init_overlayer();
    init_text_walker();
    SEARCH_PREFIX = "foliate-search:";
    isZip = async (file) => {
      const arr = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      return arr[0] === 80 && arr[1] === 75 && arr[2] === 3 && arr[3] === 4;
    };
    isCBZ = ({ name, type }) => type === "application/vnd.comicbook+zip" || name.endsWith(".cbz");
    isFB2 = ({ name, type }) => type === "application/x-fictionbook+xml" || name.endsWith(".fb2");
    isFBZ = ({ name, type }) => type === "application/x-zip-compressed-fb2" || name.endsWith(".fb2.zip") || name.endsWith(".fbz");
    makeZipLoader = async (file) => {
      const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await Promise.resolve().then(() => (init_zip(), zip_exports));
      configure({ useWebWorkers: false });
      const reader = new ZipReader(new BlobReader(file));
      const entries = await reader.getEntries();
      const map = new Map(entries.map((entry) => [entry.filename, entry]));
      const load = (f3) => (name, ...args) => map.has(name) ? f3(map.get(name), ...args) : null;
      const loadText = load((entry) => entry.getData(new TextWriter()));
      const loadBlob = load((entry, type) => entry.getData(new BlobWriter(type)));
      const getSize = (name) => map.get(name)?.uncompressedSize ?? 0;
      return { entries, loadText, loadBlob, getSize };
    };
    getFileEntries = async (entry) => entry.isFile ? entry : (await Promise.all(Array.from(
      await new Promise((resolve, reject) => entry.createReader().readEntries((entries) => resolve(entries), (error) => reject(error))),
      getFileEntries
    ))).flat();
    makeDirectoryLoader = async (entry) => {
      const entries = await getFileEntries(entry);
      const files = await Promise.all(
        entries.map((entry2) => new Promise((resolve, reject) => entry2.file(
          (file) => resolve([file, entry2.fullPath]),
          (error) => reject(error)
        )))
      );
      const map = new Map(files.map(([file, path]) => [path.replace(entry.fullPath + "/", ""), file]));
      const decoder3 = new TextDecoder();
      const decode = (x3) => x3 ? decoder3.decode(x3) : null;
      const getBuffer = (name) => map.get(name)?.arrayBuffer() ?? null;
      const loadText = async (name) => decode(await getBuffer(name));
      const loadBlob = (name) => map.get(name);
      const getSize = (name) => map.get(name)?.size ?? 0;
      return { loadText, loadBlob, getSize };
    };
    ResponseError = class extends Error {
    };
    NotFoundError = class extends Error {
    };
    UnsupportedTypeError = class extends Error {
    };
    fetchFile = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new ResponseError(
        `${res.status} ${res.statusText}`,
        { cause: res }
      );
      return new File([await res.blob()], new URL(res.url).pathname);
    };
    makeBook = async (file) => {
      if (typeof file === "string") file = await fetchFile(file);
      let book;
      if (file.isDirectory) {
        const loader = await makeDirectoryLoader(file);
        const { EPUB: EPUB2 } = await Promise.resolve().then(() => (init_epub(), epub_exports));
        book = await new EPUB2(loader).init();
      } else if (!file.size) throw new NotFoundError("File not found");
      else if (await isZip(file)) {
        const loader = await makeZipLoader(file);
        if (isCBZ(file)) {
          const { makeComicBook: makeComicBook2 } = await Promise.resolve().then(() => (init_comic_book(), comic_book_exports));
          book = makeComicBook2(loader, file);
        } else if (isFBZ(file)) {
          const { makeFB2: makeFB22 } = await Promise.resolve().then(() => (init_fb2(), fb2_exports));
          const { entries } = loader;
          const entry = entries.find((entry2) => entry2.filename.endsWith(".fb2"));
          const blob = await loader.loadBlob((entry ?? entries[0]).filename);
          book = await makeFB22(blob);
        } else {
          const { EPUB: EPUB2 } = await Promise.resolve().then(() => (init_epub(), epub_exports));
          book = await new EPUB2(loader).init();
        }
      } else {
        const { isMOBI: isMOBI2, MOBI: MOBI2 } = await Promise.resolve().then(() => (init_mobi(), mobi_exports));
        if (await isMOBI2(file)) {
          const fflate = await Promise.resolve().then(() => (init_fflate(), fflate_exports));
          book = await new MOBI2({ unzlib: fflate.unzlibSync }).open(file);
        } else if (isFB2(file)) {
          const { makeFB2: makeFB22 } = await Promise.resolve().then(() => (init_fb2(), fb2_exports));
          book = await makeFB22(file);
        }
      }
      if (!book) throw new UnsupportedTypeError("File type not supported");
      return book;
    };
    CursorAutohider = class _CursorAutohider {
      #timeout;
      #el;
      #check;
      #state;
      constructor(el, check, state = {}) {
        this.#el = el;
        this.#check = check;
        this.#state = state;
        if (this.#state.hidden) this.hide();
        this.#el.addEventListener("mousemove", ({ screenX, screenY }) => {
          if (screenX === this.#state.x && screenY === this.#state.y) return;
          this.#state.x = screenX, this.#state.y = screenY;
          this.show();
          if (this.#timeout) clearTimeout(this.#timeout);
          if (check()) this.#timeout = setTimeout(this.hide.bind(this), 1e3);
        }, false);
      }
      cloneFor(el) {
        return new _CursorAutohider(el, this.#check, this.#state);
      }
      hide() {
        this.#el.style.cursor = "none";
        this.#state.hidden = true;
      }
      show() {
        this.#el.style.removeProperty("cursor");
        this.#state.hidden = false;
      }
    };
    History = class extends EventTarget {
      #arr = [];
      #index = -1;
      pushState(x3) {
        const last = this.#arr[this.#index];
        if (last === x3 || last?.fraction && last.fraction === x3.fraction) return;
        this.#arr[++this.#index] = x3;
        this.#arr.length = this.#index + 1;
        this.dispatchEvent(new Event("index-change"));
      }
      replaceState(x3) {
        const index = this.#index;
        this.#arr[index] = x3;
      }
      back() {
        const index = this.#index;
        if (index <= 0) return;
        const detail = { state: this.#arr[index - 1] };
        this.#index = index - 1;
        this.dispatchEvent(new CustomEvent("popstate", { detail }));
        this.dispatchEvent(new Event("index-change"));
      }
      forward() {
        const index = this.#index;
        if (index >= this.#arr.length - 1) return;
        const detail = { state: this.#arr[index + 1] };
        this.#index = index + 1;
        this.dispatchEvent(new CustomEvent("popstate", { detail }));
        this.dispatchEvent(new Event("index-change"));
      }
      get canGoBack() {
        return this.#index > 0;
      }
      get canGoForward() {
        return this.#index < this.#arr.length - 1;
      }
      clear() {
        this.#arr = [];
        this.#index = -1;
      }
    };
    languageInfo = (lang) => {
      if (!lang) return {};
      try {
        const canonical = Intl.getCanonicalLocales(lang)[0];
        const locale = new Intl.Locale(canonical);
        const isCJK = ["zh", "ja", "kr"].includes(locale.language);
        const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction;
        return { canonical, locale, isCJK, direction };
      } catch (e3) {
        console.warn(e3);
        return {};
      }
    };
    View2 = class extends HTMLElement {
      #root = this.attachShadow({ mode: "closed" });
      #sectionProgress;
      #tocProgress;
      #pageProgress;
      #searchResults = /* @__PURE__ */ new Map();
      #cursorAutohider = new CursorAutohider(this, () => this.hasAttribute("autohide-cursor"));
      isFixedLayout = false;
      lastLocation;
      history = new History();
      constructor() {
        super();
        this.history.addEventListener("popstate", ({ detail }) => {
          const resolved = this.resolveNavigation(detail.state);
          this.renderer.goTo(resolved);
        });
      }
      async open(book) {
        if (typeof book === "string" || typeof book.arrayBuffer === "function" || book.isDirectory) book = await makeBook(book);
        this.book = book;
        this.language = languageInfo(book.metadata?.language);
        if (book.splitTOCHref && book.getTOCFragment) {
          const ids = book.sections.map((s3) => s3.id);
          this.#sectionProgress = new SectionProgress(book.sections, 1500, 1600);
          const splitHref = book.splitTOCHref.bind(book);
          const getFragment = book.getTOCFragment.bind(book);
          this.#tocProgress = new TOCProgress();
          await this.#tocProgress.init({
            toc: book.toc ?? [],
            ids,
            splitHref,
            getFragment
          });
          this.#pageProgress = new TOCProgress();
          await this.#pageProgress.init({
            toc: book.pageList ?? [],
            ids,
            splitHref,
            getFragment
          });
        }
        this.isFixedLayout = this.book.rendition?.layout === "pre-paginated";
        if (this.isFixedLayout) {
          await Promise.resolve().then(() => (init_fixed_layout(), fixed_layout_exports));
          this.renderer = document.createElement("foliate-fxl");
        } else {
          await Promise.resolve().then(() => (init_paginator(), paginator_exports));
          this.renderer = document.createElement("foliate-paginator");
        }
        this.renderer.setAttribute("exportparts", "head,foot,filter,container");
        const initialFlow = this.getAttribute("data-ez-reader-flow");
        if (initialFlow === "paginated" || initialFlow === "scrolled")
          this.renderer.setAttribute("flow", initialFlow);
        this.renderer.addEventListener("load", (e3) => this.#onLoad(e3.detail));
        this.renderer.addEventListener("relocate", (e3) => this.#onRelocate(e3.detail));
        this.renderer.addEventListener("create-overlayer", (e3) => e3.detail.attach(this.#createOverlayer(e3.detail)));
        this.renderer.open(book);
        this.#root.append(this.renderer);
        if (book.sections.some((section) => section.mediaOverlay)) {
          const activeClass = book.media.activeClass;
          const playbackActiveClass = book.media.playbackActiveClass;
          this.mediaOverlay = book.getMediaOverlay();
          let lastActive;
          this.mediaOverlay.addEventListener("highlight", (e3) => {
            const resolved = this.resolveNavigation(e3.detail.text);
            this.renderer.goTo(resolved).then(() => {
              const { doc } = this.renderer.getContents().find((x3) => x3.index = resolved.index);
              const el = resolved.anchor(doc);
              el.classList.add(activeClass);
              if (playbackActiveClass) el.ownerDocument.documentElement.classList.add(playbackActiveClass);
              lastActive = new WeakRef(el);
            });
          });
          this.mediaOverlay.addEventListener("unhighlight", () => {
            const el = lastActive?.deref();
            if (el) {
              el.classList.remove(activeClass);
              if (playbackActiveClass) el.ownerDocument.documentElement.classList.remove(playbackActiveClass);
            }
          });
        }
      }
      close() {
        this.renderer?.destroy();
        this.renderer?.remove();
        this.#sectionProgress = null;
        this.#tocProgress = null;
        this.#pageProgress = null;
        this.#searchResults = /* @__PURE__ */ new Map();
        this.lastLocation = null;
        this.history.clear();
        this.tts = null;
        this.mediaOverlay = null;
      }
      goToTextStart() {
        return this.goTo(this.book.landmarks?.find((m3) => m3.type.includes("bodymatter") || m3.type.includes("text"))?.href ?? this.book.sections.findIndex((s3) => s3.linear !== "no"));
      }
      async init({ lastLocation, showTextStart }) {
        const resolved = lastLocation ? this.resolveNavigation(lastLocation) : null;
        if (resolved) {
          await this.renderer.goTo(resolved);
          this.history.pushState(lastLocation);
        } else if (showTextStart) await this.goToTextStart();
        else {
          this.history.pushState(0);
          await this.next();
        }
      }
      #emit(name, detail, cancelable) {
        return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }));
      }
      #onRelocate({ reason, range, index, fraction, size }) {
        const progress = this.#sectionProgress?.getProgress(index, fraction, size) ?? {};
        const tocItem = this.#tocProgress?.getProgress(index, range);
        const pageItem = this.#pageProgress?.getProgress(index, range);
        const cfi = this.getCFI(index, range);
        this.lastLocation = { ...progress, tocItem, pageItem, cfi, range };
        if (reason === "snap" || reason === "page" || reason === "scroll")
          this.history.replaceState(cfi);
        this.#emit("relocate", this.lastLocation);
      }
      #onLoad({ doc, index }) {
        doc.documentElement.lang ||= this.language.canonical ?? "";
        if (!this.language.isCJK)
          doc.documentElement.dir ||= this.language.direction ?? "";
        this.#handleLinks(doc, index);
        this.#cursorAutohider.cloneFor(doc.documentElement);
        this.#emit("load", { doc, index });
      }
      #handleLinks(doc, index) {
        const { book } = this;
        const section = book.sections[index];
        doc.addEventListener("click", (e3) => {
          const a3 = e3.target.closest("a[href]");
          if (!a3) return;
          e3.preventDefault();
          const href_ = a3.getAttribute("href");
          const href = section?.resolveHref?.(href_) ?? href_;
          if (book?.isExternal?.(href))
            Promise.resolve(this.#emit("external-link", { a: a3, href }, true)).then((x3) => x3 ? globalThis.open(href, "_blank") : null).catch((e4) => console.error(e4));
          else Promise.resolve(this.#emit("link", { a: a3, href }, true)).then((x3) => x3 ? this.goTo(href) : null).catch((e4) => console.error(e4));
        });
      }
      async addAnnotation(annotation, remove) {
        const { value } = annotation;
        if (value.startsWith(SEARCH_PREFIX)) {
          const cfi = value.replace(SEARCH_PREFIX, "");
          const { index: index2, anchor: anchor2 } = await this.resolveNavigation(cfi);
          const obj2 = this.#getOverlayer(index2);
          if (obj2) {
            const { overlayer, doc } = obj2;
            if (remove) {
              overlayer.remove(value);
              return;
            }
            const range = doc ? anchor2(doc) : anchor2;
            overlayer.add(value, range, Overlayer.outline);
          }
          return;
        }
        const { index, anchor } = await this.resolveNavigation(value);
        const obj = this.#getOverlayer(index);
        if (obj) {
          const { overlayer, doc } = obj;
          overlayer.remove(value);
          if (!remove) {
            const range = doc ? anchor(doc) : anchor;
            const draw = (func, opts) => overlayer.add(value, range, func, opts);
            this.#emit("draw-annotation", { draw, annotation, doc, range });
          }
        }
        const label = this.#tocProgress.getProgress(index)?.label ?? "";
        return { index, label };
      }
      deleteAnnotation(annotation) {
        return this.addAnnotation(annotation, true);
      }
      #getOverlayer(index) {
        return this.renderer.getContents().find((x3) => x3.index === index && x3.overlayer);
      }
      #createOverlayer({ doc, index }) {
        const overlayer = new Overlayer(doc);
        doc.addEventListener("click", (e3) => {
          const [value, range] = overlayer.hitTest(e3);
          if (value && !value.startsWith(SEARCH_PREFIX)) {
            this.#emit("show-annotation", { value, index, range });
          }
        }, false);
        const list = this.#searchResults.get(index);
        if (list) for (const item of list) this.addAnnotation(item);
        this.#emit("create-overlay", { index });
        return overlayer;
      }
      async showAnnotation(annotation) {
        const { value } = annotation;
        const resolved = await this.goTo(value);
        if (resolved) {
          const { index, anchor } = resolved;
          const { doc } = this.#getOverlayer(index);
          const range = anchor(doc);
          this.#emit("show-annotation", { value, index, range });
        }
      }
      getCFI(index, range) {
        const baseCFI = this.book.sections[index].cfi ?? fake.fromIndex(index);
        if (!range) return baseCFI;
        return joinIndir(baseCFI, fromRange(range));
      }
      resolveCFI(cfi) {
        if (this.book.resolveCFI)
          return this.book.resolveCFI(cfi);
        else {
          const parts = parse(cfi);
          const index = fake.toIndex((parts.parent ?? parts).shift());
          const anchor = (doc) => toRange(doc, parts);
          return { index, anchor };
        }
      }
      resolveNavigation(target) {
        try {
          if (typeof target === "number") return { index: target };
          if (typeof target.fraction === "number") {
            const [index, anchor] = this.#sectionProgress.getSection(target.fraction);
            return { index, anchor };
          }
          if (isCFI.test(target)) return this.resolveCFI(target);
          return this.book.resolveHref(target);
        } catch (e3) {
          console.error(e3);
          console.error(`Could not resolve target ${target}`);
        }
      }
      async goTo(target) {
        const resolved = this.resolveNavigation(target);
        try {
          await this.renderer.goTo(resolved);
          this.history.pushState(target);
          return resolved;
        } catch (e3) {
          console.error(e3);
          console.error(`Could not go to ${target}`);
        }
      }
      async goToFraction(frac) {
        const [index, anchor] = this.#sectionProgress.getSection(frac);
        await this.renderer.goTo({ index, anchor });
        this.history.pushState({ fraction: frac });
      }
      async select(target) {
        try {
          const obj = await this.resolveNavigation(target);
          await this.renderer.goTo({ ...obj, select: true });
          this.history.pushState(target);
        } catch (e3) {
          console.error(e3);
          console.error(`Could not go to ${target}`);
        }
      }
      deselect() {
        for (const { doc } of this.renderer.getContents())
          doc.defaultView.getSelection().removeAllRanges();
      }
      getSectionFractions() {
        return (this.#sectionProgress?.sectionFractions ?? []).map((x3) => x3 + Number.EPSILON);
      }
      getProgressOf(index, range) {
        const tocItem = this.#tocProgress?.getProgress(index, range);
        const pageItem = this.#pageProgress?.getProgress(index, range);
        return { tocItem, pageItem };
      }
      async getTOCItemOf(target) {
        try {
          const { index, anchor } = await this.resolveNavigation(target);
          const doc = await this.book.sections[index].createDocument();
          const frag = anchor(doc);
          const isRange = frag instanceof Range;
          const range = isRange ? frag : doc.createRange();
          if (!isRange) range.selectNodeContents(frag);
          return this.#tocProgress.getProgress(index, range);
        } catch (e3) {
          console.error(e3);
          console.error(`Could not get ${target}`);
        }
      }
      async prev(distance) {
        await this.renderer.prev(distance);
      }
      async next(distance) {
        await this.renderer.next(distance);
      }
      goLeft() {
        return this.book.dir === "rtl" ? this.next() : this.prev();
      }
      goRight() {
        return this.book.dir === "rtl" ? this.prev() : this.next();
      }
      async *#searchSection(matcher, query, index) {
        const doc = await this.book.sections[index].createDocument();
        for (const { range, excerpt } of matcher(doc, query))
          yield { cfi: this.getCFI(index, range), excerpt };
      }
      async *#searchBook(matcher, query) {
        const { sections } = this.book;
        for (const [index, { createDocument }] of sections.entries()) {
          if (!createDocument) continue;
          const doc = await createDocument();
          const subitems = Array.from(matcher(doc, query), ({ range, excerpt }) => ({ cfi: this.getCFI(index, range), excerpt }));
          const progress = (index + 1) / sections.length;
          yield { progress };
          if (subitems.length) yield { index, subitems };
        }
      }
      async *search(opts) {
        this.clearSearch();
        const { searchMatcher: searchMatcher2 } = await Promise.resolve().then(() => (init_search(), search_exports));
        const { query, index } = opts;
        const matcher = searchMatcher2(
          textWalker,
          { defaultLocale: this.language, ...opts }
        );
        const iter = index != null ? this.#searchSection(matcher, query, index) : this.#searchBook(matcher, query);
        const list = [];
        this.#searchResults.set(index, list);
        for await (const result of iter) {
          if (result.subitems) {
            const list2 = result.subitems.map(({ cfi }) => ({ value: SEARCH_PREFIX + cfi }));
            this.#searchResults.set(result.index, list2);
            for (const item of list2) this.addAnnotation(item);
            yield {
              label: this.#tocProgress.getProgress(result.index)?.label ?? "",
              subitems: result.subitems
            };
          } else {
            if (result.cfi) {
              const item = { value: SEARCH_PREFIX + result.cfi };
              list.push(item);
              this.addAnnotation(item);
            }
            yield result;
          }
        }
        yield "done";
      }
      clearSearch() {
        for (const list of this.#searchResults.values())
          for (const item of list) this.deleteAnnotation(item);
        this.#searchResults.clear();
      }
      async initTTS(granularity = "word") {
        const doc = this.renderer.getContents()[0].doc;
        if (this.tts && this.tts.doc === doc) return;
        const { TTS: TTS2 } = await Promise.resolve().then(() => (init_tts(), tts_exports));
        this.tts = new TTS2(doc, textWalker, (range) => this.renderer.scrollToAnchor(range, true), granularity);
      }
      startMediaOverlay() {
        const { index } = this.renderer.getContents()[0];
        return this.mediaOverlay.start(index);
      }
    };
    if (!customElements.get("foliate-view"))
      customElements.define("foliate-view", View2);
  }
});

// node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js
function unzlibSync(data, opts) {
  return inflt(data.subarray(zls(data, opts && opts.dictionary), -4), { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var u8, u16, i32, fleb, fdeb, clim, freb, _a, fl, revfl, _b, fd, revfd, rev, x3, i3, hMap, flt, i3, i3, i3, i3, fdt, i3, flrm, fdrm, max, bits, bits16, shft, slc, ec, err, inflt, et2, zls, td, tds;
var init_browser = __esm({
  "node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js"() {
    u8 = Uint8Array;
    u16 = Uint16Array;
    i32 = Int32Array;
    fleb = new u8([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      2,
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      4,
      4,
      4,
      4,
      5,
      5,
      5,
      5,
      0,
      /* unused */
      0,
      0,
      /* impossible */
      0
    ]);
    fdeb = new u8([
      0,
      0,
      0,
      0,
      1,
      1,
      2,
      2,
      3,
      3,
      4,
      4,
      5,
      5,
      6,
      6,
      7,
      7,
      8,
      8,
      9,
      9,
      10,
      10,
      11,
      11,
      12,
      12,
      13,
      13,
      /* unused */
      0,
      0
    ]);
    clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
    freb = function(eb, start) {
      var b3 = new u16(31);
      for (var i3 = 0; i3 < 31; ++i3) {
        b3[i3] = start += 1 << eb[i3 - 1];
      }
      var r3 = new i32(b3[30]);
      for (var i3 = 1; i3 < 30; ++i3) {
        for (var j2 = b3[i3]; j2 < b3[i3 + 1]; ++j2) {
          r3[j2] = j2 - b3[i3] << 5 | i3;
        }
      }
      return { b: b3, r: r3 };
    };
    _a = freb(fleb, 2);
    fl = _a.b;
    revfl = _a.r;
    fl[28] = 258, revfl[258] = 28;
    _b = freb(fdeb, 0);
    fd = _b.b;
    revfd = _b.r;
    rev = new u16(32768);
    for (i3 = 0; i3 < 32768; ++i3) {
      x3 = (i3 & 43690) >> 1 | (i3 & 21845) << 1;
      x3 = (x3 & 52428) >> 2 | (x3 & 13107) << 2;
      x3 = (x3 & 61680) >> 4 | (x3 & 3855) << 4;
      rev[i3] = ((x3 & 65280) >> 8 | (x3 & 255) << 8) >> 1;
    }
    hMap = (function(cd, mb, r3) {
      var s3 = cd.length;
      var i3 = 0;
      var l3 = new u16(mb);
      for (; i3 < s3; ++i3) {
        if (cd[i3])
          ++l3[cd[i3] - 1];
      }
      var le2 = new u16(mb);
      for (i3 = 1; i3 < mb; ++i3) {
        le2[i3] = le2[i3 - 1] + l3[i3 - 1] << 1;
      }
      var co;
      if (r3) {
        co = new u16(1 << mb);
        var rvb = 15 - mb;
        for (i3 = 0; i3 < s3; ++i3) {
          if (cd[i3]) {
            var sv = i3 << 4 | cd[i3];
            var r_1 = mb - cd[i3];
            var v3 = le2[cd[i3] - 1]++ << r_1;
            for (var m3 = v3 | (1 << r_1) - 1; v3 <= m3; ++v3) {
              co[rev[v3] >> rvb] = sv;
            }
          }
        }
      } else {
        co = new u16(s3);
        for (i3 = 0; i3 < s3; ++i3) {
          if (cd[i3]) {
            co[i3] = rev[le2[cd[i3] - 1]++] >> 15 - cd[i3];
          }
        }
      }
      return co;
    });
    flt = new u8(288);
    for (i3 = 0; i3 < 144; ++i3)
      flt[i3] = 8;
    for (i3 = 144; i3 < 256; ++i3)
      flt[i3] = 9;
    for (i3 = 256; i3 < 280; ++i3)
      flt[i3] = 7;
    for (i3 = 280; i3 < 288; ++i3)
      flt[i3] = 8;
    fdt = new u8(32);
    for (i3 = 0; i3 < 32; ++i3)
      fdt[i3] = 5;
    flrm = /* @__PURE__ */ hMap(flt, 9, 1);
    fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
    max = function(a3) {
      var m3 = a3[0];
      for (var i3 = 1; i3 < a3.length; ++i3) {
        if (a3[i3] > m3)
          m3 = a3[i3];
      }
      return m3;
    };
    bits = function(d2, p3, m3) {
      var o3 = p3 / 8 | 0;
      return (d2[o3] | d2[o3 + 1] << 8) >> (p3 & 7) & m3;
    };
    bits16 = function(d2, p3) {
      var o3 = p3 / 8 | 0;
      return (d2[o3] | d2[o3 + 1] << 8 | d2[o3 + 2] << 16) >> (p3 & 7);
    };
    shft = function(p3) {
      return (p3 + 7) / 8 | 0;
    };
    slc = function(v3, s3, e3) {
      if (s3 == null || s3 < 0)
        s3 = 0;
      if (e3 == null || e3 > v3.length)
        e3 = v3.length;
      return new u8(v3.subarray(s3, e3));
    };
    ec = [
      "unexpected EOF",
      "invalid block type",
      "invalid length/literal",
      "invalid distance",
      "stream finished",
      "no stream handler",
      ,
      // determined by compression function
      "no callback",
      "invalid UTF-8 data",
      "extra field too long",
      "date not in range 1980-2099",
      "filename too long",
      "stream finishing",
      "invalid zip data"
      // determined by unknown compression method
    ];
    err = function(ind, msg, nt2) {
      var e3 = new Error(msg || ec[ind]);
      e3.code = ind;
      if (Error.captureStackTrace)
        Error.captureStackTrace(e3, err);
      if (!nt2)
        throw e3;
      return e3;
    };
    inflt = function(dat, st2, buf, dict) {
      var sl = dat.length, dl = dict ? dict.length : 0;
      if (!sl || st2.f && !st2.l)
        return buf || new u8(0);
      var noBuf = !buf;
      var resize = noBuf || st2.i != 2;
      var noSt = st2.i;
      if (noBuf)
        buf = new u8(sl * 3);
      var cbuf = function(l4) {
        var bl = buf.length;
        if (l4 > bl) {
          var nbuf = new u8(Math.max(bl * 2, l4));
          nbuf.set(buf);
          buf = nbuf;
        }
      };
      var final = st2.f || 0, pos = st2.p || 0, bt2 = st2.b || 0, lm = st2.l, dm = st2.d, lbt = st2.m, dbt = st2.n;
      var tbts = sl * 8;
      do {
        if (!lm) {
          final = bits(dat, pos, 1);
          var type = bits(dat, pos + 1, 3);
          pos += 3;
          if (!type) {
            var s3 = shft(pos) + 4, l3 = dat[s3 - 4] | dat[s3 - 3] << 8, t3 = s3 + l3;
            if (t3 > sl) {
              if (noSt)
                err(0);
              break;
            }
            if (resize)
              cbuf(bt2 + l3);
            buf.set(dat.subarray(s3, t3), bt2);
            st2.b = bt2 += l3, st2.p = pos = t3 * 8, st2.f = final;
            continue;
          } else if (type == 1)
            lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
          else if (type == 2) {
            var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
            var tl = hLit + bits(dat, pos + 5, 31) + 1;
            pos += 14;
            var ldt = new u8(tl);
            var clt = new u8(19);
            for (var i3 = 0; i3 < hcLen; ++i3) {
              clt[clim[i3]] = bits(dat, pos + i3 * 3, 7);
            }
            pos += hcLen * 3;
            var clb = max(clt), clbmsk = (1 << clb) - 1;
            var clm = hMap(clt, clb, 1);
            for (var i3 = 0; i3 < tl; ) {
              var r3 = clm[bits(dat, pos, clbmsk)];
              pos += r3 & 15;
              var s3 = r3 >> 4;
              if (s3 < 16) {
                ldt[i3++] = s3;
              } else {
                var c2 = 0, n3 = 0;
                if (s3 == 16)
                  n3 = 3 + bits(dat, pos, 3), pos += 2, c2 = ldt[i3 - 1];
                else if (s3 == 17)
                  n3 = 3 + bits(dat, pos, 7), pos += 3;
                else if (s3 == 18)
                  n3 = 11 + bits(dat, pos, 127), pos += 7;
                while (n3--)
                  ldt[i3++] = c2;
              }
            }
            var lt2 = ldt.subarray(0, hLit), dt2 = ldt.subarray(hLit);
            lbt = max(lt2);
            dbt = max(dt2);
            lm = hMap(lt2, lbt, 1);
            dm = hMap(dt2, dbt, 1);
          } else
            err(1);
          if (pos > tbts) {
            if (noSt)
              err(0);
            break;
          }
        }
        if (resize)
          cbuf(bt2 + 131072);
        var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
        var lpos = pos;
        for (; ; lpos = pos) {
          var c2 = lm[bits16(dat, pos) & lms], sym = c2 >> 4;
          pos += c2 & 15;
          if (pos > tbts) {
            if (noSt)
              err(0);
            break;
          }
          if (!c2)
            err(2);
          if (sym < 256)
            buf[bt2++] = sym;
          else if (sym == 256) {
            lpos = pos, lm = null;
            break;
          } else {
            var add = sym - 254;
            if (sym > 264) {
              var i3 = sym - 257, b3 = fleb[i3];
              add = bits(dat, pos, (1 << b3) - 1) + fl[i3];
              pos += b3;
            }
            var d2 = dm[bits16(dat, pos) & dms], dsym = d2 >> 4;
            if (!d2)
              err(3);
            pos += d2 & 15;
            var dt2 = fd[dsym];
            if (dsym > 3) {
              var b3 = fdeb[dsym];
              dt2 += bits16(dat, pos) & (1 << b3) - 1, pos += b3;
            }
            if (pos > tbts) {
              if (noSt)
                err(0);
              break;
            }
            if (resize)
              cbuf(bt2 + 131072);
            var end = bt2 + add;
            if (bt2 < dt2) {
              var shift = dl - dt2, dend = Math.min(dt2, end);
              if (shift + bt2 < 0)
                err(3);
              for (; bt2 < dend; ++bt2)
                buf[bt2] = dict[shift + bt2];
            }
            for (; bt2 < end; ++bt2)
              buf[bt2] = buf[bt2 - dt2];
          }
        }
        st2.l = lm, st2.p = lpos, st2.b = bt2, st2.f = final;
        if (lm)
          final = 1, st2.m = lbt, st2.d = dm, st2.n = dbt;
      } while (!final);
      return bt2 != buf.length && noBuf ? slc(buf, 0, bt2) : buf.subarray(0, bt2);
    };
    et2 = /* @__PURE__ */ new u8(0);
    zls = function(d2, dict) {
      if ((d2[0] & 15) != 8 || d2[0] >> 4 > 7 || (d2[0] << 8 | d2[1]) % 31)
        err(6, "invalid zlib data");
      if ((d2[1] >> 5 & 1) == +!dict)
        err(6, "invalid zlib data: " + (d2[1] & 32 ? "need" : "unexpected") + " dictionary");
      return (d2[1] >> 3 & 4) + 2;
    };
    td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
    tds = 0;
    try {
      td.decode(et2, { stream: true });
      tds = 1;
    } catch (e3) {
    }
  }
});

// node_modules/.pnpm/path-browserify@1.0.1/node_modules/path-browserify/index.js
var require_path_browserify = __commonJS({
  "node_modules/.pnpm/path-browserify@1.0.1/node_modules/path-browserify/index.js"(exports, module2) {
    "use strict";
    function assertPath(path) {
      if (typeof path !== "string") {
        throw new TypeError("Path must be a string. Received " + JSON.stringify(path));
      }
    }
    function normalizeStringPosix(path, allowAboveRoot) {
      var res = "";
      var lastSegmentLength = 0;
      var lastSlash = -1;
      var dots = 0;
      var code;
      for (var i3 = 0; i3 <= path.length; ++i3) {
        if (i3 < path.length)
          code = path.charCodeAt(i3);
        else if (code === 47)
          break;
        else
          code = 47;
        if (code === 47) {
          if (lastSlash === i3 - 1 || dots === 1) {
          } else if (lastSlash !== i3 - 1 && dots === 2) {
            if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
              if (res.length > 2) {
                var lastSlashIndex = res.lastIndexOf("/");
                if (lastSlashIndex !== res.length - 1) {
                  if (lastSlashIndex === -1) {
                    res = "";
                    lastSegmentLength = 0;
                  } else {
                    res = res.slice(0, lastSlashIndex);
                    lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
                  }
                  lastSlash = i3;
                  dots = 0;
                  continue;
                }
              } else if (res.length === 2 || res.length === 1) {
                res = "";
                lastSegmentLength = 0;
                lastSlash = i3;
                dots = 0;
                continue;
              }
            }
            if (allowAboveRoot) {
              if (res.length > 0)
                res += "/..";
              else
                res = "..";
              lastSegmentLength = 2;
            }
          } else {
            if (res.length > 0)
              res += "/" + path.slice(lastSlash + 1, i3);
            else
              res = path.slice(lastSlash + 1, i3);
            lastSegmentLength = i3 - lastSlash - 1;
          }
          lastSlash = i3;
          dots = 0;
        } else if (code === 46 && dots !== -1) {
          ++dots;
        } else {
          dots = -1;
        }
      }
      return res;
    }
    function _format(sep, pathObject) {
      var dir = pathObject.dir || pathObject.root;
      var base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
      if (!dir) {
        return base;
      }
      if (dir === pathObject.root) {
        return dir + base;
      }
      return dir + sep + base;
    }
    var posix = {
      // path.resolve([from ...], to)
      resolve: function resolve() {
        var resolvedPath = "";
        var resolvedAbsolute = false;
        var cwd;
        for (var i3 = arguments.length - 1; i3 >= -1 && !resolvedAbsolute; i3--) {
          var path;
          if (i3 >= 0)
            path = arguments[i3];
          else {
            if (cwd === void 0)
              cwd = process.cwd();
            path = cwd;
          }
          assertPath(path);
          if (path.length === 0) {
            continue;
          }
          resolvedPath = path + "/" + resolvedPath;
          resolvedAbsolute = path.charCodeAt(0) === 47;
        }
        resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
        if (resolvedAbsolute) {
          if (resolvedPath.length > 0)
            return "/" + resolvedPath;
          else
            return "/";
        } else if (resolvedPath.length > 0) {
          return resolvedPath;
        } else {
          return ".";
        }
      },
      normalize: function normalize2(path) {
        assertPath(path);
        if (path.length === 0) return ".";
        var isAbsolute2 = path.charCodeAt(0) === 47;
        var trailingSeparator = path.charCodeAt(path.length - 1) === 47;
        path = normalizeStringPosix(path, !isAbsolute2);
        if (path.length === 0 && !isAbsolute2) path = ".";
        if (path.length > 0 && trailingSeparator) path += "/";
        if (isAbsolute2) return "/" + path;
        return path;
      },
      isAbsolute: function isAbsolute2(path) {
        assertPath(path);
        return path.length > 0 && path.charCodeAt(0) === 47;
      },
      join: function join2() {
        if (arguments.length === 0)
          return ".";
        var joined;
        for (var i3 = 0; i3 < arguments.length; ++i3) {
          var arg = arguments[i3];
          assertPath(arg);
          if (arg.length > 0) {
            if (joined === void 0)
              joined = arg;
            else
              joined += "/" + arg;
          }
        }
        if (joined === void 0)
          return ".";
        return posix.normalize(joined);
      },
      relative: function relative(from, to) {
        assertPath(from);
        assertPath(to);
        if (from === to) return "";
        from = posix.resolve(from);
        to = posix.resolve(to);
        if (from === to) return "";
        var fromStart = 1;
        for (; fromStart < from.length; ++fromStart) {
          if (from.charCodeAt(fromStart) !== 47)
            break;
        }
        var fromEnd = from.length;
        var fromLen = fromEnd - fromStart;
        var toStart = 1;
        for (; toStart < to.length; ++toStart) {
          if (to.charCodeAt(toStart) !== 47)
            break;
        }
        var toEnd = to.length;
        var toLen = toEnd - toStart;
        var length = fromLen < toLen ? fromLen : toLen;
        var lastCommonSep = -1;
        var i3 = 0;
        for (; i3 <= length; ++i3) {
          if (i3 === length) {
            if (toLen > length) {
              if (to.charCodeAt(toStart + i3) === 47) {
                return to.slice(toStart + i3 + 1);
              } else if (i3 === 0) {
                return to.slice(toStart + i3);
              }
            } else if (fromLen > length) {
              if (from.charCodeAt(fromStart + i3) === 47) {
                lastCommonSep = i3;
              } else if (i3 === 0) {
                lastCommonSep = 0;
              }
            }
            break;
          }
          var fromCode = from.charCodeAt(fromStart + i3);
          var toCode = to.charCodeAt(toStart + i3);
          if (fromCode !== toCode)
            break;
          else if (fromCode === 47)
            lastCommonSep = i3;
        }
        var out = "";
        for (i3 = fromStart + lastCommonSep + 1; i3 <= fromEnd; ++i3) {
          if (i3 === fromEnd || from.charCodeAt(i3) === 47) {
            if (out.length === 0)
              out += "..";
            else
              out += "/..";
          }
        }
        if (out.length > 0)
          return out + to.slice(toStart + lastCommonSep);
        else {
          toStart += lastCommonSep;
          if (to.charCodeAt(toStart) === 47)
            ++toStart;
          return to.slice(toStart);
        }
      },
      _makeLong: function _makeLong(path) {
        return path;
      },
      dirname: function dirname(path) {
        assertPath(path);
        if (path.length === 0) return ".";
        var code = path.charCodeAt(0);
        var hasRoot = code === 47;
        var end = -1;
        var matchedSlash = true;
        for (var i3 = path.length - 1; i3 >= 1; --i3) {
          code = path.charCodeAt(i3);
          if (code === 47) {
            if (!matchedSlash) {
              end = i3;
              break;
            }
          } else {
            matchedSlash = false;
          }
        }
        if (end === -1) return hasRoot ? "/" : ".";
        if (hasRoot && end === 1) return "//";
        return path.slice(0, end);
      },
      basename: function basename(path, ext) {
        if (ext !== void 0 && typeof ext !== "string") throw new TypeError('"ext" argument must be a string');
        assertPath(path);
        var start = 0;
        var end = -1;
        var matchedSlash = true;
        var i3;
        if (ext !== void 0 && ext.length > 0 && ext.length <= path.length) {
          if (ext.length === path.length && ext === path) return "";
          var extIdx = ext.length - 1;
          var firstNonSlashEnd = -1;
          for (i3 = path.length - 1; i3 >= 0; --i3) {
            var code = path.charCodeAt(i3);
            if (code === 47) {
              if (!matchedSlash) {
                start = i3 + 1;
                break;
              }
            } else {
              if (firstNonSlashEnd === -1) {
                matchedSlash = false;
                firstNonSlashEnd = i3 + 1;
              }
              if (extIdx >= 0) {
                if (code === ext.charCodeAt(extIdx)) {
                  if (--extIdx === -1) {
                    end = i3;
                  }
                } else {
                  extIdx = -1;
                  end = firstNonSlashEnd;
                }
              }
            }
          }
          if (start === end) end = firstNonSlashEnd;
          else if (end === -1) end = path.length;
          return path.slice(start, end);
        } else {
          for (i3 = path.length - 1; i3 >= 0; --i3) {
            if (path.charCodeAt(i3) === 47) {
              if (!matchedSlash) {
                start = i3 + 1;
                break;
              }
            } else if (end === -1) {
              matchedSlash = false;
              end = i3 + 1;
            }
          }
          if (end === -1) return "";
          return path.slice(start, end);
        }
      },
      extname: function extname(path) {
        assertPath(path);
        var startDot = -1;
        var startPart = 0;
        var end = -1;
        var matchedSlash = true;
        var preDotState = 0;
        for (var i3 = path.length - 1; i3 >= 0; --i3) {
          var code = path.charCodeAt(i3);
          if (code === 47) {
            if (!matchedSlash) {
              startPart = i3 + 1;
              break;
            }
            continue;
          }
          if (end === -1) {
            matchedSlash = false;
            end = i3 + 1;
          }
          if (code === 46) {
            if (startDot === -1)
              startDot = i3;
            else if (preDotState !== 1)
              preDotState = 1;
          } else if (startDot !== -1) {
            preDotState = -1;
          }
        }
        if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
        preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
          return "";
        }
        return path.slice(startDot, end);
      },
      format: function format(pathObject) {
        if (pathObject === null || typeof pathObject !== "object") {
          throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
        }
        return _format("/", pathObject);
      },
      parse: function parse2(path) {
        assertPath(path);
        var ret = { root: "", dir: "", base: "", ext: "", name: "" };
        if (path.length === 0) return ret;
        var code = path.charCodeAt(0);
        var isAbsolute2 = code === 47;
        var start;
        if (isAbsolute2) {
          ret.root = "/";
          start = 1;
        } else {
          start = 0;
        }
        var startDot = -1;
        var startPart = 0;
        var end = -1;
        var matchedSlash = true;
        var i3 = path.length - 1;
        var preDotState = 0;
        for (; i3 >= start; --i3) {
          code = path.charCodeAt(i3);
          if (code === 47) {
            if (!matchedSlash) {
              startPart = i3 + 1;
              break;
            }
            continue;
          }
          if (end === -1) {
            matchedSlash = false;
            end = i3 + 1;
          }
          if (code === 46) {
            if (startDot === -1) startDot = i3;
            else if (preDotState !== 1) preDotState = 1;
          } else if (startDot !== -1) {
            preDotState = -1;
          }
        }
        if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
        preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
          if (end !== -1) {
            if (startPart === 0 && isAbsolute2) ret.base = ret.name = path.slice(1, end);
            else ret.base = ret.name = path.slice(startPart, end);
          }
        } else {
          if (startPart === 0 && isAbsolute2) {
            ret.name = path.slice(1, startDot);
            ret.base = path.slice(1, end);
          } else {
            ret.name = path.slice(startPart, startDot);
            ret.base = path.slice(startPart, end);
          }
          ret.ext = path.slice(startDot, end);
        }
        if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
        else if (isAbsolute2) ret.dir = "/";
        return ret;
      },
      sep: "/",
      delimiter: ":",
      win32: null,
      posix: null
    };
    posix.posix = posix;
    module2.exports = posix;
  }
});

// node_modules/.pnpm/events@3.3.0/node_modules/events/events.js
var require_events = __commonJS({
  "node_modules/.pnpm/events@3.3.0/node_modules/events/events.js"(exports, module2) {
    "use strict";
    var R2 = typeof Reflect === "object" ? Reflect : null;
    var ReflectApply = R2 && typeof R2.apply === "function" ? R2.apply : function ReflectApply2(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    };
    var ReflectOwnKeys;
    if (R2 && typeof R2.ownKeys === "function") {
      ReflectOwnKeys = R2.ownKeys;
    } else if (Object.getOwnPropertySymbols) {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      };
    } else {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target);
      };
    }
    function ProcessEmitWarning(warning) {
      if (console && console.warn) console.warn(warning);
    }
    var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
      return value !== value;
    };
    function EventEmitter2() {
      EventEmitter2.init.call(this);
    }
    module2.exports = EventEmitter2;
    module2.exports.once = once;
    EventEmitter2.EventEmitter = EventEmitter2;
    EventEmitter2.prototype._events = void 0;
    EventEmitter2.prototype._eventsCount = 0;
    EventEmitter2.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener !== "function") {
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
      }
    }
    Object.defineProperty(EventEmitter2, "defaultMaxListeners", {
      enumerable: true,
      get: function() {
        return defaultMaxListeners;
      },
      set: function(arg) {
        if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
          throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
        }
        defaultMaxListeners = arg;
      }
    });
    EventEmitter2.init = function() {
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter2.prototype.setMaxListeners = function setMaxListeners(n3) {
      if (typeof n3 !== "number" || n3 < 0 || NumberIsNaN(n3)) {
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n3 + ".");
      }
      this._maxListeners = n3;
      return this;
    };
    function _getMaxListeners(that) {
      if (that._maxListeners === void 0)
        return EventEmitter2.defaultMaxListeners;
      return that._maxListeners;
    }
    EventEmitter2.prototype.getMaxListeners = function getMaxListeners() {
      return _getMaxListeners(this);
    };
    EventEmitter2.prototype.emit = function emit(type) {
      var args = [];
      for (var i3 = 1; i3 < arguments.length; i3++) args.push(arguments[i3]);
      var doError = type === "error";
      var events = this._events;
      if (events !== void 0)
        doError = doError && events.error === void 0;
      else if (!doError)
        return false;
      if (doError) {
        var er;
        if (args.length > 0)
          er = args[0];
        if (er instanceof Error) {
          throw er;
        }
        var err2 = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
        err2.context = er;
        throw err2;
      }
      var handler = events[type];
      if (handler === void 0)
        return false;
      if (typeof handler === "function") {
        ReflectApply(handler, this, args);
      } else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i3 = 0; i3 < len; ++i3)
          ReflectApply(listeners[i3], this, args);
      }
      return true;
    };
    function _addListener(target, type, listener, prepend) {
      var m3;
      var events;
      var existing;
      checkListener(listener);
      events = target._events;
      if (events === void 0) {
        events = target._events = /* @__PURE__ */ Object.create(null);
        target._eventsCount = 0;
      } else {
        if (events.newListener !== void 0) {
          target.emit(
            "newListener",
            type,
            listener.listener ? listener.listener : listener
          );
          events = target._events;
        }
        existing = events[type];
      }
      if (existing === void 0) {
        existing = events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === "function") {
          existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
        m3 = _getMaxListeners(target);
        if (m3 > 0 && existing.length > m3 && !existing.warned) {
          existing.warned = true;
          var w2 = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w2.name = "MaxListenersExceededWarning";
          w2.emitter = target;
          w2.type = type;
          w2.count = existing.length;
          ProcessEmitWarning(w2);
        }
      }
      return target;
    }
    EventEmitter2.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };
    EventEmitter2.prototype.on = EventEmitter2.prototype.addListener;
    EventEmitter2.prototype.prependListener = function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };
    function onceWrapper() {
      if (!this.fired) {
        this.target.removeListener(this.type, this.wrapFn);
        this.fired = true;
        if (arguments.length === 0)
          return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
      }
    }
    function _onceWrap(target, type, listener) {
      var state = { fired: false, wrapFn: void 0, target, type, listener };
      var wrapped = onceWrapper.bind(state);
      wrapped.listener = listener;
      state.wrapFn = wrapped;
      return wrapped;
    }
    EventEmitter2.prototype.once = function once2(type, listener) {
      checkListener(listener);
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter2.prototype.prependOnceListener = function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter2.prototype.removeListener = function removeListener(type, listener) {
      var list, events, position, i3, originalListener;
      checkListener(listener);
      events = this._events;
      if (events === void 0)
        return this;
      list = events[type];
      if (list === void 0)
        return this;
      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = /* @__PURE__ */ Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit("removeListener", type, list.listener || listener);
        }
      } else if (typeof list !== "function") {
        position = -1;
        for (i3 = list.length - 1; i3 >= 0; i3--) {
          if (list[i3] === listener || list[i3].listener === listener) {
            originalListener = list[i3].listener;
            position = i3;
            break;
          }
        }
        if (position < 0)
          return this;
        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }
        if (list.length === 1)
          events[type] = list[0];
        if (events.removeListener !== void 0)
          this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(type) {
      var listeners, events, i3;
      events = this._events;
      if (events === void 0)
        return this;
      if (events.removeListener === void 0) {
        if (arguments.length === 0) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== void 0) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else
            delete events[type];
        }
        return this;
      }
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i3 = 0; i3 < keys.length; ++i3) {
          key = keys[i3];
          if (key === "removeListener") continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners("removeListener");
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        return this;
      }
      listeners = events[type];
      if (typeof listeners === "function") {
        this.removeListener(type, listeners);
      } else if (listeners !== void 0) {
        for (i3 = listeners.length - 1; i3 >= 0; i3--) {
          this.removeListener(type, listeners[i3]);
        }
      }
      return this;
    };
    function _listeners(target, type, unwrap2) {
      var events = target._events;
      if (events === void 0)
        return [];
      var evlistener = events[type];
      if (evlistener === void 0)
        return [];
      if (typeof evlistener === "function")
        return unwrap2 ? [evlistener.listener || evlistener] : [evlistener];
      return unwrap2 ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
    }
    EventEmitter2.prototype.listeners = function listeners(type) {
      return _listeners(this, type, true);
    };
    EventEmitter2.prototype.rawListeners = function rawListeners(type) {
      return _listeners(this, type, false);
    };
    EventEmitter2.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === "function") {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };
    EventEmitter2.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events = this._events;
      if (events !== void 0) {
        var evlistener = events[type];
        if (typeof evlistener === "function") {
          return 1;
        } else if (evlistener !== void 0) {
          return evlistener.length;
        }
      }
      return 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
    };
    function arrayClone(arr, n3) {
      var copy = new Array(n3);
      for (var i3 = 0; i3 < n3; ++i3)
        copy[i3] = arr[i3];
      return copy;
    }
    function spliceOne(list, index) {
      for (; index + 1 < list.length; index++)
        list[index] = list[index + 1];
      list.pop();
    }
    function unwrapListeners(arr) {
      var ret = new Array(arr.length);
      for (var i3 = 0; i3 < ret.length; ++i3) {
        ret[i3] = arr[i3].listener || arr[i3];
      }
      return ret;
    }
    function once(emitter, name) {
      return new Promise(function(resolve, reject) {
        function errorListener(err2) {
          emitter.removeListener(name, resolver);
          reject(err2);
        }
        function resolver() {
          if (typeof emitter.removeListener === "function") {
            emitter.removeListener("error", errorListener);
          }
          resolve([].slice.call(arguments));
        }
        ;
        eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
        if (name !== "error") {
          addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
        }
      });
    }
    function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
      if (typeof emitter.on === "function") {
        eventTargetAgnosticAddListener(emitter, "error", handler, flags);
      }
    }
    function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
      if (typeof emitter.on === "function") {
        if (flags.once) {
          emitter.once(name, listener);
        } else {
          emitter.on(name, listener);
        }
      } else if (typeof emitter.addEventListener === "function") {
        emitter.addEventListener(name, function wrapListener(arg) {
          if (flags.once) {
            emitter.removeEventListener(name, wrapListener);
          }
          listener(arg);
        });
      } else {
        throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
      }
    }
  }
});

// node_modules/.pnpm/sax@1.6.1/node_modules/sax/lib/sax.js
var require_sax = __commonJS({
  "node_modules/.pnpm/sax@1.6.1/node_modules/sax/lib/sax.js"(exports) {
    (function(sax2) {
      sax2.parser = function(strict, opt) {
        return new SAXParser(strict, opt);
      };
      sax2.SAXParser = SAXParser;
      sax2.SAXStream = SAXStream;
      sax2.createStream = createStream;
      sax2.MAX_BUFFER_LENGTH = 64 * 1024;
      var buffers = [
        "comment",
        "sgmlDecl",
        "textNode",
        "tagName",
        "doctype",
        "procInstName",
        "procInstBody",
        "entity",
        "attribName",
        "attribValue",
        "cdata",
        "script"
      ];
      sax2.EVENTS = [
        "text",
        "processinginstruction",
        "sgmldeclaration",
        "doctype",
        "comment",
        "opentagstart",
        "attribute",
        "opentag",
        "closetag",
        "opencdata",
        "cdata",
        "closecdata",
        "error",
        "end",
        "ready",
        "script",
        "opennamespace",
        "closenamespace"
      ];
      function SAXParser(strict, opt) {
        if (!(this instanceof SAXParser)) {
          return new SAXParser(strict, opt);
        }
        var parser2 = this;
        clearBuffers(parser2);
        parser2.q = parser2.c = "";
        parser2.bufferCheckPosition = sax2.MAX_BUFFER_LENGTH;
        parser2.encoding = null;
        parser2.opt = opt || {};
        parser2.opt.lowercase = parser2.opt.lowercase || parser2.opt.lowercasetags;
        parser2.looseCase = parser2.opt.lowercase ? "toLowerCase" : "toUpperCase";
        parser2.opt.maxEntityCount = parser2.opt.maxEntityCount || 512;
        parser2.opt.maxEntityDepth = parser2.opt.maxEntityDepth || 4;
        parser2.entityCount = parser2.entityDepth = 0;
        parser2.tags = [];
        parser2.closed = parser2.closedRoot = parser2.sawRoot = false;
        parser2.tag = parser2.error = null;
        parser2.strict = !!strict;
        parser2.noscript = !!(strict || parser2.opt.noscript);
        parser2.state = S2.BEGIN;
        parser2.strictEntities = parser2.opt.strictEntities;
        parser2.ENTITIES = parser2.strictEntities ? Object.create(sax2.XML_ENTITIES) : Object.create(sax2.ENTITIES);
        parser2.attribList = [];
        if (parser2.opt.xmlns) {
          parser2.ns = Object.create(rootNS);
        }
        if (parser2.opt.unquotedAttributeValues === void 0) {
          parser2.opt.unquotedAttributeValues = !strict;
        }
        parser2.trackPosition = parser2.opt.position !== false;
        if (parser2.trackPosition) {
          parser2.position = parser2.line = parser2.column = 0;
        }
        emit(parser2, "onready");
      }
      if (!Object.create) {
        Object.create = function(o3) {
          function F2() {
          }
          F2.prototype = o3;
          var newf = new F2();
          return newf;
        };
      }
      if (!Object.keys) {
        Object.keys = function(o3) {
          var a3 = [];
          for (var i3 in o3) if (o3.hasOwnProperty(i3)) a3.push(i3);
          return a3;
        };
      }
      function checkBufferLength(parser2) {
        var maxAllowed = Math.max(sax2.MAX_BUFFER_LENGTH, 10);
        var maxActual = 0;
        for (var i3 = 0, l3 = buffers.length; i3 < l3; i3++) {
          var len = parser2[buffers[i3]].length;
          if (len > maxAllowed) {
            switch (buffers[i3]) {
              case "textNode":
                closeText(parser2);
                break;
              case "cdata":
                emitNode(parser2, "oncdata", parser2.cdata);
                parser2.cdata = "";
                break;
              case "script":
                emitNode(parser2, "onscript", parser2.script);
                parser2.script = "";
                break;
              default:
                error(parser2, "Max buffer length exceeded: " + buffers[i3]);
            }
          }
          maxActual = Math.max(maxActual, len);
        }
        var m3 = sax2.MAX_BUFFER_LENGTH - maxActual;
        parser2.bufferCheckPosition = m3 + parser2.position;
      }
      function clearBuffers(parser2) {
        for (var i3 = 0, l3 = buffers.length; i3 < l3; i3++) {
          parser2[buffers[i3]] = "";
        }
      }
      function flushBuffers(parser2) {
        closeText(parser2);
        if (parser2.cdata !== "") {
          emitNode(parser2, "oncdata", parser2.cdata);
          parser2.cdata = "";
        }
        if (parser2.script !== "") {
          emitNode(parser2, "onscript", parser2.script);
          parser2.script = "";
        }
      }
      SAXParser.prototype = {
        end: function() {
          end(this);
        },
        write,
        resume: function() {
          this.error = null;
          return this;
        },
        close: function() {
          return this.write(null);
        },
        flush: function() {
          flushBuffers(this);
        }
      };
      var Stream;
      try {
        Stream = require("stream").Stream;
      } catch (ex) {
        Stream = function() {
        };
      }
      if (!Stream) Stream = function() {
      };
      var streamWraps = sax2.EVENTS.filter(function(ev) {
        return ev !== "error" && ev !== "end";
      });
      function createStream(strict, opt) {
        return new SAXStream(strict, opt);
      }
      function determineBufferEncoding(data, isEnd) {
        if (data.length >= 2) {
          if (data[0] === 255 && data[1] === 254) {
            return "utf-16le";
          }
          if (data[0] === 254 && data[1] === 255) {
            return "utf-16be";
          }
        }
        if (data.length >= 3 && data[0] === 239 && data[1] === 187 && data[2] === 191) {
          return "utf8";
        }
        if (data.length >= 4) {
          if (data[0] === 60 && data[1] === 0 && data[2] === 63 && data[3] === 0) {
            return "utf-16le";
          }
          if (data[0] === 0 && data[1] === 60 && data[2] === 0 && data[3] === 63) {
            return "utf-16be";
          }
          return "utf8";
        }
        return isEnd ? "utf8" : null;
      }
      function SAXStream(strict, opt) {
        if (!(this instanceof SAXStream)) {
          return new SAXStream(strict, opt);
        }
        Stream.apply(this);
        this._parser = new SAXParser(strict, opt);
        this.writable = true;
        this.readable = true;
        var me2 = this;
        this._parser.onend = function() {
          me2.emit("end");
        };
        this._parser.onerror = function(er) {
          me2.emit("error", er);
          me2._parser.error = null;
        };
        this._decoder = null;
        this._decoderBuffer = null;
        streamWraps.forEach(function(ev) {
          Object.defineProperty(me2, "on" + ev, {
            get: function() {
              return me2._parser["on" + ev];
            },
            set: function(h3) {
              if (!h3) {
                me2.removeAllListeners(ev);
                me2._parser["on" + ev] = h3;
                return h3;
              }
              me2.on(ev, h3);
            },
            enumerable: true,
            configurable: false
          });
        });
      }
      SAXStream.prototype = Object.create(Stream.prototype, {
        constructor: {
          value: SAXStream
        }
      });
      SAXStream.prototype._decodeBuffer = function(data, isEnd) {
        if (this._decoderBuffer) {
          data = Buffer.concat([this._decoderBuffer, data]);
          this._decoderBuffer = null;
        }
        if (!this._decoder) {
          var encoding = determineBufferEncoding(data, isEnd);
          if (!encoding) {
            this._decoderBuffer = data;
            return "";
          }
          this._parser.encoding = encoding;
          this._decoder = new TextDecoder(encoding);
        }
        return this._decoder.decode(data, { stream: !isEnd });
      };
      SAXStream.prototype.write = function(data) {
        if (typeof Buffer === "function" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(data)) {
          data = this._decodeBuffer(data, false);
        } else if (this._decoderBuffer) {
          var remaining = this._decodeBuffer(Buffer.alloc(0), true);
          if (remaining) {
            this._parser.write(remaining);
            this.emit("data", remaining);
          }
        }
        this._parser.write(data.toString());
        this.emit("data", data);
        return true;
      };
      SAXStream.prototype.end = function(chunk) {
        if (chunk && chunk.length) {
          this.write(chunk);
        }
        if (this._decoderBuffer) {
          var finalChunk = this._decodeBuffer(Buffer.alloc(0), true);
          if (finalChunk) {
            this._parser.write(finalChunk);
            this.emit("data", finalChunk);
          }
        } else if (this._decoder) {
          var remaining = this._decoder.decode();
          if (remaining) {
            this._parser.write(remaining);
            this.emit("data", remaining);
          }
        }
        this._parser.end();
        return true;
      };
      SAXStream.prototype.on = function(ev, handler) {
        var me2 = this;
        if (!me2._parser["on" + ev] && streamWraps.indexOf(ev) !== -1) {
          me2._parser["on" + ev] = function() {
            var args = arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments);
            args.splice(0, 0, ev);
            me2.emit.apply(me2, args);
          };
        }
        return Stream.prototype.on.call(me2, ev, handler);
      };
      var CDATAre = /^\[CDATA\[$/i;
      var DOCTYPEre = /^DOCTYPE$/i;
      var XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
      var XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
      var rootNS = { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE };
      var nameStart = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
      var nameBody = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;
      var entityStart = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
      var entityBody = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;
      function isWhitespace(c2) {
        return c2 === " " || c2 === "\n" || c2 === "\r" || c2 === "	";
      }
      function isQuote(c2) {
        return c2 === '"' || c2 === "'";
      }
      function isAttribEnd(c2) {
        return c2 === ">" || isWhitespace(c2);
      }
      function isMatch(regex, c2) {
        return regex.test(c2);
      }
      function notMatch(regex, c2) {
        return !isMatch(regex, c2);
      }
      var S2 = 0;
      sax2.STATE = {
        BEGIN: S2++,
        // leading byte order mark or whitespace
        BEGIN_WHITESPACE: S2++,
        // leading whitespace
        TEXT: S2++,
        // general stuff
        TEXT_ENTITY: S2++,
        // &amp and such.
        OPEN_WAKA: S2++,
        // <
        SGML_DECL: S2++,
        // <!BLARG
        SGML_DECL_QUOTED: S2++,
        // <!BLARG foo "bar
        DOCTYPE: S2++,
        // <!DOCTYPE
        DOCTYPE_QUOTED: S2++,
        // <!DOCTYPE "//blah
        DOCTYPE_DTD: S2++,
        // <!DOCTYPE "//blah" [ ...
        DOCTYPE_DTD_QUOTED: S2++,
        // <!DOCTYPE "//blah" [ "foo
        COMMENT_STARTING: S2++,
        // <!-
        COMMENT: S2++,
        // <!--
        COMMENT_ENDING: S2++,
        // <!-- blah -
        COMMENT_ENDED: S2++,
        // <!-- blah --
        CDATA: S2++,
        // <![CDATA[ something
        CDATA_ENDING: S2++,
        // ]
        CDATA_ENDING_2: S2++,
        // ]]
        PROC_INST: S2++,
        // <?hi
        PROC_INST_BODY: S2++,
        // <?hi there
        PROC_INST_ENDING: S2++,
        // <?hi "there" ?
        OPEN_TAG: S2++,
        // <strong
        OPEN_TAG_SLASH: S2++,
        // <strong /
        ATTRIB: S2++,
        // <a
        ATTRIB_NAME: S2++,
        // <a foo
        ATTRIB_NAME_SAW_WHITE: S2++,
        // <a foo _
        ATTRIB_VALUE: S2++,
        // <a foo=
        ATTRIB_VALUE_QUOTED: S2++,
        // <a foo="bar
        ATTRIB_VALUE_CLOSED: S2++,
        // <a foo="bar"
        ATTRIB_VALUE_UNQUOTED: S2++,
        // <a foo=bar
        ATTRIB_VALUE_ENTITY_Q: S2++,
        // <foo bar="&quot;"
        ATTRIB_VALUE_ENTITY_U: S2++,
        // <foo bar=&quot
        CLOSE_TAG: S2++,
        // </a
        CLOSE_TAG_SAW_WHITE: S2++,
        // </a   >
        SCRIPT: S2++,
        // <script> ...
        SCRIPT_ENDING: S2++
        // <script> ... <
      };
      sax2.XML_ENTITIES = Object.assign(/* @__PURE__ */ Object.create(null), {
        amp: "&",
        gt: ">",
        lt: "<",
        quot: '"',
        apos: "'"
      });
      sax2.ENTITIES = Object.assign(/* @__PURE__ */ Object.create(null), {
        amp: "&",
        gt: ">",
        lt: "<",
        quot: '"',
        apos: "'",
        AElig: 198,
        Aacute: 193,
        Acirc: 194,
        Agrave: 192,
        Aring: 197,
        Atilde: 195,
        Auml: 196,
        Ccedil: 199,
        ETH: 208,
        Eacute: 201,
        Ecirc: 202,
        Egrave: 200,
        Euml: 203,
        Iacute: 205,
        Icirc: 206,
        Igrave: 204,
        Iuml: 207,
        Ntilde: 209,
        Oacute: 211,
        Ocirc: 212,
        Ograve: 210,
        Oslash: 216,
        Otilde: 213,
        Ouml: 214,
        THORN: 222,
        Uacute: 218,
        Ucirc: 219,
        Ugrave: 217,
        Uuml: 220,
        Yacute: 221,
        aacute: 225,
        acirc: 226,
        aelig: 230,
        agrave: 224,
        aring: 229,
        atilde: 227,
        auml: 228,
        ccedil: 231,
        eacute: 233,
        ecirc: 234,
        egrave: 232,
        eth: 240,
        euml: 235,
        iacute: 237,
        icirc: 238,
        igrave: 236,
        iuml: 239,
        ntilde: 241,
        oacute: 243,
        ocirc: 244,
        ograve: 242,
        oslash: 248,
        otilde: 245,
        ouml: 246,
        szlig: 223,
        thorn: 254,
        uacute: 250,
        ucirc: 251,
        ugrave: 249,
        uuml: 252,
        yacute: 253,
        yuml: 255,
        copy: 169,
        reg: 174,
        nbsp: 160,
        iexcl: 161,
        cent: 162,
        pound: 163,
        curren: 164,
        yen: 165,
        brvbar: 166,
        sect: 167,
        uml: 168,
        ordf: 170,
        laquo: 171,
        not: 172,
        shy: 173,
        macr: 175,
        deg: 176,
        plusmn: 177,
        sup1: 185,
        sup2: 178,
        sup3: 179,
        acute: 180,
        micro: 181,
        para: 182,
        middot: 183,
        cedil: 184,
        ordm: 186,
        raquo: 187,
        frac14: 188,
        frac12: 189,
        frac34: 190,
        iquest: 191,
        times: 215,
        divide: 247,
        OElig: 338,
        oelig: 339,
        Scaron: 352,
        scaron: 353,
        Yuml: 376,
        fnof: 402,
        circ: 710,
        tilde: 732,
        Alpha: 913,
        Beta: 914,
        Gamma: 915,
        Delta: 916,
        Epsilon: 917,
        Zeta: 918,
        Eta: 919,
        Theta: 920,
        Iota: 921,
        Kappa: 922,
        Lambda: 923,
        Mu: 924,
        Nu: 925,
        Xi: 926,
        Omicron: 927,
        Pi: 928,
        Rho: 929,
        Sigma: 931,
        Tau: 932,
        Upsilon: 933,
        Phi: 934,
        Chi: 935,
        Psi: 936,
        Omega: 937,
        alpha: 945,
        beta: 946,
        gamma: 947,
        delta: 948,
        epsilon: 949,
        zeta: 950,
        eta: 951,
        theta: 952,
        iota: 953,
        kappa: 954,
        lambda: 955,
        mu: 956,
        nu: 957,
        xi: 958,
        omicron: 959,
        pi: 960,
        rho: 961,
        sigmaf: 962,
        sigma: 963,
        tau: 964,
        upsilon: 965,
        phi: 966,
        chi: 967,
        psi: 968,
        omega: 969,
        thetasym: 977,
        upsih: 978,
        piv: 982,
        ensp: 8194,
        emsp: 8195,
        thinsp: 8201,
        zwnj: 8204,
        zwj: 8205,
        lrm: 8206,
        rlm: 8207,
        ndash: 8211,
        mdash: 8212,
        lsquo: 8216,
        rsquo: 8217,
        sbquo: 8218,
        ldquo: 8220,
        rdquo: 8221,
        bdquo: 8222,
        dagger: 8224,
        Dagger: 8225,
        bull: 8226,
        hellip: 8230,
        permil: 8240,
        prime: 8242,
        Prime: 8243,
        lsaquo: 8249,
        rsaquo: 8250,
        oline: 8254,
        frasl: 8260,
        euro: 8364,
        image: 8465,
        weierp: 8472,
        real: 8476,
        trade: 8482,
        alefsym: 8501,
        larr: 8592,
        uarr: 8593,
        rarr: 8594,
        darr: 8595,
        harr: 8596,
        crarr: 8629,
        lArr: 8656,
        uArr: 8657,
        rArr: 8658,
        dArr: 8659,
        hArr: 8660,
        forall: 8704,
        part: 8706,
        exist: 8707,
        empty: 8709,
        nabla: 8711,
        isin: 8712,
        notin: 8713,
        ni: 8715,
        prod: 8719,
        sum: 8721,
        minus: 8722,
        lowast: 8727,
        radic: 8730,
        prop: 8733,
        infin: 8734,
        ang: 8736,
        and: 8743,
        or: 8744,
        cap: 8745,
        cup: 8746,
        int: 8747,
        there4: 8756,
        sim: 8764,
        cong: 8773,
        asymp: 8776,
        ne: 8800,
        equiv: 8801,
        le: 8804,
        ge: 8805,
        sub: 8834,
        sup: 8835,
        nsub: 8836,
        sube: 8838,
        supe: 8839,
        oplus: 8853,
        otimes: 8855,
        perp: 8869,
        sdot: 8901,
        lceil: 8968,
        rceil: 8969,
        lfloor: 8970,
        rfloor: 8971,
        lang: 9001,
        rang: 9002,
        loz: 9674,
        spades: 9824,
        clubs: 9827,
        hearts: 9829,
        diams: 9830
      });
      Object.keys(sax2.ENTITIES).forEach(function(key) {
        var e3 = sax2.ENTITIES[key];
        var s4 = typeof e3 === "number" ? String.fromCharCode(e3) : e3;
        sax2.ENTITIES[key] = s4;
      });
      for (var s3 in sax2.STATE) {
        sax2.STATE[sax2.STATE[s3]] = s3;
      }
      S2 = sax2.STATE;
      function emit(parser2, event, data) {
        parser2[event] && parser2[event](data);
      }
      function getDeclaredEncoding(body) {
        var match = body && body.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);
        return match ? match[2] : null;
      }
      function normalizeEncodingName(encoding) {
        if (!encoding) {
          return null;
        }
        return encoding.toLowerCase().replace(/[^a-z0-9]/g, "");
      }
      function encodingsMatch(detectedEncoding, declaredEncoding) {
        const detected = normalizeEncodingName(detectedEncoding);
        const declared = normalizeEncodingName(declaredEncoding);
        if (!detected || !declared) {
          return true;
        }
        if (declared === "utf16") {
          return detected === "utf16le" || detected === "utf16be";
        }
        return detected === declared;
      }
      function validateXmlDeclarationEncoding(parser2, data) {
        if (!parser2.strict || !parser2.encoding || !data || data.name !== "xml") {
          return;
        }
        var declaredEncoding = getDeclaredEncoding(data.body);
        if (declaredEncoding && !encodingsMatch(parser2.encoding, declaredEncoding)) {
          strictFail(
            parser2,
            "XML declaration encoding " + declaredEncoding + " does not match detected stream encoding " + parser2.encoding.toUpperCase()
          );
        }
      }
      function emitNode(parser2, nodeType, data) {
        if (parser2.textNode) closeText(parser2);
        emit(parser2, nodeType, data);
      }
      function closeText(parser2) {
        parser2.textNode = textopts(parser2.opt, parser2.textNode);
        if (parser2.textNode) emit(parser2, "ontext", parser2.textNode);
        parser2.textNode = "";
      }
      function textopts(opt, text) {
        if (opt.trim) text = text.trim();
        if (opt.normalize) text = text.replace(/\s+/g, " ");
        return text;
      }
      function error(parser2, er) {
        closeText(parser2);
        if (parser2.trackPosition) {
          er += "\nLine: " + parser2.line + "\nColumn: " + parser2.column + "\nChar: " + parser2.c;
        }
        er = new Error(er);
        parser2.error = er;
        emit(parser2, "onerror", er);
        return parser2;
      }
      function end(parser2) {
        if (parser2.sawRoot && !parser2.closedRoot)
          strictFail(parser2, "Unclosed root tag");
        if (parser2.state !== S2.BEGIN && parser2.state !== S2.BEGIN_WHITESPACE && parser2.state !== S2.TEXT) {
          error(parser2, "Unexpected end");
        }
        closeText(parser2);
        parser2.c = "";
        parser2.closed = true;
        emit(parser2, "onend");
        SAXParser.call(parser2, parser2.strict, parser2.opt);
        return parser2;
      }
      function strictFail(parser2, message) {
        if (typeof parser2 !== "object" || !(parser2 instanceof SAXParser)) {
          throw new Error("bad call to strictFail");
        }
        if (parser2.strict) {
          error(parser2, message);
        }
      }
      function newTag(parser2) {
        if (!parser2.strict) parser2.tagName = parser2.tagName[parser2.looseCase]();
        var parent = parser2.tags[parser2.tags.length - 1] || parser2;
        var tag = parser2.tag = { name: parser2.tagName, attributes: {} };
        if (parser2.opt.xmlns) {
          tag.ns = parent.ns;
        }
        parser2.attribList.length = 0;
        emitNode(parser2, "onopentagstart", tag);
      }
      function qname(name, attribute) {
        var i3 = name.indexOf(":");
        var qualName = i3 < 0 ? ["", name] : name.split(":");
        var prefix = qualName[0];
        var local = qualName[1];
        if (attribute && name === "xmlns") {
          prefix = "xmlns";
          local = "";
        }
        return { prefix, local };
      }
      function attrib(parser2) {
        if (!parser2.strict) {
          parser2.attribName = parser2.attribName[parser2.looseCase]();
        }
        if (parser2.attribList.indexOf(parser2.attribName) !== -1 || parser2.tag.attributes.hasOwnProperty(parser2.attribName)) {
          parser2.attribName = parser2.attribValue = "";
          return;
        }
        if (parser2.opt.xmlns) {
          var qn = qname(parser2.attribName, true);
          var prefix = qn.prefix;
          var local = qn.local;
          if (prefix === "xmlns") {
            if (local === "xml" && parser2.attribValue !== XML_NAMESPACE) {
              strictFail(
                parser2,
                "xml: prefix must be bound to " + XML_NAMESPACE + "\nActual: " + parser2.attribValue
              );
            } else if (local === "xmlns" && parser2.attribValue !== XMLNS_NAMESPACE) {
              strictFail(
                parser2,
                "xmlns: prefix must be bound to " + XMLNS_NAMESPACE + "\nActual: " + parser2.attribValue
              );
            } else {
              var tag = parser2.tag;
              var parent = parser2.tags[parser2.tags.length - 1] || parser2;
              if (tag.ns === parent.ns) {
                tag.ns = Object.create(parent.ns);
              }
              tag.ns[local] = parser2.attribValue;
            }
          }
          parser2.attribList.push([parser2.attribName, parser2.attribValue]);
        } else {
          parser2.tag.attributes[parser2.attribName] = parser2.attribValue;
          emitNode(parser2, "onattribute", {
            name: parser2.attribName,
            value: parser2.attribValue
          });
        }
        parser2.attribName = parser2.attribValue = "";
      }
      function openTag(parser2, selfClosing) {
        if (parser2.opt.xmlns) {
          var tag = parser2.tag;
          var qn = qname(parser2.tagName);
          tag.prefix = qn.prefix;
          tag.local = qn.local;
          tag.uri = tag.ns[qn.prefix] || "";
          if (tag.prefix && !tag.uri) {
            strictFail(
              parser2,
              "Unbound namespace prefix: " + JSON.stringify(parser2.tagName)
            );
            tag.uri = qn.prefix;
          }
          var parent = parser2.tags[parser2.tags.length - 1] || parser2;
          if (tag.ns && parent.ns !== tag.ns) {
            Object.keys(tag.ns).forEach(function(p3) {
              emitNode(parser2, "onopennamespace", {
                prefix: p3,
                uri: tag.ns[p3]
              });
            });
          }
          for (var i3 = 0, l3 = parser2.attribList.length; i3 < l3; i3++) {
            var nv = parser2.attribList[i3];
            var name = nv[0];
            var value = nv[1];
            var qualName = qname(name, true);
            var prefix = qualName.prefix;
            var local = qualName.local;
            var uri = prefix === "" ? "" : tag.ns[prefix] || "";
            var a3 = {
              name,
              value,
              prefix,
              local,
              uri
            };
            if (prefix && prefix !== "xmlns" && !uri) {
              strictFail(
                parser2,
                "Unbound namespace prefix: " + JSON.stringify(prefix)
              );
              a3.uri = prefix;
            }
            parser2.tag.attributes[name] = a3;
            emitNode(parser2, "onattribute", a3);
          }
          parser2.attribList.length = 0;
        }
        parser2.tag.isSelfClosing = !!selfClosing;
        parser2.sawRoot = true;
        parser2.tags.push(parser2.tag);
        emitNode(parser2, "onopentag", parser2.tag);
        if (!selfClosing) {
          if (!parser2.noscript && parser2.tagName.toLowerCase() === "script") {
            parser2.state = S2.SCRIPT;
          } else {
            parser2.state = S2.TEXT;
          }
          parser2.tag = null;
          parser2.tagName = "";
        }
        parser2.attribName = parser2.attribValue = "";
        parser2.attribList.length = 0;
      }
      function closeTag(parser2) {
        if (!parser2.tagName) {
          strictFail(parser2, "Weird empty close tag.");
          parser2.textNode += "</>";
          parser2.state = S2.TEXT;
          return;
        }
        if (parser2.script) {
          if (parser2.tagName !== "script") {
            parser2.script += "</" + parser2.tagName + ">";
            parser2.tagName = "";
            parser2.state = S2.SCRIPT;
            return;
          }
          emitNode(parser2, "onscript", parser2.script);
          parser2.script = "";
        }
        var t3 = parser2.tags.length;
        var tagName = parser2.tagName;
        if (!parser2.strict) {
          tagName = tagName[parser2.looseCase]();
        }
        var closeTo = tagName;
        while (t3--) {
          var close = parser2.tags[t3];
          if (close.name !== closeTo) {
            strictFail(parser2, "Unexpected close tag");
          } else {
            break;
          }
        }
        if (t3 < 0) {
          strictFail(parser2, "Unmatched closing tag: " + parser2.tagName);
          parser2.textNode += "</" + parser2.tagName + ">";
          parser2.state = S2.TEXT;
          return;
        }
        parser2.tagName = tagName;
        var s4 = parser2.tags.length;
        while (s4-- > t3) {
          var tag = parser2.tag = parser2.tags.pop();
          parser2.tagName = parser2.tag.name;
          emitNode(parser2, "onclosetag", parser2.tagName);
          var x3 = {};
          for (var i3 in tag.ns) {
            x3[i3] = tag.ns[i3];
          }
          var parent = parser2.tags[parser2.tags.length - 1] || parser2;
          if (parser2.opt.xmlns && tag.ns !== parent.ns) {
            Object.keys(tag.ns).forEach(function(p3) {
              var n3 = tag.ns[p3];
              emitNode(parser2, "onclosenamespace", { prefix: p3, uri: n3 });
            });
          }
        }
        if (t3 === 0) parser2.closedRoot = true;
        parser2.tagName = parser2.attribValue = parser2.attribName = "";
        parser2.attribList.length = 0;
        parser2.state = S2.TEXT;
      }
      function parseEntity(parser2) {
        var entity = parser2.entity;
        var entityLC = entity.toLowerCase();
        var num;
        var numStr = "";
        if (parser2.ENTITIES[entity]) {
          return parser2.ENTITIES[entity];
        }
        if (parser2.ENTITIES[entityLC]) {
          return parser2.ENTITIES[entityLC];
        }
        entity = entityLC;
        if (entity.charAt(0) === "#") {
          if (entity.charAt(1) === "x") {
            entity = entity.slice(2);
            num = parseInt(entity, 16);
            numStr = num.toString(16);
          } else {
            entity = entity.slice(1);
            num = parseInt(entity, 10);
            numStr = num.toString(10);
          }
        }
        entity = entity.replace(/^0+/, "");
        if (isNaN(num) || numStr.toLowerCase() !== entity || num < 0 || num > 1114111 || !isXmlChar(num)) {
          strictFail(parser2, "Invalid character entity");
          return "&" + parser2.entity + ";";
        }
        return String.fromCodePoint(num);
      }
      function isXmlChar(num) {
        return num === 9 || num === 10 || num === 13 || num >= 32 && num <= 55295 || num >= 57344 && num <= 65533 || num >= 65536 && num <= 1114111;
      }
      function beginWhiteSpace(parser2, c2) {
        if (c2 === "<") {
          parser2.state = S2.OPEN_WAKA;
          parser2.startTagPosition = parser2.position;
        } else if (!isWhitespace(c2)) {
          strictFail(parser2, "Non-whitespace before first tag.");
          parser2.textNode = c2;
          parser2.state = S2.TEXT;
        }
      }
      function charAt(chunk, i3) {
        var result = "";
        if (i3 < chunk.length) {
          result = chunk.charAt(i3);
        }
        return result;
      }
      function write(chunk) {
        var parser2 = this;
        if (this.error) {
          throw this.error;
        }
        if (parser2.closed) {
          return error(
            parser2,
            "Cannot write after close. Assign an onready handler."
          );
        }
        if (chunk === null) {
          return end(parser2);
        }
        if (typeof chunk === "object") {
          chunk = chunk.toString();
        }
        var i3 = 0;
        var c2 = "";
        while (true) {
          c2 = charAt(chunk, i3++);
          parser2.c = c2;
          if (!c2) {
            break;
          }
          if (parser2.trackPosition) {
            parser2.position++;
            if (c2 === "\n") {
              parser2.line++;
              parser2.column = 0;
            } else {
              parser2.column++;
            }
          }
          switch (parser2.state) {
            case S2.BEGIN:
              parser2.state = S2.BEGIN_WHITESPACE;
              if (c2 === "\uFEFF") {
                continue;
              }
              beginWhiteSpace(parser2, c2);
              continue;
            case S2.BEGIN_WHITESPACE:
              beginWhiteSpace(parser2, c2);
              continue;
            case S2.TEXT:
              if (parser2.sawRoot && !parser2.closedRoot) {
                var starti = i3 - 1;
                while (c2 && c2 !== "<" && c2 !== "&") {
                  c2 = charAt(chunk, i3++);
                  if (c2 && parser2.trackPosition) {
                    parser2.position++;
                    if (c2 === "\n") {
                      parser2.line++;
                      parser2.column = 0;
                    } else {
                      parser2.column++;
                    }
                  }
                }
                parser2.textNode += chunk.substring(starti, i3 - 1);
              }
              if (c2 === "<" && !(parser2.sawRoot && parser2.closedRoot && !parser2.strict)) {
                parser2.state = S2.OPEN_WAKA;
                parser2.startTagPosition = parser2.position;
              } else {
                if (!isWhitespace(c2) && (!parser2.sawRoot || parser2.closedRoot)) {
                  strictFail(parser2, "Text data outside of root node.");
                }
                if (c2 === "&") {
                  parser2.state = S2.TEXT_ENTITY;
                } else {
                  parser2.textNode += c2;
                }
              }
              continue;
            case S2.SCRIPT:
              if (c2 === "<") {
                parser2.state = S2.SCRIPT_ENDING;
              } else {
                parser2.script += c2;
              }
              continue;
            case S2.SCRIPT_ENDING:
              if (c2 === "/") {
                parser2.state = S2.CLOSE_TAG;
              } else {
                parser2.script += "<" + c2;
                parser2.state = S2.SCRIPT;
              }
              continue;
            case S2.OPEN_WAKA:
              if (c2 === "!") {
                parser2.state = S2.SGML_DECL;
                parser2.sgmlDecl = "";
              } else if (isWhitespace(c2)) {
              } else if (isMatch(nameStart, c2)) {
                parser2.state = S2.OPEN_TAG;
                parser2.tagName = c2;
              } else if (c2 === "/") {
                parser2.state = S2.CLOSE_TAG;
                parser2.tagName = "";
              } else if (c2 === "?") {
                parser2.state = S2.PROC_INST;
                parser2.procInstName = parser2.procInstBody = "";
              } else {
                strictFail(parser2, "Unencoded <");
                if (parser2.startTagPosition + 1 < parser2.position) {
                  var pad = parser2.position - parser2.startTagPosition;
                  c2 = new Array(pad).join(" ") + c2;
                }
                parser2.textNode += "<" + c2;
                parser2.state = S2.TEXT;
              }
              continue;
            case S2.SGML_DECL:
              if (parser2.sgmlDecl + c2 === "--") {
                parser2.state = S2.COMMENT;
                parser2.comment = "";
                parser2.sgmlDecl = "";
                continue;
              }
              if (parser2.doctype && parser2.doctype !== true && parser2.sgmlDecl) {
                parser2.state = S2.DOCTYPE_DTD;
                parser2.doctype += "<!" + parser2.sgmlDecl + c2;
                parser2.sgmlDecl = "";
              } else if (CDATAre.test(parser2.sgmlDecl + c2)) {
                emitNode(parser2, "onopencdata");
                parser2.state = S2.CDATA;
                parser2.sgmlDecl = "";
                parser2.cdata = "";
              } else if (DOCTYPEre.test(parser2.sgmlDecl + c2)) {
                parser2.state = S2.DOCTYPE;
                if (parser2.doctype || parser2.sawRoot) {
                  strictFail(
                    parser2,
                    "Inappropriately located doctype declaration"
                  );
                }
                parser2.doctype = "";
                parser2.sgmlDecl = "";
              } else if (c2 === ">") {
                emitNode(parser2, "onsgmldeclaration", parser2.sgmlDecl);
                parser2.sgmlDecl = "";
                parser2.state = S2.TEXT;
              } else if (isQuote(c2)) {
                parser2.state = S2.SGML_DECL_QUOTED;
                parser2.sgmlDecl += c2;
              } else {
                parser2.sgmlDecl += c2;
              }
              continue;
            case S2.SGML_DECL_QUOTED:
              if (c2 === parser2.q) {
                parser2.state = S2.SGML_DECL;
                parser2.q = "";
              }
              parser2.sgmlDecl += c2;
              continue;
            case S2.DOCTYPE:
              if (c2 === ">") {
                parser2.state = S2.TEXT;
                emitNode(parser2, "ondoctype", parser2.doctype);
                parser2.doctype = true;
              } else {
                parser2.doctype += c2;
                if (c2 === "[") {
                  parser2.state = S2.DOCTYPE_DTD;
                } else if (isQuote(c2)) {
                  parser2.state = S2.DOCTYPE_QUOTED;
                  parser2.q = c2;
                }
              }
              continue;
            case S2.DOCTYPE_QUOTED:
              parser2.doctype += c2;
              if (c2 === parser2.q) {
                parser2.q = "";
                parser2.state = S2.DOCTYPE;
              }
              continue;
            case S2.DOCTYPE_DTD:
              if (c2 === "]") {
                parser2.doctype += c2;
                parser2.state = S2.DOCTYPE;
              } else if (c2 === "<") {
                parser2.state = S2.OPEN_WAKA;
                parser2.startTagPosition = parser2.position;
              } else if (isQuote(c2)) {
                parser2.doctype += c2;
                parser2.state = S2.DOCTYPE_DTD_QUOTED;
                parser2.q = c2;
              } else {
                parser2.doctype += c2;
              }
              continue;
            case S2.DOCTYPE_DTD_QUOTED:
              parser2.doctype += c2;
              if (c2 === parser2.q) {
                parser2.state = S2.DOCTYPE_DTD;
                parser2.q = "";
              }
              continue;
            case S2.COMMENT:
              if (c2 === "-") {
                parser2.state = S2.COMMENT_ENDING;
              } else {
                parser2.comment += c2;
              }
              continue;
            case S2.COMMENT_ENDING:
              if (c2 === "-") {
                parser2.state = S2.COMMENT_ENDED;
                parser2.comment = textopts(parser2.opt, parser2.comment);
                if (parser2.comment) {
                  emitNode(parser2, "oncomment", parser2.comment);
                }
                parser2.comment = "";
              } else {
                parser2.comment += "-" + c2;
                parser2.state = S2.COMMENT;
              }
              continue;
            case S2.COMMENT_ENDED:
              if (c2 !== ">") {
                strictFail(parser2, "Malformed comment");
                parser2.comment += "--" + c2;
                parser2.state = S2.COMMENT;
              } else if (parser2.doctype && parser2.doctype !== true) {
                parser2.state = S2.DOCTYPE_DTD;
              } else {
                parser2.state = S2.TEXT;
              }
              continue;
            case S2.CDATA:
              var starti = i3 - 1;
              while (c2 && c2 !== "]") {
                c2 = charAt(chunk, i3++);
                if (c2 && parser2.trackPosition) {
                  parser2.position++;
                  if (c2 === "\n") {
                    parser2.line++;
                    parser2.column = 0;
                  } else {
                    parser2.column++;
                  }
                }
              }
              parser2.cdata += chunk.substring(starti, i3 - 1);
              if (c2 === "]") {
                parser2.state = S2.CDATA_ENDING;
              }
              continue;
            case S2.CDATA_ENDING:
              if (c2 === "]") {
                parser2.state = S2.CDATA_ENDING_2;
              } else {
                parser2.cdata += "]" + c2;
                parser2.state = S2.CDATA;
              }
              continue;
            case S2.CDATA_ENDING_2:
              if (c2 === ">") {
                if (parser2.cdata) {
                  emitNode(parser2, "oncdata", parser2.cdata);
                }
                emitNode(parser2, "onclosecdata");
                parser2.cdata = "";
                parser2.state = S2.TEXT;
              } else if (c2 === "]") {
                parser2.cdata += "]";
              } else {
                parser2.cdata += "]]" + c2;
                parser2.state = S2.CDATA;
              }
              continue;
            case S2.PROC_INST:
              if (c2 === "?") {
                parser2.state = S2.PROC_INST_ENDING;
              } else if (isWhitespace(c2)) {
                parser2.state = S2.PROC_INST_BODY;
              } else {
                parser2.procInstName += c2;
              }
              continue;
            case S2.PROC_INST_BODY:
              if (!parser2.procInstBody && isWhitespace(c2)) {
                continue;
              } else if (c2 === "?") {
                parser2.state = S2.PROC_INST_ENDING;
              } else {
                parser2.procInstBody += c2;
              }
              continue;
            case S2.PROC_INST_ENDING:
              if (c2 === ">") {
                const procInstEndData = {
                  name: parser2.procInstName,
                  body: parser2.procInstBody
                };
                validateXmlDeclarationEncoding(parser2, procInstEndData);
                emitNode(parser2, "onprocessinginstruction", procInstEndData);
                parser2.procInstName = parser2.procInstBody = "";
                parser2.state = S2.TEXT;
              } else {
                parser2.procInstBody += "?" + c2;
                parser2.state = S2.PROC_INST_BODY;
              }
              continue;
            case S2.OPEN_TAG:
              if (isMatch(nameBody, c2)) {
                parser2.tagName += c2;
              } else {
                newTag(parser2);
                if (c2 === ">") {
                  openTag(parser2);
                } else if (c2 === "/") {
                  parser2.state = S2.OPEN_TAG_SLASH;
                } else {
                  if (!isWhitespace(c2)) {
                    strictFail(parser2, "Invalid character in tag name");
                  }
                  parser2.state = S2.ATTRIB;
                }
              }
              continue;
            case S2.OPEN_TAG_SLASH:
              if (c2 === ">") {
                openTag(parser2, true);
                closeTag(parser2);
              } else {
                strictFail(
                  parser2,
                  "Forward-slash in opening tag not followed by >"
                );
                parser2.state = S2.ATTRIB;
              }
              continue;
            case S2.ATTRIB:
              if (isWhitespace(c2)) {
                continue;
              } else if (c2 === ">") {
                openTag(parser2);
              } else if (c2 === "/") {
                parser2.state = S2.OPEN_TAG_SLASH;
              } else if (isMatch(nameStart, c2)) {
                parser2.attribName = c2;
                parser2.attribValue = "";
                parser2.state = S2.ATTRIB_NAME;
              } else {
                strictFail(parser2, "Invalid attribute name");
              }
              continue;
            case S2.ATTRIB_NAME:
              if (c2 === "=") {
                parser2.state = S2.ATTRIB_VALUE;
              } else if (c2 === ">") {
                strictFail(parser2, "Attribute without value");
                parser2.attribValue = parser2.attribName;
                attrib(parser2);
                openTag(parser2);
              } else if (isWhitespace(c2)) {
                parser2.state = S2.ATTRIB_NAME_SAW_WHITE;
              } else if (isMatch(nameBody, c2)) {
                parser2.attribName += c2;
              } else {
                strictFail(parser2, "Invalid attribute name");
              }
              continue;
            case S2.ATTRIB_NAME_SAW_WHITE:
              if (c2 === "=") {
                parser2.state = S2.ATTRIB_VALUE;
              } else if (isWhitespace(c2)) {
                continue;
              } else {
                strictFail(parser2, "Attribute without value");
                parser2.tag.attributes[parser2.attribName] = "";
                parser2.attribValue = "";
                emitNode(parser2, "onattribute", {
                  name: parser2.attribName,
                  value: ""
                });
                parser2.attribName = "";
                if (c2 === ">") {
                  openTag(parser2);
                } else if (isMatch(nameStart, c2)) {
                  parser2.attribName = c2;
                  parser2.state = S2.ATTRIB_NAME;
                } else {
                  strictFail(parser2, "Invalid attribute name");
                  parser2.state = S2.ATTRIB;
                }
              }
              continue;
            case S2.ATTRIB_VALUE:
              if (isWhitespace(c2)) {
                continue;
              } else if (isQuote(c2)) {
                parser2.q = c2;
                parser2.state = S2.ATTRIB_VALUE_QUOTED;
              } else {
                if (!parser2.opt.unquotedAttributeValues) {
                  error(parser2, "Unquoted attribute value");
                }
                parser2.state = S2.ATTRIB_VALUE_UNQUOTED;
                parser2.attribValue = c2;
              }
              continue;
            case S2.ATTRIB_VALUE_QUOTED:
              if (c2 !== parser2.q) {
                if (c2 === "&") {
                  parser2.state = S2.ATTRIB_VALUE_ENTITY_Q;
                } else {
                  parser2.attribValue += c2;
                }
                continue;
              }
              attrib(parser2);
              parser2.q = "";
              parser2.state = S2.ATTRIB_VALUE_CLOSED;
              continue;
            case S2.ATTRIB_VALUE_CLOSED:
              if (isWhitespace(c2)) {
                parser2.state = S2.ATTRIB;
              } else if (c2 === ">") {
                openTag(parser2);
              } else if (c2 === "/") {
                parser2.state = S2.OPEN_TAG_SLASH;
              } else if (isMatch(nameStart, c2)) {
                strictFail(parser2, "No whitespace between attributes");
                parser2.attribName = c2;
                parser2.attribValue = "";
                parser2.state = S2.ATTRIB_NAME;
              } else {
                strictFail(parser2, "Invalid attribute name");
              }
              continue;
            case S2.ATTRIB_VALUE_UNQUOTED:
              if (!isAttribEnd(c2)) {
                if (c2 === "&") {
                  parser2.state = S2.ATTRIB_VALUE_ENTITY_U;
                } else {
                  parser2.attribValue += c2;
                }
                continue;
              }
              attrib(parser2);
              if (c2 === ">") {
                openTag(parser2);
              } else {
                parser2.state = S2.ATTRIB;
              }
              continue;
            case S2.CLOSE_TAG:
              if (!parser2.tagName) {
                if (isWhitespace(c2)) {
                  continue;
                } else if (notMatch(nameStart, c2)) {
                  if (parser2.script) {
                    parser2.script += "</" + c2;
                    parser2.state = S2.SCRIPT;
                  } else {
                    strictFail(parser2, "Invalid tagname in closing tag.");
                  }
                } else {
                  parser2.tagName = c2;
                }
              } else if (c2 === ">") {
                closeTag(parser2);
              } else if (isMatch(nameBody, c2)) {
                parser2.tagName += c2;
              } else if (parser2.script) {
                parser2.script += "</" + parser2.tagName + c2;
                parser2.tagName = "";
                parser2.state = S2.SCRIPT;
              } else {
                if (!isWhitespace(c2)) {
                  strictFail(parser2, "Invalid tagname in closing tag");
                }
                parser2.state = S2.CLOSE_TAG_SAW_WHITE;
              }
              continue;
            case S2.CLOSE_TAG_SAW_WHITE:
              if (isWhitespace(c2)) {
                continue;
              }
              if (c2 === ">") {
                closeTag(parser2);
              } else {
                strictFail(parser2, "Invalid characters in closing tag");
              }
              continue;
            case S2.TEXT_ENTITY:
            case S2.ATTRIB_VALUE_ENTITY_Q:
            case S2.ATTRIB_VALUE_ENTITY_U:
              var returnState;
              var buffer;
              switch (parser2.state) {
                case S2.TEXT_ENTITY:
                  returnState = S2.TEXT;
                  buffer = "textNode";
                  break;
                case S2.ATTRIB_VALUE_ENTITY_Q:
                  returnState = S2.ATTRIB_VALUE_QUOTED;
                  buffer = "attribValue";
                  break;
                case S2.ATTRIB_VALUE_ENTITY_U:
                  returnState = S2.ATTRIB_VALUE_UNQUOTED;
                  buffer = "attribValue";
                  break;
              }
              if (c2 === ";") {
                var parsedEntity = parseEntity(parser2);
                if (parser2.opt.unparsedEntities && !Object.values(sax2.XML_ENTITIES).includes(parsedEntity)) {
                  if ((parser2.entityCount += 1) > parser2.opt.maxEntityCount) {
                    error(
                      parser2,
                      "Parsed entity count exceeds max entity count"
                    );
                  }
                  if ((parser2.entityDepth += 1) > parser2.opt.maxEntityDepth) {
                    error(
                      parser2,
                      "Parsed entity depth exceeds max entity depth"
                    );
                  }
                  parser2.entity = "";
                  parser2.state = returnState;
                  parser2.write(parsedEntity);
                  parser2.entityDepth -= 1;
                } else {
                  parser2[buffer] += parsedEntity;
                  parser2.entity = "";
                  parser2.state = returnState;
                }
              } else if (isMatch(parser2.entity.length ? entityBody : entityStart, c2)) {
                parser2.entity += c2;
              } else {
                strictFail(parser2, "Invalid character in entity name");
                parser2[buffer] += "&" + parser2.entity + c2;
                parser2.entity = "";
                parser2.state = returnState;
              }
              continue;
            default: {
              throw new Error(parser2, "Unknown state: " + parser2.state);
            }
          }
        }
        if (parser2.position >= parser2.bufferCheckPosition) {
          checkBufferLength(parser2);
        }
        return parser2;
      }
      if (!String.fromCodePoint) {
        ;
        (function() {
          var stringFromCharCode = String.fromCharCode;
          var floor = Math.floor;
          var fromCodePoint = function() {
            var MAX_SIZE = 16384;
            var codeUnits = [];
            var highSurrogate;
            var lowSurrogate;
            var index = -1;
            var length = arguments.length;
            if (!length) {
              return "";
            }
            var result = "";
            while (++index < length) {
              var codePoint = Number(arguments[index]);
              if (!isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
              codePoint < 0 || // not a valid Unicode code point
              codePoint > 1114111 || // not a valid Unicode code point
              floor(codePoint) !== codePoint) {
                throw RangeError("Invalid code point: " + codePoint);
              }
              if (codePoint <= 65535) {
                codeUnits.push(codePoint);
              } else {
                codePoint -= 65536;
                highSurrogate = (codePoint >> 10) + 55296;
                lowSurrogate = codePoint % 1024 + 56320;
                codeUnits.push(highSurrogate, lowSurrogate);
              }
              if (index + 1 === length || codeUnits.length > MAX_SIZE) {
                result += stringFromCharCode.apply(null, codeUnits);
                codeUnits.length = 0;
              }
            }
            return result;
          };
          if (Object.defineProperty) {
            Object.defineProperty(String, "fromCodePoint", {
              value: fromCodePoint,
              configurable: true,
              writable: true
            });
          } else {
            String.fromCodePoint = fromCodePoint;
          }
        })();
      }
    })(typeof exports === "undefined" ? exports.sax = {} : exports);
  }
});

// node_modules/.pnpm/@lingo-reader+shared@0.4.6/node_modules/@lingo-reader/shared/dist/index.browser.mjs
function stripBOM(str) {
  if (str.charCodeAt(0) === 65279) {
    return str.slice(1);
  }
  return str;
}
function normalize(str) {
  return str.toLowerCase();
}
function isEmpty(thing) {
  return typeof thing === "object" && thing !== null && Object.keys(thing).length === 0;
}
function processItem(processors, item, key) {
  for (const process2 of processors) {
    item = process2(item, key);
  }
  return item;
}
function defineProperty(obj, key, value) {
  const descriptor = /* @__PURE__ */ Object.create(null);
  descriptor.value = value;
  descriptor.writable = true;
  descriptor.enumerable = true;
  descriptor.configurable = true;
  Object.defineProperty(obj, key, descriptor);
}
function parseStringPromise(str, a3) {
  let options = {};
  if (typeof a3 === "object") {
    options = a3;
  }
  const parser2 = new Parser(options);
  return parser2.parseStringPromise(str);
}
async function parsexml(str, optionsParserOptions = {}) {
  const result = await parseStringPromise(str, optionsParserOptions);
  return result;
}
var import_path_browserify, import_events, import_sax, __defProp2, __defNormalProp, __publicField, defaults, Parser;
var init_index_browser = __esm({
  "node_modules/.pnpm/@lingo-reader+shared@0.4.6/node_modules/@lingo-reader/shared/dist/index.browser.mjs"() {
    import_path_browserify = __toESM(require_path_browserify(), 1);
    import_events = __toESM(require_events(), 1);
    import_sax = __toESM(require_sax(), 1);
    __defProp2 = Object.defineProperty;
    __defNormalProp = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
    __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    defaults = {
      0.1: {
        explicitCharkey: false,
        trim: true,
        // normalize implicates trimming, just so you know
        normalize: true,
        // normalize tag names to lower case
        normalizeTags: false,
        // set default attribute object key
        attrkey: "@",
        // set default char object key
        charkey: "#",
        // always put child nodes in an array
        explicitArray: false,
        // ignore all attributes regardless
        ignoreAttrs: false,
        // merge attributes and child elements onto parent object.  this may cause collisions.
        mergeAttrs: false,
        explicitRoot: false,
        validator: null,
        xmlns: false,
        // fold children elements into dedicated property (works only in 0.2)
        explicitChildren: false,
        childkey: "@@",
        charsAsChildren: false,
        // include white-space only text nodes
        includeWhiteChars: false,
        // callbacks are async? not in 0.1 mode
        async: false,
        strict: true,
        attrNameProcessors: null,
        attrValueProcessors: null,
        tagNameProcessors: null,
        valueProcessors: null,
        emptyTag: ""
      },
      0.2: {
        explicitCharkey: false,
        trim: false,
        normalize: false,
        normalizeTags: false,
        attrkey: "$",
        charkey: "_",
        explicitArray: true,
        ignoreAttrs: false,
        mergeAttrs: false,
        explicitRoot: true,
        validator: null,
        xmlns: false,
        explicitChildren: false,
        preserveChildrenOrder: false,
        childkey: "$$",
        charsAsChildren: false,
        // include white-space only text nodes
        includeWhiteChars: false,
        // not async in 0.2 mode either
        async: false,
        strict: true,
        attrNameProcessors: null,
        attrValueProcessors: null,
        tagNameProcessors: null,
        valueProcessors: null,
        // xml building options
        rootName: "root",
        xmldec: { version: "1.0", encoding: "UTF-8", standalone: true },
        doctype: null,
        renderOpts: { pretty: true, indent: "  ", newline: "\n" },
        headless: false,
        chunkSize: 1e4,
        emptyTag: "",
        cdata: false
      }
    };
    Parser = class extends import_events.EventEmitter {
      constructor(opts) {
        super();
        __publicField(this, "options");
        __publicField(this, "remaining", "");
        __publicField(this, "saxParser");
        __publicField(this, "resultObject", null);
        __publicField(this, "EXPLICIT_CHARKEY");
        __publicField(this, "errThrown", false);
        __publicField(this, "ended", false);
        __publicField(this, "processAsync", () => {
          try {
            if (this.remaining.length <= this.options.chunkSize) {
              const chunk = this.remaining;
              this.remaining = "";
              this.saxParser = this.saxParser.write(chunk);
              this.saxParser.close();
            } else {
              const chunk = this.remaining.slice(0, this.options.chunkSize);
              this.remaining = this.remaining.slice(this.options.chunkSize);
              this.saxParser = this.saxParser.write(chunk);
              setTimeout(this.processAsync, 0);
            }
          } catch (err2) {
            if (!this.errThrown) {
              this.errThrown = true;
              this.emit("error", err2);
            }
          }
        });
        __publicField(this, "assignOrPush", (obj, key, newValue) => {
          if (!(key in obj)) {
            if (!this.options.explicitArray) {
              defineProperty(obj, key, newValue);
            } else {
              defineProperty(obj, key, [newValue]);
            }
          } else {
            if (!Array.isArray(obj[key])) {
              defineProperty(obj, key, [obj[key]]);
            }
            obj[key].push(newValue);
          }
        });
        __publicField(this, "reset", () => {
          this.removeAllListeners();
          this.saxParser = import_sax.default.parser(this.options.strict, {
            trim: false,
            normalize: false,
            xmlns: this.options.xmlns
          });
          this.errThrown = false;
          this.saxParser.onerror = (error) => {
            this.saxParser.resume();
            if (!this.errThrown) {
              this.errThrown = true;
              this.emit("error", error);
            }
          };
          this.saxParser.onend = () => {
            if (!this.ended) {
              this.ended = true;
              this.emit("end", this.resultObject);
            }
          };
          this.ended = false;
          this.EXPLICIT_CHARKEY = this.options.explicitCharkey;
          this.resultObject = null;
          const stack = [];
          const attrkey = this.options.attrkey;
          const charkey = this.options.charkey;
          this.saxParser.onopentag = (node) => {
            const obj = {};
            obj[charkey] = "";
            if (!this.options.ignoreAttrs) {
              Object.keys(node.attributes).forEach((key) => {
                if (!(attrkey in obj) && !this.options.mergeAttrs) {
                  obj[attrkey] = {};
                }
                const newValue = this.options.attrValueProcessors ? processItem(this.options.attrValueProcessors, node.attributes[key], key) : node.attributes[key];
                const processedKey = this.options.attrNameProcessors ? processItem(this.options.attrNameProcessors, key) : key;
                if (this.options.mergeAttrs) {
                  this.assignOrPush(obj, processedKey, newValue);
                } else {
                  defineProperty(obj[attrkey], processedKey, newValue);
                }
              });
            }
            obj["#name"] = this.options.tagNameProcessors ? processItem(this.options.tagNameProcessors, node.name) : node.name;
            if (this.options.xmlns) {
              obj[this.options.xmlnskey] = { uri: node.uri, local: node.local };
            }
            stack.push(obj);
          };
          this.saxParser.onclosetag = () => {
            let obj = stack.pop();
            const nodeName = obj["#name"];
            if (!this.options.explicitChildren || !this.options.preserveChildrenOrder) {
              delete obj["#name"];
            }
            let cdata;
            if (obj.cdata === true) {
              cdata = obj.cdata;
              delete obj.cdata;
            }
            const s3 = stack[stack.length - 1];
            let emptyStr = "";
            if (obj[charkey].match(/^\s*$/) && !cdata) {
              emptyStr = obj[charkey];
              delete obj[charkey];
            } else {
              if (this.options.trim) {
                obj[charkey] = obj[charkey].trim();
              }
              if (this.options.normalize) {
                obj[charkey] = obj[charkey].replace(/\s{2,}/g, " ").trim();
              }
              obj[charkey] = this.options.valueProcessors ? processItem(this.options.valueProcessors, obj[charkey], nodeName) : obj[charkey];
              if (Object.keys(obj).length === 1 && charkey in obj && !this.EXPLICIT_CHARKEY) {
                obj = obj[charkey];
              }
            }
            if (isEmpty(obj)) {
              if (typeof this.options.emptyTag === "function") {
                obj = this.options.emptyTag();
              } else {
                obj = this.options.emptyTag !== "" ? this.options.emptyTag : emptyStr;
              }
            }
            if (this.options.validator) {
              const xpath = `/${stack.map((node) => node["#name"]).concat(nodeName).join("/")}`;
              (() => {
                try {
                  obj = this.options.validator(xpath, s3 && s3[nodeName], obj);
                } catch (err2) {
                  this.emit("error", err2);
                }
              })();
            }
            if (this.options.explicitChildren && !this.options.mergeAttrs && typeof obj === "object") {
              if (!this.options.preserveChildrenOrder) {
                const node = {};
                if (this.options.attrkey in obj) {
                  node[this.options.attrkey] = obj[this.options.attrkey];
                  delete obj[this.options.attrkey];
                }
                if (!this.options.charsAsChildren && this.options.charkey in obj) {
                  node[this.options.charkey] = obj[this.options.charkey];
                  delete obj[this.options.charkey];
                }
                if (Object.getOwnPropertyNames(obj).length > 0) {
                  node[this.options.childkey] = obj;
                }
                obj = node;
              } else if (s3) {
                s3[this.options.childkey] = s3[this.options.childkey] || [];
                const objClone = {};
                Object.keys(obj).forEach((key) => {
                  defineProperty(objClone, key, obj[key]);
                });
                s3[this.options.childkey].push(objClone);
                delete obj["#name"];
                if (Object.keys(obj).length === 1 && charkey in obj && !this.EXPLICIT_CHARKEY) {
                  obj = obj[charkey];
                }
              }
            }
            if (stack.length > 0) {
              this.assignOrPush(s3, nodeName, obj);
            } else {
              if (this.options.explicitRoot) {
                const old = obj;
                const newObj = {};
                defineProperty(newObj, nodeName, old);
                obj = newObj;
              }
              this.resultObject = obj;
              this.ended = true;
              this.emit("end", this.resultObject);
            }
          };
          const ontext = (text) => {
            const s3 = stack[stack.length - 1];
            if (s3) {
              s3[charkey] += text;
              if (this.options.explicitChildren && this.options.preserveChildrenOrder && this.options.charsAsChildren && (this.options.includeWhiteChars || text.replace(/\\n/g, "").trim() !== "")) {
                s3[this.options.childkey] = s3[this.options.childkey] || [];
                const charChild = {
                  "#name": "__text__"
                };
                charChild[charkey] = text;
                if (this.options.normalize) {
                  charChild[charkey] = charChild[charkey].replace(/\s{2,}/g, " ").trim();
                }
                s3[this.options.childkey].push(charChild);
              }
            }
            return s3;
          };
          this.saxParser.ontext = ontext;
          this.saxParser.oncdata = (text) => {
            const s3 = ontext(text);
            if (s3) {
              s3.cdata = true;
            }
          };
        });
        __publicField(this, "parseString", (str, cb) => {
          if (cb && typeof cb === "function") {
            this.on("end", (result) => {
              this.reset();
              cb(null, result);
            });
            this.on("error", (err2) => {
              this.reset();
              cb(err2);
            });
          }
          try {
            str = str.toString();
            if (str.trim() === "") {
              this.emit("end", null);
              return true;
            }
            str = stripBOM(str);
            if (this.options.async) {
              this.remaining = str;
              setTimeout(this.processAsync, 0);
              return this.saxParser;
            }
            return this.saxParser.write(str).close();
          } catch (err2) {
            if (!this.errThrown && !this.ended) {
              this.emit("error", err2);
              this.errThrown = true;
            } else if (this.ended) {
              throw err2;
            }
          }
        });
        __publicField(this, "parseStringPromise", (str) => {
          return new Promise((resolve, reject) => {
            this.parseString(str, (err2, value) => {
              if (err2) {
                reject(err2);
              } else {
                resolve(value);
              }
            });
          });
        });
        this.options = {};
        Object.keys(defaults["0.2"]).forEach((key) => {
          this.options[key] = defaults["0.2"][key];
        });
        if (opts) {
          Object.keys(opts).forEach((key) => {
            this.options[key] = opts[key];
          });
        }
        if (this.options.xmlns) {
          this.options.xmlnskey = `${this.options.attrkey}ns`;
        }
        if (this.options.normalizeTags) {
          if (!this.options.tagNameProcessors) {
            this.options.tagNameProcessors = [];
          }
          this.options.tagNameProcessors.unshift(normalize);
        }
        this.reset();
      }
    };
  }
});

// node_modules/.pnpm/@lingo-reader+mobi-parser@0.4.6/node_modules/@lingo-reader/mobi-parser/dist/index.browser.mjs
var index_browser_exports = {};
__export(index_browser_exports, {
  initKf8File: () => initKf8File,
  initMobiFile: () => initMobiFile
});
function unescapeHTML2(str) {
  if (!str.includes("&")) {
    return str;
  }
  return str.replace(/&(#x[\dA-Fa-f]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    } else if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    } else {
      return htmlEntityMap[match] || match;
    }
  });
}
function getFileMimeType(fileBuffer) {
  const header = fileBuffer.slice(0, 12);
  const hexHeader = Array.from(header).map((b3) => b3.toString(16).padStart(2, "0")).join("");
  for (const [signature, type] of Object.entries(fileSignatures)) {
    if (hexHeader.startsWith(signature)) {
      return type;
    }
  }
  return "unknown";
}
function saveResource(data, type, filename, imageSaveDir) {
  {
    return URL.createObjectURL(new Blob([data], { type }));
  }
}
function getMobiFileName(file) {
  let fileName = "";
  {
    fileName = file.name ?? "";
  }
  return fileName;
}
function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
async function toArrayBuffer(file) {
  {
    return file instanceof Uint8Array ? bufferToArrayBuffer(file) : await file.arrayBuffer();
  }
}
function getUint2(buffer) {
  const l3 = buffer.byteLength;
  const func = l3 === 4 ? "getUint32" : l3 === 2 ? "getUint16" : "getUint8";
  return new DataView(buffer)[func](0);
}
function getStruct2(def, buffer) {
  const res = {};
  for (const key in def) {
    const [start, len, type] = def[key];
    res[key] = type === "string" ? getString2(buffer.slice(start, start + len)) : getUint2(buffer.slice(start, start + len));
  }
  return res;
}
function concatTypedArrays(arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new arrays[0].constructor(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}
function getVarLen2(byteArray, i3 = 0) {
  let value = 0;
  let length = 0;
  for (const byte of byteArray.subarray(i3, i3 + 4)) {
    value = value << 7 | (byte & 127) >>> 0;
    length++;
    if (byte & 128) {
      break;
    }
  }
  return { value, length };
}
function getVarLenFromEnd2(byteArray) {
  let value = 0;
  for (const byte of byteArray.subarray(-4)) {
    if (byte & 128) {
      value = 0;
    }
    value = value << 7 | byte & 127;
  }
  return value;
}
function countBitsSet2(x3) {
  let count = 0;
  for (; x3 > 0; x3 = x3 >> 1) {
    if ((x3 & 1) === 1) {
      count++;
    }
  }
  return count;
}
function countUnsetEnd2(x3) {
  let count = 0;
  while ((x3 & 1) === 0) {
    x3 = x3 >> 1;
    count++;
  }
  return count;
}
function decompressPalmDOC2(array) {
  const output = [];
  for (let i3 = 0; i3 < array.length; i3++) {
    const byte = array[i3];
    if (byte === 0) {
      output.push(0);
    } else if (byte <= 8) {
      for (const x3 of array.subarray(i3 + 1, (i3 += byte) + 1))
        output.push(x3);
    } else if (byte <= 127) {
      output.push(byte);
    } else if (byte <= 191) {
      const bytes = byte << 8 | array[i3++ + 1];
      const distance = (bytes & 16383) >>> 3;
      const length = (bytes & 7) + 3;
      for (let j2 = 0; j2 < length; j2++)
        output.push(output[output.length - distance]);
    } else {
      output.push(32, byte ^ 128);
    }
  }
  return Uint8Array.from(output);
}
function huffcdic2(mobi, loadRecord) {
  const huffRecord = loadRecord(mobi.huffcdic);
  const { magic, offset1, offset2 } = getStruct2(huffHeader, huffRecord);
  if (magic !== "HUFF") {
    throw new Error("Invalid HUFF record");
  }
  const table1 = Array.from(
    { length: 256 },
    (_2, i3) => offset1 + i3 * 4
  ).map((offset) => getUint2(huffRecord.slice(offset, offset + 4))).map((x3) => [x3 & 128, x3 & 31, x3 >>> 8]);
  const table2 = [[0, 0], ...Array.from(
    { length: 32 },
    (_2, i3) => offset2 + i3 * 8
  ).map((offset) => [
    getUint2(huffRecord.slice(offset, offset + 4)),
    getUint2(huffRecord.slice(offset + 4, offset + 8))
  ])];
  const dictionary = [];
  for (let i3 = 1; i3 < mobi.numHuffcdic; i3++) {
    const record = loadRecord(mobi.huffcdic + i3);
    const cdic = getStruct2(cdicHeader, record);
    if (cdic.magic !== "CDIC") {
      throw new Error("Invalid CDIC record");
    }
    const n3 = Math.min(1 << cdic.codeLength, cdic.numEntries - dictionary.length);
    const buffer = record.slice(cdic.length);
    for (let i22 = 0; i22 < n3; i22++) {
      const offset = getUint2(buffer.slice(i22 * 2, i22 * 2 + 2));
      const x3 = getUint2(buffer.slice(offset, offset + 2));
      const length = x3 & 32767;
      const decompressed = x3 & 32768;
      const value = new Uint8Array(buffer.slice(offset + 2, offset + 2 + length));
      dictionary.push([value, decompressed]);
    }
  }
  const decompress = (byteArray) => {
    let output = new Uint8Array();
    const bitLength = byteArray.byteLength * 8;
    for (let i3 = 0; i3 < bitLength; ) {
      const bits2 = Number(read32Bits2(byteArray, i3));
      let [found, codeLength, value] = table1[bits2 >>> 24];
      if (!found) {
        while (bits2 >>> 32 - codeLength < table2[codeLength][0])
          codeLength += 1;
        value = table2[codeLength][1];
      }
      i3 += codeLength;
      if (i3 > bitLength) {
        break;
      }
      const code = value - (bits2 >>> 32 - codeLength);
      let [result, decompressed] = dictionary[code];
      if (!decompressed) {
        result = decompress(result);
        dictionary[code] = [result, true];
      }
      output = concatTypedArrays([output, result]);
    }
    return output;
  };
  return decompress;
}
function read32Bits2(byteArray, from) {
  const startByte = from >> 3;
  const end = from + 32;
  const endByte = end >> 3;
  let bits2 = 0n;
  for (let i3 = startByte; i3 <= endByte; i3++) {
    bits2 = bits2 << 8n | BigInt(byteArray[i3] ?? 0);
  }
  return bits2 >> 8n - BigInt(end & 7) & 0xFFFFFFFFn;
}
function getExth(buf, encoding) {
  const { magic, count } = getStruct2(exthHeader, buf);
  if (magic !== "EXTH") {
    throw new Error("Invalid EXTH header");
  }
  const decoder22 = getDecoder2(encoding.toString());
  const results = {};
  let offset = 12;
  for (let i3 = 0; i3 < count; i3++) {
    const type = getUint2(buf.slice(offset, offset + 4));
    const length = getUint2(buf.slice(offset + 4, offset + 8));
    if (type in exthRecordType) {
      const [name, typ, ismany] = exthRecordType[type];
      const data = buf.slice(offset + 8, offset + length);
      const value = typ === "uint" ? getUint2(data) : decoder22.decode(data);
      if (ismany) {
        results[name] ?? (results[name] = []);
        results[name].push(value);
      } else {
        results[name] = value;
      }
    }
    offset += length;
  }
  return results;
}
function getRemoveTrailingEntries(trailingFlags) {
  const multibyte = trailingFlags & 1;
  const numTrailingEntries = countBitsSet2(trailingFlags >>> 1);
  return (array) => {
    for (let i3 = 0; i3 < numTrailingEntries; i3++) {
      const length = getVarLenFromEnd2(array);
      array = array.subarray(0, -length);
    }
    if (multibyte) {
      const length = (array[array.length - 1] & 3) + 1;
      array = array.subarray(0, -length);
    }
    return array;
  };
}
function getFont2(buf) {
  const { flags, dataStart, keyLength, keyStart } = getStruct2(fontHeader, buf);
  const array = new Uint8Array(buf.slice(dataStart));
  if (flags & 2) {
    const bytes = keyLength === 16 ? 1024 : 1040;
    const key = new Uint8Array(buf.slice(keyStart, keyStart + keyLength));
    const length = Math.min(bytes, array.length);
    for (let i3 = 0; i3 < length; i3++) array[i3] = array[i3] ^ key[i3 % key.length];
  }
  if (flags & 1) {
    try {
      return unzlibSync(array);
    } catch (e3) {
      console.warn(e3);
      console.warn("Failed to decompress font");
    }
  }
  return array;
}
function getIndexData2(indxIndex, loadRecord) {
  const indxRecord = loadRecord(indxIndex);
  const indx = getStruct2(indxHeader, indxRecord);
  if (indx.magic !== "INDX")
    throw new Error("Invalid INDX record");
  const decoder22 = getDecoder2(indx.encoding.toString());
  const cncx = {};
  let cncxRecordOffset = 0;
  for (let i3 = 0; i3 < indx.numCncx; i3++) {
    const record = loadRecord(indxIndex + indx.numRecords + i3 + 1);
    const array = new Uint8Array(record);
    for (let pos = 0; pos < array.byteLength; ) {
      const index = pos;
      const { value, length } = getVarLen2(array, pos);
      pos += length;
      const result = record.slice(pos, pos + value);
      pos += value;
      cncx[cncxRecordOffset + index] = decoder22.decode(result);
    }
    cncxRecordOffset += 65536;
  }
  const tagxBuffer = indxRecord.slice(indx.length);
  const tagx = getStruct2(tagxHeader, tagxBuffer);
  if (tagx.magic !== "TAGX")
    throw new Error("Invalid TAGX section");
  const numTags = (tagx.length - 12) / 4;
  const tagTable = Array.from(
    { length: numTags },
    (_2, i3) => new Uint8Array(tagxBuffer.slice(12 + i3 * 4, 12 + i3 * 4 + 4))
  );
  const table = [];
  for (let i3 = 0; i3 < indx.numRecords; i3++) {
    const record = loadRecord(indxIndex + 1 + i3);
    const array = new Uint8Array(record);
    const indx2 = getStruct2(indxHeader, record);
    if (indx2.magic !== "INDX") {
      throw new Error("Invalid INDX record");
    }
    for (let j2 = 0; j2 < indx2.numRecords; j2++) {
      const offsetOffset = indx2.idxt + 4 + 2 * j2;
      const offset = getUint2(record.slice(offsetOffset, offsetOffset + 2));
      const length = getUint2(record.slice(offset, offset + 1));
      const name = getString2(record.slice(offset + 1, offset + 1 + length));
      const tags = [];
      const startPos = offset + 1 + length;
      let controlByteIndex = 0;
      let pos = startPos + tagx.numControlBytes;
      for (const [tag, numValues, mask, end] of tagTable) {
        if (end & 1) {
          controlByteIndex++;
          continue;
        }
        const offset2 = startPos + controlByteIndex;
        const value = getUint2(record.slice(offset2, offset2 + 1)) & mask;
        if (value === mask) {
          if (countBitsSet2(mask) > 1) {
            const { value: value2, length: length2 } = getVarLen2(array, pos);
            tags.push([tag, 0, value2, numValues]);
            pos += length2;
          } else {
            tags.push([tag, 1, 0, numValues]);
          }
        } else {
          tags.push([tag, value >> countUnsetEnd2(mask), 0, numValues]);
        }
      }
      const tagMap = {};
      for (const [tag, valueCount, valueBytes, numValues] of tags) {
        const values = [];
        if (valueCount !== 0) {
          for (let i22 = 0; i22 < valueCount * numValues; i22++) {
            const { value, length: length2 } = getVarLen2(array, pos);
            values.push(value);
            pos += length2;
          }
        } else {
          let count = 0;
          while (count < valueBytes) {
            const { value, length: length2 } = getVarLen2(array, pos);
            values.push(value);
            pos += length2;
            count += length2;
          }
        }
        tagMap[tag] = values;
      }
      table.push({ name, tagMap });
    }
  }
  return { table, cncx };
}
function getNCX2(indxIndex, loadRecord) {
  const { table, cncx } = getIndexData2(indxIndex, loadRecord);
  const items = table.map(({ tagMap }, index) => ({
    index,
    offset: tagMap[1]?.[0],
    size: tagMap[2]?.[0],
    label: cncx[tagMap[3]?.[0]] ?? "",
    headingLevel: tagMap[4]?.[0],
    pos: tagMap[6],
    parent: tagMap[21]?.[0],
    firstChild: tagMap[22]?.[0],
    lastChild: tagMap[23]?.[0]
  }));
  const getChildren = (item) => {
    if (item.firstChild == null)
      return item;
    item.children = items.filter((x3) => x3.parent === item.index).map(getChildren);
    return item;
  };
  return items.filter((item) => item.headingLevel === 0).map(getChildren);
}
function makePosURI2(fid = 0, off = 0) {
  return `kindle:pos:fid:${fid.toString(32).toUpperCase().padStart(4, "0")}:off:${off.toString(32).toUpperCase().padStart(10, "0")}`;
}
function getFragmentSelector2(str) {
  const match = str.match(selectorReg);
  if (!match) {
    return "";
  }
  const [, attr, value] = match;
  return `[${attr}="${value}"]`;
}
function parsePosURI2(str) {
  const [fid, off] = str.match(kindlePosRegex2).slice(1);
  return {
    fid: Number.parseInt(fid, 32),
    off: Number.parseInt(off, 32)
  };
}
async function initKf8File(file, resourceSaveDir) {
  const kf8 = new Kf8(file, resourceSaveDir);
  await kf8.innerLoadFile();
  await kf8.innerInit();
  return kf8;
}
async function initMobiFile(file, resourceSaveDir) {
  const mobi = new Mobi(file, resourceSaveDir);
  await mobi.innerLoadFile();
  await mobi.innerInit();
  return mobi;
}
var htmlEntityMap, MIME4, fileSignatures, mobiEncoding, mobiLang, pdbHeader, palmdocHeader, mobiHeader, kf8Header, exthHeader, indxHeader, tagxHeader, huffHeader, cdicHeader, fdstHeader, fontHeader, decoder2, getString2, getDecoder2, exthRecordType, mbpPagebreakRegex2, selectorReg, kindlePosRegex2, kindleResourceRegex2, __defProp$2, __defNormalProp$2, __publicField$2, MobiFile, __defProp$1, __defNormalProp$1, __publicField$1, Kf8, __defProp3, __defNormalProp2, __publicField2, Mobi;
var init_index_browser2 = __esm({
  "node_modules/.pnpm/@lingo-reader+mobi-parser@0.4.6/node_modules/@lingo-reader/mobi-parser/dist/index.browser.mjs"() {
    init_browser();
    init_index_browser();
    htmlEntityMap = {
      "&lt;": "<",
      "&gt;": ">",
      "&amp;": "&",
      "&quot;": '"',
      "&#39;": "'"
    };
    MIME4 = {
      XML: "application/xml",
      XHTML: "application/xhtml+xml",
      HTML: "text/html",
      CSS: "text/css",
      SVG: "image/svg+xml"
    };
    fileSignatures = {
      "ffd8ff": "image/jpeg",
      "89504e47": "image/png",
      "47494638": "image/gif",
      "424d": "image/bmp",
      "3c737667": "image/svg+xml",
      "00000018": "video/mp4",
      "00000020": "video/mp4",
      "1a45dfa3": "video/mkv",
      "1f43b675": "video/webm",
      "494433": "audio/mp3",
      "52494646": "audio/wav",
      "4f676753": "audio/ogg",
      "00010000": "font/ttf",
      "74727565": "font/ttf",
      "4f54544f": "font/otf",
      "774f4646": "font/woff",
      "774f4632": "font/woff2",
      "504c": "font/eot"
    };
    mobiEncoding = {
      1252: "windows-1252",
      65001: "utf-8"
    };
    mobiLang = {
      1: ["ar", "ar-SA", "ar-IQ", "ar-EG", "ar-LY", "ar-DZ", "ar-MA", "ar-TN", "ar-OM", "ar-YE", "ar-SY", "ar-JO", "ar-LB", "ar-KW", "ar-AE", "ar-BH", "ar-QA"],
      2: ["bg"],
      3: ["ca"],
      4: ["zh", "zh-TW", "zh-CN", "zh-HK", "zh-SG"],
      5: ["cs"],
      6: ["da"],
      7: ["de", "de-DE", "de-CH", "de-AT", "de-LU", "de-LI"],
      8: ["el"],
      9: ["en", "en-US", "en-GB", "en-AU", "en-CA", "en-NZ", "en-IE", "en-ZA", "en-JM", null, "en-BZ", "en-TT", "en-ZW", "en-PH"],
      10: ["es", "es-ES", "es-MX", null, "es-GT", "es-CR", "es-PA", "es-DO", "es-VE", "es-CO", "es-PE", "es-AR", "es-EC", "es-CL", "es-UY", "es-PY", "es-BO", "es-SV", "es-HN", "es-NI", "es-PR"],
      11: ["fi"],
      12: ["fr", "fr-FR", "fr-BE", "fr-CA", "fr-CH", "fr-LU", "fr-MC"],
      13: ["he"],
      14: ["hu"],
      15: ["is"],
      16: ["it", "it-IT", "it-CH"],
      17: ["ja"],
      18: ["ko"],
      19: ["nl", "nl-NL", "nl-BE"],
      20: ["no", "nb", "nn"],
      21: ["pl"],
      22: ["pt", "pt-BR", "pt-PT"],
      23: ["rm"],
      24: ["ro"],
      25: ["ru"],
      26: ["hr", null, "sr"],
      27: ["sk"],
      28: ["sq"],
      29: ["sv", "sv-SE", "sv-FI"],
      30: ["th"],
      31: ["tr"],
      32: ["ur"],
      33: ["id"],
      34: ["uk"],
      35: ["be"],
      36: ["sl"],
      37: ["et"],
      38: ["lv"],
      39: ["lt"],
      41: ["fa"],
      42: ["vi"],
      43: ["hy"],
      44: ["az"],
      45: ["eu"],
      46: ["hsb"],
      47: ["mk"],
      48: ["st"],
      49: ["ts"],
      50: ["tn"],
      52: ["xh"],
      53: ["zu"],
      54: ["af"],
      55: ["ka"],
      56: ["fo"],
      57: ["hi"],
      58: ["mt"],
      59: ["se"],
      62: ["ms"],
      63: ["kk"],
      65: ["sw"],
      67: ["uz", null, "uz-UZ"],
      68: ["tt"],
      69: ["bn"],
      70: ["pa"],
      71: ["gu"],
      72: ["or"],
      73: ["ta"],
      74: ["te"],
      75: ["kn"],
      76: ["ml"],
      77: ["as"],
      78: ["mr"],
      79: ["sa"],
      82: ["cy", "cy-GB"],
      83: ["gl", "gl-ES"],
      87: ["kok"],
      97: ["ne"],
      98: ["fy"]
    };
    pdbHeader = {
      name: [0, 32, "string"],
      type: [60, 4, "string"],
      creator: [64, 4, "string"],
      numRecords: [76, 2, "uint"]
    };
    palmdocHeader = {
      compression: [0, 2, "uint"],
      numTextRecords: [8, 2, "uint"],
      recordSize: [10, 2, "uint"],
      encryption: [12, 2, "uint"]
    };
    mobiHeader = {
      magic: [16, 4, "string"],
      length: [20, 4, "uint"],
      type: [24, 4, "uint"],
      encoding: [28, 4, "uint"],
      uid: [32, 4, "uint"],
      version: [36, 4, "uint"],
      titleOffset: [84, 4, "uint"],
      titleLength: [88, 4, "uint"],
      localeRegion: [94, 1, "uint"],
      localeLanguage: [95, 1, "uint"],
      resourceStart: [108, 4, "uint"],
      huffcdic: [112, 4, "uint"],
      numHuffcdic: [116, 4, "uint"],
      exthFlag: [128, 4, "uint"],
      trailingFlags: [240, 4, "uint"],
      indx: [244, 4, "uint"]
    };
    kf8Header = {
      resourceStart: [108, 4, "uint"],
      fdst: [192, 4, "uint"],
      numFdst: [196, 4, "uint"],
      frag: [248, 4, "uint"],
      skel: [252, 4, "uint"],
      guide: [260, 4, "uint"]
    };
    exthHeader = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      count: [8, 4, "uint"]
    };
    indxHeader = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      type: [8, 4, "uint"],
      idxt: [20, 4, "uint"],
      numRecords: [24, 4, "uint"],
      encoding: [28, 4, "uint"],
      language: [32, 4, "uint"],
      total: [36, 4, "uint"],
      ordt: [40, 4, "uint"],
      ligt: [44, 4, "uint"],
      numLigt: [48, 4, "uint"],
      numCncx: [52, 4, "uint"]
    };
    tagxHeader = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      numControlBytes: [8, 4, "uint"]
    };
    huffHeader = {
      magic: [0, 4, "string"],
      offset1: [8, 4, "uint"],
      offset2: [12, 4, "uint"]
    };
    cdicHeader = {
      magic: [0, 4, "string"],
      length: [4, 4, "uint"],
      numEntries: [8, 4, "uint"],
      codeLength: [12, 4, "uint"]
    };
    fdstHeader = {
      magic: [0, 4, "string"],
      numEntries: [8, 4, "uint"]
    };
    fontHeader = {
      flags: [8, 4, "uint"],
      dataStart: [12, 4, "uint"],
      keyLength: [16, 4, "uint"],
      keyStart: [20, 4, "uint"]
    };
    decoder2 = new TextDecoder();
    getString2 = (buffer) => decoder2.decode(buffer);
    getDecoder2 = (x3) => new TextDecoder(mobiEncoding[x3]);
    exthRecordType = {
      100: ["creator", "string", true],
      // many
      101: ["publisher", "string", false],
      103: ["description", "string", false],
      104: ["isbn", "string", false],
      105: ["subject", "string", true],
      // many
      106: ["date", "string", false],
      108: ["contributor", "string", true],
      // many
      109: ["rights", "string", false],
      110: ["subjectCode", "string", true],
      // many
      112: ["source", "string", true],
      // many
      113: ["asin", "string", false],
      121: ["boundary", "uint", false],
      122: ["fixedLayout", "string", false],
      125: ["numResources", "uint", false],
      126: ["originalResolution", "string", false],
      127: ["zeroGutter", "string", false],
      128: ["zeroMargin", "string", false],
      129: ["coverURI", "string", false],
      132: ["regionMagnification", "string", false],
      201: ["coverOffset", "uint", false],
      202: ["thumbnailOffset", "uint", false],
      503: ["title", "string", false],
      524: ["language", "string", true],
      // many
      527: ["pageProgressionDirection", "string", false]
    };
    mbpPagebreakRegex2 = /<\s*(?:mbp:)?pagebreak[^>]*>/gi;
    selectorReg = /\s(id|name|aid)\s*=\s*['"]([^'"]*)['"]/i;
    kindlePosRegex2 = /kindle:pos:fid:(\w+):off:(\w+)/;
    kindleResourceRegex2 = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/;
    __defProp$2 = Object.defineProperty;
    __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
    __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, typeof key !== "symbol" ? key + "" : key, value);
    MobiFile = class {
      constructor(file, fileName) {
        __publicField$2(this, "fileArrayBuffer");
        __publicField$2(this, "recordsOffset");
        __publicField$2(this, "recordsMagic");
        __publicField$2(this, "start", 0);
        __publicField$2(this, "pdbHeader");
        __publicField$2(this, "mobiHeader");
        __publicField$2(this, "palmdocHeader");
        __publicField$2(this, "kf8Header");
        __publicField$2(this, "exth");
        __publicField$2(this, "isKf8", false);
        __publicField$2(this, "resourceStart");
        __publicField$2(this, "decoder");
        __publicField$2(this, "encoder");
        __publicField$2(this, "removeTrailingEntries");
        __publicField$2(this, "decompress");
        this.fileArrayBuffer = file;
        this.parsePdbHeader();
        this.parseFirstRecord(this.loadRecord(0));
        this.resourceStart = this.mobiHeader.resourceStart;
        if (!this.isKf8) {
          const boundary = this.exth.boundary ?? 4294967295;
          if (boundary < 4294967295) {
            try {
              this.parseFirstRecord(this.loadRecord(boundary));
              this.start = boundary;
              this.isKf8 = true;
            } catch (e3) {
              console.warn("Failed to parse kf8 header.");
            }
            if (fileName.endsWith(".mobi")) {
              console.warn(`File "${fileName}" is a compatible file. Please change the file extension to .azw3 to make it parse correctly.`);
            }
          }
        }
        this.setup();
      }
      decode(arr) {
        return this.decoder.decode(arr);
      }
      encode(str) {
        return this.encoder.encode(str);
      }
      pdbLoadRecord(index) {
        const [start, end] = this.recordsOffset[index] ?? [0, 0];
        return this.fileArrayBuffer.slice(start, end);
      }
      loadRecord(index) {
        return this.pdbLoadRecord(this.start + index);
      }
      loadMagic(index) {
        return this.recordsMagic[this.start + index];
      }
      loadTextBuffer(index) {
        return this.decompress(
          this.removeTrailingEntries(
            new Uint8Array(
              this.loadRecord(index + 1)
            )
          )
        );
      }
      loadResource(index) {
        const buf = this.pdbLoadRecord(this.resourceStart + index);
        const magic = getString2(buf.slice(0, 4));
        let data;
        if (magic === "FONT") {
          data = getFont2(buf);
        } else if (magic === "VIDE" || magic === "AUDI") {
          data = new Uint8Array(buf.slice(12));
        } else {
          data = new Uint8Array(buf);
        }
        return {
          type: getFileMimeType(data),
          raw: data
        };
      }
      getNCX() {
        const index = this.mobiHeader.indx;
        if (index < 4294967295) {
          return getNCX2(index, this.loadRecord.bind(this));
        }
        return void 0;
      }
      getMetadata() {
        const mobi = this.mobiHeader;
        const exth = this.exth;
        return {
          identifier: this.mobiHeader.uid.toString(),
          title: exth?.title || mobi.title,
          author: exth?.creator?.map(unescapeHTML2) ?? [],
          publisher: exth?.publisher ?? "",
          // language in exth is many, we use the first one in this case
          language: exth?.language?.[0] ?? mobi.language,
          published: exth?.date ?? "",
          description: exth?.description ?? "",
          subject: exth?.subject?.map(unescapeHTML2) ?? [],
          rights: exth?.rights ?? "",
          contributor: exth?.contributor ?? []
        };
      }
      getCoverImage() {
        const exth = this.exth;
        const coverOffset = Number(exth.coverOffset ?? 4294967295);
        const thumbnailOffset = Number(exth.thumbnailOffset ?? 4294967295);
        const offset = coverOffset < 4294967295 ? coverOffset : thumbnailOffset < 4294967295 ? thumbnailOffset : void 0;
        if (offset) {
          return this.loadResource(offset);
        }
        return void 0;
      }
      parsePdbHeader() {
        const pdb = getStruct2(pdbHeader, this.fileArrayBuffer.slice(0, 78));
        pdb.name = pdb.name.replace(/\0.*$/, "");
        this.pdbHeader = pdb;
        const recordsBuffer = this.fileArrayBuffer.slice(78, 78 + pdb.numRecords * 8);
        const recordsStart = Array.from(
          { length: pdb.numRecords },
          (_2, i3) => getUint2(recordsBuffer.slice(i3 * 8, i3 * 8 + 4))
        );
        this.recordsOffset = recordsStart.map(
          (start, i3) => [start, recordsStart[i3 + 1]]
        );
        this.recordsMagic = recordsStart.map(
          (val) => getString2(this.fileArrayBuffer.slice(val, val + 4))
        );
      }
      // palmdocHeader, mobiHeader, isKf8, exth
      parseFirstRecord(firstRecord) {
        this.palmdocHeader = getStruct2(palmdocHeader, firstRecord.slice(0, 16));
        const mobi = getStruct2(mobiHeader, firstRecord);
        if (mobi.magic !== "MOBI") {
          throw new Error("Missing MOBI header");
        }
        const { titleOffset, titleLength, localeLanguage, localeRegion } = mobi;
        const lang = mobiLang[localeLanguage.toString()] ?? [];
        const mobiHeaderExtends = {
          title: getString2(firstRecord.slice(titleOffset, titleOffset + titleLength)),
          language: lang[localeRegion >> 2] ?? lang[0] ?? "unknown"
        };
        this.mobiHeader = Object.assign(mobi, mobiHeaderExtends);
        this.kf8Header = mobi.version >= 8 ? getStruct2(kf8Header, firstRecord) : void 0;
        this.isKf8 = mobi.version >= 8;
        this.exth = mobi.exthFlag & 64 ? getExth(firstRecord.slice(mobi.length + 16), mobi.encoding) : void 0;
      }
      // setup decoder, encoder, decompress, removeTrailingEntries
      setup() {
        this.decoder = getDecoder2(this.mobiHeader.encoding.toString());
        this.encoder = new TextEncoder();
        const compression = this.palmdocHeader.compression;
        if (compression === 1) {
          this.decompress = (f3) => f3;
        } else if (compression === 2) {
          this.decompress = decompressPalmDOC2;
        } else if (compression === 17480) {
          this.decompress = huffcdic2(this.mobiHeader, this.loadRecord.bind(this));
        } else {
          throw new Error("Unsupported compression");
        }
        const trailingFlags = this.mobiHeader.trailingFlags;
        this.removeTrailingEntries = getRemoveTrailingEntries(trailingFlags);
      }
    };
    __defProp$1 = Object.defineProperty;
    __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
    __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
    Kf8 = class {
      constructor(file, resourceSaveDir = "./images") {
        this.file = file;
        __publicField$1(this, "fileArrayBuffer");
        __publicField$1(this, "mobiFile");
        __publicField$1(this, "fileName", "");
        __publicField$1(this, "fdstTable", []);
        __publicField$1(this, "fullRawLength", 0);
        __publicField$1(this, "skelTable", []);
        __publicField$1(this, "fragTable", []);
        __publicField$1(this, "chapters", []);
        __publicField$1(this, "toc", []);
        __publicField$1(this, "fragmentOffsets", /* @__PURE__ */ new Map());
        __publicField$1(this, "fragmentSelectors", /* @__PURE__ */ new Map());
        __publicField$1(this, "rawHead", new Uint8Array());
        __publicField$1(this, "rawTail", new Uint8Array());
        __publicField$1(this, "lastLoadedHead", -1);
        __publicField$1(this, "lastLoadedTail", -1);
        __publicField$1(this, "resourceCache", /* @__PURE__ */ new Map());
        __publicField$1(this, "chapterCache", /* @__PURE__ */ new Map());
        __publicField$1(this, "idToChapter", /* @__PURE__ */ new Map());
        __publicField$1(this, "resourceSaveDir", "./images");
        this.fileName = getMobiFileName(file);
        this.resourceSaveDir = resourceSaveDir;
      }
      getFileInfo() {
        return {
          fileName: this.fileName
        };
      }
      getMetadata() {
        return this.mobiFile.getMetadata();
      }
      getCoverImage() {
        if (this.resourceCache.has("cover")) {
          return this.resourceCache.get("cover");
        }
        const coverImage = this.mobiFile.getCoverImage();
        let coverUrl = "";
        if (coverImage) {
          coverUrl = saveResource(coverImage.raw, coverImage.type, "cover", this.resourceSaveDir);
          this.resourceCache.set("cover", coverUrl);
        }
        return coverUrl;
      }
      getSpine() {
        return this.chapters;
      }
      getToc() {
        return this.toc;
      }
      async innerLoadFile() {
        this.fileArrayBuffer = await toArrayBuffer(this.file);
        this.mobiFile = new MobiFile(this.fileArrayBuffer, this.fileName);
      }
      async innerInit() {
        const loadRecord = this.mobiFile.loadRecord.bind(this.mobiFile);
        const kf8Header2 = this.mobiFile.kf8Header;
        const fdstBuffer = this.mobiFile.loadRecord(kf8Header2.fdst);
        const fdst = getStruct2(fdstHeader, fdstBuffer);
        if (fdst.magic !== "FDST") {
          throw new Error("Missing FDST record");
        }
        const fdstTable = Array.from(
          { length: fdst.numEntries },
          (_2, i3) => 12 + i3 * 8
        ).map((offset) => [
          getUint2(fdstBuffer.slice(offset, offset + 4)),
          getUint2(fdstBuffer.slice(offset + 4, offset + 8))
        ]);
        this.fdstTable = fdstTable;
        this.fullRawLength = fdstTable[fdstTable.length - 1][1];
        const skelData = getIndexData2(kf8Header2.skel, loadRecord);
        const skelTable = skelData.table.map(({ name, tagMap }, index) => ({
          index,
          name,
          numFrag: tagMap[1][0],
          offset: tagMap[6][0],
          length: tagMap[6][1]
        }));
        this.skelTable = skelTable;
        const fragData = getIndexData2(kf8Header2.frag, loadRecord);
        const fragTable = fragData.table.map(({ name, tagMap }) => ({
          insertOffset: Number.parseInt(name),
          selector: fragData.cncx[tagMap[2][0]],
          index: tagMap[4][0],
          offset: tagMap[6][0],
          length: tagMap[6][1]
        }));
        this.fragTable = fragTable;
        const chapters = this.skelTable.reduce((acc, skel, index) => {
          const last = acc[acc.length - 1];
          const fragStart = last?.fragEnd ?? 0;
          const fragEnd = fragStart + skel.numFrag;
          const frags = this.fragTable.slice(fragStart, fragEnd);
          const length = skel.length + frags.reduce((a3, v3) => a3 + v3.length, 0);
          const totalLength = (last?.totalLength ?? 0) + length;
          const chapter = { id: index.toString(), skel, frags, fragEnd, length, totalLength };
          this.idToChapter.set(index, chapter);
          acc.push(chapter);
          return acc;
        }, []);
        this.chapters = chapters;
        const ncx = this.mobiFile.getNCX();
        if (ncx) {
          const map = ({ label, pos, children }) => {
            const [fid, off] = pos;
            const href = makePosURI2(fid, off);
            const arr = this.fragmentOffsets.get(fid);
            if (arr) {
              arr.push(off);
            } else {
              this.fragmentOffsets.set(fid, [off]);
            }
            return { label, href, children: children?.map(map) };
          };
          this.toc = ncx.map(map);
        }
      }
      getGuide() {
        const index = this.mobiFile.kf8Header.guide;
        if (index < 4294967295) {
          const loadRecord = this.mobiFile.loadRecord.bind(this.mobiFile);
          const { table, cncx } = getIndexData2(index, loadRecord);
          return table.map(({ name, tagMap }) => ({
            label: cncx[tagMap[1][0]] ?? "",
            type: name?.split(/\s/),
            href: makePosURI2(tagMap[6]?.[0] ?? tagMap[3]?.[0])
          }));
        }
        return void 0;
      }
      loadRaw(start, end) {
        const distanceHead = end - this.rawHead.length;
        const distanceEnd = this.fullRawLength === 0 ? Infinity : this.fullRawLength - this.rawTail.length - start;
        if (distanceHead < 0 || distanceHead < distanceEnd) {
          while (this.rawHead.length < end) {
            this.lastLoadedHead++;
            const index = this.lastLoadedHead;
            const data = this.mobiFile.loadTextBuffer(index);
            this.rawHead = concatTypedArrays([this.rawHead, data]);
          }
          return this.rawHead.slice(start, end);
        }
        while (this.fullRawLength - this.rawTail.length > start) {
          this.lastLoadedTail++;
          const index = this.mobiFile.palmdocHeader.numTextRecords - 1 - this.lastLoadedTail;
          const data = this.mobiFile.loadTextBuffer(index);
          this.rawTail = concatTypedArrays([data, this.rawTail]);
        }
        const rawTailStart = this.fullRawLength - this.rawTail.length;
        return this.rawTail.slice(start - rawTailStart, end - rawTailStart);
      }
      loadText(chapter) {
        const { skel, frags, length } = chapter;
        const raw = this.loadRaw(skel.offset, skel.offset + length);
        let skeleton = raw.slice(0, skel.length);
        for (const frag of frags) {
          const insertOffset = frag.insertOffset - skel.offset;
          const offset = skel.length + frag.offset;
          const fragRaw = raw.slice(offset, offset + frag.length);
          skeleton = concatTypedArrays([
            skeleton.slice(0, insertOffset),
            fragRaw,
            skeleton.slice(insertOffset)
          ]);
          const offsets = this.fragmentOffsets.get(frag.index);
          if (offsets) {
            for (const offset2 of offsets) {
              const str = this.mobiFile.decode(fragRaw.buffer).slice(offset2);
              const selector = getFragmentSelector2(str);
              if (selector) {
                this.cacheFragmentSelector(frag.index, offset2, selector);
              }
            }
          }
        }
        return this.mobiFile.decode(skeleton.buffer);
      }
      loadChapter(id) {
        const numId = Number.parseInt(id);
        if (Number.isNaN(numId)) {
          return void 0;
        }
        if (this.chapterCache.has(numId)) {
          return this.chapterCache.get(numId);
        }
        const chapter = this.idToChapter.get(numId);
        if (chapter) {
          const processed = this.replace(this.loadText(chapter));
          this.chapterCache.set(numId, processed);
          return processed;
        }
        return void 0;
      }
      cacheFragmentSelector(id, offset, selector) {
        const map = this.fragmentSelectors.get(id);
        if (map) {
          map.set(offset, selector);
        } else {
          const map2 = /* @__PURE__ */ new Map();
          this.fragmentSelectors.set(id, map2);
          map2.set(offset, selector);
        }
      }
      loadFlow(index) {
        if (index < 4294967295) {
          return this.loadRaw(this.fdstTable[index][0], this.fdstTable[index][1]);
        }
        return void 0;
      }
      resolveHref(href) {
        if (/^(?!blob|kindle)\w+:/i.test(href)) {
          return void 0;
        }
        const { fid, off } = parsePosURI2(href);
        const chapter = this.chapters.find(
          (chapter2) => chapter2.frags.some(
            (frag2) => frag2.index === fid
          )
        );
        if (!chapter) {
          return void 0;
        }
        const id = chapter.id;
        const savedSelector = this.fragmentSelectors.get(fid)?.get(off);
        if (savedSelector) {
          return { id, selector: savedSelector };
        }
        const { skel, frags } = chapter;
        const frag = frags.find((frag2) => frag2.index === fid);
        const offset = skel.offset + skel.length + frag.offset;
        const fragRaw = this.loadRaw(offset, offset + frag.length);
        const str = this.mobiFile.decode(fragRaw.buffer).slice(off);
        const selector = getFragmentSelector2(str);
        this.cacheFragmentSelector(fid, off, selector);
        return { id, selector };
      }
      replaceResources(str) {
        return str.replace(
          new RegExp(kindleResourceRegex2, "gi"),
          (matched, resourceType, id, type) => {
            if (this.resourceCache.has(matched)) {
              return this.resourceCache.get(matched);
            }
            const raw = resourceType === "flow" ? this.loadFlow(Number.parseInt(id)) : this.mobiFile.loadResource(Number.parseInt(id, 36) - 1).raw;
            let blobData = "";
            if (type === MIME4.CSS || type === MIME4.SVG) {
              const text = this.mobiFile.decode(raw?.buffer);
              const textReplaced = this.replaceResources(text);
              blobData = textReplaced;
            } else {
              blobData = raw;
            }
            const url = saveResource(blobData, type, id, this.resourceSaveDir);
            this.resourceCache.set(matched, url);
            return url;
          }
        );
      }
      replace(str) {
        const cssUrls = [];
        const head = str.match(/<head[^>]*>([\s\S]*)<\/head>/i)[1];
        const links = head.match(/<link[^>]*>/gi) ?? [];
        for (const link of links) {
          const linkHref = link.match(/href="([^"]*)"/i)[1];
          const id = link.match(kindleResourceRegex2)[2];
          const href = this.replaceResources(linkHref);
          cssUrls.push({
            id,
            href
          });
        }
        const body = str.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
        const bodyReplaced = this.replaceResources(body);
        return {
          html: bodyReplaced,
          css: cssUrls
        };
      }
      destroy() {
        this.resourceCache.forEach((url) => {
          {
            URL.revokeObjectURL(url);
          }
        });
      }
    };
    __defProp3 = Object.defineProperty;
    __defNormalProp2 = (obj, key, value) => key in obj ? __defProp3(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
    __publicField2 = (obj, key, value) => __defNormalProp2(obj, typeof key !== "symbol" ? key + "" : key, value);
    Mobi = class {
      constructor(file, resourceSaveDir = "./images") {
        this.file = file;
        __publicField2(this, "fileArrayBuffer");
        __publicField2(this, "mobiFile");
        __publicField2(this, "fileName", "");
        __publicField2(this, "chapters", []);
        __publicField2(this, "idToChapter", /* @__PURE__ */ new Map());
        __publicField2(this, "toc", []);
        __publicField2(this, "resourceSaveDir", "./images");
        __publicField2(this, "chapterCache", /* @__PURE__ */ new Map());
        __publicField2(this, "resourceCache", /* @__PURE__ */ new Map());
        __publicField2(this, "recindexReg", /recindex=["']?(\d+)["']?/);
        __publicField2(this, "mediarecindexReg", /mediarecindex=["']?(\d+)["']?/);
        __publicField2(this, "fileposReg", /filepos=["']?(\d+)["']?/);
        this.fileName = getMobiFileName(file);
        this.resourceSaveDir = resourceSaveDir;
      }
      getFileInfo() {
        return {
          fileName: this.fileName
        };
      }
      getSpine() {
        return this.chapters;
      }
      loadChapter(id) {
        const numId = Number.parseInt(id);
        if (Number.isNaN(numId)) {
          return void 0;
        }
        if (this.chapterCache.has(numId)) {
          return this.chapterCache.get(numId);
        }
        const chapter = this.idToChapter.get(numId);
        if (!chapter) {
          return void 0;
        }
        const processedChapter = this.replace(chapter.text);
        this.chapterCache.set(numId, processedChapter);
        return processedChapter;
      }
      getToc() {
        return this.toc;
      }
      getCoverImage() {
        if (this.resourceCache.has("cover")) {
          return this.resourceCache.get("cover");
        }
        const coverImage = this.mobiFile.getCoverImage();
        let coverUrl = "";
        if (coverImage) {
          coverUrl = saveResource(coverImage.raw, coverImage.type, "cover", this.resourceSaveDir);
          this.resourceCache.set("cover", coverUrl);
        }
        return coverUrl;
      }
      getMetadata() {
        return this.mobiFile.getMetadata();
      }
      async innerLoadFile() {
        this.fileArrayBuffer = await toArrayBuffer(this.file);
        this.mobiFile = new MobiFile(this.fileArrayBuffer, this.fileName);
      }
      async innerInit() {
        const { palmdocHeader: palmdocHeader2 } = this.mobiFile;
        const buffers = [];
        for (let i3 = 0; i3 < palmdocHeader2.numTextRecords; i3++) {
          buffers.push(this.mobiFile.loadTextBuffer(i3));
        }
        const array = concatTypedArrays(buffers);
        const str = Array.from(
          array,
          (val) => String.fromCharCode(val)
        ).join("");
        const chapters = [];
        const idToChapter = /* @__PURE__ */ new Map();
        let id = 0;
        const matches2 = Array.from(str.matchAll(mbpPagebreakRegex2));
        matches2.unshift({ index: 0, input: "", groups: void 0, 0: "" });
        for (let i3 = 0; i3 < matches2.length; i3++) {
          const match = matches2[i3];
          const start = match.index;
          const matched = match[0];
          const end = matches2[i3 + 1]?.index;
          const section = str.slice(start + matched.length, end);
          const buffer = Uint8Array.from(section, (c2) => c2.charCodeAt(0));
          const text = this.mobiFile.decode(buffer.buffer);
          const chapter = {
            id: String(id),
            text,
            start,
            end,
            size: buffer.length
          };
          chapters.push(chapter);
          idToChapter.set(id, chapter);
          id++;
        }
        const lastChapterText = chapters[chapters.length - 1].text;
        chapters[chapters.length - 1].text = lastChapterText.slice(0, lastChapterText.indexOf("</body>"));
        const firstChapterText = chapters[0].text;
        const bodyOpenTagIndex = firstChapterText.indexOf("<body>");
        chapters[0].text = firstChapterText.slice(bodyOpenTagIndex + "<body>".length);
        this.chapters = chapters;
        this.idToChapter = idToChapter;
        const referenceStr = firstChapterText.slice(0, bodyOpenTagIndex);
        const tocChapterStr = this.findTocChapter(referenceStr);
        if (tocChapterStr) {
          const wrappedChapterStr = `<wrapper>${tocChapterStr.text.replace(/filepos=(\d+)/gi, 'filepos="$1"')}</wrapper>`;
          const tocAst = await parsexml(wrappedChapterStr, {
            preserveChildrenOrder: true,
            explicitChildren: true,
            childkey: "children"
          });
          const toc = [];
          this.parseNavMap(tocAst.wrapper.children, toc);
          this.toc = toc;
        }
      }
      findTocChapter(referenceStr) {
        const tocPosReg = /<reference.*\/>/g;
        const refs = referenceStr.match(tocPosReg);
        const typeReg = /type="(.+?)"/;
        const fileposReg = /filepos=(.*)/;
        if (refs) {
          for (const ref of refs) {
            const type = ref.match(typeReg)?.[1].trim();
            const filepos = ref.match(fileposReg)?.[1].trim();
            if (type === "toc" && filepos) {
              const tocPos = Number.parseInt(filepos, 10);
              const chapter = this.chapters.find((ch) => ch.end > tocPos);
              return chapter;
            }
          }
        }
        return void 0;
      }
      parseNavMap(children, toc) {
        for (const child of children) {
          const childName = child["#name"];
          if (childName === "p" || childName === "blockquote") {
            let subItem = {
              label: "",
              href: ""
            };
            if (child.a) {
              const a3 = child.a[0];
              const label = a3._;
              const filepos = Number(a3.$.filepos);
              subItem = {
                label,
                href: `filepos:${filepos}`
              };
              toc.push(subItem);
            }
            if (child.p || child.blockquote) {
              subItem.children = [];
              this.parseNavMap(child.children, subItem.children);
            }
          }
        }
      }
      loadResource(index) {
        if (this.resourceCache.has(String(index))) {
          return this.resourceCache.get(String(index));
        }
        const { type, raw } = this.mobiFile.loadResource(index - 1);
        const resourceUrl = saveResource(raw, type, String(index), this.resourceSaveDir);
        this.resourceCache.set(String(index), resourceUrl);
        return resourceUrl;
      }
      replace(html) {
        html = html.replace(
          /<img[^>]*>/g,
          (matched) => {
            const recindex = matched.match(this.recindexReg)[1];
            const url = this.loadResource(Number.parseInt(recindex));
            return matched.replace(this.recindexReg, `src="${url}"`);
          }
        );
        html = html.replace(
          /<(video|audio)[^>]*>/g,
          (matched) => {
            const mediarecindex = matched.match(this.recindexReg)[1];
            const mediaUrl = this.loadResource(Number.parseInt(mediarecindex));
            matched = matched.replace(this.mediarecindexReg, `src="${mediaUrl}"`);
            const recindex = matched.match(this.recindexReg)?.[1];
            if (recindex) {
              const posterUrl = this.loadResource(Number.parseInt(recindex));
              matched = matched.replace(this.recindexReg, `poster="${posterUrl}"`);
            }
            return matched;
          }
        );
        html = html.replace(
          /<a[^>]*>/g,
          (matched) => {
            const fileposMatch = matched.match(this.fileposReg);
            if (!fileposMatch) {
              return matched;
            }
            const filepos = fileposMatch[1];
            return matched.replace(this.fileposReg, `href="filepos:${filepos}"`);
          }
        );
        return {
          html,
          css: []
        };
      }
      resolveHref(href) {
        const hrefmatch = href.match(/filepos:(\d+)/);
        if (!hrefmatch) {
          return void 0;
        }
        const filepos = hrefmatch[1];
        const fileposNum = Number(filepos);
        const chapter = this.chapters.find((ch) => ch.end > fileposNum);
        if (chapter) {
          return { id: chapter.id, selector: `[id="filepos:${filepos}"]` };
        }
        return void 0;
      }
      destroy() {
        this.resourceCache.forEach((url) => {
          {
            URL.revokeObjectURL(url);
          }
        });
        this.resourceCache.clear();
      }
    };
  }
});

// src/ui/reader/selectionMenuPosition.ts
var computeSelectionMenuPosition;
var init_selectionMenuPosition = __esm({
  "src/ui/reader/selectionMenuPosition.ts"() {
    "use strict";
    computeSelectionMenuPosition = (rect, menu, viewport, options = {}) => {
      const margin = options.margin ?? 8;
      const gap = options.gap ?? 6;
      const singleLineMaxHeight = options.singleLineMaxHeight ?? 28;
      const isMultiLine = rect.height > singleLineMaxHeight;
      let placement;
      if (isMultiLine) {
        placement = "above";
      } else if (rect.bottom + gap + menu.height <= viewport.height - margin) {
        placement = "below";
      } else {
        placement = rect.top - gap - menu.height >= margin ? "above" : "below";
      }
      const baseTop = placement === "below" ? rect.bottom + gap : rect.top - gap - menu.height;
      let left = rect.left + rect.width / 2 - menu.width / 2;
      if (left < margin) left = margin;
      if (left + menu.width > viewport.width - margin) {
        left = Math.max(margin, viewport.width - margin - menu.width);
      }
      return {
        top: baseTop,
        left,
        placement
      };
    };
  }
});

// src/ui/reader/ShortcutHelpModal.ts
var ShortcutHelpModal_exports = {};
__export(ShortcutHelpModal_exports, {
  ShortcutHelpModal: () => ShortcutHelpModal
});
var import_obsidian13, ShortcutHelpModal;
var init_ShortcutHelpModal = __esm({
  "src/ui/reader/ShortcutHelpModal.ts"() {
    "use strict";
    import_obsidian13 = require("obsidian");
    ShortcutHelpModal = class extends import_obsidian13.Modal {
      constructor(app, shortcuts) {
        super(app);
        this.shortcuts = shortcuts;
        this.modalEl.addClass("ez-reader__shortcut-help");
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "EzReader \u5FEB\u6377\u952E" });
        contentEl.createEl("p", {
          text: "\u5728\u9605\u8BFB\u5668\u5185\u76F4\u63A5\u6309\u4EE5\u4E0B\u952E(\u65E0\u9700 Ctrl/Cmd)\u3002\u6309 Esc \u5173\u95ED\u6B64\u9762\u677F\u3002",
          cls: "ez-reader__shortcut-help__intro"
        });
        const tPrev = this.shortcuts.prev;
        const tNext = this.shortcuts.next;
        const tSidebar = this.shortcuts.toggleSidebar;
        const tToc = this.shortcuts.toggleToc;
        const tTranslate = this.shortcuts.translate;
        const tHighlight = this.shortcuts.highlight;
        const groups = [
          {
            title: "\u7FFB\u9875",
            rows: [
              ["\u2190 / PageUp", "\u4E0A\u4E00\u9875"],
              ["\u2192 / PageDown / Space", "\u4E0B\u4E00\u9875"],
              ["Shift + Space", "\u4E0A\u4E00\u9875"],
              ["Home / End", "\u8DF3\u5230\u9996 / \u672B"]
            ]
          },
          {
            title: "\u6CE8\u91CA \u2014 \u4E00\u952E\u4FDD\u5B58(\u4E0D\u5F39\u7A97)",
            rows: [
              ["H", "\u5FEB\u901F\u9AD8\u4EAE(\u9009\u4E2D\u6587\u672C\u540E\u6309 H,\u76F4\u63A5\u4FDD\u5B58)"],
              ["B", "\u5FEB\u901F\u52A0\u4E66\u7B7E(\u81EA\u52A8\u7528\u5F53\u524D\u7AE0\u8282 + \u767E\u5206\u6BD4\u547D\u540D)"],
              ["Shift + " + tHighlight, "\u4FDD\u5B58\u6458\u5F55(\u5F39\u51FA note + tags \u8F93\u5165)"]
            ]
          },
          {
            title: "\u6CE8\u91CA \u2014 \u7FFB\u8BD1 / \u590D\u5236",
            rows: [
              ["Shift + " + tTranslate, "\u7FFB\u8BD1\u9009\u8BCD"],
              ["C", "\u590D\u5236\u9009\u533A"]
            ]
          },
          {
            title: "\u9762\u677F / \u6C89\u6D78",
            rows: [
              [tSidebar.toUpperCase(), "\u5207\u6362\u7B14\u8BB0\u4FA7\u680F"],
              [tToc.toUpperCase(), "\u5207\u6362\u76EE\u5F55"],
              ["F", "\u5207\u6362\u6C89\u6D78\u6A21\u5F0F"],
              ["Esc", "\u5173\u95ED\u6253\u5F00\u7684\u9762\u677F / \u9009\u533A\u83DC\u5355 / \u7FFB\u8BD1\u62BD\u5C49"]
            ]
          },
          {
            title: "\u641C\u7D22 / \u5176\u5B83",
            rows: [
              ["Ctrl/Cmd + F  \u6216  /", "\u641C\u7D22\u4E66\u5185\u6587\u5B57"],
              ["?", "\u518D\u6B21\u6253\u5F00\u6B64\u5E2E\u52A9"]
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
            const kbd = keyCell.createEl("kbd", { text: key });
            kbd.addClass("ez-reader__shortcut-help__kbd");
            tr.createEl("td", { text: desc, cls: "ez-reader__shortcut-help__desc" });
          }
        }
        const footer = contentEl.createEl("p", {
          cls: "ez-reader__shortcut-help__footer"
        });
        footer.setText(
          `\u5F53\u524D\u7FFB\u9875\u952E:${tPrev} / ${tNext} \xB7 \u4FA7\u680F:${tSidebar} \xB7 \u76EE\u5F55:${tToc} \xB7 \u7FFB\u8BD1:Shift+${tTranslate} \xB7 \u9AD8\u4EAE:Shift+${tHighlight}`
        );
      }
      onClose() {
        this.contentEl.empty();
      }
    };
  }
});

// src/ui/reader/BookmarkModal.ts
var BookmarkModal_exports = {};
__export(BookmarkModal_exports, {
  BookmarkModal: () => BookmarkModal
});
var import_obsidian14, BookmarkModal;
var init_BookmarkModal = __esm({
  "src/ui/reader/BookmarkModal.ts"() {
    "use strict";
    import_obsidian14 = require("obsidian");
    BookmarkModal = class extends import_obsidian14.Modal {
      resolver = null;
      context;
      fallbackLabel;
      constructor(app, context, initialLabel = "") {
        super(app);
        this.context = context;
        this.fallbackLabel = initialLabel || context.preview || context.chapter || "\u672A\u547D\u540D\u4E66\u7B7E";
      }
      openAndWait() {
        return new Promise((resolve) => {
          this.resolver = resolve;
          this.open();
        });
      }
      settle(label) {
        const r3 = this.resolver;
        this.resolver = null;
        r3?.(label);
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "\u6DFB\u52A0\u4E66\u7B7E" });
        const contextBox = contentEl.createDiv({ cls: "ez-reader__bookmark-modal__context" });
        const metaRow = contextBox.createDiv({ cls: "ez-reader__bookmark-modal__meta" });
        if (this.context.chapter) {
          metaRow.createSpan({ text: this.context.chapter, cls: "ez-reader__bookmark-modal__chapter" });
        }
        metaRow.createSpan({
          text: `${Math.round(this.context.fraction * 100)}%`,
          cls: "ez-reader__bookmark-modal__progress"
        });
        metaRow.createSpan({
          text: new Date(this.context.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          cls: "ez-reader__bookmark-modal__time"
        });
        if (this.context.preview) {
          const preview = contextBox.createDiv({ cls: "ez-reader__bookmark-modal__preview" });
          preview.createEl("blockquote", { text: this.context.preview });
        }
        contentEl.createEl("p", { text: "\u4E66\u7B7E\u540D\u79F0 (\u53EF\u6539):", cls: "ez-reader__bookmark-modal__label" });
        const input = contentEl.createEl("input", { attr: { type: "text" } });
        input.value = this.fallbackLabel;
        input.addClass("ez-reader__bookmark-input");
        input.placeholder = "\u4F8B\u5982:\u7B2C\u4E09\u7AE0\u7684\u5173\u952E\u8BBA\u70B9";
        const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
        const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
        cancel.onclick = () => {
          this.settle(null);
          this.close();
        };
        const submit = actions.createEl("button", { text: "\u6DFB\u52A0", attr: { type: "button" } });
        submit.addClass("mod-cta");
        submit.onclick = () => {
          this.settle(input.value);
          this.close();
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.settle(input.value);
            this.close();
          }
        });
        window.setTimeout(() => {
          try {
            input.focus();
            input.select();
          } catch (error) {
            console.debug("[ez-reader] bookmark focus skipped \u2014 modal closed", error);
          }
        }, 0);
      }
      onClose() {
        if (this.resolver) this.settle(null);
      }
    };
  }
});

// src/ui/reader/ExcerptModal.ts
var ExcerptModal_exports = {};
__export(ExcerptModal_exports, {
  ExcerptModal: () => ExcerptModal
});
var import_obsidian15, ExcerptModal, parseTags2;
var init_ExcerptModal = __esm({
  "src/ui/reader/ExcerptModal.ts"() {
    "use strict";
    import_obsidian15 = require("obsidian");
    ExcerptModal = class extends import_obsidian15.Modal {
      input;
      resolver = null;
      constructor(app, input) {
        super(app);
        this.input = input;
      }
      openAndWait() {
        return new Promise((resolve) => {
          this.resolver = resolve;
          this.open();
        });
      }
      settle(result) {
        const r3 = this.resolver;
        this.resolver = null;
        r3?.(result);
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "\u4FDD\u5B58\u6458\u5F55" });
        contentEl.createEl("p", { text: "\u6240\u9009\u6587\u5B57\u4F1A\u4FDD\u5B58\u5230\u63D2\u4EF6\u6570\u636E;\u4E0D\u4F1A\u4FEE\u6539\u539F\u59CB\u7535\u5B50\u4E66\u3002" });
        contentEl.createEl("blockquote", { text: this.input.text });
        const noteInput = contentEl.createEl("textarea");
        noteInput.addClass("ez-reader__excerpt-input");
        noteInput.placeholder = "\u53EF\u9009:\u4E3A\u8FD9\u6BB5\u6458\u5F55\u5199\u4E0B\u968F\u60F3";
        const tagsInput = contentEl.createEl("input", { attr: { type: "text" } });
        tagsInput.addClass("ez-reader__excerpt-tags");
        tagsInput.placeholder = "\u4E3B\u9898\u6807\u7B7E(\u53EF\u9009,\u7528\u7A7A\u683C\u6216\u9017\u53F7\u5206\u9694)";
        const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
        const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
        cancel.onclick = () => {
          this.settle(null);
          this.close();
        };
        const submit = actions.createEl("button", { text: "\u4FDD\u5B58\u6458\u5F55", attr: { type: "button" } });
        submit.addClass("mod-cta");
        submit.onclick = () => {
          this.settle({
            note: noteInput.value.trim(),
            tags: parseTags2(tagsInput.value)
          });
          this.close();
        };
        noteInput.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit.click();
          }
        });
        window.setTimeout(() => {
          try {
            noteInput.focus();
          } catch (error) {
            console.debug("[ez-reader] excerpt modal focus skipped", error);
          }
        }, 0);
      }
      onClose() {
        if (this.resolver) this.settle(null);
      }
    };
    parseTags2 = (raw) => {
      const tokens = raw.split(/[\s,，]+/);
      const seen = /* @__PURE__ */ new Set();
      for (const token of tokens) {
        const cleaned = token.replace(/^#+/, "").replace(/[^\p{L}\p{N}_/-]/gu, "").slice(0, 60);
        if (cleaned) seen.add(cleaned);
        if (seen.size >= 12) break;
      }
      return [...seen];
    };
  }
});

// src/core/pdf/highlight.ts
var ANCHOR_PREFIX_LEN, findPageElement, collectTextLayerSpans, rectsInRange, findTextOnPage, findHighlightRect, findNextPageWithText;
var init_highlight = __esm({
  "src/core/pdf/highlight.ts"() {
    "use strict";
    ANCHOR_PREFIX_LEN = 30;
    findPageElement = (container, pageNumber) => {
      const selector = `.pdf-page[data-page-number="${pageNumber}"], .page[data-page-number="${pageNumber}"]`;
      return container.querySelector(selector);
    };
    collectTextLayerSpans = (pageEl) => {
      const textLayer = pageEl.querySelector(".textLayer");
      if (!(textLayer instanceof HTMLElement)) return [];
      return Array.from(textLayer.querySelectorAll(":scope > span")).filter(
        (el) => el instanceof HTMLElement
      );
    };
    rectsInRange = (spans, start, end) => {
      const out = [];
      let acc = 0;
      for (const span of spans) {
        const len = (span.textContent ?? "").length;
        if (len === 0) continue;
        const spanStart = acc;
        const spanEnd = acc + len;
        if (spanEnd > start && spanStart < end) {
          const r3 = span.getBoundingClientRect();
          if (r3.width > 0 || r3.height > 0) {
            out.push({ left: r3.left, top: r3.top, width: r3.width, height: r3.height });
          }
        }
        acc = spanEnd;
        if (acc >= end) break;
      }
      return out;
    };
    findTextOnPage = (pageEl, searchText) => {
      if (!searchText) return [];
      const spans = collectTextLayerSpans(pageEl);
      if (spans.length === 0) return [];
      const spanTexts = spans.map((s3) => s3.textContent ?? "");
      const fullText = spanTexts.join("");
      const anchor = searchText.slice(0, ANCHOR_PREFIX_LEN);
      const idx = fullText.indexOf(anchor);
      if (idx < 0) return [];
      const length = Math.min(searchText.length, fullText.length - idx);
      if (length <= 0) return [];
      return rectsInRange(spans, idx, idx + length);
    };
    findHighlightRect = (container, pageNumber, searchText) => {
      const pageEl = findPageElement(container, pageNumber);
      if (!pageEl) return null;
      const rects = findTextOnPage(pageEl, searchText);
      if (rects.length === 0) return null;
      return { pageNumber, rects };
    };
    findNextPageWithText = (container, searchText, fromPage, options = {}) => {
      if (!searchText.trim()) return null;
      const maxPages = options.maxPages ?? 200;
      const caseSensitive = options.caseSensitive === true;
      const needle = caseSensitive ? searchText : searchText.toLocaleLowerCase();
      const allPages = Array.from(
        container.querySelectorAll(".pdf-page[data-page-number], .page[data-page-number]")
      );
      if (allPages.length === 0) return null;
      const pages = allPages.map((el) => Number(el.getAttribute("data-page-number") ?? "0")).filter((n3) => n3 > 0).sort((a3, b3) => a3 - b3);
      if (pages.length === 0) return null;
      const startIdx = pages.findIndex((p3) => p3 >= fromPage);
      const order = startIdx >= 0 ? [...pages.slice(startIdx), ...pages.slice(0, startIdx)] : pages;
      let scanned = 0;
      for (const pageNum of order) {
        if (scanned >= maxPages) break;
        scanned += 1;
        const pageEl = findPageElement(container, pageNum);
        if (!pageEl) continue;
        const text = collectTextLayerSpans(pageEl).map((s3) => s3.textContent ?? "").join("");
        const haystack = caseSensitive ? text : text.toLocaleLowerCase();
        if (haystack.includes(needle)) return pageNum;
      }
      return null;
    };
  }
});

// src/ui/reader/pdfOverlay.ts
var pdfOverlay_exports = {};
__export(pdfOverlay_exports, {
  PdfOverlay: () => PdfOverlay,
  findPdfOverlayForLeaf: () => findPdfOverlayForLeaf
});
var import_obsidian18, PDF_VIEW_TYPE, generateExcerptId2, ATTACHED, findPdfOverlayForLeaf, debounce2, findActivePageNumber, isSelectionInContainer, findPageElement2, PdfOverlay, cssEscapeAttr, promptForThought, createSelectionMenu, showMenuAt, createNotesButton, createNotesPanel, createHighlightLayer, createSearchBar, updatePdfSearchStatus, collectTextLayerSpans2, renderNotesPanelContent, drawHighlight, findPdfTotalPages, createTranslationPopover, makeDraggable;
var init_pdfOverlay = __esm({
  "src/ui/reader/pdfOverlay.ts"() {
    "use strict";
    import_obsidian18 = require("obsidian");
    init_highlight();
    init_selectionMenuPosition();
    PDF_VIEW_TYPE = "pdf";
    generateExcerptId2 = (prefix) => {
      const uuid = window.crypto?.randomUUID?.();
      if (typeof uuid === "string" && uuid.length > 0) {
        return `${prefix}-${uuid}`;
      }
      return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    };
    ATTACHED = /* @__PURE__ */ new WeakMap();
    findPdfOverlayForLeaf = (leaf) => {
      return ATTACHED.get(leaf);
    };
    debounce2 = (fn, ms) => {
      let timer;
      return (...args) => {
        if (timer !== void 0) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
      };
    };
    findActivePageNumber = (container) => {
      const sel = document.getSelection();
      if (sel?.anchorNode) {
        const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
        const pageEl = anchor?.closest(".pdf-page, .page");
        if (pageEl instanceof HTMLElement) {
          const n3 = pageEl.getAttribute("data-page-number");
          if (n3 && /^\d+$/.test(n3)) return Number(n3);
        }
      }
      const selectors = [
        ".pdf-page.active[data-page-number]",
        ".page.active[data-page-number]",
        ".pdf-viewer .page.active[data-page-number]"
      ];
      for (const sel2 of selectors) {
        const el = container.querySelector(sel2);
        if (el instanceof HTMLElement) {
          const n3 = el.getAttribute("data-page-number");
          if (n3 && /^\d+$/.test(n3)) return Number(n3);
        }
      }
      return null;
    };
    isSelectionInContainer = (sel, container) => {
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
      const node = sel.anchorNode;
      return Boolean(node && container.contains(node));
    };
    findPageElement2 = (container, pageNumber) => {
      const sel = `.pdf-page[data-page-number="${pageNumber}"], .page[data-page-number="${pageNumber}"]`;
      const el = container.querySelector(sel);
      return el instanceof HTMLElement ? el : null;
    };
    PdfOverlay = class {
      opts;
      container;
      menuEl;
      notesBtn;
      notesPanel;
      highlightLayer;
      searchBar;
      /** P2: PDF 选词翻译的浮动小弹窗 — 替代之前的 `new Notice` toast (3 秒消失
       *  还盖在最上面, 译文长就截掉, 用户复制也不方便). 挂到 `document.body`,
       *  position: fixed, 锚定到选词 rect 附近 (复用 selectionMenuPosition).
       *  内容: 原文 (小) + 译文 (主) + 复制 / 换语言重译 / × 按钮. */
      translationPopoverEl;
      disposers = [];
      highlightsByExcerpt = /* @__PURE__ */ new Map();
      pendingSelection;
      bookId;
      bookTitle = "";
      targetLocale = "zh-CN";
      mounted = false;
      /** P1: in-PDF find state — see `runPdfSearch`. */
      pdfFindQuery = "";
      pdfFindCurrentPage = null;
      pdfFindMatchCount = 0;
      renderHighlightsDebounced;
      repositionHighlightsDebounced;
      constructor(opts) {
        this.opts = opts;
        this.container = opts.pdfLeaf.view.containerEl;
        this.menuEl = createSelectionMenu(document.body, {
          onTranslate: () => void this.handleTranslate(),
          onExcerpt: () => void this.handleExcerpt(),
          onThought: () => void this.handleThought(),
          onCopy: () => void this.handleCopy()
        });
        this.notesPanel = createNotesPanel(document.body);
        this.notesBtn = createNotesButton(document.body, {
          onClick: () => this.toggleNotesPanel()
        });
        this.highlightLayer = createHighlightLayer(document.body);
        this.searchBar = createSearchBar(document.body, {
          onSearch: (q2, fromStart) => void this.runPdfSearch(q2, fromStart),
          onClose: () => this.closePdfSearch()
        });
        this.translationPopoverEl = createTranslationPopover(document.body, {
          onCopy: () => void this.handleCopyTranslation(),
          onCycleTarget: () => void this.handleCycleTranslationTarget()
        });
        this.renderHighlightsDebounced = debounce2(() => void this.renderHighlights(), 250);
        this.repositionHighlightsDebounced = debounce2(() => this.repositionHighlights(), 100);
      }
      /** Resolve bookId + title + translation locale. Must be awaited before mount. */
      async resolveBook() {
        const entry = this.opts.library.list().find((e3) => e3.book.locator.path === this.opts.bookPath);
        if (entry) {
          this.bookId = entry.book.id;
          this.bookTitle = entry.book.metadata?.title ?? entry.book.locator.path;
        }
        this.targetLocale = await this.opts.reading.getTranslationLocale();
      }
      /** Attach to the PDFView leaf. Idempotent — 同 leaf 重复调用会先卸载旧的. */
      mount() {
        if (this.mounted) return;
        const existing = ATTACHED.get(this.opts.pdfLeaf);
        if (existing && existing !== this) {
          existing.unmount();
        }
        ATTACHED.set(this.opts.pdfLeaf, this);
        const onSelectionChange = () => {
          if (!this.isLeafAlive()) {
            this.unmount();
            return;
          }
          const sel = document.getSelection();
          if (!isSelectionInContainer(sel, this.container)) {
            this.hideMenu();
            return;
          }
          const text = sel?.toString().trim() ?? "";
          if (!text) {
            this.hideMenu();
            return;
          }
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            this.hideMenu();
            return;
          }
          const pageNumber = findActivePageNumber(this.container);
          if (pageNumber === null) {
            showMenuAt(this.menuEl, rect);
            return;
          }
          const locator = `#page=${pageNumber}`;
          this.pendingSelection = { text, locator, pageNumber, rect };
          showMenuAt(this.menuEl, rect);
        };
        const onSelectionChangeDebounced = debounce2(onSelectionChange, 80);
        document.addEventListener("selectionchange", onSelectionChangeDebounced);
        this.disposers.push(() => document.removeEventListener("selectionchange", onSelectionChangeDebounced));
        const onDocClick = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (this.menuEl.contains(target) || this.notesBtn.contains(target) || this.notesPanel.contains(target) || this.translationPopoverEl.contains(target)) {
            return;
          }
          const sel = document.getSelection();
          if (!sel || sel.isCollapsed) this.hideMenu();
          this.hideTranslationPopover();
        };
        document.addEventListener("mousedown", onDocClick);
        this.disposers.push(() => document.removeEventListener("mousedown", onDocClick));
        const highlightObserver = new MutationObserver(() => {
          this.renderHighlightsDebounced();
        });
        highlightObserver.observe(this.container, { childList: true, subtree: true });
        this.disposers.push(() => highlightObserver.disconnect());
        const onViewportChange = () => {
          this.repositionHighlightsDebounced();
        };
        window.addEventListener("resize", onViewportChange);
        this.disposers.push(() => window.removeEventListener("resize", onViewportChange));
        const pdfViewerEl = this.container.querySelector(".pdf-viewer, .pdfViewer");
        if (pdfViewerEl instanceof HTMLElement) {
          pdfViewerEl.addEventListener("scroll", onViewportChange);
          this.disposers.push(() => pdfViewerEl.removeEventListener("scroll", onViewportChange));
          let rafHandle = 0;
          let lastUpdate = 0;
          const tick = () => {
            const now = performance.now();
            this.repositionHighlights();
            lastUpdate = now;
            rafHandle = requestAnimationFrame(tick);
          };
          rafHandle = requestAnimationFrame(tick);
          this.disposers.push(() => cancelAnimationFrame(rafHandle));
        }
        const onLeafChange = () => {
          if (!this.isLeafAlive()) this.unmount();
        };
        this.opts.app.workspace.on("active-leaf-change", onLeafChange);
        this.disposers.push(() => this.opts.app.workspace.off("active-leaf-change", onLeafChange));
        let persistTimer;
        const schedulePositionPersist = () => {
          if (persistTimer !== void 0) clearTimeout(persistTimer);
          persistTimer = setTimeout(() => void this.persistCurrentPosition(), 250);
        };
        this.disposers.push(() => {
          if (persistTimer !== void 0) {
            clearTimeout(persistTimer);
            persistTimer = void 0;
          }
        });
        const pageObserver = new MutationObserver(() => schedulePositionPersist());
        pageObserver.observe(this.container, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"]
        });
        this.disposers.push(() => pageObserver.disconnect());
        this.mounted = true;
        void this.persistCurrentPosition();
        void this.renderHighlights();
      }
      /**
       * P0-3: 把当前 PDF 进度 (page + totalPages) 写到 reading store.
       * No-op if:
       *   - 没有 bookId (mount 时序 race, library.initialize 还没完)
       *   - DOM 里找不到 active page (PDFView 还没渲染完, 等下一次 mutation)
       *   - 上一次 persist 的 page 跟现在一样 (避免 relocate 风暴)
       */
      lastPersistedPdfPage = null;
      lastPersistedPdfTotal = null;
      async persistCurrentPosition() {
        if (!this.bookId) return;
        const page = findActivePageNumber(this.container);
        if (page === null) return;
        if (page === this.lastPersistedPdfPage) return;
        const totalPages = findPdfTotalPages(this.container);
        try {
          await this.opts.reading.updatePosition(this.bookId, {
            kind: "pdf",
            page,
            totalPages: totalPages ?? void 0
            // scale / fitWidth PDF overlay 不主动管, 让用户通过 PDFView 自己控制
          });
          this.lastPersistedPdfPage = page;
          this.lastPersistedPdfTotal = totalPages;
        } catch (error) {
          console.warn("[ez-reader] persistCurrentPosition (PDF) failed", error);
        }
      }
      /** Underlying PDFView leaf 还在且 view 类型还是 pdf. */
      isLeafAlive() {
        const leaf = this.opts.pdfLeaf;
        if (leaf.detached === true) return false;
        const view = leaf.view;
        if (!view || view.getViewType() !== PDF_VIEW_TYPE) return false;
        const el = view.containerEl;
        return Boolean(el && document.contains(el));
      }
      /**
       * 读出当前书的所有 excerpt, 在 PDFView DOM 里找对应文本,
       * 在 highlightLayer 里画 highlight div。已渲染的不再画。
       */
      async renderHighlights() {
        if (!this.bookId || !this.isLeafAlive()) return;
        if (!document.body.contains(this.highlightLayer)) return;
        let excerpts;
        try {
          excerpts = await this.opts.reading.listExcerpts(this.bookId);
        } catch (error) {
          console.warn("[ez-reader] failed to load excerpts for highlight", error);
          return;
        }
        const tasks = excerpts.map(async (ex) => {
          if (this.highlightsByExcerpt.has(ex.id)) return null;
          const pos = ex.locator.position;
          if (pos.kind !== "pdf") return null;
          const result = findHighlightRect(this.container, pos.page, ex.text);
          if (!result || result.rects.length === 0) return null;
          return { ex, pageNumber: pos.page, rects: result.rects };
        });
        const settled = await Promise.all(tasks);
        for (const item of settled) {
          if (!item) continue;
          const divs = [];
          for (const rect of item.rects) {
            const div = drawHighlight(this.highlightLayer, rect, item.ex.id, item.ex.text);
            div.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!this.notesPanel.classList.contains("is-open")) {
                this.toggleNotesPanel();
              }
              this.focusExcerptInPanel(item.ex.id);
            });
            divs.push(div);
          }
          this.highlightsByExcerpt.set(item.ex.id, {
            excerptId: item.ex.id,
            pageNumber: item.pageNumber,
            searchText: item.ex.text,
            div: divs[0],
            extraDivs: divs.slice(1)
          });
        }
      }
      /** 原地更新现有 highlight div 的位置 — 不重建, 不重新读 excerpts。 */
      repositionHighlights() {
        if (this.highlightsByExcerpt.size === 0) return;
        if (!document.body.contains(this.highlightLayer)) return;
        for (const item of this.highlightsByExcerpt.values()) {
          const pageEl = findPageElement2(this.container, item.pageNumber);
          const allDivs = [item.div, ...item.extraDivs ?? []];
          if (!pageEl) {
            for (const div of allDivs) div.setCssProps({ display: "none" });
            continue;
          }
          const rects = findTextOnPage(pageEl, item.searchText);
          if (rects.length === 0) {
            for (const div of allDivs) div.setCssProps({ display: "none" });
            continue;
          }
          for (const div of item.extraDivs ?? []) div.remove();
          item.extraDivs = [];
          const primary = rects[0];
          const tail = rects.slice(1);
          if (primary) {
            item.div.setCssProps({
              display: "",
              left: `${primary.left}px`,
              top: `${primary.top}px`,
              width: `${primary.width}px`,
              height: `${primary.height}px`
            });
          }
          for (const r3 of tail) {
            const newDiv = drawHighlight(this.highlightLayer, r3, item.excerptId, item.searchText);
            item.extraDivs.push(newDiv);
          }
        }
      }
      /**
       * P0 修复: 之前 Plugin.handleProtocol 收到 obsidian://ez-reader?book=X&annotation=Y
       * 时只查 READER_VIEW_TYPE leaf, PDF 走的是 Obsidian 内置 viewer, handleProtocol
       * 找不到对应 leaf 也调不到 PdfOverlay — 用户点 vault 笔记里的 protocol link
       * "返回原文" / "回到此摘录" 完全无效. 现在暴露 jumpToExcerpt: scrollIntoView
       * 到对应页 + 画 highlight + 让 PdfOverlay leaf 可见. Plugin 在 protocol handler
       * 里根据 book 格式路由: PDF → 找 PdfOverlay, 其他 → ReaderView.
       *
       * 找不到对应 page 时 (e.g. 损坏的 PDF), 静默 no-op + console.warn — 不影响其他书.
       */
      async jumpToExcerpt(excerptId) {
        if (!this.bookId || !this.isLeafAlive()) {
          console.warn("[ez-reader] jumpToExcerpt: overlay not mounted for", excerptId);
          return;
        }
        let excerpts;
        try {
          excerpts = await this.opts.reading.listExcerpts(this.bookId);
        } catch (error) {
          console.warn("[ez-reader] jumpToExcerpt listExcerpts failed", error);
          return;
        }
        const ex = excerpts.find((e3) => e3.id === excerptId);
        if (!ex) {
          console.warn("[ez-reader] jumpToExcerpt: excerpt not found", excerptId);
          return;
        }
        const pos = ex.locator.position;
        if (pos.kind !== "pdf") return;
        if (!this.highlightsByExcerpt.has(excerptId)) {
          const result = findHighlightRect(this.container, pos.page, ex.text);
          if (result && result.rects.length > 0) {
            const allDivs = [];
            for (const r3 of result.rects) {
              allDivs.push(drawHighlight(this.highlightLayer, r3, excerptId, ex.text));
            }
            this.highlightsByExcerpt.set(excerptId, {
              excerptId,
              pageNumber: pos.page,
              searchText: ex.text,
              div: allDivs[0],
              extraDivs: allDivs.slice(1)
            });
          }
        }
        const pageEl = findPageElement2(this.container, pos.page);
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
          if (pos.selection) {
          }
        } else {
          console.warn("[ez-reader] jumpToExcerpt: page element not in DOM for page", pos.page);
        }
      }
      unmount() {
        if (!this.mounted) return;
        this.mounted = false;
        for (const d2 of this.disposers) {
          try {
            d2();
          } catch (error) {
            console.warn("[ez-reader] PdfOverlay disposer threw", error);
          }
        }
        this.disposers.length = 0;
        this.menuEl.remove();
        this.notesBtn.remove();
        this.notesPanel.remove();
        this.highlightLayer.remove();
        this.searchBar.remove();
        this.translationPopoverEl.remove();
        this.clearPdfSearchHighlights();
        this.pendingSelection = void 0;
        this.highlightsByExcerpt.clear();
        if (ATTACHED.get(this.opts.pdfLeaf) === this) {
          ATTACHED.delete(this.opts.pdfLeaf);
        }
      }
      hideMenu() {
        this.menuEl.setCssProps({ display: "none" });
      }
      toggleNotesPanel() {
        const isOpen = this.notesPanel.classList.toggle("is-open");
        this.notesBtn.classList.toggle("is-active", isOpen);
        if (isOpen) void this.refreshNotesPanel();
      }
      async refreshNotesPanel() {
        if (!this.bookId) return;
        try {
          const [bookmarks, excerpts] = await Promise.all([
            this.opts.reading.listBookmarks(this.bookId),
            this.opts.reading.listExcerpts(this.bookId)
          ]);
          renderNotesPanelContent(this.notesPanel, bookmarks, excerpts, {
            onJump: (locator) => this.jumpToLocator(locator),
            onRemoveBookmark: async (id) => {
              await this.opts.reading.removeBookmark(this.bookId, id);
              await this.refreshNotesPanel();
              new import_obsidian18.Notice("\u4E66\u7B7E\u5DF2\u5220\u9664");
            },
            onRemoveExcerpt: async (id) => {
              await this.opts.reading.removeExcerpt(this.bookId, id);
              const rendered = this.highlightsByExcerpt.get(id);
              if (rendered) {
                rendered.div.remove();
                for (const extra of rendered.extraDivs ?? []) extra.remove();
                this.highlightsByExcerpt.delete(id);
              }
              await this.refreshNotesPanel();
              new import_obsidian18.Notice("\u6458\u5F55\u5DF2\u5220\u9664");
            }
          });
        } catch (error) {
          console.warn("[ez-reader] failed to refresh notes panel", error);
        }
      }
      jumpToLocator(locator) {
        if (!locator) return;
        void this.opts.app.workspace.openLinkText(`${this.opts.bookPath}${locator}`, "", false);
      }
      async handleTranslate() {
        if (!this.pendingSelection) return;
        const text = this.pendingSelection.text;
        const rect = this.pendingSelection.rect;
        this.hideMenu();
        this.showTranslationPopover(text, rect);
        try {
          const result = await this.opts.translation.translate(text, "auto", this.targetLocale);
          this.renderTranslationResult(text, result.text, result.detectedSource, result.providerId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.renderTranslationError(text, message);
        }
      }
      /**
       * 在选区附近显示浮动翻译小弹窗, 显示「正在翻译…」状态。位置复用
       * selectionMenuPosition 算法 — 跟选词菜单同位置, 不会跑到屏幕外。
       */
      showTranslationPopover(sourceText, anchorRect) {
        const popover = this.translationPopoverEl;
        const sourceEl = popover.querySelector(".ez-reader__pdf-translation__source");
        const bodyEl = popover.querySelector(".ez-reader__pdf-translation__body");
        const providerEl = popover.querySelector(".ez-reader__pdf-translation__provider");
        if (sourceEl) sourceEl.setText(sourceText);
        if (bodyEl) {
          bodyEl.empty();
          bodyEl.setText("\u6B63\u5728\u7FFB\u8BD1\u2026");
          bodyEl.addClass("is-loading");
          bodyEl.removeClass("is-error");
        }
        if (providerEl) providerEl.setText(`\u2192 ${this.targetLocale}`);
        popover.removeClass("is-hidden");
        popover.setCssProps({ left: "-9999px", top: "-9999px" });
        requestAnimationFrame(() => {
          const popoverRect = popover.getBoundingClientRect();
          const pos = computeSelectionMenuPosition(anchorRect, popoverRect, {
            width: window.innerWidth,
            height: window.innerHeight
          });
          popover.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px` });
        });
      }
      renderTranslationResult(sourceText, translated, detected, providerId) {
        const popover = this.translationPopoverEl;
        const sourceEl = popover.querySelector(".ez-reader__pdf-translation__source");
        const bodyEl = popover.querySelector(".ez-reader__pdf-translation__body");
        const providerEl = popover.querySelector(".ez-reader__pdf-translation__provider");
        if (sourceEl) sourceEl.setText(sourceText);
        if (bodyEl) {
          bodyEl.empty();
          bodyEl.setText(translated);
          bodyEl.removeClass("is-loading");
          bodyEl.removeClass("is-error");
        }
        if (providerEl) {
          const detectedPart = detected ? `\u68C0\u6D4B\u5230 ${detected} \xB7 ` : "";
          providerEl.setText(`${detectedPart}${providerId} \xB7 \u2192 ${this.targetLocale}`);
        }
      }
      renderTranslationError(sourceText, message) {
        const popover = this.translationPopoverEl;
        const sourceEl = popover.querySelector(".ez-reader__pdf-translation__source");
        const bodyEl = popover.querySelector(".ez-reader__pdf-translation__body");
        if (sourceEl) sourceEl.setText(sourceText);
        if (bodyEl) {
          bodyEl.empty();
          bodyEl.setText(`\u7FFB\u8BD1\u5931\u8D25: ${message}`);
          bodyEl.removeClass("is-loading");
          bodyEl.addClass("is-error");
        }
      }
      hideTranslationPopover() {
        this.translationPopoverEl.addClass("is-hidden");
      }
      /** Popover 内「复制」按钮 — 把当前译文写到剪贴板, 按钮短暂 ✓ 提示。 */
      async handleCopyTranslation() {
        const bodyEl = this.translationPopoverEl.querySelector(".ez-reader__pdf-translation__body");
        if (!bodyEl) return;
        const translated = bodyEl.textContent ?? "";
        try {
          await navigator.clipboard.writeText(translated);
          const btn = this.translationPopoverEl.querySelector(".ez-reader__pdf-translation__copy-btn");
          if (btn) {
            const original = btn.textContent ?? "\u590D\u5236";
            btn.setText("\u2713 \u5DF2\u590D\u5236");
            window.setTimeout(() => btn.setText(original), 1500);
          }
        } catch (error) {
          console.warn("[ez-reader] copy translation failed", error);
        }
      }
      /** Popover 内「换语言重译」按钮 — cycle 目标语言后复用 showTranslationPopover。 */
      async handleCycleTranslationTarget() {
        if (!this.pendingSelection) return;
        const cycle = ["zh-CN", "en", "ja", "ko", "fr", "de"];
        const currentIdx = cycle.indexOf(this.targetLocale);
        const next = cycle[(currentIdx + 1) % cycle.length] ?? "zh-CN";
        this.targetLocale = next;
        const text = this.pendingSelection.text;
        const rect = this.pendingSelection.rect;
        this.showTranslationPopover(text, rect);
        try {
          const result = await this.opts.translation.translate(text, "auto", this.targetLocale);
          this.renderTranslationResult(text, result.text, result.detectedSource, result.providerId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.renderTranslationError(text, message);
        }
      }
      async handleExcerpt() {
        if (!this.pendingSelection || !this.bookId) return;
        const sel = this.pendingSelection;
        const excerpt = {
          id: generateExcerptId2("ex"),
          bookId: this.bookId,
          text: sel.text,
          locator: {
            position: {
              kind: "pdf",
              page: sel.pageNumber,
              selection: sel.locator
            },
            chapter: ""
          },
          note: "",
          tags: [],
          createdAt: Date.now()
        };
        try {
          await this.opts.reading.addExcerpt(excerpt);
        } catch (error) {
          console.warn("[ez-reader] handleExcerpt addExcerpt failed", error);
          new import_obsidian18.Notice("\u4FDD\u5B58\u6458\u5F55\u5931\u8D25");
          return;
        }
        if (this.opts.noteWriter) {
          try {
            const ref = await this.opts.noteWriter.ensureBookNote({
              bookId: this.bookId,
              bookTitle: this.bookTitle,
              bookPath: this.opts.bookPath
            });
            await this.opts.noteWriter.appendExcerpt(ref, {
              excerptId: excerpt.id,
              text: excerpt.text,
              note: excerpt.note,
              tags: excerpt.tags,
              locator: { page: sel.pageNumber, cfi: void 0, fraction: 0 },
              chapterTitle: "",
              format: "pdf",
              createdAt: excerpt.createdAt
            });
          } catch (error) {
            console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
            new import_obsidian18.Notice("\u5199\u5165\u7B14\u8BB0\u5931\u8D25 (\u6458\u5F55\u5DF2\u4FDD\u5B58)");
          }
        }
        const result = findHighlightRect(this.container, sel.pageNumber, sel.text);
        if (result && result.rects.length > 0) {
          const allDivs = [];
          for (const r3 of result.rects) {
            allDivs.push(drawHighlight(this.highlightLayer, r3, excerpt.id, sel.text));
          }
          this.highlightsByExcerpt.set(excerpt.id, {
            excerptId: excerpt.id,
            pageNumber: sel.pageNumber,
            searchText: sel.text,
            div: allDivs[0],
            extraDivs: allDivs.slice(1)
          });
        }
        this.hideMenu();
        if (this.notesPanel.classList.contains("is-open")) {
          await this.refreshNotesPanel();
        }
        new import_obsidian18.Notice("\u6458\u5F55\u5DF2\u4FDD\u5B58");
      }
      /**
       * P0 修复: 之前 PDF selection menu 只有 "翻译/摘录/复制", 没有 "想法".
       * 用户只能在摘录后单独到 vault 改 note —— 跟 EPUB 路径不一致, 体验断裂.
       * 现在 selection menu 加"想法"按钮: 弹一个轻量 modal, 用户填想法文字,
       * 存成 Excerpt 同时填到 note 字段. 跟 handleExcerpt 共用 highlight 画法.
       */
      async handleThought() {
        if (!this.pendingSelection || !this.bookId) return;
        const sel = this.pendingSelection;
        this.hideMenu();
        const noteText = await promptForThought(this.opts.app, sel.text);
        if (noteText === null) return;
        const excerpt = {
          id: generateExcerptId2("ex"),
          bookId: this.bookId,
          text: sel.text,
          locator: {
            position: {
              kind: "pdf",
              page: sel.pageNumber,
              selection: sel.locator
            },
            chapter: ""
          },
          note: noteText,
          tags: [],
          createdAt: Date.now()
        };
        try {
          await this.opts.reading.addExcerpt(excerpt);
        } catch (error) {
          console.warn("[ez-reader] handleThought addExcerpt failed", error);
          new import_obsidian18.Notice("\u4FDD\u5B58\u60F3\u6CD5\u5931\u8D25");
          return;
        }
        if (this.opts.noteWriter) {
          try {
            const ref = await this.opts.noteWriter.ensureBookNote({
              bookId: this.bookId,
              bookTitle: this.bookTitle,
              bookPath: this.opts.bookPath
            });
            await this.opts.noteWriter.appendExcerpt(ref, {
              excerptId: excerpt.id,
              text: excerpt.text,
              note: excerpt.note,
              tags: excerpt.tags,
              locator: { page: sel.pageNumber, cfi: void 0, fraction: 0 },
              chapterTitle: "",
              format: "pdf",
              createdAt: excerpt.createdAt
            });
          } catch (error) {
            console.warn("[ez-reader] handleThought noteWriter.appendExcerpt failed", error);
            new import_obsidian18.Notice("\u5199\u5165\u7B14\u8BB0\u5931\u8D25 (\u60F3\u6CD5\u5DF2\u4FDD\u5B58)");
          }
        }
        const result = findHighlightRect(this.container, sel.pageNumber, sel.text);
        if (result && result.rects.length > 0) {
          const allDivs = [];
          for (const r3 of result.rects) {
            allDivs.push(drawHighlight(this.highlightLayer, r3, excerpt.id, sel.text));
          }
          this.highlightsByExcerpt.set(excerpt.id, {
            excerptId: excerpt.id,
            pageNumber: sel.pageNumber,
            searchText: sel.text,
            div: allDivs[0],
            extraDivs: allDivs.slice(1)
          });
        }
        if (this.notesPanel.classList.contains("is-open")) {
          await this.refreshNotesPanel();
        }
        new import_obsidian18.Notice(noteText.trim().length > 0 ? "\u60F3\u6CD5\u5DF2\u4FDD\u5B58" : "\u60F3\u6CD5 (\u7A7A) \u5DF2\u4FDD\u5B58");
      }
      async handleCopy() {
        if (!this.pendingSelection) return;
        const text = this.pendingSelection.text;
        try {
          await navigator.clipboard.writeText(text);
          new import_obsidian18.Notice(`\u5DF2\u590D\u5236 (${text.length} \u5B57\u7B26)`, 1500);
        } catch (error) {
          console.warn("[ez-reader] clipboard write failed", error);
          const message = error instanceof Error ? error.message : String(error);
          new import_obsidian18.Notice(`\u590D\u5236\u5931\u8D25: ${message}`, 4e3);
        }
        this.hideMenu();
      }
      /**
       * P1: in-PDF find. Walks PDFView text-layers page by page, looking for
       * `query` after the current page. On a hit, scrolls the page into view
       * + draws a yellow highlight rectangle. Updates the match count in the
       * search bar so the user sees "1/12" style progress.
       */
      async runPdfSearch(query, fromStart) {
        const trimmed = query.trim();
        if (!trimmed) {
          this.pdfFindQuery = "";
          this.pdfFindMatchCount = 0;
          updatePdfSearchStatus(this.searchBar, null);
          return;
        }
        this.pdfFindQuery = trimmed;
        const currentPage = fromStart ? 1 : this.pdfFindCurrentPage !== null ? this.pdfFindCurrentPage + 1 : findActivePageNumber(this.container) ?? 1;
        const nextPage = findNextPageWithText(this.container, trimmed, currentPage);
        if (nextPage === null) {
          this.pdfFindMatchCount = 0;
          updatePdfSearchStatus(this.searchBar, 0);
          new import_obsidian18.Notice(`PDF \u672A\u627E\u5230 "${trimmed}"`);
          return;
        }
        this.pdfFindCurrentPage = nextPage;
        const pageEl = findPageElement2(this.container, nextPage);
        pageEl?.scrollIntoView({ behavior: "smooth", block: "start" });
        this.clearPdfSearchHighlights();
        const rects = findHighlightRect(this.container, nextPage, trimmed);
        if (rects) {
          for (const r3 of rects.rects) {
            const div = drawHighlight(this.highlightLayer, r3, `__pdf_search__`, trimmed);
            div.addClass("ez-reader__pdf-overlay-highlight--search");
            this.pdfSearchHighlightDivs.push(div);
          }
          this.pdfFindMatchCount = 1;
          const total = this.countPdfMatchesAcrossPages(trimmed);
          updatePdfSearchStatus(this.searchBar, total);
        } else {
          updatePdfSearchStatus(this.searchBar, 1);
        }
      }
      pdfSearchHighlightDivs = [];
      clearPdfSearchHighlights() {
        for (const div of this.pdfSearchHighlightDivs) div.remove();
        this.pdfSearchHighlightDivs = [];
      }
      countPdfMatchesAcrossPages(query) {
        const pages = Array.from(
          this.container.querySelectorAll(".pdf-page[data-page-number], .page[data-page-number]")
        );
        let count = 0;
        const needle = query.toLocaleLowerCase();
        for (const page of pages) {
          const text = collectTextLayerSpans2(page).map((s3) => s3.textContent ?? "").join("").toLocaleLowerCase();
          let from = 0;
          let idx;
          while ((idx = text.indexOf(needle, from)) >= 0) {
            count += 1;
            from = idx + needle.length;
            if (count > 999) return count;
          }
        }
        return count;
      }
      closePdfSearch() {
        this.pdfFindQuery = "";
        this.pdfFindMatchCount = 0;
        this.pdfFindCurrentPage = null;
        this.clearPdfSearchHighlights();
        this.searchBar.classList.add("is-hidden");
        updatePdfSearchStatus(this.searchBar, null);
      }
      /** Public toggle — exposed so the host can hotkey Ctrl+F. */
      toggleSearchBar() {
        const visible = !this.searchBar.classList.contains("is-hidden");
        if (visible) this.closePdfSearch();
        else {
          this.searchBar.classList.remove("is-hidden");
          const input = this.searchBar.querySelector("input");
          input?.focus();
        }
      }
      /**
       * P1: 点击 PDF 黄条 → 笔记面板 focus 到对应 entry, 用 flash class
       * 让用户视觉确认。
       */
      focusExcerptInPanel(excerptId) {
        const panel = this.notesPanel;
        const target = panel.querySelector(`[data-excerpt-id="${cssEscapeAttr(excerptId)}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("ez-reader__pdf-overlay-row--focus");
        window.setTimeout(() => target.classList.remove("ez-reader__pdf-overlay-row--focus"), 1500);
      }
    };
    cssEscapeAttr = (value) => value.replace(/(["\\\]])/g, "\\$1");
    promptForThought = (app, selectionText) => {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "ez-reader__pdf-overlay-thought-prompt";
        overlay.addClass("ez-reader__modal-backdrop");
        const box = overlay.createDiv({ cls: "ez-reader__pdf-overlay-thought-prompt__box" });
        box.createEl("h3", { text: "\u8BB0\u5F55\u60F3\u6CD5" });
        const preview = box.createEl("blockquote", { text: selectionText.length > 200 ? `${selectionText.slice(0, 200)}\u2026` : selectionText, cls: "ez-reader__pdf-overlay-thought-prompt__preview" });
        const textarea = box.createEl("textarea", { cls: "ez-reader__pdf-overlay-thought-prompt__input", attr: { placeholder: "\u4F60\u7684\u60F3\u6CD5\u2026", rows: "5" } });
        const actions = box.createDiv({ cls: "ez-reader__modal-actions" });
        const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
        const save = actions.createEl("button", { text: "\u4FDD\u5B58", attr: { type: "button" } });
        save.addClass("mod-cta");
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          overlay.remove();
          resolve(value);
        };
        cancel.addEventListener("click", () => settle(null));
        save.addEventListener("click", () => settle(textarea.value));
        textarea.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            settle(null);
          } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            settle(textarea.value);
          }
        });
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) settle(null);
        });
        document.body.appendChild(overlay);
        textarea.focus();
      });
    };
    createSelectionMenu = (parent, handlers) => {
      const menu = document.createElement("div");
      menu.className = "ez-reader__pdf-overlay-menu";
      menu.setCssProps({ display: "none" });
      const mkBtn = (label, cls, onClick) => {
        const btn = menu.createEl("button", { text: label, cls: `ez-reader__pdf-overlay-menu__btn ${cls}` });
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        });
        return btn;
      };
      mkBtn("\u7FFB\u8BD1", "is-translate", handlers.onTranslate);
      mkBtn("\u6458\u5F55", "is-excerpt", handlers.onExcerpt);
      mkBtn("\u60F3\u6CD5", "is-thought", handlers.onThought);
      mkBtn("\u590D\u5236", "is-copy", handlers.onCopy);
      parent.appendChild(menu);
      return menu;
    };
    showMenuAt = (menu, rect) => {
      menu.setCssProps({
        display: "flex",
        left: "-9999px",
        top: "-9999px"
      });
      requestAnimationFrame(() => {
        const menuRect = menu.getBoundingClientRect();
        const pos = computeSelectionMenuPosition(rect, menuRect, {
          width: window.innerWidth,
          height: window.innerHeight
        });
        menu.setCssProps({
          left: `${pos.left}px`,
          top: `${pos.top}px`
        });
      });
    };
    createNotesButton = (parent, opts) => {
      const btn = document.createElement("button");
      btn.className = "ez-reader__pdf-overlay-notes-btn";
      btn.textContent = "\u{1F4DD}";
      btn.title = "\u7B14\u8BB0 (bookmarks / excerpts)";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onClick();
      });
      parent.appendChild(btn);
      return btn;
    };
    createNotesPanel = (parent) => {
      const panel = document.createElement("div");
      panel.className = "ez-reader__pdf-overlay-notes-panel";
      parent.appendChild(panel);
      return panel;
    };
    createHighlightLayer = (parent) => {
      const layer = document.createElement("div");
      layer.className = "ez-reader__pdf-overlay-highlight-layer";
      parent.appendChild(layer);
      return layer;
    };
    createSearchBar = (parent, handlers) => {
      const bar = document.createElement("div");
      bar.className = "ez-reader__pdf-overlay-search-bar is-hidden";
      const input = bar.createEl("input", {
        attr: { type: "search", placeholder: "\u641C\u7D22 PDF \u6587\u5B57\u2026\u2026", "aria-label": "\u641C\u7D22 PDF" }
      });
      input.addClass("ez-reader__pdf-overlay-search-bar__input");
      const status = bar.createEl("span", { text: "", cls: "ez-reader__pdf-overlay-search-bar__status" });
      const nextBtn = bar.createEl("button", { text: "\u2193", attr: { type: "button", title: "\u4E0B\u4E00\u5904" } });
      nextBtn.addClass("ez-reader__pdf-overlay-search-bar__btn");
      const prevBtn = bar.createEl("button", { text: "\u2191", attr: { type: "button", title: "\u4E0A\u4E00\u5904" } });
      prevBtn.addClass("ez-reader__pdf-overlay-search-bar__btn");
      const closeBtn = bar.createEl("button", { text: "\xD7", attr: { type: "button", title: "\u5173\u95ED" } });
      closeBtn.addClass("ez-reader__pdf-overlay-search-bar__btn", "ez-reader__pdf-overlay-search-bar__close");
      let lastQuery = "";
      const commit = (fromStart) => {
        const value = input.value.trim();
        lastQuery = value;
        handlers.onSearch(value, fromStart);
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.shiftKey);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          handlers.onClose();
        }
      });
      nextBtn.addEventListener("click", (event) => {
        event.preventDefault();
        commit(false);
      });
      prevBtn.addEventListener("click", (event) => {
        event.preventDefault();
        commit(true);
      });
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        handlers.onClose();
      });
      parent.appendChild(bar);
      bar.__ezReaderInput = input;
      bar.__ezReaderStatus = status;
      return bar;
    };
    updatePdfSearchStatus = (bar, count) => {
      const status = bar.__ezReaderStatus;
      if (!status) return;
      if (count === null) {
        status.setText("");
        return;
      }
      if (count === 0) {
        status.setText("\u65E0\u5339\u914D");
      } else {
        status.setText(`${count} \u5904`);
      }
    };
    collectTextLayerSpans2 = (pageEl) => {
      const textLayer = pageEl.querySelector(".textLayer");
      if (!(textLayer instanceof HTMLElement)) return [];
      return Array.from(textLayer.querySelectorAll(":scope > span")).filter(
        (el) => el instanceof HTMLElement
      );
    };
    renderNotesPanelContent = (panel, bookmarks, excerpts, handlers) => {
      panel.empty();
      panel.createEl("div", { cls: "ez-reader__pdf-overlay-notes-panel__heading", text: "\u7B14\u8BB0" });
      if (bookmarks.length === 0 && excerpts.length === 0) {
        panel.createEl("div", {
          cls: "ez-reader__pdf-overlay-notes-panel__empty",
          text: "\u8FD9\u672C\u4E66\u8FD8\u6CA1\u6709\u4E66\u7B7E\u6216\u6458\u5F55\u3002\u5728 PDF \u4E0A\u9009\u8BCD \u2192 \u6458\u5F55\u5373\u53EF\u6DFB\u52A0\u3002"
        });
        return;
      }
      if (bookmarks.length > 0) {
        panel.createEl("h4", { text: `\u4E66\u7B7E (${bookmarks.length})` });
        for (const bm of bookmarks) {
          const row = panel.createEl("div", { cls: "ez-reader__pdf-overlay-notes-panel__row" });
          row.createEl("span", { text: bm.label, cls: "label" });
          const del = row.createEl("button", { text: "\xD7", cls: "remove", title: "\u5220\u9664" });
          del.addEventListener("click", () => void handlers.onRemoveBookmark(bm.id));
        }
      }
      if (excerpts.length > 0) {
        panel.createEl("h4", { text: `\u6458\u5F55 (${excerpts.length})` });
        for (const ex of excerpts) {
          const row = panel.createEl("div", { cls: "ez-reader__pdf-overlay-notes-panel__row" });
          row.setAttribute("data-excerpt-id", ex.id);
          row.createEl("div", { text: ex.text, cls: "excerpt" });
          const pos = ex.locator.position;
          if (pos.kind === "pdf") {
            const target = pos.selection ?? `#page=${pos.page}`;
            const title = pos.selection ? "\u8DF3\u5230\u9009\u533A" : `\u8DF3\u5230\u7B2C ${pos.page} \u9875`;
            const jump = row.createEl("button", { text: "\u2192", cls: "jump", title });
            jump.addEventListener("click", () => handlers.onJump(target));
          }
          const del = row.createEl("button", { text: "\xD7", cls: "remove", title: "\u5220\u9664" });
          del.addEventListener("click", () => void handlers.onRemoveExcerpt(ex.id));
        }
      }
    };
    drawHighlight = (layer, rect, excerptId, searchText) => {
      const hl = document.createElement("div");
      hl.className = "ez-reader__pdf-overlay-highlight";
      hl.dataset.excerptId = excerptId;
      hl.dataset.searchText = searchText;
      hl.setCssProps({
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      });
      layer.appendChild(hl);
      return hl;
    };
    findPdfTotalPages = (container) => {
      const pages = Array.from(
        container.querySelectorAll(".pdf-page[data-page-number], .page[data-page-number]")
      );
      if (pages.length === 0) return null;
      let max2 = 0;
      for (const el of pages) {
        const n3 = el.getAttribute("data-page-number");
        if (n3 && /^\d+$/.test(n3)) {
          const parsed = Number(n3);
          if (parsed > max2) max2 = parsed;
        }
      }
      return max2 > 0 ? max2 : null;
    };
    createTranslationPopover = (parent, opts) => {
      const root = document.createElement("div");
      root.className = "ez-reader__pdf-translation is-hidden";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "\u7FFB\u8BD1\u7ED3\u679C");
      const header = document.createElement("div");
      header.className = "ez-reader__pdf-translation__header";
      const source = document.createElement("div");
      source.className = "ez-reader__pdf-translation__source";
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "ez-reader__pdf-translation__close";
      closeBtn.textContent = "\xD7";
      closeBtn.title = "\u5173\u95ED";
      closeBtn.setAttribute("aria-label", "\u5173\u95ED\u7FFB\u8BD1");
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        root.addClass("is-hidden");
      });
      header.append(source, closeBtn);
      const body = document.createElement("div");
      body.className = "ez-reader__pdf-translation__body is-loading";
      body.textContent = "\u6B63\u5728\u7FFB\u8BD1\u2026";
      const provider = document.createElement("div");
      provider.className = "ez-reader__pdf-translation__provider";
      const actions = document.createElement("div");
      actions.className = "ez-reader__pdf-translation__actions";
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "ez-reader__pdf-translation__copy-btn";
      copyBtn.textContent = "\u590D\u5236";
      copyBtn.setAttribute("aria-label", "\u590D\u5236\u8BD1\u6587");
      copyBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onCopy();
      });
      const cycleBtn = document.createElement("button");
      cycleBtn.type = "button";
      cycleBtn.className = "ez-reader__pdf-translation__cycle-btn";
      cycleBtn.textContent = "\u6362\u8BED\u8A00\u91CD\u8BD1";
      cycleBtn.setAttribute("aria-label", "\u5207\u6362\u76EE\u6807\u8BED\u8A00\u540E\u91CD\u65B0\u7FFB\u8BD1");
      cycleBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onCycleTarget();
      });
      actions.append(copyBtn, cycleBtn);
      root.append(header, body, provider, actions);
      makeDraggable(root, header);
      parent.appendChild(root);
      return root;
    };
    makeDraggable = (el, handle) => {
      let dragState = null;
      const cleanup = () => {
        dragState = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        el.removeClass("is-dragging");
      };
      const onMouseMove = (event) => {
        if (!dragState) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        const maxLeft = Math.max(0, window.innerWidth - dragState.width);
        const maxTop = Math.max(0, window.innerHeight - dragState.height);
        const newLeft = Math.max(0, Math.min(maxLeft, dragState.origLeft + dx));
        const newTop = Math.max(0, Math.min(maxTop, dragState.origTop + dy));
        el.setCssProps({ left: `${newLeft}px`, top: `${newTop}px` });
      };
      const onMouseUp = () => {
        cleanup();
      };
      handle.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target?.closest("button, input, select, textarea, [role='button']")) return;
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        dragState = {
          startX: event.clientX,
          startY: event.clientY,
          origLeft: rect.left,
          origTop: rect.top,
          width: rect.width,
          height: rect.height
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        el.addClass("is-dragging");
      });
    };
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => main_default
});
module.exports = __toCommonJS(main_exports);

// src/platform/Sha1.ts
var bytesFromBufferSource = (input) => {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    const view = input;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  const text = String(input);
  const out = new Uint8Array(text.length);
  for (let i3 = 0; i3 < text.length; i3++) out[i3] = text.charCodeAt(i3) & 255;
  return out;
};
var sha1Bytes = (bytes) => {
  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = (len + 9 + 63 & ~63) - len;
  const buf = new Uint8Array(len + padLen);
  buf.set(bytes);
  buf[len] = 128;
  const view = new DataView(buf.buffer);
  const high = Math.floor(bitLen / 4294967296);
  const low = bitLen >>> 0;
  view.setUint32(buf.length - 8, high, false);
  view.setUint32(buf.length - 4, low, false);
  let h0 = 1732584193;
  let h1 = 4023233417;
  let h22 = 2562383102;
  let h3 = 271733878;
  let h4 = 3285377520;
  const rotl = (x3, n3) => x3 << n3 | x3 >>> 32 - n3;
  const w2 = new Uint32Array(80);
  for (let i3 = 0; i3 < buf.length; i3 += 64) {
    for (let j2 = 0; j2 < 16; j2++) {
      w2[j2] = view.getUint32(i3 + j2 * 4, false);
    }
    for (let j2 = 16; j2 < 80; j2++) {
      w2[j2] = rotl(w2[j2 - 3] ^ w2[j2 - 8] ^ w2[j2 - 14] ^ w2[j2 - 16], 1);
    }
    let a3 = h0, b3 = h1, c2 = h22, d2 = h3, e3 = h4;
    for (let j2 = 0; j2 < 80; j2++) {
      let f3, k3;
      if (j2 < 20) {
        f3 = b3 & c2 | ~b3 & d2;
        k3 = 1518500249;
      } else if (j2 < 40) {
        f3 = b3 ^ c2 ^ d2;
        k3 = 1859775393;
      } else if (j2 < 60) {
        f3 = b3 & c2 | b3 & d2 | c2 & d2;
        k3 = 2400959708;
      } else {
        f3 = b3 ^ c2 ^ d2;
        k3 = 3395469782;
      }
      const temp = rotl(a3, 5) + f3 + e3 + k3 + w2[j2] | 0;
      e3 = d2;
      d2 = c2;
      c2 = rotl(b3, 30);
      b3 = a3;
      a3 = temp;
    }
    h0 = h0 + a3 | 0;
    h1 = h1 + b3 | 0;
    h22 = h22 + c2 | 0;
    h3 = h3 + d2 | 0;
    h4 = h4 + e3 | 0;
  }
  const out = new ArrayBuffer(20);
  const outView = new DataView(out);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h22, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
};

// src/platform/polyfills.ts
if (typeof Object.groupBy !== "function") {
  Object.groupBy = function groupBy(items, callback) {
    const result = /* @__PURE__ */ Object.create(null);
    let index = 0;
    for (const item of items) {
      const key = String(callback(item, index));
      const bucket = result[key];
      if (bucket) bucket.push(item);
      else result[key] = [item];
      index += 1;
    }
    return result;
  };
}
if (typeof Map.groupBy !== "function") {
  Map.groupBy = function groupBy(items, callback) {
    const result = /* @__PURE__ */ new Map();
    let index = 0;
    for (const item of items) {
      const key = callback(item, index);
      const bucket = result.get(key);
      if (bucket) bucket.push(item);
      else result.set(key, [item]);
      index += 1;
    }
    return result;
  };
}
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve = () => void 0;
    let reject = () => void 0;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
if (typeof ReadableStream !== "undefined" && typeof ReadableStream.prototype[Symbol.asyncIterator] !== "function") {
  ReadableStream.prototype[Symbol.asyncIterator] = function asyncIterator() {
    const reader = this.getReader();
    const iterator = {
      async next() {
        try {
          const { done, value } = await reader.read();
          return done ? { value: void 0, done: true } : { value, done: false };
        } catch (error) {
          reader.releaseLock();
          throw error;
        }
      },
      async return() {
        try {
          if (typeof reader.cancel === "function") {
            await reader.cancel();
          }
        } finally {
          reader.releaseLock();
        }
        return { value: void 0, done: true };
      },
      [Symbol.asyncIterator]() {
        return iterator;
      }
    };
    return iterator;
  };
}
if (typeof window.structuredClone !== "function") {
  const jsonClone = (value) => JSON.parse(JSON.stringify(value));
  Object.defineProperty(window, "structuredClone", {
    value: jsonClone,
    writable: true,
    configurable: true
  });
}
var installSha1DigestFallback = () => {
  const cryptoObj = window.crypto;
  if (cryptoObj && typeof cryptoObj.subtle?.digest === "function") return;
  const subtle = {
    async digest(algorithm, data) {
      const name = String(algorithm).toLowerCase();
      if (name !== "sha-1" && name !== "sha1") {
        throw new Error(`crypto.subtle.digest fallback only supports SHA-1 (requested: ${algorithm})`);
      }
      return sha1Bytes(bytesFromBufferSource(data));
    }
  };
  if (cryptoObj) {
    try {
      Object.defineProperty(cryptoObj, "subtle", {
        value: subtle,
        configurable: true,
        writable: true
      });
    } catch (error) {
      console.warn("[ez-reader] could not install crypto.subtle fallback", error);
    }
  } else {
    try {
      Object.defineProperty(window, "crypto", {
        value: { subtle, getRandomValues: (a3) => a3 },
        configurable: true,
        writable: true
      });
    } catch (error) {
      console.warn("[ez-reader] could not install crypto stub", error);
    }
  }
};
installSha1DigestFallback();
var collectPolyfillReport = () => {
  const checks = [
    ["Object.groupBy", window.Object?.groupBy],
    ["Map.groupBy", window.Map?.groupBy],
    ["Promise.withResolvers", Promise.withResolvers],
    ["ReadableStream[Symbol.asyncIterator]", typeof ReadableStream !== "undefined" && typeof ReadableStream.prototype[Symbol.asyncIterator] === "function"],
    ["structuredClone", typeof window.structuredClone === "function"],
    ["crypto.subtle.digest", typeof window.crypto?.subtle?.digest === "function"],
    ["ResizeObserver", typeof ResizeObserver !== "undefined"],
    ["Intl.Segmenter", typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"],
    ["customElements", typeof customElements !== "undefined"]
  ];
  const missing = checks.filter(([, present]) => !present).map(([name]) => name);
  return { missing };
};

// src/Plugin.ts
var import_obsidian19 = require("obsidian");

// src/adapters/obsidian/CoverCache.ts
var import_obsidian = require("obsidian");
var CoverCache = class {
  coversDir;
  app;
  plugin;
  library;
  /**
   * Adapter map keyed by format. PDF is intentionally absent — Obsidian's
   * built-in viewer handles PDF cover rendering on its own.
   */
  readers;
  annotations;
  inFlight = /* @__PURE__ */ new Set();
  constructor(app, plugin, library, readers, annotations) {
    this.app = app;
    this.plugin = plugin;
    this.library = library;
    this.readers = readers;
    this.annotations = annotations;
    this.coversDir = (0, import_obsidian.normalizePath)(`${app.vault.configDir}/plugins/${plugin.manifest.id}/data/covers`);
  }
  /**
   * Extract a cover for a book and write it to disk. Idempotent and
   * concurrent-safe: a single book is extracted at most once per session
   * even if multiple callers race here.
   *
   * Format routing:
   *   - EPUB → foliate-js `getCover()`.
   *   - MOBI / AZW3 → `@lingo-reader/mobi-parser` cover blob URL.
   *   - TXT → no entry in `readers` → shelf uses placeholder.
   *   - PDF → not handled here (Obsidian built-in viewer).
   *
   * If a reader throws on this format (e.g. a corrupted MOBI), we warn
   * and leave `coverPath` null — same fallback as before.
   *
   * P0 修复: 给 reader.extractCover 加 15s 超时. 之前损坏的 EPUB / MOBI 让
   * foliate.getCover() 或 mobi.initMobiFile 永远不 resolve, ensureCoverFor
   * 永不退出, inFlight 永不 delete, 所有后续的 ensureCoverFor 调用全部
   * hit cache 但 modal.confirmSelection 等 ensureCoversBatch 完成 — 整个
   * "加入所选" 卡死, 按钮永远不能再次点击. 加超时后 hang 也只是 warn + 跳过,
   * inFlight.delete 让其他并发路径仍能尝试重新提取.
   */
  async ensureCoverFor(book, loader) {
    if (book.coverPath) return;
    if (this.inFlight.has(book.id)) return;
    this.inFlight.add(book.id);
    try {
      const reader = this.readers[book.locator.format];
      if (!reader) {
        return;
      }
      let extracted;
      try {
        extracted = await this.raceWithTimeout(
          reader.extractCover(book, loader),
          COVER_EXTRACT_TIMEOUT_MS,
          `extractCover(${book.locator.format})`
        );
      } catch (error) {
        console.warn(`[ez-reader] extractCover failed for ${book.locator.format} ${book.locator.path}`, error);
        return;
      }
      if (!extracted) return;
      const path = await this.writeCover(book, extracted.bytes, extracted.mimeType);
      await this.annotations.patchCoverPaths((current) => ({ ...current, [book.id]: path }));
      this.library.setCoverPath(book.id, path);
    } catch (error) {
      console.warn(`[ez-reader] cover extraction failed for ${book.locator.path}`, error);
    } finally {
      this.inFlight.delete(book.id);
    }
  }
  /**
   * 跟 AddToLibraryModal.raceWithTimeout 同样的语义. 返回 undefined 表示超时
   * 或失败 — 调用方要据此放弃这条记录. Promise 自身不 reject, 避免在
   * Promise.all 里被一个超时拖崩所有其他并发路径.
   */
  raceWithTimeout(promise, ms, label) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn(`[ez-reader] ${label} exceeded ${ms}ms \u2014 abandoning`);
        resolve(void 0);
      }, ms);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          console.warn(`[ez-reader] ${label} rejected`, error);
          resolve(void 0);
        }
      );
    });
  }
  /**
   * Extract covers for a batch of books in parallel. Concurrency is
   * capped at 3 to avoid saturating the render thread when the user
   * imports a large library.
   */
  async ensureCoversBatch(books, loader) {
    const queue = books.filter((b3) => !b3.coverPath);
    let index = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const book = queue[index++];
        await this.ensureCoverFor(book, loader);
      }
    });
    await Promise.all(workers);
  }
  async writeCover(book, bytes, mimeType) {
    if (!await this.app.vault.adapter.exists(this.coversDir)) {
      try {
        await this.app.vault.adapter.mkdir(this.coversDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!await this.app.vault.adapter.exists(this.coversDir)) {
          throw new Error(`mkdir(${this.coversDir}) failed: ${message}`);
        }
      }
    }
    const extension = extensionForMime(mimeType);
    const safeId = book.id.replace(/[^A-Za-z0-9._-]/g, "_");
    const target = (0, import_obsidian.normalizePath)(`${this.coversDir}/${safeId}${extension}`);
    await this.app.vault.adapter.writeBinary(target, bytes);
    return this.app.vault.adapter.getResourcePath(target);
  }
  /**
   * Recover cover paths for every book in the library. The source of
   * truth is the covers directory on disk: we list it and ask Obsidian
   * for a fresh resource path for each file. The persisted snapshot is
   * only used as a hint for which bookId a given slug corresponds to.
   *
   * We deliberately do not reuse the `app://...?token` URLs stored in
   * the snapshot — those tokens are session-scoped and Chrome refuses
   * to load them after the original session ends.
   */
  async hydrateCovers() {
    if (!await this.app.vault.adapter.exists(this.coversDir)) {
      console.info(`[ez-reader] hydrateCovers: covers dir missing: ${this.coversDir}`);
      return;
    }
    const listing = await this.app.vault.adapter.list(this.coversDir);
    console.info(`[ez-reader] hydrateCovers: found ${listing.files.length} file(s) in ${this.coversDir}`);
    if (listing.files.length === 0) return;
    const slugToBookId = this.buildSlugIndex();
    for (const filePath of listing.files) {
      const fileName = filePath.split("/").pop() ?? "";
      const slug = fileName.replace(/\.[^.]+$/, "");
      if (!slug) {
        console.warn(`[ez-reader] hydrateCovers: cannot extract slug from ${filePath}`);
        continue;
      }
      const bookId = slugToBookId.get(slug);
      if (!bookId) {
        console.info(`[ez-reader] hydrateCovers: no matching book for slug: ${slug} (orphan, ignored)`);
        continue;
      }
      const resourcePath = this.app.vault.adapter.getResourcePath(filePath);
      this.library.setCoverPath(bookId, resourcePath);
      console.info(`[ez-reader] hydrateCovers: hydrated ${bookId}`);
    }
  }
  /**
   * Build a slug → bookId index once per hydration. LibraryService 的
   * `list()` 是已 sort 过 titleAsc 的快照 — 同样 N 本书同样的 safeId 派生,
   * 用 Map 一次 O(N) 建表后, M 个 cover 文件的查找变 O(M).
   */
  buildSlugIndex() {
    const map = /* @__PURE__ */ new Map();
    for (const entry of this.library.list({}, "titleAsc", true)) {
      const safeId = entry.book.id.replace(/[^A-Za-z0-9._-]/g, "_");
      if (!map.has(safeId)) map.set(safeId, entry.book.id);
    }
    return map;
  }
};
var extensionForMime = (mime) => {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".img";
};
var COVER_EXTRACT_TIMEOUT_MS = 15e3;

// src/core/types/ReaderSettings.ts
var DEFAULT_READER_APPEARANCE = Object.freeze({
  fontSize: 100,
  lineHeight: 1.6,
  margin: 32,
  theme: "system",
  flow: "paginated",
  twoPages: false,
  immersive: false,
  fontFamily: "serif",
  letterSpacing: 0,
  maxWidth: 720
});
var READER_FONT_FAMILY_STACKS = Object.freeze({
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif: '"Source Serif Pro", "Iowan Old Style", "Apple Garamond", Georgia, "Times New Roman", "Songti SC", "STSong", serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  song: '"Songti SC", "STSong", "SimSun", "Source Han Serif SC", serif',
  kai: '"Kaiti SC", "STKaiti", "BiauKai", "Noto Serif CJK TC", serif'
});
var READER_FONT_FAMILY_LABELS = Object.freeze({
  sans: "\u65E0\u886C\u7EBF",
  serif: "\u886C\u7EBF",
  mono: "\u7B49\u5BBD",
  song: "\u5B8B\u4F53",
  kai: "\u6977\u4F53"
});
var SHELF_DENSITIES = ["compact", "default", "spacious", "large"];
var SHELF_DENSITY_LABELS = Object.freeze({
  compact: "\u7D27\u51D1",
  default: "\u9ED8\u8BA4",
  spacious: "\u5BBD\u677E",
  large: "\u8D85\u5927"
});
var DEFAULT_KEYBOARD_SHORTCUTS = Object.freeze({
  prev: "ArrowLeft",
  next: "ArrowRight",
  toggleSidebar: "s",
  toggleToc: "t",
  translate: "T",
  highlight: "h",
  find: "/"
});
var DEFAULT_PLUGIN_SETTINGS = Object.freeze({
  uiLocale: "zh-CN",
  translation: null,
  defaultAppearance: DEFAULT_READER_APPEARANCE,
  // 默认放在 vault 顶层一个统一目录 `ezreader-notes/` 下,两
  // 个子目录分别存摘录笔记和主题研究。ObsidianNoteWriter
  // 在第一次写笔记时会递归创建路径, 用户无需手动 mkdir.
  notesDirectory: "ezreader-notes/\u9605\u8BFB\u7B14\u8BB0",
  researchDirectory: "ezreader-notes/\u4E3B\u9898\u7814\u7A76",
  libraryOwnerName: "",
  defaultNoteTemplate: "# {{title}}\n",
  readerOpenMode: "tab",
  twoPagesByDefault: false,
  immersiveOnTablet: false,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  rememberProgress: true,
  shelfDensity: "default"
});

// src/adapters/obsidian/ObsidianAnnotationStore.ts
var ObsidianAnnotationStore = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  cache = null;
  // Serialize all writes through this chain. loadData/saveData use the
  // file system; two concurrent addBookmark/addExcerpt calls would
  // otherwise each read the same base snapshot, both build a delta on
  // top, and the later save would clobber the earlier one.
  writeChain = Promise.resolve();
  /**
   * Called after every settings mutation (saveSettings / patchSettings)
   * with the freshly-persisted PluginSettings. Used by Plugin to bust
   * downstream caches (e.g. TranslationCoordinator's 30s settings TTL).
   */
  settingsListeners = /* @__PURE__ */ new Set();
  /**
   * Subscribe to settings changes. Returns a disposer that unsubscribes.
   * Used by Plugin to wire TranslationCoordinator.invalidate() and other
   * downstream caches without making them part of the AnnotationStore port.
   */
  onSettingsChanged(listener) {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }
  notifySettingsChanged(settings) {
    for (const listener of this.settingsListeners) {
      try {
        listener(settings);
      } catch (error) {
        console.warn("[ez-reader] settings change listener threw", error);
      }
    }
  }
  async load() {
    if (this.cache) return this.cache;
    const raw = await this.plugin.loadData();
    const settings = this.normalizeSettings(raw?.settings);
    this.cache = {
      version: 1,
      settings,
      library: this.sanitizeStringArray(raw?.library),
      reading: this.sanitizeReadingArray(raw?.reading),
      bookmarks: this.sanitizeBookmarkArray(raw?.bookmarks),
      excerpts: this.sanitizeExcerptArray(raw?.excerpts),
      coverPaths: this.sanitizeRecord(raw?.coverPaths),
      addedAtByBookId: this.sanitizeAddedAtMap(raw?.addedAtByBookId),
      // 镜像 sanitizeAddedAtMap 的逻辑: 数字映射, 过滤非有限正值.
      pinnedAtByBookId: this.sanitizeAddedAtMap(raw?.pinnedAtByBookId),
      // P0-2: rich metadata 从 EPUB OPF / MOBI EXTH 解析, 持久化避免每次
      // open 都重新解析 (MOBI parser 阻塞主线程 2-5s). sanitize 失败时
      // 静默丢, 让 caller 重试下一次 open.
      richMetadataByBookId: this.sanitizeRichMetadataMap(raw?.richMetadataByBookId),
      // P0 修复: 之前漏读 onboardingDismissed, hasOnboardingBeenDismissed
      // 永远返回 false, modal 每次启动都弹. markOnboardingDismissed 写的
      // 标志其实在 data.json 里, 只是 load() 没拷到 cache.
      onboardingDismissed: raw?.onboardingDismissed === true,
      // P2: 跟 pinnedAtByBookId / addedAtByBookId 同样的 fallback 模式 —
      // 旧 data.json 没这个字段就给空 map, 不会因为 undefined 让
      // loadVisitedTocIds 炸掉.
      visitedTocIdsByBookId: this.sanitizeVisitedTocIdsMap(raw?.visitedTocIdsByBookId)
    };
    return this.cache;
  }
  /** Wrap a mutation so it serializes through `writeChain`. */
  async mutate(fn) {
    const next = this.writeChain.then(fn).then(async (snapshot) => {
      this.cache = snapshot;
      await this.plugin.saveData(snapshot);
    });
    this.writeChain = next.then(
      () => void 0,
      () => void 0
    );
    await next;
  }
  sanitizeStringArray(input) {
    return Array.isArray(input) ? input.filter((x3) => typeof x3 === "string") : [];
  }
  sanitizeReadingArray(input) {
    if (!Array.isArray(input)) return [];
    return input.filter((x3) => {
      if (!x3 || typeof x3 !== "object") return false;
      const r3 = x3;
      return typeof r3.bookId === "string" && (r3.status === "unread" || r3.status === "reading" || r3.status === "finished" || r3.status === "abandoned");
    });
  }
  sanitizeBookmarkArray(input) {
    if (!Array.isArray(input)) return [];
    return input.filter((x3) => {
      if (!x3 || typeof x3 !== "object") return false;
      const b3 = x3;
      return typeof b3.id === "string" && typeof b3.bookId === "string" && typeof b3.label === "string";
    });
  }
  sanitizeExcerptArray(input) {
    if (!Array.isArray(input)) return [];
    return input.filter((x3) => {
      if (!x3 || typeof x3 !== "object") return false;
      const e3 = x3;
      return typeof e3.id === "string" && typeof e3.bookId === "string" && typeof e3.text === "string" && e3.locator !== null && typeof e3.locator === "object";
    });
  }
  sanitizeRecord(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [k3, v3] of Object.entries(input)) {
      if (typeof v3 === "string") out[k3] = v3;
    }
    return out;
  }
  sanitizeAddedAtMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [k3, v3] of Object.entries(input)) {
      if (typeof v3 === "number" && Number.isFinite(v3) && v3 > 0) out[k3] = v3;
    }
    return out;
  }
  /**
   * Validate the per-book rich metadata map. Each entry must be a plain
   * object with a non-empty `title` string; everything else (authors,
   * publisher, etc.) is optional and falls back to empty. Invalid entries
   * are dropped silently so a corrupt data.json never crashes the shelf.
   */
  sanitizeRichMetadataMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [k3, v3] of Object.entries(input)) {
      if (!v3 || typeof v3 !== "object") continue;
      const m3 = v3;
      if (typeof m3.title !== "string" || !m3.title.trim()) continue;
      const authors = Array.isArray(m3.authors) ? m3.authors.filter((a3) => typeof a3 === "string" && a3.trim().length > 0).map((a3) => a3.trim()) : [];
      const cachedAt = typeof m3.cachedAt === "number" && Number.isFinite(m3.cachedAt) && m3.cachedAt > 0 ? m3.cachedAt : Date.now();
      out[k3] = {
        title: m3.title.trim(),
        authors,
        languages: [],
        cachedAt
      };
    }
    return out;
  }
  /**
   * P2: 验证 visited toc ids map. 每本书的 value 是 string array; 元素
   * 不是 string 过滤掉, 整个 entry 损坏 (非 array) 也丢, 不让坏数据
   * 整个阻塞 load.
   */
  sanitizeVisitedTocIdsMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [k3, v3] of Object.entries(input)) {
      if (!Array.isArray(v3)) continue;
      const ids = [];
      const seen = /* @__PURE__ */ new Set();
      for (const id of v3) {
        if (typeof id !== "string" || !id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      if (ids.length > 0) out[k3] = ids;
    }
    return out;
  }
  async save(snapshot) {
    await this.mutate(async () => snapshot);
  }
  async listLibrary() {
    const snapshot = await this.load();
    return snapshot.library;
  }
  async addToLibrary(bookId) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.library.includes(bookId)) return snapshot;
      return { ...snapshot, library: [...snapshot.library, bookId] };
    });
  }
  async removeFromLibrary(bookId) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return {
        ...snapshot,
        library: snapshot.library.filter((id) => id !== bookId)
      };
    });
  }
  async listReading() {
    const snapshot = await this.load();
    return snapshot.reading;
  }
  async upsertReading(state) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const next = [...snapshot.reading.filter((s3) => s3.bookId !== state.bookId), state];
      return { ...snapshot, reading: next };
    });
  }
  async listBookmarks(bookId) {
    const snapshot = await this.load();
    return snapshot.bookmarks.filter((bookmark) => bookmark.bookId === bookId);
  }
  async addBookmark(bookmark) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.bookmarks.some((b3) => b3.id === bookmark.id)) return snapshot;
      return { ...snapshot, bookmarks: [...snapshot.bookmarks, bookmark] };
    });
  }
  async removeBookmark(bookId, bookmarkId) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return {
        ...snapshot,
        bookmarks: snapshot.bookmarks.filter((b3) => !(b3.bookId === bookId && b3.id === bookmarkId))
      };
    });
  }
  async listExcerpts(bookId) {
    const snapshot = await this.load();
    return snapshot.excerpts.filter((excerpt) => excerpt.bookId === bookId);
  }
  async addExcerpt(excerpt) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.excerpts.some((e3) => e3.id === excerpt.id)) return snapshot;
      return { ...snapshot, excerpts: [...snapshot.excerpts, excerpt] };
    });
  }
  async removeExcerpt(bookId, excerptId) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return {
        ...snapshot,
        excerpts: snapshot.excerpts.filter((e3) => !(e3.bookId === bookId && e3.id === excerptId))
      };
    });
  }
  async updateExcerptNote(bookId, excerptId, patch) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const next = snapshot.excerpts.map((e3) => {
        if (e3.bookId !== bookId || e3.id !== excerptId) return e3;
        return {
          ...e3,
          ...patch.note !== void 0 ? { note: patch.note } : {},
          ...patch.tags !== void 0 ? { tags: patch.tags } : {}
        };
      });
      return { ...snapshot, excerpts: next };
    });
  }
  async listSettings() {
    const snapshot = await this.load();
    return snapshot.settings;
  }
  async saveSettings(settings) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return { ...snapshot, settings };
    });
    this.notifySettingsChanged(settings);
  }
  /**
   * Atomic settings update. The read-modify-write runs inside the write
   * chain so two concurrent patches can't both read the same base and
   * overwrite each other's fields. Use this from any debounced caller
   * (slider drag, text input) to avoid the read-modify-write race that
   * `listSettings()` + `saveSettings()` would create.
   */
  async patchSettings(patch) {
    let nextSettings;
    await this.mutate(async () => {
      const snapshot = await this.load();
      nextSettings = patch(snapshot.settings);
      return { ...snapshot, settings: nextSettings };
    });
    if (nextSettings) this.notifySettingsChanged(nextSettings);
  }
  async loadCoverPaths() {
    const snapshot = await this.load();
    return snapshot.coverPaths ?? {};
  }
  async saveCoverPaths(coverPaths) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      return { ...snapshot, coverPaths };
    });
  }
  /**
   * P0-3 修复: 原子地 read-modify-write coverPaths map. 旧 `saveCoverPaths`
   * 是 caller 先 loadCoverPaths (读 cache) 再 saveCoverPaths (写) — 两个
   * 并发 caller 都可能在 T1-T2 之间读到同一份旧 map, 然后后写的覆盖先写
   * 的, 丢 coverPath. 现在 patch callback 在 mutate 内部读最新 cache 再 merge,
   * 串行化在 writeChain 上 — 跟 patchSettings 同样的语义.
   */
  async patchCoverPaths(patch) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.coverPaths ?? {};
      return { ...snapshot, coverPaths: patch(current) };
    });
  }
  async markOnboardingDismissed() {
    await this.mutate(async () => {
      const snapshot = await this.load();
      if (snapshot.onboardingDismissed === true) return snapshot;
      return { ...snapshot, onboardingDismissed: true };
    });
  }
  async getAddedAt(bookId) {
    const snapshot = await this.load();
    return snapshot.addedAtByBookId?.[bookId] ?? null;
  }
  async setAddedAt(bookId, addedAt) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.addedAtByBookId ?? {};
      if (current[bookId] !== void 0 && current[bookId] <= addedAt) return snapshot;
      return { ...snapshot, addedAtByBookId: { ...current, [bookId]: addedAt } };
    });
  }
  async getPinnedAt(bookId) {
    const snapshot = await this.load();
    return snapshot.pinnedAtByBookId?.[bookId] ?? null;
  }
  async setPinnedAt(bookId, pinnedAt) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.pinnedAtByBookId ?? {};
      const next = { ...current };
      if (pinnedAt === null) {
        delete next[bookId];
      } else {
        next[bookId] = pinnedAt;
      }
      return { ...snapshot, pinnedAtByBookId: next };
    });
  }
  /**
   * P0-2 配套: 持久化从 EPUB/MOBI 解析的真 metadata, 避免每次 vault 重启
   * 都重新解压解析 (MOBI 大文件阻塞主线程 2-5s). overwrite 不 merge —
   * 真 metadata 应该是 ground truth, 不会比之前解析的还差.
   */
  async saveRichMetadata(bookId, metadata) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.richMetadataByBookId ?? {};
      return { ...snapshot, richMetadataByBookId: { ...current, [bookId]: metadata } };
    });
  }
  async loadRichMetadata(bookId) {
    const snapshot = await this.load();
    return snapshot.richMetadataByBookId?.[bookId] ?? null;
  }
  /**
   * P0 修复: 之前 `Promise.all([...addToLibrary, ...setAddedAt])` 让每个
   * book 都触发 2 个串行 mutate (writeChain 串行化). 100 本书 = 200 个
   * saveData, 用户报告"加入所选"体感 ~10s 甚至卡死. 现在 1 个 mutate
   * 把所有 ids 一起加上 + 一起 stamp, 一次 saveData 落盘.
   */
  async addToLibraryBatchWithStamp(bookIds, addedAt) {
    if (bookIds.length === 0) return;
    await this.mutate(async () => {
      const snapshot = await this.load();
      const existingLibrary = new Set(snapshot.library);
      const existingAddedAt = snapshot.addedAtByBookId ?? {};
      const newIds = bookIds.filter((id) => !existingLibrary.has(id));
      if (newIds.length === 0) return snapshot;
      const library = [...snapshot.library, ...newIds];
      const addedAtByBookId = { ...existingAddedAt };
      for (const id of newIds) {
        const current = addedAtByBookId[id];
        if (typeof current === "number" && current >= addedAt) continue;
        addedAtByBookId[id] = addedAt;
      }
      return { ...snapshot, library, addedAtByBookId };
    });
  }
  async hasOnboardingBeenDismissed() {
    const snapshot = await this.load();
    return snapshot.onboardingDismissed === true;
  }
  /**
   * P2: 读 visited toc ids. 旧 data.json 没 visitedTocIdsByBookId 字段
   * 时 load() 已 fallback 到空 map, 这里直接读.
   */
  async loadVisitedTocIds(bookId) {
    const snapshot = await this.load();
    return snapshot.visitedTocIdsByBookId?.[bookId] ?? [];
  }
  /**
   * P2: 写 visited toc ids. 在 write chain 内做 (跟 setPinnedAt 同样的
   * mutate 模式) — 避免两个并发 caller (relocate 触发多个 chapter
   * visited) 各 load 一份旧 array 后互相覆盖. caller 自己负责去重
   * (ReaderView.schedulePersistVisited 维护本地 Set).
   */
  async saveVisitedTocIds(bookId, ids) {
    await this.mutate(async () => {
      const snapshot = await this.load();
      const current = snapshot.visitedTocIdsByBookId ?? {};
      const next = { ...current, [bookId]: [...ids] };
      return { ...snapshot, visitedTocIdsByBookId: next };
    });
  }
  normalizeSettings(input) {
    if (!input) return DEFAULT_PLUGIN_SETTINGS;
    return { ...DEFAULT_PLUGIN_SETTINGS, ...input };
  }
};

// src/adapters/obsidian/ObsidianBookSource.ts
var import_obsidian2 = require("obsidian");

// src/core/entities/Book.ts
var SUPPORTED_BOOK_FORMATS = /* @__PURE__ */ new Set([
  "epub",
  "mobi",
  "azw",
  "azw3",
  "txt",
  "pdf"
]);
var READER_CAPABLE_FORMATS = /* @__PURE__ */ new Set([
  "epub",
  "pdf",
  "txt",
  "mobi",
  "azw3"
]);
var mimeTypeFor = (format) => {
  switch (format) {
    case "epub":
      return "application/epub+zip";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "mobi":
    case "azw":
    case "azw3":
      return "application/x-mobipocket-ebook";
  }
};

// src/adapters/obsidian/ObsidianBookSource.ts
var METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var ObsidianBookSource = class {
  constructor(app) {
    this.app = app;
  }
  /** Filename-derived metadata cache keyed by path. */
  metadataCache = /* @__PURE__ */ new Map();
  /**
   * Walk the vault using the file-system adapter so we discover files
   * Obsidian hasn't surfaced in the file explorer yet (PDF, EPUB, etc.).
   * `vault.getFiles()` only returns files Obsidian has loaded; using
   * `adapter.list()` is more reliable for "everything in the Vault".
   */
  async *scan(formats) {
    const wanted = formats.size === 0 ? SUPPORTED_BOOK_FORMATS : formats;
    const seenPaths = /* @__PURE__ */ new Set();
    let totalFromGetFiles = 0;
    for (const file of this.app.vault.getFiles()) {
      if (!(file instanceof import_obsidian2.TFile)) continue;
      totalFromGetFiles += 1;
      if (seenPaths.has(file.path)) continue;
      const format = extensionToFormat(file.extension);
      if (!format || !wanted.has(format)) continue;
      seenPaths.add(file.path);
      yield makeLocator(file, format);
    }
    let acceptedFromAdapter = 0;
    const adapterFolders = [""];
    const visited = /* @__PURE__ */ new Set();
    let head = 0;
    while (head < adapterFolders.length) {
      const folder = adapterFolders[head++] ?? "";
      let entries;
      try {
        entries = await this.app.vault.adapter.list(folder);
      } catch (error) {
        console.warn(`[ez-reader] adapter.list failed for ${folder || "/"}`, error);
        continue;
      }
      for (const filePath of entries.files) {
        if (seenPaths.has(filePath)) continue;
        const abstract = this.app.vault.getAbstractFileByPath(filePath);
        if (!(abstract instanceof import_obsidian2.TFile)) continue;
        const format = extensionToFormat(abstract.extension);
        if (!format || !wanted.has(format)) continue;
        seenPaths.add(filePath);
        acceptedFromAdapter += 1;
        yield makeLocator(abstract, format);
      }
      for (const subFolder of entries.folders) {
        if (visited.has(subFolder)) continue;
        visited.add(subFolder);
        adapterFolders.push(subFolder);
      }
    }
    console.info(
      `[ez-reader] Scan: vault.getFiles()=${totalFromGetFiles}, adapter additions=${acceptedFromAdapter}, total seen=${seenPaths.size}.`
    );
  }
  async read(locator) {
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof import_obsidian2.TFile)) {
      throw new Error(`Book file no longer exists: ${locator.path}`);
    }
    return this.app.vault.readBinary(file);
  }
  /**
   * Filename-derived metadata. The foliate reader populates richer metadata
   * (real title / authors / cover) the first time the user opens the book;
   * until then this fallback is what the shelf shows.
   */
  async readMetadata(locator) {
    const cached = this.metadataCache.get(locator.path);
    if (cached && Date.now() - cached.cachedAt < METADATA_CACHE_TTL_MS) {
      return cached;
    }
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof import_obsidian2.TFile)) return null;
    const base = {
      title: file.basename,
      authors: extractAuthorFromName(file.basename),
      languages: [],
      identifier: void 0,
      publisher: void 0,
      published: void 0,
      description: void 0,
      cachedAt: Date.now()
    };
    this.metadataCache.set(locator.path, base);
    return base;
  }
  /** Point lookup so LibraryService.refreshBook doesn't re-walk the vault. */
  async lookup(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) return null;
    const format = extensionToFormat(file.extension);
    if (!format) return null;
    return makeLocator(file, format);
  }
  /** Used by CoverCache — extracts the cover image bytes from the book file. */
  async readCover(locator) {
    const file = this.app.vault.getAbstractFileByPath(locator.path);
    if (!(file instanceof import_obsidian2.TFile)) return null;
    const bytes = await this.app.vault.readBinary(file);
    return {
      bookId: this.resolveId(locator),
      bytes,
      mimeType: mimeTypeForFormat(locator.format)
    };
  }
  watch(handler) {
    const refRename = this.app.vault.on("rename", (file) => {
      if (file instanceof import_obsidian2.TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "modified", path: file.path, format });
      }
    });
    const refCreate = this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian2.TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "added", path: file.path, format });
      }
    });
    const refModify = this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian2.TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "modified", path: file.path, format });
      }
    });
    const refDelete = this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian2.TFile) {
        const format = extensionToFormat(file.extension);
        if (format) handler({ kind: "removed", path: file.path, format });
      }
    });
    return {
      dispose: () => {
        this.app.vault.offref(refRename);
        this.app.vault.offref(refCreate);
        this.app.vault.offref(refModify);
        this.app.vault.offref(refDelete);
      }
    };
  }
  resolveId(locator) {
    return locator.path;
  }
  async resolveLocator(id) {
    return this.lookup(id);
  }
};
var extensionToFormat = (extension) => {
  switch (extension.toLowerCase()) {
    case "epub":
      return "epub";
    case "pdf":
      return "pdf";
    case "txt":
      return "txt";
    case "mobi":
      return "mobi";
    case "azw":
      return "azw";
    case "azw3":
      return "azw3";
    default:
      return null;
  }
};
var mimeTypeForFormat = (format) => {
  switch (format) {
    case "epub":
      return "application/epub+zip";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "mobi":
    case "azw":
    case "azw3":
      return "application/x-mobipocket-ebook";
  }
};
var makeLocator = (file, format) => ({
  path: file.path,
  format,
  sizeBytes: file.stat.size,
  modifiedAt: file.stat.mtime
});
var extractAuthorFromName = (basename) => {
  const paren = basename.match(/[((]([^()（）]{1,40})[)）]/);
  if (paren && paren[1]) return [paren[1].trim()];
  const dash = basename.split(/\s+[-—–]\s+/);
  if (dash.length >= 2 && dash[1]) return [dash[1].trim()];
  return [];
};

// src/adapters/obsidian/ObsidianNoteWriter.ts
var import_obsidian3 = require("obsidian");
var PROTOCOL = "ez-reader";
var ObsidianNoteWriter = class {
  constructor(app, plugin, annotations) {
    this.app = app;
    this.plugin = plugin;
    this.annotations = annotations;
  }
  cacheByPath = /* @__PURE__ */ new Map();
  // Serialize concurrent appends to the same note file. vault.process
  // is not atomic across calls — if two excerpts land at the same time,
  // the second read() might see the pre-first content and the second
  // process() would clobber the first. We chain writes per-file via a
  // tail promise so two saves settle one after the other.
  writeQueues = /* @__PURE__ */ new Map();
  async ensureBookNote(input) {
    const cached = this.cacheByPath.get(input.bookId);
    if (cached) return cached;
    const settings = await this.annotations.listSettings();
    const baseDir = sanitizeDir(settings.notesDirectory || "ezreader-notes/\u9605\u8BFB\u7B14\u8BB0");
    await this.ensureDirectory(baseDir);
    const safeTitle = sanitizeFileBase(input.bookTitle || input.bookPath.split("/").pop() || input.bookId);
    const idTag = input.bookId.slice(0, 8);
    const fileName = `${safeTitle}-${idTag}.md`;
    const notePath = (0, import_obsidian3.normalizePath)(`${baseDir}/${fileName}`);
    const abstract = this.app.vault.getAbstractFileByPath(notePath);
    if (!(abstract instanceof import_obsidian3.TFile)) {
      const header = renderBookHeader(input, settings);
      await this.app.vault.create(notePath, header);
    }
    const ref = { path: notePath, bookId: input.bookId, title: input.bookTitle };
    this.cacheByPath.set(input.bookId, ref);
    return ref;
  }
  async appendExcerpt(ref, input) {
    return this.enqueueWrite(ref.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(file instanceof import_obsidian3.TFile)) return;
      const blockIdRegex = new RegExp(`(^|\\n)\\^${escapeRegExp(input.excerptId)}\\s*$`, "m");
      const existing = await this.app.vault.read(file);
      if (blockIdRegex.test(existing)) return;
      const noteBase = ref.path.split("/").pop()?.replace(/\.md$/i, "") ?? ref.title;
      const block = renderExcerptBlock(input, ref.title, ref.bookId, PROTOCOL, noteBase);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}

${block}`);
    });
  }
  async appendThought(ref, input) {
    return this.enqueueWrite(ref.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (!(file instanceof import_obsidian3.TFile)) return;
      const blockId = `thought-${input.thoughtId}`;
      const blockIdRegex = new RegExp(`(^|\\n)\\^${escapeRegExp(blockId)}\\s*$`, "m");
      const existing = await this.app.vault.read(file);
      if (blockIdRegex.test(existing)) return;
      const block = renderThoughtBlock(input, blockId, PROTOCOL);
      await this.app.vault.process(file, (current) => `${current.replace(/\s*$/, "")}

${block}`);
    });
  }
  /**
   * Serialize concurrent writes to the same path. Each call queues its
   * async fn on the tail of the path's promise chain so two saves
   * settle one after the other — no clobber, no lost block.
   */
  enqueueWrite(path, fn) {
    const prev = this.writeQueues.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.writeQueues.set(path, next.catch(() => void 0));
    return next;
  }
  async resolveExcerptLink(excerptId) {
    const snapshot = await this.annotations.load();
    const excerpt = snapshot.excerpts.find((e3) => e3.id === excerptId);
    if (!excerpt) return null;
    const reading = snapshot.reading.find((r3) => r3.bookId === excerpt.bookId);
    let format = "unknown";
    if (reading) {
      const posKind = reading.position?.kind;
      if (posKind === "pdf") format = "pdf";
      else if (posKind === "text") format = "txt";
      else if (posKind === "reflow") format = "epub";
    }
    return {
      bookId: excerpt.bookId,
      format,
      locator: excerpt.locator
    };
  }
  async ensureDirectory(path) {
    if (await this.app.vault.adapter.exists(path)) return;
    const parts = path.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const here = (0, import_obsidian3.normalizePath)(acc);
      if (!await this.app.vault.adapter.exists(here)) {
        try {
          await this.app.vault.adapter.mkdir(here);
        } catch (error) {
          if (!await this.app.vault.adapter.exists(here)) {
            throw error;
          }
        }
      }
    }
  }
};
var sanitizeDir = (raw) => {
  return (0, import_obsidian3.normalizePath)(raw.trim().replace(/^\/+/, ""));
};
var sanitizeFileBase = (raw) => {
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}\-_]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "untitled";
};
var renderBookHeader = (input, settings) => {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const title = settings.defaultNoteTemplate.replace(/\{\{title\}\}/g, input.bookTitle || "\u672A\u547D\u540D").replace(/\{\{author\}\}/g, settings.libraryOwnerName || "").replace(/\{\{date\}\}/g, date);
  return [
    "---",
    `title: "${(input.bookTitle || "\u672A\u547D\u540D").replace(/"/g, '\\"')}"`,
    `ez-reader: ${input.bookId}`,
    `source: ${input.bookPath}`,
    `created: ${date}`,
    "---",
    "",
    title,
    "",
    "> \u7531 EzReader \u81EA\u52A8\u751F\u6210\u3002\u5212\u8BCD\u6458\u5F55\u4E0E\u60F3\u6CD5\u4F1A\u51FA\u73B0\u5728\u6B64\u7B14\u8BB0\u4E2D,\u5E26 Obsidian \u5757 ID \u53EF\u88AB\u53CC\u5411\u94FE\u63A5\u3002",
    ""
  ].join("\n");
};
var renderExcerptBlock = (input, bookTitle, bookId, protocol, noteBase) => {
  const safeBookTitle = escapeWikiLink(bookTitle);
  const safeNoteLink = noteBase;
  const safeChapter = input.chapterTitle ? escapeWikiLink(input.chapterTitle) : void 0;
  const safeTextLines = input.text.split(/\r?\n/).map((line) => `> ${escapeWikiLink(line)}`);
  const safeTagLine = input.tags.length > 0 ? `> **Tags**: ${input.tags.map((t3) => `#${escapeWikiLink(t3)}`).join(" ")}` : null;
  const sourceParts = [];
  if (safeChapter) sourceParts.push(safeChapter);
  if (typeof input.locator.page === "number") sourceParts.push(`\u7B2C ${input.locator.page} \u9875`);
  if (typeof input.locator.fraction === "number") sourceParts.push(`\u8FDB\u5EA6 ${Math.round(input.locator.fraction * 100)}%`);
  sourceParts.push(input.format.toUpperCase());
  const lines = [
    "> [!quote] \u6458\u5F55",
    `> **${safeBookTitle}** \xB7 ${sourceParts.join(" \xB7 ")}`,
    `> Created: ${new Date(input.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    // P0 修复: 之前只渲染纯文本书名, Obsidian 无法识别为 wiki-link, 反向链接
    // 面板也看不到这条引用 — 用户体验"摘录没形成双链". 现在加 `[[noteBase]]`
    // 让 vault 里任何位置用 `[[noteBase]]` 或点击反向链接都能跳到这本书的笔记.
    // 摘录 blockquote 自己也在这个 note 里, 所以反向链接面板会显示从其他笔记
    // 引用本笔记的次数. 用户点反向链接 → 看到所有引用本笔记的摘录块.
    `> \u6765\u6E90: [[${safeNoteLink}|${safeBookTitle}]]`,
    // 双向链接: 协议 URL 用于外部跳转, wiki link 用于 vault 内跳转 (光标在块上即可)
    `> \u8FD4\u56DE\u539F\u6587: [\u6253\u5F00\u9605\u8BFB\u5668](obsidian://${protocol}?book=${encodeURIComponent(bookId)}&annotation=${encodeURIComponent(input.excerptId)}) \xB7 [[#^${input.excerptId}|\u56DE\u5230\u6B64\u6458\u5F55]]`,
    safeTagLine,
    ">",
    ...safeTextLines
  ].filter((line) => Boolean(line));
  const note = input.note.trim();
  if (note) {
    const noteLines = note.split(/\r?\n/).map((line) => `> ${escapeWikiLink(line)}`);
    lines.push(">", `> [!note] \u60F3\u6CD5`, ...noteLines);
  }
  lines.push("", `^${input.excerptId}`, "");
  return lines.join("\n");
};
var renderThoughtBlock = (input, blockId, protocol) => {
  const lines = [
    "> [!note] \u60F3\u6CD5",
    `> Created: ${new Date(input.createdAt).toISOString().slice(0, 16).replace("T", " ")}`,
    ...input.tags.length > 0 ? [`> **Tags**: ${input.tags.map((t3) => `#${escapeWikiLink(t3)}`).join(" ")}`] : [],
    "",
    input.text.split(/\r?\n/).map((line) => `> ${escapeWikiLink(line)}`).join("\n"),
    "",
    `^${blockId}`,
    ""
  ];
  return lines.join("\n");
};
var escapeRegExp = (s3) => s3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var escapeWikiLink = (s3) => s3.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

// src/core/utils/themeColors.ts
var themeColors = (theme) => {
  switch (theme) {
    case "light":
      return { bg: "#ffffff", fg: "#1f2328", scheme: "light" };
    case "dark":
      return { bg: "#1f2328", fg: "#e6edf3", scheme: "dark" };
    case "sepia":
      return { bg: "#f4ecd8", fg: "#4b3b2a", scheme: "light" };
    default:
      return { bg: "Canvas", fg: "CanvasText", scheme: "light dark" };
  }
};

// src/core/utils/imageSniff.ts
var sniffImageMime = (bytes) => {
  const view = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  if (view[0] === 137 && view[1] === 80 && view[2] === 78 && view[3] === 71) {
    return "image/png";
  }
  if (view[0] === 255 && view[1] === 216 && view[2] === 255) {
    return "image/jpeg";
  }
  if (view[0] === 82 && view[1] === 73 && view[2] === 70 && view[3] === 70 && view[8] === 87 && view[9] === 69 && view[10] === 66 && view[11] === 80) {
    return "image/webp";
  }
  if (view[0] === 71 && view[1] === 73 && view[2] === 70 && view[3] === 56) {
    return "image/gif";
  }
  return null;
};

// src/adapters/foliate/FoliateBookReader.ts
var buildAppearanceCss = (appearance) => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  const fontFamily = READER_FONT_FAMILY_STACKS[appearance.fontFamily ?? "serif"];
  const letterSpacing = (appearance.letterSpacing ?? 0).toFixed(3);
  const maxWidth = appearance.maxWidth ?? 720;
  return `
    :root {
      --ez-reader-font-scale: ${fontScale};
      --ez-reader-font-family: ${fontFamily};
      --ez-reader-letter-spacing: ${letterSpacing}em;
      --ez-reader-max-width: ${maxWidth}px;
    }
    html, body {
      font-size: calc(1em * var(--ez-reader-font-scale)) !important;
      color: ${theme.fg} !important;
      background: ${theme.bg} !important;
      color-scheme: ${theme.scheme};
    }
    body {
      padding-inline: ${appearance.margin}px !important;
      line-height: ${appearance.lineHeight} !important;
      font-family: var(--ez-reader-font-family) !important;
      letter-spacing: var(--ez-reader-letter-spacing) !important;
    }
    body > * { max-width: var(--ez-reader-max-width); margin-inline: auto; }
    p, li, blockquote, dd { line-height: ${appearance.lineHeight} !important; }
  `;
};
var FoliateBookReader = class {
  async open(book, host, appearance, loader) {
    const { makeBook: makeBook2 } = await importFoliateModule();
    const parsed = await loadEpubFile(book, loader, makeBook2);
    const transformTarget = parsed.transformTarget;
    const onTransformData = (event) => {
      const detail = event.detail;
      if (!detail) return;
      if (!/text\/(x?html)/i.test(detail.type ?? "")) return;
      detail.data = Promise.resolve(detail.data).then(async (data) => {
        const source = data instanceof Blob ? await data.text() : String(data);
        return sanitizeBookContent(source);
      });
    };
    const view = document.createElement("foliate-view");
    view.setAttribute("data-ez-reader-flow", appearance.flow);
    host.append(view);
    if (host.clientWidth < 100 || host.clientHeight < 100) {
      await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    }
    if (transformTarget) {
      transformTarget.addEventListener("data", onTransformData);
    }
    try {
      await view.open(parsed);
    } catch (error) {
      view.remove();
      if (transformTarget) transformTarget.removeEventListener("data", onTransformData);
      throw error;
    }
    const session = new FoliateSession(view, onTransformData, transformTarget);
    try {
      await session.applyAppearance(appearance);
    } catch (error) {
      view.remove();
      if (transformTarget) transformTarget.removeEventListener("data", onTransformData);
      throw error;
    }
    const directionClasses = [
      "ez-reader__page-loaded--forward",
      "ez-reader__page-loaded--backward",
      "ez-reader__page-loaded--initial"
    ];
    const onLoad = () => {
      void session.applyAppearance(appearance).catch((error) => {
        console.warn("[ez-reader] applyAppearance on reload failed", error);
      });
      view.classList.remove(...directionClasses);
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(() => {
          view.classList.add(`ez-reader__page-loaded--${session.direction}`);
        });
      });
    };
    view.addEventListener("load", onLoad);
    session.registerDisposer(() => view.removeEventListener("load", onLoad));
    return session;
  }
  async extractCover(book, loader) {
    const { makeBook: makeBook2 } = await importFoliateModule();
    const parsed = await loadEpubFile(book, loader, makeBook2);
    const bookObj = parsed;
    if (typeof bookObj.getCover !== "function") return null;
    const blob = await bookObj.getCover();
    if (!blob) return null;
    const coverBytes = await blob.arrayBuffer();
    return { bytes: coverBytes, mimeType: sniffImageMime(coverBytes) ?? (blob.type || "image/jpeg") };
  }
  /**
   * Extract EPUB OPF metadata (title / creator / language). foliate-js parses
   * the package document inside `makeBook()`; we read it back here so the
   * shelf shows the real book title instead of the filename.
   *
   * P0-2 修复: 之前书架永远显示 file.basename, 用户加入 `Introduction to
   * Seismology (Peter M. Shearer) (Z.epub` 这种 Z-Library dump 文件名,
   * 看不到 EPUB 内部 OPF 的真 title. 现在 reader open 后从 session 拿真实
   * metadata, 通过 LibraryService.refreshMetadata 写回 store, shelf 重渲染.
   */
  async readMetadata(book, loader) {
    try {
      const { makeBook: makeBook2 } = await importFoliateModule();
      const parsed = await loadEpubFile(book, loader, makeBook2);
      const bookObj = parsed;
      const raw = bookObj.metadata ?? {};
      const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : void 0;
      if (!title) return null;
      const creator = raw.creator;
      const authors = [];
      if (typeof creator === "string" && creator.trim()) authors.push(creator.trim());
      else if (Array.isArray(creator)) {
        for (const c2 of creator) {
          if (typeof c2 === "string" && c2.trim()) authors.push(c2.trim());
        }
      }
      const lang = raw.language;
      const languages = [];
      if (typeof lang === "string" && lang.trim()) languages.push(lang.trim());
      else if (Array.isArray(lang)) {
        for (const l3 of lang) {
          if (typeof l3 === "string" && l3.trim()) languages.push(l3.trim());
        }
      }
      return {
        title,
        authors,
        languages,
        publisher: typeof raw.publisher === "string" && raw.publisher.trim() ? raw.publisher.trim() : void 0,
        identifier: typeof raw.identifier === "string" && raw.identifier.trim() ? raw.identifier.trim() : void 0,
        description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : void 0,
        cachedAt: Date.now()
      };
    } catch (error) {
      console.warn("[ez-reader] foliate readMetadata failed", book.locator.path, error);
      return null;
    }
  }
};
var importFoliateModule = async () => {
  return await Promise.resolve().then(() => (init_view(), view_exports));
};
var loadEpubFile = async (book, loader, makeBook2) => {
  const bytes = await loader(book.locator.path);
  const file = new File([bytes], book.locator.path.split("/").pop() ?? "book", {
    type: mimeTypeFor(book.locator.format)
  });
  return makeBook2(file);
};
var FoliateSession = class {
  element;
  view;
  docListeners = /* @__PURE__ */ new Set();
  disposers = /* @__PURE__ */ new Set();
  transformCleanup;
  /** iframe 内的 keydown 转发 — ReaderView 注册一次, 每次 foliate 翻页时
   *  attach 到新的 iframe.contentDocument (因为 foliate 翻页时换 doc). */
  onIframeKeydown;
  highlights = [];
  closed = false;
  /** B4 修复: bindSelectionChange 在 this.view 上挂的 `load` listener
   *  需要在 close() 里也清 (disposeOn 之前 session.close() 可能先跑,
   *  ReaderView.onClose 直接 await session.close 不先 offSelect, load
   *  listener 还在 view 上). 把 handle 提到实例字段让 close() 能拿到. */
  selectionLoadListener;
  /**
   * 上次导航方向, 供 `load` 事件读取以决定翻页动画的方向 class。
   * - "initial"  — 首次加载 + TOC / 进度条 / 书签跳转 (直接淡入)
   * - "forward"  — 翻到下一页 (从右滑入)
   * - "backward" — 翻到上一页 (从左滑入)
   */
  lastDirection = "initial";
  /**
   * P1: Find-in-book 状态 — 缓存当前 query, 让用户翻页后再调用
   * findInBook(query, false) 走下一个匹配。索引指向"下一个要跳的"
   * 匹配在 `matchPositions` 里的位置。
   */
  findQuery = null;
  findMatches = [];
  findCursor = 0;
  constructor(view, transformListener, transformTarget) {
    this.view = view;
    this.element = view;
    this.transformCleanup = () => {
      if (transformTarget) {
        transformTarget.removeEventListener("data", transformListener);
      }
    };
  }
  /** ReaderView 注册的 keyboard 转发 — 在 foliate iframe.contentDocument 挂
   *  keydown listener (跨 iframe 边界事件不会自动 bubble 到 parent). */
  setOnIframeKeydown(handler) {
    this.onIframeKeydown = handler;
  }
  get direction() {
    return this.lastDirection;
  }
  registerDisposer(fn) {
    this.disposers.add(fn);
  }
  async close() {
    this.closed = true;
    for (const off of this.docListeners) off();
    this.docListeners.clear();
    for (const off of this.disposers) off();
    this.disposers.clear();
    if (this.selectionLoadListener) {
      this.view.removeEventListener("load", this.selectionLoadListener);
      this.selectionLoadListener = void 0;
    }
    this.transformCleanup();
    try {
      this.view.close();
    } catch (error) {
      console.warn("[ez-reader] foliate view.close failed", error);
    }
    try {
      this.view.remove();
    } catch (error) {
      console.warn("[ez-reader] foliate view.remove failed", error);
    }
  }
  async applyAppearance(appearance) {
    if (this.closed) return;
    this.view.setAttribute("data-ez-reader-flow", appearance.flow);
    this.view.setAttribute("flow", appearance.flow);
    if (appearance.twoPages) {
      this.view.setAttribute("cols", "2");
    } else {
      this.view.removeAttribute("cols");
    }
    const renderer = this.view.renderer;
    renderer?.setStyles?.(buildAppearanceCss(appearance));
  }
  async goTo(target) {
    switch (target.kind) {
      case "next":
        this.lastDirection = "forward";
        await this.view.goRight();
        return;
      case "previous":
        this.lastDirection = "backward";
        await this.view.goLeft();
        return;
      case "fraction":
        this.lastDirection = "initial";
        await this.view.goToFraction(target.fraction);
        return;
      case "identifier":
        this.lastDirection = "initial";
        await this.view.goTo(target.value);
        return;
    }
  }
  async currentFraction() {
    return this.view.lastLocation?.fraction ?? 0;
  }
  on(event, handler) {
    if (event === "selection-change") {
      return this.bindSelectionChange(handler);
    }
    const wrapped = ((e3) => handler(e3));
    this.view.addEventListener(event, wrapped);
    const off = () => this.view.removeEventListener(event, wrapped);
    this.disposers.add(off);
    return off;
  }
  async exportLocator() {
    return this.view.lastLocation?.cfi ?? null;
  }
  currentChapter() {
    return this.view.lastLocation?.tocItem?.label ?? null;
  }
  async tableOfContents() {
    const tree = this.view.book?.toc ?? [];
    const flat = [];
    const walk = (items, depth) => {
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const it2 = item;
        const label = typeof it2.label === "string" && it2.label.trim() ? it2.label.trim() : "\u672A\u547D\u540D\u7AE0\u8282";
        const href = typeof it2.href === "string" && it2.href ? it2.href : void 0;
        flat.push({ id: `toc-${flat.length}`, label, depth, locator: href });
        if (Array.isArray(it2.subitems)) walk(it2.subitems, depth + 1);
      }
    };
    walk(tree, 0);
    return flat;
  }
  async goToToc(id) {
    const tree = this.view.book?.toc ?? [];
    const flat = collectTocWithHrefs(tree);
    const idx = Number(id.replace(/^toc-/, ""));
    const item = flat[idx];
    if (item?.href) {
      this.lastDirection = "initial";
      await this.view.goTo(item.href);
    } else if (idx >= 0) {
      const fraction = Math.min(1, Math.max(0, idx / Math.max(1, flat.length)));
      this.lastDirection = "initial";
      await this.view.goToFraction(fraction);
    }
  }
  currentPage() {
    const loc = this.view.lastLocation;
    if (typeof loc?.cfi === "string") {
      const match = loc.cfi.match(/\[(\d+)/);
      if (match) return Number(match[1]) + 1;
    }
    return null;
  }
  totalPages() {
    const toc = this.view.book?.toc;
    if (Array.isArray(toc)) return countTocLeaves(toc);
    return null;
  }
  listHighlights() {
    return [...this.highlights];
  }
  /**
   * In-book search. foliate-js 没有 public find API, 所以我们手动遍历
   * spine 拿到每个 section 的 HTML 文本, indexOf 找 query 出现的位置,
   * 把所有匹配按 (sectionIndex, offset) 缓存起来, 再用 goToFraction
   * 跳到对应位置 (用当前 sectionIndex + sectionFraction 算总 fraction).
   *
   * 限制: 跨多页的匹配 (例如某匹配从 section A 第 30% 跨到 section B
   * 第 5%) 简化为只 anchor 到起始 section — foliate 内部 anchor 算法
   * 已经能展示起始点的上下文, 视觉上"高亮在结果起点"对搜索体验足够。
   */
  async findInBook(query, fromStart) {
    if (this.closed) return 0;
    const trimmed = query.trim();
    if (!trimmed) return 0;
    const paginator = this.view.renderer?.paginator;
    const sections = paginator?.sections ?? this.view.book?.sections;
    if (!sections || sections.length === 0) return 0;
    if (this.findQuery !== trimmed || fromStart) {
      this.findQuery = trimmed;
      this.findMatches = [];
      const needle = trimmed.toLocaleLowerCase();
      for (let i3 = 0; i3 < sections.length; i3++) {
        if (this.closed) return 0;
        const sec = sections[i3];
        if (!sec || typeof sec.load !== "function") continue;
        let html;
        try {
          html = await sec.load();
        } catch {
          continue;
        }
        if (this.closed) return 0;
        const text = extractTextFromSection(html).toLocaleLowerCase();
        let from = 0;
        let idx;
        while ((idx = text.indexOf(needle, from)) >= 0) {
          this.findMatches.push({ sectionIndex: i3, offsetInSection: idx });
          from = idx + needle.length;
          if (this.findMatches.length > 500) break;
        }
        if (this.findMatches.length > 500) break;
      }
      this.findCursor = 0;
    }
    if (this.findMatches.length === 0) return 0;
    if (fromStart) this.findCursor = 0;
    else this.findCursor = (this.findCursor + 1) % this.findMatches.length;
    const target = this.findMatches[this.findCursor];
    const total = sections.length;
    const fraction = total <= 1 ? 0 : target.sectionIndex / (total - 1);
    this.lastDirection = "initial";
    await this.view.goToFraction(fraction);
    return this.findMatches.length;
  }
  async highlight(spec) {
    this.highlights.push(spec);
    try {
      await this.view.addAnnotation({ value: spec.locator });
    } catch (error) {
      console.warn("[ez-reader] foliate addAnnotation failed", error);
    }
  }
  async removeHighlight(id) {
    const target = this.highlights.find((h3) => h3.id === id);
    this.highlights = this.highlights.filter((h3) => h3.id !== id);
    if (target) {
      try {
        await this.view.addAnnotation({ value: target.locator }, true);
      } catch (error) {
        console.warn("[ez-reader] foliate removeAnnotation failed", error);
      }
    }
  }
  /**
   * foliate-paginator emits `load` events whenever it swaps the rendered
   * iframe document. We re-attach selectionchange on each new document so
   * the user can pick text after every page change.
   *
   * 注意: `docListeners` 只跟踪 selectionchange 监听器, 不要把 load 事件
   * 的 disposer 放进去 — 否则重新翻页会清掉 selectionchange。
   *
   * P1 修复: 之前的 `off` 只清 docListeners, 不清自己注册在 `load` 事件上
   * 的 listener. 二次 `on("selection-change", ...)` 泄漏上次的 load listener
   * 直到 close(). 现在 off 一起清.
   */
  bindSelectionChange(handler) {
    let loadListener;
    const off = () => {
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
      if (loadListener) {
        this.view.removeEventListener("load", loadListener);
        loadListener = void 0;
        this.selectionLoadListener = void 0;
      }
    };
    const attach = (doc, index) => {
      for (const dispose of this.docListeners) dispose();
      this.docListeners.clear();
      const onChange = () => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (!text) return;
        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : void 0;
        let cfi;
        try {
          cfi = this.view.getCFI(index, range);
        } catch (error) {
          console.warn("[ez-reader] getCFI failed", error);
        }
        const rect = range?.getBoundingClientRect();
        handler({
          text,
          locator: cfi ?? this.view.lastLocation?.cfi,
          rect: rect ?? void 0
        });
      };
      doc.addEventListener("selectionchange", onChange);
      this.docListeners.add(() => doc.removeEventListener("selectionchange", onChange));
      const onPointerLike = () => onChange();
      doc.addEventListener("mouseup", onPointerLike);
      doc.addEventListener("pointerup", onPointerLike);
      doc.addEventListener("touchend", onPointerLike);
      this.docListeners.add(() => {
        doc.removeEventListener("mouseup", onPointerLike);
        doc.removeEventListener("pointerup", onPointerLike);
        doc.removeEventListener("touchend", onPointerLike);
      });
      const IMPORT_RE = /@import\s*["'](blob:[^"']+)["']/gi;
      const inlineBlobLinkStyles = (root) => {
        const links = root.querySelectorAll('link[rel="stylesheet"][href^="blob:"]');
        links.forEach((link) => {
          const href = link.getAttribute("href");
          if (!href) return;
          if (link.dataset["ezReaderInlined"] === "1") return;
          link.dataset["ezReaderInlined"] = "1";
          fetch(href).then((response) => response.text()).then((cssText) => {
            const style2 = doc.createElement("style");
            style2.dataset["ezReaderInlinedFrom"] = href;
            style2.textContent = cssText;
            link.replaceWith(style2);
          }).catch((error) => {
            console.warn("[ez-reader] inlineBlobLinkStyles failed", error);
            link.remove();
          });
        });
      };
      const inlineBlobImportStyles = (root) => {
        const styles = Array.from(root.querySelectorAll("style"));
        for (const style2 of styles) {
          const text = style2.textContent ?? "";
          IMPORT_RE.lastIndex = 0;
          if (!IMPORT_RE.test(text)) continue;
          IMPORT_RE.lastIndex = 0;
          const matches2 = [...text.matchAll(IMPORT_RE)];
          if (matches2.length === 0) continue;
          if (style2.dataset["ezReaderInlinedImports"] === "1") continue;
          style2.dataset["ezReaderInlinedImports"] = "1";
          Promise.all(matches2.map((m3) => fetch(m3[1]).then((r3) => r3.text()))).then((cssTexts) => {
            let newText = text;
            let i3 = 0;
            newText = newText.replace(IMPORT_RE, () => cssTexts[i3++] ?? "");
            style2.dataset["ezReaderInlinedImports"] = "0";
            style2.textContent = newText;
          }).catch((error) => {
            console.warn("[ez-reader] inlineBlobImportStyles failed", error);
            style2.dataset["ezReaderInlinedImports"] = "0";
            style2.textContent = text.replace(IMPORT_RE, "/* failed @import */");
          });
        }
      };
      const scanAll = (root) => {
        inlineBlobLinkStyles(root);
        inlineBlobImportStyles(root);
      };
      const headObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement && (node.instanceOf(HTMLLinkElement) || node.instanceOf(HTMLStyleElement))) {
              scanAll(node);
            }
          }
          scanAll(doc);
        }
      });
      if (doc.head) {
        headObserver.observe(doc.head, { childList: true, subtree: true, characterData: true });
        this.docListeners.add(() => headObserver.disconnect());
      }
      scanAll(doc);
      if (this.onIframeKeydown) {
        const onKeydown = (event) => {
          this.onIframeKeydown?.(event);
        };
        doc.addEventListener("keydown", onKeydown, true);
        this.docListeners.add(() => doc.removeEventListener("keydown", onKeydown, true));
      }
    };
    loadListener = (event) => {
      const detail = event.detail;
      if (!detail || !detail.doc || typeof detail.index !== "number") return;
      attach(detail.doc, detail.index);
    };
    this.view.addEventListener("load", loadListener);
    this.selectionLoadListener = loadListener;
    return off;
  }
};
var collectTocWithHrefs = (tree) => {
  const flat = [];
  const walk = (items) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const it2 = item;
      const href = typeof it2.href === "string" && it2.href ? it2.href : void 0;
      flat.push({ href });
      if (Array.isArray(it2.subitems)) walk(it2.subitems);
    }
  };
  walk(tree);
  return flat;
};
var countTocLeaves = (tree) => {
  let count = 0;
  const walk = (items) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const it2 = item;
      if (Array.isArray(it2.subitems) && it2.subitems.length > 0) {
        walk(it2.subitems);
      } else {
        count += 1;
      }
    }
  };
  walk(tree);
  return count;
};
var extractTextFromSection = (payload) => {
  if (typeof payload === "string") {
    return payload.replace(/<[^>]*>/g, " ");
  }
  const body = payload.body ?? payload.documentElement;
  return body?.textContent ?? "";
};
var sanitizeBookContent = (source) => source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "").replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, "").replace(/<(?:iframe|object|embed)\b[^>]*\/?>/gi, "").replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*\/?>/gi, "").replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s(?:src|poster|data)\s*=\s*(?:"(?:https?:|file:|javascript:)[^"]*"|'(?:https?:|file:|javascript:)[^']*'|(?:https?:|file:|javascript:)[^\s>]+)/gi, "");

// src/adapters/text/PagedTextSession.ts
var getAppearanceCssProps = (appearance) => {
  const theme = themeColors(appearance.theme);
  const fontScale = (appearance.fontSize / 100).toFixed(3);
  const fontFamily = READER_FONT_FAMILY_STACKS[appearance.fontFamily ?? "serif"];
  const letterSpacing = (appearance.letterSpacing ?? 0).toFixed(3);
  const maxWidth = appearance.maxWidth ?? 720;
  return {
    "--ez-reader-paged-bg": theme.bg,
    "--ez-reader-paged-fg": theme.fg,
    "--ez-reader-paged-color-scheme": theme.scheme,
    "--ez-reader-paged-font-scale": fontScale,
    "--ez-reader-paged-font-family": fontFamily,
    "--ez-reader-paged-line-height": String(appearance.lineHeight),
    "--ez-reader-paged-letter-spacing": `${letterSpacing}em`,
    "--ez-reader-paged-max-width": `${maxWidth}px`,
    "--ez-reader-paged-margin": `${appearance.margin}px`
  };
};
var PagedTextSession = class {
  element;
  content;
  stageEl;
  host;
  currentAppearance;
  disposers = /* @__PURE__ */ new Set();
  /**
   * Whether we have already logged the "MOBI chapter CSS dropped" info
   * message this session. Set after the first chapter that ships CSS so
   * we don't spam the console on every page turn.
   */
  warnedChapterCssDropped = false;
  /** Selection listeners re-attached on every renderPage; tracked separately
   *  so we can drop them before adding the next pair. P1 polish: before this
   *  set existed, every page flip appended two listeners + one cleanup closure
   *  into `disposers`, which was only drained at close(). After 100 flips we'd
   *  call 200 stale removeEventListener no-ops on session close. Now we
   *  actively unbind on each flip. */
  selectionCleanup = null;
  /** P1 polish: anchor click listener bound at stage level so it survives
   *  page flips. Catches <a data-ez-reader-href="..."> clicks (sanitizeHtml
   *  renames href → data-ez-reader-href so the browser doesn't navigate
   *  to a chapter URL) and dispatches "link-click". */
  stageClickHandler = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const anchor = target.closest("a[data-ez-reader-href]");
    if (!anchor) return;
    const href = anchor.dataset["ezReaderHref"];
    if (!href) return;
    event.preventDefault();
    const win = this.element.ownerDocument.defaultView;
    const WinCustomEvent = win?.CustomEvent;
    if (WinCustomEvent) {
      this.element.dispatchEvent(new WinCustomEvent("link-click", { detail: { href } }));
    } else {
      const ev = win?.document.createEvent("CustomEvent");
      if (ev && typeof ev.initCustomEvent === "function") {
        ev.initCustomEvent("link-click", false, false, { href });
        this.element.dispatchEvent(ev);
      }
    }
  };
  currentPageIndex = 0;
  closed = false;
  highlights = [];
  selectionListeners = /* @__PURE__ */ new Set();
  relocateListeners = /* @__PURE__ */ new Set();
  direction = "initial";
  /**
   * P1: in-book search state. `findMatches` is a flat list of (page, offset)
   * entries; `findCursor` points at the next match to jump to. Resetting
   * happens whenever the query string changes or `fromStart` is true.
   */
  findQuery = null;
  findMatches = [];
  findCursor = 0;
  constructor(options) {
    this.content = options.content;
    this.host = options.host;
    this.currentAppearance = options.appearance;
    this.element = document.createElement("div");
    this.element.classList.add("ez-reader__paged-text-root");
    this.applyAppearanceProperties(this.currentAppearance);
    this.stageEl = document.createElement("div");
    this.stageEl.classList.add("ez-reader__paged-text");
    this.stageEl.addEventListener("click", this.stageClickHandler);
    this.element.append(this.stageEl);
    this.host.append(this.element);
    this.renderPage(0, "initial");
  }
  /** Direction of last navigation; ReaderView uses it for page animations. */
  get lastDirection() {
    return this.direction;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.selectionCleanup) {
      this.selectionCleanup();
      this.selectionCleanup = null;
    }
    try {
      const win = this.element.ownerDocument.defaultView;
      const WinEvent = win?.Event;
      const closeEvent = WinEvent ? new WinEvent("close") : win?.document?.createEvent?.("Event") ?? null;
      if (closeEvent) this.element.dispatchEvent(closeEvent);
    } catch (error) {
      console.warn("[ez-reader] PagedTextSession close event dispatch failed", error);
    }
    for (const off of this.disposers) off();
    this.disposers.clear();
    try {
      this.element.remove();
    } catch (error) {
      console.warn("[ez-reader] PagedTextSession close failed", error);
    }
  }
  async applyAppearance(appearance) {
    if (this.closed) return;
    this.currentAppearance = appearance;
    this.applyAppearanceProperties(appearance);
  }
  /**
   * Apply appearance as CSS custom properties on the root element.
   * Pure DOM-side effect — no `<style>` elements. Properties live in
   * styles.css under `.ez-reader__paged-text-root` and `.ez-reader__paged-text`.
   *
   * Why `setProperty` instead of `el.style[k] = v` or `setCssProps`:
   *  - `style[k] = v` triggers Obsidian's `no-static-styles-assignment`
   *    lint rule (visual style assignment).
   *  - `setCssProps` is Obsidian-only — not available in the jsdom test
   *    runtime, so we'd need a test stub for every PagedText test.
   *  - `setProperty("--foo", v)` is the standard Web API for CSS custom
   *    properties and is not flagged (verified against Obsidian's auto-
   *    review output — TocPanel.ts:454 uses this pattern without warnings).
   *    Custom properties are dynamic bindings, not visual style assignments,
   *    which is exactly what the rule is designed to permit.
   */
  applyAppearanceProperties(appearance) {
    const props = getAppearanceCssProps(appearance);
    for (const [k3, v3] of Object.entries(props)) {
      this.element.style.setProperty(k3, v3);
    }
  }
  async goTo(target) {
    if (this.closed) return;
    switch (target.kind) {
      case "next":
        await this.turnTo(Math.min(this.content.pages.length - 1, this.currentPageIndex + 1), "forward");
        return;
      case "previous":
        await this.turnTo(Math.max(0, this.currentPageIndex - 1), "backward");
        return;
      case "fraction": {
        const total = this.content.pages.length;
        if (total === 0) return;
        const idx = Math.min(total - 1, Math.max(0, Math.round(target.fraction * (total - 1))));
        await this.turnTo(idx, "initial");
        return;
      }
      case "identifier": {
        const idx = Number(target.value);
        if (!Number.isFinite(idx)) {
          const tocIdx = this.content.toc.findIndex((t3) => t3.id === target.value);
          if (tocIdx >= 0 && this.content.chapterStartPages[tocIdx] !== void 0) {
            await this.turnTo(this.content.chapterStartPages[tocIdx], "initial");
          }
          return;
        }
        await this.turnTo(Math.max(0, Math.min(this.content.pages.length - 1, idx)), "initial");
        return;
      }
    }
  }
  async currentFraction() {
    if (this.content.pages.length <= 1) return 0;
    return this.currentPageIndex / (this.content.pages.length - 1);
  }
  on(event, handler) {
    if (event === "selection-change") {
      const wrapped2 = (detail) => {
        handler({ detail });
      };
      this.selectionListeners.add(wrapped2);
      return () => {
        this.selectionListeners.delete(wrapped2);
      };
    }
    if (event === "relocate") {
      const wrapped2 = (detail) => {
        handler({ detail });
      };
      this.relocateListeners.add(wrapped2);
      return () => {
        this.relocateListeners.delete(wrapped2);
      };
    }
    const wrapped = ((e3) => handler(e3));
    this.element.addEventListener(event, wrapped);
    let disposed = false;
    const off = () => {
      if (disposed) return;
      disposed = true;
      this.element.removeEventListener(event, wrapped);
      this.disposers.delete(off);
    };
    this.disposers.add(off);
    return off;
  }
  async exportLocator() {
    return `paged-text:${this.currentPageIndex}`;
  }
  currentChapter() {
    return this.content.pages[this.currentPageIndex]?.chapterTitle ?? null;
  }
  currentPage() {
    return this.currentPageIndex + 1;
  }
  totalPages() {
    return this.content.pages.length;
  }
  async tableOfContents() {
    return this.content.toc;
  }
  async goToToc(id) {
    const idx = this.content.toc.findIndex((t3) => t3.id === id);
    if (idx < 0) return;
    const pageIdx = this.content.chapterStartPages[idx];
    if (typeof pageIdx === "number") {
      await this.turnTo(pageIdx, "initial");
    }
  }
  async goToSpineId(spineId) {
    const anchorIndex = spineId.indexOf("#");
    const target = anchorIndex >= 0 ? spineId.slice(0, anchorIndex) : spineId;
    if (!target) return;
    const idx = this.content.pages.findIndex((p3) => p3.id === target);
    if (idx < 0) return;
    await this.turnTo(idx, "initial");
  }
  listHighlights() {
    return [...this.highlights];
  }
  async highlight(spec) {
    this.highlights.push(spec);
    this.applyHighlightOverlay(spec);
  }
  /**
   * In-book search for TXT / MOBI / AZW3. Walks the page list, finds
   * matches in HTML textContent (case-insensitive), caches them so
   * repeated calls without `fromStart` advance to the next hit.
   *
   * Returns total match count. Jumps the session to the page containing
   * the next match; the host's CSS-driven highlight (search.js reuses
   * `applyHighlightOverlay` via session.highlight) shows the user where
   * the match landed.
   */
  async findInBook(query, fromStart) {
    if (this.closed) return 0;
    const trimmed = query.trim();
    if (!trimmed) return 0;
    if (this.findQuery !== trimmed || fromStart) {
      this.findQuery = trimmed;
      this.findMatches = [];
      const needle = trimmed.toLocaleLowerCase();
      for (let i3 = 0; i3 < this.content.pages.length; i3++) {
        const text = stripHtmlTags(this.content.pages[i3].html).toLocaleLowerCase();
        let from = 0;
        let idx;
        while ((idx = text.indexOf(needle, from)) >= 0) {
          this.findMatches.push({ pageIndex: i3, offsetInPage: idx });
          from = idx + needle.length;
          if (this.findMatches.length > 500) break;
        }
        if (this.findMatches.length > 500) break;
      }
      this.findCursor = 0;
    }
    if (this.findMatches.length === 0) return 0;
    if (fromStart) this.findCursor = 0;
    else this.findCursor = (this.findCursor + 1) % this.findMatches.length;
    const target = this.findMatches[this.findCursor];
    this.direction = "initial";
    await this.turnTo(target.pageIndex, "initial");
    return this.findMatches.length;
  }
  async removeHighlight(id) {
    this.highlights = this.highlights.filter((h3) => h3.id !== id);
    const stage = this.stageEl;
    const wraps = stage.querySelectorAll(`[data-ez-reader-highlight-id="${cssEscape(id)}"]`);
    wraps.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
  }
  /** Re-render the current page after a content mutation (e.g. theme switch). */
  renderPage(pageIdx, dir) {
    this.direction = dir;
    const page = this.content.pages[pageIdx];
    if (!page) return;
    this.currentPageIndex = pageIdx;
    if (page.css && page.css.length > 0 && !this.warnedChapterCssDropped) {
      this.warnedChapterCssDropped = true;
      console.info(
        `[ez-reader] MOBI book ships ${page.css.length} chapter stylesheet(s); Obsidian's auto-review forbids dynamic CSS injection in the main document, so chapter-specific CSS is not applied. The book will render with the plugin's default paged-text styles.`
      );
    }
    const pageEl = document.createElement("article");
    pageEl.classList.add("ez-reader__paged-text-page");
    pageEl.dataset["pageIndex"] = String(pageIdx);
    const innerEl = document.createElement("div");
    innerEl.classList.add("ez-reader__paged-text__inner");
    const parsedPage = new DOMParser().parseFromString(page.html, "text/html");
    innerEl.replaceChildren(...Array.from(parsedPage.body.childNodes));
    pageEl.append(innerEl);
    for (const h3 of this.highlights) {
      const locatorPageIdx = Number(h3.locator.replace(/^paged-text:/, ""));
      if (locatorPageIdx === pageIdx) {
        this.applyHighlightOverlay(h3, innerEl);
      }
    }
    this.stageEl.replaceChildren(pageEl);
    const animClass = `ez-reader__page-loaded--${dir}`;
    pageEl.classList.add(animClass);
    const onAnimationEnd = () => {
      pageEl.classList.remove(animClass);
      pageEl.removeEventListener("animationend", onAnimationEnd);
    };
    pageEl.addEventListener("animationend", onAnimationEnd);
    if (this.selectionCleanup) {
      this.selectionCleanup();
      this.selectionCleanup = null;
    }
    const onSelectionDone = () => this.dispatchSelection();
    this.stageEl.addEventListener("mouseup", onSelectionDone);
    this.stageEl.addEventListener("selectionchange", onSelectionDone);
    this.selectionCleanup = () => {
      this.stageEl.removeEventListener("mouseup", onSelectionDone);
      this.stageEl.removeEventListener("selectionchange", onSelectionDone);
    };
    const total = this.content.pages.length;
    const fraction = total <= 1 ? 0 : pageIdx / (total - 1);
    const detail = { fraction, chapter: page.chapterTitle ?? void 0, page: pageIdx + 1 };
    for (const listener of this.relocateListeners) listener(detail);
  }
  async turnTo(pageIdx, dir) {
    if (pageIdx === this.currentPageIndex) return;
    this.renderPage(pageIdx, dir);
  }
  dispatchSelection() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text) return;
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (!this.stageEl.contains(range.commonAncestorContainer)) return;
    const detail = {
      text,
      locator: `paged-text:${this.currentPageIndex}`,
      rect: rect ?? void 0
    };
    for (const listener of this.selectionListeners) listener(detail);
  }
  applyHighlightOverlay(spec, scope) {
    const root = scope ?? this.stageEl;
    if (!spec.text) return;
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while (node = walker.nextNode()) {
      const tn2 = node;
      if ((tn2.textContent ?? "").length > 0) textNodes.push(tn2);
    }
    if (textNodes.length === 0) return;
    const joined = textNodes.map((n3) => n3.textContent ?? "").join("");
    const startIdx = joined.indexOf(spec.text);
    if (startIdx < 0) {
      return;
    }
    const endIdx = startIdx + spec.text.length;
    const segments = [];
    let cursor = 0;
    for (const tn2 of textNodes) {
      const len = (tn2.textContent ?? "").length;
      const nodeStart = cursor;
      const nodeEnd = cursor + len;
      if (nodeEnd > startIdx && nodeStart < endIdx) {
        segments.push({
          node: tn2,
          start: Math.max(0, startIdx - nodeStart),
          end: Math.min(len, endIdx - nodeStart)
        });
      }
      cursor = nodeEnd;
      if (cursor >= endIdx) break;
    }
    if (segments.length === 0) return;
    for (let i3 = segments.length - 1; i3 >= 0; i3--) {
      const seg = segments[i3];
      const text = seg.node.textContent ?? "";
      const before = text.slice(0, seg.start);
      const middle = text.slice(seg.start, seg.end);
      const after = text.slice(seg.end);
      const parent = seg.node.parentNode;
      if (!parent) continue;
      const mark = document.createElement("mark");
      mark.className = "ez-reader__highlight";
      mark.dataset["ezReaderHighlightId"] = spec.id;
      mark.style.backgroundColor = highlightColor(spec.color);
      mark.textContent = middle;
      const frag = document.createDocumentFragment();
      if (before.length > 0) frag.appendChild(document.createTextNode(before));
      frag.appendChild(mark);
      if (after.length > 0) frag.appendChild(document.createTextNode(after));
      parent.replaceChild(frag, seg.node);
    }
  }
};
var highlightColor = (color) => {
  switch (color) {
    case "red":
      return "rgba(255, 99, 99, 0.35)";
    case "blue":
      return "rgba(99, 153, 255, 0.35)";
    case "green":
      return "rgba(99, 255, 153, 0.35)";
    case "yellow":
    default:
      return "rgba(255, 220, 80, 0.4)";
  }
};
var cssEscape = (value) => value.replace(/[^a-zA-Z0-9_-]/g, (c2) => `\\${c2}`);
var stripHtmlTags = (html) => html.replace(/<[^>]*>/g, " ");

// src/adapters/text/TxtBookReader.ts
var DEFAULT_PAGE_CHARS = 1600;
var MAX_PAGE_CHARS = 2400;
var splitTextIntoPages = (text, options = {}) => {
  const pageChars = Math.max(200, Math.min(MAX_PAGE_CHARS, options.pageChars ?? DEFAULT_PAGE_CHARS));
  const mode = options.paragraphMode ?? detectParagraphMode(text);
  const paragraphs = splitIntoParagraphs(text, mode);
  const pages = [];
  let current = "";
  const flush = () => {
    const trimmed = current.trimEnd();
    if (trimmed.length === 0) return;
    pages.push({
      id: `page-${pages.length}`,
      html: paragraphsToHtml(trimmed)
    });
    current = "";
  };
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > pageChars) {
      flush();
      const hardChunks = hardBreakLongParagraph(trimmed, pageChars);
      for (const chunk of hardChunks) {
        pages.push({ id: `page-${pages.length}`, html: paragraphsToHtml(chunk) });
      }
      continue;
    }
    if (current.length === 0) {
      current = trimmed;
      continue;
    }
    if (current.length + trimmed.length + 2 > pageChars) {
      flush();
      current = trimmed;
    } else {
      current = `${current}

${trimmed}`;
    }
  }
  flush();
  if (pages.length === 0) {
    pages.push({ id: "page-0", html: "<p></p>" });
  }
  return pages;
};
var detectParagraphMode = (text) => {
  if (/\r?\n\s*\r?\n/.test(text)) return "blank-line";
  return "single-newline";
};
var splitIntoParagraphs = (text, mode) => {
  if (mode === "blank-line") {
    return text.split(/\r?\n\s*\r?\n/g);
  }
  return text.split(/\r?\n/g);
};
var paragraphsToHtml = (text) => {
  const parts = text.split(/\n{2,}/);
  return parts.map((part) => {
    const escaped = escapeHtml(part);
    const withBreaks = escaped.replace(/\r?\n/g, "<br>");
    return `<p>${withBreaks}</p>`;
  }).join("");
};
var escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var hardBreakLongParagraph = (text, maxChars) => {
  const result = [];
  const sentenceRe = /[^。！？!?；;]+[。！？!?；;]?/g;
  const sentences = text.match(sentenceRe) ?? [text];
  let buffer = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buffer.length > 0) {
        result.push(buffer);
        buffer = "";
      }
      for (let i3 = 0; i3 < sentence.length; i3 += maxChars) {
        result.push(sentence.slice(i3, i3 + maxChars));
      }
      continue;
    }
    if (buffer.length === 0) {
      buffer = sentence;
    } else if (buffer.length + sentence.length <= maxChars) {
      buffer += sentence;
    } else {
      result.push(buffer);
      buffer = sentence;
    }
  }
  if (buffer.length > 0) result.push(buffer);
  return result;
};
var STRONG_TITLE_PATTERNS = [
  // 显式声明: "书名: xxx" / "Title: xxx" / "题: xxx"
  /^[\s\u3000]*(?:书\s*名|Title|题|篇名)\s*[:：]\s*(.+?)\s*$/iu,
  // 引号包围: 《书名》 / 《 书名 》 / 「书名」 / 『书名』 / "书名"
  /^[\s\u3000]*[《「『"“](.{1,40}?)[》」』"”][\s\u3000]*$/u,
  // 书的结构: 卷X / 第X章 / 全X / 篇X — 后面跟副标题或不跟
  // 两个 alternation:
  //   a) "卷"/"篇"/"全" + 可选数字 + 可选[章回...] (e.g. "卷一", "卷之一", "卷一 大题")
  //   b) "第" + 数字 + [章回节卷集篇] + 可选副标题 (e.g. "第一章 标题", "第三回")
  /^[\s\u3000]*(?:(?:卷|篇|全)(?:之?[0-9零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]+)?(?:[章回]?)|第\s*[0-9零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]+\s*[章回节卷集篇])\s*(.{0,30})$/u,
  // 中文书名常见格式: 5-15 字无标点
  /^[\s\u3000]*[\u4e00-\u9fa5]{2,15}[\s\u3000]*$/u
];
var BODY_PUNCTUATION = /[，。！？、；：""''?!,;:"'']/;
var guessTitleFromText = (text, fallback) => {
  const lines = text.split(/\r?\n/).slice(0, 50);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    for (const re2 of STRONG_TITLE_PATTERNS) {
      const match = line.match(re2);
      if (match) {
        const candidate = (match[1] ?? line).trim();
        if (candidate.length > 0 && candidate.length <= 40 && !BODY_PUNCTUATION.test(candidate)) {
          return candidate;
        }
      }
    }
  }
  const firstLine = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  if (firstLine.length > 0 && firstLine.length <= 25 && !BODY_PUNCTUATION.test(firstLine)) {
    return firstLine;
  }
  return fallback;
};
var detectChapterTitle = (text) => {
  const lines = text.split(/\r?\n/);
  const patterns = [
    /^[\s\u3000]*第\s*[0-9零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾]+\s*[章回节卷集篇]/u,
    /^[\s\u3000]*chapter\s+[0-9]+(?:\s|$)/iu,
    /^[\s\u3000]*CHAPTER\s+[IVXLCDM]+/u
  ];
  for (const line of lines.slice(0, 50)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 60) continue;
    for (const re2 of patterns) {
      if (re2.test(trimmed)) return trimmed;
    }
  }
  return null;
};
var TxtBookReader = class {
  async open(book, host, appearance, loader) {
    const bytes = await loader(book.locator.path);
    const text = decodeText(bytes);
    const fallbackTitle = book.locator.path.split("/").pop()?.replace(/\.txt$/i, "") ?? "TXT";
    const title = guessTitleFromText(text, fallbackTitle);
    const pages = splitTextIntoPages(text);
    let lastChapter = title;
    const enrichedPages = pages.map((page, idx) => {
      const plainText = page.html.replace(/<[^>]*>/g, " ");
      const detected = idx === 0 ? title : detectChapterTitle(plainText);
      if (detected) lastChapter = detected;
      return { ...page, chapterTitle: lastChapter };
    });
    const content = {
      pages: enrichedPages,
      toc: [{ id: "txt-root", label: title, depth: 0 }],
      chapterStartPages: [0]
    };
    return new PagedTextSession({ content, host, appearance, loader });
  }
  async extractCover() {
    return null;
  }
  /**
   * TXT 没有结构化 metadata — caller 应该 fallback 到
   * `BookSource.readMetadata` 的 filename-derived 结果. 这里返回 null
   * 让 LibraryService 走 fallback 路径, 不要覆盖已有的 filename-based title.
   */
  async readMetadata() {
    return null;
  }
};
var decodeText = (bytes) => {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 239 && view[1] === 187 && view[2] === 191) {
    return new TextDecoder("utf-8").decode(view.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(view);
    } catch {
      return new TextDecoder("utf-8").decode(view);
    }
  }
};

// src/core/utils/sanitizeHtml.ts
var DANGEROUS_TAGS = /* @__PURE__ */ new Set([
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
var URL_ATTRS = /* @__PURE__ */ new Set(["href", "src", "xlink:href", "formaction", "action"]);
var isDangerousUrl = (raw) => {
  const normalized = raw.replace(/[\u0000-\u001F\u007F]+/g, "").trim().toLowerCase();
  if (normalized.startsWith("javascript:")) return true;
  if (normalized.startsWith("data:text/html")) return true;
  if (normalized.startsWith("vbscript:")) return true;
  return false;
};
var segmentize = (input) => {
  const out = [];
  let i3 = 0;
  while (i3 < input.length) {
    if (input[i3] !== "<") {
      const next = input.indexOf("<", i3);
      const end2 = next === -1 ? input.length : next;
      out.push({ kind: "text", value: input.slice(i3, end2) });
      i3 = end2;
      continue;
    }
    const end = findTagEnd(input, i3);
    if (end === -1) {
      out.push({ kind: "text", value: input.slice(i3) });
      i3 = input.length;
      continue;
    }
    out.push({ kind: "tag", value: input.slice(i3, end + 1) });
    i3 = end + 1;
  }
  return out;
};
var findTagEnd = (input, start) => {
  let inQuote = null;
  for (let i3 = start + 1; i3 < input.length; i3++) {
    const ch = input[i3];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ">") {
      return i3;
    }
  }
  return -1;
};
var parseTag = (raw) => {
  const inner = raw.slice(1, -1);
  if (inner.startsWith("!--")) return { name: "", attrs: "", isClosing: false, isComment: true, isDoctype: false };
  if (inner.startsWith("!DOCTYPE") || inner.startsWith("!doctype")) {
    return { name: "", attrs: "", isClosing: false, isComment: false, isDoctype: true };
  }
  const isClosing = inner.startsWith("/");
  const body = isClosing ? inner.slice(1) : inner;
  const m3 = /^([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/.exec(body);
  if (!m3) return null;
  return { name: m3[1].toLowerCase(), attrs: m3[2] ?? "", isClosing, isComment: false, isDoctype: false };
};
var sanitizeAttrs = (rawAttrs) => {
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'))?/g;
  let result = "";
  let cursor = 0;
  let m3;
  while ((m3 = attrRegex.exec(rawAttrs)) !== null) {
    if (m3.index !== cursor) {
      const gap = rawAttrs.slice(cursor, m3.index);
      if (/\S/.test(gap)) return null;
    }
    cursor = m3.index + m3[0].length;
    const name = m3[1].toLowerCase();
    const value = m3[3] !== void 0 ? m3[3] : m3[4] !== void 0 ? m3[4] : "";
    if (name.startsWith("on")) {
      continue;
    }
    if (URL_ATTRS.has(name) && isDangerousUrl(value)) {
      continue;
    }
    const safeValue = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    if (name === "href" && !value.startsWith("#") && !isDangerousUrl(value)) {
      result += ` data-ez-reader-href="${safeValue}"`;
      continue;
    }
    result += ` ${name}="${safeValue}"`;
  }
  return result;
};
var escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var sanitizeHtml = (input) => {
  if (!input) return "";
  const segments = segmentize(input);
  let output = "";
  let skipUntil = null;
  for (const seg of segments) {
    if (skipUntil) {
      if (seg.kind === "tag") {
        const parsed2 = parseTag(seg.value);
        if (parsed2 && parsed2.isClosing && parsed2.name === skipUntil) {
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
      output += escapeText(seg.value);
      continue;
    }
    if (parsed.isComment || parsed.isDoctype) continue;
    if (DANGEROUS_TAGS.has(parsed.name)) {
      if (!parsed.isClosing) {
        skipUntil = parsed.name;
      }
      continue;
    }
    if (parsed.isClosing) {
      output += `</${parsed.name}>`;
      continue;
    }
    const cleanedAttrs = sanitizeAttrs(parsed.attrs);
    if (cleanedAttrs === null) {
      continue;
    }
    output += `<${parsed.name}${cleanedAttrs}>`;
  }
  return output;
};

// src/adapters/text/MobiBookReader.ts
var importMobiParser = async () => {
  const mod = await Promise.resolve().then(() => (init_index_browser2(), index_browser_exports));
  return mod;
};
var isAzw3Format = (format) => format === "azw3";
var MobiBookReader = class {
  async open(book, host, appearance, loader) {
    const bytes = await loader(book.locator.path);
    const parser2 = await this.createParser(book.locator.format, bytes);
    let content;
    try {
      content = await buildContent(parser2, book);
    } catch (error) {
      try {
        parser2.destroy();
      } catch {
      }
      throw error;
    }
    const session = new PagedTextSession({ content, host, appearance, loader });
    const originalClose = session.close.bind(session);
    let destroyed = false;
    const destroyParser = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        parser2.destroy();
      } catch (error) {
        console.warn("[ez-reader] mobi parser destroy failed", error);
      }
    };
    session.close = async () => {
      try {
        await originalClose();
      } finally {
        destroyParser();
      }
    };
    return session;
  }
  async extractCover(book, loader) {
    try {
      const bytes = await loader(book.locator.path);
      const parser2 = await this.createParser(book.locator.format, bytes);
      try {
        const blobUrl = parser2.getCoverImage();
        if (!blobUrl) return null;
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        if (blob.size === 0) return null;
        const coverBytes = await blob.arrayBuffer();
        const mime = sniffImageMime(coverBytes) ?? blob.type ?? "image/jpeg";
        return { bytes: coverBytes, mimeType: mime };
      } finally {
        parser2.destroy();
      }
    } catch (error) {
      console.warn("[ez-reader] MOBI cover extraction failed", error);
      return null;
    }
  }
  /**
   * Extract MOBI/AZW3 metadata from the parser's EXTH record. Mirrors
   * `FoliateBookReader.readMetadata` — called by `LibraryService.refreshMetadata`
   * after a successful open so the shelf shows the real book title.
   *
   * P0-2 修复: 之前书架显示 file.basename; MOBI 的 EXTH record 经常含
   * 干净的 title / author ("The Great Gatsby", "F. Scott Fitzgerald"),
   * 不解析就是浪费.
   */
  async readMetadata(book, loader) {
    try {
      const bytes = await loader(book.locator.path);
      const parser2 = await this.createParser(book.locator.format, bytes);
      try {
        const raw = parser2.getMetadata();
        const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : void 0;
        if (!title) return null;
        const authors = [];
        if (Array.isArray(raw.author)) {
          for (const a3 of raw.author) {
            if (typeof a3 === "string" && a3.trim()) authors.push(a3.trim());
          }
        }
        const lang = raw.language;
        const languages = [];
        if (typeof lang === "string" && lang.trim()) languages.push(lang.trim());
        else if (Array.isArray(lang)) {
          for (const l3 of lang) {
            if (typeof l3 === "string" && l3.trim()) languages.push(l3.trim());
          }
        }
        return {
          title,
          authors,
          languages,
          publisher: typeof raw.publisher === "string" && raw.publisher.trim() ? raw.publisher.trim() : void 0,
          identifier: typeof raw.identifier === "string" && raw.identifier.trim() ? raw.identifier.trim() : void 0,
          description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : void 0,
          cachedAt: Date.now()
        };
      } finally {
        parser2.destroy();
      }
    } catch (error) {
      console.warn("[ez-reader] MOBI readMetadata failed", book.locator.path, error);
      return null;
    }
  }
  async createParser(format, bytes) {
    const mod = await importMobiParser();
    const view = new Uint8Array(bytes);
    if (isAzw3Format(format)) {
      return mod.initKf8File(view);
    }
    return mod.initMobiFile(view);
  }
};
var buildContent = async (parser2, book) => {
  const spine = parser2.getSpine();
  const spineIdToChapterLabel = /* @__PURE__ */ new Map();
  const pages = [];
  for (let i3 = 0; i3 < spine.length; i3++) {
    const chapter = spine[i3];
    const processed = parser2.loadChapter(chapter.id);
    const html = processed?.html ?? "";
    const inlinedCss = await inlineChapterCss(processed?.css ?? []);
    pages.push({
      id: chapter.id,
      // P0-2 修复: mobi 解析器返回的 html 不可信 — 用户可能从不可信
      // 来源下载 mobi, 章节里嵌 <script>/<img onerror> 就会在 reader
      // 里执行 (TxtBookReader 已经 escape 过纯文本, MOBI 之前没动).
      // 在 PagedTextSession 调 innerHTML 之前先过 sanitizeHtml.
      html: html.length > 0 ? sanitizeHtml(html) : "<p></p>",
      css: inlinedCss,
      chapterTitle: spineIdToChapterLabel.get(i3)
    });
  }
  if (pages.length === 0) {
    pages.push({ id: "empty", html: "<p>(\u7A7A\u4E66 / Empty book)</p>" });
  }
  const flatToc = [];
  const chapterStartPages = [];
  const walk = (items, depth) => {
    for (const item of items) {
      const label = item.label?.trim() || "\u672A\u547D\u540D\u7AE0\u8282";
      const spineIdx = spine.findIndex((ch) => ch.id === item.href || ch.id.startsWith(item.href));
      const pageIdx = spineIdx >= 0 ? spineIdx : pages.findIndex((p3) => p3.id === item.href);
      const targetPage = pageIdx >= 0 ? pageIdx : 0;
      const tocId = `toc-${flatToc.length}`;
      flatToc.push({ id: tocId, label, depth });
      chapterStartPages.push(targetPage);
      if (depth === 0 && !spineIdToChapterLabel.has(pageIdx)) {
        spineIdToChapterLabel.set(pageIdx, label);
      }
      if (Array.isArray(item.children)) walk(item.children, depth + 1);
    }
  };
  walk(parser2.getToc(), 0);
  if (flatToc.length === 0) {
    const metadata = parser2.getMetadata();
    const title = metadata.title?.trim() || book.locator.path.split("/").pop() || "\u4E66";
    flatToc.push({ id: "toc-root", label: title, depth: 0 });
    chapterStartPages.push(0);
    pages.forEach((page, idx) => {
      flatToc.push({ id: `toc-${idx + 1}`, label: `\u7B2C ${idx + 1} \u8282`, depth: 1 });
      chapterStartPages.push(idx);
      if (!page.chapterTitle) {
        page.chapterTitle = `\u7B2C ${idx + 1} \u8282`;
      }
    });
  }
  return {
    pages,
    toc: flatToc.map((item, idx) => ({
      id: item.id,
      label: item.label,
      depth: item.depth,
      locator: String(chapterStartPages[idx] ?? 0)
    })),
    chapterStartPages
  };
};
var inlineChapterCss = async (parts) => {
  const out = [];
  const failures = [];
  for (const part of parts) {
    try {
      const response = await fetch(part.href);
      const text = await response.text();
      out.push({ id: part.id, text });
    } catch (error) {
      failures.push(part.id);
      console.warn(`[ez-reader] failed to inline chapter CSS ${part.id}`, error);
    }
  }
  if (failures.length > 0 && failures.length === parts.length) {
    console.warn(`[ez-reader] MOBI chapter CSS all ${failures.length} part(s) failed to inline \u2014 book may render with default styles only`);
  }
  return out;
};

// src/adapters/obsidian/PdfCoverExtractor.ts
var getObsidianPdfjs = () => {
  const lib = globalThis.pdfjsLib;
  if (!lib || typeof lib.getDocument !== "function") return null;
  return lib;
};
var PdfCoverExtractor = class {
  async open() {
    throw new Error("PdfCoverExtractor.open should never be called");
  }
  async readMetadata() {
    return null;
  }
  async extractCover(book, loader) {
    const pdfjs = getObsidianPdfjs();
    if (!pdfjs) {
      console.warn(
        `[ez-reader] PDF cover extract skipped for ${book.locator.path}: globalThis.pdfjsLib not available (Obsidian < 1.4 or PDFView not loaded yet)`
      );
      return null;
    }
    try {
      const bytes = new Uint8Array(await loader(book.locator.path));
      const document2 = await pdfjs.getDocument({ data: bytes }).promise;
      try {
        if (document2.numPages < 1) return null;
        const page = await document2.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        const blob = await new Promise((resolve) => {
          canvas.toBlob((b3) => resolve(b3), "image/png");
        });
        if (!blob || blob.size === 0) return null;
        const arrayBuffer = await blob.arrayBuffer();
        return { bytes: arrayBuffer, mimeType: "image/png" };
      } finally {
        try {
          await document2.destroy?.();
        } catch {
        }
      }
    } catch (error) {
      console.warn(`[ez-reader] PDF cover extract failed for ${book.locator.path}`, error);
      return null;
    }
  }
};

// src/adapters/translation/BaseTranslationProvider.ts
var import_obsidian4 = require("obsidian");
var BaseTranslationProvider = class {
  /** Stringify an unknown thrown value for error messages. */
  formatError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  /**
   * HTTP call + parse JSON + translate HTTP failure into a Chinese error
   * message. Returns the parsed payload on success.
   *
   * `options.providerName` overrides the error prefix for this one call —
   * used by Google's auth step to emit "Google 鉴权" instead of "Google"
   * so the user knows which subsystem failed.
   *
   * Uses Obsidian's `requestUrl` (not raw `fetch`) — see class doc for
   * why. `throw: false` keeps error mapping consistent across all HTTP
   * status codes (otherwise requestUrl throws before we can extract the
   * body for `formatHttpError`).
   */
  async fetchJson(url, init, options) {
    const name = options?.providerName ?? this.providerName;
    let response;
    try {
      response = await (0, import_obsidian4.requestUrl)({
        url,
        method: typeof init.method === "string" ? init.method : "GET",
        headers: this.stringifyHeaders(init.headers),
        body: typeof init.body === "string" ? init.body : void 0,
        throw: false
      });
    } catch (error) {
      throw new Error(`\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25: ${this.formatError(error)}`);
    }
    let payload;
    try {
      payload = JSON.parse(response.text);
    } catch (error) {
      throw new Error(
        `${name} \u8FD4\u56DE\u4E86\u975E JSON \u54CD\u5E94 (HTTP ${response.status}): ${this.formatError(error)}`
      );
    }
    if (response.status >= 400) {
      throw new Error(this.formatHttpError(response.status, payload));
    }
    return payload;
  }
  /**
   * Trim the key and reject empty input. Returns the trimmed key on success
   * or `null` if empty (so the subclass can throw a specific message).
   */
  checkEmptyKey(apiKey) {
    const trimmed = apiKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  /**
   * `Headers | Record<string, string> | undefined` → flat string record.
   * requestUrl takes `Record<string, string>`; convert Headers / array
   * tuples for callers that pass those.
   */
  stringifyHeaders(headers) {
    if (!headers) return void 0;
    if (headers instanceof Headers) {
      const out = {};
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    if (Array.isArray(headers)) {
      const out = {};
      for (const [key, value] of headers) out[key] = value;
      return out;
    }
    return headers;
  }
};

// src/adapters/translation/GoogleTranslationProvider.ts
var GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
var GOOGLE_TRANSLATE_HOST = "https://translation.googleapis.com";
var TOKEN_CACHE = /* @__PURE__ */ new Map();
var SAFETY_WINDOW_MS = 5 * 60 * 1e3;
var GoogleTranslationProvider = class extends BaseTranslationProvider {
  id = "google-translation-v3";
  displayName = "Google Translate (Cloud v3)";
  signupUrl = "https://console.cloud.google.com/apis/credentials";
  signupHint = "Google Cloud \u63A7\u5236\u53F0 \u2192 \u521B\u5EFA\u9879\u76EE \u2192 \u542F\u7528 Cloud Translation API \u2192 \u521B\u5EFA Service Account \u2192 \u4E0B\u8F7D JSON \u5BC6\u94A5\u6587\u4EF6,\u6574\u6BB5 JSON \u7C98\u8D34\u5230 key \u5B57\u6BB5\u3002Translation API \u6309\u5B57\u7B26\u91CF\u8BA1\u8D39,\u6709 500K \u5B57\u7B26/\u6708\u514D\u8D39\u989D\u5EA6";
  providerName = "Google";
  /**
   * `formatHttpError` needs the project id to give a precise "missing project"
   * error. `translate` writes it here before the first HTTP call so the error
   * formatter can read it. Only used by `formatHttpError`, never read from
   * outside this class.
   */
  currentProjectId = "";
  async validateKey(apiKey) {
    try {
      const creds = JSON.parse(apiKey);
      if (!creds.client_email || !creds.private_key) {
        return { ok: false, reason: "Service account JSON must contain client_email and private_key." };
      }
      if (creds.type && creds.type !== "service_account") {
        return { ok: false, reason: `Unexpected service account type: ${creds.type}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "API key must be a JSON service account key from Google Cloud." };
    }
  }
  async translate(apiKey, request) {
    const creds = this.parseCredentials(apiKey);
    if (!creds) {
      throw new Error("Google API key \u683C\u5F0F\u4E0D\u6B63\u786E,\u9700\u8981\u5B8C\u6574\u7684 service account JSON\u3002");
    }
    const projectId = creds.project_id;
    if (!projectId) {
      throw new Error("Service account JSON \u7F3A\u5C11 project_id \u5B57\u6BB5\u3002");
    }
    this.currentProjectId = projectId;
    const sourceCode = this.toGoogleLocale(request.source);
    const targetCode = this.toGoogleLocale(request.target);
    const accessToken = await this.getAccessToken(creds);
    const url = `${GOOGLE_TRANSLATE_HOST}/v3/projects/${encodeURIComponent(projectId)}:translateText`;
    const body = {
      contents: [request.text],
      mimeType: "text/plain",
      targetLanguageCode: targetCode
    };
    if (sourceCode) body.sourceLanguageCode = sourceCode;
    const success = await this.fetchJson(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
        "x-goog-user-project": projectId
      },
      body: JSON.stringify(body)
    });
    const first = success.translations?.[0];
    if (!first) {
      throw new Error("Google \u8FD4\u56DE\u4E86\u7A7A\u7684\u7FFB\u8BD1\u7ED3\u679C\u3002");
    }
    return {
      text: first.translatedText,
      detectedSource: first.detectedLanguageCode ?? null,
      providerId: this.id
    };
  }
  parseCredentials(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string" && typeof parsed.project_id === "string") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * Exchange a freshly-signed JWT for a Cloud Translation access token. The
   * JWT is the standard RS256 service-account grant with a 1-hour lifetime;
   * we cache the resulting token per service-account email.
   *
   * Auth call uses a custom error prefix ("Google 鉴权") to distinguish
   * 401/403 from translation 401/403 — different remediation.
   */
  async getAccessToken(creds) {
    const cached = TOKEN_CACHE.get(creds.client_email);
    const now = Date.now();
    if (cached && cached.expiresAt - SAFETY_WINDOW_MS > now) {
      return cached.token;
    }
    const jwt = await this.signServiceAccountJwt(creds);
    const payload = await this.fetchJson(
      GOOGLE_TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt
        }).toString()
      },
      { providerName: "Google \u9274\u6743" }
    );
    if (!payload.access_token) {
      throw new Error(
        `Google \u9274\u6743\u5931\u8D25: ${payload.error_description ?? payload.error ?? "unknown"}`
      );
    }
    const ttlMs = (payload.expires_in ?? 3600) * 1e3;
    TOKEN_CACHE.set(creds.client_email, {
      token: payload.access_token,
      expiresAt: now + ttlMs
    });
    return payload.access_token;
  }
  /**
   * Sign a short-lived RS256 JWT carrying the service-account identity.
   *
   * Header:   { alg: "RS256", typ: "JWT", kid: <private_key_id> }
   * Payload:  { iss: <client_email>, sub: <client_email>,
   *             scope: cloud-platform, iat, exp }
   *
   * `exp - iat` is capped at 1 hour per the Google docs.
   */
  async signServiceAccountJwt(creds) {
    const now = Math.floor(Date.now() / 1e3);
    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: creds.private_key_id ?? ""
    };
    const payload = {
      iss: creds.client_email,
      sub: creds.client_email,
      // Cloud Translation only needs cloud-platform scope.
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: GOOGLE_TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600
    };
    const headerB64 = base64urlEncode(JSON.stringify(header));
    const payloadB64 = base64urlEncode(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await importPrivateKey(creds.private_key);
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    );
    const signatureB64 = base64urlEncodeBytes(new Uint8Array(signature));
    return `${signingInput}.${signatureB64}`;
  }
  toGoogleLocale(locale) {
    if (locale === "auto" || locale === "") return null;
    return locale;
  }
  formatHttpError(status, body) {
    const message = body && typeof body === "object" && "error" in body ? body.error?.message ?? "Unknown error from Google Cloud Translation." : "Unknown error from Google Cloud Translation.";
    const projectId = this.currentProjectId;
    switch (status) {
      case 400:
        return `Google \u8BF7\u6C42\u53C2\u6570\u9519\u8BEF: ${message}`;
      case 401:
      case 403:
        return `Google \u9274\u6743/\u6743\u9650\u5931\u8D25 (HTTP ${status}): ${message}\u3002\u8BF7\u786E\u8BA4 service account \u62E5\u6709 roles.cloudtranslate.user (\u6216\u66F4\u9AD8) \u5728\u9879\u76EE ${projectId} \u4E0A\u3002`;
      case 404:
        return `Google \u627E\u4E0D\u5230\u9879\u76EE ${projectId},\u6216 Cloud Translation API \u672A\u542F\u7528: ${message}`;
      case 429:
        return `Google \u914D\u989D\u8D85\u9650: ${message}`;
      case 500:
      case 502:
      case 503:
      case 504:
        return `Google \u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528 (HTTP ${status}): ${message}`;
      default:
        return `Google HTTP \u9519\u8BEF ${status}: ${message}`;
    }
  }
};
async function importPrivateKey(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/-----BEGIN RSA PRIVATE KEY-----/g, "").replace(/-----END RSA PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  if (!body) {
    throw new Error("Service account private_key \u5B57\u6BB5\u4E3A\u7A7A\u3002");
  }
  const binary = base64ToBytes(body);
  return crypto.subtle.importKey(
    "pkcs8",
    toStandaloneBuffer(binary),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i3 = 0; i3 < binary.length; i3++) bytes[i3] = binary.charCodeAt(i3);
  return bytes;
}
function toStandaloneBuffer(bytes) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
function base64urlEncode(input) {
  return base64urlEncodeBytes(new TextEncoder().encode(input));
}
function base64urlEncodeBytes(bytes) {
  let str = "";
  for (let i3 = 0; i3 < bytes.length; i3++) str += String.fromCharCode(bytes[i3]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// src/adapters/translation/YoudaoTranslationProvider.ts
var YOUDAO_ENDPOINT = "https://openapi.youdao.com/api";
var YOUDAO_LOCALE_MAP = {
  "zh-CN": "zh-CHS",
  "zh-TW": "zh-CHT",
  "zh-HK": "zh-CHT",
  "en": "en",
  "en-US": "en",
  "en-GB": "en",
  "ja": "ja",
  "ja-JP": "ja",
  "ko": "ko",
  "ko-KR": "ko",
  "fr": "fr",
  "fr-FR": "fr",
  "de": "de",
  "de-DE": "de",
  "es": "es",
  "es-ES": "es",
  "pt": "pt",
  "pt-PT": "pt",
  "pt-BR": "pt",
  "ru": "ru",
  "ru-RU": "ru",
  "it": "it",
  "it-IT": "it",
  "nl": "nl",
  "nl-NL": "nl",
  "ar": "ar",
  "id": "id",
  "th": "th",
  "vi": "vi",
  "auto": "auto"
};
var toYoudaoLocale = (locale) => YOUDAO_LOCALE_MAP[locale] ?? locale;
var parseDetectedSource = (l3, requestedFrom) => {
  if (!l3) return null;
  const parts = l3.split("2");
  if (parts.length !== 2) return null;
  const sourceCode = parts[0].toLowerCase();
  if (requestedFrom === "auto") {
    if (sourceCode === "zh-chs") return "zh-CN";
    if (sourceCode === "zh-cht") return "zh-TW";
    return sourceCode;
  }
  return requestedFrom;
};
var YoudaoTranslationProvider = class extends BaseTranslationProvider {
  id = "youdao";
  displayName = "\u6709\u9053\u667A\u4E91 \xB7 \u6587\u672C\u7FFB\u8BD1";
  signupUrl = "https://ai.youdao.com/console/#/service-singleton/text";
  signupHint = "\u6CE8\u518C\u6709\u9053\u667A\u4E91\u8D26\u53F7 \u2192 \u521B\u5EFA\u5E94\u7528 \u2192 \u9009\u300C\u6587\u672C\u7FFB\u8BD1\u300D \u2192 \u590D\u5236\u5E94\u7528 ID \u548C\u5E94\u7528\u5BC6\u94A5,\u5206\u522B\u586B\u5230\u4E0B\u9762\u4E24\u4E2A\u6846";
  providerName = "\u6709\u9053";
  /**
   * Youdao expects the key as JSON `{"appKey": "...", "appSecret": "..."}` so
   * both halves ride along inside the single password-style plugin field.
   */
  async validateKey(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) return { ok: false, reason: "API key \u4E0D\u80FD\u4E3A\u7A7A\u3002" };
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed.appKey || !parsed.appSecret) {
        return { ok: false, reason: "JSON \u5FC5\u987B\u540C\u65F6\u5305\u542B appKey \u548C appSecret \u4E24\u4E2A\u5B57\u6BB5\u3002" };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: '\u6709\u9053 API key \u5FC5\u987B\u4E3A JSON \u683C\u5F0F: {"appKey": "\u4F60\u7684\u5E94\u7528ID", "appSecret": "\u4F60\u7684\u5E94\u7528\u5BC6\u94A5"}'
      };
    }
  }
  async translate(apiKey, request) {
    const creds = this.parseCredentials(apiKey);
    const from = toYoudaoLocale(request.source);
    const to = toYoudaoLocale(request.target);
    if (!creds) {
      throw new Error('\u6709\u9053 API key \u683C\u5F0F\u4E0D\u6B63\u786E,\u9700\u8981 {"appKey":"...","appSecret":"..."}\u3002');
    }
    const salt = crypto.randomUUID();
    const curtime = Math.floor(Date.now() / 1e3);
    const sign = await this.computeSign(creds.appKey, creds.appSecret, request.text, salt, curtime);
    const body = new URLSearchParams({
      q: request.text,
      from,
      to,
      appKey: creds.appKey,
      salt,
      curtime: String(curtime),
      sign,
      signType: "v3"
    });
    const payload = await this.fetchJson(YOUDAO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString()
    });
    const code = payload.errorCode ?? "unknown";
    if (code !== "0" && code !== "00") {
      throw new Error(`\u6709\u9053 API \u9519\u8BEF ${code}: ${YOUDAO_ERROR_MESSAGES[code] ?? "\u672A\u77E5\u9519\u8BEF"}`);
    }
    const translated = (payload.translation ?? []).join("").trim();
    if (!translated) {
      throw new Error(`\u6709\u9053\u8FD4\u56DE\u4E86\u7A7A\u7684\u7FFB\u8BD1\u7ED3\u679C (errorCode=${code})`);
    }
    return {
      text: translated,
      detectedSource: parseDetectedSource(payload.l, request.source),
      providerId: this.id
    };
  }
  parseCredentials(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.appKey === "string" && typeof parsed.appSecret === "string") {
        return { appKey: parsed.appKey, appSecret: parsed.appSecret };
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * SHA-256 signature per the Youdao v3 spec. The body the digest is computed
   * over is `appKey + input + salt + curtime + appSecret`. `input` is the
   * query truncated as: first 10 chars + length + last 10 chars (when the
   * query is longer than 20 chars) — otherwise it's the query as-is.
   */
  async computeSign(appKey, appSecret, text, salt, curtime) {
    const input = text.length <= 20 ? text : text.slice(0, 10) + text.length + text.slice(-10);
    const payload = `${appKey}${input}${salt}${curtime}${appSecret}`;
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return this.toHex(new Uint8Array(digest));
  }
  toHex(bytes) {
    let hex = "";
    for (const b3 of bytes) hex += b3.toString(16).padStart(2, "0");
    return hex;
  }
  /**
   * Youdao 把 HTTP 错误跟业务错误(errorCode)拆开: HTTP 4xx/5xx 时 body 仍
   * 是 JSON, 错误消息从 `message` 字段拿 — 而 200 OK + errorCode != "0"
   * 是另一种错误 (translate 里处理)。这里只覆盖 HTTP 错误。
   */
  formatHttpError(status, body) {
    const message = body && typeof body === "object" && "errorCode" in body ? String(body.errorCode) : "\u672A\u77E5";
    return `\u6709\u9053 HTTP \u9519\u8BEF ${status}: ${message}`;
  }
};
var YOUDAO_ERROR_MESSAGES = {
  "101": "\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570,\u8BF7\u68C0\u67E5\u8868\u5355\u5B57\u6BB5\u3002",
  "102": "\u4E0D\u652F\u6301\u7684\u8BED\u8A00\u7C7B\u578B\u3002",
  "103": "\u7FFB\u8BD1\u6587\u672C\u8FC7\u957F(\u5355\u6B21\u6700\u591A 5000 \u5B57\u7B26)\u3002",
  "108": "\u5E94\u7528 ID \u65E0\u6548\u3002",
  "110": "\u5E94\u7528\u672A\u7ED1\u5B9A\u6587\u672C\u7FFB\u8BD1\u670D\u52A1\u3002",
  "111": "\u5F00\u53D1\u8005\u8D26\u53F7\u65E0\u6548\u3002",
  "113": "\u67E5\u8BE2\u6587\u672C q \u4E0D\u80FD\u4E3A\u7A7A\u3002",
  "202": "\u7B7E\u540D\u6821\u9A8C\u5931\u8D25,\u8BF7\u786E\u8BA4 appKey/appSecret \u4E0E q \u7684 UTF-8 \u7F16\u7801\u6B63\u786E\u3002",
  "203": "\u8BBF\u95EE IP \u4E0D\u5728\u767D\u540D\u5355\u5185\u3002",
  "206": "\u65F6\u95F4\u6233\u65E0\u6548\u5BFC\u81F4\u7B7E\u540D\u5931\u8D25\u3002",
  "207": "\u91CD\u653E\u8BF7\u6C42 (salt+curtime \u547D\u4E2D\u9632\u91CD\u653E\u7F13\u5B58)\u3002",
  "302": "\u7FFB\u8BD1\u67E5\u8BE2\u5931\u8D25\u3002",
  "303": "\u670D\u52A1\u7AEF\u5F02\u5E38\u3002",
  "304": "\u7FFB\u8BD1\u5931\u8D25,\u8BF7\u8054\u7CFB\u6709\u9053\u6280\u672F\u652F\u6301\u3002",
  "401": "\u8D26\u6237\u5DF2\u6B20\u8D39,\u8BF7\u5145\u503C\u540E\u518D\u4F7F\u7528\u3002",
  "411": "\u8BBF\u95EE\u9891\u7387\u53D7\u9650,\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002",
  "412": "\u957F\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41,\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002"
};

// src/adapters/translation/DeeplTranslationProvider.ts
var DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
var DEEPL_PRO_ENDPOINT = "https://api.deepl.com/v2/translate";
var DEEPL_LOCALE_MAP = {
  "auto": "",
  "zh-CN": "ZH",
  "zh-TW": "ZH",
  "zh": "ZH",
  "en": "EN",
  "en-US": "EN-US",
  "en-GB": "EN-GB",
  "ja": "JA",
  "ja-JP": "JA",
  "ko": "KO",
  "ko-KR": "KO",
  "fr": "FR",
  "fr-FR": "FR",
  "de": "DE",
  "de-DE": "DE",
  "es": "ES",
  "es-ES": "ES",
  "pt": "PT-BR",
  "pt-BR": "PT-BR",
  "pt-PT": "PT-PT",
  "ru": "RU",
  "ru-RU": "RU",
  "it": "IT",
  "it-IT": "IT",
  "nl": "NL",
  "nl-NL": "NL",
  "pl": "PL",
  "pl-PL": "PL",
  "tr": "TR",
  "tr-TR": "TR",
  "uk": "UK",
  "sv": "SV",
  "sv-SE": "SV",
  "da": "DA",
  "da-DK": "DA",
  "fi": "FI",
  "fi-FI": "FI",
  "nb": "NB",
  "no": "NB",
  "el": "EL",
  "el-GR": "EL",
  "hu": "HU",
  "hu-HU": "HU",
  "cs": "CZ",
  "cs-CZ": "CZ",
  "ro": "RO",
  "ro-RO": "RO",
  "sk": "SK",
  "sk-SK": "SK",
  "sl": "SL",
  "sl-SI": "SL",
  "et": "ET",
  "et-EE": "ET",
  "lv": "LV",
  "lv-LV": "LV",
  "lt": "LT",
  "lt-LT": "LT",
  "id": "ID",
  "id-ID": "ID",
  "bg": "BG",
  "ar": "AR"
};
var toDeeplLocale = (locale) => {
  const mapped = DEEPL_LOCALE_MAP[locale];
  if (mapped !== void 0) return mapped;
  const base = locale.split("-")[0] ?? locale;
  return base.toUpperCase();
};
var isFreeKey = (key) => key.trim().endsWith(":fx");
var resolveEndpoint = (key) => isFreeKey(key) ? DEEPL_FREE_ENDPOINT : DEEPL_PRO_ENDPOINT;
var DeeplTranslationProvider = class extends BaseTranslationProvider {
  id = "deepl";
  displayName = "DeepL";
  signupUrl = "https://www.deepl.com/pro-api";
  signupHint = "DeepL Pro API \u6709\u514D\u8D39\u5C42(\u6BCF\u6708 50 \u4E07\u5B57\u7B26);\u6CE8\u518C\u540E\u4ECE\u8D26\u6237\u9875\u83B7\u53D6 Authentication Key";
  providerName = "DeepL";
  /**
   * The DeepL key is opaque; we only sanity-check length and trim. DeepL
   * itself rejects malformed keys with HTTP 403 the first time you call the
   * API, so we surface that as the real validation result.
   */
  async validateKey(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) return { ok: false, reason: "API key \u4E0D\u80FD\u4E3A\u7A7A\u3002" };
    if (trimmed.length < 8) {
      return { ok: false, reason: "API key \u592A\u77ED,\u8BF7\u68C0\u67E5\u662F\u5426\u5B8C\u6574\u7C98\u8D34\u3002" };
    }
    return { ok: true };
  }
  async translate(apiKey, request) {
    const trimmedKey = this.checkEmptyKey(apiKey);
    if (!trimmedKey) {
      throw new Error("DeepL API key \u4E0D\u80FD\u4E3A\u7A7A,\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u3002");
    }
    const endpoint = resolveEndpoint(trimmedKey);
    const targetLang = toDeeplLocale(request.target);
    if (!targetLang) {
      throw new Error("DeepL \u5FC5\u987B\u663E\u5F0F\u6307\u5B9A\u76EE\u6807\u8BED\u8A00\u3002");
    }
    const sourceLangRaw = toDeeplLocale(request.source);
    const useAutoSource = !sourceLangRaw || request.source === "auto";
    const body = {
      text: [request.text],
      target_lang: targetLang,
      // Preserve the original formatting markers (XML/HTML); DeepL keeps
      // surrounding tags intact and only translates the content between
      // them. Safe default for the reader use case.
      tag_handling: "html",
      ignore_tags: "pre,code"
    };
    if (!useAutoSource) body.source_lang = sourceLangRaw;
    const success = await this.fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${trimmedKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const first = success.translations?.[0];
    if (!first) {
      throw new Error("DeepL \u8FD4\u56DE\u4E86\u7A7A\u7684\u7FFB\u8BD1\u7ED3\u679C\u3002");
    }
    return {
      text: first.text,
      detectedSource: first.detected_source_language ?? null,
      providerId: this.id
    };
  }
  /**
   * Map DeepL's HTTP status to a human-readable Chinese explanation. The
   * DeepL docs are explicit that the human-readable `message` field can
   * change wording, so we don't try to branch on it.
   */
  formatHttpError(status, body) {
    const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : void 0;
    switch (status) {
      case 400:
        return `DeepL \u8BF7\u6C42\u53C2\u6570\u9519\u8BEF: ${message ?? "\u8BF7\u68C0\u67E5 source_lang/target_lang \u7B49\u5B57\u6BB5\u3002"}`;
      case 403:
        return "DeepL \u9274\u6743\u5931\u8D25,\u8BF7\u68C0\u67E5 API key \u662F\u5426\u6B63\u786E,\u514D\u8D39 key \u5FC5\u987B\u4EE5 :fx \u7ED3\u5C3E\u3002";
      case 404:
        return `DeepL \u63A5\u53E3\u8DEF\u5F84\u9519\u8BEF (HTTP 404)\u3002endpoint=${message ?? "unknown"}`;
      case 413:
        return "DeepL \u8BF7\u6C42\u4F53\u8FC7\u5927,\u8BF7\u7F29\u77ED\u5F85\u7FFB\u8BD1\u6587\u672C\u3002";
      case 414:
        return "DeepL \u8BF7\u6C42 URL \u8FC7\u957F\u3002";
      case 429:
        return "DeepL \u8BBF\u95EE\u9891\u7387\u53D7\u9650,\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002";
      case 456:
        return "DeepL \u5B57\u7B26\u914D\u989D\u5DF2\u7528\u5B8C\u3002";
      case 500:
      case 504:
      case 529:
        return `DeepL \u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528 (HTTP ${status})\u3002`;
      default:
        return `DeepL HTTP \u9519\u8BEF ${status}: ${message ?? "\u672A\u77E5"}`;
    }
  }
};

// src/adapters/translation/MyMemoryTranslationProvider.ts
var MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
var MYMEMORY_LOCALE_MAP = {
  auto: "Autodetect",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  "zh-HK": "zh-TW",
  zh: "zh-CN",
  en: "en-US",
  "en-US": "en-US",
  "en-GB": "en-GB",
  ja: "ja",
  "ja-JP": "ja",
  ko: "ko",
  "ko-KR": "ko",
  fr: "fr",
  "fr-FR": "fr",
  de: "de",
  "de-DE": "de",
  es: "es",
  "es-ES": "es",
  pt: "pt-PT",
  "pt-BR": "pt-BR",
  "pt-PT": "pt-PT",
  ru: "ru",
  "ru-RU": "ru",
  it: "it",
  "it-IT": "it",
  nl: "nl",
  "nl-NL": "nl",
  ar: "ar",
  id: "id",
  th: "th",
  vi: "vi"
};
var toMyMemoryLocale = (locale) => MYMEMORY_LOCALE_MAP[locale] ?? locale;
var parseDetectedSource2 = (_match, _requestedFrom) => null;
var MyMemoryTranslationProvider = class extends BaseTranslationProvider {
  id = "mymemory";
  displayName = "MyMemory (\u514D\u8D39, \u65E0\u9700\u6CE8\u518C)";
  signupUrl = "https://mymemory.translated.net/";
  signupHint = "\u5B8C\u5168\u514D\u8D39,\u65E0\u9700\u6CE8\u518C\u4E5F\u65E0\u9700 API key\u3002\u6BCF\u5929\u6BCF\u4E2A IP 1 \u4E07\u5B57\u7B26\u989D\u5EA6,\u9002\u5408\u5076\u5C14\u67E5\u8BCD\u3002\u8D28\u91CF\u7565\u4F4E\u4E8E DeepL/Google";
  providerName = "MyMemory";
  /**
   * MyMemory has no key. We accept any non-empty string (the plugin
   * settings still requires an `apiKey` field for consistency, so we
   * treat the literal "anonymous" as the default marker).
   */
  async validateKey(apiKey) {
    return { ok: true };
  }
  async translate(_apiKey, request) {
    const from = toMyMemoryLocale(request.source);
    const to = toMyMemoryLocale(request.target);
    const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(request.text)}&langpair=${encodeURIComponent(`${from}|${to}`)}&de=email@example.com`;
    const success = await this.fetchJson(url, {
      method: "GET"
    });
    const status = success.responseStatus;
    if (status !== 200 && status !== void 0) {
      const detail = success.responseDetails ?? "\u672A\u77E5\u9519\u8BEF";
      throw new Error(this.formatMyMemoryError(status, detail));
    }
    const translated = success.responseData?.translatedText?.trim();
    if (!translated) {
      throw new Error("MyMemory \u8FD4\u56DE\u4E86\u7A7A\u7684\u7FFB\u8BD1\u7ED3\u679C\u3002");
    }
    return {
      text: translated,
      detectedSource: parseDetectedSource2(success.responseData?.match, request.source),
      providerId: this.id
    };
  }
  formatMyMemoryError(status, detail) {
    switch (status) {
      case 403:
        return "MyMemory \u6BCF\u65E5\u514D\u8D39\u989D\u5EA6\u5DF2\u7528\u5B8C(\u6BCF\u4E2A IP 1 \u4E07\u5B57\u7B26)\u3002\u660E\u5929\u91CD\u7F6E,\u6216\u6362\u6709\u9053/DeepL/Google\u3002";
      case 429:
        return "MyMemory \u9891\u7387\u9650\u5236:\u7A0D\u7B49\u51E0\u79D2\u91CD\u8BD5\u3002";
      case 400:
        return `MyMemory \u8BF7\u6C42\u65E0\u6548: ${detail}`;
      default:
        return `MyMemory \u9519\u8BEF ${status}: ${detail}`;
    }
  }
  formatHttpError(status, body) {
    const message = body && typeof body === "object" && "responseDetails" in body ? String(body.responseDetails ?? "") : "\u672A\u77E5";
    return `MyMemory HTTP \u9519\u8BEF ${status}: ${message || "\u672A\u77E5\u9519\u8BEF"}`;
  }
};

// src/adapters/translation/OpenAICompatibleTranslationProvider.ts
var OPENAI_COMPATIBLE_DEFAULTS = Object.freeze({
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini"
});
var LOCALE_LABEL_MAP = {
  auto: "the source language (auto-detect)",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  "zh-HK": "Traditional Chinese (Hong Kong)",
  zh: "Chinese",
  en: "English",
  "en-US": "English (American)",
  "en-GB": "English (British)",
  ja: "Japanese",
  "ja-JP": "Japanese",
  ko: "Korean",
  "ko-KR": "Korean",
  fr: "French",
  "fr-FR": "French",
  de: "German",
  "de-DE": "German",
  es: "Spanish",
  "es-ES": "Spanish (European)",
  pt: "Portuguese",
  "pt-BR": "Portuguese (Brazilian)",
  "pt-PT": "Portuguese (European)",
  ru: "Russian",
  "ru-RU": "Russian",
  it: "Italian",
  "it-IT": "Italian",
  nl: "Dutch",
  "nl-NL": "Dutch",
  ar: "Arabic",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese"
};
var toLocaleLabel = (locale) => LOCALE_LABEL_MAP[locale] ?? locale;
var OpenAICompatibleTranslationProvider = class extends BaseTranslationProvider {
  id = "openai-compatible";
  displayName = "\u81EA\u5B9A\u4E49 LLM (OpenAI \u517C\u5BB9)";
  signupUrl = "https://platform.openai.com/api-keys";
  signupHint = "\u901A\u7528 OpenAI \u517C\u5BB9\u683C\u5F0F: \u586B API \u57FA\u7840\u5730\u5740\u3001Key\u3001\u6A21\u578B\u540D\u3002DeepSeek / \u667A\u8C31 / \u901A\u4E49 / OpenAI \u90FD\u652F\u6301\u3002";
  providerName = "LLM";
  /**
   * The apiKey slot in settings is JSON `{baseUrl, apiKey, model}`. Empty
   * strings are valid only when the user hasn't configured anything yet.
   * We accept the JSON if all three fields are non-empty.
   */
  async validateKey(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return { ok: false, reason: "\u8BF7\u586B API \u57FA\u7840\u5730\u5740\u3001Key\u3001\u6A21\u578B\u540D(\u4E09\u4E2A\u90FD\u9700\u8981)\u3002" };
    }
    const parsed = this.parseConfig(trimmed);
    if (!parsed) {
      return {
        ok: false,
        reason: '\u914D\u7F6E\u5FC5\u987B\u662F JSON \u683C\u5F0F: {"baseUrl": "https://...", "apiKey": "sk-...", "model": "..."}'
      };
    }
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) {
      return {
        ok: false,
        reason: "\u4E09\u4E2A\u5B57\u6BB5\u90FD\u5FC5\u586B: API \u57FA\u7840\u5730\u5740\u3001API Key\u3001\u6A21\u578B\u540D\u3002"
      };
    }
    if (!this.isValidHttpUrl(parsed.baseUrl)) {
      return {
        ok: false,
        reason: `API \u57FA\u7840\u5730\u5740\u683C\u5F0F\u4E0D\u5BF9: "${parsed.baseUrl}"\u3002\u9700\u8981 https:// \u5F00\u5934\u7684 URL\u3002`
      };
    }
    return { ok: true };
  }
  async translate(rawConfig, request) {
    const config = this.parseConfig(rawConfig) ?? OPENAI_COMPATIBLE_DEFAULTS;
    const baseUrl = config.baseUrl.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/chat/completions`;
    const targetLabel = toLocaleLabel(request.target);
    const sourceLabel = toLocaleLabel(request.source);
    const systemPrompt = "You are a professional translator. Translate the user's text accurately and naturally. Preserve the original meaning, tone, and formatting (paragraph breaks, lists, code). Output ONLY the translation \u2014 no preamble, no explanations, no quotation marks around it. If the input is already in the target language, return it unchanged.";
    const userPrompt = request.source === "auto" ? `Translate the following text into ${targetLabel}:

"""${request.text}"""` : `Translate the following text from ${sourceLabel} into ${targetLabel}:

"""${request.text}"""`;
    const body = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      // Low temperature for deterministic translation; max_tokens scales
      // with input length (input*4 is a rough upper bound for non-English
      // — CJK is denser).
      temperature: 0.2,
      max_tokens: Math.max(256, Math.min(4096, request.text.length * 4))
    };
    const success = await this.fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });
    const choice = success.choices?.[0]?.message?.content;
    if (!choice) {
      throw new Error(`${this.providerName} \u8FD4\u56DE\u4E86\u7A7A\u7684\u9009\u62E9 (choices \u4E3A\u7A7A\u6216\u7F3A\u5C11 content \u5B57\u6BB5)\u3002`);
    }
    const translated = choice.trim();
    if (!translated) {
      throw new Error(`${this.providerName} \u8FD4\u56DE\u4E86\u7A7A\u7684\u7FFB\u8BD1\u7ED3\u679C\u3002`);
    }
    return {
      text: translated,
      detectedSource: null,
      providerId: this.id
    };
  }
  parseConfig(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return {
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "",
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
        model: typeof parsed.model === "string" ? parsed.model.trim() : ""
      };
    } catch {
      return null;
    }
  }
  isValidHttpUrl(s3) {
    try {
      const url = new URL(s3);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
  formatHttpError(status, body) {
    const message = body && typeof body === "object" && "error" in body ? body.error?.message ?? "Unknown error from LLM API." : "Unknown error from LLM API.";
    switch (status) {
      case 401:
      case 403:
        return `LLM \u9274\u6743\u5931\u8D25 (HTTP ${status}): ${message}\u3002\u8BF7\u68C0\u67E5 API Key \u662F\u5426\u6B63\u786E\u3002`;
      case 404:
        return `LLM endpoint 404: ${message}\u3002\u8BF7\u68C0\u67E5 API \u57FA\u7840\u5730\u5740(\u5E38\u89C1: \u6F0F\u4E86 /v1 \u540E\u7F00\u6216\u8DEF\u5F84\u5199\u9519)\u3002`;
      case 429:
        return `LLM \u9891\u7387/\u989D\u5EA6\u9650\u5236: ${message}`;
      case 400:
        return `LLM \u8BF7\u6C42\u53C2\u6570\u9519\u8BEF: ${message}`;
      case 500:
      case 502:
      case 503:
      case 504:
        return `LLM \u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528 (HTTP ${status}): ${message}`;
      default:
        return `LLM HTTP \u9519\u8BEF ${status}: ${message}`;
    }
  }
};

// src/adapters/translation/AnthropicCompatibleTranslationProvider.ts
var ANTHROPIC_VERSION = "2023-06-01";
var LOCALE_LABEL_MAP2 = {
  auto: "the source language (auto-detect)",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  "zh-HK": "Traditional Chinese (Hong Kong)",
  zh: "Chinese",
  en: "English",
  "en-US": "English (American)",
  "en-GB": "English (British)",
  ja: "Japanese",
  "ja-JP": "Japanese",
  ko: "Korean",
  "ko-KR": "Korean",
  fr: "French",
  "fr-FR": "French",
  de: "German",
  "de-DE": "German",
  es: "Spanish",
  "es-ES": "Spanish (European)",
  pt: "Portuguese",
  "pt-BR": "Portuguese (Brazilian)",
  "pt-PT": "Portuguese (European)",
  ru: "Russian",
  "ru-RU": "Russian",
  it: "Italian",
  "it-IT": "Italian",
  nl: "Dutch",
  "nl-NL": "Dutch",
  ar: "Arabic",
  id: "Indonesian",
  th: "Thai",
  vi: "Vietnamese"
};
var toLocaleLabel2 = (locale) => LOCALE_LABEL_MAP2[locale] ?? locale;
var AnthropicCompatibleTranslationProvider = class extends BaseTranslationProvider {
  id = "anthropic-compatible";
  displayName = "\u81EA\u5B9A\u4E49 LLM (Anthropic \u517C\u5BB9)";
  signupUrl = "https://platform.anthropic.com/settings/keys";
  signupHint = "Anthropic Messages API \u517C\u5BB9\u683C\u5F0F\u3002\u4F8B\u5982 MiniMax \u7528 https://api.minimax.cn/anthropic\u3002\u586B baseUrl + Key + \u6A21\u578B\u540D";
  providerName = "LLM";
  async validateKey(apiKey) {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return { ok: false, reason: "\u8BF7\u586B API \u57FA\u7840\u5730\u5740\u3001Key\u3001\u6A21\u578B\u540D(\u4E09\u4E2A\u90FD\u9700\u8981)\u3002" };
    }
    const parsed = this.parseConfig(trimmed);
    if (!parsed) {
      return {
        ok: false,
        reason: '\u914D\u7F6E\u5FC5\u987B\u662F JSON \u683C\u5F0F: {"baseUrl": "https://...", "apiKey": "...", "model": "..."}'
      };
    }
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) {
      return {
        ok: false,
        reason: "\u4E09\u4E2A\u5B57\u6BB5\u90FD\u5FC5\u586B: API \u57FA\u7840\u5730\u5740\u3001API Key\u3001\u6A21\u578B\u540D\u3002"
      };
    }
    if (!this.isValidHttpUrl(parsed.baseUrl)) {
      return {
        ok: false,
        reason: `API \u57FA\u7840\u5730\u5740\u683C\u5F0F\u4E0D\u5BF9: "${parsed.baseUrl}"\u3002\u9700\u8981 https:// \u5F00\u5934\u7684 URL\u3002`
      };
    }
    return { ok: true };
  }
  async translate(rawConfig, request) {
    const config = this.parseConfig(rawConfig);
    if (!config) {
      throw new Error("Anthropic \u517C\u5BB9 provider \u914D\u7F6E\u7F3A\u5931\u6216\u635F\u574F,\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CD\u65B0\u586B\u5199\u3002");
    }
    const baseUrl = config.baseUrl.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/v1/messages`;
    const targetLabel = toLocaleLabel2(request.target);
    const sourceLabel = toLocaleLabel2(request.source);
    const systemPrompt = "You are a professional translator. Translate the user's text accurately and naturally. Preserve the original meaning, tone, and formatting (paragraph breaks, lists, code). Output ONLY the translation \u2014 no preamble, no explanations, no quotation marks around it. If the input is already in the target language, return it unchanged.";
    const userPrompt = request.source === "auto" ? `Translate the following text into ${targetLabel}:

"""${request.text}"""` : `Translate the following text from ${sourceLabel} into ${targetLabel}:

"""${request.text}"""`;
    const maxTokens = Math.max(256, Math.min(4096, request.text.length * 4));
    const body = {
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    };
    const success = await this.fetchJson(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    });
    const textBlock = success.content?.find((b3) => b3.type === "text");
    const translated = textBlock?.text?.trim();
    if (!translated) {
      const stopReason = success.stop_reason ?? "unknown";
      throw new Error(`${this.providerName} \u8FD4\u56DE\u4E86\u7A7A\u7684\u7FFB\u8BD1\u7ED3\u679C (stop_reason=${stopReason})\u3002\u53EF\u80FD\u662F max_tokens \u4E0D\u591F,\u8BD5\u8BD5\u8C03\u5927\u6216\u7F29\u77ED\u8F93\u5165\u3002`);
    }
    return {
      text: translated,
      detectedSource: null,
      providerId: this.id
    };
  }
  parseConfig(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return {
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "",
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
        model: typeof parsed.model === "string" ? parsed.model.trim() : ""
      };
    } catch {
      return null;
    }
  }
  isValidHttpUrl(s3) {
    try {
      const url = new URL(s3);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
  formatHttpError(status, body) {
    const message = body && typeof body === "object" && "error" in body ? body.error?.message ?? "Unknown error from LLM API." : "Unknown error from LLM API.";
    switch (status) {
      case 401:
        return `LLM \u9274\u6743\u5931\u8D25 (HTTP ${status}): ${message}\u3002\u8BF7\u68C0\u67E5 API Key \u662F\u5426\u6B63\u786E\u3002`;
      case 403:
        return `LLM \u9274\u6743\u5931\u8D25 (HTTP ${status}): ${message}`;
      case 404:
        return `LLM endpoint 404: ${message}\u3002\u8BF7\u68C0\u67E5 API \u57FA\u7840\u5730\u5740(\u5E38\u89C1: \u6F0F\u4E86 /anthropic \u540E\u7F00)\u3002`;
      case 429:
        return `LLM \u9891\u7387/\u989D\u5EA6\u9650\u5236: ${message}`;
      case 400:
        return `LLM \u8BF7\u6C42\u53C2\u6570\u9519\u8BEF: ${message}\u3002\u53EF\u80FD\u662F\u6A21\u578B\u540D\u5199\u9519\u6216 max_tokens \u4E0D\u591F\u5927\u3002`;
      case 500:
      case 502:
      case 503:
      case 504:
        return `LLM \u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528 (HTTP ${status}): ${message}`;
      default:
        return `LLM HTTP \u9519\u8BEF ${status}: ${message}`;
    }
  }
};

// src/core/types/ShelfFilter.ts
var DEFAULT_SORT = "addedDesc";
var emptyFilter = () => ({});

// src/core/entities/ReadingState.ts
var defaultReadingState = (bookId, now = Date.now()) => ({
  bookId,
  position: null,
  status: "unread",
  favorite: false,
  lastOpenedAt: null,
  totalReadingMs: 0
});
var progressFraction = (state) => {
  if (!state.position) return 0;
  switch (state.position.kind) {
    case "reflow":
      return clamp(state.position.fraction);
    case "text":
      return clamp(state.position.fraction);
    case "pdf":
      if (typeof state.position.totalPages === "number" && state.position.totalPages > 0) {
        return clamp((state.position.page - 1) / state.position.totalPages);
      }
      return 0;
  }
};
var clamp = (value) => Math.max(0, Math.min(1, value));

// src/core/services/LibraryService.ts
var LibraryService = class {
  constructor(source, annotations, metadataReader, bookBytesLoader) {
    this.source = source;
    this.annotations = annotations;
    this.metadataReader = metadataReader;
    this.bookBytesLoader = bookBytesLoader;
  }
  entries = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  sourceDisposables = [];
  // Re-entrancy guard. Obsidian can fire 'added' events back-to-back
  // during startup (one per new file it just loaded). Re-running
  // `initialize` mid-flight overwrites entries and double-emits. We
  // serialise on a single promise so the second caller awaits the
  // first then no-ops if the entries are already populated.
  initializeInFlight = null;
  /** Initial load: scan the source and join against stored reading state. */
  async initialize() {
    if (this.entries.size > 0 && this.initializeInFlight === null) return;
    if (this.initializeInFlight) return this.initializeInFlight;
    this.initializeInFlight = this.doInitialize();
    try {
      await this.initializeInFlight;
    } finally {
      this.initializeInFlight = null;
    }
  }
  async doInitialize() {
    const [reading, library] = await Promise.all([
      this.annotations.listReading(),
      this.annotations.listLibrary()
    ]);
    const readingByPath = new Map(reading.map((state) => [state.bookId, state]));
    const librarySet = new Set(library);
    const addedAtEntries = await Promise.all(
      library.map((id) => this.annotations.getAddedAt(id).then((addedAt) => [id, addedAt]))
    );
    const addedAtByBookId = new Map(addedAtEntries);
    const pinnedAtEntries = await Promise.all(
      library.map(async (id) => [id, await this.annotations.getPinnedAt(id)])
    );
    const pinnedAtByBookId = new Map(pinnedAtEntries);
    const formats = READER_CAPABLE_FORMATS;
    for await (const locator of this.source.scan(formats)) {
      const id = this.source.resolveId(locator);
      let metadata = null;
      try {
        const rich = await this.annotations.loadRichMetadata(id);
        if (rich) {
          metadata = rich;
        } else {
          metadata = await this.source.readMetadata(locator);
        }
      } catch {
        metadata = null;
      }
      const addedToLibraryAt = librarySet.has(id) ? addedAtByBookId.get(id) ?? Date.now() : null;
      const book = {
        id,
        locator,
        metadata,
        sourceModifiedAt: locator.modifiedAt,
        addedToLibraryAt,
        coverPath: null,
        pinnedAt: pinnedAtByBookId.get(id) ?? null
      };
      const stored = readingByPath.get(id);
      this.entries.set(id, {
        book,
        reading: stored ?? {
          bookId: id,
          position: null,
          status: "unread",
          favorite: false,
          lastOpenedAt: null,
          totalReadingMs: 0
        }
      });
    }
    const inLibrary = [...this.entries.values()].filter((entry) => entry.book.addedToLibraryAt !== null).length;
    console.info(`[ez-reader] Library scan: ${this.entries.size} book(s) discovered, ${inLibrary} in library.`);
    for (const entry of this.entries.values()) {
      const flag = entry.book.addedToLibraryAt !== null ? "+" : "-";
      console.info(`[ez-reader]   [${flag}] ${entry.book.locator.format.toUpperCase().padEnd(4)} ${entry.book.locator.path}`);
    }
    this.sourceDisposables.push(
      this.source.watch((event) => {
        if (event.kind === "removed") {
          const id = this.source.resolveId({ path: event.path, format: event.format, sizeBytes: 0, modifiedAt: 0 });
          this.entries.delete(id);
          this.emit();
        } else if (event.kind === "added") {
          if (this.entries.size === 0) {
            void this.initialize();
          } else {
            void this.refreshBook(event.path);
          }
        } else {
          void this.refreshBook(event.path);
        }
      })
    );
    this.emit();
  }
  /**
   * P2-1: 并发 race guard. Obsidian 启动时可能并发触发多个 'added' 事件
   * (一个 per 新文件). 两次并发 refreshBook(path) 会:
   *   - 都跑 source.lookup/readMetadata (重复 IO)
   *   - 都 entries.set 同一个 key (冗余写)
   *   - 都 emit (shelf 重渲染两次)
   * Map<path, Promise> in-flight 去重: 同一 path 第二次 await 直接复用第一次.
   * 第一次完成后 delete 出 map, 后续调用走正常路径.
   */
  refreshBookInFlight = /* @__PURE__ */ new Map();
  /** Re-read a single book from the source, e.g. after a modify event.
   *  If the book is not yet in `entries` (a freshly-added file the user
   *  dragged in mid-session) we synthesise a fresh entry from the
   *  source's metadata. Watch 'added' events previously got dropped
   *  here when entries.size > 0. */
  async refreshBook(path) {
    const inflight = this.refreshBookInFlight.get(path);
    if (inflight) return inflight;
    const promise = this.doRefreshBook(path).finally(() => {
      this.refreshBookInFlight.delete(path);
    });
    this.refreshBookInFlight.set(path, promise);
    return promise;
  }
  async doRefreshBook(path) {
    const existing = [...this.entries.values()].find((entry) => entry.book.locator.path === path);
    if (existing) {
      const locator = existing.book.locator;
      let metadata2 = existing.book.metadata;
      try {
        metadata2 = await this.source.readMetadata(locator);
      } catch {
        metadata2 = null;
      }
      this.entries.set(existing.book.id, {
        book: { ...existing.book, metadata: metadata2, sourceModifiedAt: locator.modifiedAt },
        reading: existing.reading
      });
      this.emit();
      return;
    }
    const newFile = await this.source.lookup(path);
    if (!newFile) {
      return;
    }
    let metadata = null;
    try {
      metadata = await this.source.readMetadata(newFile);
    } catch {
      metadata = null;
    }
    const id = this.source.resolveId(newFile);
    const reading = await this.getStoredReading(id);
    const [isInLibrary, addedAt, pinnedAt] = await Promise.all([
      this.isBookInLibrary(id),
      this.annotations.getAddedAt(id),
      this.annotations.getPinnedAt(id)
    ]);
    this.entries.set(id, {
      book: {
        id,
        locator: newFile,
        metadata,
        sourceModifiedAt: newFile.modifiedAt,
        addedToLibraryAt: isInLibrary ? addedAt ?? Date.now() : null,
        coverPath: null,
        pinnedAt
      },
      reading: reading ?? {
        bookId: id,
        position: null,
        status: "unread",
        favorite: false,
        lastOpenedAt: null,
        totalReadingMs: 0
      }
    });
    this.emit();
  }
  /**
   * A1 修复配套: 检查 bookId 是否在持久化 library 数组里. 比直接调
   * `listLibrary()` 全量扫描 + .includes(bookId) 节省 IO — 后者在
   * 几百本书时每个 refreshBook 都 walk 整个数组.
   *
   * 这里仍然全量读是因为 AnnotationStore 没有 set 查询接口. 实际上
   * 几百本书的 listLibrary() 返回数组也就 O(N) 但内存操作, 实测
   * < 1ms, 不构成瓶颈. 如果以后出现性能问题, 给 AnnotationStore 加
   * `hasInLibrary(bookId)` O(1) 接口.
   */
  async isBookInLibrary(bookId) {
    const library = await this.annotations.listLibrary();
    return library.includes(bookId);
  }
  async getStoredReading(bookId) {
    const all = await this.annotations.listReading();
    return all.find((r3) => r3.bookId === bookId);
  }
  /**
   * P2-4: 共享的"更新 entry.book 字段"辅助. 之前 6 处手写 `{ ...entry.book, X }`
   * + entries.set 重复, 一致性靠人工. 现在一处 helper, 自动 emit.
   * 关键不变量:
   *   - bookId 不会变 (不允许跨书 patch)
   *   - reading 字段保持不变 (跟 book metadata 独立)
   *   - 没找到 entry 时静默 no-op
   *   - 没字段实际改变时 skip emit (避免无意义的 shelf 重渲染)
   */
  updateBook(bookId, patch) {
    const entry = this.entries.get(bookId);
    if (!entry) return false;
    const next = { ...entry.book, ...patch };
    if (next.id !== bookId) {
      console.warn("[ez-reader] updateBook: bookId changed, ignoring", { from: bookId, to: next.id });
      return false;
    }
    if (next.metadata === entry.book.metadata && next.coverPath === entry.book.coverPath && next.pinnedAt === entry.book.pinnedAt && next.addedToLibraryAt === entry.book.addedToLibraryAt && next.sourceModifiedAt === entry.book.sourceModifiedAt && next.locator === entry.book.locator) {
      return false;
    }
    this.entries.set(bookId, { book: next, reading: entry.reading });
    this.emit();
    return true;
  }
  /** Persist a reading state change. */
  async updateReading(state) {
    await this.annotations.upsertReading(state);
    const existing = this.entries.get(state.bookId);
    if (existing) {
      this.entries.set(state.bookId, { book: existing.book, reading: state });
      this.emit();
    }
  }
  /** Apply a filter and sort, returning the slice the shelf renders. By default only
   *  books the user has explicitly added to the library are returned. Pass
   *  `includeUntracked: true` to surface discovered-but-unadded books as well. */
  list(filter3 = emptyFilter(), sort = DEFAULT_SORT, includeUntracked = false) {
    const filtered = [...this.entries.values()].filter((entry) => {
      if (!includeUntracked && entry.book.addedToLibraryAt === null) return false;
      return matches(entry, filter3);
    });
    filtered.sort((a3, b3) => compare(a3, b3, sort));
    return filtered;
  }
  /** Look up a single entry by id. */
  get(bookId) {
    return this.entries.get(bookId);
  }
  /** Add a book to the user's library. Idempotent. */
  async addToLibrary(bookId, now = Date.now()) {
    const entry = this.entries.get(bookId);
    if (!entry) return;
    if (entry.book.addedToLibraryAt !== null) return;
    await this.annotations.addToLibrary(bookId);
    await this.annotations.setAddedAt(bookId, now);
    this.updateBook(bookId, { addedToLibraryAt: now });
  }
  /** Add every currently-discovered book to the library. Idempotent. */
  async addAllToLibrary(now = Date.now()) {
    const ids = [...this.entries.values()].filter((entry) => entry.book.addedToLibraryAt === null).map((entry) => entry.book.id);
    if (ids.length === 0) return 0;
    await this.annotations.addToLibraryBatchWithStamp(ids, now);
    let changed = 0;
    for (const id of ids) {
      if (this.updateBook(id, { addedToLibraryAt: now })) changed++;
    }
    if (changed === 0) {
      this.emit();
    }
    return ids.length;
  }
  /** Remove a book from the library. The underlying file stays in the Vault. */
  async removeFromLibrary(bookId) {
    const entry = this.entries.get(bookId);
    if (!entry || entry.book.addedToLibraryAt === null) return;
    await this.annotations.removeFromLibrary(bookId);
    this.updateBook(bookId, { addedToLibraryAt: null });
  }
  /**
   * Update a book's cover path. Called by the cover-extraction flow once
   * the user has opened the book and the engine has surfaced an image.
   */
  setCoverPath(bookId, coverPath) {
    this.updateBook(bookId, { coverPath });
  }
  /**
   * P0-2 修复: 用 reader 解析的真 metadata (EPUB OPF / MOBI EXTH) 替换
   * filename-derived fallback. 调用时机: ReaderView.openSession 成功后.
   *
   * No-op when:
   *   - 书不在 entries (用户 vault 改 / 已被移除)
   *   - 没有 metadataReader / loader (Plugin 没装配)
   *   - reader 解析失败 (返回 null, 通常意味着损坏的 EPUB/MOBI)
   *   - 解析出来的 title 跟当前 metadata.title 一样 (去重避免无意义的 emit)
   *
   * 持久化用 `annotations.saveRichMetadata`, 写盘一次. 后续 vault 重启
   * `doInitialize` 会先 load rich metadata 再 fallback 到 filename.
   */
  async refreshMetadata(bookId) {
    const entry = this.entries.get(bookId);
    if (!entry) return;
    if (!this.metadataReader || !this.bookBytesLoader) return;
    let fresh = null;
    try {
      fresh = await this.metadataReader.readMetadata(entry.book, this.bookBytesLoader);
    } catch (error) {
      console.warn("[ez-reader] refreshMetadata: reader parser threw", error);
      return;
    }
    if (!fresh) return;
    if (entry.book.metadata?.title === fresh.title) return;
    try {
      await this.annotations.saveRichMetadata(bookId, fresh);
    } catch (error) {
      console.warn("[ez-reader] refreshMetadata: saveRichMetadata failed", error);
      return;
    }
    this.updateBook(bookId, { metadata: fresh });
  }
  /**
   * Toggle the "pinned to top" flag for `bookId`. Idempotent: calling
   * when already pinned un-pins, and vice versa. Persists to the
   * annotation store and emits a single change event so the shelf
   * re-renders exactly once.
   */
  async togglePin(bookId, now = Date.now()) {
    const entry = this.entries.get(bookId);
    if (!entry) return false;
    const isPinned = entry.book.pinnedAt !== null;
    const nextPinnedAt = isPinned ? null : now;
    await this.annotations.setPinnedAt(bookId, nextPinnedAt);
    this.updateBook(bookId, { pinnedAt: nextPinnedAt });
    return nextPinnedAt !== null;
  }
  /** Aggregate stats the shelf toolbar shows (counts per status, languages, etc.). */
  stats() {
    const statuses = {
      unread: 0,
      reading: 0,
      finished: 0,
      abandoned: 0
    };
    const languages = /* @__PURE__ */ new Map();
    let inLibrary = 0;
    for (const entry of this.entries.values()) {
      if (entry.book.addedToLibraryAt === null) continue;
      inLibrary += 1;
      statuses[entry.reading.status] += 1;
      for (const lang of entry.book.metadata?.languages ?? []) {
        languages.set(lang, (languages.get(lang) ?? 0) + 1);
      }
    }
    return { total: this.entries.size, inLibrary, statuses, languages };
  }
  /** Subscribe to data changes. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Tear down subscriptions and clear state. */
  dispose() {
    for (const d2 of this.sourceDisposables) d2.dispose();
    this.sourceDisposables.length = 0;
    this.listeners.clear();
  }
  emit() {
    for (const listener of this.listeners) listener();
  }
};
var matches = (entry, filter3) => {
  if (filter3.query && filter3.query.trim().length > 0) {
    if (!matchesQuery(entry, filter3.query)) return false;
  }
  if (filter3.statuses && filter3.statuses.length > 0 && !filter3.statuses.includes(entry.reading.status)) {
    return false;
  }
  if (filter3.formats && filter3.formats.length > 0 && !filter3.formats.includes(entry.book.locator.format)) {
    return false;
  }
  if (filter3.languages && filter3.languages.length > 0) {
    const langs = entry.book.metadata?.languages ?? [];
    if (!langs.some((lang) => filter3.languages.includes(lang))) return false;
  }
  if (filter3.progressBuckets && filter3.progressBuckets.length > 0) {
    if (!filter3.progressBuckets.includes(bucketFor(entry.reading))) return false;
  }
  if (filter3.recency) {
    if (!matchesRecency(entry.reading.lastOpenedAt, filter3.recency)) return false;
  }
  return true;
};
var matchesQuery = (entry, rawQuery) => {
  const needle = rawQuery.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = [entry.book.metadata?.title ?? entry.book.locator.path];
  for (const author of entry.book.metadata?.authors ?? []) haystack.push(author);
  if (entry.book.metadata?.identifier) haystack.push(entry.book.metadata.identifier);
  return haystack.some((h3) => h3.toLocaleLowerCase().includes(needle));
};
var matchesRecency = (lastOpenedAt, bucket) => {
  const now = Date.now();
  if (!lastOpenedAt) return bucket === "never";
  const dayMs = 24 * 60 * 60 * 1e3;
  const elapsed = now - lastOpenedAt;
  switch (bucket) {
    case "today":
      return elapsed <= dayMs;
    case "thisWeek":
      return elapsed <= 7 * dayMs;
    case "thisMonth":
      return elapsed <= 30 * dayMs;
    case "older":
      return elapsed > 30 * dayMs;
    case "never":
      return false;
  }
};
var bucketFor = (reading) => {
  const fraction = progressFraction(reading);
  if (!reading.position || fraction === 0) return "untouched";
  if (fraction >= 0.95) return "finished";
  if (fraction >= 0.66) return "late";
  if (fraction >= 0.33) return "middle";
  return "early";
};
var compare = (a3, b3, sort) => {
  const ap = a3.book.pinnedAt;
  const bp = b3.book.pinnedAt;
  if (ap !== null && bp === null) return -1;
  if (ap === null && bp !== null) return 1;
  if (ap !== null && bp !== null && ap !== bp) return bp - ap;
  switch (sort) {
    case "titleAsc":
      return (a3.book.metadata?.title ?? a3.book.locator.path).localeCompare(
        b3.book.metadata?.title ?? b3.book.locator.path
      );
    case "titleDesc":
      return (b3.book.metadata?.title ?? b3.book.locator.path).localeCompare(
        a3.book.metadata?.title ?? a3.book.locator.path
      );
    case "authorAsc":
      return (a3.book.metadata?.authors[0] ?? "").localeCompare(b3.book.metadata?.authors[0] ?? "");
    case "addedDesc":
      return b3.book.sourceModifiedAt - a3.book.sourceModifiedAt;
    case "openedDesc":
      return (b3.reading.lastOpenedAt ?? 0) - (a3.reading.lastOpenedAt ?? 0);
    case "progressDesc":
      return progressFraction(b3.reading) - progressFraction(a3.reading);
  }
};

// src/core/services/ReadingService.ts
var ReadingService = class {
  constructor(annotations, onChange) {
    this.annotations = annotations;
    this.onChange = onChange;
  }
  /** Get current state, falling back to a default. */
  async getState(bookId) {
    const all = await this.annotations.listReading();
    return all.find((state) => state.bookId === bookId) ?? defaultReadingState(bookId);
  }
  /** Mark a book as currently being read and bump the lastOpenedAt. */
  async openBook(bookId, now = Date.now()) {
    const state = await this.getState(bookId);
    const next = {
      ...state,
      lastOpenedAt: now,
      status: state.status === "unread" ? "reading" : state.status
    };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }
  /** Persist a new position and re-classify status if needed. */
  async updatePosition(bookId, position) {
    const state = await this.getState(bookId);
    const fraction = computeFraction(position);
    const status = inferStatus(state.status, fraction);
    const next = { ...state, position, status };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }
  async setStatus(bookId, status) {
    const state = await this.getState(bookId);
    const next = { ...state, status };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }
  async toggleFavorite(bookId) {
    const state = await this.getState(bookId);
    const next = { ...state, favorite: !state.favorite };
    await this.annotations.upsertReading(next);
    await this.fireChange(next);
    return next;
  }
  /**
   * P1: 累加阅读时长. 通过 ReaderView 的 active-leaf 监听器触发,
   * deltaMs 来自"上次 active 到这次 inactive"的间隔。
   * 不触发 onChange (shelf 不需要立即 re-render — 累计是后台行为)。
   */
  async addReadingTime(bookId, deltaMs) {
    if (deltaMs <= 0) return this.getState(bookId);
    const state = await this.getState(bookId);
    const next = {
      ...state,
      totalReadingMs: (state.totalReadingMs ?? 0) + deltaMs
    };
    await this.annotations.upsertReading(next);
    return next;
  }
  /** Fire onChange (if registered), swallowing errors so a listener
   *  failure doesn't break the write that already succeeded. */
  async fireChange(state) {
    if (!this.onChange) return;
    try {
      await this.onChange(state);
    } catch (error) {
      console.warn("[ez-reader] ReadingService.onChange listener failed", error);
    }
  }
  async addBookmark(bookmark) {
    await this.annotations.addBookmark(bookmark);
  }
  async removeBookmark(bookId, bookmarkId) {
    await this.annotations.removeBookmark(bookId, bookmarkId);
  }
  async listBookmarks(bookId) {
    return this.annotations.listBookmarks(bookId);
  }
  async addExcerpt(excerpt) {
    await this.annotations.addExcerpt(excerpt);
  }
  async removeExcerpt(bookId, excerptId) {
    await this.annotations.removeExcerpt(bookId, excerptId);
  }
  /**
   * P2: 只 patch note / tags 字段, 不重写整张 excerpt. 配合 notes panel
   * 的 inline edit — 用户 blur 出 note 字段 → 立即调这个, 不重新写
   * highlight (locator 没变), 也不改 createdAt / text.
   */
  async updateExcerptNote(bookId, excerptId, patch) {
    await this.annotations.updateExcerptNote(bookId, excerptId, patch);
  }
  async listExcerpts(bookId) {
    return this.annotations.listExcerpts(bookId);
  }
  /** Read the configured translation target locale, with sensible default. */
  async getTranslationLocale() {
    try {
      const settings = await this.annotations.listSettings();
      const locale = settings.translation?.targetLocale;
      return typeof locale === "string" && locale ? locale : "zh-CN";
    } catch {
      return "zh-CN";
    }
  }
  /**
   * P2: 读取这本书用户翻过的 toc item id 列表. ReaderView 在 openSession
   * 完成后立即调, 把结果传给 TocPanel.setVisited, 让进度点从第一次
   * 打开就有绿色 (而不是要等下次 relocate 才填).
   */
  async getVisitedTocIds(bookId) {
    return this.annotations.loadVisitedTocIds(bookId);
  }
  /**
   * P2: 写这本书的 visited toc ids (覆盖). ReaderView 在 debounce 后调,
   * 跟 progress 持久化一样 300ms 兜底, 不每次 relocate 都写盘. ids 是
   * 当前 user 翻过的所有 toc id (caller 自己维护 Set 去重).
   */
  async saveVisitedTocIds(bookId, ids) {
    await this.annotations.saveVisitedTocIds(bookId, ids);
  }
};
var computeFraction = (position) => {
  if (position.kind === "reflow" || position.kind === "text" || position.kind === "pdf") {
    return progressFraction({
      bookId: "",
      position,
      status: "reading",
      favorite: false,
      lastOpenedAt: null,
      totalReadingMs: 0
    });
  }
  return 0;
};
var inferStatus = (current, fraction) => {
  if (current === "finished" || current === "abandoned") return current;
  if (fraction >= 0.95) return "finished";
  if (fraction > 0) return "reading";
  return current === "unread" ? "unread" : "reading";
};

// src/core/services/TranslationService.ts
var TranslationCoordinator = class _TranslationCoordinator {
  constructor(annotations, providers) {
    this.annotations = annotations;
    for (const provider of providers) this.providers.set(provider.id, provider);
  }
  providers = /* @__PURE__ */ new Map();
  /**
   * Short-TTL cache of `listSettings()`. Settings are read on every
   * translate() call but rarely change — caching for ~30s avoids the
   * IO hit on rapid translation requests (e.g. user translating
   * multiple selections in succession). `invalidate()` lets settings-tab
   * saves bust the cache immediately.
   */
  cachedSettings = null;
  static SETTINGS_CACHE_TTL_MS = 3e4;
  listProviders() {
    return [...this.providers.values()];
  }
  /** Drop the settings cache. Called by Plugin after saveSettings. */
  invalidate() {
    this.cachedSettings = null;
  }
  async getSettings() {
    const now = Date.now();
    if (this.cachedSettings && now - this.cachedSettings.fetchedAt < _TranslationCoordinator.SETTINGS_CACHE_TTL_MS) {
      return this.cachedSettings.value;
    }
    const value = await this.annotations.listSettings();
    this.cachedSettings = { value, fetchedAt: now };
    return value;
  }
  async translate(text, source, target) {
    const settings = await this.getSettings();
    if (!settings.translation) {
      throw new Error("Translation is not configured. Add an API key in plugin settings first.");
    }
    const provider = this.providers.get(settings.translation.providerId);
    if (!provider) {
      throw new Error(`Unknown translation provider: ${settings.translation.providerId}`);
    }
    const request = {
      text,
      source: settings.translation.sourceLocale || source,
      target: settings.translation.targetLocale || target
    };
    return provider.translate(settings.translation.apiKey, request);
  }
};

// src/ui/shelf/ShelfView.ts
var import_obsidian8 = require("obsidian");

// src/ui/shelf/AddToLibraryModal.ts
var import_obsidian5 = require("obsidian");
var AddToLibraryModal = class extends import_obsidian5.Modal {
  service;
  covers;
  loader;
  candidates = [];
  selected = /* @__PURE__ */ new Set();
  searchInput;
  unsubscribe;
  lastRendered;
  coverFetchInFlight = /* @__PURE__ */ new Set();
  constructor(app, service, options) {
    super(app);
    this.service = service;
    this.covers = options?.covers;
    this.loader = options?.loader;
    this.searchInput = document.createElement("input");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "\u6309\u6807\u9898\u6216\u8DEF\u5F84\u7B5B\u9009\u2026";
    this.searchInput.addClass("ez-reader__add-modal__search");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__add-modal");
    contentEl.createEl("h2", { text: "\u52A0\u5165\u4E2A\u4EBA\u56FE\u4E66\u9986" });
    contentEl.createEl("p", {
      cls: "ez-reader__add-modal__hint",
      text: "\u52FE\u9009\u8981\u52A0\u5165\u7684\u4E66\u3002\u5C01\u9762\u4F1A\u6309\u9700\u63D0\u53D6\u3002\u52A0\u5165\u540E,\u8FD9\u4E9B\u4E66\u4F1A\u51FA\u73B0\u5728\u4E66\u67B6\u4E0A,\u539F\u59CB\u6587\u4EF6\u4FDD\u7559\u5728 Vault\u3002"
    });
    this.candidates = [...this.service.list({}, "titleAsc", true)].filter(
      (entry) => entry.book.addedToLibraryAt === null
    );
    this.unsubscribe = this.service.subscribe(() => {
      if (this.lastRendered) this.renderList(this.lastRendered);
    });
    const header = contentEl.createDiv({ cls: "ez-reader__add-modal__header" });
    header.append(this.searchInput);
    const selectAll = header.createEl("button", { text: "\u5168\u9009", attr: { type: "button" } });
    selectAll.onclick = () => this.toggleAll(true);
    const selectNone = header.createEl("button", { text: "\u5168\u4E0D\u9009", attr: { type: "button" } });
    selectNone.onclick = () => this.toggleAll(false);
    const addAll = header.createEl("button", { text: "\u52A0\u5165\u5168\u90E8", attr: { type: "button" } });
    addAll.addClass("mod-cta");
    addAll.onclick = () => void this.confirmAddAll();
    const list = contentEl.createDiv({ cls: "ez-reader__add-modal__list" });
    this.renderList(list);
    this.searchInput.addEventListener("input", this.onSearchInput);
    this.maybeExtractCovers(this.filteredCandidates());
    const summary = contentEl.createDiv({ cls: "ez-reader__add-modal__summary" });
    summary.createEl("span", {
      text: `\u5171 ${this.candidates.length} \u672C\u5019\u9009 \xB7 \u5DF2\u9009 ${this.selected.size} \u672C`,
      cls: "ez-reader__add-modal__summary-text"
    });
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancel.onclick = () => this.close();
    const confirm = actions.createEl("button", { text: "\u52A0\u5165\u6240\u9009", attr: { type: "button" } });
    confirm.addClass("mod-cta");
    const setActionsBusy = (busy) => {
      const btns = [confirm, addAll, selectAll, selectNone];
      for (const btn of btns) btn.disabled = busy;
    };
    confirm.onclick = () => void this.confirmSelection(setActionsBusy);
    addAll.onclick = () => void this.confirmAddAll(setActionsBusy);
  }
  onClose() {
    this.unsubscribe?.();
    this.unsubscribe = void 0;
    this.coverFetchInFlight.clear();
    this.searchInput.removeEventListener("input", this.onSearchInput);
  }
  // D1 修复: 命名 handler 让 addEventListener / removeEventListener 配对.
  // 注意 this.lastRendered 在 onOpen 之后才设置, 这里依赖 onSearchInput
  // 只在 modal open 期间被触发.
  onSearchInput = () => {
    if (this.lastRendered) this.renderList(this.lastRendered);
  };
  filteredCandidates() {
    const query = this.searchInput.value.trim().toLocaleLowerCase();
    return this.candidates.filter((entry) => {
      if (!query) return true;
      const haystack = `${entry.book.metadata?.title ?? ""} ${entry.book.locator.path}`.toLocaleLowerCase();
      return haystack.includes(query);
    });
  }
  renderList(host) {
    this.lastRendered = host;
    host.empty();
    const filtered = this.filteredCandidates();
    const summaryEl = this.contentEl.querySelector(".ez-reader__add-modal__summary-text");
    if (summaryEl) summaryEl.textContent = `\u5171 ${this.candidates.length} \u672C\u5019\u9009 \xB7 \u5DF2\u9009 ${this.selected.size} \u672C`;
    if (filtered.length === 0) {
      host.createDiv({ cls: "ez-reader__add-modal__empty", text: "\u6CA1\u6709\u53EF\u52A0\u5165\u7684\u4E66(\u53EF\u80FD\u5DF2\u7ECF\u5168\u90E8\u52A0\u5165,\u6216 Vault \u91CC\u6CA1\u6709\u652F\u6301\u7684\u683C\u5F0F)\u3002" });
      return;
    }
    for (const entry of filtered) {
      const row = host.createDiv({ cls: "ez-reader__add-modal__row" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      const applySelectionVisual = () => {
        row.toggleClass("is-selected", this.selected.has(entry.book.id));
      };
      if (this.selected.has(entry.book.id)) row.addClass("is-selected");
      const toggleSelection = () => {
        if (this.selected.has(entry.book.id)) this.selected.delete(entry.book.id);
        else this.selected.add(entry.book.id);
        applySelectionVisual();
        if (summaryEl) summaryEl.textContent = `\u5171 ${this.candidates.length} \u672C\u5019\u9009 \xB7 \u5DF2\u9009 ${this.selected.size} \u672C`;
      };
      checkbox.checked = this.selected.has(entry.book.id);
      checkbox.onchange = toggleSelection;
      row.onclick = (event) => {
        if (event.target === checkbox) return;
        toggleSelection();
        checkbox.checked = this.selected.has(entry.book.id);
      };
      const cover = row.createDiv({ cls: "ez-reader__add-modal__row__cover" });
      const coverPath = entry.book.coverPath;
      if (coverPath) {
        cover.addClass("has-image");
        cover.createEl("img", { attr: { src: coverPath, alt: entry.book.metadata?.title ?? "" } });
      } else {
        cover.addClass("is-placeholder");
        const title = entry.book.metadata?.title ?? entry.book.locator.path;
        cover.createEl("span", { text: title.charAt(0).toLocaleUpperCase(), cls: "ez-reader__add-modal__row__glyph" });
      }
      const info = row.createDiv({ cls: "ez-reader__add-modal__row__info" });
      info.createEl("span", {
        text: entry.book.metadata?.title ?? entry.book.locator.path,
        cls: "ez-reader__add-modal__row__title"
      });
      const pathRow = info.createDiv({ cls: "ez-reader__add-modal__row__path-row" });
      pathRow.createEl("span", { text: entry.book.locator.path, cls: "ez-reader__add-modal__row__path" });
      row.createEl("span", { text: entry.book.locator.format.toUpperCase(), cls: "ez-reader__add-modal__row__format" });
    }
    this.maybeExtractCovers(filtered);
  }
  /**
   * Trigger cover extraction for books the user is currently looking at.
   * Concurrency capped at 3 and a single book is only fetched once per
   * modal open even if the user filters back and forth.
   */
  maybeExtractCovers(books) {
    if (!this.covers || !this.loader) return;
    const queue = books.map((b3) => b3.book).filter((b3) => !b3.coverPath && !this.coverFetchInFlight.has(b3.id)).slice(0, 12);
    if (queue.length === 0) return;
    let index = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (index < queue.length) {
        const book = queue[index++];
        if (!book) break;
        this.coverFetchInFlight.add(book.id);
        try {
          await this.covers.ensureCoverFor(book, this.loader);
        } catch {
        } finally {
          this.coverFetchInFlight.delete(book.id);
        }
      }
    });
    void Promise.all(workers);
  }
  toggleAll(value) {
    const filtered = this.filteredCandidates();
    for (const entry of filtered) {
      if (value) this.selected.add(entry.book.id);
      else this.selected.delete(entry.book.id);
    }
    const list = this.contentEl.querySelector(".ez-reader__add-modal__list");
    if (list) this.renderList(list);
  }
  async confirmSelection(setActionsBusy = () => {
  }) {
    const ids = [...this.selected];
    if (ids.length === 0) {
      new import_obsidian5.Notice("\u8BF7\u5148\u52FE\u9009\u8981\u52A0\u5165\u7684\u4E66", 2e3);
      return;
    }
    setActionsBusy(true);
    let timedOut = false;
    const timeoutMs = 3e4;
    const timeoutHandle = window.setTimeout(() => {
      timedOut = true;
      console.error(`[ez-reader] confirmSelection timed out after ${timeoutMs}ms \u2014 closing modal forcibly`);
    }, timeoutMs);
    try {
      const settled = await this.raceWithTimeout(
        Promise.allSettled(ids.map((id) => this.service.addToLibrary(id))),
        timeoutMs,
        "confirmSelection.addToLibrary"
      );
      if (timedOut) throw new Error("addToLibrary \u8D85\u65F6");
      const rejected = (settled ?? []).filter(
        (r3) => r3.status === "rejected"
      );
      const books = ids.filter((_id, idx) => settled?.[idx]?.status === "fulfilled").map((id) => this.candidates.find((entry) => entry.book.id === id)?.book).filter((b3) => Boolean(b3));
      await this.raceWithTimeout(this.extractCoversFor(books), timeoutMs, "confirmSelection.extractCoversFor");
      if (timedOut) throw new Error("extractCoversFor \u8D85\u65F6");
      if (rejected.length > 0) {
        const firstReason = rejected[0]?.reason;
        const message = firstReason instanceof Error ? firstReason.message : String(firstReason);
        const total = totalRejectedMessage(rejected.length, ids.length);
        new import_obsidian5.Notice(`${total}: ${message}`);
      }
    } catch (error) {
      console.error("[ez-reader] confirmSelection failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian5.Notice(`\u52A0\u5165\u5931\u8D25: ${message}`);
      return;
    } finally {
      window.clearTimeout(timeoutHandle);
      setActionsBusy(false);
      this.close();
    }
  }
  async confirmAddAll(setActionsBusy = () => {
  }) {
    setActionsBusy(true);
    let timedOut = false;
    const timeoutMs = 6e4;
    const timeoutHandle = window.setTimeout(() => {
      timedOut = true;
      console.error(`[ez-reader] confirmAddAll timed out after ${timeoutMs}ms \u2014 closing modal forcibly`);
    }, timeoutMs);
    try {
      const before = new Set(this.service.list({}, "titleAsc", true).map((entry) => entry.book.id));
      await this.raceWithTimeout(this.service.addAllToLibrary(), timeoutMs, "confirmAddAll.addAllToLibrary");
      if (timedOut) throw new Error("addAllToLibrary \u8D85\u65F6");
      const newlyAdded = this.service.list({}, "titleAsc", true).filter((entry) => !before.has(entry.book.id)).map((entry) => entry.book);
      await this.raceWithTimeout(this.extractCoversFor(newlyAdded), timeoutMs, "confirmAddAll.extractCoversFor");
      if (timedOut) throw new Error("extractCoversFor \u8D85\u65F6");
    } catch (error) {
      console.error("[ez-reader] confirmAddAll failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian5.Notice(`\u5168\u90E8\u52A0\u5165\u5931\u8D25: ${message}`);
      return;
    } finally {
      window.clearTimeout(timeoutHandle);
      setActionsBusy(false);
      this.close();
    }
  }
  /**
   * Race a promise against a deadline. 跟 Plugin.withTimeout 一样的语义, 但
   * 用在这里避免 modal 调用 Plugin 的私有方法. Promise 自身不 reject (超时
   * 不会被外部 catch 看到), 只让外层的 `timedOut` flag 翻起来走关闭路径.
   */
  raceWithTimeout(promise, ms, label) {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = window.setTimeout(() => {
        if (resolved) return;
        console.warn(`[ez-reader] ${label} exceeded ${ms}ms \u2014 leaving promise pending`);
        resolve(void 0);
      }, ms);
      promise.then(
        (value) => {
          if (resolved) return;
          resolved = true;
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (resolved) return;
          resolved = true;
          window.clearTimeout(timer);
          console.warn(`[ez-reader] ${label} rejected`, error);
          resolve(void 0);
        }
      );
    });
  }
  async extractCoversFor(books) {
    if (!this.covers || !this.loader || books.length === 0) return;
    await this.covers.ensureCoversBatch(books, this.loader);
  }
};
var totalRejectedMessage = (rejected, total) => {
  if (rejected === total) return `\u52A0\u5165\u5931\u8D25 (${total} \u672C\u5168\u90E8\u5931\u8D25)`;
  return `\u90E8\u5206\u52A0\u5165\u5931\u8D25 (${rejected} / ${total} \u672C\u5931\u8D25, \u5176\u4F59\u5DF2\u52A0\u5165)`;
};

// src/ui/shelf/OnboardingModal.ts
var import_obsidian6 = require("obsidian");
var OnboardingModal = class extends import_obsidian6.Modal {
  resolver = null;
  constructor(app) {
    super(app);
  }
  /**
   * Resolves to the user's choice, or null if they closed the modal
   * without picking anything (Esc / overlay click / X button).
   */
  openAndWait() {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__onboarding");
    contentEl.createEl("h2", { text: "\u6B22\u8FCE\u4F7F\u7528 EzReader" });
    contentEl.createEl("p", {
      cls: "ez-reader__onboarding__lede",
      text: "\u5728 Obsidian \u91CC\u8BFB\u4F60 Vault \u91CC\u7684\u7535\u5B50\u4E66,\u652F\u6301 EPUB \u548C PDF,\u5E26\u8FDB\u5EA6\u3001\u4E66\u7B7E\u3001\u6458\u5F55\u4E0E\u7FFB\u8BD1\u3002"
    });
    const steps = contentEl.createDiv({ cls: "ez-reader__onboarding__steps" });
    const step = (n3, title, body) => {
      const row = steps.createDiv({ cls: "ez-reader__onboarding__step" });
      row.createEl("span", { text: String(n3), cls: "ez-reader__onboarding__step-num" });
      const text = row.createDiv({ cls: "ez-reader__onboarding__step-text" });
      text.createEl("strong", { text: title });
      text.createEl("p", { text: body });
    };
    step(
      1,
      "\u628A\u4E66\u653E\u8FDB Vault",
      "EPUB \u6216 PDF \u90FD\u53EF\u4EE5\u3002\u653E\u5728 Vault \u5185\u4EFB\u610F\u5B50\u76EE\u5F55\u90FD\u884C \u2014 \u4E0D\u4F1A\u79FB\u52A8\u539F\u6587\u4EF6\u3002"
    );
    step(
      2,
      "\u52A0\u5165\u4F60\u7684\u7B2C\u4E00\u672C\u4E66",
      "\u5728\u5DE5\u5177\u680F\u70B9\u51FB + \u52A0\u5165\u4E66\u7C4D(\u6216\u70B9\u8FD9\u91CC\u4E0B\u9762\u7684\u6309\u94AE),\u4ECE\u5019\u9009\u5217\u8868\u52FE\u9009\u60F3\u8FFD\u8E2A\u7684\u4E66\u3002"
    );
    step(
      3,
      "\u70B9\u51FB\u5C01\u9762\u8FDB\u5165\u9605\u8BFB\u5668",
      "\u652F\u6301\u5B57\u53F7\u3001\u884C\u8DDD\u3001\u4E3B\u9898\u3001\u9009\u8BCD\u7FFB\u8BD1 / \u6458\u5F55 / \u590D\u5236,\u8FDB\u5EA6\u81EA\u52A8\u4FDD\u5B58\u3002"
    );
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const later = actions.createEl("button", { text: "\u7A0D\u540E", attr: { type: "button" } });
    later.onclick = () => this.settle("later");
    const add = actions.createEl("button", { text: "\u5F00\u59CB\u52A0\u4E66", attr: { type: "button" } });
    add.addClass("mod-cta");
    add.onclick = () => this.settle("addBooks");
  }
  onClose() {
    if (this.resolver) this.settle("later");
  }
  settle(choice) {
    const r3 = this.resolver;
    this.resolver = null;
    this.close();
    r3?.(choice);
  }
};

// src/ui/shelf/ShelfFilters.ts
var import_obsidian7 = require("obsidian");
var STATUS_LABELS = {
  unread: "\u672A\u5F00\u59CB",
  reading: "\u5728\u8BFB",
  finished: "\u5DF2\u8BFB\u5B8C",
  abandoned: "\u6682\u5F03"
};
var PROGRESS_LABELS = {
  untouched: "\u672A\u8BFB",
  early: "0-33%",
  middle: "33-66%",
  late: "66-95%",
  finished: "\u5DF2\u8BFB\u5B8C"
};
var RECENCY_LABELS = {
  today: "\u4ECA\u5929",
  thisWeek: "\u672C\u5468",
  thisMonth: "\u672C\u6708",
  older: "\u66F4\u65E9",
  never: "\u4ECE\u672A"
};
var SHELF_FORMAT_ORDER = ["epub", "pdf", "txt", "mobi", "azw3"];
var FORMAT_LABELS = {
  epub: "EPUB",
  pdf: "PDF",
  mobi: "MOBI",
  azw: "AZW",
  azw3: "AZW3",
  txt: "TXT"
};
var COMMON_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de"];
var ShelfFiltersModal = class extends import_obsidian7.Modal {
  result;
  resolver = null;
  constructor(app, initial) {
    super(app);
    this.result = clone(initial);
  }
  openAndGetResult() {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }
  settle(filter3) {
    const r3 = this.resolver;
    this.resolver = null;
    r3?.(filter3);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u7B5B\u9009" });
    this.renderStatusSection(contentEl);
    this.renderFormatSection(contentEl);
    this.renderLanguageSection(contentEl);
    this.renderProgressSection(contentEl);
    this.renderRecencySection(contentEl);
    this.renderActions(contentEl);
  }
  onClose() {
    if (this.resolver) this.settle(null);
  }
  toggleSetValue(current, value) {
    const arr = current ? [...current] : [];
    const next = arr.includes(value) ? arr.filter((x3) => x3 !== value) : [...arr, value];
    return next.length > 0 ? next : void 0;
  }
  renderStatusSection(host) {
    host.createEl("h3", { text: "\u9605\u8BFB\u72B6\u6001" });
    const wrap2 = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const status of Object.keys(STATUS_LABELS)) {
      const button = wrap2.createEl("button", { text: STATUS_LABELS[status], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.statuses?.includes(status) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.statuses, status);
        this.result = { ...this.result, statuses: next };
        button.toggleClass("is-active", next?.includes(status) ?? false);
      });
    }
  }
  renderFormatSection(host) {
    host.createEl("h3", { text: "\u6587\u4EF6\u683C\u5F0F" });
    const wrap2 = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const format of SHELF_FORMAT_ORDER) {
      if (!READER_CAPABLE_FORMATS.has(format)) continue;
      const button = wrap2.createEl("button", {
        text: FORMAT_LABELS[format],
        attr: { type: "button" }
      });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.formats?.includes(format) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.formats, format);
        this.result = { ...this.result, formats: next };
        button.toggleClass("is-active", next?.includes(format) ?? false);
      });
    }
  }
  renderLanguageSection(host) {
    host.createEl("h3", { text: "\u8BED\u8A00" });
    const wrap2 = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const lang of COMMON_LANGUAGES) {
      const button = wrap2.createEl("button", { text: lang, attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.languages?.includes(lang) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.languages, lang);
        this.result = { ...this.result, languages: next };
        button.toggleClass("is-active", next?.includes(lang) ?? false);
      });
    }
  }
  renderProgressSection(host) {
    host.createEl("h3", { text: "\u8FDB\u5EA6\u8303\u56F4" });
    const wrap2 = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const bucket of Object.keys(PROGRESS_LABELS)) {
      const button = wrap2.createEl("button", { text: PROGRESS_LABELS[bucket], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.progressBuckets?.includes(bucket) ?? false);
      button.addEventListener("click", () => {
        const next = this.toggleSetValue(this.result.progressBuckets, bucket);
        this.result = { ...this.result, progressBuckets: next };
        button.toggleClass("is-active", next?.includes(bucket) ?? false);
      });
    }
  }
  renderRecencySection(host) {
    host.createEl("h3", { text: "\u6700\u8FD1\u6253\u5F00\u65F6\u95F4" });
    const wrap2 = host.createDiv({ cls: "ez-reader__shelf-filters__row" });
    for (const bucket of Object.keys(RECENCY_LABELS)) {
      const button = wrap2.createEl("button", { text: RECENCY_LABELS[bucket], attr: { type: "button" } });
      button.addClass("ez-reader__pill");
      button.toggleClass("is-active", this.result.recency === bucket);
      button.addEventListener("click", () => {
        this.result = { ...this.result, recency: this.result.recency === bucket ? void 0 : bucket };
        Array.from(wrap2.children).forEach((child) => child.toggleClass("is-active", false));
        button.toggleClass("is-active", true);
      });
    }
  }
  renderActions(host) {
    const row = host.createDiv({ cls: "ez-reader__shelf-filters__actions" });
    const clear = row.createEl("button", { text: "\u6E05\u9664\u5168\u90E8", attr: { type: "button" } });
    clear.onclick = () => {
      this.settle({});
      this.close();
    };
    const apply = row.createEl("button", { text: "\u5E94\u7528", attr: { type: "button" } });
    apply.addClass("mod-cta");
    apply.onclick = () => {
      this.settle(clone(this.result));
      this.close();
    };
  }
};
var clone = (filter3) => ({
  statuses: filter3.statuses ? [...filter3.statuses] : void 0,
  languages: filter3.languages ? [...filter3.languages] : void 0,
  formats: filter3.formats ? [...filter3.formats] : void 0,
  progressBuckets: filter3.progressBuckets ? [...filter3.progressBuckets] : void 0,
  recency: filter3.recency,
  query: filter3.query
});

// src/ui/shelf/ShelfToolbar.ts
var SORT_LABELS = {
  titleAsc: "\u6807\u9898 A\u2192Z",
  titleDesc: "\u6807\u9898 Z\u2192A",
  authorAsc: "\u4F5C\u8005",
  addedDesc: "\u6700\u8FD1\u6DFB\u52A0",
  openedDesc: "\u6700\u8FD1\u6253\u5F00",
  progressDesc: "\u8FDB\u5EA6"
};
var ShelfToolbar = class {
  root;
  handlers;
  searchInput;
  sortSelect;
  filterBadge;
  countLabel;
  gridButton;
  listButton;
  addAllButton;
  densityButton;
  constructor(handlers, initial) {
    this.handlers = handlers;
    this.root = createDiv({ cls: "ez-reader__shelf-toolbar" });
    this.searchInput = this.root.createEl("input", {
      attr: { type: "search", placeholder: "\u641C\u7D22\u4E66\u540D\u3001\u4F5C\u8005\u6216\u6807\u8BC6\u7B26\u2026" }
    });
    this.searchInput.addClass("ez-reader__shelf-toolbar__search");
    this.searchInput.addEventListener("input", () => this.handlers.onQueryChange(this.searchInput.value));
    this.filterBadge = this.root.createEl("button", {
      text: "\u7B5B\u9009",
      attr: { type: "button", "aria-label": "\u6253\u5F00\u7B5B\u9009\u9762\u677F" }
    });
    this.filterBadge.addClass("ez-reader__shelf-toolbar__filter");
    this.filterBadge.addEventListener("click", () => this.handlers.onFilterOpen());
    const addButton = this.root.createEl("button", {
      text: "+ \u52A0\u5165",
      attr: { type: "button", title: "\u6311\u9009 Vault \u4E2D\u7684\u4E66\u52A0\u5165\u4E2A\u4EBA\u56FE\u4E66\u9986" }
    });
    addButton.addClass("ez-reader__shelf-toolbar__add");
    addButton.addEventListener("click", () => this.handlers.onAddToLibrary());
    this.addAllButton = this.root.createEl("button", {
      text: "\u5168\u90E8\u52A0\u5165",
      attr: { type: "button", title: "\u628A\u6240\u6709\u53D1\u73B0\u7684\u7535\u5B50\u4E66\u90FD\u52A0\u5165\u56FE\u4E66\u9986" }
    });
    this.addAllButton.addClass("ez-reader__shelf-toolbar__add-all");
    if (this.handlers.onAddAllToLibrary) {
      this.addAllButton.addEventListener("click", () => {
        if (this.addAllButton.disabled) return;
        this.handlers.onAddAllToLibrary();
      });
    } else {
      this.addAllButton.addClass("is-hidden");
    }
    this.sortSelect = this.root.createEl("select");
    this.sortSelect.addClass("ez-reader__shelf-toolbar__sort");
    for (const [value, label] of Object.entries(SORT_LABELS)) {
      this.sortSelect.createEl("option", { value, text: `\u6392\u5E8F: ${label}` });
    }
    this.sortSelect.value = initial.sort;
    this.sortSelect.addEventListener("change", () => this.handlers.onSortChange(this.sortSelect.value));
    this.gridButton = this.root.createEl("button", { text: "\u7F51\u683C", attr: { type: "button", title: "\u7F51\u683C\u89C6\u56FE" } });
    this.listButton = this.root.createEl("button", { text: "\u5217\u8868", attr: { type: "button", title: "\u5217\u8868\u89C6\u56FE" } });
    this.gridButton.addClass("ez-reader__shelf-toolbar__toggle");
    this.listButton.addClass("ez-reader__shelf-toolbar__toggle");
    this.gridButton.addEventListener("click", () => this.handlers.onViewModeChange("grid"));
    this.listButton.addEventListener("click", () => this.handlers.onViewModeChange("list"));
    this.densityButton = this.root.createEl("button", {
      attr: { type: "button", "aria-label": "\u5207\u6362\u5C01\u9762\u5BC6\u5EA6", title: "\u70B9\u51FB\u5FAA\u73AF\u5207\u6362\u5C01\u9762\u5BC6\u5EA6" }
    });
    this.densityButton.addClass("ez-reader__shelf-toolbar__density");
    this.densityButton.addEventListener("click", () => {
      if (this.handlers.onCycleShelfDensity) this.handlers.onCycleShelfDensity();
    });
    this.countLabel = this.root.createEl("span", { text: "" });
    this.countLabel.addClass("ez-reader__shelf-toolbar__count");
    this.update(initial);
  }
  update(state) {
    this.gridButton.toggleClass("is-active", state.mode === "grid");
    this.listButton.toggleClass("is-active", state.mode === "list");
    const filterActive = countActiveFilters(state.filter) > 0;
    this.filterBadge.toggleClass("is-active", filterActive);
    this.addAllButton.toggleClass("is-hidden", state.availableCount <= 0);
    if (state.availableCount > 0) {
      this.countLabel.setText(`${state.visibleCount} / ${state.totalCount} \xB7 ${state.availableCount} \u672C\u672A\u52A0\u5165`);
    } else {
      this.countLabel.setText(`${state.visibleCount} / ${state.totalCount}`);
    }
    this.renderDensityButton(state.shelfDensity);
  }
  renderDensityButton(density) {
    this.densityButton.empty();
    const iconWrap = this.densityButton.createDiv({ cls: "ez-reader__shelf-toolbar__density__icon" });
    const parsedIcon = new DOMParser().parseFromString(densityIconSvg(density), "image/svg+xml").documentElement;
    iconWrap.replaceChildren(parsedIcon);
    this.densityButton.createSpan({ text: SHELF_DENSITY_LABELS[density] });
    this.densityButton.setAttribute("title", `\u5C01\u9762\u5BC6\u5EA6: ${SHELF_DENSITY_LABELS[density]} (\u70B9\u51FB\u5FAA\u73AF)`);
  }
  focus() {
    this.searchInput.focus();
  }
  /** Clear the search input field. Called from shortcuts / Esc clear flow. */
  setQuery(value) {
    this.searchInput.value = value;
  }
  /** Toggle the "全部加入" button's disabled state. */
  setAddAllBusy(busy) {
    this.addAllButton.disabled = busy;
    this.addAllButton.toggleClass("is-busy", busy);
  }
};
var countActiveFilters = (filter3) => {
  let count = 0;
  if (filter3.statuses && filter3.statuses.length > 0) count += 1;
  if (filter3.languages && filter3.languages.length > 0) count += 1;
  if (filter3.formats && filter3.formats.length > 0) count += 1;
  if (filter3.progressBuckets && filter3.progressBuckets.length > 0) count += 1;
  if (filter3.recency) count += 1;
  return count;
};
var densityIconSvg = (density) => {
  switch (density) {
    case "compact":
      return `<svg viewBox="0 0 14 14"><rect x="0" y="2" width="3" height="10" rx="0.5"/><rect x="4" y="2" width="3" height="10" rx="0.5"/><rect x="8" y="2" width="3" height="10" rx="0.5"/></svg>`;
    case "default":
      return `<svg viewBox="0 0 14 14"><rect x="0" y="2" width="6" height="10" rx="0.5"/><rect x="8" y="2" width="6" height="10" rx="0.5"/></svg>`;
    case "spacious":
      return `<svg viewBox="0 0 14 14"><rect x="1" y="2" width="5" height="10" rx="0.5"/><rect x="8" y="2" width="5" height="10" rx="0.5"/></svg>`;
    case "large":
      return `<svg viewBox="0 0 14 14"><rect x="3" y="2" width="8" height="10" rx="0.5"/></svg>`;
  }
};
var nextShelfDensity = (current) => {
  const idx = SHELF_DENSITIES.indexOf(current);
  const safeIdx = idx >= 0 ? idx : 1;
  const nextIdx = (safeIdx + 1) % SHELF_DENSITIES.length;
  return SHELF_DENSITIES[nextIdx] ?? "default";
};
var createDiv = (options = {}) => {
  const div = document.createElement("div");
  if (options.cls) div.addClass(options.cls);
  return div;
};

// src/ui/shelf/shelfFormatters.ts
var statusLabel = (status) => {
  switch (status) {
    case "reading":
      return "\u5728\u8BFB";
    case "finished":
      return "\u5DF2\u8BFB\u5B8C";
    case "abandoned":
      return "\u6682\u5F03";
    default:
      return "\u672A\u5F00\u59CB";
  }
};
var extractAuthorFallback = (path) => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, -1).join(" / ");
  return "\u672A\u77E5\u4F5C\u8005";
};

// src/ui/shelf/placeholderCover.ts
var cache = /* @__PURE__ */ new Map();
var PLACEHOLDER_CACHE_MAX = 500;
var placeholderCoverStyle = (title) => {
  const cached = cache.get(title);
  if (cached) return cached;
  const hash = stableHash(title);
  const hue1 = hash % 360;
  const hue2 = (hue1 + 38) % 360;
  const sat = 62 + (hash >> 3) % 12;
  const light1 = 58 + (hash >> 5) % 8;
  const light2 = 44 + (hash >> 7) % 8;
  const highlightHue = hue1;
  const highlightLight = 86;
  const background = [
    `radial-gradient(ellipse 120% 75% at 22% -18%, hsl(${highlightHue}, 75%, ${highlightLight}%) 0%, hsla(${highlightHue}, 70%, 78%, 0.4) 28%, transparent 58%)`,
    `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${light1}%) 0%, hsl(${hue2}, ${sat}%, ${light2}%) 100%)`
  ].join(", ");
  const meanLight = (light1 + light2) / 2;
  const isLight = meanLight > 55;
  const color = isLight ? "rgba(20, 22, 32, 0.92)" : "rgba(255, 255, 255, 0.96)";
  const textShadow = isLight ? "0 1px 2px rgba(255, 255, 255, 0.25)" : "0 1px 3px rgba(0, 0, 0, 0.35)";
  const result = { background, color, textShadow };
  evictIfFull(cache);
  cache.set(title, result);
  return result;
};
var stableHash = (input) => {
  let h3 = 5381;
  for (let i3 = 0; i3 < input.length; i3++) {
    h3 = h3 * 33 ^ input.charCodeAt(i3);
  }
  return Math.abs(h3 | 0);
};
var evictIfFull = (map) => {
  if (map.size < PLACEHOLDER_CACHE_MAX) return;
  const first = map.keys().next().value;
  if (first !== void 0) map.delete(first);
};

// src/ui/shelf/ShelfGridItem.ts
var renderGridItem = (entry, handlers, coverResourcePath) => {
  const card = document.createElement("div");
  card.addClass("ez-reader__shelf-grid__item");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  const titleText = entry.book.metadata?.title ?? entry.book.locator.path;
  card.title = titleText;
  const authorText = entry.book.metadata?.authors?.[0] ?? extractAuthorFallback(entry.book.locator.path);
  const fraction = progressFraction(entry.reading);
  let progressText = "\u2014";
  if (entry.reading.position?.kind === "pdf") {
    progressText = `\u7B2C ${entry.reading.position.page} \u9875`;
  } else if (fraction > 0) {
    progressText = `${Math.round(fraction * 100)}%`;
  }
  card.setAttribute("aria-label", `${titleText} \xB7 ${authorText} \xB7 ${progressText} \xB7 ${statusLabel(entry.reading.status)}`);
  const cover = card.createDiv({ cls: "ez-reader__shelf-grid__cover" });
  if (coverResourcePath) {
    cover.addClass("has-image");
    const img = cover.createEl("img", {
      attr: { src: coverResourcePath, alt: entry.book.metadata?.title ?? "" },
      cls: "ez-reader__shelf-grid__cover-image"
    });
    img.addEventListener("error", () => {
      img.remove();
      cover.removeClass("has-image");
      cover.addClass("is-placeholder");
    });
  } else {
    cover.addClass("is-placeholder");
    const title = entry.book.metadata?.title ?? entry.book.locator.path;
    const style2 = placeholderCoverStyle(title);
    cover.setCssStyles({ background: style2.background, color: style2.color });
    cover.createEl("span", {
      text: title.charAt(0).toLocaleUpperCase(),
      cls: "ez-reader__shelf-grid__cover-glyph",
      attr: { style: `text-shadow: ${style2.textShadow}` }
    });
    const titleEl2 = cover.createEl("span", {
      text: title,
      cls: "ez-reader__shelf-grid__cover-title"
    });
    titleEl2.style.textShadow = style2.textShadow;
  }
  if (entry.book.pinnedAt !== null) {
    const pin = cover.createDiv({ cls: "ez-reader__shelf-grid__pin", attr: { title: handlers.onTogglePin ? "\u70B9\u51FB\u53D6\u6D88\u7F6E\u9876" : "\u5DF2\u7F6E\u9876 \u2014 \u53F3\u952E\u83DC\u5355\u53EF\u53D6\u6D88", "aria-label": "\u5DF2\u7F6E\u9876" }, text: "\u{1F4CC}" });
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      if (handlers.onTogglePin) {
        handlers.onTogglePin(entry);
      } else {
        handlers.onContextMenu(entry, event);
      }
    });
  }
  const meta = card.createDiv({ cls: "ez-reader__shelf-grid__meta" });
  const titleEl = meta.createEl("span", {
    text: titleText,
    cls: "ez-reader__shelf-grid__title"
  });
  const tooltipParts = [titleText];
  if (entry.book.metadata?.publisher) tooltipParts.push(entry.book.metadata.publisher);
  if (entry.book.metadata?.published) tooltipParts.push(entry.book.metadata.published);
  tooltipParts.push(entry.book.locator.path);
  card.setAttribute("title", tooltipParts.join(" \xB7 "));
  titleEl.setAttribute("title", titleText);
  titleEl.addEventListener("contextmenu", (event) => event.preventDefault());
  meta.createEl("span", {
    text: authorText,
    cls: "ez-reader__shelf-grid__author"
  });
  const footer = card.createDiv({ cls: "ez-reader__shelf-grid__footer" });
  footer.createEl("span", { text: statusLabel(entry.reading.status), cls: `ez-reader__status-pill is-${entry.reading.status}` });
  if (entry.reading.position?.kind === "pdf") {
    const page = entry.reading.position.page;
    footer.createEl("span", { text: `\u7B2C ${page} \u9875`, cls: "ez-reader__shelf-grid__progress" });
  } else if (fraction > 0) {
    footer.createEl("span", { text: `${Math.round(fraction * 100)}%`, cls: "ez-reader__shelf-grid__progress" });
  }
  footer.createEl("span", {
    text: entry.book.locator.format.toUpperCase(),
    cls: "ez-reader__shelf-grid__format"
  });
  if (entry.reading.favorite) {
    footer.createEl("span", { text: "\u2605", cls: "ez-reader__shelf-grid__favorite" });
  }
  const lang = entry.book.metadata?.languages?.[0];
  if (lang) {
    footer.createEl("span", { text: lang, cls: "ez-reader__shelf-grid__lang" });
  }
  card.addEventListener("click", () => handlers.onOpen(entry));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlers.onOpen(entry);
    }
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handlers.onContextMenu(entry, event);
  });
  return card;
};

// src/ui/shelf/ShelfListItem.ts
var renderListItem = (entry, handlers, coverResourcePath) => {
  const row = document.createElement("div");
  row.addClass("ez-reader__shelf-list__item");
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  if (coverResourcePath) {
    const cover = row.createEl("img", {
      attr: { src: coverResourcePath, alt: "" },
      cls: "ez-reader__shelf-list__cover"
    });
    cover.addEventListener("error", () => {
      cover.remove();
      const placeholder = row.createDiv({ cls: "ez-reader__shelf-list__cover is-placeholder" });
      const title = entry.book.metadata?.title ?? entry.book.locator.path;
      const style2 = placeholderCoverStyle(title);
      placeholder.setCssStyles({
        background: style2.background,
        color: style2.color,
        textShadow: style2.textShadow
      });
      placeholder.setText(title.charAt(0));
    });
  } else {
    const cover = row.createDiv({ cls: "ez-reader__shelf-list__cover is-placeholder" });
    const title = entry.book.metadata?.title ?? entry.book.locator.path;
    const style2 = placeholderCoverStyle(title);
    cover.setCssStyles({
      background: style2.background,
      color: style2.color,
      textShadow: style2.textShadow
    });
    cover.setText(title.charAt(0));
  }
  const info = row.createDiv({ cls: "ez-reader__shelf-list__info" });
  const titleText = entry.book.metadata?.title ?? entry.book.locator.path;
  const authorText = (entry.book.metadata?.authors ?? []).join("\u3001") || extractAuthorFallback(entry.book.locator.path);
  const fraction = progressFraction(entry.reading);
  let progressText = "\u2014";
  let progressFractionValue = 0;
  if (entry.reading.position?.kind === "pdf") {
    progressText = `\u7B2C ${entry.reading.position.page} \u9875`;
  } else if (fraction > 0) {
    progressText = `${Math.round(fraction * 100)}%`;
    progressFractionValue = fraction;
  }
  info.createEl("span", {
    text: titleText,
    cls: "ez-reader__shelf-list__title"
  });
  info.createEl("span", {
    text: authorText,
    cls: "ez-reader__shelf-list__author"
  });
  if (progressFractionValue > 0) {
    const bar = info.createDiv({ cls: "ez-reader__shelf-list__bar" });
    const fill = bar.createDiv({ cls: "ez-reader__shelf-list__bar-fill" });
    fill.style.width = `${Math.min(100, Math.round(progressFractionValue * 100))}%`;
  }
  const tip = [titleText];
  if (entry.book.metadata?.publisher) tip.push(entry.book.metadata.publisher);
  if (entry.book.metadata?.published) tip.push(entry.book.metadata.published);
  tip.push(entry.book.locator.path);
  row.setAttribute("title", tip.join(" \xB7 "));
  row.setAttribute("aria-label", `${titleText} \xB7 ${authorText} \xB7 ${progressText} \xB7 ${statusLabel(entry.reading.status)}`);
  row.createEl("span", {
    text: progressText,
    cls: "ez-reader__shelf-list__progress"
  });
  row.createEl("span", {
    text: statusLabel(entry.reading.status),
    cls: `ez-reader__status-pill is-${entry.reading.status}`
  });
  row.createEl("span", {
    text: entry.book.locator.format.toUpperCase(),
    cls: "ez-reader__shelf-list__format"
  });
  const lang = entry.book.metadata?.languages?.[0];
  if (lang) {
    row.createEl("span", { text: lang, cls: "ez-reader__shelf-list__lang" });
  }
  if (entry.reading.favorite) {
    row.createEl("span", { text: "\u2605", cls: "ez-reader__shelf-list__favorite", title: "\u5DF2\u6536\u85CF" });
  }
  if (entry.book.pinnedAt !== null) {
    row.createEl("span", { text: "\u{1F4CC}", cls: "ez-reader__shelf-list__pin", title: "\u5DF2\u7F6E\u9876 \u2014 \u53F3\u952E\u83DC\u5355\u53EF\u53D6\u6D88" });
  }
  row.addEventListener("click", () => handlers.onOpen(entry));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlers.onOpen(entry);
    }
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handlers.onContextMenu(entry, event);
  });
  return row;
};

// src/ui/shelf/ShelfView.ts
var SHELF_VIEW_TYPE = "ez-reader-shelf";
var ShelfView = class extends import_obsidian8.ItemView {
  deps;
  toolbar;
  body;
  emptyState;
  mode = "grid";
  filter = emptyFilter();
  sort = DEFAULT_SORT;
  shelfDensity = "default";
  unsubscribe;
  settingsUnsubscribe;
  promptedForFirstImport = false;
  constructor(leaf, deps) {
    super(leaf);
    this.deps = deps;
  }
  getViewType() {
    return SHELF_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u4E2A\u4EBA\u56FE\u4E66\u9986";
  }
  getIcon() {
    return "library";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ez-reader__shelf");
    this.toolbar = new ShelfToolbar(
      {
        onQueryChange: (query) => {
          this.filter = { ...this.filter, query };
          this.scheduleSearchRefresh();
        },
        onFilterOpen: () => this.openFilters(),
        onViewModeChange: (mode) => {
          this.mode = mode;
          this.renderRefresh();
        },
        onSortChange: (sort) => {
          this.sort = sort;
          this.renderRefresh();
        },
        onAddToLibrary: () => this.openAddToLibrary(),
        onAddAllToLibrary: () => void this.addAllToLibrary(),
        onCycleShelfDensity: () => void this.cycleShelfDensity()
      },
      this.toolbarState()
    );
    container.append(this.toolbar.root);
    this.bindShelfShortcuts();
    this.body = container.createDiv({ cls: "ez-reader__shelf__body" });
    this.emptyState = container.createDiv({ cls: "ez-reader__shelf__empty" });
    void this.loadAndApplyShelfDensity();
    if (this.deps.settingsStore) {
      this.settingsUnsubscribe = this.deps.settingsStore.onSettingsChanged(() => {
        void this.loadAndApplyShelfDensity();
      });
    }
    this.unsubscribe = this.deps.library.subscribe(() => this.scheduleRefresh());
    this.renderRefresh();
    this.maybePromptForFirstImport();
  }
  async loadAndApplyShelfDensity() {
    if (!this.deps.settingsStore) return;
    try {
      const settings = await this.deps.settingsStore.listSettings();
      const raw = settings.shelfDensity ?? "default";
      const density = SHELF_DENSITIES.includes(raw) ? raw : "default";
      if (density !== this.shelfDensity) {
        this.shelfDensity = density;
        this.applyShelfDensityToDom();
        this.toolbar.update(this.toolbarState());
      }
    } catch (error) {
      console.warn("[ez-reader] failed to load shelfDensity", error);
    }
  }
  applyShelfDensityToDom() {
    if (this.body) this.body.setAttribute("data-shelf-density", this.shelfDensity);
  }
  async cycleShelfDensity() {
    const next = nextShelfDensity(this.shelfDensity);
    const previous = this.shelfDensity;
    this.shelfDensity = next;
    this.applyShelfDensityToDom();
    this.toolbar.update(this.toolbarState());
    if (!this.deps.settingsStore) return;
    try {
      await this.deps.settingsStore.patchSettings((s3) => ({ ...s3, shelfDensity: next }));
    } catch (error) {
      console.warn("[ez-reader] failed to persist shelfDensity", error);
      this.shelfDensity = previous;
      this.applyShelfDensityToDom();
      this.toolbar.update(this.toolbarState());
      new import_obsidian8.Notice(`\u4FDD\u5B58\u5C01\u9762\u5BC6\u5EA6\u5931\u8D25, \u5DF2\u56DE\u6EDA\u5230 ${previous}`, 3e3);
    }
  }
  refreshTimer;
  scheduleRefresh() {
    if (this.refreshTimer !== void 0) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = void 0;
      this.renderRefresh();
    }, 100);
  }
  /** Debounced search refresh — 150ms 是用户在 <input type=search> 上能感知的
   *  最短延迟, 慢于这个就开始觉得"卡".  短于 150ms 反而像是抖动. */
  searchTimer;
  scheduleSearchRefresh() {
    if (this.searchTimer !== void 0) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = void 0;
      this.renderRefresh();
    }, 150);
  }
  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = void 0;
    this.settingsUnsubscribe?.();
    this.settingsUnsubscribe = void 0;
    if (this.refreshTimer !== void 0) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = void 0;
    }
    if (this.searchTimer !== void 0) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = void 0;
    }
    this.clearPendingG();
    if (this.shortcutsHandler !== void 0) {
      this.containerEl.removeEventListener("keydown", this.shortcutsHandler);
      this.shortcutsHandler = void 0;
    }
  }
  shortcutsHandler;
  // g g 序列状态: pendingG timer 跟一次性 capture-phase listener 提到
  // class 字段, onClose 统一清掉. 之前是闭包变量, view 关闭后 listener
  // 仍然挂在 document 上, 下一个 g 会触发已 detach view 的回调.
  pendingG;
  pendingGOnce;
  /**
   * Shelf-level keyboard shortcuts. We listen on the view container so
   * these work regardless of which child element has focus — but we bail
   * out when focus is already inside an input / textarea so the user can
   * still type freely.
   *
   * Currently bound:
   *   `/`     — focus the search box (fwd `/` into the input is allowed
   *             naturally because we bail on input-focused targets first)
   *   `g g`   — toggle grid / list view (Gmail-style prefix sequence)
   *   `f`     — open the filter modal
   *   `Esc`   — clear the active search query and refocus the shelf
   */
  bindShelfShortcuts() {
    const handler = (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        this.toolbar.focus();
        return;
      }
      if (key === "escape") {
        if (this.filter.query) {
          event.preventDefault();
          this.filter = { ...this.filter, query: "" };
          this.toolbar.setQuery("");
          this.renderRefresh();
        }
        return;
      }
      if (key === "f") {
        event.preventDefault();
        this.openFilters();
        return;
      }
      if (key === "g") {
        event.preventDefault();
        this.clearPendingG();
        this.pendingG = window.setTimeout(() => {
          this.pendingG = void 0;
          if (this.pendingGOnce) {
            document.removeEventListener("keydown", this.pendingGOnce, true);
            this.pendingGOnce = void 0;
          }
        }, 800);
        this.pendingGOnce = (next) => {
          this.clearPendingG();
          if (next.key.toLowerCase() === "g") {
            const newMode = this.mode === "grid" ? "list" : "grid";
            this.mode = newMode;
            this.renderRefresh();
          }
        };
        document.addEventListener("keydown", this.pendingGOnce, true);
      }
    };
    this.containerEl.addEventListener("keydown", handler);
    this.shortcutsHandler = handler;
  }
  /** Remove any in-flight `g g` timer and the matching capture-phase listener. */
  clearPendingG() {
    if (this.pendingG !== void 0) {
      window.clearTimeout(this.pendingG);
      this.pendingG = void 0;
    }
    if (this.pendingGOnce) {
      document.removeEventListener("keydown", this.pendingGOnce, true);
      this.pendingGOnce = void 0;
    }
  }
  toolbarState() {
    const stats = this.deps.library.stats();
    const visible = this.deps.library.list(this.filter, this.sort).length;
    return {
      mode: this.mode,
      filter: this.filter,
      sort: this.sort,
      totalCount: stats.inLibrary,
      visibleCount: visible,
      availableCount: stats.total - stats.inLibrary,
      shelfDensity: this.shelfDensity
    };
  }
  renderRefresh() {
    const entries = this.deps.library.list(this.filter, this.sort);
    this.body.empty();
    this.body.removeClass("is-grid", "is-list");
    this.body.addClass(this.mode === "grid" ? "is-grid" : "is-list");
    this.body.setAttribute("data-shelf-density", this.shelfDensity);
    if (entries.length === 0) {
      this.renderEmptyState();
    } else {
      this.emptyState.addClass("is-hidden");
      for (const entry of entries) {
        const coverPath = entry.book.coverPath ?? void 0;
        const onTogglePin = (item) => {
          void this.togglePin(item);
        };
        const node = this.mode === "grid" ? renderGridItem(entry, {
          onOpen: (item) => void this.openBook(item),
          onContextMenu: (item, event) => this.openItemMenu(item, event),
          onTogglePin
        }, coverPath) : renderListItem(entry, {
          onOpen: (item) => void this.openBook(item),
          onContextMenu: (item, event) => this.openItemMenu(item, event)
        }, coverPath);
        this.body.append(node);
      }
    }
    this.toolbar.update(this.toolbarState());
  }
  renderEmptyState() {
    this.emptyState.removeClass("is-hidden");
    this.emptyState.empty();
    const stats = this.deps.library.stats();
    const available = stats.total - stats.inLibrary;
    this.emptyState.createEl("h3", { text: "\u4E2A\u4EBA\u56FE\u4E66\u9986\u662F\u7A7A\u7684" });
    if (stats.total === 0) {
      this.emptyState.createEl("p", {
        text: "Vault \u91CC\u6CA1\u627E\u5230\u53EF\u8BC6\u522B\u7684\u7535\u5B50\u4E66\u6587\u4EF6\u3002\u8BD5\u7740\u628A EPUB\u3001PDF \u653E\u8FDB Vault\u3002\u6587\u4EF6\u9700\u653E\u5728 Vault \u5185\u4EFB\u610F\u4F4D\u7F6E\u3002"
      });
      return;
    }
    if (available === 0) {
      this.emptyState.createEl("p", {
        text: "\u6240\u6709\u53D1\u73B0\u7684\u4E66\u90FD\u5DF2\u52A0\u5165,\u4F46\u7B5B\u9009\u6761\u4EF6\u8FC7\u6EE4\u6389\u4E86\u5F53\u524D\u7ED3\u679C\u3002"
      });
      return;
    }
    this.emptyState.createEl("p", {
      text: `\u5DF2\u53D1\u73B0 ${stats.total} \u672C\u4E66,\u4F46\u8FD8\u6CA1\u6709\u52A0\u5165\u4EFB\u4F55\u4E00\u672C\u3002\u70B9\u51FB\u4E0B\u9762\u7684\u6309\u94AE\u6311\u9009\u52A0\u5165\u3002`
    });
    const add = this.emptyState.createEl("button", { text: "+ \u52A0\u5165\u4E66\u7C4D", attr: { type: "button" } });
    add.addClass("mod-cta");
    add.onclick = () => this.openAddToLibrary();
  }
  async openBook(entry) {
    try {
      await this.deps.reading.openBook(entry.book.id);
      await this.deps.openReader(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian8.Notice(`\u6253\u5F00\u300A${entry.book.metadata?.title ?? entry.book.locator.path}\u300B\u5931\u8D25: ${message}`);
      console.error("[ez-reader] openBook failed", entry.book.locator.path, error);
    }
  }
  openItemMenu(entry, event) {
    const menu = new import_obsidian8.Menu();
    menu.addItem((item) => item.setTitle("\u6253\u5F00\u9605\u8BFB\u5668").setIcon("book-open").onClick(() => void this.openBook(entry)));
    menu.addItem(
      (item) => item.setTitle("\u5728 Obsidian \u4E2D\u67E5\u770B").setIcon("file-text").onClick(() => {
        const file = this.deps.app.vault.getAbstractFileByPath(entry.book.locator.path);
        if (file instanceof import_obsidian8.TFile) void this.deps.app.workspace.openLinkText(file.path, "", true);
      })
    );
    menu.addSeparator();
    const currentStatus = entry.reading.status;
    menu.addItem(
      (item) => item.setTitle(currentStatus === "reading" ? "\u2713 \u5728\u8BFB" : "\u6807\u8BB0\u4E3A\u5728\u8BFB").setIcon("play").onClick(() => void this.setStatus(entry, "reading"))
    );
    menu.addItem(
      (item) => item.setTitle(currentStatus === "finished" ? "\u2713 \u5DF2\u8BFB\u5B8C" : "\u6807\u8BB0\u4E3A\u5DF2\u8BFB\u5B8C").setIcon("check").onClick(() => void this.setStatus(entry, "finished"))
    );
    menu.addItem(
      (item) => item.setTitle(currentStatus === "abandoned" ? "\u2713 \u6682\u5F03" : "\u6807\u8BB0\u4E3A\u6682\u5F03").setIcon("x").onClick(() => void this.setStatus(entry, "abandoned"))
    );
    menu.addItem(
      (item) => item.setTitle("\u6536\u85CF").setIcon("star").onClick(() => void this.toggleFavorite(entry))
    );
    const isPinned = entry.book.pinnedAt !== null;
    menu.addItem(
      (item) => item.setTitle(isPinned ? "\u2713 \u5DF2\u7F6E\u9876" : "\u7F6E\u9876\u5230\u6700\u524D").setIcon("pin").onClick(() => void this.togglePin(entry))
    );
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("\u4ECE\u56FE\u4E66\u9986\u79FB\u9664").setIcon("trash").setWarning(true).onClick(() => void this.removeFromLibrary(entry))
    );
    menu.showAtMouseEvent(event);
  }
  async togglePin(entry) {
    const wasPinned = entry.book.pinnedAt !== null;
    try {
      await this.deps.library.togglePin(entry.book.id);
      new import_obsidian8.Notice(wasPinned ? "\u5DF2\u53D6\u6D88\u7F6E\u9876" : "\u5DF2\u7F6E\u9876\u5230\u6700\u524D");
    } catch (error) {
      console.warn("[ez-reader] togglePin failed", error);
      new import_obsidian8.Notice("\u7F6E\u9876\u5931\u8D25");
    }
  }
  async setStatus(entry, status) {
    await this.deps.reading.setStatus(entry.book.id, status);
  }
  async toggleFavorite(entry) {
    await this.deps.reading.toggleFavorite(entry.book.id);
  }
  async removeFromLibrary(entry) {
    const title = entry.book.metadata?.title ?? entry.book.locator.path;
    const confirm = new import_obsidian8.Modal(this.deps.app);
    confirm.contentEl.createEl("h3", { text: `\u4ECE\u56FE\u4E66\u9986\u79FB\u9664\u300A${title}\u300B?` });
    confirm.contentEl.createEl("p", {
      text: "\u4E66\u5C06\u4ECE\u4E2A\u4EBA\u56FE\u4E66\u9986\u6D88\u5931\u3002\u539F\u59CB\u6587\u4EF6\u3001\u9605\u8BFB\u8FDB\u5EA6\u3001\u4E66\u7B7E\u3001\u6458\u5F55\u90FD\u4E0D\u4F1A\u5220\u9664 \u2014 \u91CD\u65B0\u52A0\u5165\u5373\u53EF\u6062\u590D\u3002"
    });
    const actions = confirm.contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancelBtn.onclick = () => confirm.close();
    const removeBtn = actions.createEl("button", { text: "\u79FB\u9664", attr: { type: "button" } });
    removeBtn.addClass("mod-warning");
    removeBtn.onclick = () => {
      confirm.close();
      void this.deps.library.removeFromLibrary(entry.book.id).then(() => {
        new import_obsidian8.Notice(`\u5DF2\u4ECE\u56FE\u4E66\u9986\u79FB\u9664\u300A${title}\u300B`);
      });
    };
    confirm.open();
  }
  openFilters() {
    const modal = new ShelfFiltersModal(this.deps.app, this.filter);
    void modal.openAndGetResult().then((next) => {
      if (next === null) return;
      this.filter = next;
      this.renderRefresh();
    });
  }
  openAddToLibrary() {
    new AddToLibraryModal(this.deps.app, this.deps.library, {
      covers: this.deps.covers,
      loader: this.deps.bookBytesLoader
    }).open();
  }
  /**
   * Bulk-add every discovered-but-unadded book. Bypasses the picker modal
   * for users who just want the whole vault's worth of EPUB/PDF on the
   * shelf. `addAllToLibrary` is idempotent so re-running is safe.
   */
  addingAll = false;
  async addAllToLibrary() {
    if (this.addingAll) return;
    const stats = this.deps.library.stats();
    if (stats.total - stats.inLibrary <= 0) return;
    this.addingAll = true;
    this.toolbar.setAddAllBusy(true);
    let timedOut = false;
    const timeoutMs = 9e4;
    const timeoutHandle = window.setTimeout(() => {
      timedOut = true;
      console.error(`[ez-reader] shelf addAllToLibrary timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    try {
      const count = await this.withTimeout(
        this.deps.library.addAllToLibrary(),
        timeoutMs,
        "shelf.addAllToLibrary"
      );
      if (count === void 0 || timedOut) {
        new import_obsidian8.Notice(timedOut ? "\u52A0\u5165\u8D85\u65F6,\u8BF7\u91CD\u8BD5" : "\u52A0\u5165\u5931\u8D25 (\u672A\u77E5)");
      } else {
        new import_obsidian8.Notice(`\u5DF2\u52A0\u5165 ${count} \u672C\u4E66\u5230\u56FE\u4E66\u9986\u3002`);
      }
    } catch (error) {
      console.error("[ez-reader] addAllToLibrary failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian8.Notice(`\u5168\u90E8\u52A0\u5165\u5931\u8D25: ${message}`);
    } finally {
      window.clearTimeout(timeoutHandle);
      this.addingAll = false;
      if (timedOut) {
        window.setTimeout(() => this.toolbar.setAddAllBusy(false), 3e3);
      } else {
        this.toolbar.setAddAllBusy(false);
      }
    }
  }
  /** Race a promise against a deadline. Returns undefined on timeout so
   *  callers can decide what to surface (Notice vs throw). */
  withTimeout(promise, ms, label) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn(`[ez-reader] ${label} exceeded ${ms}ms \u2014 leaving promise pending`);
        resolve(void 0);
      }, ms);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          console.warn(`[ez-reader] ${label} rejected`, error);
          resolve(void 0);
        }
      );
    });
  }
  /**
   * When the user opens an empty library for the first time, surface the
   * AddToLibrary modal so the empty state doesn't feel dead. We only do
   * this once per leaf to avoid nagging on every re-open.
   *
   * P1 修复: 没有 annotationStore (测试场景) 时, 用 module-level flag 而
   * 不是 instance flag 避免热重载反复弹 picker. 已 dismiss 的 vault 也不
   * 再自动开 picker (dismiss = "我已经知道, 别再打扰我").
   *
   * D5 修复: 之前 static `promptedForFirstImportWithoutStore` flag 想防热
   * 重载反复弹 picker, 但 static 字段属于类 — esbuild rebuild 重新加载
   * 类时整个 static 被重置, flag 失去作用. 实例字段 `promptedForFirstImport`
   * 已经守了一次创建, 不需要重复防. 删掉 static 字段.
   */
  maybePromptForFirstImport() {
    if (this.promptedForFirstImport) return;
    this.promptedForFirstImport = true;
    const store = this.deps.annotationStore;
    if (!store) {
      return;
    }
    void this.runOnboarding(store);
  }
  /**
   * First-launch onboarding. 顺序:
   * 1. 检查持久化的 dismissed 标志, 已 dismiss 就完全跳过.
   * 2. 显示 OnboardingModal — 解释插件 + 给"开始加书"按钮.
   * 3. 任何路径 (选择 / 关闭) 都写 dismissed=true, 避免重复打扰.
   *
   * 用户点 OnboardingModal 的"开始加书"按钮 → 直接开 AddToLibraryModal
   * 串起来, 首次体验连贯: 解释 → 进入加书流程.
   */
  async runOnboarding(store) {
    let alreadyDismissed = false;
    try {
      alreadyDismissed = await store.hasOnboardingBeenDismissed();
    } catch (error) {
      console.warn("[ez-reader] onboarding check failed", error);
      alreadyDismissed = false;
    }
    if (alreadyDismissed) return;
    let choice = null;
    try {
      choice = await new OnboardingModal(this.deps.app).openAndWait();
    } catch (error) {
      console.warn("[ez-reader] onboarding modal failed", error);
    }
    try {
      await store.markOnboardingDismissed();
    } catch (error) {
      console.warn("[ez-reader] could not persist onboarding dismissal", error);
    }
    if (choice === "addBooks") {
      this.openAddToLibrary();
    }
  }
};

// src/ui/reader/ReaderView.ts
var import_obsidian16 = require("obsidian");

// src/ui/reader/chineseSelectionExpansion.ts
var STOP_CHARS = ["\u3002", "\uFF01", "\uFF1F", "!", "?", ";", "\uFF1B", ",", "\uFF0C", "\n"];
var shouldExpand = (raw) => {
  const minLength = 12;
  if (raw.length >= minLength) return false;
  return Array.from(raw).some((ch) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch));
};
var expandToBoundary = (raw, context, options = {}) => {
  if (!shouldExpand(raw)) return raw;
  const window2 = options.window ?? 120;
  const idx = context.indexOf(raw);
  if (idx < 0) return raw;
  const windowStart = Math.max(0, idx - window2);
  const before = context.slice(windowStart, idx);
  const after = context.slice(idx + raw.length, Math.min(context.length, idx + raw.length + window2));
  const leftStop = lastStop(before);
  const rightStop = firstStop(after);
  if (leftStop < 0 && rightStop < 0) return raw;
  const leftExpanded = leftStop >= 0 ? before.slice(leftStop + 1) : "";
  const rightExpanded = rightStop >= 0 ? after.slice(0, rightStop + 1) : "";
  return (leftExpanded + raw + rightExpanded).trim();
};
var lastStop = (s3) => {
  let best = -1;
  for (const stop of STOP_CHARS) {
    const i3 = s3.lastIndexOf(stop);
    if (i3 > best) best = i3;
  }
  return best;
};
var firstStop = (s3) => {
  let best = -1;
  let found = -1;
  for (const stop of STOP_CHARS) {
    const i3 = s3.indexOf(stop);
    if (i3 >= 0 && (found < 0 || i3 < found)) {
      found = i3;
      best = i3;
    }
  }
  return best;
};
var expandWithCap = (raw, context, cap, options = {}) => {
  const expanded = expandToBoundary(raw, context, options);
  const trimmed = expanded.trim();
  if (trimmed.length > cap || trimmed.length <= raw.length) return raw;
  return trimmed;
};

// src/ui/reader/AppearanceModal.ts
var import_obsidian9 = require("obsidian");
var FONT_SIZE_MIN = 60;
var FONT_SIZE_MAX = 200;
var LINE_HEIGHT_MIN = 1;
var LINE_HEIGHT_MAX = 2.4;
var MARGIN_MIN = 0;
var MARGIN_MAX = 80;
var LETTER_SPACING_MIN = 0;
var LETTER_SPACING_MAX = 0.1;
var MAX_WIDTH_MIN = 480;
var MAX_WIDTH_MAX = 1200;
var THEMES = ["system", "light", "dark", "sepia"];
var FONT_FAMILIES = ["sans", "serif", "mono", "song", "kai"];
var themeLabel = (theme) => {
  switch (theme) {
    case "light":
      return "\u767D";
    case "dark":
      return "\u9ED1";
    case "sepia":
      return "\u7C73\u9EC4";
    default:
      return "\u7CFB\u7EDF";
  }
};
var AppearanceModal = class extends import_obsidian9.Modal {
  resolver = null;
  initial;
  fontSizeInput;
  fontSizeValue;
  lineHeightInput;
  lineHeightValue;
  marginInput;
  marginValue;
  themeButtons = /* @__PURE__ */ new Map();
  fontFamilyButtons = /* @__PURE__ */ new Map();
  letterSpacingInput;
  letterSpacingValue;
  maxWidthInput;
  maxWidthValue;
  chosenTheme;
  chosenFontFamily;
  constructor(app, initial) {
    super(app);
    this.initial = initial;
    this.chosenTheme = initial.theme;
    this.chosenFontFamily = initial.fontFamily ?? "serif";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__appearance-modal");
    contentEl.createEl("h3", { text: "\u9605\u8BFB\u5916\u89C2" });
    const fontRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    fontRow.createEl("label", { text: "\u5B57\u53F7" });
    this.fontSizeInput = fontRow.createEl("input", { attr: { type: "range", min: String(FONT_SIZE_MIN), max: String(FONT_SIZE_MAX), step: "5" } });
    this.fontSizeInput.value = String(this.initial.fontSize);
    this.fontSizeValue = fontRow.createEl("span", { text: `${this.initial.fontSize}%` });
    this.fontSizeInput.addEventListener("input", () => {
      this.fontSizeValue.setText(`${this.fontSizeInput.value}%`);
    });
    const lineRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    lineRow.createEl("label", { text: "\u884C\u8DDD" });
    this.lineHeightInput = lineRow.createEl("input", { attr: { type: "range", min: String(LINE_HEIGHT_MIN), max: String(LINE_HEIGHT_MAX), step: "0.1" } });
    this.lineHeightInput.value = String(this.initial.lineHeight);
    this.lineHeightValue = lineRow.createEl("span", { text: this.initial.lineHeight.toFixed(1) });
    this.lineHeightInput.addEventListener("input", () => {
      this.lineHeightValue.setText(Number(this.lineHeightInput.value).toFixed(1));
    });
    const marginRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    marginRow.createEl("label", { text: "\u9875\u8FB9\u8DDD" });
    this.marginInput = marginRow.createEl("input", { attr: { type: "range", min: String(MARGIN_MIN), max: String(MARGIN_MAX), step: "4" } });
    this.marginInput.value = String(this.initial.margin);
    this.marginValue = marginRow.createEl("span", { text: `${this.initial.margin}px` });
    this.marginInput.addEventListener("input", () => {
      this.marginValue.setText(`${this.marginInput.value}px`);
    });
    const themeRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    themeRow.createEl("label", { text: "\u4E3B\u9898" });
    const themeWrap = themeRow.createDiv({ cls: "ez-reader__appearance-modal__themes" });
    for (const theme of THEMES) {
      const btn = themeWrap.createEl("button", { text: themeLabel(theme), attr: { type: "button" } });
      btn.addClass("ez-reader__pill");
      btn.toggleClass("is-active", theme === this.chosenTheme);
      btn.addEventListener("click", () => {
        this.chosenTheme = theme;
        for (const [other, otherBtn] of this.themeButtons) {
          otherBtn.toggleClass("is-active", other === theme);
        }
      });
      this.themeButtons.set(theme, btn);
    }
    const fontFamilyRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    fontFamilyRow.createEl("label", { text: "\u5B57\u4F53" });
    const fontFamilyWrap = fontFamilyRow.createDiv({ cls: "ez-reader__appearance-modal__font-families" });
    for (const family of FONT_FAMILIES) {
      const btn = fontFamilyWrap.createEl("button", { text: READER_FONT_FAMILY_LABELS[family], attr: { type: "button" } });
      btn.addClass("ez-reader__pill", `ez-reader__pill--font-${family}`);
      btn.toggleClass("is-active", family === this.chosenFontFamily);
      btn.addEventListener("click", () => {
        this.chosenFontFamily = family;
        for (const [other, otherBtn] of this.fontFamilyButtons) {
          otherBtn.toggleClass("is-active", other === family);
        }
      });
      this.fontFamilyButtons.set(family, btn);
    }
    const letterSpacingRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    letterSpacingRow.createEl("label", { text: "\u5B57\u95F4\u8DDD" });
    const initialLetterSpacing = this.initial.letterSpacing ?? 0;
    this.letterSpacingInput = letterSpacingRow.createEl("input", {
      attr: { type: "range", min: String(LETTER_SPACING_MIN), max: String(LETTER_SPACING_MAX), step: "0.01" }
    });
    this.letterSpacingInput.value = String(initialLetterSpacing);
    this.letterSpacingValue = letterSpacingRow.createEl("span", { text: `${initialLetterSpacing.toFixed(2)}em` });
    this.letterSpacingInput.addEventListener("input", () => {
      this.letterSpacingValue.setText(`${Number(this.letterSpacingInput.value).toFixed(2)}em`);
    });
    const maxWidthRow = contentEl.createDiv({ cls: "ez-reader__appearance-modal__row" });
    maxWidthRow.createEl("label", { text: "\u6587\u672C\u5BBD\u5EA6" });
    const initialMaxWidth = this.initial.maxWidth ?? 720;
    this.maxWidthInput = maxWidthRow.createEl("input", {
      attr: { type: "range", min: String(MAX_WIDTH_MIN), max: String(MAX_WIDTH_MAX), step: "20" }
    });
    this.maxWidthInput.value = String(initialMaxWidth);
    this.maxWidthValue = maxWidthRow.createEl("span", { text: `${initialMaxWidth}px` });
    this.maxWidthInput.addEventListener("input", () => {
      this.maxWidthValue.setText(`${this.maxWidthInput.value}px`);
    });
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.cancel());
    const confirm = actions.createEl("button", { text: "\u786E\u8BA4", attr: { type: "button" } });
    confirm.addClass("mod-cta");
    confirm.addEventListener("click", () => this.confirm());
  }
  /**
   * Resolves to the chosen appearance, or null if the user cancelled (or
   * closed via Esc / overlay click).
   */
  openAndWait() {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }
  confirm() {
    const resolver = this.resolver;
    this.resolver = null;
    const appearance = {
      fontSize: Number(this.fontSizeInput.value),
      lineHeight: Number(this.lineHeightInput.value),
      margin: Number(this.marginInput.value),
      theme: this.chosenTheme,
      flow: this.initial.flow,
      fontFamily: this.chosenFontFamily,
      letterSpacing: Number(this.letterSpacingInput.value),
      maxWidth: Number(this.maxWidthInput.value)
    };
    this.close();
    resolver?.(appearance);
  }
  cancel() {
    const resolver = this.resolver;
    this.resolver = null;
    this.close();
    resolver?.(null);
  }
  onClose() {
    if (this.resolver) {
      const resolver = this.resolver;
      this.resolver = null;
      resolver(null);
    }
  }
};

// src/ui/reader/BookmarksPanel.ts
var BookmarksPanel = class {
  root;
  handlers;
  bookmarks = [];
  constructor(handlers, host) {
    this.handlers = handlers;
    this.root = host.createDiv({ cls: "ez-reader__reader-panel is-hidden" });
    this.render();
  }
  setBookmarks(bookmarks) {
    this.bookmarks = bookmarks;
    this.render();
  }
  show() {
    this.root.removeClass("is-hidden");
  }
  hide() {
    this.root.addClass("is-hidden");
  }
  isVisible() {
    return !this.root.hasClass("is-hidden");
  }
  render() {
    this.root.empty();
    const headerRow = this.root.createDiv({ cls: "ez-reader__panel-header" });
    const titleRow = headerRow.createDiv({ cls: "ez-reader__panel-header-title" });
    titleRow.createEl("h3", { text: "\u4E66\u7B7E" });
    titleRow.createSpan({
      text: `(${this.bookmarks.length})`,
      cls: "ez-reader__panel-header-count"
    });
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u5173\u95ED\u9762\u677F (Esc)", "aria-label": "\u5173\u95ED\u9762\u677F" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
    if (this.bookmarks.length === 0) {
      this.root.createDiv({ cls: "ez-reader__reader-panel__empty", text: "\u672C\u4E66\u8FD8\u6CA1\u6709\u4E66\u7B7E\u3002" });
      return;
    }
    const ordered = [...this.bookmarks].sort((a3, b3) => b3.createdAt - a3.createdAt);
    for (const bookmark of ordered) {
      const row = this.root.createDiv({ cls: "ez-reader__bookmark-row" });
      const contextLine = row.createDiv({ cls: "ez-reader__bookmark-row__context" });
      if (bookmark.locator.chapter) {
        contextLine.createSpan({
          text: bookmark.locator.chapter,
          cls: "ez-reader__bookmark-row__chapter"
        });
      }
      const fraction = bookmark.locator.position.kind === "reflow" ? bookmark.locator.position.fraction : bookmark.locator.position.kind === "text" ? bookmark.locator.position.fraction : 0;
      contextLine.createSpan({
        text: `${Math.round(fraction * 100)}%`,
        cls: "ez-reader__bookmark-row__fraction"
      });
      contextLine.createSpan({
        text: new Date(bookmark.createdAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        cls: "ez-reader__bookmark-row__time"
      });
      const actionRow = row.createDiv({ cls: "ez-reader__bookmark-row__action-row" });
      const jump = actionRow.createEl("button", {
        text: bookmark.label || "\u672A\u547D\u540D\u4E66\u7B7E",
        attr: { type: "button", title: bookmark.locator.chapter ? `\u8DF3\u5230 ${bookmark.locator.chapter} (${Math.round(fraction * 100)}%)` : "\u8DF3\u5230\u6B64\u4E66\u7B7E" }
      });
      jump.addClass("ez-reader__bookmark-row__jump");
      jump.onclick = () => this.handlers.onJump(bookmark);
      const remove = actionRow.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u5220\u9664\u4E66\u7B7E", "aria-label": "\u5220\u9664\u4E66\u7B7E" }
      });
      remove.addClass("ez-reader__bookmark-row__remove");
      remove.onclick = () => this.handlers.onRemove(bookmark);
    }
  }
};

// src/ui/reader/ConfirmModal.ts
var import_obsidian10 = require("obsidian");
var ConfirmModal = class extends import_obsidian10.Modal {
  constructor(app, title, message, confirmLabel = "\u786E\u5B9A", cancelLabel = "\u53D6\u6D88") {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.cancelLabel = cancelLabel;
  }
  resolver = null;
  openAndWait() {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: this.cancelLabel, attr: { type: "button" } });
    cancel.onclick = () => {
      const r3 = this.resolver;
      this.resolver = null;
      this.close();
      r3?.(false);
    };
    const confirm = actions.createEl("button", { text: this.confirmLabel, attr: { type: "button" } });
    confirm.addClass("mod-warning");
    confirm.onclick = () => {
      const r3 = this.resolver;
      this.resolver = null;
      this.close();
      r3?.(true);
    };
    window.setTimeout(() => confirm.focus(), 0);
  }
  onClose() {
    if (this.resolver) {
      const r3 = this.resolver;
      this.resolver = null;
      r3?.(false);
    }
  }
};

// src/ui/reader/ExcerptsPanel.ts
var ExcerptsPanel = class {
  root;
  handlers;
  app;
  excerpts = [];
  constructor(handlers, host) {
    this.handlers = handlers;
    this.app = handlers.app ?? null;
    this.root = host.createDiv({ cls: "ez-reader__reader-panel is-hidden" });
    this.render();
  }
  setExcerpts(excerpts) {
    this.excerpts = excerpts;
    this.render();
  }
  show() {
    this.root.removeClass("is-hidden");
  }
  hide() {
    this.root.addClass("is-hidden");
  }
  isVisible() {
    return !this.root.hasClass("is-hidden");
  }
  render() {
    this.root.empty();
    const headerRow = this.root.createDiv({ cls: "ez-reader__panel-header" });
    const titleRow = headerRow.createDiv({ cls: "ez-reader__panel-header-title" });
    titleRow.createEl("h3", { text: "\u6458\u5F55" });
    titleRow.createSpan({
      text: `(${this.excerpts.length})`,
      cls: "ez-reader__panel-header-count"
    });
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u5173\u95ED\u9762\u677F (Esc)", "aria-label": "\u5173\u95ED\u9762\u677F" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
    if (this.excerpts.length === 0) {
      this.root.createDiv({ cls: "ez-reader__reader-panel__empty", text: "\u672C\u4E66\u8FD8\u6CA1\u6709\u6458\u5F55\u3002" });
      return;
    }
    const ordered = [...this.excerpts].sort((a3, b3) => b3.createdAt - a3.createdAt);
    for (const excerpt of ordered) {
      const card = this.root.createDiv({ cls: "ez-reader__excerpt-card" });
      const metaLine = card.createDiv({ cls: "ez-reader__excerpt-card__meta" });
      if (excerpt.locator.chapter) {
        metaLine.createSpan({
          text: excerpt.locator.chapter,
          cls: "ez-reader__excerpt-card__chapter"
        });
      }
      const ts = new Date(excerpt.createdAt).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      metaLine.createSpan({ text: ts, cls: "ez-reader__excerpt-card__time" });
      if (excerpt.text && excerpt.text.trim()) {
        const quote = card.createEl("blockquote", {
          text: excerpt.text,
          cls: "ez-reader__excerpt-card__quote"
        });
        quote.setAttribute("title", excerpt.text);
      } else {
        const placeholder = card.createDiv({
          cls: "ez-reader__excerpt-card__thought-badge"
        });
        placeholder.setText("\u{1F4AD} \u81EA\u7531\u60F3\u6CD5");
      }
      if (excerpt.note) {
        card.createEl("p", {
          text: excerpt.note,
          cls: "ez-reader__excerpt-card__note"
        });
      }
      if (excerpt.tags.length > 0) {
        const tagsLine = card.createDiv({ cls: "ez-reader__excerpt-card__tags" });
        for (const tag of excerpt.tags) {
          tagsLine.createSpan({ text: `#${tag}`, cls: "ez-reader__excerpt-card__tag" });
        }
      }
      const actions = card.createDiv({ cls: "ez-reader__excerpt-card__actions" });
      const jump = actions.createEl("button", {
        text: "\u8DF3\u5230\u539F\u6587",
        attr: { type: "button", title: "\u8DF3\u5230\u6458\u5F55\u6240\u5728\u4F4D\u7F6E", "aria-label": "\u8DF3\u5230\u539F\u6587" }
      });
      jump.addClass("ez-reader__excerpt-card__btn");
      jump.onclick = () => this.handlers.onJump(excerpt);
      const remove = actions.createEl("button", {
        text: "\u5220\u9664",
        attr: { type: "button", title: "\u5220\u9664\u6458\u5F55(\u7B14\u8BB0 / \u9AD8\u4EAE\u4E5F\u4F1A\u5220\u9664)", "aria-label": "\u5220\u9664\u6458\u5F55" }
      });
      remove.addClass("ez-reader__excerpt-card__btn");
      remove.addClass("ez-reader__excerpt-card__btn--danger");
      remove.onclick = async () => {
        const doRemove = async () => this.handlers.onRemove(excerpt);
        if (this.app) {
          const ok = await new ConfirmModal(
            this.app,
            "\u5220\u9664\u8FD9\u6761\u6458\u5F55?",
            "\u7B14\u8BB0 + \u9AD8\u4EAE\u4E5F\u4F1A\u5220\u9664\u3002\u8FDB\u5EA6\u3001\u4E66\u7B7E\u3001\u5176\u5B83\u7B14\u8BB0\u4E0D\u53D7\u5F71\u54CD\u3002",
            "\u5220\u9664"
          ).openAndWait();
          if (ok) await doRemove();
        } else {
          await doRemove();
        }
      };
    }
  }
};

// src/ui/reader/ReaderSelectionMenu.ts
init_selectionMenuPosition();
var ReaderSelectionMenu = class {
  root;
  handlers;
  currentRect = null;
  documentMouseDown;
  documentSelectionChange;
  constructor(handlers, hints) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__selection-menu");
    this.root.addClass("is-hidden");
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "\u9009\u4E2D\u6587\u672C\u64CD\u4F5C");
    const make = (label, title, key, shortcut, primary = false) => {
      const btn = this.root.createEl("button", {
        text: label,
        attr: { type: "button", title, "aria-label": title, "aria-keyshortcuts": key }
      });
      if (primary) btn.addClass("is-primary");
      if (shortcut) {
        const hint = btn.createSpan({
          text: shortcut,
          cls: "ez-reader__selection-menu__hint"
        });
        hint.setAttribute("aria-hidden", "true");
      }
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
        const sel = document.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
        this.handlers[key]();
      });
      return btn;
    };
    make("\u60F3\u6CD5", "\u4E3A\u8FD9\u6BB5\u6587\u5B57\u5199\u60F3\u6CD5(\u81EA\u52A8\u8BB0\u5230\u4FA7\u8FB9\u680F\u7B14\u8BB0)", "onThought", hints?.thought, true);
    make("\u6458\u5F55", "\u4FDD\u5B58\u4E3A\u6458\u5F55(\u9AD8\u4EAE + \u7B14\u8BB0)", "onExcerpt", hints?.excerpt);
    make("\u7FFB\u8BD1", "\u8C03\u7528\u7FFB\u8BD1\u670D\u52A1\u7FFB\u8BD1\u8FD9\u6BB5\u6587\u5B57", "onTranslate", hints?.translate);
    make("\u590D\u5236", "\u590D\u5236\u5230\u526A\u8D34\u677F", "onCopy", hints?.copy);
    document.body.append(this.root);
    this.documentMouseDown = (event) => {
      if (this.root.contains(event.target)) return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) return;
      this.hide();
    };
    this.documentSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) {
        this.hide();
      }
    };
    document.addEventListener("mousedown", this.documentMouseDown);
    document.addEventListener("selectionchange", this.documentSelectionChange);
  }
  show(rect, hostOffset) {
    const adjusted = hostOffset ? offsetRect(rect, hostOffset.x, hostOffset.y) : rect;
    this.currentRect = adjusted;
    this.root.removeClass("is-hidden");
    const menuRect = this.root.getBoundingClientRect();
    const pos = computeSelectionMenuPosition(adjusted, menuRect, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    this.root.style.top = `${pos.top}px`;
    this.root.style.left = `${pos.left}px`;
  }
  hide() {
    this.currentRect = null;
    this.root.addClass("is-hidden");
  }
  isVisible() {
    return this.currentRect !== null;
  }
  destroy() {
    document.removeEventListener("mousedown", this.documentMouseDown);
    document.removeEventListener("selectionchange", this.documentSelectionChange);
    this.root.remove();
  }
};
var offsetRect = (rect, dx, dy) => {
  return new DOMRect(rect.left + dx, rect.top + dy, rect.width, rect.height);
};

// src/ui/reader/ReaderToolbar.ts
var import_obsidian11 = require("obsidian");
var ReaderToolbar = class {
  root;
  handlers;
  fractionInput;
  fractionValue;
  chapterLabel;
  statusPill;
  favoriteButton;
  bookmarkToggle;
  excerptToggle;
  bookmarkBadge;
  excerptBadge;
  fontButton;
  /** 目录按钮挪到 toolbar 最左 (`tocLeft`), 不再 render 在 actions group.
   *  field 保留让 update() 仍能 sync is-active state (无 DOM 时 no-op). */
  tocToggle;
  notesToggle;
  immersiveToggle;
  searchButton;
  searchBadge;
  pageLabel;
  readingTimeLabel;
  /**
   * 用户正在拖动进度条时为 true. 期间不走 relocate 回写 (会抖动),
   * 也不二次触发 progress change (input 事件已经触发了).
   */
  isDragging = false;
  constructor(handlers, initial) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__reader-toolbar");
    const tocLeft = this.root.createEl("button", { attr: { type: "button", title: "\u663E\u793A\u76EE\u5F55 (T)", "aria-label": "\u76EE\u5F55" } });
    tocLeft.addClass("ez-reader__reader-toolbar__toc-left");
    (0, import_obsidian11.setIcon)(tocLeft, "list");
    tocLeft.addEventListener("click", () => handlers.onToggleToc());
    this.statusPill = this.root.createEl("button", {
      text: "\u5728\u8BFB",
      attr: { type: "button", title: "\u70B9\u51FB\u5207\u6362\u9605\u8BFB\u72B6\u6001", "aria-label": "\u9605\u8BFB\u72B6\u6001" }
    });
    this.statusPill.addClass("ez-reader__status-pill", "is-clickable");
    this.statusPill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onCycleStatus();
    });
    this.favoriteButton = this.root.createEl("button", {
      text: "\u2605",
      attr: { type: "button", title: "\u6536\u85CF / \u53D6\u6D88\u6536\u85CF", "aria-label": "\u6536\u85CF" }
    });
    this.favoriteButton.addClass("ez-reader__reader-toolbar__favorite-btn", "is-clickable");
    this.favoriteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onToggleFavorite();
    });
    const navGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__nav-group" });
    const navLabel = navGroup.createDiv({ cls: "ez-reader__reader-toolbar__nav-label" });
    this.chapterLabel = navLabel.createEl("span", { text: "" });
    this.chapterLabel.addClass("ez-reader__reader-toolbar__chapter");
    const navRow = navGroup.createDiv({ cls: "ez-reader__reader-toolbar__nav-row" });
    const prev = navRow.createEl("button", { text: "\u25C0", attr: { type: "button", title: "\u4E0A\u4E00\u9875", "aria-label": "\u4E0A\u4E00\u9875" } });
    prev.addClass("ez-reader__reader-toolbar__nav");
    prev.addEventListener("click", () => handlers.onPrev());
    this.fractionInput = navRow.createEl("input", {
      attr: { type: "range", min: "0", max: "1000", step: "1", title: "\u8DF3\u8F6C\u9605\u8BFB\u8FDB\u5EA6", "aria-label": "\u8FDB\u5EA6" }
    });
    this.fractionInput.addClass("ez-reader__reader-toolbar__progress");
    this.fractionInput.addEventListener("input", () => {
      const fraction = Number(this.fractionInput.value) / 1e3;
      this.fractionValue.setText(`${Math.round(clampFraction(fraction) * 100)}%`);
    });
    this.fractionInput.addEventListener("pointerdown", () => {
      this.isDragging = true;
      window.setTimeout(() => {
        this.isDragging = false;
      }, 5e3);
    });
    const endDrag = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      const fraction = Number(this.fractionInput.value) / 1e3;
      handlers.onProgressChange(clampFraction(fraction));
    };
    this.fractionInput.addEventListener("pointerup", endDrag);
    this.fractionInput.addEventListener("pointercancel", endDrag);
    this.fractionInput.addEventListener("change", () => {
      endDrag();
    });
    const next = navRow.createEl("button", { text: "\u25B6", attr: { type: "button", title: "\u4E0B\u4E00\u9875", "aria-label": "\u4E0B\u4E00\u9875" } });
    next.addClass("ez-reader__reader-toolbar__nav");
    next.addEventListener("click", () => handlers.onNext());
    this.fractionValue = navRow.createEl("span", { text: "0%" });
    this.fractionValue.addClass("ez-reader__reader-toolbar__progress-value");
    this.tocMarkersBar = navGroup.createDiv({ cls: "ez-reader__reader-toolbar__toc-markers" });
    const actionsGroup = this.root.createDiv({ cls: "ez-reader__reader-toolbar__group ez-reader__reader-toolbar__actions" });
    const addBookmark = actionsGroup.createEl("button", { text: "+\u4E66\u7B7E", attr: { type: "button", title: "\u6DFB\u52A0\u4E66\u7B7E", "aria-label": "\u6DFB\u52A0\u4E66\u7B7E", "data-shortcut": "add-bookmark" } });
    addBookmark.addClass("ez-reader__reader-toolbar__action");
    addBookmark.addEventListener("click", () => handlers.onAddBookmark());
    this.searchButton = actionsGroup.createEl("button", { attr: { type: "button", title: "\u641C\u7D22 (/)", "aria-label": "\u641C\u7D22", "data-shortcut": "search" } });
    this.searchButton.addClass("ez-reader__reader-toolbar__action", "ez-reader__reader-toolbar__search-btn");
    (0, import_obsidian11.setIcon)(this.searchButton, "search");
    this.searchBadge = this.searchButton.createEl("span", { cls: "ez-reader__reader-toolbar__badge ez-reader__reader-toolbar__search-badge" });
    this.searchBadge.addClass("is-hidden");
    this.searchBadge.setText("");
    this.searchButton.addEventListener("click", () => {
      if (this.currentSearchOpen) handlers.onCloseSearch?.();
      else handlers.onOpenSearch?.();
    });
    this.pageLabel = navRow.createEl("span", { text: "", cls: "ez-reader__reader-toolbar__page-label" });
    this.pageLabel.addClass("is-hidden");
    this.readingTimeLabel = navGroup.createEl("span", { text: "", cls: "ez-reader__reader-toolbar__reading-time" });
    this.readingTimeLabel.addClass("is-hidden");
    this.fontButton = actionsGroup.createEl("button", { text: "Aa", attr: { type: "button", title: "\u5B57\u53F7 / \u884C\u8DDD / \u4E3B\u9898", "aria-label": "\u5B57\u53F7 / \u884C\u8DDD / \u4E3B\u9898", "data-shortcut": "font" } });
    this.fontButton.addClass("ez-reader__reader-toolbar__action");
    this.fontButton.addEventListener("click", () => handlers.onShowFontSettings());
    this.notesToggle = actionsGroup.createEl("button", { text: "\u7B14\u8BB0", attr: { type: "button", title: "\u663E\u793A\u7B14\u8BB0\u4FA7\u8FB9\u680F (S)", "aria-label": "\u7B14\u8BB0", "data-shortcut": "notes" } });
    this.notesToggle.addClass("ez-reader__reader-toolbar__action");
    this.notesToggle.addEventListener("click", () => handlers.onToggleNotes());
    this.immersiveToggle = actionsGroup.createEl("button", { text: "\u6C89\u6D78", attr: { type: "button", title: "\u5207\u6362\u6C89\u6D78\u6A21\u5F0F (Shift+F, Pad \u5168\u5C4F)", "aria-label": "\u6C89\u6D78\u6A21\u5F0F", "data-shortcut": "immersive" } });
    this.immersiveToggle.addClass("ez-reader__reader-toolbar__action");
    this.immersiveToggle.addEventListener("click", () => handlers.onToggleImmersive());
    this.excerptToggle = actionsGroup.createEl("button", { text: "\u6458\u5F55", attr: { type: "button", title: "\u663E\u793A\u6458\u5F55", "aria-label": "\u6458\u5F55", "data-shortcut": "excerpt" } });
    this.excerptToggle.addClass("ez-reader__reader-toolbar__action");
    this.excerptBadge = this.excerptToggle.createEl("span", { cls: "ez-reader__reader-toolbar__badge", text: "" });
    this.excerptBadge.addClass("is-hidden");
    this.excerptToggle.addEventListener("click", () => handlers.onToggleExcerpts());
    this.bookmarkToggle = actionsGroup.createEl("button", { text: "\u4E66\u7B7E", attr: { type: "button", title: "\u663E\u793A\u4E66\u7B7E", "aria-label": "\u4E66\u7B7E", "data-shortcut": "bookmarks" } });
    this.bookmarkToggle.addClass("ez-reader__reader-toolbar__action");
    this.bookmarkBadge = this.bookmarkToggle.createEl("span", { cls: "ez-reader__reader-toolbar__badge", text: "" });
    this.bookmarkBadge.addClass("is-hidden");
    this.bookmarkToggle.addEventListener("click", () => handlers.onToggleBookmarks());
    const close = this.root.createEl("button", { attr: { type: "button", title: "\u5173\u95ED\u9605\u8BFB\u5668", "aria-label": "\u5173\u95ED" } });
    close.addClass("ez-reader__reader-toolbar__close");
    (0, import_obsidian11.setIcon)(close, "x");
    close.addEventListener("click", () => handlers.onClose());
    this.update(initial);
  }
  update(state) {
    if (!this.isDragging) {
      this.fractionInput.value = String(Math.round(state.fraction * 1e3));
    }
    this.fractionValue.setText(`${Math.round(state.fraction * 100)}%`);
    this.chapterLabel.setText(state.chapter);
    this.statusPill.setText(statusLabel(state.status));
    this.statusPill.removeClass("is-reading", "is-finished", "is-abandoned", "is-unread");
    this.statusPill.addClass(`is-${state.status}`);
    this.favoriteButton.toggleClass("is-favorite", state.favorite === true);
    this.favoriteButton.setText(state.favorite ? "\u2605" : "\u2606");
    this.bookmarkToggle.toggleClass("is-active", state.showingBookmarks);
    this.excerptToggle.toggleClass("is-active", state.showingExcerpts);
    this.tocToggle?.toggleClass("is-active", state.showingToc);
    this.notesToggle.toggleClass("is-active", state.showingNotes);
    this.immersiveToggle.toggleClass("is-active", state.showingImmersive);
    this.fontButton.toggleClass("is-hidden", state.showFontSettings !== true);
    this.updateBadge(this.bookmarkBadge, state.bookmarkCount);
    this.updateBadge(this.excerptBadge, state.excerptCount);
    this.updateTocMarkers(state.tocMarkers);
    this.currentSearchOpen = state.searchOpen === true;
    this.searchButton.toggleClass("is-active", this.currentSearchOpen);
    this.updateSearchBadge(state.searchMatchCount);
    const cur = state.currentPage;
    const total = state.totalPages;
    if (typeof cur === "number" && typeof total === "number" && total > 0) {
      this.pageLabel.removeClass("is-hidden");
      this.pageLabel.setText(`${cur} / ${total}`);
    } else {
      this.pageLabel.addClass("is-hidden");
    }
    const totalMs = state.totalReadingMs ?? 0;
    if (totalMs >= 6e4) {
      this.readingTimeLabel.removeClass("is-hidden");
      this.readingTimeLabel.setText(formatReadingTime(totalMs));
    } else {
      this.readingTimeLabel.addClass("is-hidden");
    }
  }
  /** Show a small number badge on a button. Hide when 0/undefined. */
  updateBadge(el, count) {
    if (typeof count !== "number" || count <= 0) {
      el.addClass("is-hidden");
      el.setText("");
      return;
    }
    el.removeClass("is-hidden");
    el.setText(count > 99 ? "99+" : String(count));
  }
  /** Search badge — 命中数 0 也显示 (告诉用户没找到), null/undefined 隐藏. */
  currentSearchOpen = false;
  /** P2: 章节标记条容器, 详见构造函数. */
  tocMarkersBar;
  updateSearchBadge(count) {
    if (typeof count !== "number") {
      this.searchBadge.addClass("is-hidden");
      this.searchBadge.setText("");
      return;
    }
    this.searchBadge.removeClass("is-hidden");
    if (count > 999) this.searchBadge.setText("999+");
    else this.searchBadge.setText(String(count));
  }
  /**
   * P2: 重渲染章节标记条. 用 innerHTML 一次性重建 — 标记数量通常 < 50,
   * 没有性能问题; 比 diff 简单.
   * 注: markers 是 ReadonlyArray, 元素里 fraction 必须在 0..1 范围内.
   */
  updateTocMarkers(markers) {
    if (!this.tocMarkersBar) return;
    const bar = this.tocMarkersBar;
    bar.empty();
    if (!markers || markers.length === 0) {
      bar.addClass("is-empty");
      return;
    }
    bar.removeClass("is-empty");
    for (const marker of markers) {
      const frac = Math.max(0, Math.min(1, marker.fraction));
      if (frac === 0 || frac === 1) continue;
      const dot = bar.createEl("button", {
        attr: {
          type: "button",
          "data-toc-id": marker.id,
          title: marker.label,
          "aria-label": `\u8DF3\u5230 ${marker.label}`,
          style: `left: ${frac * 100}%`
        }
      });
      dot.addClass("ez-reader__reader-toolbar__toc-marker");
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onJumpToc?.(marker.id);
      });
    }
  }
};
var clampFraction = (value) => Math.max(0, Math.min(1, value));
var formatReadingTime = (ms) => {
  const minutes = Math.floor(ms / 6e4);
  if (minutes < 60) return `${minutes} \u5206\u949F`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes - hours * 60;
  if (remainingMinutes === 0) return `${hours} \u5C0F\u65F6`;
  return `${hours} \u5C0F\u65F6 ${remainingMinutes} \u5206`;
};

// src/ui/reader/SearchBar.ts
var SearchBar = class {
  root;
  handlers;
  input;
  currentQuery = "";
  isVisible = false;
  // C5 修复: show() 里 50ms 延迟 focus 的 setTimeout handle, 让 destroy() clear.
  focusTimer;
  documentKeydown;
  inputKeydown;
  constructor(handlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.addClass("ez-reader__search-bar");
    this.root.addClass("is-hidden");
    this.root.setAttribute("role", "search");
    this.root.setAttribute("aria-label", "\u641C\u7D22\u4E66\u5185\u6587\u5B57");
    this.input = this.root.createEl("input", {
      attr: { type: "search", placeholder: "\u641C\u7D22\u4E66\u5185\u6587\u5B57\u2026\u2026", "aria-label": "\u641C\u7D22" }
    });
    this.input.addClass("ez-reader__search-bar__input");
    const nextBtn = this.root.createEl("button", {
      text: "\u2193",
      attr: { type: "button", title: "\u4E0B\u4E00\u5904\u5339\u914D (Enter)", "aria-label": "\u4E0B\u4E00\u5904" }
    });
    nextBtn.addClass("ez-reader__search-bar__btn");
    nextBtn.addEventListener("click", (event) => {
      event.preventDefault();
      this.commit(false);
    });
    const prevBtn = this.root.createEl("button", {
      text: "\u2191",
      attr: { type: "button", title: "\u4E0A\u4E00\u5904\u5339\u914D (Shift+Enter)", "aria-label": "\u4E0A\u4E00\u5904" }
    });
    prevBtn.addClass("ez-reader__search-bar__btn");
    prevBtn.addEventListener("click", (event) => {
      event.preventDefault();
      this.commit(true);
    });
    const closeBtn = this.root.createEl("button", {
      text: "\xD7",
      attr: { type: "button", title: "\u5173\u95ED\u641C\u7D22 (Esc)", "aria-label": "\u5173\u95ED" }
    });
    closeBtn.addClass("ez-reader__search-bar__btn", "ez-reader__search-bar__close");
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      this.handlers.onClose();
    });
    this.inputKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.commit(event.shiftKey);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onClose();
      }
    };
    this.input.addEventListener("keydown", this.inputKeydown);
    this.documentKeydown = (event) => {
      if (!this.isVisible) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onClose();
      }
    };
    document.addEventListener("keydown", this.documentKeydown, true);
    document.body.append(this.root);
  }
  show() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.root.removeClass("is-hidden");
    this.input.value = this.currentQuery;
    if (this.focusTimer !== void 0) {
      window.clearTimeout(this.focusTimer);
    }
    this.focusTimer = window.setTimeout(() => {
      this.focusTimer = void 0;
      try {
        this.input.focus();
        this.input.select();
      } catch (error) {
        console.debug("[ez-reader] search bar focus skipped \u2014 destroyed", error);
      }
    }, 50);
  }
  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.root.addClass("is-hidden");
    this.input.blur();
  }
  /** Set / reset the displayed query — used when the host runs an
   *  external search and wants the bar to reflect the active term. */
  setQuery(query) {
    this.currentQuery = query;
    if (this.isVisible) this.input.value = query;
  }
  destroy() {
    if (this.focusTimer !== void 0) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = void 0;
    }
    document.removeEventListener("keydown", this.documentKeydown, true);
    this.root.remove();
  }
  commit(fromStart) {
    const value = this.input.value.trim();
    this.currentQuery = value;
    if (fromStart) this.handlers.onSearchFromStart(value);
    else this.handlers.onSearch(value);
  }
};

// src/ui/reader/SidebarNotesPanel.ts
var SidebarNotesPanel = class {
  root;
  handlers;
  app;
  entries = [];
  query = "";
  /** Tag filter — single tag, used to scope the list. Cleared on close. */
  tagFilter = null;
  /** P2: type filter — "all" / "thought" / "excerpt". 跟 tab 一对一. */
  typeFilter = "all";
  flashId = null;
  flashTimer;
  /** Debounce timer for the search box. */
  searchTimer;
  searchInput;
  /** Set of excerpt ids whose note region is currently expanded. */
  expandedNotes = /* @__PURE__ */ new Set();
  constructor(handlers, host) {
    this.handlers = handlers;
    this.app = handlers.app;
    this.root = host.createDiv({ cls: "ez-reader__notes-panel" });
    this.render();
  }
  /**
   * Tear down listeners + timers. The host should call this when the
   * reader view is closed; previously `flashTimer` could fire after
   * detach and write to a dead DOM.
   */
  dispose() {
    if (this.flashTimer !== void 0) {
      window.clearTimeout(this.flashTimer);
      this.flashTimer = void 0;
    }
    if (this.searchTimer !== void 0) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = void 0;
    }
  }
  setEntries(entries) {
    this.entries = entries;
    this.render();
  }
  show() {
    this.root.removeClass("is-hidden");
  }
  hide() {
    this.root.addClass("is-hidden");
  }
  toggle() {
    this.root.toggleClass("is-hidden", !this.root.hasClass("is-hidden"));
  }
  isVisible() {
    return !this.root.hasClass("is-hidden");
  }
  /** Briefly highlight a freshly added entry — gives the user feedback. */
  flashLast(excerptId) {
    this.flashId = excerptId;
    this.refreshFlashStyles();
    if (this.flashTimer !== void 0) {
      window.clearTimeout(this.flashTimer);
    }
    this.flashTimer = window.setTimeout(() => {
      this.flashId = null;
      this.refreshFlashStyles();
      this.flashTimer = void 0;
    }, 1800);
  }
  render() {
    this.root.empty();
    const header = this.root.createDiv({ cls: "ez-reader__notes-panel__header" });
    const titleRow = header.createDiv({ cls: "ez-reader__notes-panel__title-row" });
    titleRow.createEl("h3", { text: "\u7B14\u8BB0" });
    const count = titleRow.createEl("span", {
      cls: "ez-reader__notes-panel__count",
      text: `(${this.entries.length})`
    });
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u5173\u95ED\u7B14\u8BB0 (Esc)", "aria-label": "\u5173\u95ED\u7B14\u8BB0" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
    const add = header.createEl("button", {
      text: "+ \u60F3\u6CD5",
      attr: { type: "button", title: "\u6DFB\u52A0\u81EA\u7531\u60F3\u6CD5(\u4E0D\u9700\u9009\u4E2D\u6587\u5B57)", "aria-label": "\u6DFB\u52A0\u81EA\u7531\u60F3\u6CD5" }
    });
    add.addClass("ez-reader__notes-panel__add");
    add.onclick = () => this.handlers.onAddThought();
    if (this.entries.length === 0) {
      this.root.createDiv({
        cls: "ez-reader__notes-panel__empty",
        text: "\u9009\u4E2D\u6587\u5B57\u540E,\u5728\u5F39\u7A97\u91CC\u9009\u62E9\u300C\u60F3\u6CD5\u300D,\u7B14\u8BB0\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002"
      });
      return;
    }
    if (this.tagFilter) {
      const chip = this.root.createDiv({ cls: "ez-reader__notes-panel__tag-filter-chip" });
      chip.createSpan({ text: `\u6807\u7B7E\u8FC7\u6EE4: #${this.tagFilter}` });
      const clearBtn = chip.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u6E05\u9664\u8FC7\u6EE4", "aria-label": "\u6E05\u9664\u8FC7\u6EE4" }
      });
      clearBtn.addClass("ez-reader__notes-panel__tag-filter-clear");
      clearBtn.addEventListener("click", () => {
        this.tagFilter = null;
        this.render();
      });
    }
    const tabsBar = this.root.createDiv({ cls: "ez-reader__notes-panel__tabs" });
    const counts = {
      all: this.entries.length,
      thought: this.entries.filter((e3) => !e3.text?.trim()).length,
      excerpt: this.entries.filter((e3) => !!e3.text?.trim()).length
    };
    const makeTab = (key, label) => {
      const btn = tabsBar.createEl("button", {
        text: label,
        attr: { type: "button", "aria-label": `\u53EA\u770B ${label}` }
      });
      btn.addClass("ez-reader__notes-panel__tab");
      if (this.typeFilter === key) btn.addClass("is-active");
      btn.createSpan({
        text: String(counts[key]),
        cls: "ez-reader__notes-panel__tab-count"
      });
      btn.addEventListener("click", () => {
        this.typeFilter = key;
        this.render();
      });
      return btn;
    };
    makeTab("all", "\u5168\u90E8");
    makeTab("thought", "\u60F3\u6CD5");
    makeTab("excerpt", "\u6458\u5F55");
    if (this.entries.length >= 5) {
      const searchWrap = this.root.createDiv({ cls: "ez-reader__notes-panel__search" });
      const search2 = searchWrap.createEl("input", {
        attr: { type: "search", placeholder: "\u641C\u7D22\u7B14\u8BB0\u5185\u5BB9\u3001\u6807\u7B7E\u3001\u7AE0\u8282\u2026\u2026", "aria-label": "\u641C\u7D22\u7B14\u8BB0" }
      });
      this.searchInput = search2;
      search2.value = this.query;
      search2.addEventListener("input", () => {
        if (this.searchTimer !== void 0) {
          window.clearTimeout(this.searchTimer);
        }
        this.searchTimer = window.setTimeout(() => {
          this.searchTimer = void 0;
          this.query = search2.value.trim().toLocaleLowerCase();
          this.renderList();
        }, 150);
      });
      this.renderList();
    } else {
      this.renderList();
    }
  }
  renderList() {
    const oldList = this.root.querySelector(".ez-reader__notes-panel__list");
    if (oldList) oldList.remove();
    const filtered = this.filteredEntries();
    const list = this.root.createDiv({ cls: "ez-reader__notes-panel__list" });
    if (filtered.length === 0) {
      list.createDiv({
        cls: "ez-reader__notes-panel__empty",
        text: `\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0 (${this.query}).`
      });
      return;
    }
    const ordered = [...filtered].sort((a3, b3) => b3.createdAt - a3.createdAt);
    for (const entry of ordered) {
      const card = list.createDiv({ cls: "ez-reader__notes-panel__entry" });
      card.setAttribute("data-excerpt-id", entry.id);
      const quote = card.createEl("blockquote", { text: entry.text });
      quote.addClass("ez-reader__notes-panel__quote");
      const meta = card.createDiv({ cls: "ez-reader__notes-panel__meta" });
      const chapter = entry.locator.chapter ? ` \xB7 ${entry.locator.chapter}` : "";
      const ts = formatTimestamp(entry.createdAt);
      meta.createEl("span", { text: `${ts}${chapter}`, cls: "ez-reader__notes-panel__meta-text" });
      if (entry.tags.length > 0) {
        const tagWrap = meta.createSpan({ cls: "ez-reader__notes-panel__tags" });
        for (const tag of entry.tags) {
          const tagBtn = tagWrap.createEl("button", {
            text: `#${tag}`,
            attr: { type: "button", title: `\u53EA\u770B\u6807\u7B7E ${tag}`, "aria-label": `\u8FC7\u6EE4\u6807\u7B7E ${tag}` }
          });
          tagBtn.addClass("ez-reader__notes-panel__tag-btn");
          tagBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.tagFilter = this.tagFilter === tag ? null : tag;
            this.render();
          });
        }
      }
      if (entry.note) {
        const isExpanded = this.expandedNotes.has(entry.id);
        const previewText = entry.note.length > 60 ? `${entry.note.slice(0, 60)}\u2026` : entry.note;
        const toggle = card.createDiv({
          cls: `ez-reader__notes-panel__note-toggle${isExpanded ? " is-expanded" : ""}`
        });
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        toggle.createSpan({
          text: isExpanded ? "\u6536\u8D77\u60F3\u6CD5" : `\u{1F4AD} \u60F3\u6CD5 \xB7 ${previewText}`,
          cls: "ez-reader__notes-panel__note-toggle-label"
        });
        toggle.createSpan({
          text: isExpanded ? "\u25BE" : "\u25B8",
          cls: "ez-reader__notes-panel__note-toggle-arrow"
        });
        const note = card.createEl("p", { text: entry.note });
        note.addClass("ez-reader__notes-panel__note");
        if (isExpanded) {
          note.addClass("is-expanded");
        } else {
          note.addClass("is-collapsed");
        }
        const beginEdit = () => {
          if (!this.handlers.onUpdateNote) return;
          if (note.getAttribute("data-editing") === "1") return;
          const original = entry.note ?? "";
          note.contentEditable = "true";
          note.setAttribute("data-editing", "1");
          note.addClass("is-editing");
          note.focus();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(note);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          const finish = async (commit) => {
            if (note.getAttribute("data-editing") !== "1") return;
            note.contentEditable = "false";
            note.removeAttribute("data-editing");
            note.removeClass("is-editing");
            const newText = note.textContent ?? "";
            if (commit && newText !== original) {
              try {
                const fn = this.handlers.onUpdateNote;
                if (fn) await fn(entry, newText);
              } catch (error) {
                note.textContent = original;
                console.warn("[ez-reader] inline note save failed", error);
              }
            } else {
              note.textContent = original;
            }
          };
          const onKeyDown = (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              void finish(false);
            } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void finish(true);
            }
          };
          const onBlur = () => {
            void finish(true);
          };
          note.addEventListener("keydown", onKeyDown, { once: true });
          note.addEventListener("blur", onBlur, { once: true });
        };
        const flip = () => {
          if (this.expandedNotes.has(entry.id)) {
            if (note.getAttribute("data-editing") === "1") {
              note.contentEditable = "false";
              note.removeAttribute("data-editing");
              note.removeClass("is-editing");
              const newText = note.textContent ?? "";
              const original = entry.note ?? "";
              if (newText !== original) {
                this.handlers.onUpdateNote?.(entry, newText)?.catch((error) => {
                  note.textContent = original;
                  console.warn("[ez-reader] inline note save failed", error);
                });
              }
            }
            this.expandedNotes.delete(entry.id);
            toggle.classList.remove("is-expanded");
            note.classList.remove("is-expanded");
            note.classList.add("is-collapsed");
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-label").textContent = `\u{1F4AD} \u60F3\u6CD5 \xB7 ${previewText}`;
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-arrow").textContent = "\u25B8";
          } else {
            this.expandedNotes.add(entry.id);
            toggle.classList.add("is-expanded");
            note.classList.remove("is-collapsed");
            note.classList.add("is-expanded");
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-label").textContent = "\u6536\u8D77\u60F3\u6CD5";
            toggle.querySelector(".ez-reader__notes-panel__note-toggle-arrow").textContent = "\u25BE";
            beginEdit();
          }
        };
        toggle.addEventListener("click", flip);
        toggle.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            flip();
          }
        });
        note.addEventListener("click", (event) => {
          if (!note.classList.contains("is-collapsed")) {
            if (note.getAttribute("data-editing") !== "1") {
              event.stopPropagation();
              beginEdit();
            }
          } else {
            event.stopPropagation();
            flip();
          }
        });
      }
      const actions = card.createDiv({ cls: "ez-reader__notes-panel__actions" });
      const jump = actions.createEl("button", {
        text: "\u21A9",
        attr: { type: "button", title: "\u8DF3\u5230\u539F\u6587\u4F4D\u7F6E", "aria-label": "\u8DF3\u5230\u539F\u6587\u4F4D\u7F6E" }
      });
      jump.onclick = () => this.handlers.onJump(entry);
      const edit = actions.createEl("button", {
        text: "\u270E",
        attr: { type: "button", title: "\u7F16\u8F91\u60F3\u6CD5", "aria-label": "\u7F16\u8F91\u60F3\u6CD5" }
      });
      edit.onclick = () => this.handlers.onEdit(entry);
      const remove = actions.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u5220\u9664\u8FD9\u6761\u7B14\u8BB0", "aria-label": "\u5220\u9664\u8FD9\u6761\u7B14\u8BB0" }
      });
      remove.onclick = async () => {
        if (!this.app) {
          this.handlers.onRemove(entry);
          return;
        }
        const ok = await new ConfirmModal(
          this.app,
          "\u5220\u9664\u8FD9\u6761\u7B14\u8BB0?",
          "\u539F\u6587\u9AD8\u4EAE\u4E5F\u4F1A\u88AB\u79FB\u9664\u3002\u8BFB\u4E66\u8FDB\u5EA6\u3001\u4E66\u7B7E\u3001\u5176\u5B83\u7B14\u8BB0\u4E0D\u53D7\u5F71\u54CD\u3002",
          "\u5220\u9664"
        ).openAndWait();
        if (ok) this.handlers.onRemove(entry);
      };
    }
    this.refreshFlashStyles();
  }
  filteredEntries() {
    let result = this.entries;
    if (this.typeFilter !== "all") {
      const isThought = (ex) => !ex.text?.trim();
      if (this.typeFilter === "thought") {
        result = result.filter(isThought);
      } else {
        result = result.filter((ex) => !isThought(ex));
      }
    }
    if (this.tagFilter) {
      result = result.filter((ex) => ex.tags.includes(this.tagFilter));
    }
    if (!this.query) return result;
    const needle = this.query;
    return result.filter((ex) => {
      const haystack = [
        ex.text,
        ex.note,
        ex.tags.join(" "),
        ex.locator.chapter ?? ""
      ].join("\n").toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }
  refreshFlashStyles() {
    const cards = this.root.querySelectorAll(".ez-reader__notes-panel__entry");
    cards.forEach((card) => {
      card.toggleClass("is-flashing", card.getAttribute("data-excerpt-id") === this.flashId);
    });
  }
};
var formatTimestamp = (ms) => {
  const d2 = new Date(ms);
  const pad = (n3) => n3.toString().padStart(2, "0");
  return `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())} ${pad(d2.getHours())}:${pad(d2.getMinutes())}`;
};

// src/ui/reader/TocPanel.ts
function buildTocTree(items) {
  const roots = [];
  const stack = [];
  for (const item of items) {
    const node = { item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].item.depth >= item.depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}
function filterTocTree(nodes, predicate) {
  const result = [];
  for (const node of nodes) {
    const filteredChildren = filterTocTree(node.children, predicate);
    if (predicate(node.item) || filteredChildren.length > 0) {
      result.push({ item: node.item, children: filteredChildren });
    }
  }
  return result;
}
function ancestorPathOf(nodes, targetId) {
  const path = [];
  const visit = (ns) => {
    for (const n3 of ns) {
      if (n3.item.id === targetId) return true;
      if (visit(n3.children)) {
        path.unshift(n3.item);
        return true;
      }
    }
    return false;
  };
  visit(nodes);
  return path;
}
var TocPanel = class {
  root;
  handlers;
  items = [];
  tree = [];
  query = "";
  activeId = null;
  /** 用户手动折叠过的父节点 id 集合 (collapsed). 默认全部展开. */
  collapsed = /* @__PURE__ */ new Set();
  /** 搜索时临时展开的祖先 id — search 清空时清掉. */
  searchExpanded = /* @__PURE__ */ new Set();
  /** 当前键盘焦点所在的 row id — null 表示没有焦点. */
  focusedId = null;
  /** 已经自动滚动过可视区的 activeId 集合 — setActive 同 id 不重复滚. */
  scrolledIds = /* @__PURE__ */ new Set();
  /** 已访问章节 id 集合 (来自 ReaderView.tocFractions) — 渲染圆点用. */
  visitedIds = /* @__PURE__ */ new Set();
  /** 一次性的 capture keydown listener 引用, 用于 dispose 时摘掉. */
  onKeyDown;
  constructor(handlers, host) {
    this.handlers = handlers;
    this.root = host.createDiv({
      cls: "ez-reader__reader-panel ez-reader__reader-panel--toc-sidebar is-hidden"
    });
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.root.addEventListener("keydown", this.onKeyDown, true);
    this.renderHeader();
    this.renderList();
  }
  setToc(items) {
    this.items = items;
    this.tree = buildTocTree(items);
    this.query = "";
    this.collapsed = /* @__PURE__ */ new Set();
    this.searchExpanded = /* @__PURE__ */ new Set();
    this.focusedId = null;
    this.scrolledIds = /* @__PURE__ */ new Set();
    this.renderHeader();
    this.renderList();
  }
  /**
   * 更新当前激活章节 id.
   *
   * 副作用:
   * - 自动展开祖先 (跟 setActive 之前一致)
   * - 重置焦点到 active row (如果面板可见且当前没手动设焦点)
   * - scrollActiveIntoView: 第一次激活到这个 id 时滚到可视区, 之后同 id
   *   重复 setActive 不滚 (relocate 风暴期间会重复触发, 每次都滚会干扰
   *   用户手动滚动).
   */
  setActive(id) {
    const prev = this.activeId;
    this.activeId = id;
    if (id) {
      this.expandAncestorsOf(id);
    }
    this.refreshActiveAndCollapseStyles();
    this.refreshVisitedStyles();
    this.refreshBreadcrumb();
    if (id && this.isVisible()) {
      const hadUserFocus = this.focusedId !== null && this.focusedId !== prev;
      if (!hadUserFocus) {
        this.focusedId = id;
        this.applyFocusedClass();
      }
      this.scrollActiveIntoView(id);
    }
  }
  /**
   * 标记已访问章节 id 集合 — ReaderView 在 relocate 时被动记录
   * tocFractions, 把 keys() 同步过来. 用于 row 右侧的 visited/current/
   * unvisited 圆点.
   */
  setVisited(ids) {
    this.visitedIds = new Set(ids);
    this.refreshVisitedStyles();
  }
  show() {
    this.root.removeClass("is-hidden");
    if (this.activeId && this.focusedId === null) {
      this.focusedId = this.activeId;
      this.applyFocusedClass();
      this.scrollActiveIntoView(this.activeId);
    } else if (this.activeId === null) {
      const first = this.firstVisibleRow();
      if (first) {
        this.focusedId = first.getAttribute("data-toc-id");
        this.applyFocusedClass();
      }
    }
  }
  hide() {
    this.root.addClass("is-hidden");
    this.focusedId = null;
    this.applyFocusedClass();
  }
  toggle() {
    this.root.toggleClass("is-hidden", !this.root.hasClass("is-hidden"));
    if (this.isVisible()) {
      if (this.activeId && this.focusedId === null) {
        this.focusedId = this.activeId;
        this.applyFocusedClass();
        this.scrollActiveIntoView(this.activeId);
      } else if (this.activeId === null) {
        const first = this.firstVisibleRow();
        if (first) this.focusedId = first.getAttribute("data-toc-id");
        this.applyFocusedClass();
      } else {
        this.applyFocusedClass();
      }
    } else {
      this.focusedId = null;
      this.applyFocusedClass();
    }
  }
  isVisible() {
    return !this.root.hasClass("is-hidden");
  }
  /** 给 ReaderView bindKeyboardNavigation 用 — event.target 是否在 panel 内. */
  contains(node) {
    if (!node || !(node instanceof Node)) return false;
    return this.root.contains(node);
  }
  // ---- 内部 ----
  expandAncestorsOf(id) {
    const path = [];
    const visit = (nodes) => {
      for (const n3 of nodes) {
        if (n3.item.id === id) return true;
        if (visit(n3.children)) {
          path.push(n3.item.id);
          return true;
        }
      }
      return false;
    };
    visit(this.tree);
    let needsRerender = false;
    for (const ancestorId of path) {
      if (this.collapsed.has(ancestorId)) {
        this.collapsed.delete(ancestorId);
        needsRerender = true;
      }
      this.searchExpanded.add(ancestorId);
    }
    if (needsRerender) {
      this.renderList();
    }
  }
  /**
   * 滚动 active row 到可视区 — 只滚一次 (per session). 同 id 重复
   * setActive 不滚 (relocate 风暴里 ReaderView 会频繁 setActive). 换书
   * 后 (setToc) 清空, 让新书能自动滚到第一章节.
   */
  scrollActiveIntoView(id) {
    if (this.scrolledIds.has(id)) return;
    this.scrolledIds.add(id);
    const row = this.root.querySelector(`.ez-reader__toc-row[data-toc-id="${id}"]`);
    if (!row) return;
    try {
      row.scrollIntoView({ block: "nearest" });
    } catch {
    }
  }
  renderHeader() {
    this.root.empty();
    const headerRow = this.root.createDiv({ cls: "ez-reader__toc-header" });
    const titleRow = headerRow.createDiv({ cls: "ez-reader__panel-header-title" });
    const title = titleRow.createEl("h3", { text: "\u76EE\u5F55" });
    if (this.items.length > 0) {
      const count = titleRow.createEl("span", {
        text: `${this.items.length} \u7AE0`,
        attr: { "aria-label": `\u5171 ${this.items.length} \u7AE0` }
      });
      count.addClass("ez-reader__toc-count");
    }
    if (this.handlers.onClose) {
      const close = titleRow.createEl("button", {
        text: "\xD7",
        attr: { type: "button", title: "\u5173\u95ED\u9762\u677F (Esc)", "aria-label": "\u5173\u95ED\u9762\u677F" }
      });
      close.addClass("ez-reader__panel-close");
      close.addEventListener("click", () => this.handlers.onClose?.());
    }
    if (this.items.length >= 8) {
      const search2 = headerRow.createEl("input", {
        attr: { type: "search", placeholder: "\u641C\u7D22\u7AE0\u8282...", "aria-label": "\u641C\u7D22\u7AE0\u8282" }
      });
      search2.addClass("ez-reader__toc-search");
      search2.value = this.query;
      search2.addEventListener("input", () => {
        this.query = search2.value.trim().toLocaleLowerCase();
        this.searchExpanded = /* @__PURE__ */ new Set();
        this.renderList();
      });
    }
    title.setAttribute("data-toc-header-title", "1");
    this.root.createDiv({ cls: "ez-reader__toc-breadcrumb-row" });
  }
  renderBreadcrumb() {
    const slot = this.root.querySelector(".ez-reader__toc-breadcrumb-row");
    if (!slot) return;
    slot.empty();
    if (!this.activeId) {
      slot.addClass("is-empty");
      return;
    }
    slot.removeClass("is-empty");
    const ancestors = ancestorPathOf(this.tree, this.activeId);
    const chain = [...ancestors];
    const activeNode = this.findNodeById(this.tree, this.activeId);
    if (activeNode) chain.push(activeNode.item);
    if (chain.length === 0) {
      slot.addClass("is-empty");
      return;
    }
    chain.forEach((item, idx) => {
      const isLast = idx === chain.length - 1;
      if (idx > 0) {
        const sep = slot.createSpan({ text: "\u203A", attr: { "aria-hidden": "true" } });
        sep.addClass("ez-reader__toc-breadcrumb__sep");
      }
      const span = slot.createSpan({
        text: item.label,
        attr: {
          title: item.label,
          "aria-label": isLast ? `\u5F53\u524D\u4F4D\u7F6E: ${item.label}` : `\u8DF3\u5230 ${item.label}`
        }
      });
      span.addClass("ez-reader__toc-breadcrumb__item");
      if (isLast) {
        span.addClass("is-current");
      } else {
        span.addClass("is-link");
        span.addEventListener("click", () => this.handlers.onJump(item));
      }
    });
  }
  /** 已知树是平坦的 list of TocItem, 找到对应 TocTreeNode (任意深度). */
  findNodeById(nodes, id) {
    for (const n3 of nodes) {
      if (n3.item.id === id) return n3;
      const found = this.findNodeById(n3.children, id);
      if (found) return found;
    }
    return null;
  }
  refreshBreadcrumb() {
    this.renderBreadcrumb();
  }
  renderList() {
    const old = this.root.querySelector(".ez-reader__toc-tree");
    if (old) old.remove();
    const oldEmpty = this.root.querySelector(".ez-reader__reader-panel__empty");
    if (oldEmpty) oldEmpty.remove();
    if (this.items.length === 0) {
      this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: "\u672C\u4E66\u6CA1\u6709\u53EF\u7528\u76EE\u5F55\u3002"
      });
      return;
    }
    const filtered = this.query ? filterTocTree(
      this.tree,
      (it2) => it2.label.toLocaleLowerCase().includes(this.query)
    ) : this.tree;
    if (filtered.length === 0) {
      const empty = this.root.createDiv({
        cls: "ez-reader__reader-panel__empty",
        text: `\u6CA1\u6709\u5339\u914D\u7684\u7AE0\u8282 (${this.query}).`
      });
      empty.addClass("ez-reader__toc-tree");
      return;
    }
    const list = this.root.createDiv({ cls: "ez-reader__toc-tree" });
    for (const node of filtered) {
      this.renderNode(node, list, 0);
    }
    this.refreshActiveAndCollapseStyles();
    this.refreshBreadcrumb();
    this.refreshVisitedStyles();
    this.applyFocusedClass();
  }
  renderNode(node, parent, depth) {
    const row = parent.createDiv({ cls: "ez-reader__toc-row" });
    row.style.setProperty("--toc-depth", String(depth));
    row.setAttribute("data-toc-id", node.item.id);
    row.setAttribute("data-toc-depth", String(node.item.depth));
    const hasChildren = node.children.length > 0;
    if (hasChildren) {
      row.addClass("is-parent");
    }
    const toggle = row.createEl("button", {
      text: hasChildren ? "\u25BE" : "",
      attr: {
        type: "button",
        tabindex: "-1",
        "aria-label": hasChildren ? "\u6298\u53E0/\u5C55\u5F00\u5B50\u7AE0\u8282" : "",
        "data-toc-toggle": "1"
      }
    });
    toggle.addClass("ez-reader__toc-row__toggle");
    if (!hasChildren) {
      toggle.addClass("is-empty");
      toggle.disabled = true;
    } else {
      toggle.addEventListener("click", (e3) => {
        e3.stopPropagation();
        if (this.collapsed.has(node.item.id)) {
          this.collapsed.delete(node.item.id);
        } else {
          this.collapsed.add(node.item.id);
          this.searchExpanded.delete(node.item.id);
        }
        this.refreshActiveAndCollapseStyles();
      });
    }
    const label = row.createEl("button", {
      attr: {
        type: "button",
        title: node.item.label,
        "aria-label": `\u8DF3\u5230 ${node.item.label}`
      }
    });
    label.addClass("ez-reader__toc-row__label");
    this.fillLabelWithHighlight(label, node.item.label, this.query);
    label.addEventListener("click", () => this.handlers.onJump(node.item));
    const dot = row.createSpan({ attr: { "aria-hidden": "true" } });
    dot.addClass("ez-reader__toc-progress-dot");
    if (hasChildren) {
      const children = parent.createDiv({ cls: "ez-reader__toc-children" });
      children.setAttribute("data-toc-children-of", node.item.id);
      for (const child of node.children) {
        this.renderNode(child, children, depth + 1);
      }
    }
  }
  /**
   * 把 label 写到容器里, 把 query 子串包成 <mark>. 没 query 时整段做
   * textContent — 安全 (不解析 HTML). case-insensitive 匹配 (跟 query
   * lowercase 一致).
   */
  fillLabelWithHighlight(container, label, query) {
    container.textContent = "";
    if (!query) {
      container.textContent = label;
      return;
    }
    const lowerLabel = label.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    let cursor = 0;
    while (cursor < label.length) {
      const idx = lowerLabel.indexOf(lowerQuery, cursor);
      if (idx < 0) {
        container.appendChild(container.ownerDocument.createTextNode(label.slice(cursor)));
        return;
      }
      if (idx > cursor) {
        container.appendChild(container.ownerDocument.createTextNode(label.slice(cursor, idx)));
      }
      const mark = container.ownerDocument.createElement("mark");
      mark.addClass("ez-reader__toc-highlight");
      mark.textContent = label.slice(idx, idx + lowerQuery.length);
      container.appendChild(mark);
      cursor = idx + lowerQuery.length;
    }
  }
  refreshActiveAndCollapseStyles() {
    const rows = this.root.querySelectorAll(".ez-reader__toc-row");
    rows.forEach((r3) => {
      const id = r3.getAttribute("data-toc-id");
      r3.toggleClass("is-active", id === this.activeId);
      if (r3.hasClass("is-parent")) {
        const toggle = r3.querySelector(".ez-reader__toc-row__toggle");
        if (toggle && !toggle.classList.contains("is-empty")) {
          toggle.textContent = id && this.collapsed.has(id) ? "\u25B8" : "\u25BE";
        }
      }
    });
    const childContainers = this.root.querySelectorAll(
      ".ez-reader__toc-children"
    );
    childContainers.forEach((c2) => {
      const parentId = c2.getAttribute("data-toc-children-of");
      if (!parentId) return;
      const collapsed = this.collapsed.has(parentId) && !this.searchExpanded.has(parentId);
      c2.toggleClass("is-collapsed", collapsed);
    });
  }
  /**
   * 根据 visitedIds + activeId 给每个 row 的进度点写 CSS class:
   * - activeId: is-current (蓝)
   * - visitedIds (含 activeId): is-visited (绿)
   * - 其他: is-unvisited (灰)
   */
  refreshVisitedStyles() {
    const rows = this.root.querySelectorAll(".ez-reader__toc-row");
    rows.forEach((r3) => {
      const id = r3.getAttribute("data-toc-id");
      const dot = r3.querySelector(".ez-reader__toc-progress-dot");
      if (!dot || !id) return;
      dot.removeClass("is-current", "is-visited", "is-unvisited");
      if (id === this.activeId) {
        dot.addClass("is-current");
      } else if (this.visitedIds.has(id)) {
        dot.addClass("is-visited");
      } else {
        dot.addClass("is-unvisited");
      }
    });
  }
  // ---- 键盘导航 ----
  /**
   * 键盘 handler — capture phase 挂在 panel root. 仅在 panel 可见 + 事件
   * target 在 panel 内 + 焦点不在 search input 时响应. ReaderView 的容器
   * 层快捷键 handler 在 capture 阶段先跑 (因为 containerEl 是 panel 的
   * 祖先), 它对箭头 / Enter 没路由, 不会冲突. Home/End/Space 在 ReaderView
   * 里有路由, 因此 bindKeyboardNavigation 在 tocPanel 可见时会跳过
   * target 在 panel 内的 action — 这里我们统一接管.
   */
  handleKeyDown(event) {
    if (!this.isVisible()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!this.root.contains(target)) return;
    if (target instanceof HTMLInputElement && target.classList.contains("ez-reader__toc-search")) {
      if (event.key === "Escape") {
        if (this.query) {
          target.value = "";
          this.query = "";
          this.searchExpanded = /* @__PURE__ */ new Set();
          this.renderList();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        return;
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        this.moveFocus(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        this.moveFocus(-1);
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        this.focusFirstOrLast(true);
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        this.focusFirstOrLast(false);
        return;
      case "ArrowRight":
        event.preventDefault();
        event.stopPropagation();
        this.handleArrowRight();
        return;
      case "ArrowLeft":
        event.preventDefault();
        event.stopPropagation();
        this.handleArrowLeft();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        this.activateFocused();
        return;
      case "Escape":
        return;
    }
  }
  /** 拿到当前可见 row 列表 (按 DOM 顺序, 跳过 hidden). */
  visibleRows() {
    const all = Array.from(this.root.querySelectorAll(".ez-reader__toc-row"));
    return all.filter((r3) => {
      let parent = r3.parentElement;
      while (parent && parent !== this.root) {
        if (parent.classList.contains("ez-reader__toc-children") && parent.classList.contains("is-collapsed")) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });
  }
  firstVisibleRow() {
    return this.visibleRows()[0] ?? null;
  }
  lastVisibleRow() {
    const rows = this.visibleRows();
    return rows[rows.length - 1] ?? null;
  }
  moveFocus(delta) {
    const rows = this.visibleRows();
    if (rows.length === 0) return;
    const currentIdx = this.focusedId ? rows.findIndex((r3) => r3.getAttribute("data-toc-id") === this.focusedId) : -1;
    let nextIdx;
    if (currentIdx < 0) {
      nextIdx = delta > 0 ? 0 : rows.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(rows.length - 1, currentIdx + delta));
    }
    const nextRow = rows[nextIdx];
    if (!nextRow) return;
    this.focusedId = nextRow.getAttribute("data-toc-id");
    this.applyFocusedClass();
    try {
      nextRow.scrollIntoView({ block: "nearest" });
    } catch {
    }
  }
  focusFirstOrLast(first) {
    const row = first ? this.firstVisibleRow() : this.lastVisibleRow();
    if (!row) return;
    this.focusedId = row.getAttribute("data-toc-id");
    this.applyFocusedClass();
    try {
      row.scrollIntoView({ block: "nearest" });
    } catch {
    }
  }
  /**
   * → : 有子时折叠 (跟点 toggle 一致); 无子时跳到第一个子 (如果有, 通常
   * 叶子节点不会有 children, 但保险起见). 都做不到时什么都不做.
   */
  handleArrowRight() {
    if (!this.focusedId) return;
    const row = this.root.querySelector(`.ez-reader__toc-row[data-toc-id="${this.focusedId}"]`);
    if (!row) return;
    if (row.classList.contains("is-parent")) {
      if (this.collapsed.has(this.focusedId)) {
        this.collapsed.delete(this.focusedId);
      } else {
        this.collapsed.add(this.focusedId);
        this.searchExpanded.delete(this.focusedId);
      }
      this.refreshActiveAndCollapseStyles();
    }
  }
  /**
   * ← : 有子且展开时折叠 (相当于 toggle); 否则跳到父 (fold-able) 或不做.
   * 实现: 如果当前 row 处于展开状态 → 折叠. 如果已折叠或叶子 → 找父.
   */
  handleArrowLeft() {
    if (!this.focusedId) return;
    const row = this.root.querySelector(`.ez-reader__toc-row[data-toc-id="${this.focusedId}"]`);
    if (!row) return;
    if (row.classList.contains("is-parent") && !this.collapsed.has(this.focusedId)) {
      this.collapsed.add(this.focusedId);
      this.searchExpanded.delete(this.focusedId);
      this.refreshActiveAndCollapseStyles();
      return;
    }
    let parent = row.parentElement;
    while (parent && parent !== this.root) {
      if (parent.classList.contains("ez-reader__toc-children")) {
        const parentId = parent.getAttribute("data-toc-children-of");
        if (parentId) {
          this.focusedId = parentId;
          this.applyFocusedClass();
          const parentRow = this.root.querySelector(
            `.ez-reader__toc-row[data-toc-id="${parentId}"]`
          );
          if (parentRow) {
            try {
              parentRow.scrollIntoView({ block: "nearest" });
            } catch {
            }
          }
        }
        return;
      }
      parent = parent.parentElement;
    }
  }
  activateFocused() {
    if (!this.focusedId) return;
    const item = this.findItemById(this.focusedId);
    if (!item) return;
    this.handlers.onJump(item);
  }
  findItemById(id) {
    return this.findNodeById(this.tree, id)?.item ?? null;
  }
  applyFocusedClass() {
    const rows = this.root.querySelectorAll(".ez-reader__toc-row");
    rows.forEach((r3) => {
      r3.toggleClass("is-focused", r3.getAttribute("data-toc-id") === this.focusedId);
    });
  }
};

// src/ui/reader/ThoughtModal.ts
var import_obsidian12 = require("obsidian");
var ThoughtModal = class extends import_obsidian12.Modal {
  input;
  resolver = null;
  constructor(app, input) {
    super(app);
    this.input = input;
  }
  openAndWait() {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }
  settle(result) {
    const r3 = this.resolver;
    this.resolver = null;
    r3?.(result);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ez-reader__thought-modal");
    contentEl.createEl("h2", { text: this.input.text ? "\u4E3A\u8FD9\u6BB5\u6587\u5B57\u5199\u4E0B\u60F3\u6CD5" : "\u5199\u4E0B\u4F60\u7684\u60F3\u6CD5" });
    if (this.input.text) {
      contentEl.createEl("blockquote", { text: this.input.text });
    }
    if (this.input.chapter) {
      contentEl.createEl("p", {
        cls: "ez-reader__thought-modal__chapter",
        text: `\u6240\u5728: ${this.input.chapter}`
      });
    }
    const noteInput = contentEl.createEl("textarea");
    noteInput.addClass("ez-reader__thought-modal__input");
    noteInput.placeholder = "\u4F60\u7684\u60F3\u6CD5\u2026\u2026";
    const tagsInput = contentEl.createEl("input", { attr: { type: "text" } });
    tagsInput.addClass("ez-reader__thought-modal__tags");
    tagsInput.placeholder = "\u4E3B\u9898\u6807\u7B7E(\u53EF\u9009,\u7528\u7A7A\u683C\u6216\u9017\u53F7\u5206\u9694)";
    const actions = contentEl.createDiv({ cls: "ez-reader__modal-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancel.onclick = () => {
      this.settle(null);
      this.close();
    };
    const submit = actions.createEl("button", { text: "\u4FDD\u5B58\u60F3\u6CD5", attr: { type: "button" } });
    submit.addClass("mod-cta");
    submit.onclick = () => {
      this.settle({
        note: noteInput.value.trim(),
        tags: parseTags(tagsInput.value)
      });
      this.close();
    };
    noteInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit.click();
      }
    });
    window.setTimeout(() => {
      try {
        noteInput.focus();
      } catch (error) {
        console.debug("[ez-reader] thought modal focus skipped", error);
      }
    }, 0);
  }
  onClose() {
    if (this.resolver) this.settle(null);
  }
};
var parseTags = (raw) => {
  const tokens = raw.split(/[\s,,，]+/);
  const seen = /* @__PURE__ */ new Set();
  for (const token of tokens) {
    const cleaned = token.replace(/^#+/, "").replace(/[^\p{L}\p{N}_/-]/gu, "").slice(0, 60);
    if (cleaned) seen.add(cleaned);
    if (seen.size >= 12) break;
  }
  return [...seen];
};

// src/ui/reader/TranslationDrawer.ts
var TranslationDrawer = class {
  root;
  handlers;
  service;
  currentSource = "auto";
  currentTarget = "zh-CN";
  abortController = null;
  /**
   * Generation token used to drop stale results. `service.translate()` is
   * a regular promise (we don't actually cancel the network request —
   * AbortController on fetch is not wired through here), so a new
   * translate() call wouldn't otherwise prevent the old one from
   * resolving and clobbering the new loading state.
   */
  translateGeneration = 0;
  constructor(handlers, service, host, initial) {
    this.handlers = handlers;
    this.service = service;
    this.currentSource = initial.source;
    this.currentTarget = initial.target;
    this.root = host.createDiv({ cls: "ez-reader__translation-drawer is-hidden" });
    this.renderShell();
  }
  setLanguages(source, target) {
    this.currentSource = source;
    this.currentTarget = target;
  }
  show() {
    this.root.removeClass("is-hidden");
  }
  hide() {
    this.root.addClass("is-hidden");
    this.abortController?.abort();
    this.abortController = null;
  }
  toggle() {
    this.root.toggleClass("is-hidden", !this.root.hasClass("is-hidden"));
  }
  isVisible() {
    return !this.root.hasClass("is-hidden");
  }
  /** Translate a piece of text and render the result. */
  async translate(text) {
    const generation = ++this.translateGeneration;
    this.show();
    this.renderLoading(text);
    this.abortController?.abort();
    this.abortController = new AbortController();
    if (!this.service) {
      this.renderError(text, "\u7FFB\u8BD1\u670D\u52A1\u672A\u914D\u7F6E\u3002\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u6DFB\u52A0 API key\u3002");
      return;
    }
    try {
      const result = await this.service.translate(text, this.currentSource, this.currentTarget);
      if (generation !== this.translateGeneration) return;
      this.renderResult(text, result.text, result.detectedSource, result.providerId);
    } catch (error) {
      if (generation !== this.translateGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.renderError(text, message);
    }
  }
  renderShell() {
    this.root.empty();
    const header = this.root.createDiv({ cls: "ez-reader__translation-drawer__header" });
    header.createEl("h3", { text: "\u7FFB\u8BD1" });
    const close = header.createEl("button", { text: "\xD7", attr: { type: "button", title: "\u5173\u95ED\u7FFB\u8BD1\u9762\u677F" } });
    close.addClass("ez-reader__translation-drawer__close");
    close.onclick = () => this.hide();
    this.root.createDiv({ cls: "ez-reader__translation-drawer__body" });
  }
  renderLoading(sourceText) {
    const body = this.root.querySelector(".ez-reader__translation-drawer__body");
    if (!body) return;
    body.empty();
    body.createEl("blockquote", { text: sourceText });
    const loading = body.createDiv({ cls: "ez-reader__translation-drawer__loading" });
    loading.setText("\u6B63\u5728\u7FFB\u8BD1\u2026");
  }
  renderResult(sourceText, translated, detected, providerId) {
    const body = this.root.querySelector(".ez-reader__translation-drawer__body");
    if (!body) return;
    body.empty();
    body.createEl("blockquote", { text: sourceText });
    body.createDiv({ cls: "ez-reader__translation-drawer__translation", text: translated });
    const meta = body.createDiv({ cls: "ez-reader__translation-drawer__meta" });
    meta.createEl("span", {
      text: `${detected ? `\u68C0\u6D4B\u5230 ${detected}` : ""} \xB7 ${providerId} \xB7 \u2192 ${this.currentTarget}`,
      cls: "ez-reader__translation-drawer__provider"
    });
    const actionsRow = body.createDiv({ cls: "ez-reader__translation-drawer__actions" });
    const saveBtn = actionsRow.createEl("button", {
      text: "\u4FDD\u5B58\u4E3A\u7B14\u8BB0",
      attr: { type: "button", title: "\u628A\u7FFB\u8BD1\u8FDE\u540C\u539F\u6587\u4E00\u8D77\u5B58\u5230\u7B14\u8BB0" }
    });
    saveBtn.onclick = () => this.handlers.onSaveAsNote(sourceText, translated);
    if (this.handlers.onCopy) {
      const copyBtn = actionsRow.createEl("button", {
        text: "\u590D\u5236",
        attr: { type: "button", title: "\u590D\u5236\u8BD1\u6587\u5230\u526A\u8D34\u677F", "aria-label": "\u590D\u5236\u8BD1\u6587" }
      });
      copyBtn.addClass("ez-reader__translation-drawer__copy-btn");
      copyBtn.onclick = async () => {
        try {
          await this.handlers.onCopy?.(translated);
          copyBtn.setText("\u2713 \u5DF2\u590D\u5236");
          window.setTimeout(() => copyBtn.setText("\u590D\u5236"), 1500);
        } catch (error) {
          console.warn("[ez-reader] copy translation failed", error);
        }
      };
    }
    const retryBtn = actionsRow.createEl("button", {
      text: "\u6362\u8BED\u8A00\u91CD\u8BD1",
      attr: { type: "button", title: "\u5207\u6362\u76EE\u6807\u8BED\u8A00\u540E\u91CD\u65B0\u7FFB\u8BD1" }
    });
    retryBtn.onclick = () => this.cycleTargetAndTranslate(sourceText);
  }
  async cycleTargetAndTranslate(text) {
    const cycle = ["zh-CN", "en", "ja", "ko", "fr", "de"];
    const currentIdx = cycle.indexOf(this.currentTarget);
    const next = cycle[(currentIdx + 1) % cycle.length] ?? "zh-CN";
    this.currentTarget = next;
    await this.translate(text);
  }
  renderError(sourceText, message) {
    const body = this.root.querySelector(".ez-reader__translation-drawer__body");
    if (!body) return;
    body.empty();
    body.createEl("blockquote", { text: sourceText });
    const err2 = body.createDiv({ cls: "ez-reader__translation-drawer__error" });
    err2.setText(message);
  }
};

// src/ui/reader/readerShortcuts.ts
var routeShortcut = (event, shortcuts, enabled = true) => {
  if (event.altKey) return null;
  if ((event.ctrlKey || event.metaKey) && event.key === "f" && !event.shiftKey) {
    return "openSearch";
  }
  if (event.key === "Escape") return "escape";
  if (event.ctrlKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  const cfg = shortcuts;
  if (key === cfg.prev.toLowerCase()) return "prev";
  if (key === cfg.next.toLowerCase()) return "next";
  if (key === cfg.toggleSidebar.toLowerCase() && !event.shiftKey) return "toggleNotes";
  if (key === cfg.toggleToc.toLowerCase() && !event.shiftKey) return "toggleToc";
  if (key === cfg.translate.toLowerCase() && event.shiftKey) return "translate";
  if (key === cfg.highlight.toLowerCase() && event.shiftKey) return "excerpt";
  if (key === "h" && !event.shiftKey) return "quickHighlight";
  if (key === "b" && !event.shiftKey) return "quickBookmark";
  if (!enabled) return null;
  switch (event.key) {
    case "PageUp":
      return "prev";
    case "PageDown":
      return "next";
    case "Home":
      return "first";
    case "End":
      return "last";
  }
  if (event.shiftKey) {
    if (event.key === " ") return "prev";
    return null;
  }
  switch (event.key) {
    case " ":
      return "next";
    // P1 修复: 之前裸 `f` 跟 foliate 自身的查找 (find in book) 冲突.
    // 强制需要 Shift+F 才能切沉浸, 跟其他 fixed shortcut 一致.
    case "F":
      return "toggleImmersive";
    case "?":
      return "showHelp";
    case "c":
    case "C":
      return "copySelection";
    // P1: find-in-book 快捷键 — Ctrl/Cmd+F 跨平台一致 + 裸 `/` (vim style)
    // 都能打开. 注意 Ctrl/Cmd 修饰由外层 shortcut event 决定, routeShortcut
    // 在 alt/ctrl/meta 时已 return null, 所以这里捕获的是裸键或裸 shift.
    case "/":
      return "openSearch";
  }
  return null;
};

// src/ui/reader/foliateContentDelegate.ts
var FoliateContentDelegate = class {
  engine;
  session;
  constructor(engine) {
    this.engine = engine;
  }
  async mount(host, ctx) {
    if (this.session) {
      throw new Error("[ez-reader] FoliateContentDelegate.mount called twice without destroy");
    }
    this.session = await this.engine.open(ctx.book, host, ctx.appearance, ctx.loader);
    return this.session;
  }
  async destroy() {
    const session = this.session;
    this.session = void 0;
    if (!session) return;
    try {
      await session.close();
    } catch (error) {
      console.warn("[ez-reader] FoliateContentDelegate.destroy failed", error);
    }
  }
};

// src/ui/reader/textContentDelegate.ts
var TextContentDelegate = class {
  engine;
  session;
  constructor(engine) {
    this.engine = engine;
  }
  async mount(host, ctx) {
    if (this.session) {
      throw new Error("[ez-reader] TextContentDelegate.mount called twice without destroy");
    }
    this.session = await this.engine.open(ctx.book, host, ctx.appearance, ctx.loader);
    return this.session;
  }
  async destroy() {
    const session = this.session;
    this.session = void 0;
    if (!session) return;
    try {
      await session.close();
    } catch (error) {
      console.warn("[ez-reader] TextContentDelegate.destroy failed", error);
    }
  }
};

// src/ui/reader/ReaderView.ts
var READER_VIEW_TYPE = "ez-reader-view";
var createContentDelegate = (format, deps) => {
  switch (format) {
    case "txt":
    case "mobi":
    case "azw3":
      return new TextContentDelegate(deps.textReader);
    case "epub":
    case "pdf":
    case "azw":
      return new FoliateContentDelegate(deps.foliate);
  }
};
var generateExcerptId = (prefix) => {
  const uuid = window.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) {
    return `${prefix}-${uuid}`;
  }
  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${fallback}`;
};
var isEditableTarget = (target) => target instanceof Element && Boolean(target.closest("input, textarea, select, button, [contenteditable='true'], a"));
var locatorForNoteWriter = (pos) => {
  switch (pos.kind) {
    case "reflow":
      return {
        cfi: pos.cfi,
        fraction: pos.fraction
      };
    case "pdf":
      return {
        fraction: 0,
        page: pos.page
      };
    case "text":
      return {
        fraction: pos.fraction
      };
  }
};
var maybeExpandChineseSelection = (raw) => {
  const sel = window.document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : void 0;
  if (!range) return { text: raw };
  const container = range.commonAncestorContainer;
  const containerText = container.nodeType === 3 ? container.textContent ?? "" : container.textContent ?? "";
  if (!containerText) return { text: raw };
  const text = expandWithCap(raw, containerText, 100);
  return { text };
};
var composeQuickBookmarkLabel = (chapter, fraction) => {
  const safeFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const pct = `${Math.round(safeFraction * 100)}%`;
  const trimmedChapter = chapter?.trim();
  if (trimmedChapter) {
    const cap = trimmedChapter.length > 60 ? `${trimmedChapter.slice(0, 60)}\u2026` : trimmedChapter;
    return `${cap} \xB7 ${pct}`;
  }
  return pct;
};
var ReaderView = class extends import_obsidian16.ItemView {
  deps;
  entry;
  session;
  appearance = { ...DEFAULT_READER_APPEARANCE };
  shortcuts = DEFAULT_KEYBOARD_SHORTCUTS;
  toolbar;
  bookmarksPanel;
  excerptsPanel;
  notesPanel;
  tocPanel;
  translationDrawer;
  selectionMenu;
  searchBar;
  shortcutHelpModal;
  host;
  fraction = 0;
  chapter = "";
  bookmarkCount = 0;
  excerptCount = 0;
  pendingSelection;
  tocItems = [];
  /** P2: toc item id → 该章节的 fraction. 滚动过程中被动记录 —
   *  chapter label 改变时, 用 label 在 tocItems 里找 id, 把 (id, 当前 fraction)
   *  写进 map. 用于 toolbar 进度条下方的章节标记条. */
  tocFractions = /* @__PURE__ */ new Map();
  isDesktopWide = false;
  isImmersive = false;
  /**
   * P1: 阅读时长统计 — 每次 reader 成为 active leaf 时开始计时,
   * 离开时把 ms 累加并 30s 防抖写回 store. 字段 `totalReadingMs`
   * 已经在 ReadingState 里.
   */
  activeSinceMs = null;
  lastReadingFlushAt = 0;
  /**
   * Find-in-book 状态 — toolbar 拿这两个字段做 badge + active 视觉。
   * searchBarVisible 也控制 input 是否聚焦。
   */
  searchBarVisible = false;
  searchMatchCount = null;
  /**
   * Debounce timestamp for `persistProgress` failures — relocate 触发频繁
   * (每翻页一次),连续失败时不能让 Notice 刷屏. 5s 内只展示一次.
   */
  lastProgressFailureNoticeAt = 0;
  /**
   * C1 修复: relocate 风暴 debounce. foliate 滚动模式下 relocate 触发频繁
   * (60Hz 滚动里 5-10 次/秒), 每次都 await exportLocator + await
   * updatePosition → data.json IO 风暴. PdfOverlay 同位置已经做了 250ms
   * debounce (pdfOverlay.ts:312-323), ReaderView 漏掉. 现在 debounce 300ms,
   * 配合 1% 距离阈值避免跨页定位 race (用户翻到第 N 页,debounce 期间又翻
   * 到 N+1,旧 timer 会写 N 的 fraction 覆盖 — 距离阈值让最后一次保留).
   */
  persistProgressTimer;
  persistProgressPending;
  /**
   * P2: visited toc ids 持久化 debounce — 跟 progress 同样 300ms. 每次
   * tocFractions 新增 id 时 schedule 一次 (relocate 触发频繁, 直接同步写
   * IO 会刷屏). 跟 progress 不共用 timer — 两件事独立, 一个延迟不影响
   * 另一个 flush.
   */
  persistVisitedTimer;
  /** 上次已 flush 的 visited ids 数组 — 避免重复写相同内容. */
  persistVisitedLastSnapshot = [];
  constructor(leaf, deps) {
    super(leaf);
    this.deps = deps;
  }
  getViewType() {
    return READER_VIEW_TYPE;
  }
  getDisplayText() {
    return this.entry ? `\u9605\u8BFB: ${this.entry.book.locator.path}` : "\u9605\u8BFB\u5668";
  }
  getIcon() {
    return "book-open";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ez-reader__reader");
    let loadedSettings;
    if (this.deps.settingsProvider) {
      try {
        const fetched = await this.deps.settingsProvider();
        loadedSettings = fetched;
        this.appearance = { ...fetched.defaultAppearance };
        this.shortcuts = fetched.shortcuts;
        this.rememberProgress = fetched.rememberProgress !== false;
      } catch (error) {
        console.warn("[ez-reader] failed to load settings", error);
      }
    }
    this.isDesktopWide = window.matchMedia("(min-width: 1024px)").matches;
    this.isImmersive = !this.isDesktopWide && (loadedSettings?.immersiveOnTablet ?? false);
    container.toggleClass("ez-reader__immersive", this.isImmersive);
    container.toggleClass("ez-reader__desktop-wide", this.isDesktopWide);
    if (loadedSettings?.twoPagesByDefault && this.appearance.flow !== "scrolled") {
      this.appearance = { ...this.appearance, twoPages: true };
    }
    this.toolbar = new ReaderToolbar(
      {
        onPrev: () => void this.goToNext(-1),
        onNext: () => void this.goToNext(1),
        onProgressChange: (fraction) => void this.seekFraction(fraction),
        onAddBookmark: () => void this.addBookmarkAtCurrentPosition(),
        onToggleBookmarks: () => void this.toggleBookmarks(),
        onToggleExcerpts: () => void this.toggleExcerpts(),
        onClose: () => this.leaf.detach(),
        onShowFontSettings: () => void this.showFontSettings(),
        onToggleToc: () => void this.toggleToc(),
        onToggleNotes: () => void this.toggleNotes(),
        onCycleStatus: () => void this.cycleStatus(),
        onToggleFavorite: () => void this.toggleFavorite(),
        onToggleImmersive: () => void this.toggleImmersive(),
        onOpenSearch: () => void this.openSearchBar(),
        onCloseSearch: () => void this.closeSearchBar(),
        // P2: 进度条下方的章节标记点 — 跳到该章节
        onJumpToc: (id) => void this.jumpToTocById(id)
      },
      {
        fraction: 0,
        chapter: "",
        status: this.entry?.reading.status ?? "unread",
        showingBookmarks: false,
        showingExcerpts: false,
        showingNotes: this.isDesktopWide,
        showingToc: false,
        showingImmersive: this.isImmersive,
        showFontSettings: true,
        currentPage: null,
        totalPages: null,
        searchOpen: false,
        searchMatchCount: null
      }
    );
    container.append(this.toolbar.root);
    this.bookmarksPanel = new BookmarksPanel(
      {
        onJump: (bookmark) => void this.jumpToBookmark(bookmark),
        onRemove: (bookmark) => void this.removeBookmark(bookmark),
        onClose: () => this.hideAllPanels()
      },
      container
    );
    this.excerptsPanel = new ExcerptsPanel(
      {
        app: this.deps.app,
        onJump: (excerpt) => void this.jumpToExcerpt(excerpt),
        onRemove: (excerpt) => void this.removeExcerpt(excerpt),
        onClose: () => this.hideAllPanels()
      },
      container
    );
    const body = container.createDiv({ cls: "ez-reader__reader__body" });
    if (this.isImmersive) {
      this.ensureImmersiveExitButton(container);
    }
    this.tocPanel = new TocPanel(
      {
        onJump: (item) => void this.jumpToTocItem(item),
        onClose: () => this.hideAllPanels()
      },
      body
    );
    this.notesPanel = new SidebarNotesPanel(
      {
        app: this.deps.app,
        onJump: (excerpt) => void this.jumpToExcerpt(excerpt),
        onRemove: (excerpt) => void this.removeExcerpt(excerpt),
        onEdit: (excerpt) => void this.editExcerpt(excerpt),
        // P2: inline note patch — 用户在 panel 里点 note 直接编辑, blur 保存.
        // 只 patch note 字段, 不动 locator / text / tags. 比 editExcerpt
        // (remove + add) 高效得多, 用户频繁触发.
        onUpdateNote: (excerpt, note) => this.updateExcerptNoteInline(excerpt, note),
        onAddThought: () => void this.openFreeThoughtModal(),
        // P1: notes panel header × 按钮 (mobile / narrow layout only;
        // desktop-wide 永远显示, 不需要 ×).
        onClose: this.isDesktopWide ? void 0 : () => this.hideAllPanels()
      },
      body
    );
    if (this.isDesktopWide) {
      this.notesPanel.show();
    } else {
      this.notesPanel.hide();
    }
    this.host = body.createDiv({ cls: "ez-reader__reader__stage" });
    this.translationDrawer = new TranslationDrawer(
      {
        onSaveAsNote: (src, translated) => void this.saveTranslationAsNote(src, translated),
        // P2: 翻译面板"复制"按钮 — 复用 navigator.clipboard.writeText 路径,
        // 跟 selection menu 复制一致. TranslationDrawer 自己 catch 失败显示 ✓.
        onCopy: (translated) => this.copyTextToClipboard(translated)
      },
      this.deps.translation,
      body,
      { source: "auto", target: loadedSettings?.translationLocale ?? "zh-CN" }
    );
    this.selectionMenu = new ReaderSelectionMenu({
      onExcerpt: () => void this.saveExcerptFromSelection(),
      onThought: () => void this.saveThoughtFromSelection(),
      onCopy: () => this.copySelectionToClipboard(),
      onTranslate: () => void this.requestTranslation()
    }, {
      // P2: 选区菜单快捷键提示 — 用户不用问 ? 也能发现 Shift+T / C / Shift+H
      thought: "Shift+T",
      excerpt: "Shift+H",
      translate: void 0,
      // 翻译直接走 Shift+T 重叠, 不显示
      copy: "C"
    });
    this.searchBar = new SearchBar({
      onSearch: (query) => void this.runFindInBook(query, false),
      onSearchFromStart: (query) => void this.runFindInBook(query, true),
      onClose: () => this.closeSearchBar()
    });
    this.bindSwipeGestures();
    this.bindKeyboardNavigation();
    this.bindImmersiveToolbarToggle();
    this.bindReadingTimeTracker();
    if (this.entry) await this.openSession();
  }
  async onClose() {
    if (this.pendingClosePromise) {
      await this.pendingClosePromise;
      this.pendingClosePromise = void 0;
    }
    if (this.session) {
      await this.session.close();
      this.session = void 0;
    }
    if (this.persistProgressTimer !== void 0) {
      window.clearTimeout(this.persistProgressTimer);
      this.persistProgressTimer = void 0;
      const pending = this.persistProgressPending;
      this.persistProgressPending = void 0;
      if (pending) await this.persistProgress(pending.fraction, pending.locator);
    }
    if (this.persistVisitedTimer !== void 0) {
      window.clearTimeout(this.persistVisitedTimer);
      this.persistVisitedTimer = void 0;
      await this.flushVisited();
    }
    this.selectionMenu?.destroy();
    this.selectionMenu = void 0;
    this.searchBar?.destroy();
    this.searchBar = void 0;
    this.notesPanel?.dispose();
    this.host = void 0;
    this.markReady();
    this.pendingSelection = void 0;
  }
  setEntry(entry) {
    this.entry = entry;
    this.currentSessionToken += 1;
    if (this.session) {
      this.pendingClosePromise = this.session.close().catch((error) => {
        console.warn("[ez-reader] failed to close previous session", error);
      });
      this.session = void 0;
    }
    this.pendingSelection = void 0;
    this.selectionMenu?.hide();
    this.markReady();
    if (this.host) {
      void this.openSession();
    } else {
      const tryOpen = () => {
        if (this.host && this.entry && !this.session) {
          void this.openSession();
        }
      };
      window.requestAnimationFrame(tryOpen);
      window.setTimeout(tryOpen, 100);
    }
  }
  /** Public entry point used by the obsidian:// protocol handler. */
  async openExcerptById(excerptId) {
    if (!this.entry) return;
    const tokenAtEntry = this.currentSessionToken;
    await this.whenReady();
    if (tokenAtEntry !== this.currentSessionToken) {
      return this.openExcerptById(excerptId);
    }
    const all = await this.deps.reading.listExcerpts(this.entry.book.id);
    const target = all.find((e3) => e3.id === excerptId);
    if (target) await this.jumpToExcerpt(target);
  }
  /**
   * Check whether the user has disabled progress memory in settings.
   * The flag lives on PluginSettings (rememberProgress). Defaults to
   * true so first-run users see the resume behaviour out of the box.
   */
  rememberProgress = true;
  async isProgressMemoryEnabled() {
    return this.rememberProgress;
  }
  /**
   * Resolves once the current reader session is ready to receive
   * commands (goTo / highlight / etc.). Used by the obsidian:// protocol
   * handler so the reverse-jump waits for the session to settle instead
   * of racing the async book-open.
   */
  readyPromise;
  readyResolve;
  // P0-1 修复: 30s 兜底 timer 必须保存 handle, 在 markReady / onClose /
  // setEntry 时 clear. 之前 fire-and-forget, view 关闭后 timer 还持有 view
  // 引用直到 30s 后 fire, 反复开关书会累积僵尸 timer.
  readyFallbackTimer;
  // P0-7 修复: setEntry 是 sync, 旧 session.close() 不能 fire-and-forget
  // (见 setEntry 注释). 这里存 promise 让后续 openSession / onClose await.
  pendingClosePromise;
  // C7 修复: setEntry / openSession 生成一个 token. whenReady / openExcerptById
  // await 完后, 还要检查 token 是不是还是当前 — 否则 await 的是旧 session,
  // 新 session 已经挂上去, 旧 awaiter 在新 session 上调 jumpToExcerpt 跳到
  // 错位置 (obsidian:// 协议 "回到原文" 链接的最常见 root cause).
  currentSessionToken = 0;
  markReady() {
    if (this.readyFallbackTimer !== void 0) {
      window.clearTimeout(this.readyFallbackTimer);
      this.readyFallbackTimer = void 0;
    }
    if (this.readyResolve) this.readyResolve();
    this.readyResolve = void 0;
    this.readyPromise = void 0;
  }
  whenReady() {
    if (this.session && !this.readyPromise) {
      return Promise.resolve();
    }
    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });
      this.readyFallbackTimer = window.setTimeout(() => {
        this.readyFallbackTimer = void 0;
        this.markReady();
      }, 3e4);
    }
    return this.readyPromise;
  }
  bindImmersiveToolbarToggle() {
    if (!this.host) return;
    let lastTouchY = 0;
    let lastTouchX = 0;
    let visibleTimer;
    const show = () => {
      const root = this.containerEl.children[1];
      root.addClass("is-toolbar-visible");
      if (visibleTimer !== void 0) window.clearTimeout(visibleTimer);
      visibleTimer = window.setTimeout(() => {
        if (this.isImmersive) root.removeClass("is-toolbar-visible");
      }, 2400);
    };
    const onTouchStart = (event) => {
      if (!this.isImmersive) return;
      const touch = event.touches[0];
      if (!touch) return;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    };
    const onTouchEnd = (event) => {
      if (!this.isImmersive) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dy = touch.clientY - lastTouchY;
      if (Math.abs(touch.clientY - lastTouchY) < 12 && Math.abs(touch.clientX - lastTouchX) < 12) {
        show();
        return;
      }
      if (dy > 30 && lastTouchY < 80) {
        show();
      }
    };
    const onMouseMove = (event) => {
      if (!this.isImmersive) return;
      if (event.clientY < 80) show();
    };
    this.host.addEventListener("touchstart", onTouchStart, { passive: true });
    this.host.addEventListener("touchend", onTouchEnd, { passive: true });
    this.host.addEventListener("mousemove", onMouseMove, { passive: true });
    this.register(() => {
      this.host?.removeEventListener("touchstart", onTouchStart);
      this.host?.removeEventListener("touchend", onTouchEnd);
      this.host?.removeEventListener("mousemove", onMouseMove);
      if (visibleTimer !== void 0) window.clearTimeout(visibleTimer);
    });
  }
  /**
   * P1: 阅读时长统计 — 监听 workspace 'active-leaf-change'. 当本 leaf
   * 成为 active 时记录开始时间, 失去 focus 时把累加 ms 写回 store。
   * 30s 防抖避免高频切窗造成 IO 风暴。
   */
  bindReadingTimeTracker() {
    const onLeafChange = () => {
      const now = Date.now();
      const isActive = this.deps.app.workspace.activeLeaf === this.leaf;
      if (isActive && this.activeSinceMs === null) {
        this.activeSinceMs = now;
      } else if (!isActive && this.activeSinceMs !== null) {
        const delta = now - this.activeSinceMs;
        this.activeSinceMs = null;
        if (delta >= 1e3) void this.flushReadingTime(delta);
      }
    };
    this.deps.app.workspace.on("active-leaf-change", onLeafChange);
    if (this.deps.app.workspace.activeLeaf === this.leaf) {
      this.activeSinceMs = Date.now();
    }
    this.register(() => {
      this.deps.app.workspace.off("active-leaf-change", onLeafChange);
      if (this.activeSinceMs !== null) {
        const delta = Date.now() - this.activeSinceMs;
        this.activeSinceMs = null;
        if (delta >= 1e3) void this.flushReadingTime(delta);
      }
    });
  }
  async flushReadingTime(deltaMs) {
    if (!this.entry) return;
    const now = Date.now();
    if (now - this.lastReadingFlushAt < 3e4 && deltaMs < 6e4) return;
    this.lastReadingFlushAt = now;
    try {
      const next = await this.deps.reading.addReadingTime(this.entry.book.id, deltaMs);
      this.entry = { ...this.entry, reading: next };
      this.toolbar?.update(this.toolbarState());
    } catch (error) {
      console.warn("[ez-reader] flushReadingTime failed", error);
    }
  }
  // ---- 键盘 ----
  bindKeyboardNavigation() {
    const handler = (event) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      if (this.tocPanel?.isVisible() && this.tocPanel.contains(event.target)) {
        return;
      }
      if (!this.session) return;
      const action = routeShortcut(event, this.shortcuts);
      if (action === null) return;
      this.runShortcutAction(action, event);
    };
    this.containerEl.addEventListener("keydown", handler, true);
    this.register(() => this.containerEl.removeEventListener("keydown", handler, true));
  }
  /**
   * Dispatch a routed shortcut to the actual handler. Kept separate from
   * `routeShortcut` so the router stays a pure function (testable).
   */
  runShortcutAction(action, event) {
    switch (action) {
      case "prev":
        event.preventDefault();
        void this.goToNext(-1);
        return;
      case "next":
        event.preventDefault();
        void this.goToNext(1);
        return;
      case "first":
        event.preventDefault();
        void this.seekFraction(0);
        return;
      case "last":
        event.preventDefault();
        void this.seekFraction(1);
        return;
      case "toggleNotes":
        event.preventDefault();
        void this.toggleNotes();
        return;
      case "toggleToc":
        event.preventDefault();
        void this.toggleToc();
        return;
      case "translate":
        event.preventDefault();
        void this.requestTranslation();
        return;
      case "excerpt":
        event.preventDefault();
        void this.saveExcerptFromSelection();
        return;
      case "quickHighlight":
        event.preventDefault();
        void this.quickHighlight();
        return;
      case "quickBookmark":
        event.preventDefault();
        void this.quickBookmark();
        return;
      case "toggleImmersive":
        event.preventDefault();
        this.toggleImmersive();
        return;
      case "showHelp":
        event.preventDefault();
        void this.showShortcutHelp();
        return;
      case "copySelection":
        event.preventDefault();
        this.copyCurrentSelection();
        return;
      case "openSearch":
        event.preventDefault();
        if (this.searchBarVisible) this.closeSearchBar();
        else this.openSearchBar();
        return;
      case "escape":
        let escapeHandled = false;
        if (this.searchBarVisible) {
          this.closeSearchBar();
          escapeHandled = true;
        } else if (this.selectionMenu?.isVisible()) {
          this.selectionMenu.hide();
          escapeHandled = true;
        } else if (this.translationDrawer?.isVisible()) {
          this.translationDrawer.hide();
          escapeHandled = true;
        } else if (this.tocPanel?.isVisible() || this.bookmarksPanel?.isVisible() || this.excerptsPanel?.isVisible() || this.notesPanel?.isVisible()) {
          this.hideAllPanels();
          escapeHandled = true;
        }
        if (escapeHandled) event.preventDefault();
        return;
    }
  }
  /** Copy current document selection to clipboard (Ctrl+C-style shortcut). */
  copyCurrentSelection() {
    const sel = window.document.getSelection();
    const text = sel?.toString() ?? "";
    if (!text) return;
    void this.copyTextToClipboard(text);
  }
  /**
   * Write `text` to the system clipboard and give a short Notice. Used by
   * both the keyboard shortcut and the selection menu — previously the
   * latter did not await and gave no feedback, so failures (clipboard
   * permission denied) were silent.
   */
  async copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      new import_obsidian16.Notice(`\u5DF2\u590D\u5236 (${text.length} \u5B57\u7B26)`, 1500);
    } catch (error) {
      console.warn("[ez-reader] copy failed", error);
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian16.Notice(`\u590D\u5236\u5931\u8D25: ${message}`, 4e3);
    }
  }
  /** Show keyboard shortcut help overlay. */
  async showShortcutHelp() {
    if (!this.shortcutHelpModal) {
      const { ShortcutHelpModal: ShortcutHelpModal2 } = await Promise.resolve().then(() => (init_ShortcutHelpModal(), ShortcutHelpModal_exports));
      this.shortcutHelpModal = new ShortcutHelpModal2(this.deps.app, this.shortcuts);
    }
    this.shortcutHelpModal.open();
  }
  bindSwipeGestures() {
    if (!this.host) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };
    const onEnd = (event) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      void this.goToNext(dx < 0 ? 1 : -1);
      event.preventDefault();
    };
    this.host.addEventListener("touchstart", onStart, { passive: true });
    this.host.addEventListener("touchend", onEnd, { passive: false });
    this.register(() => {
      this.host?.removeEventListener("touchstart", onStart);
      this.host?.removeEventListener("touchend", onEnd);
    });
  }
  // ---- session ----
  get isPdf() {
    return this.entry?.book.locator.format === "pdf";
  }
  // Zoom controls live on the PDF overlay (ReaderView doesn't render PDFs),
  // so there's no in-toolbar zoom cluster here. BookReaderSession.setScale /
  // setFitWidth remain on the port in case a future adapter (PDF+) needs them.
  async showFontSettings() {
    if (!this.session) return;
    const modal = new AppearanceModal(this.deps.app, this.appearance);
    const next = await modal.openAndWait();
    if (!next) return;
    this.appearance = next;
    await this.session.applyAppearance(next);
    this.applyTheme(next.theme);
    this.toolbar?.update(this.toolbarState());
  }
  applyTheme(theme) {
    const root = this.host?.closest(".ez-reader__reader") ?? this.containerEl;
    root.removeClass("ez-reader__theme-system", "ez-reader__theme-light", "ez-reader__theme-dark", "ez-reader__theme-sepia");
    root.addClass(`ez-reader__theme-${theme}`);
  }
  renderOpenError(error) {
    if (!this.host) return;
    this.host.empty();
    this.host.removeClass("ez-reader__pdf-stage");
    this.host.addClass("ez-reader__reader__error");
    const message = error instanceof Error ? error.message : String(error);
    this.host.createEl("h3", { text: "\u65E0\u6CD5\u6253\u5F00\u8FD9\u672C\u4E66" }).addClass("ez-reader__reader__error-title");
    this.host.createEl("p", { text: message }).addClass("ez-reader__reader__error-message");
    const stack = error instanceof Error ? error.stack : void 0;
    if (stack) {
      const details = this.host.createEl("details");
      details.createEl("summary", { text: "\u6280\u672F\u7EC6\u8282" });
      details.createEl("pre", { text: stack }).addClass("ez-reader__reader__error-stack");
    }
  }
  async openSession() {
    if (!this.entry || !this.host) return;
    if (this.pendingClosePromise) {
      await this.pendingClosePromise;
      this.pendingClosePromise = void 0;
    }
    const book = this.entry.book;
    const delegate = createContentDelegate(book.locator.format, {
      foliate: this.deps.foliate,
      textReader: this.deps.textReader
    });
    try {
      this.session = await delegate.mount(this.host, {
        book,
        appearance: this.appearance,
        loader: this.deps.bookBytesLoader
      });
    } catch (error) {
      console.error("[ez-reader] failed to open book", book.locator.path, error);
      this.renderOpenError(error);
      this.markReady();
      return;
    }
    this.deps.onBookOpened?.(this.entry);
    if (this.deps.library) {
      void this.deps.library.refreshMetadata(this.entry.book.id);
    }
    this.applyTheme(this.appearance.theme);
    this.toolbar?.update(this.toolbarState());
    const routeFromIframe = (event) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      const action = routeShortcut(event, this.shortcuts);
      if (action === null) return;
      this.runShortcutAction(action, event);
    };
    if (typeof this.session.setOnIframeKeydown === "function") {
      this.session.setOnIframeKeydown(routeFromIframe);
    }
    const progressEnabled = await this.isProgressMemoryEnabled();
    const stored = this.entry.reading.position;
    if (stored && progressEnabled) {
      try {
        await this.resumeFromPosition(stored);
      } catch (error) {
        console.warn("[ez-reader] failed to resume from stored position", error);
      }
    }
    const fraction = await this.session.currentFraction();
    this.fraction = fraction;
    try {
      const initialChapter = await this.session.currentChapter?.();
      if (initialChapter && initialChapter.trim()) {
        this.chapter = initialChapter.trim();
      }
    } catch (error) {
      console.warn("[ez-reader] currentChapter (initial) failed", error);
    }
    this.toolbar?.update(this.toolbarState());
    const offRelocate = this.session.on("relocate", (event) => {
      const detail = event.detail;
      if (typeof detail?.fraction === "number") {
        this.fraction = detail.fraction;
        const liveChapter = this.session?.currentChapter?.()?.trim?.() ?? "";
        let activeTocId = null;
        if (liveChapter) {
          this.chapter = liveChapter;
          if (this.tocItems.length > 0) {
            const match = this.tocItems.find((it2) => it2.label === liveChapter);
            if (match) {
              this.tocPanel?.setActive(match.id);
              activeTocId = match.id;
            }
          }
        } else if (detail.chapter) {
          this.chapter = detail.chapter;
          if (this.tocItems.length > 0) {
            const match = this.tocItems.find((it2) => it2.label === detail.chapter);
            if (match) {
              this.tocPanel?.setActive(match.id);
              activeTocId = match.id;
            }
          }
        }
        if (activeTocId && !this.tocFractions.has(activeTocId)) {
          this.tocFractions.set(activeTocId, detail.fraction);
          this.tocPanel?.setVisited(this.tocFractions.keys());
          this.schedulePersistVisited();
        }
        this.toolbar?.update(this.toolbarState());
        this.schedulePersistProgress(detail.fraction, detail.locator);
      }
    });
    const offLinkClick = this.session.on("link-click", (event) => {
      const detail = event.detail;
      if (!detail?.href) return;
      void this.handleLinkClick(detail.href);
    });
    let selectionDebounce;
    const offSelect = this.session.on("selection-change", (event) => {
      const detail = event.detail;
      if (!detail?.text) {
        if (selectionDebounce !== void 0) window.clearTimeout(selectionDebounce);
        selectionDebounce = void 0;
        this.selectionMenu?.hide();
        return;
      }
      const expanded = maybeExpandChineseSelection(detail.text);
      const text = expanded.text;
      this.pendingSelection = { text, rect: detail.rect, locator: detail.locator, chapter: this.chapter, fraction: this.fraction };
      if (text !== detail.text) {
        const sel = window.document.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const node = range.startContainer.parentNode;
          if (node && node.textContent?.includes(text)) {
            const newRange = document.createRange();
            const startOffset = (node.textContent ?? "").indexOf(text);
            if (startOffset >= 0) {
              newRange.setStart(node, startOffset);
              newRange.setEnd(node, startOffset + text.length);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }
        }
      }
      if (selectionDebounce !== void 0) window.clearTimeout(selectionDebounce);
      selectionDebounce = window.setTimeout(() => {
        selectionDebounce = void 0;
        const sel = window.document.getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0) : void 0;
        const rect = range?.getBoundingClientRect() ?? detail.rect;
        const hostOffset = this.findSessionIframeOffset();
        if (rect && rect.width > 0) {
          this.selectionMenu?.show(rect, hostOffset);
        } else {
          const fallbackRect = new DOMRect(
            window.innerWidth / 2 - 100,
            window.innerHeight - 120,
            200,
            40
          );
          this.selectionMenu?.show(fallbackRect, hostOffset);
        }
      }, 180);
    });
    if (this.session.tableOfContents) {
      try {
        this.tocItems = await this.session.tableOfContents();
        if (this.entry) {
          try {
            const persistedIds = await this.deps.reading.getVisitedTocIds(this.entry.book.id);
            for (const id of persistedIds) {
              if (!this.tocFractions.has(id)) {
                this.tocFractions.set(id, 0);
              }
            }
          } catch (error) {
            console.warn("[ez-reader] failed to load visited toc ids", error);
          }
        }
        this.tocPanel?.setToc(this.tocItems);
        this.tocPanel?.setVisited(this.tocFractions.keys());
      } catch (error) {
        console.warn("[ez-reader] failed to load TOC", error);
      }
    }
    const disposeOn = () => {
      offRelocate();
      offSelect();
      offLinkClick();
      if (selectionDebounce !== void 0) {
        window.clearTimeout(selectionDebounce);
        selectionDebounce = void 0;
      }
    };
    this.register(disposeOn);
    await this.restoreHighlights();
    this.markReady();
  }
  async resumeFromPosition(position) {
    if (!this.session) return;
    switch (position.kind) {
      case "reflow":
        if (position.cfi) {
          await this.session.goTo({ kind: "identifier", value: position.cfi });
        } else {
          await this.session.goTo({ kind: "fraction", fraction: position.fraction });
        }
        return;
      case "pdf":
        if (this.session.setScale && position.scale !== void 0) {
          await this.session.setScale(position.scale);
        } else if (this.session.setFitWidth) {
          await this.session.setFitWidth();
        }
        if (position.selection) {
          await this.session.goTo({ kind: "identifier", value: position.selection });
        } else {
          await this.session.goTo({ kind: "identifier", value: `page=${position.page}` });
        }
        return;
      case "text":
        await this.session.goTo({ kind: "fraction", fraction: position.fraction });
        return;
    }
  }
  async restoreHighlights() {
    if (!this.entry || !this.session?.highlight) return;
    const excerpts = await this.deps.reading.listExcerpts(this.entry.book.id);
    await Promise.all(excerpts.map(async (ex) => {
      let locator;
      if (ex.locator.position.kind === "reflow") {
        locator = ex.locator.position.cfi;
      } else if (ex.locator.position.kind === "pdf") {
        locator = ex.locator.position.selection ?? `page=${ex.locator.position.page}`;
      } else if (ex.locator.position.kind === "text") {
        const textPos = ex.locator.position;
        const session = this.session;
        if (!session) return;
        const totalRaw = session.totalPages ? session.totalPages() : null;
        const total = totalRaw ?? 1;
        const safeTotal = total > 0 ? total : 1;
        const pageIdx = Math.max(0, Math.min(safeTotal - 1, Math.floor(textPos.start * safeTotal)));
        locator = `paged-text:${pageIdx}`;
      }
      if (!locator) return;
      try {
        await this.session.highlight({
          id: ex.id,
          text: ex.text,
          locator,
          color: "yellow",
          createdAt: ex.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] failed to restore highlight", ex.id, error);
      }
    }));
  }
  /**
   * Returns the viewport offset between the session's iframe content
   * and the host document. Selection rects from inside an iframe are
   * iframe-viewport relative — to position a menu in the host viewport
   * we need to add this offset.
   *
   * `session.element` is the foliate-view web component, which is a
   * positioned overlay matching the host host's size and origin. We
   * assume the foliate iframe is rendered at the same offset (true in
   * practice for foliate-js 1.0.1 with `data-ez-reader-flow` set).
   *
   * P1-9: PagedTextSession (TXT / MOBI / AZW3) renders directly into the
   * host document (no iframe). Selection rects from inside its stage
   * are already host-viewport-relative — passing an offset would
   * double-shift the menu. We detect the non-iframe path via the
   * session.element's tag name and return undefined for it.
   */
  findSessionIframeOffset() {
    if (!this.session) return void 0;
    const el = this.session.element;
    if (el.tagName.toLowerCase() !== "foliate-view") return void 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return void 0;
    return { x: rect.left, y: rect.top };
  }
  toolbarState() {
    const tocMarkers = this.tocItems.map((item) => {
      const frac = this.tocFractions.get(item.id);
      return frac === void 0 ? null : { id: item.id, label: item.label, fraction: frac };
    }).filter((m3) => m3 !== null);
    return {
      fraction: this.fraction,
      chapter: this.chapter,
      status: this.entry?.reading.status ?? "unread",
      favorite: this.entry?.reading.favorite ?? false,
      showingBookmarks: this.bookmarksPanel?.isVisible?.() ?? false,
      showingExcerpts: this.excerptsPanel?.isVisible?.() ?? false,
      showingNotes: this.notesPanel?.isVisible?.() ?? false,
      showingToc: this.tocPanel?.isVisible?.() ?? false,
      showingImmersive: this.isImmersive,
      showFontSettings: true,
      bookmarkCount: this.bookmarkCount,
      excerptCount: this.excerptCount,
      currentPage: this.session?.currentPage?.() ?? null,
      totalPages: this.session?.totalPages?.() ?? null,
      searchOpen: this.searchBarVisible,
      searchMatchCount: this.searchMatchCount,
      totalReadingMs: this.entry?.reading.totalReadingMs ?? 0,
      tocMarkers
    };
  }
  // ---- 翻页 / 跳转 ----
  async goToNext(direction) {
    if (!this.session) return;
    this.selectionMenu?.hide();
    const sel = window.document.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    await this.session.goTo(direction === 1 ? { kind: "next" } : { kind: "previous" });
  }
  async seekFraction(fraction) {
    if (!this.session) return;
    await this.session.goTo({ kind: "fraction", fraction });
  }
  async jumpToTocItem(item) {
    if (!this.session?.goToToc) return;
    await this.session.goToToc(item.id);
    this.tocPanel?.setActive(item.id);
  }
  /** P2: 进度条下方章节标记点点击 — 通过 id 直接跳. */
  async jumpToTocById(id) {
    const item = this.tocItems.find((it2) => it2.id === id);
    if (item) await this.jumpToTocItem(item);
  }
  /**
   * P1 polish: route intra-book link clicks (PagedTextSession dispatches
   * "link-click" when the user clicks an `<a data-ez-reader-href>`).
   * Resolution strategy:
   *   1. Prefer `goToSpineId(href)` — PagedTextSession looks it up in
   *      pages[].id. Works for MOBI 9-digit spine ids and any other
   *      intra-book path.
   *   2. Fall back to `goToToc(href)` — the href may already be a TOC id
   *      like "toc-3" if the engine happens to emit one.
   *   3. Fall back to `goTo({kind:"identifier", value: href})` — generic
   *      engine-native routing (e.g. EPUB's own goTo accepts a CFI).
   *   4. Last resort: numeric fraction if the href is a number.
   * Failures are silent — the link may point outside the book (we
   * rewrote href → data-ez-reader-href, so external URLs should already
   * be filtered out by sanitizeHtml).
   */
  async handleLinkClick(href) {
    if (!this.session) return;
    const target = href.includes("#") ? href.split("#")[0] : href;
    if (!target) return;
    if (this.session.goToSpineId) {
      await this.session.goToSpineId(target);
      return;
    }
    if (this.session.goToToc) {
      const tocMatch = this.tocItems.find((t3) => t3.id === target);
      if (tocMatch) {
        await this.session.goToToc(tocMatch.id);
        this.tocPanel?.setActive(tocMatch.id);
        return;
      }
    }
    if (/^\d+$/.test(target)) {
      await this.session.goTo({ kind: "identifier", value: target });
      return;
    }
    console.warn("[ez-reader] link click unhandled", href);
  }
  /**
   * C1 修复: 把 `void this.persistProgress(...)` 改成 schedule + debounce.
   * relocate 风暴期间只保留最后一次;fraction 跨过 0.01 (1%) 阈值时也会
   * 立即 flush (防止用户拖到底部,debounce 期间关 vault 丢最后一段进度).
   */
  schedulePersistProgress(fraction, locator) {
    const pending = this.persistProgressPending;
    const distance = pending ? Math.abs(pending.fraction - fraction) : 0;
    if (pending === void 0 || distance >= 0.01) {
      this.persistProgressPending = { fraction, locator };
      if (this.persistProgressTimer !== void 0) {
        window.clearTimeout(this.persistProgressTimer);
      }
      this.persistProgressTimer = window.setTimeout(() => {
        this.persistProgressTimer = void 0;
        const next = this.persistProgressPending;
        if (next) {
          this.persistProgressPending = void 0;
          void this.persistProgress(next.fraction, next.locator);
        }
      }, 300);
    } else {
      this.persistProgressPending = { fraction, locator };
    }
  }
  async persistProgress(fraction, locator) {
    if (!this.entry) return;
    const exported = await this.session?.exportLocator();
    const finalLocator = locator ?? exported;
    let position;
    if (this.isPdf && this.session?.currentPage) {
      const pdfSelection = typeof finalLocator === "string" && finalLocator.startsWith("#page=") ? finalLocator : void 0;
      position = {
        kind: "pdf",
        page: this.session.currentPage() ?? 1,
        scale: this.session.currentScale?.(),
        fitWidth: this.session.isFitWidth?.(),
        ...pdfSelection ? { selection: pdfSelection } : {}
      };
    } else if (typeof finalLocator === "string" && finalLocator.startsWith("paged-text:")) {
      const pageIdx = Number(finalLocator.slice("paged-text:".length)) || 0;
      const session = this.session;
      const totalRaw = session && session.totalPages ? session.totalPages() : null;
      const total = totalRaw ?? 1;
      const safeTotal = total > 0 ? total : 1;
      const start = pageIdx / safeTotal;
      const end = (pageIdx + 1) / safeTotal;
      position = { kind: "text", fraction, start, end };
    } else if (finalLocator) {
      position = { kind: "reflow", fraction, cfi: finalLocator };
    } else {
      position = { kind: "reflow", fraction };
    }
    try {
      await this.deps.reading.updatePosition(this.entry.book.id, position);
    } catch (error) {
      console.warn("[ez-reader] persistProgress failed", error);
      const now = Date.now();
      if (now - this.lastProgressFailureNoticeAt > 5e3) {
        this.lastProgressFailureNoticeAt = now;
        new import_obsidian16.Notice("\u4FDD\u5B58\u9605\u8BFB\u8FDB\u5EA6\u5931\u8D25,\u7A0D\u540E\u91CD\u8BD5");
      }
    }
  }
  /**
   * P2: schedule visited toc ids 写盘 — 每次 tocFractions 新增 id 时
   * 调一次, debounce 300ms 后真写. 跟 schedulePersistProgress 用同一个
   * 时间常量但独立 timer, 两件事互不影响. 如果 300ms 内没有新 id 进来,
   * timer 自然到期写一次; 反复 schedule 重复就 reset timer.
   */
  schedulePersistVisited() {
    if (this.persistVisitedTimer !== void 0) {
      window.clearTimeout(this.persistVisitedTimer);
    }
    this.persistVisitedTimer = window.setTimeout(() => {
      this.persistVisitedTimer = void 0;
      void this.flushVisited();
    }, 300);
  }
  /**
   * P2: 把当前 tocFractions keys 跟上次 flush 过的 snapshot 比对, 不
   * 同才写盘. 没 entry 直接返回. 失败只 warn (跟 persistProgress 一
   * 样不弹 Notice, 避免刷屏).
   */
  async flushVisited() {
    if (!this.entry) return;
    const ids = Array.from(this.tocFractions.keys());
    if (ids.length === this.persistVisitedLastSnapshot.length && ids.every((id, i3) => id === this.persistVisitedLastSnapshot[i3])) {
      return;
    }
    try {
      await this.deps.reading.saveVisitedTocIds(this.entry.book.id, ids);
      this.persistVisitedLastSnapshot = ids;
    } catch (error) {
      console.warn("[ez-reader] flushVisited failed", error);
    }
  }
  // ---- 书签 ----
  async addBookmarkAtCurrentPosition() {
    if (!this.entry) return;
    const { BookmarkModal: BookmarkModal2 } = await Promise.resolve().then(() => (init_BookmarkModal(), BookmarkModal_exports));
    const preview = this.pendingSelection?.text ?? (this.chapter ? this.chapter : "") ?? "";
    const modal = new BookmarkModal2(this.deps.app, {
      chapter: this.chapter ?? "",
      fraction: this.fraction,
      preview: preview.length > 80 ? `${preview.slice(0, 80)}\u2026` : preview,
      timestamp: Date.now()
    });
    const label = await modal.openAndWait();
    if (label === null) return;
    await this.addBookmarkCore(label, false);
  }
  /**
   * "Quick bookmark" (按 B) — 不弹 modal, 用 chapter + percentage + 时间
   * 作自动 label, 用户后续可在 BookmarksPanel 重命名 (TODO: 待面板支持
   * inline rename 后, 体验再上一层). 设计动机: 微信读书 / Apple Books
   * 都没有"加书签"弹窗, 都是一键加入 + 后续命名 — 弹窗打断阅读流.
   */
  async quickBookmark() {
    if (!this.entry) return;
    const autoLabel = composeQuickBookmarkLabel(this.chapter, this.fraction);
    await this.addBookmarkCore(autoLabel, true);
  }
  /** 共享的 bookmark 保存逻辑, modal flow 和 quick flow 都走这里. */
  async addBookmarkCore(label, quick) {
    if (!this.entry) return;
    const locator = await this.session?.exportLocator();
    if (!locator) {
      new import_obsidian16.Notice("\u65E0\u6CD5\u83B7\u53D6\u5F53\u524D\u4F4D\u7F6E \u2014 \u4E66\u7B7E\u672A\u4FDD\u5B58");
      return;
    }
    try {
      await this.deps.reading.addBookmark({
        id: generateExcerptId("bm"),
        bookId: this.entry.book.id,
        label,
        locator: { position: { kind: "reflow", fraction: this.fraction, cfi: locator }, chapter: this.chapter },
        createdAt: Date.now()
      });
    } catch (error) {
      console.warn("[ez-reader] addBookmark failed", error);
      new import_obsidian16.Notice("\u6DFB\u52A0\u4E66\u7B7E\u5931\u8D25");
      return;
    }
    await this.refreshPanels();
    new import_obsidian16.Notice(quick ? `\u{1F4D1} \u5DF2\u52A0\u4E66\u7B7E (\u6309 ? \u770B\u5FEB\u6377\u952E)` : "\u4E66\u7B7E\u5DF2\u6DFB\u52A0", 1800);
  }
  async toggleBookmarks() {
    if (!this.bookmarksPanel) return;
    if (this.bookmarksPanel.isVisible()) {
      this.bookmarksPanel.hide();
    } else {
      this.bookmarksPanel.show();
      this.excerptsPanel?.hide();
    }
    await this.refreshPanels();
    this.toolbar?.update(this.toolbarState());
  }
  async toggleExcerpts() {
    if (!this.excerptsPanel) return;
    if (this.excerptsPanel.isVisible()) {
      this.excerptsPanel.hide();
    } else {
      this.excerptsPanel.show();
      this.bookmarksPanel?.hide();
    }
    await this.refreshPanels();
    this.toolbar?.update(this.toolbarState());
  }
  toggleToc() {
    if (!this.tocPanel) return;
    this.tocPanel.toggle();
    this.toolbar?.update(this.toolbarState());
  }
  toggleNotes() {
    if (!this.notesPanel) return;
    this.notesPanel.toggle();
    this.toolbar?.update(this.toolbarState());
  }
  /** 关闭所有侧边 panel — panel header 上的 × 按钮和 Esc 键都走这个. */
  hideAllPanels() {
    this.bookmarksPanel?.hide();
    this.excerptsPanel?.hide();
    this.tocPanel?.hide();
    this.notesPanel?.hide();
    this.toolbar?.update(this.toolbarState());
  }
  toggleImmersive() {
    this.isImmersive = !this.isImmersive;
    const root = this.containerEl.children[1];
    root.toggleClass("ez-reader__immersive", this.isImmersive);
    if (this.isImmersive) {
      this.ensureImmersiveExitButton(root);
    } else {
      root.querySelector(".ez-reader__immersive-exit")?.remove();
    }
    this.toolbar?.update(this.toolbarState());
  }
  /** 在 container 里加一个 immersive-exit × 按钮 (如果还没建). */
  ensureImmersiveExitButton(container) {
    if (container.querySelector(".ez-reader__immersive-exit")) return;
    const exitBtn = container.createEl("button", {
      cls: "ez-reader__immersive-exit",
      attr: { type: "button", "aria-label": "\u9000\u51FA\u6C89\u6D78\u6A21\u5F0F", title: "\u9000\u51FA\u6C89\u6D78\u6A21\u5F0F (Esc)" },
      text: "\xD7"
    });
    exitBtn.addEventListener("click", () => {
      this.isImmersive = false;
      container.removeClass("ez-reader__immersive");
      exitBtn.remove();
      this.toolbar?.update(this.toolbarState());
    });
  }
  async cycleStatus() {
    if (!this.entry) return;
    const order = ["unread", "reading", "finished", "abandoned"];
    const current = this.entry.reading.status;
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length] ?? "unread";
    try {
      const updated = await this.deps.reading.setStatus(this.entry.book.id, next);
      this.entry = { ...this.entry, reading: updated };
      this.toolbar?.update(this.toolbarState());
    } catch (error) {
      console.warn("[ez-reader] cycleStatus failed", error);
      new import_obsidian16.Notice("\u66F4\u65B0\u9605\u8BFB\u72B6\u6001\u5931\u8D25");
    }
  }
  async toggleFavorite() {
    if (!this.entry) return;
    try {
      const updated = await this.deps.reading.toggleFavorite(this.entry.book.id);
      this.entry = { ...this.entry, reading: updated };
      this.toolbar?.update(this.toolbarState());
    } catch (error) {
      console.warn("[ez-reader] toggleFavorite failed", error);
      new import_obsidian16.Notice("\u66F4\u65B0\u6536\u85CF\u72B6\u6001\u5931\u8D25");
    }
  }
  async refreshPanels() {
    if (!this.entry) return;
    const [bookmarks, excerpts] = await Promise.all([
      this.deps.reading.listBookmarks(this.entry.book.id),
      this.deps.reading.listExcerpts(this.entry.book.id)
    ]);
    this.bookmarkCount = bookmarks.length;
    this.excerptCount = excerpts.length;
    this.bookmarksPanel?.setBookmarks(bookmarks);
    this.excerptsPanel?.setExcerpts(excerpts);
    this.notesPanel?.setEntries(excerpts);
    this.toolbar?.update(this.toolbarState());
  }
  async jumpToBookmark(bookmark) {
    if (!this.session) return;
    if (bookmark.locator.position.kind === "reflow" && bookmark.locator.position.cfi) {
      await this.session.goTo({ kind: "identifier", value: bookmark.locator.position.cfi });
    } else {
      await this.session.goTo({ kind: "fraction", fraction: bookmark.locator.position.kind === "reflow" ? bookmark.locator.position.fraction : 0 });
    }
  }
  async removeBookmark(bookmark) {
    if (!this.entry) return;
    try {
      await this.deps.reading.removeBookmark(this.entry.book.id, bookmark.id);
    } catch (error) {
      console.warn("[ez-reader] removeBookmark failed", error);
      new import_obsidian16.Notice("\u5220\u9664\u4E66\u7B7E\u5931\u8D25");
      return;
    }
    await this.refreshPanels();
    new import_obsidian16.Notice("\u4E66\u7B7E\u5DF2\u5220\u9664", 1500);
  }
  async jumpToExcerpt(excerpt) {
    if (!this.session) return;
    const pos = excerpt.locator.position;
    if (pos.kind === "reflow" && pos.cfi) {
      await this.session.goTo({ kind: "identifier", value: pos.cfi });
    } else if (pos.kind === "pdf") {
      const target = pos.selection ?? `page=${pos.page}`;
      await this.session.goTo({ kind: "identifier", value: target });
    } else if (pos.kind === "reflow" || pos.kind === "text") {
      await this.session.goTo({ kind: "fraction", fraction: pos.fraction });
    }
  }
  async removeExcerpt(excerpt) {
    if (!this.entry) return;
    try {
      await this.deps.reading.removeExcerpt(this.entry.book.id, excerpt.id);
    } catch (error) {
      console.warn("[ez-reader] removeExcerpt failed", error);
      new import_obsidian16.Notice("\u5220\u9664\u6458\u5F55\u5931\u8D25");
      return;
    }
    if (this.session?.removeHighlight) {
      try {
        await this.session.removeHighlight(excerpt.id);
      } catch {
      }
    }
    await this.refreshPanels();
    new import_obsidian16.Notice("\u6458\u5F55\u5DF2\u5220\u9664", 1500);
  }
  async editExcerpt(excerpt) {
    const modal = new ThoughtModal(this.deps.app, {
      text: excerpt.text,
      chapter: excerpt.locator.chapter
    });
    const submit = await modal.openAndWait();
    if (!submit || !this.entry) return;
    try {
      await this.deps.reading.updateExcerptNote(this.entry.book.id, excerpt.id, {
        note: submit.note,
        tags: submit.tags
      });
    } catch (error) {
      console.warn("[ez-reader] editExcerpt failed", error);
      new import_obsidian16.Notice("\u7F16\u8F91\u6458\u5F55\u5931\u8D25");
      return;
    }
    await this.refreshPanels();
    new import_obsidian16.Notice("\u6458\u5F55\u5DF2\u66F4\u65B0", 1500);
  }
  /**
   * P2: inline note patch — 用户在 SidebarNotesPanel 点 note 直接编辑,
   * blur 自动保存. 只改 note 字段, 不动 locator / text / tags.
   * 失败抛出 (UI 会回滚).
   */
  async updateExcerptNoteInline(excerpt, note) {
    if (!this.entry) throw new Error("no entry");
    await this.deps.reading.updateExcerptNote(this.entry.book.id, excerpt.id, { note });
    await this.refreshPanels();
  }
  async saveExcerptFromSelection() {
    if (!this.entry || !this.pendingSelection) return;
    const { ExcerptModal: ExcerptModal2 } = await Promise.resolve().then(() => (init_ExcerptModal(), ExcerptModal_exports));
    const modal = new ExcerptModal2(this.deps.app, { text: this.pendingSelection.text });
    const submit = await modal.openAndWait();
    if (!submit) return;
    await this.saveExcerptCore(this.pendingSelection.text, submit.note, submit.tags, false);
  }
  /**
   * "Quick highlight" (按 H, 不带 shift) — 选中文本后按 H 直接保存摘录
   * + 黄色高亮, 不弹 modal. label 截断到 30 字符 (中文按字符 / 英文按词
   * 边界), 跟 Notion / Readwise 的快速摘录一致.
   *
   * 注意: 只在有选词 (`pendingSelection`) 时才生效. 没有选词按 H 忽略
   * (避免误触); 用户想要 modal 流程继续按 Shift+H.
   */
  async quickHighlight() {
    if (!this.entry || !this.pendingSelection) {
      new import_obsidian16.Notice("\u5148\u9009\u4E00\u6BB5\u6587\u5B57\u518D\u6309 H", 2e3);
      return;
    }
    const note = "";
    await this.saveExcerptCore(this.pendingSelection.text, note, [], true);
  }
  /** 共享 excerpt 保存逻辑, modal flow 和 quick flow 都走这里. */
  async saveExcerptCore(text, note, tags, quick) {
    if (!this.entry) return;
    const excerptId = generateExcerptId("ex");
    const locator = this.pendingSelection?.locator ?? await this.session?.exportLocator() ?? void 0;
    if (!locator) {
      new import_obsidian16.Notice("\u65E0\u6CD5\u83B7\u53D6\u9009\u533A\u4F4D\u7F6E \u2014 \u6458\u5F55\u672A\u4FDD\u5B58");
      return;
    }
    const pos = this.isPdf && this.session?.currentPage ? {
      kind: "pdf",
      page: this.session.currentPage() ?? 1,
      ...typeof locator === "string" && locator.startsWith("#page=") ? { selection: locator } : {}
    } : { kind: "reflow", fraction: this.pendingSelection?.fraction ?? this.fraction, cfi: locator };
    const excerpt = {
      id: excerptId,
      bookId: this.entry.book.id,
      text,
      locator: { position: pos, chapter: this.chapter },
      note,
      tags,
      createdAt: Date.now()
    };
    try {
      await this.deps.reading.addExcerpt(excerpt);
    } catch (error) {
      console.warn("[ez-reader] addExcerpt failed", error);
      new import_obsidian16.Notice("\u4FDD\u5B58\u6458\u5F55\u5931\u8D25");
      return;
    }
    if (this.session?.highlight) {
      try {
        await this.session.highlight({
          id: excerptId,
          text,
          locator,
          color: "yellow",
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] session.highlight failed", error);
      }
    }
    if (this.deps.noteWriter) {
      try {
        const ref = await this.deps.noteWriter.ensureBookNote({
          bookId: this.entry.book.id,
          bookTitle: this.entry.book.metadata?.title ?? this.entry.book.locator.path,
          bookPath: this.entry.book.locator.path
        });
        await this.deps.noteWriter.appendExcerpt(ref, {
          excerptId,
          text: excerpt.text,
          note: excerpt.note,
          tags: excerpt.tags,
          locator: locatorForNoteWriter(pos),
          chapterTitle: excerpt.locator.chapter,
          format: this.entry.book.locator.format,
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
        new import_obsidian16.Notice("\u5199\u5165\u7B14\u8BB0\u5931\u8D25 (\u6458\u5F55\u5DF2\u4FDD\u5B58)");
      }
    }
    await this.refreshPanels();
    this.notesPanel?.flashLast(excerptId);
    new import_obsidian16.Notice(quick ? `\u{1F58D} \u5DF2\u9AD8\u4EAE (\u6309 ? \u770B\u5FEB\u6377\u952E)` : "\u6458\u5F55\u5DF2\u4FDD\u5B58", 1800);
  }
  async saveThoughtFromSelection() {
    if (!this.entry || !this.pendingSelection) return;
    await this.saveThoughtCore(this.pendingSelection.text, this.pendingSelection.locator);
  }
  async openFreeThoughtModal() {
    if (!this.entry) return;
    const locator = await this.session?.exportLocator();
    await this.saveThoughtCore(void 0, locator ?? void 0);
  }
  async saveThoughtCore(text, locator) {
    if (!this.entry) return;
    const modal = new ThoughtModal(this.deps.app, {
      text: text ?? "",
      chapter: this.chapter
    });
    const submit = await modal.openAndWait();
    if (!submit) return;
    const excerptId = generateExcerptId("th");
    const thoughtFraction = text !== void 0 ? this.pendingSelection?.fraction ?? this.fraction : this.fraction;
    const pos = this.isPdf && this.session?.currentPage ? {
      kind: "pdf",
      page: this.session.currentPage() ?? 1,
      ...typeof locator === "string" && locator.startsWith("#page=") ? { selection: locator } : {}
    } : { kind: "reflow", fraction: thoughtFraction, cfi: locator };
    const excerpt = {
      id: excerptId,
      bookId: this.entry.book.id,
      text: text ?? "",
      locator: { position: pos, chapter: this.chapter },
      note: submit.note,
      tags: submit.tags,
      createdAt: Date.now()
    };
    try {
      await this.deps.reading.addExcerpt(excerpt);
    } catch (error) {
      console.warn("[ez-reader] saveThought addExcerpt failed", error);
      new import_obsidian16.Notice("\u4FDD\u5B58\u60F3\u6CD5\u5931\u8D25");
      return;
    }
    if (this.deps.noteWriter) {
      try {
        const ref = await this.deps.noteWriter.ensureBookNote({
          bookId: this.entry.book.id,
          bookTitle: this.entry.book.metadata?.title ?? this.entry.book.locator.path,
          bookPath: this.entry.book.locator.path
        });
        await this.deps.noteWriter.appendExcerpt(ref, {
          excerptId,
          text: excerpt.text,
          note: excerpt.note,
          tags: excerpt.tags,
          locator: locatorForNoteWriter(pos),
          chapterTitle: excerpt.locator.chapter,
          format: this.entry.book.locator.format,
          createdAt: excerpt.createdAt
        });
      } catch (error) {
        console.warn("[ez-reader] noteWriter.appendExcerpt failed", error);
        new import_obsidian16.Notice("\u5199\u5165\u7B14\u8BB0\u5931\u8D25 (\u60F3\u6CD5\u5DF2\u4FDD\u5B58)");
      }
    }
    await this.refreshPanels();
    this.notesPanel?.flashLast(excerptId);
    new import_obsidian16.Notice("\u60F3\u6CD5\u5DF2\u4FDD\u5B58", 1500);
  }
  copySelectionToClipboard() {
    const selection = this.pendingSelection?.text;
    if (!selection) return;
    void this.copyTextToClipboard(selection);
  }
  async requestTranslation() {
    if (!this.pendingSelection || !this.translationDrawer) return;
    await this.translationDrawer.translate(this.pendingSelection.text);
  }
  /**
   * P1: 打开 find-in-book 搜索栏 — 跟 ReaderSelectionMenu 同级, 浮在
   * reader 顶部。让用户立刻开始打字。再次触发 / Esc 关闭。
   */
  openSearchBar() {
    if (!this.searchBar) return;
    this.searchBarVisible = true;
    this.searchBar.show();
    this.toolbar?.update(this.toolbarState());
  }
  closeSearchBar() {
    if (!this.searchBar) return;
    this.searchBarVisible = false;
    this.searchMatchCount = null;
    this.searchBar.hide();
    this.toolbar?.update(this.toolbarState());
  }
  async runFindInBook(query, fromStart) {
    if (!this.session || typeof this.session.findInBook !== "function") {
      this.closeSearchBar();
      new import_obsidian16.Notice("\u5F53\u524D\u683C\u5F0F\u6682\u4E0D\u652F\u6301\u641C\u7D22");
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      this.searchMatchCount = null;
      this.toolbar?.update(this.toolbarState());
      return;
    }
    try {
      const count = await this.session.findInBook(trimmed, fromStart);
      this.searchMatchCount = count;
      this.toolbar?.update(this.toolbarState());
      if (count === 0) {
        new import_obsidian16.Notice(`\u672A\u627E\u5230 "${trimmed}"`);
      } else if (fromStart) {
        new import_obsidian16.Notice(`\u627E\u5230 ${count} \u5904\u5339\u914D (\u4ECE\u9996\u5904\u5F00\u59CB)`);
      } else {
        new import_obsidian16.Notice(`\u5339\u914D ${this.findCursorDisplay(count)} / ${count}`);
      }
    } catch (error) {
      console.warn("[ez-reader] findInBook failed", error);
      new import_obsidian16.Notice("\u641C\u7D22\u5931\u8D25");
      this.closeSearchBar();
    }
  }
  /**
   * 用户按 Enter (fromStart) vs Enter again (next) 时显示不同文案 ——
   * 复用一个 cursor 但要从 toolbar badge 推断 index。这里简化: 不暴露
   * cursor index,只显示 total, 跟 Kindle 类似。
   */
  findCursorDisplay(_total) {
    return "\u4E0B\u4E00\u5904";
  }
  async saveTranslationAsNote(source, translated) {
    if (!this.entry) return;
    const text = `> ${source.replace(/\n/g, "\n> ")}

**\u7FFB\u8BD1**:

${translated}`;
    await this.saveThoughtCore(text, this.pendingSelection?.locator);
  }
};

// src/ui/settings/SettingsTab.ts
var import_obsidian17 = require("obsidian");

// src/core/types/Locale.ts
var UI_LOCALES = [
  { code: "zh-CN", label: "\u7B80\u4F53\u4E2D\u6587" },
  { code: "zh-TW", label: "\u7E41\u9AD4\u4E2D\u6587" },
  { code: "en", label: "English" },
  { code: "fr", label: "Fran\xE7ais" }
];
var isUiLocale = (value) => value === "zh-CN" || value === "zh-TW" || value === "en" || value === "fr";

// src/ui/settings/SettingsTab.ts
var THEMES2 = ["system", "light", "dark", "sepia"];
var themeLabel2 = (theme) => {
  switch (theme) {
    case "light":
      return "\u6D45\u8272";
    case "dark":
      return "\u6DF1\u8272";
    case "sepia":
      return "\u7C73\u9EC4";
    default:
      return "\u8DDF\u968F\u7CFB\u7EDF";
  }
};
var debounceAsync = (fn, ms = 300) => {
  let timer;
  let pendingArgs;
  let hasPending = false;
  const invoke = async () => {
    timer = void 0;
    if (hasPending && pendingArgs) {
      hasPending = false;
      const args = pendingArgs;
      pendingArgs = void 0;
      try {
        await fn(...args);
      } catch (error) {
        console.error("[ez-reader] debounced settings save failed", error);
      }
    }
  };
  const debounced = (...args) => {
    pendingArgs = args;
    hasPending = true;
    if (timer !== void 0) window.clearTimeout(timer);
    timer = window.setTimeout(() => void invoke(), ms);
  };
  debounced.flush = async () => {
    if (timer !== void 0) window.clearTimeout(timer);
    await invoke();
  };
  debounced.cancel = () => {
    if (timer !== void 0) window.clearTimeout(timer);
    timer = void 0;
    hasPending = false;
    pendingArgs = void 0;
  };
  return debounced;
};
var SettingsTab = class extends import_obsidian17.PluginSettingTab {
  constructor(app, plugin, annotations, providers = []) {
    super(app, plugin);
    this.annotations = annotations;
    this.providerMap = new Map(providers.map((p3) => [p3.id, p3]));
  }
  // TODO(community-plugin-review): PluginSettingTab 建议实现 getSettingDefinitions()
  // 以走 Obsidian 的声明式设置 API。当前我们手写 render() 路径,
  // 重构成声明式是较大的改动 — 留作后续 P2 polish, 本次 lint 清理不改行为.
  providerMap;
  // Slider drag + continuous text input fire dozens of onChange per
  // second. Without debouncing they race against each other in IO. Each
  // render() creates fresh debouncers and we cancel the previous batch so
  // pending writes from the previous render don't leak after the user
  // navigates to a different tab.
  activeDebouncers = [];
  findProviderMeta(providerId) {
    if (providerId === "none") return null;
    const provider = this.providerMap.get(providerId);
    if (!provider) return null;
    return {
      signupUrl: provider.signupUrl,
      signupHint: provider.signupHint
    };
  }
  display() {
    const { containerEl } = this;
    const flushes = this.activeDebouncers.map((d2) => d2.flush());
    this.activeDebouncers = [];
    void Promise.allSettled(flushes);
    containerEl.empty();
    containerEl.addClass("ez-reader__settings");
    this.renderAppearanceSection(containerEl);
    this.renderReadingSection(containerEl);
    this.renderNotesSection(containerEl);
    this.renderTranslationSection(containerEl);
    this.renderUISection(containerEl);
    this.renderAboutSection(containerEl);
  }
  /**
   * Wrap an async save function in a trailing-edge debouncer and register
   * it for cancellation on the next render(). Toggle / dropdown changes
   * are discrete and don't need this — only sliders and continuous text
   * inputs do.
   */
  debounceSave(fn, ms = 300) {
    const d2 = debounceAsync(fn, ms);
    this.activeDebouncers.push(d2);
    return d2;
  }
  async loadSettings() {
    return this.annotations.listSettings();
  }
  // ---- 默认阅读外观 ----
  renderAppearanceSection(containerEl) {
    new import_obsidian17.Setting(containerEl).setName("\u9ED8\u8BA4\u9605\u8BFB\u5916\u89C2").setHeading();
    const saveFontSize = this.debounceSave(async (value) => {
      await this.annotations.patchSettings((s3) => ({
        ...s3,
        defaultAppearance: { ...s3.defaultAppearance, fontSize: value }
      }));
    });
    const saveLineHeight = this.debounceSave(async (value) => {
      await this.annotations.patchSettings((s3) => ({
        ...s3,
        defaultAppearance: { ...s3.defaultAppearance, lineHeight: value }
      }));
    });
    const saveMargin = this.debounceSave(async (value) => {
      await this.annotations.patchSettings((s3) => ({
        ...s3,
        defaultAppearance: { ...s3.defaultAppearance, margin: value }
      }));
    });
    new import_obsidian17.Setting(containerEl).setName("\u5B57\u53F7").setDesc("\u9ED8\u8BA4 100%; \u8303\u56F4 60%-200%").addSlider(
      (slider) => slider.setLimits(60, 200, 5).setValue(DEFAULT_READER_APPEARANCE.fontSize).onChange((value) => saveFontSize(value))
    );
    new import_obsidian17.Setting(containerEl).setName("\u884C\u8DDD").setDesc("\u9ED8\u8BA4 1.6; \u8303\u56F4 1.0-2.4").addSlider(
      (slider) => slider.setLimits(1, 2.4, 0.1).setValue(DEFAULT_READER_APPEARANCE.lineHeight).onChange((value) => saveLineHeight(value))
    );
    new import_obsidian17.Setting(containerEl).setName("\u9875\u8FB9\u8DDD").setDesc("\u9ED8\u8BA4 32px; \u8303\u56F4 0-80px").addSlider(
      (slider) => slider.setLimits(0, 80, 4).setValue(DEFAULT_READER_APPEARANCE.margin).onChange((value) => saveMargin(value))
    );
    new import_obsidian17.Setting(containerEl).setName("\u9ED8\u8BA4\u4E3B\u9898").setDesc("\u65B0\u4E66\u6253\u5F00\u65F6\u4F7F\u7528\u7684\u4E3B\u9898").addDropdown((dropdown) => {
      for (const theme of THEMES2) {
        dropdown.addOption(theme, themeLabel2(theme));
      }
      void this.loadSettings().then((s3) => {
        dropdown.setValue(s3.defaultAppearance.theme);
      });
      dropdown.onChange(async (value) => {
        if (!THEMES2.includes(value)) return;
        await this.annotations.patchSettings((s3) => ({
          ...s3,
          defaultAppearance: { ...s3.defaultAppearance, theme: value }
        }));
      });
    });
    new import_obsidian17.Setting(containerEl).setName("\u9ED8\u8BA4\u6392\u7248").setDesc("paginated = \u5355\u9875\u7FFB\u9875; scrolled = \u6EDA\u5C4F").addDropdown((dropdown) => {
      dropdown.addOption("paginated", "\u5355\u9875\u7FFB\u9875");
      dropdown.addOption("scrolled", "\u8FDE\u7EED\u6EDA\u5C4F");
      void this.loadSettings().then((s3) => {
        dropdown.setValue(s3.defaultAppearance.flow);
      });
      dropdown.onChange(async (value) => {
        if (value !== "paginated" && value !== "scrolled") return;
        await this.annotations.patchSettings((s3) => ({
          ...s3,
          defaultAppearance: { ...s3.defaultAppearance, flow: value }
        }));
      });
    });
  }
  // ---- 阅读体验 ----
  renderReadingSection(containerEl) {
    new import_obsidian17.Setting(containerEl).setName("\u9605\u8BFB\u4F53\u9A8C").setHeading();
    new import_obsidian17.Setting(containerEl).setName("\u6253\u5F00\u9605\u8BFB\u5668\u65B9\u5F0F").setDesc("\u5728\u5F53\u524D\u6807\u7B7E\u9875\u6253\u5F00 / \u5F39\u7A97\u6253\u5F00").addDropdown((dropdown) => {
      dropdown.addOption("tab", "\u5728\u6807\u7B7E\u9875\u4E2D\u6253\u5F00");
      dropdown.addOption("window", "\u5728\u65B0\u7A97\u53E3\u4E2D\u6253\u5F00");
      void this.loadSettings().then((s3) => {
        dropdown.setValue(s3.readerOpenMode);
      });
      dropdown.onChange(async (value) => {
        if (value !== "tab" && value !== "window") return;
        await this.annotations.patchSettings((s3) => ({ ...s3, readerOpenMode: value }));
      });
    });
    new import_obsidian17.Setting(containerEl).setName("\u8BB0\u4F4F\u9605\u8BFB\u8FDB\u5EA6").setDesc("\u6253\u5F00\u4E66\u65F6\u81EA\u52A8\u8DF3\u8F6C\u5230\u4E0A\u6B21\u9605\u8BFB\u4F4D\u7F6E").addToggle((toggle) => {
      void this.loadSettings().then((s3) => {
        toggle.setValue(s3.rememberProgress !== false);
      });
      toggle.onChange(async (value) => {
        await this.annotations.patchSettings((s3) => ({ ...s3, rememberProgress: value }));
      });
    });
    new import_obsidian17.Setting(containerEl).setName("\u9ED8\u8BA4\u53CC\u9875\u663E\u793A").setDesc("\u65B0\u4E66\u6253\u5F00\u65F6\u9ED8\u8BA4\u5F00\u542F\u53CC\u9875(\u4EC5\u684C\u9762, foliate \u9002\u7528)").addToggle((toggle) => {
      void this.loadSettings().then((s3) => {
        toggle.setValue(s3.twoPagesByDefault ?? false);
      });
      toggle.onChange(async (value) => {
        await this.annotations.patchSettings((s3) => ({ ...s3, twoPagesByDefault: value }));
      });
    });
    new import_obsidian17.Setting(containerEl).setName("Pad \u9ED8\u8BA4\u6C89\u6D78\u6A21\u5F0F").setDesc("\u5728 Pad / \u7A84\u5C4F\u4E0A\u6253\u5F00\u4E66\u65F6\u81EA\u52A8\u8FDB\u5165\u6C89\u6D78\u6A21\u5F0F(\u9690\u85CF\u5DE5\u5177\u680F)").addToggle((toggle) => {
      void this.loadSettings().then((s3) => {
        toggle.setValue(s3.immersiveOnTablet ?? false);
      });
      toggle.onChange(async (value) => {
        await this.annotations.patchSettings((s3) => ({ ...s3, immersiveOnTablet: value }));
      });
    });
    const shortcutSummary = new import_obsidian17.Setting(containerEl).setName("\u952E\u76D8\u5FEB\u6377\u952E").setDesc("\u9605\u8BFB\u5668\u952E\u76D8\u5FEB\u6377\u952E(\u5F53\u524D\u53EA\u8BFB;\u81EA\u5B9A\u4E49\u7F16\u8F91\u5668\u5728\u8DEF\u7EBF\u56FE\u91CC)");
    void this.loadSettings().then((s3) => {
      const shortcuts = s3.keyboardShortcuts;
      shortcutSummary.controlEl.createDiv({
        cls: "ez-reader__settings-readonly",
        text: `\u4E0A\u4E00\u9875:${shortcuts?.prev ?? "ArrowLeft"} \xB7 \u4E0B\u4E00\u9875:${shortcuts?.next ?? "ArrowRight"} \xB7 \u7B14\u8BB0:${shortcuts?.toggleSidebar ?? "s"} \xB7 \u76EE\u5F55:${shortcuts?.toggleToc ?? "t"} \xB7 \u7FFB\u8BD1:${shortcuts?.translate ?? "T"} \xB7 \u9AD8\u4EAE:${shortcuts?.highlight ?? "h"}`
      });
    });
  }
  // ---- 笔记与摘录 ----
  renderNotesSection(containerEl) {
    new import_obsidian17.Setting(containerEl).setName("\u7B14\u8BB0\u4E0E\u6458\u5F55").setHeading();
    const saveNotesDir = this.debounceSave(async (value) => {
      await this.annotations.patchSettings((s3) => ({ ...s3, notesDirectory: value.trim() }));
    });
    const saveResearchDir = this.debounceSave(async (value) => {
      await this.annotations.patchSettings((s3) => ({ ...s3, researchDirectory: value.trim() }));
    });
    const saveNoteTemplate = this.debounceSave(async (value) => {
      await this.annotations.patchSettings((s3) => ({ ...s3, defaultNoteTemplate: value }));
    });
    new import_obsidian17.Setting(containerEl).setName("\u6458\u5F55\u7B14\u8BB0\u76EE\u5F55").setDesc("\u53CC\u94FE\u7B14\u8BB0\u6587\u4EF6\u4FDD\u5B58\u4F4D\u7F6E,\u7559\u7A7A\u5219\u4E0D\u81EA\u52A8\u4FDD\u5B58\u7B14\u8BB0\u3002\u4FDD\u5B58\u7B2C\u4E00\u6761\u6458\u5F55\u65F6\u4F1A\u81EA\u52A8\u521B\u5EFA\u76EE\u5F55,\u65E0\u9700\u624B\u52A8 mkdir").addText((text) => {
      void this.loadSettings().then((s3) => {
        text.setValue(s3.notesDirectory);
      });
      text.onChange((value) => saveNotesDir(value));
    });
    new import_obsidian17.Setting(containerEl).setName("\u4E3B\u9898\u7814\u7A76\u76EE\u5F55").setDesc("\u4E3B\u9898\u7814\u7A76\u7B14\u8BB0\u4FDD\u5B58\u4F4D\u7F6E,\u9ED8\u8BA4\u4E0E\u6458\u5F55\u7B14\u8BB0\u5171\u4EAB ezreader-notes \u6839\u76EE\u5F55\u3002\u76EE\u5F55\u4F1A\u5728\u9996\u6B21\u5199\u5165\u65F6\u81EA\u52A8\u521B\u5EFA").addText((text) => {
      void this.loadSettings().then((s3) => {
        text.setValue(s3.researchDirectory);
      });
      text.onChange((value) => saveResearchDir(value));
    });
    new import_obsidian17.Setting(containerEl).setName("\u9ED8\u8BA4\u7B14\u8BB0\u6A21\u677F").setDesc("\u65B0\u5EFA\u7B14\u8BB0\u65F6\u4F7F\u7528\u7684\u6807\u9898\u6A21\u677F,\u652F\u6301 {{title}} {{author}} \u5360\u4F4D\u7B26").addText((text) => {
      void this.loadSettings().then((s3) => {
        text.setValue(s3.defaultNoteTemplate);
      });
      text.onChange((value) => saveNoteTemplate(value));
    });
  }
  // ---- 翻译 ----
  renderTranslationSection(containerEl) {
    new import_obsidian17.Setting(containerEl).setName("\u7FFB\u8BD1").setHeading();
    const providerSetting = new import_obsidian17.Setting(containerEl).setName("\u7FFB\u8BD1\u670D\u52A1").setDesc("\u9009\u62E9\u5728\u7EBF\u7FFB\u8BD1 API;\u7559\u7A7A = \u4E0D\u8054\u7F51\u3002").addDropdown((dropdown) => {
      dropdown.addOption("none", "\u5173\u95ED");
      dropdown.addOption("youdao", "\u6709\u9053\u667A\u4E91 \xB7 \u6587\u672C\u7FFB\u8BD1");
      dropdown.addOption("deepl", "DeepL");
      dropdown.addOption("google-translation-v3", "Google Translate (Cloud v3)");
      dropdown.addOption("mymemory", "MyMemory (\u514D\u8D39, \u65E0\u9700\u6CE8\u518C)");
      dropdown.addOption("openai-compatible", "\u81EA\u5B9A\u4E49 LLM (OpenAI \u517C\u5BB9)");
      dropdown.addOption("anthropic-compatible", "\u81EA\u5B9A\u4E49 LLM (Anthropic \u517C\u5BB9)");
      void this.loadSettings().then((s3) => {
        dropdown.setValue(s3.translation?.providerId ?? "none");
      });
      dropdown.onChange(async (value) => {
        await this.annotations.patchSettings((s3) => {
          if (value === "none") {
            return { ...s3, translation: null };
          }
          const prevProvider = s3.translation?.providerId;
          const next = {
            providerId: value,
            apiKey: prevProvider === value ? s3.translation?.apiKey ?? "" : "",
            sourceLocale: s3.translation?.sourceLocale ?? "auto",
            targetLocale: s3.translation?.targetLocale ?? "zh-CN"
          };
          return { ...s3, translation: next };
        });
        await this.renderTranslationApiKeyUi(containerEl);
      });
    });
    const hint = providerSetting.settingEl.createDiv({ cls: "ez-reader__settings-hint is-hidden" });
    const refreshHint = (providerId) => {
      const meta = this.findProviderMeta(providerId);
      hint.empty();
      hint.removeClass("is-hidden");
      if (!meta) {
        hint.addClass("is-hidden");
        return;
      }
      if (meta.signupHint) {
        hint.createEl("span", { text: meta.signupHint, cls: "ez-reader__settings-hint__text" });
      }
      if (meta.signupUrl) {
        const link = hint.createEl("a", {
          text: meta.signupUrl,
          attr: { href: meta.signupUrl, target: "_blank", rel: "noopener noreferrer" }
        });
        link.addClass("ez-reader__settings-hint__link");
      }
    };
    void this.loadSettings().then((s3) => refreshHint(s3.translation?.providerId ?? "none"));
    providerSetting.controlEl.querySelector("select")?.addEventListener("change", (event) => {
      const value = event.target.value;
      refreshHint(value);
    });
    void this.renderTranslationApiKeyUi(containerEl);
    new import_obsidian17.Setting(containerEl).setName("\u76EE\u6807\u8BED\u8A00").setDesc("\u9ED8\u8BA4\u7FFB\u8BD1\u5230\u7684\u8BED\u8A00(\u4F8B\u5982 zh-CN / en-US)").addText((text) => {
      const saveTargetLocale = this.debounceSave(async (value) => {
        await this.annotations.patchSettings((s3) => {
          if (!s3.translation) return s3;
          return { ...s3, translation: { ...s3.translation, targetLocale: value } };
        });
      });
      void this.loadSettings().then((s3) => {
        text.setValue(s3.translation?.targetLocale ?? "zh-CN");
      });
      text.onChange((value) => saveTargetLocale(value));
    });
  }
  /**
   * 渲染"翻译 API key"输入块 — 根据 provider 动态决定是两字段(有道)还是
   * 单字段(DeepL/Google). API key 在底层仍以 JSON 字符串存 (provider
   * 接口契约不变), UI 只是把 JSON 的两个字段拆出来让用户更好填.
   *
   * @param containerEl 设置页根容器,API key 输入区插在「翻译服务」+「目标语言」之间
   */
  async renderTranslationApiKeyUi(containerEl) {
    containerEl.querySelectorAll(".ez-reader__translation-apikey").forEach((node) => node.remove());
    const settings = await this.loadSettings();
    const providerId = settings.translation?.providerId ?? "none";
    if (providerId === "none") {
      return;
    }
    const anchor = containerEl.querySelector(".ez-reader__settings-hint");
    const wrap2 = document.createElement("div");
    wrap2.addClass("ez-reader__translation-apikey");
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(wrap2, anchor.nextSibling);
    } else {
      containerEl.appendChild(wrap2);
    }
    if (providerId === "youdao") {
      this.renderYoudaoKeyFields(wrap2, settings);
    } else if (providerId === "mymemory") {
      this.renderNoKeyHint(wrap2, "MyMemory \u662F\u516C\u5171\u514D\u8D39\u7FFB\u8BD1\u670D\u52A1,\u65E0\u9700\u6CE8\u518C\u4E5F\u65E0\u9700 API key\u3002\u6BCF\u65E5\u6BCF\u4E2A IP 1 \u4E07\u5B57\u7B26\u989D\u5EA6,\u9002\u5408\u5076\u5C14\u67E5\u8BCD\u3002");
    } else if (providerId === "openai-compatible") {
      this.renderLLMConfigFields(wrap2, settings, {
        baseUrlHint: "https://api.openai.com/v1",
        title: "LLM \xB7 API \u57FA\u7840\u5730\u5740",
        desc: "OpenAI \u517C\u5BB9\u683C\u5F0F\u7684 /v1 \u7AEF\u70B9\u3002\u4F8B\u5982 https://api.openai.com/v1, https://api.deepseek.com/v1",
        examples: [
          "DeepSeek: https://api.deepseek.com/v1 + model=deepseek-chat",
          "\u667A\u8C31 GLM: https://open.bigmodel.cn/api/paas/v4 + model=glm-4-flash (\u514D\u8D39)",
          "\u901A\u4E49\u5343\u95EE: https://dashscope.aliyuncs.com/compatible-mode/v1 + model=qwen-turbo",
          "OpenAI: https://api.openai.com/v1 + model=gpt-4o-mini"
        ]
      });
    } else if (providerId === "anthropic-compatible") {
      this.renderLLMConfigFields(wrap2, settings, {
        baseUrlHint: "https://api.minimax.cn/anthropic",
        title: "LLM \xB7 API \u57FA\u7840\u5730\u5740",
        desc: "Anthropic Messages API \u517C\u5BB9\u7AEF\u70B9 (\u4F1A\u81EA\u52A8\u8FFD\u52A0 /v1/messages)\u3002\u4F8B\u5982 https://api.minimax.cn/anthropic",
        examples: [
          "MiniMax: https://api.minimax.cn/anthropic + model=MiniMax-Text",
          "Anthropic: https://api.anthropic.com + model=claude-3-5-sonnet-20241022"
        ]
      });
    } else {
      this.renderSingleKeyField(wrap2, settings);
    }
  }
  /**
   * 给"无需 API key"的 provider (e.g. MyMemory) 显示一段说明 — 不渲染输入
   * 框, 让用户知道为什么没看到 key 字段不是因为 bug.
   */
  renderNoKeyHint(wrap2, text) {
    const note = wrap2.createDiv({ cls: "ez-reader__translation-apikey__no-key" });
    note.setText(text);
  }
  /**
   * 有道: 两个 password 字段分别填 appKey 和 appSecret, 在用户输入时合并成
   * JSON `{"appKey":"...","appSecret":"..."}` 存到 settings.translation.apiKey。
   * 这样底层 provider 接口(`apiKey: string`)不需要改, 老数据(已经是 JSON
   * 格式)也能直接读到两个字段里.
   */
  renderYoudaoKeyFields(wrap2, settings) {
    let stored = { appKey: "", appSecret: "" };
    const raw = settings.translation?.apiKey ?? "";
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        stored = {
          appKey: typeof parsed.appKey === "string" ? parsed.appKey : "",
          appSecret: typeof parsed.appSecret === "string" ? parsed.appSecret : ""
        };
      } catch {
      }
    }
    const persist = this.debounceSave(async (next) => {
      const json = JSON.stringify(next);
      await this.annotations.patchSettings((s3) => {
        if (!s3.translation) return s3;
        return { ...s3, translation: { ...s3.translation, apiKey: json } };
      });
    });
    const addPasswordField = (label, desc, key) => {
      new import_obsidian17.Setting(wrap2).setName(label).setDesc(desc).addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.inputEl.spellcheck = false;
        text.setPlaceholder(key === "appKey" ? "\u5E94\u7528 ID, 16 \u4F4D\u5B57\u7B26\u4E32" : "\u5E94\u7528\u5BC6\u94A5, \u53EA\u5728\u521B\u5EFA\u65F6\u663E\u793A\u4E00\u6B21");
        text.setValue(stored[key]);
        const update = (value) => {
          const next = { appKey: stored.appKey, appSecret: stored.appSecret };
          next[key] = value.trim();
          stored = next;
          void persist(next);
        };
        text.onChange((value) => update(value));
      }).addExtraButton((button) => {
        button.setIcon("eye");
        button.setTooltip("\u663E\u793A / \u9690\u85CF");
        button.onClick(() => {
          const inputs = wrap2.querySelectorAll(".ez-reader__translation-apikey input");
          const idx = key === "appKey" ? 0 : 1;
          const target = inputs[idx];
          if (!target) return;
          const isHidden = target.type === "password";
          target.type = isHidden ? "text" : "password";
          button.setIcon(isHidden ? "eye-off" : "eye");
        });
      });
    };
    addPasswordField(
      "\u6709\u9053 \xB7 \u5E94\u7528 ID (appKey)",
      "\u5728\u6709\u9053\u667A\u4E91\u63A7\u5236\u53F0 \u2192 \u6211\u7684\u5E94\u7528 \u2192 \u5E94\u7528\u8BE6\u60C5 \u67E5\u770B",
      "appKey"
    );
    addPasswordField(
      "\u6709\u9053 \xB7 \u5E94\u7528\u5BC6\u94A5 (appSecret)",
      "\u53EA\u5728\u521B\u5EFA\u5E94\u7528\u65F6\u663E\u793A\u4E00\u6B21,\u4E22\u5931\u8BF7\u91CD\u7F6E\u5BC6\u94A5",
      "appSecret"
    );
  }
  /**
   * DeepL / Google: 单字段输入(DeepL 是裸 key, Google 是 service account JSON).
   * 用户切换到这两个 provider 时刚才选这个编辑旧的 JSON apiKey 字段会被 provider 切换清空.
   */
  /**
   * 自定义 LLM provider 通用三字段渲染 — OpenAI 兼容 / Anthropic 兼容 共用
   * 这个 UI. 内部用 JSON `{"baseUrl":"...","apiKey":"...","model":"..."}`
   * 存到 settings.translation.apiKey, provider 接口(apiKey: string)不变.
   *
   * @param opts.baseUrlHint  baseUrl 字段的 placeholder, 不同 provider 不同
   * @param opts.title        第一个字段的标题(目前都叫 "LLM · API 基础地址")
   * @param opts.desc         第一个字段的描述(讲 endpoint 路径约定)
   * @param opts.examples     末尾示例数组, 一行一个
   */
  renderLLMConfigFields(wrap2, settings, opts) {
    let stored = { baseUrl: "", apiKey: "", model: "" };
    const raw = settings.translation?.apiKey ?? "";
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        stored = {
          baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
          apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
          model: typeof parsed.model === "string" ? parsed.model : ""
        };
      } catch {
      }
    }
    const persist = this.debounceSave(async (next) => {
      const json = JSON.stringify(next);
      await this.annotations.patchSettings((s3) => {
        if (!s3.translation) return s3;
        return { ...s3, translation: { ...s3.translation, apiKey: json } };
      });
    });
    const update = (patch) => {
      const next = { ...stored, ...patch };
      stored = next;
      void persist(next);
    };
    new import_obsidian17.Setting(wrap2).setName(opts.title).setDesc(opts.desc).addText((text) => {
      text.inputEl.type = "text";
      text.inputEl.autocomplete = "off";
      text.inputEl.placeholder = opts.baseUrlHint;
      text.setValue(stored.baseUrl);
      text.onChange((value) => update({ baseUrl: value.trim() }));
    });
    new import_obsidian17.Setting(wrap2).setName("LLM \xB7 API Key").setDesc("\u5BF9\u5E94 API \u57FA\u7840\u5730\u5740\u7684\u5BC6\u94A5").addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.setPlaceholder("sk-...");
      text.setValue(stored.apiKey);
      text.onChange((value) => update({ apiKey: value.trim() }));
    }).addExtraButton((button) => {
      button.setIcon("eye");
      button.setTooltip("\u663E\u793A / \u9690\u85CF");
      button.onClick(() => {
        const input = wrap2.querySelector(".ez-reader__translation-apikey input[type='password']");
        if (!input) return;
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";
        button.setIcon(isHidden ? "eye-off" : "eye");
      });
    });
    new import_obsidian17.Setting(wrap2).setName("LLM \xB7 \u6A21\u578B\u540D").setDesc("\u5177\u4F53\u6A21\u578B\u6807\u8BC6, \u89C1\u4E0B\u65B9\u793A\u4F8B\u6216\u4F9B\u5E94\u5546\u63A7\u5236\u53F0").addText((text) => {
      text.inputEl.type = "text";
      text.inputEl.autocomplete = "off";
      text.inputEl.placeholder = "model-id";
      text.setValue(stored.model);
      text.onChange((value) => update({ model: value.trim() }));
    });
    const examples = wrap2.createDiv({ cls: "ez-reader__translation-apikey__examples" });
    examples.setText("\u5E38\u7528\u793A\u4F8B:\n" + opts.examples.map((line) => `  ${line}`).join("\n"));
  }
  renderSingleKeyField(wrap2, settings) {
    const desc = settings.translation?.providerId === "google-translation-v3" ? "Google: \u7C98\u8D34 service account JSON \u7684\u5B8C\u6574\u5185\u5BB9({...}),\u4E0D\u662F API key\u3002" : "DeepL: \u5728 DeepL Pro \u63A7\u5236\u53F0 \u2192 Account \u2192 Authentication key \u590D\u5236\u3002";
    new import_obsidian17.Setting(wrap2).setName("\u7FFB\u8BD1 API key").setDesc(desc).addText((text) => {
      text.inputEl.type = "password";
      const saveKey = this.debounceSave(async (value) => {
        await this.annotations.patchSettings((s3) => {
          if (!s3.translation) {
            if (!value) return s3;
            return {
              ...s3,
              translation: {
                providerId: settings.translation?.providerId ?? "deepl",
                apiKey: value,
                sourceLocale: "auto",
                targetLocale: "zh-CN"
              }
            };
          }
          return { ...s3, translation: { ...s3.translation, apiKey: value } };
        });
      });
      text.setValue(settings.translation?.apiKey ?? "");
      text.onChange((value) => saveKey(value));
    });
  }
  // ---- 界面 ----
  renderUISection(containerEl) {
    new import_obsidian17.Setting(containerEl).setName("\u754C\u9762").setHeading();
    new import_obsidian17.Setting(containerEl).setName("\u754C\u9762\u8BED\u8A00").setDesc("\u9009\u62E9\u63D2\u4EF6\u754C\u9762\u8BED\u8A00;\u5207\u6362\u540E\u4F1A\u91CD\u65B0\u6253\u5F00\u5DF2\u7ECF\u6253\u5F00\u7684\u9875\u9762\u3002").addDropdown((dropdown) => {
      for (const { code, label } of UI_LOCALES) {
        dropdown.addOption(code, label);
      }
      void this.annotations.listSettings().then((settings) => {
        dropdown.setValue(isUiLocale(settings.uiLocale) ? settings.uiLocale : "zh-CN");
      });
      dropdown.onChange(async (value) => {
        if (!isUiLocale(value)) return;
        await this.annotations.patchSettings((s3) => ({ ...s3, uiLocale: value }));
        new import_obsidian17.Notice("\u754C\u9762\u8BED\u8A00\u5C06\u5728\u91CD\u542F\u540E\u751F\u6548");
      });
    });
    new import_obsidian17.Setting(containerEl).setName("\u6240\u6709\u8005\u540D\u79F0").setDesc("\u7528\u4E8E\u7B14\u8BB0\u7F72\u540D(\u53EF\u9009)").addText((text) => {
      const saveOwner = this.debounceSave(async (value) => {
        await this.annotations.patchSettings((s3) => ({ ...s3, libraryOwnerName: value }));
      });
      void this.loadSettings().then((s3) => {
        text.setValue(s3.libraryOwnerName);
      });
      text.onChange((value) => saveOwner(value));
    });
    new import_obsidian17.Setting(containerEl).setName("\u4E66\u67B6\u5C01\u9762\u5BC6\u5EA6").setDesc("\u5F71\u54CD\u7F51\u683C\u5217\u6570\u548C\u5217\u8868\u5C01\u9762\u5C3A\u5BF8\u3002\u7D27\u51D1=\u6BCF\u884C\u591A\u672C,\u8D85\u5927=\u6BCF\u884C\u4E00\u672C\u5927\u5C01\u9762\u3002").addDropdown((dropdown) => {
      for (const density of SHELF_DENSITIES) {
        dropdown.addOption(density, SHELF_DENSITY_LABELS[density]);
      }
      void this.loadSettings().then((s3) => {
        const raw = s3.shelfDensity ?? "default";
        dropdown.setValue(SHELF_DENSITIES.includes(raw) ? raw : "default");
      });
      dropdown.onChange(async (value) => {
        if (!SHELF_DENSITIES.includes(value)) return;
        await this.annotations.patchSettings((s3) => ({ ...s3, shelfDensity: value }));
      });
    });
  }
  // ---- 关于 ----
  renderAboutSection(containerEl) {
    new import_obsidian17.Setting(containerEl).setName("\u5173\u4E8E").setHeading();
    const about = containerEl.createDiv({ cls: "ez-reader__settings-about" });
    about.createEl("p", {
      text: "EzReader \u2014 \u5728 Obsidian \u4E2D\u9605\u8BFB\u672C\u5730\u7535\u5B50\u4E66,\u81EA\u52A8\u751F\u6210\u53CC\u94FE\u7B14\u8BB0\u4E0E\u6458\u5F55\u3002"
    });
    about.createEl("p", {
      text: "\u9879\u76EE\u5730\u5740: github.com/alei37/ez-reader"
    });
    const actions = about.createDiv({ cls: "ez-reader__settings-about__actions" });
    const exportBtn = actions.createEl("button", { text: "\u5BFC\u51FA\u5168\u90E8\u6570\u636E (JSON)", attr: { type: "button" } });
    exportBtn.onclick = () => void this.exportData();
    const importBtn = actions.createEl("button", { text: "\u5BFC\u5165\u6570\u636E (JSON)", attr: { type: "button" } });
    importBtn.onclick = () => void this.importData();
  }
  async exportData() {
    const data = await this.annotations.load();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a3 = document.createElement("a");
    a3.href = url;
    a3.download = `ez-reader-export-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a3);
    a3.click();
    a3.remove();
    URL.revokeObjectURL(url);
  }
  async importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("\u6587\u4EF6\u4E0D\u662F\u5408\u6CD5 JSON \u5BF9\u8C61");
        }
        const required = ["version", "settings", "library", "reading", "bookmarks", "excerpts"];
        for (const key of required) {
          if (!(key in parsed)) {
            throw new Error(`\u7F3A\u5931\u5B57\u6BB5: ${key} (\u8FD9\u53EF\u80FD\u4E0D\u662F ez-reader \u5BFC\u51FA\u6587\u4EF6)`);
          }
        }
        if (!Array.isArray(parsed.library) || !Array.isArray(parsed.reading) || !Array.isArray(parsed.bookmarks) || !Array.isArray(parsed.excerpts)) {
          throw new Error("library/reading/bookmarks/excerpts \u5FC5\u987B\u662F\u6570\u7EC4");
        }
        await this.annotations.save(parsed);
        const counts = parsed;
        new import_obsidian17.Notice(`\u6570\u636E\u5DF2\u5BFC\u5165 (${counts.excerpts.length} \u6458\u5F55, ${counts.bookmarks.length} \u4E66\u7B7E, ${counts.library.length} \u4E66)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new import_obsidian17.Notice(`\u5BFC\u5165\u5931\u8D25: ${message}`);
        console.error("[ez-reader] importData failed", error);
      }
    };
    input.click();
  }
};

// src/Plugin.ts
var EzReaderPlugin = class extends import_obsidian19.Plugin {
  bookSource;
  annotationStore;
  library;
  reading;
  translation;
  foliate;
  txtReader;
  mobiReader;
  pdfCover;
  covers;
  noteWriter;
  /**
   * Cached value of the user's original `showUnsupportedFiles` setting,
   * so onunload can restore it. Stored as a private field instead of
   * pinned to `this` via cast to keep the type contract honest.
   */
  __ezReaderPreviousShowUnsupported;
  async onload() {
    this.bookSource = new ObsidianBookSource(this.app);
    this.annotationStore = new ObsidianAnnotationStore(this);
    await this.enableAllBookFormatsInFileExplorer();
    this.foliate = new FoliateBookReader();
    this.txtReader = new TxtBookReader();
    this.mobiReader = new MobiBookReader();
    this.pdfCover = new PdfCoverExtractor();
    const metadataReader = {
      // metadataReader 只用于 readMetadata, open/extractCover 永远不会被调用
      // (它们走 textReader / foliate dispatcher). 这里保留接口实现避免
      // 类型 widen, 但 throw 防止误用.
      open: async () => {
        throw new Error("metadataReader.open should never be called");
      },
      extractCover: async () => null,
      readMetadata: async (book, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.readMetadata(book, loader);
        }
        if (book.locator.format === "txt") {
          return this.txtReader.readMetadata(book, loader);
        }
        if (book.locator.format === "epub") {
          return this.foliate.readMetadata(book, loader);
        }
        return null;
      }
    };
    this.library = new LibraryService(
      this.bookSource,
      this.annotationStore,
      metadataReader,
      this.makeBookBytesLoader()
    );
    this.reading = new ReadingService(
      this.annotationStore,
      // 同步 LibraryService.entries + emit shelf refresh, 否则 reader 翻页
      // 写完 data.json 后 shelf 仍然显示旧进度, 关闭 → 重开 reader 也不
      // resume (entry.reading 是 library.entries 的旧快照).
      (state) => this.library.updateReading(state)
    );
    this.translation = new TranslationCoordinator(this.annotationStore, [
      new YoudaoTranslationProvider(),
      new DeeplTranslationProvider(),
      new GoogleTranslationProvider(),
      // P2: 免费无 key provider — 给不想注册信用卡/有道那种付费账户的用户。
      // 每天每个 IP 1 万字符,质量略低于 DeepL/Google 但够用。
      new MyMemoryTranslationProvider(),
      // P2: 用户自定义 LLM (OpenAI 兼容) — DeepSeek / 智谱 / 通义 / OpenAI
      // 都走同一接口, 在 settings 里填 baseUrl + apiKey + model 即可.
      new OpenAICompatibleTranslationProvider(),
      // P2: 用户自定义 LLM (Anthropic Messages API 兼容) — MiniMax 等。
      // 注意是 /v1/messages 不是 /chat/completions, 鉴权走 x-api-key 头.
      new AnthropicCompatibleTranslationProvider()
    ]);
    this.annotationStore.onSettingsChanged(() => this.translation.invalidate());
    this.covers = new CoverCache(
      this.app,
      this,
      this.library,
      {
        epub: this.foliate,
        mobi: this.mobiReader,
        azw3: this.mobiReader,
        pdf: this.pdfCover
      },
      this.annotationStore
    );
    this.noteWriter = new ObsidianNoteWriter(this.app, this, this.annotationStore);
    this.app.workspace.onLayoutReady(async () => {
      await this.library.initialize();
      await this.covers.hydrateCovers();
      await this.attachOverlaysToOpenLibraryPdfs();
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf || leaf.view.getViewType() !== "pdf") return;
        void this.attachOverlayToPdfLeafIfLibraryBook(leaf);
      })
    );
    this.addSettingTab(new SettingsTab(this.app, this, this.annotationStore, this.translation.listProviders()));
    this.registerView(
      SHELF_VIEW_TYPE,
      (leaf) => new ShelfView(leaf, this.deps())
    );
    this.registerView(
      READER_VIEW_TYPE,
      (leaf) => new ReaderView(leaf, this.readerDeps())
    );
    this.addRibbonIcon("library", "\u6253\u5F00\u4E2A\u4EBA\u56FE\u4E66\u9986", () => {
      void this.openShelf();
    });
    this.registerObsidianProtocolHandler("ez-reader", (params) => {
      void this.handleProtocol(params);
    });
  }
  onunload() {
    this.library?.dispose();
    if (typeof this.__ezReaderPreviousShowUnsupported === "boolean") {
      const vault = this.app.vault;
      void vault.setConfig?.("showUnsupportedFiles", this.__ezReaderPreviousShowUnsupported);
    }
  }
  deps() {
    return {
      app: this.app,
      library: this.library,
      reading: this.reading,
      foliate: this.foliate,
      openReader: (entry) => this.openReader(entry),
      covers: this.covers,
      bookBytesLoader: this.makeBookBytesLoader(),
      // Onboarding 模态需要持久化 dismissal 标志 — 透传 annotationStore
      annotationStore: this.annotationStore,
      // Shelf density 等 shelf-only 的设置也走这里, 不暴露 patchSettings
      // 全部能力 — ShelfView 只需要读 + 写这一个字段, 锁死最小接口.
      settingsStore: this.annotationStore
    };
  }
  readerDeps() {
    return {
      app: this.app,
      reading: this.reading,
      foliate: this.foliate,
      // TXT / MOBI / AZW3 共享同一个 BookReader 抽象 — Plugin 层把
      // mobi/azw3 路由给 MobiBookReader (内部按 format 再细派),
      // txt 路由给 TxtBookReader。ReaderView 只看到这一个聚合的
      // `textReader` BookReader, 不知道下面是哪个具体 reader。
      textReader: this.makeTextReader(),
      translation: this.translation,
      noteWriter: this.noteWriter,
      bookBytesLoader: this.makeBookBytesLoader(),
      settingsProvider: () => this.loadReaderSettings(),
      onBookOpened: (entry) => void this.covers.ensureCoverFor(entry.book, this.makeBookBytesLoader()),
      // P0-2: 透传 LibraryService, 让 ReaderView.openSession 完成后调
      // refreshMetadata 把真 title / author 写回 store.
      library: this.library
    };
  }
  /**
   * Build a `BookReader` that dispatches `open` / `extractCover` based on
   * `book.locator.format`. The dispatcher's API matches `BookReader` so
   * the reader-side code (ReaderView, CoverCache) doesn't need to know
   * it's a multiplexer.
   */
  makeTextReader() {
    return {
      open: async (book, host, appearance, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.open(book, host, appearance, loader);
        }
        return this.txtReader.open(book, host, appearance, loader);
      },
      extractCover: async (book, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.extractCover(book, loader);
        }
        return this.txtReader.extractCover(book, loader);
      },
      readMetadata: async (book, loader) => {
        if (book.locator.format === "mobi" || book.locator.format === "azw3") {
          return this.mobiReader.readMetadata(book, loader);
        }
        return this.txtReader.readMetadata(book, loader);
      }
    };
  }
  async loadReaderSettings() {
    const settings = await this.annotationStore.listSettings();
    return {
      defaultAppearance: settings.defaultAppearance ?? DEFAULT_READER_APPEARANCE,
      shortcuts: settings.keyboardShortcuts ?? DEFAULT_KEYBOARD_SHORTCUTS,
      twoPagesByDefault: settings.twoPagesByDefault ?? false,
      immersiveOnTablet: settings.immersiveOnTablet ?? false,
      translationLocale: settings.translation?.targetLocale ?? "zh-CN",
      rememberProgress: settings.rememberProgress !== false
    };
  }
  async handleProtocol(params) {
    const bookId = params.book ?? params.path;
    const excerptId = params.annotation;
    if (!bookId) return;
    const entry = this.library.get(bookId);
    if (!entry) {
      new import_obsidian19.Notice(`\u627E\u4E0D\u5230\u4E66: ${bookId}`);
      return;
    }
    const isPdf = entry.book.locator.format === "pdf";
    try {
      await this.withTimeout(this.reading.openBook(entry.book.id), 5e3, "reading.openBook");
      if (isPdf) {
        await this.openReader(entry);
        const overlay = await this.waitForPdfOverlay(entry.book.locator.path, 6e3);
        if (overlay && excerptId) {
          await this.withTimeout(overlay.jumpToExcerpt(excerptId), 1e4, "pdf.jumpToExcerpt");
        } else if (!overlay) {
          const excerpt = await this.tryGetExcerpt(bookId, excerptId);
          if (excerpt && excerpt.locator.position.kind === "pdf") {
            await this.fallbackJumpPdfLeaf(entry.book.locator.path, excerpt.locator.position.page);
          } else {
            console.warn("[ez-reader] handleProtocol: PdfOverlay not found for", bookId);
          }
        }
        return;
      }
      const existingLeaf = this.findReaderLeafForBook(bookId);
      if (existingLeaf && existingLeaf.view instanceof ReaderView) {
        if (excerptId) {
          await this.withTimeout(existingLeaf.view.openExcerptById(excerptId), 3e4, "openExcerptById");
        }
        this.app.workspace.revealLeaf(existingLeaf);
        this.app.workspace.setActiveLeaf(existingLeaf);
        return;
      }
      await this.withTimeout(this.openReader(entry), 8e3, "openReader");
      if (excerptId) {
        const leaf = this.findReaderLeafForBook(bookId) ?? this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)[0];
        if (leaf?.view instanceof ReaderView) {
          await this.withTimeout(leaf.view.openExcerptById(excerptId), 3e4, "openExcerptById");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian19.Notice(`\u65E0\u6CD5\u6253\u5F00\u7B14\u8BB0\u94FE\u63A5: ${message}`);
      console.error("[ez-reader] handleProtocol failed", { bookId, excerptId, error });
    }
  }
  /**
   * 等待 PdfOverlay 在指定 PDF 文件的 leaf 上 mount. PDF++ / Obsidian PDFView
   * 从 openLinkText 到 PdfOverlay 挂上, 中间要跑 view 创建 + PDF 渲染首帧
   * + extractCover 完成 + overlay.mount(), 异步, 大文件可能要 1-3 秒.
   * 重试 100ms 间隔直到找到或超时.
   */
  async waitForPdfOverlay(bookPath, timeoutMs) {
    const { findPdfOverlayForLeaf: findPdfOverlayForLeaf2 } = await Promise.resolve().then(() => (init_pdfOverlay(), pdfOverlay_exports));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
      for (const leaf of pdfLeaves) {
        const viewFile = leaf.view.file;
        if (viewFile?.path !== bookPath) continue;
        const overlay = findPdfOverlayForLeaf2(leaf);
        if (overlay) return overlay;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
    return void 0;
  }
  /** Fallback: overlay 没挂上时, 用 Obsidian PDFView 的 URL hash 跳页. */
  async fallbackJumpPdfLeaf(bookPath, pageNumber) {
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
    for (const leaf of pdfLeaves) {
      const viewFile = leaf.view.file;
      if (viewFile?.path !== bookPath) continue;
      const view = leaf.view;
      if (typeof view.setEphemeralState === "function") {
        try {
          view.setEphemeralState({ url: `#page=${pageNumber}` });
          return;
        } catch (error) {
          console.warn("[ez-reader] fallbackJumpPdfLeaf setEphemeralState failed", error);
        }
      }
      try {
        await this.app.workspace.openLinkText(`${bookPath}#page=${pageNumber}`, "", false);
        return;
      } catch (error) {
        console.warn("[ez-reader] fallbackJumpPdfLeaf openLinkText failed", error);
      }
    }
  }
  /** Best-effort: 读 excerpt by id. 失败不影响主流程. */
  async tryGetExcerpt(bookId, excerptId) {
    if (!excerptId) return void 0;
    try {
      const excerpts = await this.reading.listExcerpts(bookId);
      return excerpts.find((e3) => e3.id === excerptId);
    } catch {
      return void 0;
    }
  }
  findReaderLeafForBook(bookId) {
    for (const leaf of this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)) {
      const state = leaf.getViewState();
      if (state.state && state.state.file === bookId) {
        return leaf;
      }
    }
    return null;
  }
  /** Race a promise against a deadline. Rejects with a friendly message on timeout. */
  async withTimeout(promise, ms, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_2, reject) => {
          timer = globalThis.setTimeout(() => reject(new Error(`${label} \u8D85\u65F6 (${ms}ms)`)), ms);
        })
      ]);
    } finally {
      if (timer !== void 0) globalThis.clearTimeout(timer);
    }
  }
  /**
   * Adapter-level bridge from the BookReader port to the Obsidian Vault.
   * The renderer cannot `fetch()` an `obsidian://` URL, so we hand each
   * reader engine a function that resolves the file's bytes through the
   * Vault API instead.
   */
  makeBookBytesLoader() {
    return async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof import_obsidian19.TFile)) {
        throw new Error(`Book file not found: ${path}`);
      }
      return this.app.vault.readBinary(file);
    };
  }
  async openShelf() {
    const existing = this.app.workspace.getLeavesOfType(SHELF_VIEW_TYPE)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: SHELF_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async openReader(entry) {
    if (entry.book.locator.format === "pdf") {
      await this.openInBuiltInViewer(entry);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: READER_VIEW_TYPE,
      state: { file: entry.book.locator.path },
      active: true
    });
    const view = leaf.view;
    if (view instanceof ReaderView) {
      view.setEntry(entry);
    }
    this.app.workspace.setActiveLeaf(leaf);
  }
  /**
   * 用 Obsidian 自带 PDFViewer 打开 PDF — 通过 openLinkText 触发 Obsidian
   * 内置的 markdown/pdf 渲染器。这是 Obsidian自己处理 PDF 的方式, 稳定可靠。
   *
   * P4 起我们在 PDFView 上挂 PdfOverlay (选词菜单 / 笔记面板)。overlay
   * 不动 PDFView 自身, 只在它的 containerEl 里追加浮层元素。
   */
  async openInBuiltInViewer(entry) {
    const file = this.app.vault.getAbstractFileByPath(entry.book.locator.path);
    if (!(file instanceof import_obsidian19.TFile)) {
      new import_obsidian19.Notice(`\u627E\u4E0D\u5230\u6587\u4EF6: ${entry.book.locator.path}`);
      return;
    }
    await this.app.workspace.openLinkText(file.path, "", true);
    await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
    const target = pdfLeaves.find((leaf) => {
      const view = leaf.view;
      return view.file?.path === file.path;
    }) ?? this.app.workspace.getMostRecentLeaf();
    if (!target) return;
    await this.attachOverlayToPdfLeafIfLibraryBook(target);
  }
  /**
   * 给已存在的 PDF leaf 挂 overlay, 当且仅当:
   *   1. 该 leaf 还没挂过 (WeakMap ATTACHED 查不到)
   *   2. 该 leaf 里的 PDF 文件路径在书架里 (LibraryService.list() 能找到)
   *
   * 第二条故意收窄 — 我们不想让插件给 vault 里每一个随机 PDF 都塞选词菜单 /
   * 翻译弹窗 / 笔记侧栏按钮, 用户的心智模型是「EzReader 只管书架里的书」。
   * 想读 vault 里的其他 PDF, 先加到书架再开。
   *
   * 三处 caller 共用:
   *   1. `openInBuiltInViewer` — 从书架打开
   *   2. `attachOverlaysToOpenLibraryPdfs` — onLayoutReady 时扫一遍已打开 leaf
   *   3. `active-leaf-change` listener — 用户从书架外点开 PDF 时兜底
   */
  async attachOverlayToPdfLeafIfLibraryBook(leaf) {
    const { findPdfOverlayForLeaf: findPdfOverlayForLeaf2, PdfOverlay: PdfOverlay2 } = await Promise.resolve().then(() => (init_pdfOverlay(), pdfOverlay_exports));
    if (findPdfOverlayForLeaf2(leaf)) return;
    const view = leaf.view;
    const filePath = view.file?.path;
    if (!filePath) return;
    const entry = this.library.list().find((e3) => e3.book.locator.path === filePath);
    if (!entry) return;
    try {
      const overlay = new PdfOverlay2({
        app: this.app,
        pdfLeaf: leaf,
        bookPath: filePath,
        reading: this.reading,
        translation: this.translation,
        library: this.library,
        noteWriter: this.noteWriter
      });
      await overlay.resolveBook();
      overlay.mount();
    } catch (error) {
      console.warn("[ez-reader] failed to attach PdfOverlay", error);
    }
  }
  /**
   * 扫描当前 workspace 里所有 PDF leaf, 给书架里的 PDF 补挂 overlay.
   * 主要场景: Obsidian 重启后自动恢复上次打开的 PDF leaf, 但 overlay 没存
   * 盘, 只能重建.
   */
  async attachOverlaysToOpenLibraryPdfs() {
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
    for (const leaf of pdfLeaves) {
      await this.attachOverlayToPdfLeafIfLibraryBook(leaf);
    }
  }
  /** Removed openPicker — 跟"打开个人图书馆"功能重叠, ribbon 上不需要第二个入口. */
  /**
   * Mirrors `enableAllBookFormatsInFileExplorer` from the upstream plugin:
   * turns on Obsidian's "Detect all file extensions" so `vault.getFiles()`
   * returns PDF and EPUB files. Without this, those file types are hidden
   * from the file explorer and excluded from scans.
   */
  async enableAllBookFormatsInFileExplorer() {
    const vaultWithConfig = this.app.vault;
    const previous = vaultWithConfig.getConfig?.("showUnsupportedFiles");
    this.__ezReaderPreviousShowUnsupported = typeof previous === "boolean" ? previous : void 0;
    if (previous === true) return;
    try {
      await vaultWithConfig.setConfig?.("showUnsupportedFiles", true);
    } catch (error) {
      console.warn("[ez-reader] could not enable showUnsupportedFiles; scans may miss PDF/EPUB", error);
    }
  }
};

// src/main.ts
var polyfillReport = collectPolyfillReport();
if (polyfillReport.missing.length > 0) {
  console.info(
    "[ez-reader] WebView missing APIs (polyfilled where possible):",
    polyfillReport.missing.join(", ")
  );
}
var main_default = EzReaderPlugin;
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
