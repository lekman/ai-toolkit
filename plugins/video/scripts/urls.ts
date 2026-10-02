/** Where each scene is loaded from. */

import type { Scene } from "./script.ts";

/** True when the string carries a URL scheme such as http: or file:. */
export function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

/** True when `storybook` names a running server rather than a folder. */
export function isServerUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Make sure a base URL ends with a slash, so relative paths resolve under it. */
export function withSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * The page to open for a scene. A story opens Storybook's iframe view, which
 * shows the story alone without the Storybook sidebar and toolbar.
 */
export function sceneUrl(scene: Scene, base: string | undefined): string {
  if (scene.story) {
    if (!base)
      throw new Error(`Story ${scene.story} needs a storybook base URL`);
    const url = new URL("iframe.html", withSlash(base));
    url.searchParams.set("id", scene.story);
    url.searchParams.set("viewMode", "story");
    return url.toString();
  }
  const target = scene.url as string;
  if (isAbsoluteUrl(target)) return target;
  if (!base)
    throw new Error(
      `Relative url ${target} needs a storybook base URL or folder`,
    );
  return new URL(target, withSlash(base)).toString();
}
