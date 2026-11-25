import type { Subscription } from "./subscriptions.ts";
import type { CurrencySnapshot } from "./currency.ts";
import type { Payment } from "./payments.ts";

export const UNDO_RENEWAL_MS = 30_000;
export type FixedBill = { category: string; plan: string; autoRecord: boolean };
/** A ledger entry records scheduling/amount estimates, never a verified provider payment. */
export type RenewalLog = CurrencySnapshot & {
  id: string; subscriptionId: string; subscriptionName: string; kind: "manual" | "automatic";
  previousStartDate: string; previousEndDate: string; newStartDate: string; newEndDate: string;
  amount: number | null; periods: number; createdAt: string; undoneAt: string | null;
  payment?: Payment | null;
  previousRatePending?: boolean;
  fixedBill?: FixedBill | null;
};
export type RenewalResult = { item: Subscription; renewal: RenewalLog; undoUntil: string | null };
export type HistoryPage = { logs: RenewalLog[]; total: number };
export type BackupSubscription = Subscription & { renewalAnchorDate: string };
export type BackupDocument = {
  application: "vip-manager"; formatVersion: 1 | 2 | 3 | 4 | 5; exportedAt: string; currency: "CNY";
  phoneAccounts?: import("./phones.ts").PhoneAccount[];
  phoneDisplayChargeId?: string | null;
  subscriptions: BackupSubscription[]; renewalLogs: RenewalLog[];
};
export type ImportPreview = {
  revision: string; subscriptions: number; logs: number; existing: number;
  newSubscriptions: number; skippedSubscriptions: number; newLogs: number;
  phoneAccounts?: number; newPhoneAccounts?: number;
};
