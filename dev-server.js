// 本地测试服务器：在无法运行 wrangler/workerd 的环境（如 Termux/Android）
// 下，用 Node 直接驱动 Cloudflare Worker 的 fetch handler。
// 用法：node dev-server.js [端口]（默认 8787，与 wrangler dev 一致）
//
// 变量注入方式与 wrangler dev 相同：wrangler.toml 的 [vars] + .dev.vars。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import workerModule from "./worker.js";

const DEFAULT_PORT = 8787;
const ROOT = import.meta.dirname;

function loadTomlVars() {
  const vars = {};
  const text = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  const section = text.match(/\[vars\]([\s\S]*?)(?=\n\[|$)/);
  if (!section) return vars;
  for (const line of section[1].split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function loadDotDevVars() {
  const vars = {};
  const file = path.join(ROOT, ".dev.vars");
  if (!fs.existsSync(file)) return vars;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const env = { ...loadTomlVars(), ...loadDotDevVars() };
const worker = workerModule.default ?? workerModule;
const workerFetch = worker.fetch;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
  }
  delete headers["content-length"];
  delete headers["transfer-encoding"];

  const request = new Request(url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body
  });

  let response;
  try {
    response = await workerFetch(request, env);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain;charset=utf-8" });
    res.end(`本地服务器错误: ${error?.message ?? error}`);
    return;
  }

  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});

const port = Number(process.argv[2]) || DEFAULT_PORT;
server.listen(port, () => {
  console.log(`本地 Worker 已启动: http://localhost:${port}`);
  console.log(
    `DeepSeek API Key: ${env.DEEPSEEK_API_KEY ? "已注入 (.dev.vars)" : "未配置"}`
  );
  console.log(`API_URL: ${env.API_URL ?? "默认 https://api.deepseek.com/chat/completions"}`);
  console.log(`Model: ${env.DEEPSEEK_MODEL ?? "默认 deepseek-v4-flash"}`);
});
