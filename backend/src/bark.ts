import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dateInTimeZone } from "../../shared/billing.ts";
import { remaining, type Subscription } from "../../shared/subscriptions.ts";
import type { DeliveryState, BarkStatus } from "../../shared/notifications.ts";
import { money } from "../../shared/currency.ts";
import type { Config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { transaction } from "./database.ts";
import { SubscriptionService } from "./subscriptions.ts";

export type BarkPayload = {
  title: string;
  body: string;
  group?: string;
  url?: string;
  sound?: string;
  level?: "active" | "timeSensitive" | "passive";
  badge?: number;
};

export interface BarkSender {
  send(payload: BarkPayload): Promise<void>;
}

export function maskedBarkKey(value: string): string {
  if (!value) return "未配置";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function safeBarkError(error: unknown): { message: string; retryable: boolean; uncertain: boolean } {
  const original = error instanceof Error ? error.message : "未知错误";
  const sanitized = original.replace(/https?:\/\/[^\s/$.?#].[^\s]*/gi, url => {
    try {
      const u = new URL(url);
      return `${u.origin}/***`;
    } catch {
      return "[URL]";
    }
  });

  if (sanitized.includes("超时") || sanitized.includes("AbortError") || sanitized.includes("abort")) {
    return { message: "Bark 连接超时，结果未确认", retryable: false, uncertain: true };
  }
  if (sanitized.includes("device token not found") || sanitized.includes("未配置") || sanitized.includes("HTTP 400") || sanitized.includes("HTTP 404")) {
    return { message: `Bark 推送失败: ${sanitized}`, retryable: false, uncertain: false };
  }
  return { message: `Bark 推送失败: ${sanitized}`, retryable: true, uncertain: false };
}

export class HttpBarkSender implements BarkSender {
  private readonly server: string;
  private readonly key: string;

  constructor(server: string, key: string) {
    this.server = server.replace(/\/+$/, "");
    this.key = key;
  }

  async send(payload: BarkPayload): Promise<void> {
    if (!this.key) throw new Error("Bark 尚未配置推送 Key。");
    const endpoint = `${this.server}/${encodeURIComponent(this.key)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Bark 服务器响应错误 (HTTP ${response.status}): ${text.slice(0, 100)}`);
      }
      const data = await response.json().catch(() => null) as { code?: number; message?: string } | null;
      if (data && typeof data.code === "number" && data.code !== 200) {
        throw new Error(`Bark 推送失败: ${data.message || `code ${data.code}`}`);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error("Bark 服务器请求超时 (10秒)。");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type Candidate = { key: string; item: Subscription; days: number; advanced?: boolean };
const retryMinutes = [5, 30, 120, 360];
const testCooldown = 60_000;
const leaseMs = 120_000;

export class BarkNotificationService {
  private readonly db: DatabaseSync;
  private readonly config: Config;
  private readonly subscriptions: SubscriptionService;
  private readonly sender: BarkSender;
  private readonly clock: () => Date;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    db: DatabaseSync,
    config: Config,
    sender: BarkSender = new HttpBarkSender(config.bark.server, config.bark.key),
    clock: () => Date = () => new Date(),
  ) {
    this.db = db;
    this.config = config;
    this.subscriptions = new SubscriptionService(db, config.timeZone);
    this.sender = sender;
    this.clock = clock;
  }

  private owner(): number | undefined {
    const row = this.db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
    return row ? Number(row.id) : undefined;
  }

  private authorize(user: number): void {
    if (user !== this.owner()) throw new ApiError(403, "Bark 设置仅供主管理员使用。", "BARK_OWNER_REQUIRED");
  }

  private expireLeases(now: number): void {
    const message = "上次推送中断，结果未确认；请先检查手机通知，不会自动重推。";
    this.db.prepare("UPDATE bark_notification_deliveries SET status='uncertain',last_error=?,next_attempt_at=NULL WHERE status='pending' AND updated_at<?").run(message, now - leaseMs);
    this.db.prepare("UPDATE bark_test_attempts SET status='uncertain',last_error=? WHERE status='pending' AND attempted_at<?").run(message, now - leaseMs);
  }

  status(user: number): BarkStatus {
    this.authorize(user);
    this.expireLeases(this.clock().getTime());
    const recent = this.db.prepare(`SELECT 'reminder' AS kind,COALESCE(s.name,'已删除订阅') AS name,d.status,d.updated_at AS time,d.last_error AS error
      FROM bark_notification_deliveries d LEFT JOIN subscriptions s ON s.user_id=d.user_id AND s.id=d.subscription_id
      WHERE d.user_id=? UNION ALL SELECT 'test','测试通知',status,attempted_at,last_error FROM bark_test_attempts WHERE user_id=? ORDER BY time DESC LIMIT 5`).all(user, user);
    const attempt = this.db.prepare("SELECT attempted_at FROM bark_test_attempts WHERE user_id=?").get(user);
    const bark = this.config.bark;
    return {
      enabled: bark.enabled,
      configured: Boolean(bark.key),
      server: bark.server,
      maskedKey: maskedBarkKey(bark.key),
      sound: bark.sound,
      group: bark.group,
      timeZone: this.config.timeZone,
      reminderHour: this.config.email.reminderHour,
      reminderMinute: this.config.email.reminderMinute,
      testAvailableAt: attempt ? Number(attempt.attempted_at) + testCooldown : 0,
      recent: recent.map(row => ({
        kind: row.kind as "test" | "reminder",
        name: String(row.name),
        status: row.status as DeliveryState,
        updatedAt: Number(row.time),
        error: row.error ? String(row.error) : null,
      })),
    };
  }

  private async track<T>(pending: Promise<T>): Promise<T> {
    this.inFlight.add(pending);
    try { return await pending; } finally { this.inFlight.delete(pending); }
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  sendTest(user: number): Promise<void> {
    return this.track(this.sendTestInternal(user));
  }

  private async sendTestInternal(user: number): Promise<void> {
    this.authorize(user);
    if (!this.config.bark.key) {
      throw new ApiError(503, "Bark 尚未配置，请在 .env 中设置 BARK_KEY。", "BARK_NOT_CONFIGURED");
    }
    const now = this.clock().getTime();
    transaction(this.db, () => {
      const last = this.db.prepare("SELECT attempted_at FROM bark_test_attempts WHERE user_id=?").get(user);
      const wait = last ? Number(last.attempted_at) + testCooldown - now : 0;
      if (wait > 0) {
        throw new ApiError(429, "测试通知每分钟最多发送一次，请稍后再试。", "BARK_TEST_LIMIT", Math.ceil(wait / 1000));
      }
      this.db.prepare(`INSERT INTO bark_test_attempts(user_id,attempted_at,status) VALUES(?,?,'pending')
        ON CONFLICT(user_id) DO UPDATE SET attempted_at=excluded.attempted_at,status='pending',last_error=NULL`).run(user, now);
    });

    try {
      await this.sender.send({
        title: "Gx404 会员提醒测试",
        body: `这是一条会员看板测试通知。\n\n看板地址：${this.config.publicOrigin}\n你可以关闭网页，后端仍会按设置推送提醒。`,
        group: this.config.bark.group || "会员看板",
        url: this.config.publicOrigin,
        sound: this.config.bark.sound || undefined,
        level: "timeSensitive",
      });
    } catch (error) {
      const safe = safeBarkError(error);
      this.db.prepare("UPDATE bark_test_attempts SET status=?,last_error=? WHERE user_id=? AND attempted_at=?").run(safe.uncertain ? "uncertain" : "failed", safe.message, user, now);
      throw new ApiError(502, safe.message, safe.uncertain ? "BARK_UNCERTAIN" : "BARK_SEND_FAILED");
    }
    this.db.prepare("UPDATE bark_test_attempts SET status='sent',last_error=NULL WHERE user_id=? AND attempted_at=?").run(user, now);
  }

  sendDueReminders(now = this.clock()): Promise<number> {
    return this.track(this.sendDueInternal(now));
  }

  private async sendDueInternal(now: Date): Promise<number> {
    if (!this.config.bark.enabled || !this.config.bark.key) return 0;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: this.config.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const value = (name: string) => Number(parts.find(part => part.type === name)?.value ?? 0);
    if (value("hour") * 60 + value("minute") < this.config.email.reminderHour * 60 + this.config.email.reminderMinute) return 0;
    const owner = this.owner();
    if (!owner) return 0;

    const today = dateInTimeZone(now, this.config.timeZone), token = randomUUID();
    const candidates: Candidate[] = [];
    for (const item of this.subscriptions.list(owner).items) {
      const days = remaining(item, today);
      if (item.startDate <= today && days >= 0 && days <= item.reminderDays) {
        candidates.push({ key: `${item.id}:${item.endDate}`, item, days });
      }
      if (item.autoRenew && item.reminderDays === 0) {
        const log = this.db.prepare(`SELECT * FROM subscription_renewal_logs WHERE user_id=? AND subscription_id=? AND kind='automatic'
          AND previous_end_date=? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(owner, item.id, today);
        if (log) {
          candidates.push({
            key: `${item.id}:${today}`,
            days: 0,
            advanced: true,
            item: {
              ...item,
              name: String(log.subscription_name),
              startDate: String(log.previous_start_date),
              endDate: today,
              amount: log.amount_cents === null ? item.amount : Number(log.amount_cents) / 100 / Number(log.periods),
              currency: String(log.currency) as Subscription["currency"],
            },
          });
        }
      }
    }

    const pending = transaction(this.db, () => {
      this.expireLeases(now.getTime());
      let claimed = 0;
      return candidates.filter(candidate => {
        if (claimed >= 100) return false;
        const result = this.db.prepare(`INSERT INTO bark_notification_deliveries(user_id,notification_key,channel,subscription_id,end_date,reminder_days,status,attempts,created_at,updated_at,claim_token)
          VALUES(?,?,'bark',?,?,?,'pending',1,?,?,?) ON CONFLICT(user_id,notification_key,channel) DO UPDATE SET
          status='pending',attempts=attempts+1,last_error=NULL,updated_at=excluded.updated_at,claim_token=excluded.claim_token,next_attempt_at=NULL
          WHERE status='failed' AND attempts<5 AND next_attempt_at IS NOT NULL AND next_attempt_at<=excluded.updated_at`)
          .run(owner, candidate.key, candidate.item.id, candidate.item.endDate, candidate.item.reminderDays, now.getTime(), now.getTime(), token);
        if (Number(result.changes) !== 1) return false;
        claimed++;
        return true;
      });
    });

    if (!pending.length) return 0;

    const title = pending.length === 1 ? `${pending[0].item.name} 即将到期` : `Gx404 会员提醒：${pending.length} 项订阅待关注`;
    const body = this.body(pending, today);

    try {
      await this.sender.send({
        title,
        body,
        group: this.config.bark.group || "会员看板",
        url: this.config.publicOrigin,
        sound: this.config.bark.sound || undefined,
        level: "timeSensitive",
      });
    } catch (error) {
      const safe = safeBarkError(error);
      transaction(this.db, () => {
        for (const candidate of pending) {
          const row = this.db.prepare("SELECT attempts FROM bark_notification_deliveries WHERE user_id=? AND notification_key=? AND claim_token=?").get(owner, candidate.key, token);
          const delay = retryMinutes[Number(row?.attempts) - 1];
          const next = safe.retryable && delay ? now.getTime() + delay * 60_000 : null;
          this.db.prepare("UPDATE bark_notification_deliveries SET status=?,last_error=?,next_attempt_at=? WHERE user_id=? AND notification_key=? AND claim_token=?")
            .run(safe.uncertain ? "uncertain" : "failed", safe.message, next, owner, candidate.key, token);
        }
      });
      throw new Error(safe.message);
    }

    transaction(this.db, () => {
      for (const candidate of pending) {
        this.db.prepare("UPDATE bark_notification_deliveries SET status='sent',sent_at=?,last_error=NULL,next_attempt_at=NULL WHERE user_id=? AND notification_key=? AND claim_token=?")
          .run(now.getTime(), owner, candidate.key, token);
      }
    });

    return pending.length;
  }

  private body(items: Candidate[], _today: string): string {
    return items
      .sort((a, b) => a.days - b.days)
      .map(({ item, days, advanced }) => {
        const timeDesc = advanced
          ? "原账期今日结束，已自动进入下一期"
          : days === 0
            ? "今天到期"
            : `${days} 天后到期 (${item.endDate})`;
        const planDesc = item.plan ? ` (${item.plan})` : "";
        return `• ${item.name}${planDesc}: ${timeDesc} · ${money(item.amount, item.currency)}`;
      })
      .join("\n");
  }
}
