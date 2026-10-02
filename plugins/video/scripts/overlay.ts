/**
 * The overlay drawn on top of the page while recording: a cursor, a
 * highlight ring and a caption bar. It ignores pointer events, so clicks
 * reach the page underneath. It lives in the top page only; a target inside
 * an iframe is reached with coordinates on the top page.
 *
 * `installOverlay` runs inside the browser through `page.evaluate`, so it
 * must not reference anything outside its own body.
 */

/** Options passed into the page. */
export interface OverlayOptions {
  captions: boolean;
}

/** Browser-side API the recorder calls, installed as `window.__sbv`. */
export interface OverlayApi {
  caption(text: string | null): void;
  move(x: number, y: number, ms: number, linear?: boolean): void;
  pulse(): void;
  ring(
    rect: { height: number; width: number; x: number; y: number } | null,
  ): void;
}

/**
 * Install the overlay once; a second call does nothing. Returns true when it
 * was installed now, so the caller can put the cursor and the caption back
 * after the document was replaced.
 */
export function installOverlay(opts: OverlayOptions): boolean {
  const w = window as unknown as { __sbv?: OverlayApi };
  if (w.__sbv && document.getElementById("sbv-root")) return false;

  const root = document.createElement("div");
  root.id = "sbv-root";
  root.setAttribute("aria-hidden", "true");
  root.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;";

  const ring = document.createElement("div");
  ring.style.cssText =
    "position:fixed;border:4px solid #ffb000;border-radius:10px;box-shadow:0 0 0 6px rgba(255,176,0,.25),0 0 24px rgba(255,176,0,.5);opacity:0;transition:opacity .25s ease,left .35s ease,top .35s ease,width .35s ease,height .35s ease;";

  const cursor = document.createElement("div");
  cursor.id = "sbv-cursor";
  cursor.style.cssText =
    "position:fixed;left:0;top:0;width:32px;height:32px;transform:translate(-4px,-2px);transition-property:left,top;transition-timing-function:cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));";
  cursor.innerHTML =
    '<svg width="32" height="32" viewBox="0 0 32 32"><path d="M4 2 L4 26 L10.5 19.5 L15 29 L19 27 L14.5 17.8 L23.5 17.8 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';

  const ripple = document.createElement("div");
  ripple.style.cssText =
    "position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ffb000;opacity:0;transform:scale(.3);";

  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;left:50%;bottom:6%;transform:translateX(-50%);max-width:72%;padding:.55em 1.1em;border-radius:12px;background:rgba(17,17,17,.82);color:#fff;font-size:clamp(18px,2.3vw,40px);line-height:1.35;text-align:center;opacity:0;transition:opacity .2s ease;white-space:pre-line;";

  root.append(ring, ripple, cursor, bar);
  document.documentElement.append(root);

  let cx = window.innerWidth / 2;
  let cy = window.innerHeight / 2;
  cursor.style.left = `${cx}px`;
  cursor.style.top = `${cy}px`;

  w.__sbv = {
    caption(text) {
      if (!opts.captions) return;
      if (text) {
        bar.textContent = text;
        bar.style.opacity = "1";
      } else bar.style.opacity = "0";
    },
    move(x, y, ms, linear) {
      cursor.style.transitionDuration = `${ms}ms`;
      cursor.style.transitionTimingFunction = linear
        ? "linear"
        : "cubic-bezier(.4,0,.2,1)";
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
      cx = x;
      cy = y;
    },
    pulse() {
      ripple.style.left = `${cx}px`;
      ripple.style.top = `${cy}px`;
      ripple.animate(
        [
          { opacity: 0.9, transform: "scale(.3)" },
          { opacity: 0, transform: "scale(1.4)" },
        ],
        { duration: 450, easing: "ease-out" },
      );
    },
    ring(rect) {
      if (!rect) {
        ring.style.opacity = "0";
        return;
      }
      const pad = 8;
      ring.style.left = `${rect.x - pad}px`;
      ring.style.top = `${rect.y - pad}px`;
      ring.style.width = `${rect.width + pad * 2}px`;
      ring.style.height = `${rect.height + pad * 2}px`;
      ring.style.opacity = "1";
    },
  };
  return true;
}
