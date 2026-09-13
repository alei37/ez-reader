/**
 * Originally from RyotaUshio/obsidian-pdf-plus (MIT License)
 * Copyright (c) 2023 Ryota Ushio
 * https://github.com/RyotaUshio/obsidian-pdf-plus
 * Modified for ez-reader.
 *
 * Parser / builder for the PDF subpath format used by PDF++ and
 * adopted by us as the canonical way to deep-link into a specific page
 * + character range of a PDF.
 *
 *   #page=1
 *   #page=1&selection=4,0,5,20          (text item 4 char 0 → item 5 char 20)
 *   #page=1&selection=...&color=yellow
 *   #page=1&annotation=abc-123
 *   #page=1&offset=100,200,1.5
 *   #page=1&rect=0,0,595,842
 */

export type ParsedSubpath =
  | { readonly type: "page"; readonly page: number }
  | {
      readonly type: "selection";
      readonly page: number;
      readonly beginIndex: number;
      readonly beginOffset: number;
      readonly endIndex: number;
      readonly endOffset: number;
      readonly color?: string;
    }
  | { readonly type: "annotation"; readonly page: number; readonly annotation: string }
  | { readonly type: "offset"; readonly page: number; readonly x: number; readonly y: number; readonly zoom?: number }
  | { readonly type: "rect"; readonly page: number; readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };

const subpathToParams = (subpath: string): URLSearchParams => {
  // strip leading "#" or "?"
  const cleaned = subpath.replace(/^[#?]/, "");
  return new URLSearchParams(cleaned);
};

export const parsePDFSubpath = (subpath: string): ParsedSubpath | null => {
  if (!subpath) return null;
  const params = subpathToParams(subpath);
  if (!params.has("page")) return null;
  const page = Number(params.get("page"));
  if (Number.isNaN(page)) return null;
  if (params.has("selection")) {
    const parts = params.get("selection")!.split(",").map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
    const [beginIndex, beginOffset, endIndex, endOffset] = parts as [number, number, number, number];
    const color = params.get("color") ?? undefined;
    return { type: "selection", page, beginIndex, beginOffset, endIndex, endOffset, color };
  }
  if (params.has("annotation")) {
    return { type: "annotation", page, annotation: params.get("annotation")! };
  }
  if (params.has("offset")) {
    const parts = params.get("offset")!.split(",").map((s) => Number(s.trim()));
    if (parts.length < 2) return null;
    return { type: "offset", page, x: parts[0]!, y: parts[1]!, zoom: parts[2] };
  }
  if (params.has("rect")) {
    const parts = params.get("rect")!.split(",").map((s) => Number(s.trim()));
    if (parts.length !== 4) return null;
    return { type: "rect", page, left: parts[0]!, bottom: parts[1]!, right: parts[2]!, top: parts[3]! };
  }
  return { type: "page", page };
};

export const paramsToSubpath = (params: Record<string, unknown>): string => {
  const entries = Object.entries(params).filter(([k, v]) => Boolean(k) && (v !== undefined && v !== null && v !== ""));
  if (entries.length === 0) return "";
  return "#" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
};

/**
 * Build the canonical selection subpath (the form we save when the
 * user creates an excerpt from a PDF text selection).
 */
export const selectionToSubpath = (
  page: number,
  beginIndex: number,
  beginOffset: number,
  endIndex: number,
  endOffset: number,
  color?: string
): string => {
  return paramsToSubpath({
    page,
    selection: `${beginIndex},${beginOffset},${endIndex},${endOffset}`,
    ...(color ? { color } : {})
  });
};
