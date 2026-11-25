/** Shared subscription data and timezone-safe date-only arithmetic. */
import { amountInCny, type CurrencySnapshot } from "./currency.ts";
export const categories = ["影音娱乐", "购物电商", "AI 工具", "云存储", "办公效率", "设计与创作", "云服务与网络", "游戏会员", "学习教育", "生活服务", "其他服务"] as const;

/** Accept older API clients and backups without leaving obsolete category names in storage. */
export function normalizeCategory(value: unknown): unknown {
  const aliases: Record<string, string> = { "购物会员": "购物电商", "云盘存储": "云存储", "效率办公": "办公效率", "网络服务": "云服务与网络" };
  return typeof value === "string" && Object.hasOwn(aliases, value) ? aliases[value] : value;
}
export const cycles = { monthly: "月付", quarterly: "季付", yearly: "年付", custom: "自定义" } as const;
export type Subscription = CurrencySnapshot & {
  expenseType?: "subscription" | "fixed" | "phone";
  phoneAccountId?: string;
  phoneChargeType?: "monthly" | "yearly" | "once";
  reminderEnabled?: boolean;
  autoRecord?: boolean;
  billingDay?: number;
  ratePending?: boolean;
  coverageStartDate?: string;
  id: string; name: string; plan: string; category: string; amount: number;
  cycle: keyof typeof cycles; customDays: number; startDate: string; endDate: string;
  reminderDays: number; autoRenew: boolean; note: string; color: string; version: number;
};
export function isFixedExpense(item: Pick<Subscription, "expenseType">): boolean { return item.expenseType === "fixed" || item.expenseType === "phone"; }
export function remindersEnabled(item: Pick<Subscription, "expenseType" | "reminderEnabled">): boolean {
  return item.reminderEnabled ?? !isFixedExpense(item);
}
export type DashboardSnapshot = { items: Subscription[]; phoneAccounts?: import("./phones.ts").PhoneAccount[]; phoneDisplay?: import("./phones.ts").PhoneDisplayPreference; canManage: boolean; publicDashboard: boolean; today: string; timeZone: string };
export const palette = ["#d74747", "#269979", "#497ccd", "#8a5fc4", "#cf8b30", "#3b424c"];
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateNumber(date: string): number { return Date.parse(`${date}T00:00:00Z`) / 86400000; }
export function shiftDate(date: string, days: number): string { return new Date((dateNumber(date) + days) * 86400000).toISOString().slice(0, 10); }
export function remaining(item: Subscription, today: string): number { return Math.round(dateNumber(item.endDate) - dateNumber(today)); }
export function stateOf(item: Subscription, today: string) {
  const days = remaining(item, today);
  return days < 0 ? "expired" : days <= item.reminderDays ? "soon" : "healthy";
}
export function monthlyCost(item: Subscription): number {
  if (item.phoneChargeType === "once") return 0;
  return item.amount / (item.cycle === "yearly" ? 12 : item.cycle === "quarterly" ? 3 : item.cycle === "custom" ? item.customDays / 30 : 1);
}
/** Human-readable frequency shared by fixed-expense budget cards and bill captions. */
export function billingCadence(item: Pick<Subscription, "cycle" | "customDays">): string {
  return item.cycle === "custom" ? `每 ${item.customDays} 天` : { monthly: "每月", quarterly: "每季", yearly: "每年" }[item.cycle];
}
/** A pending snapshot cannot provide a known RMB amount. */
export function subscriptionAmountCny(item: Subscription): number | null {
  if (item.ratePending) return null;
  return amountInCny(item.amount, item.fxRateToCny);
}
/** Monthly cost converted to the dashboard base currency using the locked rate. */
export function monthlyCostCny(item: Subscription): number {
  if (item.ratePending) return 0;
  return amountInCny(monthlyCost(item), item.fxRateToCny);
}
/** Add a billing cycle with month-end clamping. */
export function renewDate(base: string, cycle: Subscription["cycle"], days: number): string {
  if (cycle === "custom") return shiftDate(base, days);
  const d = new Date(`${base}T00:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (cycle === "yearly" ? 12 : cycle === "quarterly" ? 3 : 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
