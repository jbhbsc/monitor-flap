const fs = require("node:fs/promises");
const path = require("node:path");

const STORE_KEY = "flap_fh_submissions";
const localDataFile = path.join(__dirname, "..", "data", "submissions.json");

function kvConfig() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ""
  };
}

function hasKv() {
  const { url, token } = kvConfig();
  return Boolean(url && token);
}

async function kvCommand(command) {
  const { url, token } = kvConfig();
  if (!url || !token) {
    const error = new Error("线上保存需要先在 Vercel 配置 KV_REST_API_URL 和 KV_REST_API_TOKEN。");
    error.code = "KV_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || (data && data.error)) {
    throw new Error((data && data.error) || `KV 请求失败：${response.status}`);
  }
  return data ? data.result : null;
}

async function readLocalRecords() {
  try {
    const raw = await fs.readFile(localDataFile, "utf8");
    return JSON.parse(raw || "[]");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalRecords(records) {
  await fs.mkdir(path.dirname(localDataFile), { recursive: true });
  await fs.writeFile(localDataFile, JSON.stringify(records, null, 2), "utf8");
}

async function readRecords() {
  if (!hasKv() && !process.env.VERCEL) {
    return readLocalRecords();
  }

  const raw = await kvCommand(["GET", STORE_KEY]);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return JSON.parse(raw);
}

async function writeRecords(records) {
  if (!hasKv() && !process.env.VERCEL) {
    await writeLocalRecords(records);
    return;
  }

  await kvCommand(["SET", STORE_KEY, JSON.stringify(records)]);
}

module.exports = {
  readRecords,
  writeRecords
};
