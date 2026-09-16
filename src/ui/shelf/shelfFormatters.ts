import type { ReadingState } from "../../core/entities/ReadingState";

/**
 * Shared formatters used by the shelf (grid + list) and reader toolbar.
 * Single source of truth — adding a new status (e.g. "rereading") only
 * needs an edit here.
 */

export const statusLabel = (status: ReadingState["status"]): string => {
  switch (status) {
    case "reading":
      return "在读";
    case "finished":
      return "已读完";
    case "abandoned":
      return "暂弃";
    default:
      return "未开始";
  }
};

/**
 * Best-effort author guess from the path when metadata isn't available.
 * Falls back to the parent directory name so the card shows something
 * more useful than "未知作者" (typical for PDF files we haven't opened).
 */
export const extractAuthorFallback = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, -1).join(" / ");
  return "未知作者";
};