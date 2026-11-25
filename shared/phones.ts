import { dateNumber, monthlyCostCny, remindersEnabled, type Subscription } from "./subscriptions.ts";
import { periodPercentage } from "./presentation.ts";

export const phoneCarriers = ["中国移动", "中国联通", "中国电信", "中国广电", "其他"] as const;
export const phoneChargeTypes = { monthly: "固定月租", yearly: "包年费用", once: "一次性费用" } as const;
export type PhoneChargeType = keyof typeof phoneChargeTypes;
export type PhoneDisplayPreference = { selectedChargeId: string | null; version: number };
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

/** A display-only aggregate: never insert this summary into subscriptions or payment reporting. */
export function phoneSummary(accounts: PhoneAccount[], items: Subscription[], today: string, selectedChargeId: string | null = null) {
  const owners = new Map(accounts.map(account => [account.id,account]));
  const charges = items.filter(item => item.expenseType === "phone" && owners.has(item.phoneAccountId!));
  const annual = charges.filter(item => item.phoneChargeType === "yearly" && item.startDate <= today)
    .sort((a,b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  const nextAnnual = annual.find(item => item.endDate >= today) ?? null;
  const overdue = annual.filter(item => remindersEnabled(item) && item.endDate < today).length;
  const dueSoon = annual.filter(item => remindersEnabled(item) && item.endDate >= today && dateNumber(item.endDate)-dateNumber(today) <= item.reminderDays).length;
  const recurring = charges.filter(item => item.phoneChargeType !== "once")
    .sort((a,b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  const selected = recurring.find(item => item.id === selectedChargeId);
  const displayed = selected ?? nextAnnual ?? recurring.find(item => item.endDate >= today) ?? recurring.at(-1);
  const display = displayed ? { id: displayed.id, label: owners.get(displayed.phoneAccountId!)!.label,
    plan: displayed.plan || displayed.name, startDate: displayed.startDate, endDate: displayed.endDate,
    days: Math.round(dateNumber(displayed.endDate)-dateNumber(today)),
    startsIn: Math.max(0,Math.round(dateNumber(displayed.startDate)-dateNumber(today))),
    percentage: periodPercentage(displayed,today), manual: Boolean(selected) } : null;
  return { count: accounts.length, monthly: phoneMonthlyCost(charges,today),
    nextAnnual: nextAnnual ? { date: nextAnnual.endDate, label: owners.get(nextAnnual.phoneAccountId!)!.label } : null,
    overdue, dueSoon, display, nextBillDate: nextPhoneBill(charges,today),
    searchText: ["手机话费", ...accounts.flatMap(account => [account.label,account.number,account.carrier,account.note]), ...charges.flatMap(item => [item.name,item.plan,item.note])].join(" ").toLowerCase() };
}
export type PhoneSummary = ReturnType<typeof phoneSummary>;
