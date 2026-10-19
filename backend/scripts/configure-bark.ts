import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { mkdir, writeFile, rename, copyFile, chmod, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";
import { HttpBarkSender, safeBarkError } from "../src/bark.ts";

let muted = false;
let temporary: string | undefined;
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const prompt = createInterface({ input: process.stdin, output, terminal: true });
const abort = new AbortController();
prompt.on("SIGINT", () => abort.abort());

try {
  if (!process.stdin.isTTY) throw new Error("请在自己的交互式 SSH 终端使用 docker compose exec backend 运行配置向导。");
  if (!process.env.EMAIL_CONFIG_FILE) throw new Error("未设置 EMAIL_CONFIG_FILE，请使用新版 Compose 配置。");

  console.log("Bark iOS 推送配置。按 Ctrl+C 可取消。");
  console.log("请在 iPhone 打开 Bark App 获取设备 Key 或完整推送 URL。");
  const rawInput = (await prompt.question("Bark 推送 Key 或完整 URL（例如 https://api.day.app/your_key）：", { signal: abort.signal })).trim();
  if (!rawInput) throw new Error("Bark Key 不能为空。");

  let barkKey = rawInput;
  let barkServer = "https://api.day.app";
  if (barkKey.startsWith("http://") || barkKey.startsWith("https://")) {
    try {
      const parsed = new URL(barkKey);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        barkKey = decodeURIComponent(segments.pop()!);
        barkServer = `${parsed.origin}${segments.length ? "/" + segments.join("/") : ""}`;
      }
    } catch {
      throw new Error("提供的 Bark URL 格式不正确。");
    }
  }

  const sound = (await prompt.question("推送铃声（回车默认 minuet，可选 chime, glass, electronic 等）：", { signal: abort.signal })).trim() || "minuet";
  const group = (await prompt.question("通知分组（回车默认 会员看板）：", { signal: abort.signal })).trim() || "会员看板";

  const settings: Record<string, string> = {
    BARK_NOTIFICATIONS: "true",
    BARK_SERVER: barkServer,
    BARK_KEY: barkKey,
    BARK_SOUND: sound,
    BARK_GROUP: group,
  };

  const config = readConfig({ ...process.env, ...settings });
  console.log("正在向 Bark 发送一封测试通知…");
  try {
    await new HttpBarkSender(barkServer, barkKey).send({
      title: "Gx404 会员提醒测试",
      body: `这是一条配置验证通知。\n\n看板：${config.publicOrigin}\n配置完成并重启后，每天按订阅设置推送临期提醒。`,
      group,
      sound,
      url: config.publicOrigin,
      level: "timeSensitive",
    });
  } catch (error) {
    throw safeBarkError(error);
  }

  const filename = resolve(process.env.EMAIL_CONFIG_FILE);
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  temporary = filename + "." + randomUUID() + ".tmp";

  // Merge with existing private settings if present
  let existing: Record<string, string> = {};
  try {
    const { readFileSync } = await import("node:fs");
    existing = JSON.parse(readFileSync(filename, "utf8")) as Record<string, string>;
  } catch {
    // fine if file doesn't exist yet
  }

  const merged = { ...existing, ...settings };
  await writeFile(temporary, JSON.stringify(merged, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await copyFile(filename, filename + ".previous");
    await chmod(filename + ".previous", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("旧配置备份失败，未覆盖原配置。");
  }
  await rename(temporary, filename);
  temporary = undefined;
  console.log("测试通知已成功送达 Bark 服务器！请检查手机锁屏。");
  console.log("配置已保存。请执行 docker compose restart backend 生效。");
} catch (error) {
  muted = false;
  if (abort.signal.aborted) console.error("\n已取消，未启用新的 Bark 设置。");
  else console.error("\n配置未完成：", (error as NodeJS.ErrnoException).code ? "终端或配置文件操作失败，请检查权限。" : error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
} finally {
  muted = false;
  prompt.close();
  output.end();
  if (temporary) {
    try { await unlink(temporary); } catch { console.error("临时文件清理失败，请检查数据目录。该文件权限为 600。"); }
  }
}
