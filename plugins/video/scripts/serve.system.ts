/**
 * A local static file server for a built Storybook (or any folder), bound to
 * 127.0.0.1 on a free port. Stops when the recording ends.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** A running server and how to stop it. */
export interface StaticServer {
  close(): Promise<void>;
  url: string;
}

/** Serve `dir` on 127.0.0.1. Requests outside the folder get 403. */
export function serveFolder(dir: string): Promise<StaticServer> {
  const rootDir = resolve(dir);
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(
      new URL(req.url ?? "/", "http://x").pathname,
    );
    let file = normalize(join(rootDir, path));
    if (file !== rootDir && !file.startsWith(rootDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory())
      file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolveServer({
        close: () => new Promise((r) => server.close(() => r())),
        url: `http://127.0.0.1:${port}/`,
      });
    });
  });
}
