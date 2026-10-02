/**
 * The intro card: a logo, the video's title and an optional subtitle, shown
 * before the first scene. It is an HTML page recorded like a scene, so fonts
 * and SVG render the way a browser renders them.
 */

/** Length of the fade in and of the fade out, in ms. */
export const INTRO_FADE_MS = 500;

const MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** MIME type for a logo file extension, or undefined when it is not an image type the card supports. */
export function logoMime(extension: string): string | undefined {
  return MIME[extension.toLowerCase()];
}

/** A data: URI for logo bytes, so the card page needs no file access. */
export function logoDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Escape text for use inside HTML element content or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Text colour that reads on the background: dark on a light hex colour,
 * white on a dark one. Anything that is not a hex colour gets dark text.
 */
export function textColour(background: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim())?.[1];
  if (!hex) return "#111111";
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(full.slice(i, i + 2), 16) / 255,
  ) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#111111" : "#ffffff";
}

/**
 * The card page. Nothing moves until the recorder adds the `go` class to
 * the body, so the fade starts at a known moment. The fade out ends exactly
 * at `durationMs`.
 */
export function introHtml(input: {
  background: string;
  durationMs: number;
  logoSrc: string;
  subtitle?: string;
  title: string;
}): string {
  const outAt = Math.max(INTRO_FADE_MS, input.durationMs - INTRO_FADE_MS);
  const subtitle = input.subtitle
    ? `<p class="subtitle">${escapeHtml(input.subtitle)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: ${input.background}; }
  body { display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: ${textColour(input.background)}; }
  .card { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3vh; max-width: 80vw; opacity: 0; }
  .logo { max-width: 40vw; max-height: 22vh; }
  h1 { margin: 0; font-size: 4.4vw; line-height: 1.15; font-weight: 650; }
  .subtitle { margin: 0; font-size: 2.2vw; opacity: .75; }
  body.go .card { animation: sbv-in ${INTRO_FADE_MS}ms ease-out forwards, sbv-out ${INTRO_FADE_MS}ms ease-in ${outAt}ms forwards; }
  @keyframes sbv-in { from { opacity: 0; transform: translateY(1.5vh); } to { opacity: 1; transform: none; } }
  @keyframes sbv-out { from { opacity: 1; } to { opacity: 0; } }
</style>
</head>
<body>
  <div class="card">
    <img class="logo" alt="" src="${escapeHtml(input.logoSrc)}">
    <h1>${escapeHtml(input.title)}</h1>
    ${subtitle}
  </div>
</body>
</html>`;
}
