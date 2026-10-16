import type { CSSProperties } from "react";
import { CalendarDays, Clock3, Ellipsis, RefreshCw, Wallet, ZapOff } from "lucide-react";
import { ServiceLogo } from "@/components/service-logo";
import { Progress } from "@/components/ui/progress";
import { cycles, periodPercentage, progressColor, remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { CurrencyAmount } from "@/components/currency-amount";
import { resolveBrandColor } from "@/lib/brand-colors";
import { useCardSpotlight } from "@/lib/use-card-spotlight";

type Props = { item: Subscription; today: string; canManage: boolean; onEdit: () => void };

/**
 * Modern Linear / Raycast / Vercel style subscription card with:
 * - Acrylic glassmorphism surface
 * - 1px edge micro-highlight
 * - Cursor-tracking spotlight hover effect (zero re-render)
 * - Ambient brand glow projection
 * - Monospace telemetry data stream
 * - Pulsing status LED
 */
export function SubscriptionCard({ item, today, canManage, onEdit }: Props) {
  const { cardRef, onMouseMove, onMouseEnter, onMouseLeave } = useCardSpotlight();
  const days = remaining(item, today);
  const status = stateOf(item, today);
  const progress = periodPercentage(item, today);
  const metadata = [item.plan, item.category].filter(Boolean).join(" · ");

  // High-fidelity brand lighting
  const brandColor = resolveBrandColor(item.name, item.color);

  // Status labels & accessible strings
  const statusTagLabel = days < 0 ? "已到期" : days === 0 ? "今日到期" : status === "soon" ? "即将到期" : null;
  const statusDisplay = days < 0 ? `已逾期 ${-days} 天` : days === 0 ? "今日到期" : status === "soon" ? `剩余 ${days} 天` : "正常";
  const periodLabel = item.coverageStartDate ? "总时长剩余" : "本期剩余";
  const progressLabel = `${item.name}：${periodLabel} ${progress}%，${item.coverageStartDate ?? item.startDate} 至 ${item.endDate}，${days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今日到期" : `距到期 ${days} 天`}`;

  return (
    <article
      ref={cardRef}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`subscription-card geek-card ${status}`}
      aria-label={item.name}
      style={{ "--brand-color": brandColor } as CSSProperties}
    >
      {/* 品牌环境散射光 (Ambient Brand Glow) */}
      <div className="geek-card-glow" aria-hidden="true" />

      {/* 探照灯光晕 (Spotlight Hover Effect) */}
      <div className="geek-card-spotlight" aria-hidden="true" />

      {/* 1px Edge Highlight & 微光内边框 */}
      <div className="geek-card-border" aria-hidden="true" />

      {/* 卡片主体内容层 */}
      <div className="geek-card-content">
        {/* 卡片头部 */}
        <div className="card-heading">
          <ServiceLogo name={item.name} color={brandColor} />
          <div className="service-name">
            <h2 title={item.name}>{item.name}</h2>
            <p title={metadata}>{metadata || "会员服务"}</p>
          </div>

          {/* 呼吸状态指示灯 (Pulsing Status LED) */}
          <span
            className={`status-indicator ${status}`}
            role="status"
            aria-label={statusTagLabel ?? "正常"}
            title={statusDisplay}
          >
            <span className="status-led" aria-hidden="true">
              <span className="status-led-ping" />
              <span className="status-led-core" />
            </span>
            <span className="status-text">{statusTagLabel ?? "正常"}</span>
          </span>

          {/* 管理操作 */}
          {canManage && (
            <div className="card-actions">
              <button
                className="icon-button"
                aria-label={`编辑${item.name}`}
                title="编辑订阅信息"
                onClick={onEdit}
              >
                <Ellipsis size={18} />
              </button>
            </div>
          )}
        </div>

        {/* 等宽数字化遥测展示 (Geek Telemetry Grid) */}
        <div className="card-metrics membership-metrics telemetry-grid">
          <span className="telemetry-col card-metric">
            <span className="small-label telemetry-label">
              <Clock3 size={12} />
              <span>{days < 0 ? "已过期" : "剩余时间"}</span>
            </span>
            <span className="remaining-number telemetry-value-days">
              {Math.abs(days)}
              <span>天</span>
            </span>
          </span>

          <span className="telemetry-col card-metric">
            <span className="small-label telemetry-label">
              <Wallet size={12} />
              <span>续费金额</span>
            </span>
            <p className="membership-price telemetry-value-price">
              <CurrencyAmount amount={item.amount} currency={item.currency} />
              <small> / {item.cycle === "custom" ? `${item.customDays}天` : cycles[item.cycle].replace("付", "")}</small>
            </p>
          </span>
        </div>

        {/* 时间进度与刻度 */}
        <div className="progress-caption">
          {statusTagLabel ? (
            <span className={`card-status ${days <= 0 ? "expired" : "soon"}`}>{statusTagLabel}</span>
          ) : (
            <span>{periodLabel}</span>
          )}
          <span>{progress}%</span>
        </div>

        <Progress
          value={progress}
          aria-label={progressLabel}
          aria-valuetext={progressLabel}
          title={progressLabel}
          className={`segments${progress === 0 ? " is-empty" : ""}`}
          style={{ "--segment-color": progressColor(progress) } as CSSProperties}
        />

        {/* 底部仪器时间戳与特征标签 */}
        <div className="membership-expiry geek-card-footer">
          <div className="membership-expiry-date">
            <CalendarDays size={12} />
            <span>到期日期</span>
            <time dateTime={item.endDate}>{item.endDate.replaceAll("-", ".")}</time>
          </div>

          <span
            className={`geek-badge ${item.autoRenew ? "auto" : "manual"}`}
            title={item.autoRenew ? "到期日后台自动顺延" : "手动记录续费"}
          >
            {item.autoRenew ? (
              <>
                <RefreshCw size={10} className="spin" />
                <span>自动续费</span>
              </>
            ) : (
              <>
                <ZapOff size={10} />
                <span>手动记录</span>
              </>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
