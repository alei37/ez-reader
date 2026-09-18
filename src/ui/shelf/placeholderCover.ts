/**
 * Deterministic colored placeholder cover. Used by the shelf (grid and
 * list views) when a book has no extracted cover image yet — gives the
 * shelf visual variety instead of a wall of identical gray blocks.
 *
 * Design goals:
 * - **Brightness over moodiness**: lightness 50-65% (was 18-28%), so the
 *   cover reads on both light and dark Obsidian themes. Dark covers blend
 *   into dark themes and look "dead" in light themes; the previous design
 *   had this exact problem.
 * - **Vivid hue**: saturation 60-72% (was 38-48%) — books have saturated
 *   spines, our placeholders should feel like books.
 * - **Doubled-up gradient**: a 135° linear gradient gives the base color
 *   identity; a soft top-left highlight (radial gradient, transparent at
 *   55%) adds a hint of "lit from above" depth without faking a texture.
 * - **Adaptive text color**: based on the cover's mean lightness so glyph
 *   + title stay readable. Light covers get dark text, dark covers get
 *   near-white.
 * - **Cached**: hashing + HSL string concat per render is wasteful when
 *   the user has 500+ books; bounded LRU (FIFO is fine for this scale).
 */
const cache = new Map<string, PlaceholderCoverStyle>();
const PLACEHOLDER_CACHE_MAX = 500;

export interface PlaceholderCoverStyle {
  readonly background: string;
  readonly color: string;
  /** Text shadow style tuned for the contrast mode. Applied to glyph +
   *  title for legibility against busy gradient backgrounds. */
  readonly textShadow: string;
}

export const placeholderCoverStyle = (title: string): PlaceholderCoverStyle => {
  const cached = cache.get(title);
  if (cached) return cached;

  const hash = stableHash(title);
  const hue1 = hash % 360;
  // Larger hue span than before (38° vs 28°) — adjacent hues look almost
  // identical in a grid of mixed covers, this gives each one a clearer
  // visual identity.
  const hue2 = (hue1 + 38) % 360;
  // Saturation / lightness are deterministic but bounded so we don't end
  // up with neon yellow or muddy brown.
  const sat = 62 + (hash >> 3) % 12; // 62-73
  const light1 = 58 + (hash >> 5) % 8; // 58-65
  const light2 = 44 + (hash >> 7) % 8; // 44-51
  // The radial highlight picks the brighter of the two stops, then adds
  // a small offset so it doesn't sit dead-center.
  const highlightHue = hue1;
  const highlightLight = 86;

  const background = [
    `radial-gradient(ellipse 120% 75% at 22% -18%, hsl(${highlightHue}, 75%, ${highlightLight}%) 0%, hsla(${highlightHue}, 70%, 78%, 0.4) 28%, transparent 58%)`,
    `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${light1}%) 0%, hsl(${hue2}, ${sat}%, ${light2}%) 100%)`
  ].join(", ");

  // Mean lightness picks contrast mode. Threshold 55% puts most covers
  // in light-text mode since `light1` is already 58-65; only the rare
  // "very bright" cover flips to dark text.
  const meanLight = (light1 + light2) / 2;
  const isLight = meanLight > 55;
  const color = isLight ? "rgba(20, 22, 32, 0.92)" : "rgba(255, 255, 255, 0.96)";
  // Subtle drop shadow tightens glyph legibility against the gradient
  // without making the text feel "stamped" on.
  const textShadow = isLight
    ? "0 1px 2px rgba(255, 255, 255, 0.25)"
    : "0 1px 3px rgba(0, 0, 0, 0.35)";

  const result: PlaceholderCoverStyle = { background, color, textShadow };
  evictIfFull(cache);
  cache.set(title, result);
  return result;
};

/** djb2-style string hash → unsigned 32-bit int. */
const stableHash = (input: string): number => {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    // (h * 33) ^ c, kept in 32-bit range
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(h | 0);
};

const evictIfFull = (map: Map<string, PlaceholderCoverStyle>): void => {
  if (map.size < PLACEHOLDER_CACHE_MAX) return;
  // FIFO: first inserted key — Map preserves insertion order, so
  // `.keys().next().value` is the oldest. Good enough at 500 cap.
  const first = map.keys().next().value;
  if (first !== undefined) map.delete(first);
};
