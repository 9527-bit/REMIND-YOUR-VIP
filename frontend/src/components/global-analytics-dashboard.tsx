import { useMemo, useState, useEffect } from "react";
import {
  Activity,
  ArrowRight,
  BarChart2,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  Gauge,
  Layers,
  PieChart,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import {
  type Subscription,
  remaining,
  stateOf,
  monthlyCostCny,
} from "@/lib/subscriptions";
import { formatCurrency } from "../../../shared/currency.ts";
import { ServiceLogo } from "@/components/service-logo";
import { categoryColors, categoryIcons } from "@/lib/category-meta";

type Props = {
  items: Subscription[];
  today: string;
  monthly: number;
  canManage: boolean;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  onSelectSubscription: (id: string) => void;
  onOpenCostsBreakdown: () => void;
};

type ChartStyle = "donut" | "gauge" | "spectrum";

/**
 * Global Asset & Spending Analytics Dashboard
 * 包含：
 * 1. 资产与开销核心仪表盘 (Monthly & Annual Amortization & 30-day forecast)
 * 2. 交互式分类占比可视化 (提供 3 种可切换形态：精修悬浮环形 / 极客半圆刻度仪表 / 光谱比例条)
 * 3. 订阅到期时间线脉络 (Upcoming Expiry Timeline Rail with Countdown & Actions)
 */
export function GlobalAnalyticsDashboard({
  items,
  today,
  monthly,
  canManage,
  selectedCategory,
  onSelectCategory,
  onSelectSubscription,
  onOpenCostsBreakdown,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [chartStyle, setChartStyle] = useState<ChartStyle>(() => {
    try {
      return (localStorage.getItem("vip-chart-style") as ChartStyle) || "donut";
    } catch {
      return "donut";
    }
  });

  const handleStyleChange = (style: ChartStyle) => {
    setChartStyle(style);
    try {
      localStorage.setItem("vip-chart-style", style);
    } catch {
      // storage can be disabled
    }
  };

  // 1. 基础健康与活跃度统计
  const { active, counts, next30DaysDue, next30DaysTotal } = useMemo(() => {
    const act = items.filter((i) => remaining(i, today) >= 0);
    const cnts = { healthy: 0, soon: 0, expired: 0 };
    for (const item of items) {
      cnts[stateOf(item, today)]++;
    }

    // 未来30天内需要续费的项目与总需资金
    const dueSoon = items
      .filter((i) => {
        const days = remaining(i, today);
        return days >= 0 && days <= 30;
      })
      .sort((a, b) => remaining(a, today) - remaining(b, today));

    const dueTotal = dueSoon.reduce(
      (sum, item) => sum + item.amount * (item.fxRateToCny || 1),
      0
    );

    return { active: act, counts: cnts, next30DaysDue: dueSoon, next30DaysTotal: dueTotal };
  }, [items, today]);

  // 2. 分类支出与环形图数据计算
  const categoryStats = useMemo(() => {
    const map = new Map<string, { count: number; monthlyTotal: number; items: Subscription[] }>();

    for (const item of items) {
      const cat = item.category || "其他服务";
      const existing = map.get(cat) ?? { count: 0, monthlyTotal: 0, items: [] };
      existing.count += 1;
      existing.items.push(item);
      if (remaining(item, today) >= 0) {
        existing.monthlyTotal += monthlyCostCny(item);
      }
      map.set(cat, existing);
    }

    const totalAmortized = monthly > 0 ? monthly : 1;
    const list = Array.from(map.entries())
      .map(([cat, data]) => {
        const percentage = Math.round((data.monthlyTotal / totalAmortized) * 100);
        const meta = categoryColors[cat] ?? categoryColors["其他服务"];
        return {
          category: cat,
          count: data.count,
          monthlyTotal: data.monthlyTotal,
          percentage,
          color: meta.bg,
          stroke: meta.stroke,
          glow: meta.glow,
        };
      })
      .sort((a, b) => b.monthlyTotal - a.monthlyTotal);

    return list;
  }, [items, monthly, today]);

  // =========================================================================
  // 精确无缝隙几何算法：彻底杜绝圆角重叠与结块（Math-Perfect Clean Arc System）
  // =========================================================================
  const donutGeometry = useMemo(() => {
    const radius = 40;
    const circumference = 2 * Math.PI * radius; // ~251.327
    const sliceCount = categoryStats.length;

    // 当有多个分类时，预留干净的 4.5px 极客微缝隙，绝无结块
    const gapLength = sliceCount > 1 ? 4.5 : 0;
    const totalGaps = sliceCount * gapLength;
    const usableCircumference = Math.max(1, circumference - totalGaps);

    let accumulatedOffset = 0;

    return categoryStats.map((slice) => {
      const ratio = slice.monthlyTotal / (monthly || 1);
      const dash = Math.max(0.5, ratio * usableCircumference);
      const gap = circumference - dash;
      const offset = -accumulatedOffset;

      accumulatedOffset += dash + gapLength;

      return {
        ...slice,
        dash,
        gap,
        offset,
        circumference,
      };
    });
  }, [categoryStats, monthly]);

  // 半圆仪表盘几何数据（180度，从左到右）
  const gaugeGeometry = useMemo(() => {
    const radius = 38;
    const semiCircumference = Math.PI * radius; // ~119.38
    const sliceCount = categoryStats.length;
    const gapLength = sliceCount > 1 ? 3 : 0;
    const usable = Math.max(1, semiCircumference - sliceCount * gapLength);

    let accumulated = 0;
    return categoryStats.map((slice) => {
      const ratio = slice.monthlyTotal / (monthly || 1);
      const dash = Math.max(0.5, ratio * usable);
      const gap = semiCircumference * 2 - dash;
      const offset = -accumulated;
      accumulated += dash + gapLength;
      return {
        ...slice,
        dash,
        gap,
        offset,
      };
    });
  }, [categoryStats, monthly]);

  // 3. 近期到期时间线列表
  const timelineItems = useMemo(() => {
    return [...items]
      .sort((a, b) => {
        const da = remaining(a, today);
        const db = remaining(b, today);
        return da - db;
      })
      .slice(0, 10);
  }, [items, today]);

  // 当前选中的/Hover的分类信息展示
  const activeFocusCategory = hoveredCategory
    ? categoryStats.find((c) => c.category === hoveredCategory)
    : selectedCategory !== "全部"
    ? categoryStats.find((c) => c.category === selectedCategory)
    : null;

  return (
    <section className="analytics-dashboard-wrapper" aria-label="全局开销与资产仪表盘">
      {/* 仪表盘顶栏：模式指示与折叠收起 */}
      <div className="analytics-header">
        <div className="analytics-header-left">
          <div className="analytics-pulse-badge">
            <span className="analytics-pulse-dot" />
            <span>智能开销大盘</span>
          </div>
          <span className="analytics-header-sub">
            实时汇总 {items.length} 项会员资产 · 监控现金流与到期脉络
          </span>
        </div>

        <div className="analytics-header-actions">
          {canManage && (
            <button
              className="analytics-action-pill"
              onClick={onOpenCostsBreakdown}
              title="查看按周期折算与摊提明细"
            >
              <TrendingUp size={13} />
              <span>摊算明细</span>
            </button>
          )}

          <button
            className="analytics-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            title={collapsed ? "展开大盘看板" : "收起大盘看板"}
          >
            {collapsed ? (
              <>
                <span>展开大盘</span>
                <ChevronDown size={14} />
              </>
            ) : (
              <>
                <span>收起大盘</span>
                <ChevronUp size={14} />
              </>
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="analytics-content-grid">
          {/* ===================== 板块 1: 开销与财务示数 (Financial Run-Rate) ===================== */}
          <div className="analytics-card metric-hero-card">
            <div className="card-top-caption">
              <span className="caption-badge">
                <Wallet size={12} />
                <span>订阅开销总览</span>
              </span>
              <span className="caption-tag">平摊折算模型</span>
            </div>

            <div className="hero-metric-group">
              <div className="hero-metric-primary">
                <div className="metric-label">月均支出估计</div>
                <div className="metric-number">
                  <small>¥</small>
                  <span>{formatCurrency(monthly, "CNY")}</span>
                  <em>/ 月</em>
                </div>
              </div>

              <div className="hero-metric-divider" />

              <div className="hero-metric-secondary">
                <div className="metric-label">年度总预算折算</div>
                <div className="metric-number-sub">
                  <small>¥</small>
                  <span>{formatCurrency(monthly * 12, "CNY")}</span>
                  <em>/ 年</em>
                </div>
              </div>
            </div>

            {/* 30天现金准备预测 */}
            <div className="cashflow-pill">
              <div className="cashflow-left">
                <Clock size={12} className="text-amber-400" />
                <span>未来 30 天需准备：</span>
                <strong>¥ {formatCurrency(next30DaysTotal, "CNY")}</strong>
              </div>
              <span className="cashflow-right">{next30DaysDue.length} 笔账单即将叩门</span>
            </div>

            {/* 订阅健康度遥测条 */}
            <div className="health-gauge-box">
              <div className="health-gauge-header">
                <span>资产健康分布</span>
                <span className="health-numbers">
                  <b className="text-emerald-400">{counts.healthy}</b> 正常 ·{" "}
                  <b className="text-amber-400">{counts.soon}</b> 临期 ·{" "}
                  <b className="text-rose-400">{counts.expired}</b> 过期
                </span>
              </div>
              <div className="health-multi-track">
                <span
                  style={{ width: `${(counts.healthy / Math.max(1, items.length)) * 100}%` }}
                  className="track-segment healthy"
                  title={`正常活跃: ${counts.healthy} 项`}
                />
                <span
                  style={{ width: `${(counts.soon / Math.max(1, items.length)) * 100}%` }}
                  className="track-segment soon"
                  title={`即将到期: ${counts.soon} 项`}
                />
                <span
                  style={{ width: `${(counts.expired / Math.max(1, items.length)) * 100}%` }}
                  className="track-segment expired"
                  title={`已过期: ${counts.expired} 项`}
                />
              </div>
            </div>
          </div>

          {/* ===================== 板块 2: 类别占比多形态图表 (Category Breakdown) ===================== */}
          <div className="analytics-card donut-chart-card">
            <div className="card-top-caption">
              <span className="caption-badge">
                <PieChart size={12} />
                <span>支出分类占比</span>
              </span>

              {/* 多形态切换选择器 (3 种风格实时切换) */}
              <div className="chart-style-switcher" role="radiogroup" aria-label="图表展现形式">
                <button
                  type="button"
                  className={`style-toggle-btn ${chartStyle === "donut" ? "active" : ""}`}
                  onClick={() => handleStyleChange("donut")}
                  title="精修悬浮环形图 (Clean Donut)"
                >
                  <CircleDot size={11} />
                  <span>圆环</span>
                </button>
                <button
                  type="button"
                  className={`style-toggle-btn ${chartStyle === "gauge" ? "active" : ""}`}
                  onClick={() => handleStyleChange("gauge")}
                  title="极客刻度半圆仪表 (Cyber Gauge)"
                >
                  <Gauge size={11} />
                  <span>仪表</span>
                </button>
                <button
                  type="button"
                  className={`style-toggle-btn ${chartStyle === "spectrum" ? "active" : ""}`}
                  onClick={() => handleStyleChange("spectrum")}
                  title="光谱比例条带 (Spectrum Bar)"
                >
                  <BarChart2 size={11} />
                  <span>条带</span>
                </button>
              </div>
            </div>

            {/* 图表展示区：依据选定风格渲染 */}
            <div className="donut-visualization-body">
              {/* ------------ 形态 1: 精修悬浮圆环 (Refined Floating Donut) ------------ */}
              {chartStyle === "donut" && (
                <div className="donut-svg-container">
                  <svg
                    viewBox="0 0 100 100"
                    className="donut-svg"
                    aria-hidden="true"
                    style={{ transform: "rotate(-90deg)" }}
                  >
                    {/* 底层极客导轨 */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke="rgba(128, 128, 128, 0.12)"
                      strokeWidth="7"
                    />

                    {/* 彩色弧段（微缝隙 + 零重叠精密切分） */}
                    {donutGeometry.map((slice) => {
                      const isHovered = hoveredCategory === slice.category;
                      const isSelected = selectedCategory === slice.category;
                      return (
                        <circle
                          key={slice.category}
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth={isHovered || isSelected ? "10" : "7.5"}
                          strokeDasharray={`${slice.dash} ${slice.gap}`}
                          strokeDashoffset={slice.offset}
                          strokeLinecap="butt"
                          className="donut-arc-slice"
                          onMouseEnter={() => setHoveredCategory(slice.category)}
                          onMouseLeave={() => setHoveredCategory(null)}
                          onClick={() =>
                            onSelectCategory(
                              selectedCategory === slice.category ? "全部" : slice.category
                            )
                          }
                          style={{
                            filter:
                              isHovered || isSelected
                                ? `drop-shadow(0 0 8px ${slice.glow})`
                                : undefined,
                            transition: "all 180ms cubic-bezier(0.16, 1, 0.3, 1)",
                            cursor: "pointer",
                          }}
                        />
                      );
                    })}
                  </svg>

                  {/* 环心智能示数看板 */}
                  <div className="donut-center-overlay">
                    {activeFocusCategory ? (
                      <>
                        <div className="overlay-sub">{activeFocusCategory.category}</div>
                        <div className="overlay-val" style={{ color: activeFocusCategory.color }}>
                          {activeFocusCategory.percentage}%
                        </div>
                        <div className="overlay-extra">
                          ¥{formatCurrency(activeFocusCategory.monthlyTotal, "CNY")}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="overlay-sub">月均支出</div>
                        <div className="overlay-val">
                          <small>¥</small>
                          {Math.round(monthly)}
                        </div>
                        <div className="overlay-extra">{categoryStats.length} 个分类</div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ------------ 形态 2: 极客刻度半圆仪表 (Cyber Gauge) ------------ */}
              {chartStyle === "gauge" && (
                <div className="gauge-svg-container">
                  <svg viewBox="0 0 100 65" className="gauge-svg" aria-hidden="true">
                    {/* 半圆底轨 */}
                    <path
                      d="M 12 55 A 38 38 0 0 1 88 55"
                      fill="none"
                      stroke="rgba(128, 128, 128, 0.15)"
                      strokeWidth="7"
                      strokeLinecap="round"
                    />

                    {/* 彩色仪表段 */}
                    {gaugeGeometry.map((slice) => {
                      const isHovered = hoveredCategory === slice.category;
                      const isSelected = selectedCategory === slice.category;
                      return (
                        <path
                          key={slice.category}
                          d="M 12 55 A 38 38 0 0 1 88 55"
                          fill="none"
                          stroke={slice.color}
                          strokeWidth={isHovered || isSelected ? "9.5" : "7"}
                          strokeDasharray={`${slice.dash} ${slice.gap}`}
                          strokeDashoffset={slice.offset}
                          strokeLinecap="butt"
                          className="gauge-arc-slice"
                          onMouseEnter={() => setHoveredCategory(slice.category)}
                          onMouseLeave={() => setHoveredCategory(null)}
                          onClick={() =>
                            onSelectCategory(
                              selectedCategory === slice.category ? "全部" : slice.category
                            )
                          }
                          style={{
                            filter:
                              isHovered || isSelected
                                ? `drop-shadow(0 0 8px ${slice.glow})`
                                : undefined,
                            transition: "all 180ms ease",
                            cursor: "pointer",
                          }}
                        />
                      );
                    })}
                  </svg>

                  {/* 仪表底心数据 */}
                  <div className="gauge-center-stat">
                    {activeFocusCategory ? (
                      <>
                        <span className="gauge-stat-title" style={{ color: activeFocusCategory.color }}>
                          {activeFocusCategory.category}
                        </span>
                        <span className="gauge-stat-number">{activeFocusCategory.percentage}%</span>
                        <span className="gauge-stat-extra">
                          ¥{formatCurrency(activeFocusCategory.monthlyTotal, "CNY")}/月
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="gauge-stat-title">月度总预算</span>
                        <span className="gauge-stat-number">
                          <small>¥</small>
                          {Math.round(monthly)}
                        </span>
                        <span className="gauge-stat-extra">
                          首要: {categoryStats[0]?.category} ({categoryStats[0]?.percentage}%)
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ------------ 形态 3: 光谱比例条 (Spectrum Bar) ------------ */}
              {chartStyle === "spectrum" && (
                <div className="spectrum-container">
                  <div className="spectrum-bar-track">
                    {categoryStats.map((slice) => {
                      const isHovered = hoveredCategory === slice.category;
                      const isSelected = selectedCategory === slice.category;
                      return (
                        <div
                          key={slice.category}
                          className={`spectrum-segment ${isHovered ? "is-hovered" : ""} ${
                            isSelected ? "is-selected" : ""
                          }`}
                          style={{
                            width: `${Math.max(2, slice.percentage)}%`,
                            backgroundColor: slice.color,
                            boxShadow: isHovered || isSelected ? `0 0 10px ${slice.glow}` : undefined,
                          }}
                          onMouseEnter={() => setHoveredCategory(slice.category)}
                          onMouseLeave={() => setHoveredCategory(null)}
                          onClick={() =>
                            onSelectCategory(
                              selectedCategory === slice.category ? "全部" : slice.category
                            )
                          }
                          title={`${slice.category}：${slice.percentage}% (¥${Math.round(
                            slice.monthlyTotal
                          )}/月)`}
                        />
                      );
                    })}
                  </div>

                  <div className="spectrum-summary-row">
                    <span className="spectrum-summary-item">
                      {activeFocusCategory ? (
                        <>
                          <strong style={{ color: activeFocusCategory.color }}>
                            {activeFocusCategory.category}
                          </strong>
                          <span>
                            占比 {activeFocusCategory.percentage}% · ¥
                            {formatCurrency(activeFocusCategory.monthlyTotal, "CNY")}/月
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>全部分类</strong>
                          <span>
                            共 {categoryStats.length} 类 · 月均总支出 ¥
                            {formatCurrency(monthly, "CNY")}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* 右侧交互分类图例列表（带彩色进度微背景） */}
              <div className="donut-legend-stream">
                {categoryStats.slice(0, 4).map((slice) => {
                  const isHovered = hoveredCategory === slice.category;
                  const isSelected = selectedCategory === slice.category;
                  const Icon = categoryIcons[slice.category] ?? Layers;

                  return (
                    <button
                      key={slice.category}
                      className={`legend-pill-row ${isHovered ? "is-hovered" : ""} ${
                        isSelected ? "is-selected" : ""
                      }`}
                      onMouseEnter={() => setHoveredCategory(slice.category)}
                      onMouseLeave={() => setHoveredCategory(null)}
                      onClick={() =>
                        onSelectCategory(
                          selectedCategory === slice.category ? "全部" : slice.category
                        )
                      }
                      title={`点击筛选【${slice.category}】`}
                    >
                      {/* 背景微进度条（轻量透出比例感） */}
                      <div
                        className="legend-bg-fill"
                        style={{
                          width: `${slice.percentage}%`,
                          backgroundColor: slice.color,
                        }}
                      />

                      <div
                        className="legend-indicator-dot"
                        style={{ backgroundColor: slice.color }}
                      />
                      <Icon size={12} className="legend-cat-icon" />
                      <span className="legend-name">{slice.category}</span>
                      <span className="legend-percent">{slice.percentage}%</span>
                      <span className="legend-amount">
                        ¥{Math.round(slice.monthlyTotal)}
                        <small>/月</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ===================== 板块 3: 近期到期时间线 (Upcoming Expiry Timeline) ===================== */}
          <div className="analytics-card timeline-card">
            <div className="card-top-caption">
              <span className="caption-badge">
                <CalendarDays size={12} />
                <span>近期到期时间线</span>
              </span>
              <span className="caption-tag">到期倒计时雷达</span>
            </div>

            <div className="timeline-rail-scroll">
              <div className="timeline-rail-content">
                {timelineItems.length === 0 ? (
                  <div className="timeline-empty-notice">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    <span>暂无订阅记录，点击右上角即可添加</span>
                  </div>
                ) : (
                  timelineItems.map((item, idx) => {
                    const days = remaining(item, today);
                    const status = stateOf(item, today);
                    const isExpired = days < 0;

                    let badgeText = `${days} 天后`;
                    if (days === 0) badgeText = "今日到期";
                    else if (isExpired) badgeText = `已逾期 ${-days}天`;

                    return (
                      <div
                        key={item.id}
                        className={`timeline-node-item ${status}`}
                        onClick={() => onSelectSubscription(item.id)}
                        title={`点击在下方管理 ${item.name}`}
                      >
                        {/* 节点顶部刻度指示 */}
                        <div className="timeline-node-time-marker">
                          <span className={`timeline-time-led ${status}`} />
                          <span className="timeline-time-text">{badgeText}</span>
                        </div>

                        {/* 节点主体内容胶囊 */}
                        <div className="timeline-node-box">
                          <div className="node-box-header">
                            <ServiceLogo name={item.name} color={item.color} />
                            <div className="node-box-meta">
                              <span className="node-title" title={item.name}>
                                {item.name}
                              </span>
                              <span className="node-date">
                                {item.endDate.slice(5).replace("-", "/")}
                              </span>
                            </div>
                          </div>

                          <div className="node-box-footer">
                            <span className="node-price">
                              {item.currency === "USD"
                                ? "$"
                                : item.currency === "EUR"
                                ? "€"
                                : "¥"}
                              {item.amount.toFixed(2)}
                            </span>
                            <span
                              className={`node-cycle-tag ${
                                item.autoRenew ? "auto" : "manual"
                              }`}
                            >
                              {item.autoRenew ? "自动" : "手动"}
                            </span>
                          </div>
                        </div>

                        {/* 连接线线段 */}
                        {idx < timelineItems.length - 1 && (
                          <div className="timeline-connecting-line" aria-hidden="true" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
