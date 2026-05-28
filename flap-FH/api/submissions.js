const crypto = require("node:crypto");
const { readRecords, writeRecords } = require("./_store");

function sendJson(response, status, data) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 64 * 1024) {
      throw new Error("提交内容过大。");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "请求方式不正确。" });
    return;
  }

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

    const records = await readRecords();
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
      ip: request.headers["x-forwarded-for"] || request.socket?.remoteAddress || ""
    };
    records.unshift(record);
    await writeRecords(records);
    sendJson(response, 200, { ok: true, record });
  } catch (error) {
    const status = error.code === "KV_NOT_CONFIGURED" ? 503 : 500;
    sendJson(response, status, { ok: false, message: error.message || "提交失败。" });
  }
};
