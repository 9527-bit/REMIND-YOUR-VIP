import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, History, Pencil, Plus, Search, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CompactDialogHeader } from "@/components/context-help";
import { apiRequest, ApiError } from "@/lib/api";
import { HistoryDialog } from "@/components/history-dialog";
import { money } from "../../../shared/currency.ts";
import { monthlyCostCny, renewDate, type Subscription } from "../../../shared/subscriptions.ts";
import { maskedPhone, nextPhoneBill, phoneCarriers, phoneChargeTypes, phoneMonthlyCost, type PhoneAccount, type PhoneChargeType, type PhoneDisplayPreference } from "../../../shared/phones.ts";

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  accounts: PhoneAccount[]; items: Subscription[]; today: string;
  displayPreference: PhoneDisplayPreference;
  target: Subscription | null; onTargetHandled: () => void;
  onChanged: () => Promise<void>;
};
type AccountDraft = Omit<PhoneAccount, "balance" | "balanceAsOf"> & { balance: string; balanceAsOf: string };
type ChargeDraft = {
  accountId: string; original: Subscription | null; name: string; type: PhoneChargeType;
  amount: string; startDate: string; endDate: string; autoRenew: boolean; autoRecord: boolean;
  reminderEnabled: boolean; reminderDays: number; note: string;
};
type Removal = { kind: "account"; item: PhoneAccount } | { kind: "charge"; item: Subscription };

function chargeDraft(accountId: string, today: string, item?: Subscription): ChargeDraft {
  const type = item?.phoneChargeType ?? (item?.cycle === "yearly" ? "yearly" : "monthly");
  return { accountId, original: item ?? null, name: item?.plan || item?.name || "", type,
    amount: item ? String(item.amount) : "", startDate: item?.startDate ?? today,
    endDate: item?.endDate ?? renewDate(today,"monthly",30), autoRenew: item?.autoRenew ?? true,
    autoRecord: item?.autoRecord ?? false, reminderEnabled: item?.reminderEnabled ?? false,
    reminderDays: item?.reminderDays ?? 7, note: item?.note ?? "" };
}

/** Keep number settings and fees inside one manager; closing an editor returns to its number list. */
export function PhoneAccountsDialog({ open, onOpenChange, accounts, items, today, displayPreference, target, onTargetHandled, onChanged }: Props) {
  const [account, setAccount] = useState<AccountDraft | null>(null);
  const [charge, setCharge] = useState<ChargeDraft | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [historyItem, setHistoryItem] = useState<Subscription | null>(null);
  function handleError(reason: unknown, fallback: string) {
    if (reason instanceof ApiError && reason.status === 401) { void onChanged(); return; }
    setError(reason instanceof Error ? reason.message : fallback);
  }

  useEffect(() => {
    if (!target?.phoneAccountId) return;
    setCharge(chargeDraft(target.phoneAccountId,today,target)); setError(null); onTargetHandled();
  }, [target, today, onTargetHandled]);

  function editAccount(item?: PhoneAccount) {
    setError(null);
    setAccount(item ? { ...item, balance: item.balance === null ? "" : String(item.balance), balanceAsOf: item.balanceAsOf ?? today } :
      { id: "", version: 0, label: "", number: "", carrier: "中国移动", note: "", balance: "", balanceAsOf: today });
  }

  async function saveAccount() {
    if (!account || busy) return;
    setBusy(true); setError(null);
    try {
      await apiRequest("/phones", { action: account.id ? "update" : "create", ...(account.id ? { id: account.id, version: account.version } : {}),
        item: { ...account, balance: account.balance === "" ? null : Number(account.balance), balanceAsOf: account.balance === "" ? null : account.balanceAsOf } });
      setAccount(null); await onChanged(); toast.success("号码已保存");
    } catch (reason) { handleError(reason,"保存失败，请重试。"); }
    finally { setBusy(false); }
  }

  function changeType(type: PhoneChargeType) {
    setCharge(current => current && { ...current, type, autoRenew: type === "monthly", reminderEnabled: type === "yearly",
      endDate: renewDate(current.startDate,type === "once" ? "custom" : type,1) });
  }

  async function saveCharge() {
    if (!charge || busy) return;
    const owner = accounts.find(item => item.id === charge.accountId);
    if (!owner) { setError("号码不存在，请刷新。"); return; }
    setBusy(true); setError(null);
    const original = charge.original;
    const item: Subscription = {
      ...original, id: original?.id ?? "", version: original?.version ?? 0,
      name: `${owner.label.slice(0,25)} · ${charge.name.trim()}`.slice(0,60), plan: charge.name, category: original?.category ?? "生活服务",
      expenseType: "phone", phoneAccountId: owner.id, phoneChargeType: charge.type,
      amount: Number(charge.amount), currency: "CNY", purchaseDate: original?.purchaseDate ?? charge.startDate,
      fxRateToCny: 1, fxRateDate: original?.fxRateDate ?? charge.startDate, fxRateSource: "manual", ratePending: false,
      cycle: charge.type === "once" ? "custom" : charge.type, customDays: charge.type === "once" ? 1 : 30,
      startDate: charge.startDate, endDate: charge.endDate,
      autoRenew: charge.type !== "once" && charge.autoRenew, autoRecord: charge.autoRecord,
      reminderEnabled: charge.type !== "once" && charge.reminderEnabled, reminderDays: charge.reminderDays,
      note: charge.note, color: original?.color ?? "#269979",
    };
    try {
      await apiRequest("/subscriptions", { action: original ? "update" : "create", item,
        ...(original ? { id: original.id, version: original.version } : {}) });
      setCharge(null); await onChanged(); toast.success(original ? "费用项目已更新" : "费用项目已添加");
    } catch (reason) { handleError(reason,"保存失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!removal || busy) return;
    setBusy(true); setError(null);
    try {
      await apiRequest(removal.kind === "account" ? "/phones" : "/subscriptions", { action: "delete", id: removal.item.id, version: removal.item.version });
      setRemoval(null); await onChanged(); toast.success("已移除，已有流水保留");
    } catch (reason) { handleError(reason,"移除失败。"); }
    finally { setBusy(false); }
  }

  const visible = accounts.filter(owner => {
    const children = items.filter(item => item.phoneAccountId === owner.id);
    return `${owner.label} ${owner.number} ${owner.carrier} ${owner.note} ${children.map(item => `${item.name} ${item.plan}`).join(" ")}`.toLowerCase().includes(query.toLowerCase());
  });
  const linkable = items.filter(item => item.expenseType !== "phone" && (!item.currency || item.currency === "CNY") && (item.cycle === "monthly" || item.cycle === "yearly"));
  const displayable = items.filter(item => item.expenseType === "phone" && item.phoneChargeType !== "once" && accounts.some(account => account.id === item.phoneAccountId));
  async function changeDisplay(selectedChargeId: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiRequest("/phones/display",{selectedChargeId:selectedChargeId || null,version:displayPreference.version});
      await onChanged(); toast.success("首页展示套餐已更新");
    } catch(reason) { handleError(reason,"设置失败，请重试。"); }
    finally {setBusy(false);}
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className={`membership-dialog phone-manager-dialog${account || charge ? " phone-editor-active" : ""}`} onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".phone-summary-open")?.focus(); }}>
    {(account || charge) && <button type="button" className="text-action phone-back" disabled={busy} onClick={() => { setAccount(null); setCharge(null); setError(null); }}><ArrowLeft size={15} />返回号码列表</button>}
    {!account && !charge && <>
    <CompactDialogHeader title="手机话费" helpLabel="手机话费管理说明" help="按号码管理月租、年包和一次性费用。月均为套餐费用折算；余额按号码手动核对，添加或编辑号码不会改变已记录的付款。" />
    <div className="phone-manager-toolbar"><span className="phone-manager-count">{accounts.length} 个号码</span><button className="button secondary" onClick={() => editAccount()}><Plus size={16} />添加号码</button></div>
    <label className="form-field phone-display-setting"><span>首页展示套餐</span><select aria-label="首页展示套餐" value={displayPreference.selectedChargeId ?? ""} disabled={busy} onChange={event => void changeDisplay(event.target.value)}><option value="">自动选择最近到期年包</option>{displayable.map(item => <option key={item.id} value={item.id}>{accounts.find(account => account.id === item.phoneAccountId)!.label} · {item.plan || item.name} · {item.endDate}</option>)}</select><small>仅切换首页剩余时间和进度条，合计月均仍包含全部号码。无年包时自动展示月租。</small></label>
    {error && <p className="login-error" role="alert">{error}</p>}
    <label className="search phone-search"><Search size={15} /><input aria-label="搜索手机号码" placeholder="搜索号码、备注或套餐…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="phone-account-list">
      {visible.map(owner => {
        const children = items.filter(item => item.phoneAccountId === owner.id);
        const next = nextPhoneBill(children,today), monthly = phoneMonthlyCost(children,today);
        return <article className="phone-account-row" key={owner.id} aria-label={`号码 ${owner.label}`}><details className="phone-account-details">
          <summary aria-label={`展开号码 ${owner.label}`}><span className="phone-card-icon"><Smartphone size={20} /></span><span className="phone-card-identity"><strong>{owner.label}</strong><span>{maskedPhone(owner.number)} · {owner.carrier}</span></span><span className="phone-account-cost"><strong>{money(monthly)}<small>/月</small></strong><small>{children.length} 个费用项目</small></span><ChevronDown size={15} className="phone-expand-icon" /></summary>
          <div className="phone-account-body"><div className="phone-account-tools"><button className="text-action" aria-label={`编辑号码 ${owner.label}`} onClick={() => editAccount(owner)}><Pencil size={14} />编辑号码与余额</button><button className="text-danger" disabled={children.length > 0} title={children.length ? "先移除费用项目，再移除号码" : "移除号码"} aria-label={`移除号码 ${owner.label}`} onClick={() => { setError(null); setRemoval({kind:"account",item:owner}); }}><Trash2 size={14} />移除号码</button></div>
          <p className="phone-balance">话费余额 <strong>{owner.balance === null ? "未填写" : money(owner.balance)}</strong><span>{owner.balanceAsOf ? `手动核对于 ${owner.balanceAsOf}` : "可在编辑号码中填写"}</span></p>
          <p className="phone-next">下次账单 / 年包到期 <b>{next ?? "暂无"}</b></p>
            <ul className="phone-charge-list">{children.map(item => <li key={item.id}>
              <div className="phone-charge-heading"><strong>{item.plan || item.name}</strong><span className="phone-charge-tag">{phoneChargeTypes[item.phoneChargeType!]}</span></div>
              <div className="phone-charge-price"><span>{money(item.amount)}{item.phoneChargeType === "yearly" ? "/年" : item.phoneChargeType === "monthly" ? "/月" : " / 次"}</span><small>{item.phoneChargeType === "once" ? "不计入常规月均" : `月均 ${money(monthlyCostCny(item))}`}</small></div>
              <p>{item.phoneChargeType === "once" ? `发生日期 ${item.startDate}` : `${item.startDate} — ${item.endDate}`}{item.phoneChargeType === "yearly" && item.endDate < today ? " · 已到期" : ""}</p>
              {item.phoneChargeType !== "once" && <p>{item.autoRenew ? "持续生成账单" : "仅记录本期"} · {item.reminderEnabled ? "提醒已开启" : "提醒已关闭"}</p>}
              <div className="phone-charge-actions"><button className="text-action" onClick={() => { setError(null); setCharge(chargeDraft(owner.id,today,item)); }}><Pencil size={13} />编辑费用</button><button className="text-action" onClick={() => setHistoryItem(item)}><History size={13} />流水</button><button className="text-danger" onClick={() => { setError(null); setRemoval({kind:"charge",item}); }}><Trash2 size={13} />移除</button></div>
            </li>)}</ul>
            {!children.length && <p className="phone-hint">添加月租或年包后，这里会展示账期和费用明细。</p>}
          <div className="phone-card-footer"><button className="button light" aria-label={`为 ${owner.label} 添加费用`} onClick={() => { setError(null); setCharge(chargeDraft(owner.id,today)); }}><Plus size={15} />添加费用</button></div>
          </div></details></article>;
      })}
    </div>
    {!visible.length && <p className="phone-hint">{accounts.length ? "没有匹配的号码，可修改搜索条件。" : "添加一个号码，再分别登记它的月租、年包和临时费用。"}</p>}
    </>}

    {account && <div className="phone-dialog">
      <CompactDialogHeader title={account?.id ? "编辑手机号码" : "添加手机号码"} helpLabel="号码管理说明" help="余额由你手动核对，不计入消费。每个号码可分别添加月租、年包和一次性费用。" />
      {account && <form onSubmit={event => { event.preventDefault(); void saveAccount(); }}>
        <div className="form-grid"><label className="form-field"><span>号码备注 *</span><input autoFocus required maxLength={30} value={account.label} placeholder="例如：主用卡、备用卡" onChange={event => setAccount({...account,label:event.target.value})} /></label><label className="form-field"><span>手机号码 *</span><input required type="tel" inputMode="tel" pattern="1[3-9][0-9]{9}" maxLength={11} autoComplete="off" value={account.number} onChange={event => setAccount({...account,number:event.target.value})} /></label>
          <label className="form-field"><span>运营商</span><select aria-label="运营商" value={account.carrier} onChange={event => setAccount({...account,carrier:event.target.value as PhoneAccount["carrier"]})}>{phoneCarriers.map(carrier => <option key={carrier}>{carrier}</option>)}</select></label><label className="form-field"><span>当前余额（元）</span><input type="number" step="0.01" min="-10000000" max="10000000" placeholder="未知可留空，支持负数" value={account.balance} onChange={event => setAccount({...account,balance:event.target.value})} /></label>
          {account.balance !== "" && <label className="form-field wide"><span>余额核对日期 *</span><input required type="date" max={today} value={account.balanceAsOf} onChange={event => setAccount({...account,balanceAsOf:event.target.value})} /></label>}
          <label className="form-field wide"><span>号码备注说明</span><textarea maxLength={500} value={account.note} onChange={event => setAccount({...account,note:event.target.value})} /></label></div>
        {error && <p className="login-error" role="alert">{error}</p>}<div className="dialog-actions dialog-right-actions"><button className="button light" type="button" disabled={busy} onClick={() => setAccount(null)}>取消</button><button className="button primary" disabled={busy}>{busy ? "保存中…" : "保存号码"}</button></div>
      </form>}
    </div>}

    {charge && <div className="phone-dialog">
      <CompactDialogHeader title={charge?.original ? "编辑号码费用" : "添加号码费用"} helpLabel="号码费用说明" help="年包按总价÷12计入常规月均预算，付款按实际支付金额记录。一次性费用不计入常规月均。已生成账单保留原金额，可在流水核对后确认付款；充值不应再次作为套餐费用录入。" />
      {charge && <form onSubmit={event => { event.preventDefault(); void saveCharge(); }}>
        <p className="phone-editor-owner">{accounts.find(item => item.id === charge.accountId)?.label} · {maskedPhone(accounts.find(item => item.id === charge.accountId)?.number ?? "")}</p>
        {!charge.original && linkable.length > 0 && <label className="form-field"><span>关联已有记录（可选）</span><select aria-label="关联已有记录（可选）" value="" onChange={event => { const item = linkable.find(item => item.id === event.target.value); if (item) setCharge(chargeDraft(charge.accountId,today,item)); }}><option value="">新增费用项目</option>{linkable.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.amount)}</option>)}</select></label>}
        <div className="form-grid"><label className="form-field wide"><span>费用名称 *</span><input autoFocus required maxLength={80} placeholder="例如：保号月租、年度流量包" value={charge.name} onChange={event => setCharge({...charge,name:event.target.value})} /></label>
          <label className="form-field"><span>费用类型</span><select aria-label="费用类型" disabled={Boolean(charge.original)} value={charge.type} onChange={event => changeType(event.target.value as PhoneChargeType)}>{Object.entries(phoneChargeTypes).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-field"><span>{charge.type === "yearly" ? "年包总价（元） *" : charge.type === "once" ? "本次费用（元） *" : "每月费用（元） *"}</span><input required type="number" min="0" max="10000000" step="0.01" value={charge.amount} onChange={event => setCharge({...charge,amount:event.target.value})} /></label>
          <label className="form-field wide"><span>{charge.type === "once" ? "发生日期 *" : charge.type === "yearly" ? "本期年包生效日 *" : "本期账单日 *"}</span><input required type="date" min="1900-01-01" max="2199-12-31" value={charge.startDate} onChange={event => { const startDate = event.target.value; setCharge({...charge,startDate,endDate:startDate ? renewDate(startDate,charge.type === "once" ? "custom" : charge.type,1) : ""}); }} /></label>
          {charge.type !== "once" && <p className="phone-hint wide">{charge.type === "yearly" ? "本期到期日" : "下次账单日"}：{charge.endDate} · 折合月均 {money(Number(charge.amount || 0) / (charge.type === "yearly" ? 12 : 1))}</p>}
          {charge.type !== "once" && <><label className="phone-checkbox wide"><input type="checkbox" checked={charge.autoRenew} onChange={event => setCharge({...charge,autoRenew:event.target.checked})} />持续生成{charge.type === "yearly" ? "每年" : "每月"}账单</label><label className="phone-checkbox wide"><input type="checkbox" checked={charge.reminderEnabled} onChange={event => setCharge({...charge,reminderEnabled:event.target.checked})} />开启{charge.type === "yearly" ? "年包到期" : "账单"}提醒</label>{charge.reminderEnabled && <label className="form-field wide"><span>提前提醒</span><select aria-label="提前提醒" value={charge.reminderDays} onChange={event => setCharge({...charge,reminderDays:Number(event.target.value)})}>{[0,1,3,7,14,30].map(days => <option key={days} value={days}>{days ? `提前 ${days} 天` : "当天"}</option>)}</select></label>}</>}
          <label className="phone-checkbox wide"><input type="checkbox" checked={charge.autoRecord} onChange={event => setCharge({...charge,autoRecord:event.target.checked})} />按登记金额自动记账</label><p className="phone-hint wide">{charge.autoRecord ? "生成的账单会视为已支付；请确认金额，不会实际扣款。" : "账单默认待确认，在流水核对实际金额后计入已支付。"}{charge.original ? " 修改只影响后续新账单，原有流水保持不变。" : ""}</p>
          <label className="form-field wide"><span>费用备注</span><textarea maxLength={500} value={charge.note} onChange={event => setCharge({...charge,note:event.target.value})} /></label>
        </div>{error && <p className="login-error" role="alert">{error}</p>}<div className="dialog-actions dialog-right-actions"><button className="button light" type="button" disabled={busy} onClick={() => setCharge(null)}>取消</button><button className="button primary" disabled={busy}>{busy ? "保存中…" : "保存费用"}</button></div>
      </form>}
    </div>}

    <AlertDialog open={Boolean(removal)} onOpenChange={open => { if (!open && !busy) setRemoval(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除{removal?.kind === "account" ? "这个号码" : "这项费用"}？</AlertDialogTitle><AlertDialogDescription>{removal?.kind === "account" ? removal.item.label : removal?.item.name}将从清单移除，已有付款流水会保留。{removal?.kind === "charge" ? "之后停止为这项费用生成账单。" : ""}</AlertDialogDescription></AlertDialogHeader>{error && <p className="login-error" role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); void remove(); }}>确认移除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {historyItem && <HistoryDialog open onOpenChange={value => { if (!value) setHistoryItem(null); }} subscriptionId={historyItem.id} subscriptionName={historyItem.name} items={items} today={today} onChanged={() => void onChanged()} />}
  </DialogContent></Dialog>;
}
