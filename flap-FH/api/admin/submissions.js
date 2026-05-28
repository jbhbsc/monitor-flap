const { readRecords } = require("../_store");

const adminPassword = process.env.ADMIN_PASSWORD || "147258";

function sendJson(response, status, data) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "请求方式不正确。" });
    return;
  }

  if (request.headers["x-admin-password"] !== adminPassword) {
    sendJson(response, 401, { ok: false, message: "管理员密码错误。" });
    return;
  }

  try {
    const records = await readRecords();
    sendJson(response, 200, { ok: true, records });
  } catch (error) {
    const status = error.code === "KV_NOT_CONFIGURED" ? 503 : 500;
    sendJson(response, status, { ok: false, message: error.message || "加载失败。" });
  }
};
