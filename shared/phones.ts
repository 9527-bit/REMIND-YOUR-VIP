import { monthlyCostCny, type Subscription } from "./subscriptions.ts";

export const phoneCarriers = ["中国移动", "中国联通", "中国电信", "中国广电", "其他"] as const;
export const phoneChargeTypes = { monthly: "固定月租", yearly: "包年费用", once: "一次性费用" } as const;
export type PhoneChargeType = keyof typeof phoneChargeTypes;
export type PhoneAccount = {
  id: string; label: string; number: string; carrier: typeof phoneCarriers[number]; note: string;
  balance: number | null; balanceAsOf: string | null; version: number;
};

export function maskedPhone(number: string): string {
  return `${number.slice(0, 3)}****${number.slice(-4)}`;
}

/** A one-off charge never becomes a recurring monthly budget. */
export function phoneMonthlyCost(items: Subscription[], today: string): number {
  return items.filter(item => item.startDate <= today && item.endDate > today)
    .reduce((sum, item) => sum + monthlyCostCny(item), 0);
}

export function nextPhoneBill(items: Subscription[], today: string): string | null {
  const dates = items.filter(item => item.phoneChargeType !== "once" && item.endDate >= today)
    .map(item => item.startDate > today ? item.startDate : item.endDate);
  return dates.sort()[0] ?? null;
}
