import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { currencyCatalog, type CurrencyCode, type HistoricalRate } from "../../../shared/currency.ts";
export type CurrencyDraft = {
  currency: CurrencyCode; purchaseDate: string; fxRateToCny: string; fxRateDate: string; fxRateSource: "manual" | "frankfurter"; ratePending?: boolean;
};
export function CurrencyFields({ value, startDate, onChange }: { value: CurrencyDraft; startDate: string; onChange: (patch: Partial<CurrencyDraft>) => void }) {
  const update = useRef(onChange); update.current = onChange;
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [retry,setRetry] = useState(0);
  const sequence = useRef(0), previousRetry = useRef(0);
  const purchaseDate = value.purchaseDate || startDate;
  useEffect(() => {
    let active = true;
    const request = ++sequence.current;
    const forced = retry !== previousRetry.current;
    previousRetry.current = retry;
    setError("");
    if (value.currency === "CNY") { setBusy(false); return; }
    const hasSnapshot = !value.ratePending && Number(value.fxRateToCny) > 0 && value.fxRateDate <= purchaseDate;
    if (hasSnapshot && !forced) { setBusy(false); return; }
    if (!purchaseDate) { setBusy(false); return; }
    setBusy(true);
    const timer = window.setTimeout(() => {
      void apiRequest<HistoricalRate>("/exchange-rate?" + new URLSearchParams({currency:value.currency,date:purchaseDate})).then(fx => {
        if (active && request === sequence.current) update.current({purchaseDate,fxRateToCny:String(fx.rate),fxRateDate:fx.rateDate,fxRateSource:fx.source,ratePending:false});
      }).catch(reason => {
        if (active && request === sequence.current) setError((reason instanceof Error ? reason.message : "汇率查询失败。") + (hasSnapshot ? " 已保留原汇率。" : " 未补全前不计入人民币估算。"));
      }).finally(() => {if(active && request === sequence.current) setBusy(false);});
    },300);
    return () => {active=false; window.clearTimeout(timer);};
  },[value.currency,purchaseDate,retry]);

  function editSnapshot(patch: Partial<CurrencyDraft>) {
    ++sequence.current;
    setBusy(false); setError("");
    onChange(patch);
  }
  return <>
    <label className="form-field"><span>付款币种</span><select value={value.currency} onChange={event => {
      const currency = event.target.value as CurrencyCode;
      editSnapshot({currency,purchaseDate,fxRateToCny:currency === "CNY" ? "1" : "",fxRateDate:purchaseDate,fxRateSource:"manual",ratePending:currency !== "CNY"});
    }}>{currencyCatalog.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
    {value.currency !== "CNY" && <>
      <label className="form-field"><span>购买日期（汇率基准）</span><input required type="date" min="1900-01-01" max="2200-12-31" value={purchaseDate} onChange={event => editSnapshot({purchaseDate:event.target.value,fxRateToCny:"",fxRateDate:event.target.value,fxRateSource:"manual",ratePending:true})} /></label>
      <label className="form-field"><span>购买时汇率（1 {value.currency} = 人民币）</span><input type="number" min="0.000001" max="100000" step="any" value={value.fxRateToCny} onChange={event => editSnapshot({fxRateToCny:event.target.value,fxRateDate:purchaseDate,fxRateSource:"manual",ratePending:false})} /></label>
      <div className="auto-fx wide" role="status">
        <span>{busy ? "正在获取购买日汇率…" : error || (value.ratePending ? "汇率待补全，暂不计入人民币估算。" : `${value.fxRateSource === "manual" ? "实际结算汇率" : "参考汇率"}：1 ${value.currency} ≈ ¥${value.fxRateToCny} · 购买日 ${purchaseDate}（报价 ${value.fxRateDate}）`)}</span>
        <button type="button" className="text-action" disabled={busy} onClick={()=>setRetry(n=>n+1)}>查询历史汇率</button>
      </div>
    </>}
  </>;
}
