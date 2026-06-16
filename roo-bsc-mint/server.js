const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicRoot = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4310);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8"
};

function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.join(publicRoot, pathname);
  if (!filePath.startsWith(publicRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`roo-bsc-token listening on http://127.0.0.1:${port}`);
});
