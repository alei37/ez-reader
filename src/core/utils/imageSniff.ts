/**
 * Sniff an image's MIME type from its leading bytes. foliate and the
 * MOBI parser both return `Blob`s whose `type` field is often empty,
 * and guessing wrong (e.g. PNG saved as `.jpg`) silently corrupts the
 * cover cache. Inspect the magic bytes instead.
 *
 * Limit: we only need to cover the four formats EPUB / MOBI realistically
 * embed — PNG, JPEG, WEBP, GIF. Other formats (AVIF, HEIC, etc.) return
 * null and the caller can fall back to `blob.type` or "image/jpeg".
 */
export const sniffImageMime = (bytes: ArrayBuffer): string | null => {
  const view = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return "image/jpeg";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
    view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50
  ) {
    return "image/webp";
  }
  // GIF: "GIF8"
  if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
    return "image/gif";
  }
  return null;
};
