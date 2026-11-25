import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { phoneCarriers, type PhoneAccount, type PhoneDisplayPreference } from "../../shared/phones.ts";
import { transaction } from "./database.ts";
import { dateSchema, idSchema } from "./validation.ts";
import { ApiError } from "./errors.ts";

export const phoneAccountSchema = z.object({
  id: idSchema, label: z.string().trim().min(1, "请填写号码备注。").max(30),
  number: z.string().trim().regex(/^1[3-9][0-9]{9}$/, "请填写 11 位手机号码。"),
  carrier: z.enum(phoneCarriers), note: z.string().trim().max(500),
  balance: z.number().finite().min(-10_000_000).max(10_000_000)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "余额最多保留两位小数。").nullable(),
  balanceAsOf: dateSchema.nullable(), version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
}).strict().refine(item => (item.balance === null) === (item.balanceAsOf === null), "填写余额时请同时填写核对日期。");

export function phoneFromRow(row: Record<string, unknown>): PhoneAccount {
  return { id: String(row.id), label: String(row.label), number: String(row.number),
    carrier: row.carrier as PhoneAccount["carrier"], note: String(row.note),
    balance: row.balance_cents === null ? null : Number(row.balance_cents) / 100,
    balanceAsOf: row.balance_as_of === null ? null : String(row.balance_as_of), version: Number(row.version) };
}

/** Private phone identities; credential acquisition/synchronisation is independent of this data model. */
export class PhoneAccounts {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  list(owner: number): PhoneAccount[] {
    return this.db.prepare("SELECT * FROM phone_accounts WHERE user_id=? ORDER BY label,id").all(owner).map(phoneFromRow);
  }

  preference(owner: number): PhoneDisplayPreference {
    const row = this.db.prepare("SELECT phone_display_subscription_id,phone_display_version FROM subscription_preferences WHERE user_id=?").get(owner);
    const id = row?.phone_display_subscription_id;
    const valid = id && this.db.prepare("SELECT id FROM subscriptions WHERE user_id=? AND id=? AND expense_type='phone' AND phone_charge_type IN ('monthly','yearly')").get(owner,String(id));
    return { selectedChargeId: valid ? String(id) : null, version: Number(row?.phone_display_version ?? 0) };
  }

  setPreference(owner: number, body: unknown): PhoneDisplayPreference {
    const input = z.object({ selectedChargeId: idSchema.nullable(), version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1) }).strict().parse(body);
    return transaction(this.db, () => {
      const current = this.preference(owner);
      if (input.version !== current.version) throw new ApiError(409,"首页展示设置已在其他页面修改，请重新打开。","VERSION_CONFLICT");
      if (input.selectedChargeId && !this.db.prepare("SELECT id FROM subscriptions WHERE user_id=? AND id=? AND expense_type='phone' AND phone_charge_type IN ('monthly','yearly')").get(owner,input.selectedChargeId)) throw new ApiError(404,"请选择当前账号下的月租或年包套餐。","NOT_FOUND");
      this.db.prepare("INSERT INTO subscription_preferences(user_id,initialized,phone_display_subscription_id,phone_display_version) VALUES(?,0,?,?) ON CONFLICT(user_id) DO UPDATE SET phone_display_subscription_id=excluded.phone_display_subscription_id,phone_display_version=excluded.phone_display_version")
        .run(owner,input.selectedChargeId,current.version+1);
      return this.preference(owner);
    });
  }

  execute(owner: number, body: unknown): { item?: PhoneAccount; id?: string } {
    const input = z.object({ action: z.enum(["create", "update", "delete"]), item: z.unknown().optional(),
      id: idSchema.optional(), version: z.number().int().nonnegative().optional() }).strict().parse(body);
    return transaction(this.db, () => {
      if (input.action !== "create") {
        const row = this.db.prepare("SELECT * FROM phone_accounts WHERE user_id=? AND id=?").get(owner, input.id ?? "");
        if (!row) throw new ApiError(404, "号码不存在或已删除。", "NOT_FOUND");
        if (input.version !== Number(row.version)) throw new ApiError(409, "号码已在其他页面修改，请刷新后再试。", "VERSION_CONFLICT");
        if (input.action === "delete") {
          if (this.db.prepare("SELECT id FROM subscriptions WHERE user_id=? AND phone_account_id=? LIMIT 1").get(owner, input.id!)) {
            throw new ApiError(409, "请先移除号码下的费用项目；已有付款流水会保留。", "PHONE_HAS_CHARGES");
          }
          this.db.prepare("DELETE FROM phone_accounts WHERE user_id=? AND id=?").run(owner, input.id!);
          return { id: input.id };
        }
      }
      const raw = input.item && typeof input.item === "object" ? input.item as Record<string, unknown> : {};
      const item = phoneAccountSchema.parse({ ...raw, id: raw.id || randomUUID(), version: raw.version ?? 0 });
      if (input.action === "update" && (item.id !== input.id || item.version !== input.version)) throw new ApiError(409, "号码标识或版本不一致。", "VERSION_CONFLICT");
      const duplicate = this.db.prepare("SELECT id FROM phone_accounts WHERE user_id=? AND (number=? OR id=?)").all(owner, item.number, item.id);
      if (duplicate.some(row => input.action === "create" || row.id !== item.id)) throw new ApiError(409, "这个号码已经添加过，请编辑已有号码。", "PHONE_EXISTS");
      if (input.action === "create" && this.list(owner).length >= 200) throw new ApiError(400,"最多管理 200 个手机号码。");
      const values = [item.label, item.number, item.carrier, item.note, item.balance === null ? null : Math.round(item.balance * 100), item.balanceAsOf];
      if (input.action === "create") {
        this.db.prepare("INSERT INTO phone_accounts(user_id,id,label,number,carrier,note,balance_cents,balance_as_of,version,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?)")
          .run(owner, item.id, ...values, Date.now());
      } else {
        this.db.prepare("UPDATE phone_accounts SET label=?,number=?,carrier=?,note=?,balance_cents=?,balance_as_of=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?")
          .run(...values, Date.now(), owner, item.id, input.version!);
      }
      return { item: phoneFromRow(this.db.prepare("SELECT * FROM phone_accounts WHERE user_id=? AND id=?").get(owner, item.id)!) };
    });
  }
}
