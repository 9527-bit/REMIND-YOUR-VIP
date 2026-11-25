import type { DatabaseSync } from "node:sqlite";
import type { Subscription } from "../../shared/subscriptions.ts";
import { automaticPeriod } from "../../shared/billing.ts";
import { paymentState, type Payment } from "../../shared/payments.ts";
import { RenewalHistory, renewalFromRow } from "./renewal-history.ts";
import { dateSchema } from "./validation.ts";

/** Called inside the owner's transaction; bill snapshots never change with the next period's price. */
export class FixedExpenseBills {
  private db: DatabaseSync;
  private history: RenewalHistory;
  constructor(db: DatabaseSync) { this.db = db; this.history = new RenewalHistory(db); }

  generate(owner: number, item: Subscription, anchor: string, today: string, now: Date) {
    let period = { ...item }, periods = 0, added = 0;
    if (item.expenseType === "phone" && !item.autoRenew) {
      return { startDate: item.startDate, endDate: item.endDate, periods: 0,
        added: item.startDate <= today ? this.record(owner,item,anchor,now) : 0 };
    }
    // Bound catch-up work. Another scheduler pass continues from the last saved boundary.
    for (let index = 0; index < 120 && period.startDate <= today; index++) {
      added += this.record(owner, period, anchor, now);
      if (period.endDate > today) break;
      const next = automaticPeriod(period, anchor, period.endDate)!;
      dateSchema.parse(next.endDate);
      period = { ...period, startDate: next.startDate, endDate: next.endDate };
      periods++;
    }
    return { startDate: period.startDate, endDate: period.endDate, periods, added };
  }

  private record(owner: number, item: Subscription, anchor: string, now: Date): number {
    if (this.db.prepare("SELECT id FROM subscription_renewal_logs WHERE user_id=? AND subscription_id=? AND fixed_bill_json IS NOT NULL AND new_start_date=?")
      .get(owner, item.id, item.startDate)) return 0;
    const logs = this.db.prepare("SELECT * FROM subscription_renewal_logs WHERE user_id=? AND subscription_id=?").all(owner, item.id).map(renewalFromRow);
    // A prepayment or an earlier manual audit already represents this exact period.
    if (logs.some(log => !log.undoneAt && log.periods === 1 &&
      (log.payment?.startDate ?? log.newStartDate) === item.startDate && (log.payment?.endDate ?? log.newEndDate) === item.endDate)) return 0;
    const log = this.history.record(owner, item, item, anchor, anchor, "automatic", 1, now.getTime());
    const fixedBill = { category: item.category, plan: item.plan, autoRecord: Boolean(item.autoRecord) };
    const overlapping = logs.some(log => paymentState(log) !== "void" &&
      (log.payment?.startDate ?? log.newStartDate) < item.endDate && (log.payment?.endDate ?? log.newEndDate) > item.startDate);
    let payment: Payment | null = null;
    if (item.autoRecord && !item.ratePending && !overlapping) {
      payment = { amount: item.amount, currency: item.currency ?? "CNY", paidOn: item.startDate,
        startDate: item.startDate, endDate: item.endDate, rate: item.fxRateToCny ?? 1,
        rateDate: item.fxRateDate ?? item.purchaseDate ?? item.startDate, rateBasisDate: item.purchaseDate ?? item.startDate,
        category: item.category, plan: item.plan, note: "按固定支出设置自动记账，未核实服务商扣款。",
        source: "fixed", confirmedAt: now.toISOString(), voidedAt: null };
    }
    this.db.prepare("UPDATE subscription_renewal_logs SET fixed_bill_json=?,payment_json=? WHERE user_id=? AND id=?")
      .run(JSON.stringify(fixedBill), payment ? JSON.stringify(payment) : null, owner, log.id);
    return 1;
  }
}
