import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { readConfig } from "../src/config.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { BarkNotificationService, HttpBarkSender, maskedBarkKey, safeBarkError, type BarkPayload } from "../src/bark.ts";
import { NotificationManager, EmailNotificationService } from "../src/notifications.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const config = readConfig({
  PUBLIC_ORIGIN: "https://frontend.test",
  BARK_NOTIFICATIONS: "true",
  BARK_KEY: "testBarkDeviceKey123",
  BARK_SERVER: "https://api.day.app",
  BARK_SOUND: "minuet",
  BARK_GROUP: "VIP",
  EMAIL_REMINDER_HOUR: "9",
  EMAIL_REMINDER_MINUTE: "0",
});

const record = (changes: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "Netflix", plan: "高级4K", category: "影音娱乐", amount: 98, cycle: "monthly", customDays: 30,
  startDate: "2026-10-01", endDate: "2026-10-10", reminderDays: 3, autoRenew: false, note: "private note", color: "#269979", version: 0,
  currency: "CNY", purchaseDate: "2026-10-01", fxRateToCny: 1, fxRateDate: "2026-10-01", fxRateSource: "manual", ...changes,
});

test("Bark 配置解析支持完整 URL 与自动提取 Server 和 Key", () => {
  const c1 = readConfig({ BARK_KEY: "https://api.day.app/mySecretKey123/" });
  assert.equal(c1.bark.server, "https://api.day.app");
  assert.equal(c1.bark.key, "mySecretKey123");

  const c2 = readConfig({ BARK_KEY: "https://bark.custom.domain:8080/push/customKey999" });
  assert.equal(c2.bark.server, "https://bark.custom.domain:8080/push");
  assert.equal(c2.bark.key, "customKey999");

  const c3 = readConfig({ BARK_KEY: "justAKey", BARK_SERVER: "https://mybark.com/" });
  assert.equal(c3.bark.server, "https://mybark.com");
  assert.equal(c3.bark.key, "justAKey");

  assert.throws(() => readConfig({ BARK_NOTIFICATIONS: "true", BARK_KEY: "" }), /启用 Bark 提醒需要配置 BARK_KEY/);
  assert.throws(() => readConfig({ BARK_SERVER: "ftp://invalid" }), /BARK_SERVER 必须是有效的 http\(s\) 地址/);
});

test("Bark 密钥脱敏与安全错误清洗", () => {
  assert.equal(maskedBarkKey(""), "未配置");
  assert.equal(maskedBarkKey("123"), "***");
  assert.equal(maskedBarkKey("abcdefghij"), "abc***hij");

  const err1 = safeBarkError(new Error("fetch failed at https://api.day.app/superSecretKey/test"));
  assert.ok(!err1.message.includes("superSecretKey"));
  assert.ok(err1.retryable);

  const err2 = safeBarkError(new Error("device token not found"));
  assert.ok(!err2.retryable);
  assert.ok(!err2.uncertain);

  const err3 = safeBarkError(new Error("The operation was aborted due to timeout"));
  assert.ok(err3.uncertain);
  assert.ok(!err3.retryable);
});

test("Bark 提醒按账期去重，包含金额和计划，且不泄露私人备注", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
  const service = new SubscriptionService(db, config.timeZone);
  service.execute(1, { action: "create", item: record() });

  const sent: BarkPayload[] = [];
  const notifications = new BarkNotificationService(db, config, { send: async payload => { sent.push(payload); } }, () => new Date("2026-10-08T01:00:00Z"));

  // 08:59 local (before reminder hour 9)
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T00:59:00Z")), 0);
  // 09:00 local (2 days left for 2026-10-10, reminderDays is 3)
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T01:00:00Z")), 1);
  // Repeat check does not duplicate
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T02:00:00Z")), 0);

  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Netflix/);
  assert.match(sent[0].body, /Netflix \(高级4K\): 2 天后到期/);
  assert.match(sent[0].body, /¥98.00/);
  assert.ok(!sent[0].body.includes("private note"));
  assert.equal(sent[0].group, "VIP");
  assert.equal(sent[0].url, config.publicOrigin);

  const deliveries = db.prepare("SELECT * FROM bark_notification_deliveries WHERE user_id=1").all();
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "sent");
});

test("Bark 测试推送限流 60 秒并持久化测试记录", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
  const sent: BarkPayload[] = [];
  const notifications = new BarkNotificationService(db, config, { send: async payload => { sent.push(payload); } }, () => new Date("2026-10-08T01:00:00Z"));

  await notifications.sendTest(1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /会员提醒测试/);

  // Immediate retry within 60s is rejected with 429
  const second = new BarkNotificationService(db, config, { send: async payload => { sent.push(payload); } }, () => new Date("2026-10-08T01:00:30Z"));
  await assert.rejects(second.sendTest(1), { status: 429, retryAfterSeconds: 30 });

  const status = second.status(1);
  assert.equal(status.configured, true);
  assert.equal(status.enabled, true);
  assert.equal(status.maskedKey, "tes***123");
  assert.equal(status.recent[0].status, "sent");
});

test("NotificationManager 组合邮件与 Bark 推送，两者互不阻塞", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
  const service = new SubscriptionService(db, config.timeZone);
  service.execute(1, { action: "create", item: record() });

  let emailSent = 0;
  let barkSent = 0;
  const emailService = new EmailNotificationService(db, { ...config, email: { ...config.email, enabled: true, password: "fake" } }, {
    send: async () => { throw new Error("SMTP server down"); },
  }, () => new Date("2026-10-08T01:00:00Z"));

  const barkService = new BarkNotificationService(db, config, {
    send: async () => { barkSent++; },
  }, () => new Date("2026-10-08T01:00:00Z"));

  const manager = new NotificationManager(emailService, barkService);
  const sentCount = await manager.sendDueReminders(new Date("2026-10-08T01:00:00Z"));

  assert.equal(sentCount, 1);
  assert.equal(barkSent, 1);

  const status = manager.status(1);
  assert.ok(status.bark);
  assert.ok(status.email);
  assert.equal(status.bark.configured, true);
});

test("HttpBarkSender 正常发送、处理错误码和超时中断", async t => {
  const { createServer } = await import("node:http");
  let lastReq: { url?: string; method?: string; body?: unknown } = {};
  let respondWith: { status: number; body: unknown } = { status: 200, body: { code: 200, message: "success" } };
  let delayMs = 0;

  const server = createServer(async (req, res) => {
    lastReq = { url: req.url, method: req.method };
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    lastReq.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    res.writeHead(respondWith.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(respondWith.body));
  });

  await new Promise<void>((resolve, reject) => { server.listen(0, "127.0.0.1", () => resolve()); server.on("error", reject); });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const port = (server.address() as { port: number }).port;
  const sender = new HttpBarkSender(`http://127.0.0.1:${port}`, "myDeviceKey");

  await sender.send({ title: "测试", body: "内容", group: "会员", sound: "minuet" });
  assert.equal(lastReq.method, "POST");
  assert.equal(lastReq.url, "/myDeviceKey");
  assert.deepEqual(lastReq.body, { title: "测试", body: "内容", group: "会员", sound: "minuet" });

  respondWith = { status: 200, body: { code: 400, message: "device token not found" } };
  await assert.rejects(sender.send({ title: "测试", body: "内容" }), /device token not found/);

  respondWith = { status: 502, body: { error: "bad gateway" } };
  await assert.rejects(sender.send({ title: "测试", body: "内容" }), /HTTP 502/);
});

