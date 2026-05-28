const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT || 4208);
const root = __dirname;
const dataFile = path.join(root, "data", "submissions.json");
const adminPassword = process.env.ADMIN_PASSWORD || "147258";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 64 * 1024) {
      throw new Error("request too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendMethodNotAllowed(response) {
  sendJson(response, 405, { ok: false, message: "请求方式不正确。" });
}

async function readSubmissions() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return JSON.parse(raw || "[]");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeSubmissions(records) {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(records, null, 2), "utf8");
}

function isValidAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function isValidTweetLink(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase();
    return (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) &&
      url.pathname.split("/").filter(Boolean).length >= 3;
  } catch {
    return false;
  }
}

async function handleSubmit(request, response) {
  try {
    const body = await readJsonBody(request);
    const tweetLink = String(body.tweetLink || "").trim();
    const walletAddress = String(body.walletAddress || "").trim();

    if (!isValidTweetLink(tweetLink)) {
      sendJson(response, 400, { ok: false, message: "请填写有效的 X/Twitter 推文链接。" });
      return;
    }
    if (!isValidAddress(walletAddress)) {
      sendJson(response, 400, { ok: false, message: "请先连接钱包，或填写有效钱包地址。" });
      return;
    }

    const records = await readSubmissions();
    const exists = records.some((record) =>
      record.walletAddress.toLowerCase() === walletAddress.toLowerCase() &&
      record.tweetLink.toLowerCase() === tweetLink.toLowerCase()
    );
    if (exists) {
      sendJson(response, 409, { ok: false, message: "这条推文链接已经提交过。" });
      return;
    }

    const record = {
      id: crypto.randomUUID(),
      tweetLink,
      walletAddress,
      createdAt: new Date().toISOString(),
      ip: request.socket.remoteAddress || ""
    };
    records.unshift(record);
    await writeSubmissions(records);
    sendJson(response, 200, { ok: true, record });
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error.message || "提交失败。" });
  }
}

async function handleAdminList(request, response) {
  const password = request.headers["x-admin-password"];
  if (password !== adminPassword) {
    sendJson(response, 401, { ok: false, message: "管理员密码错误。" });
    return;
  }

  const records = await readSubmissions();
  sendJson(response, 200, { ok: true, records });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  let fileName = decodeURIComponent(url.pathname);
  if (fileName === "/") fileName = "/index.html";

  const filePath = path.normalize(path.join(root, fileName));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === "/api/submissions") {
      if (request.method !== "POST") {
        sendMethodNotAllowed(response);
        return;
      }
      await handleSubmit(request, response);
      return;
    }
    if (url.pathname === "/api/admin/submissions") {
      if (request.method !== "GET") {
        sendMethodNotAllowed(response);
        return;
      }
      await handleAdminList(request, response);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error.message || "服务器错误。" });
  }
}).listen(port, () => {
  console.log(`FLAP-FH running at http://localhost:${port}`);
  console.log(`Admin page: http://localhost:${port}/admin.html`);
});
