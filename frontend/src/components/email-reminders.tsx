import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, RotateCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { ContextHelp } from "@/components/context-help";
import type { NotificationStatus } from "../../../shared/notifications.ts";

const stateLabel = { pending: "发送中", sent: "已提交", failed: "发送失败", uncertain: "待核实" };

/** Owner-only notification status and rate-limited smoke tests for Email & Bark. */
export function EmailReminders() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [error, setError] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingBark, setSendingBark] = useState(false);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(false);
  const inFlightEmail = useRef(false);
  const inFlightBark = useRef(false);

  const load = useCallback(async () => {
    try {
      const value = await apiRequest<NotificationStatus>("/notifications/status");
      if (alive.current) {
        setStatus(value);
        setNow(Date.now());
        setError("");
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : "提醒状态加载失败");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const sendEmail = async () => {
    if (inFlightEmail.current) return;
    inFlightEmail.current = true;
    setSendingEmail(true);
    try {
      await apiRequest("/notifications/test", {});
      if (alive.current) toast.success("测试邮件已提交", { description: "请检查收件箱和垃圾邮件；是否通知由 QQ 邮箱客户端设置决定。" });
    } catch (err) {
      if (alive.current) toast.error(err instanceof Error ? err.message : "测试邮件发送失败");
    } finally {
      inFlightEmail.current = false;
      if (alive.current) {
        setSendingEmail(false);
        await load();
      }
    }
  };

  const sendBark = async () => {
    if (inFlightBark.current) return;
    inFlightBark.current = true;
    setSendingBark(true);
    try {
      await apiRequest("/notifications/bark/test", {});
      if (alive.current) toast.success("测试通知已发送至 Bark", { description: "请检查 iPhone 锁屏通知或 Bark 客户端历史。" });
    } catch (err) {
      if (alive.current) toast.error(err instanceof Error ? err.message : "测试 Bark 发送失败");
    } finally {
      inFlightBark.current = false;
      if (alive.current) {
        setSendingBark(false);
        await load();
      }
    }
  };

  const emailCooldown = Math.max(0, Math.ceil(((status?.testAvailableAt ?? 0) - now) / 1000));
  const barkCooldown = Math.max(0, Math.ceil(((status?.bark?.testAvailableAt ?? 0) - now) / 1000));

  return (
    <section className="email-reminders" aria-label="到期通知设置">
      {error && <p className="inline-error" role="alert">{error}</p>}

      {/* Bark iOS Push Channel Card */}
      <div className="notification-channel-card">
        <div className="email-reminder-heading">
          <strong><Smartphone size={17} />Bark 提醒 (iOS 推送)</strong>
          {status?.bark ? (
            status.bark.configured ? (
              <span className={`channel-pill ${status.bark.enabled ? "active" : "paused"}`}>
                {status.bark.enabled ? "已启用" : "已暂停"}
              </span>
            ) : (
              <span className="channel-pill unconfigured">未配置</span>
            )
          ) : null}
          <ContextHelp label="Bark 提醒说明">
            <p>Bark 是 iOS 上的开源轻量通知推送应用。在 iPhone 的 App Store 搜索安装 Bark 并打开，即可获取你的专属推送地址或设备 Key。</p>
            <p>在服务器部署的 .env 中配置 BARK_NOTIFICATIONS=true 与 BARK_KEY（支持直接粘贴完整 URL，例如 https://api.day.app/你的Key）。</p>
            <p>系统会在每天设定时间扫描临期订阅，直接推送到你的 iPhone 锁屏。无需开启浏览器网页。</p>
          </ContextHelp>
        </div>
        <div className="email-reminder-controls">
          <span>
            {status ? (
              status.bark?.configured
                ? `${status.bark.maskedKey} · ${status.bark.server} · ${status.bark.enabled ? `每日 ${String(status.bark.reminderHour).padStart(2, "0")}:${String(status.bark.reminderMinute).padStart(2, "0")}` : "自动推送已暂停"}`
                : "尚未配置（在 .env 中设置 BARK_KEY）"
            ) : "正在读取设置…"}
          </span>
          <button className="icon-button" aria-label="刷新 Bark 状态" onClick={() => void load()}><RotateCw size={16} /></button>
          <button
            className="button secondary"
            disabled={!status?.bark?.configured || sendingBark || barkCooldown > 0}
            onClick={() => void sendBark()}
          >
            {sendingBark ? "发送中…" : barkCooldown ? `${barkCooldown} 秒后可重试` : "发送 Bark 测试"}
          </button>
        </div>
        {!!status?.bark?.recent?.length && (
          <details className="email-results">
            <summary>最近 Bark 发送记录</summary>
            <ul>
              {status.bark.recent.map((item, index) => (
                <li key={`bark-${item.kind}-${item.updatedAt}-${index}`}>
                  <span>{item.name} · {stateLabel[item.status]}</span>
                  <time dateTime={new Date(item.updatedAt).toISOString()}>
                    {new Date(item.updatedAt).toLocaleString("zh-CN", { timeZone: status.timeZone })}
                  </time>
                  {item.error && <small role="status">{item.error}</small>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* SMTP Email Channel Card */}
      <div className="notification-channel-card">
        <div className="email-reminder-heading">
          <strong><Mail size={17} />邮件提醒</strong>
          {status ? (
            status.configured ? (
              <span className={`channel-pill ${status.enabled ? "active" : "paused"}`}>
                {status.enabled ? "已启用" : "已暂停"}
              </span>
            ) : (
              <span className="channel-pill unconfigured">未配置</span>
            )
          ) : null}
          <ContextHelp label="邮件提醒说明">
            <p>后台按每条订阅的提前天数提醒，不需要开着网页。同一到期日成功提交后不再重复发送；汇总邮件不含私人备注。</p>
            <p>连接失败会间隔重试，最多 5 次；提交结果不明或进程中断会标为待核实，避免盲目重发。已提交不代表已进入收件箱。</p>
            <p>首次配置请在服务器运行：docker compose exec backend node backend/scripts/configure-email.ts，然后重启后端。授权码不会存入浏览器或 JSON 订阅备份。</p>
          </ContextHelp>
        </div>
        <div className="email-reminder-controls">
          <span>
            {status ? (
              status.configured
                ? `${status.recipient} · ${status.enabled ? `每日 ${String(status.reminderHour).padStart(2, "0")}:${String(status.reminderMinute).padStart(2, "0")}` : "自动提醒已暂停"}`
                : "尚未配置"
            ) : "正在读取设置…"}
          </span>
          <button className="icon-button" aria-label="刷新邮件状态" onClick={() => void load()}><RotateCw size={16} /></button>
          <button
            className="button secondary"
            disabled={!status?.configured || sendingEmail || emailCooldown > 0}
            onClick={() => void sendEmail()}
          >
            {sendingEmail ? "发送中…" : emailCooldown ? `${emailCooldown} 秒后可重试` : "发送测试邮件"}
          </button>
        </div>
        {!!status?.recent?.length && (
          <details className="email-results">
            <summary>最近发送记录</summary>
            <ul>
              {status.recent.map((item, index) => (
                <li key={`email-${item.kind}-${item.updatedAt}-${index}`}>
                  <span>{item.name} · {stateLabel[item.status]}</span>
                  <time dateTime={new Date(item.updatedAt).toISOString()}>
                    {new Date(item.updatedAt).toLocaleString("zh-CN", { timeZone: status.timeZone })}
                  </time>
                  {item.error && <small role="status">{item.error}</small>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
