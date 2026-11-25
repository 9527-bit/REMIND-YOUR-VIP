import type { CSSProperties } from "react";
import { ArrowUpRight, CalendarDays, Smartphone } from "lucide-react";
import { CurrencyAmount } from "@/components/currency-amount";
import { Progress } from "@/components/ui/progress";
import { progressColor } from "../../../shared/presentation.ts";
import type { PhoneSummary } from "../../../shared/phones.ts";

type Props = { summary: PhoneSummary; compact: boolean; onOpen: () => void };

/** One grid entry: aggregate costs with one explicitly identified package's remaining period. */
export function PhoneSummaryCard({ summary, compact, onOpen }: Props) {
  const selected=summary.display;
  const status=selected && selected.days<0 ? "expired" : summary.overdue ? "expired" : summary.dueSoon ? "soon" : "healthy";
  const alert=summary.overdue ? `${summary.overdue} 项年包已到期` : summary.dueSoon ? `${summary.dueSoon} 项年包临期` : "";
  const remaining=selected ? selected.startsIn>0 ? `${selected.startsIn} 天后生效` : selected.days<0 ? `已到期 ${-selected.days} 天` : selected.days===0 ? "今日到期" : `剩余 ${selected.days} 天` : "暂无套餐";
  const percentage=selected?.percentage ?? 0;
  const description=selected ? `${selected.label} · ${selected.plan}：${remaining}，本期剩余 ${percentage}%，${selected.startDate} 至 ${selected.endDate}` : "暂无可展示的月租或年包";
  const progress=<><div className="phone-progress-caption"><span title={selected ? `${selected.label} · ${selected.plan}` : "尚未添加套餐"}>{selected ? `${selected.label} · ${selected.plan}` : "尚未添加套餐"}</span><b>{percentage}%</b></div><Progress value={percentage} aria-label="套餐剩余进度" aria-valuetext={description} title={description} className={`segments phone-package-progress${percentage===0 ? " is-empty" : ""}`} style={{"--segment-color":progressColor(percentage)} as CSSProperties}/></>;
  return <article className={compact ? `subscription-row phone-summary-row ${status}` : `subscription-card geek-card phone-summary-card ${status}`} aria-label="手机话费汇总">
    <button type="button" className="phone-summary-open" aria-label="管理手机话费" aria-haspopup="dialog" onClick={onOpen}/>
    {compact ? <>
      <div className="row-service"><span className="phone-summary-icon"><Smartphone size={21}/></span><div><h2>手机话费</h2><p>{summary.count} 个号码 · 合计月均</p></div></div>
      <div className="row-amount"><CurrencyAmount amount={summary.monthly} currency="CNY"/><small> / 月</small></div>
      <div className="row-date"><b>{remaining}</b>{selected ? <time dateTime={selected.endDate}>{selected.endDate}</time> : <span className="muted">添加月租或年包</span>}</div>
      <span className="phone-summary-link">管理号码<ArrowUpRight size={14}/></span>
      <div className="phone-summary-row-progress">{progress}</div>
    </> : <>
      <div className="card-heading"><span className="phone-summary-icon"><Smartphone size={22}/></span><div className="service-name"><h2>手机话费</h2><p>月租 · 年包 · 一次性费用</p></div><span className="phone-summary-count">{summary.count} 个号码</span></div>
      <div className="phone-summary-metrics"><div className="phone-summary-cost"><span>合计月均成本</span><strong><CurrencyAmount amount={summary.monthly} currency="CNY"/><small>/月</small></strong><p>全部号码费用折算</p></div><div className="phone-summary-remaining"><span>{selected?.startsIn ? "距离生效" : selected && selected.days<0 ? "已到期" : "套餐剩余时间"}</span><strong>{selected ? <>{selected.startsIn || Math.abs(selected.days)}<small>天</small></> : "—"}</strong><p>{selected ? selected.days===0 ? "今日到期" : selected.manual ? "指定套餐" : "自动选择套餐" : "添加月租或年包"}</p></div></div>
      <div className="phone-summary-progress">{progress}</div>
      <div className="phone-summary-expiry"><span><CalendarDays size={13}/>{selected ? selected.startsIn>0 ? "生效日期" : "套餐到期" : "套餐到期"}</span><strong>{selected ? <time dateTime={selected.startsIn>0 ? selected.startDate : selected.endDate}>{selected.startsIn>0 ? selected.startDate : selected.endDate}</time> : "暂无套餐"}</strong>{alert && <span className={`phone-summary-alert ${status}`} role="status">{alert}</span>}</div>
      <div className="phone-summary-link"><span>管理号码与费用</span><ArrowUpRight size={15}/></div>
    </>}
  </article>;
}
