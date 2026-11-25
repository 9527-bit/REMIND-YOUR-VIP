import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { BackupService } from "../src/backups.ts";
import { EmailNotificationService } from "../src/notifications.ts";
import { BarkNotificationService } from "../src/bark.ts";
import { readConfig } from "../src/config.ts";
import { monthlyCostCny, remindersEnabled, type Subscription } from "../../shared/subscriptions.ts";
import { paymentReport } from "../../shared/payment-reports.ts";

const at = (date: string) => new Date(date + "T02:00:00Z");
const record = (patch: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "手机话费", plan: "月租", category: "生活服务", amount: 58,
  cycle: "monthly", customDays: 30, startDate: "2026-01-31", endDate: "2026-02-28",
  reminderDays: 7, autoRenew: true, note: "", color: "#269979", version: 0,
  expenseType: "fixed", currency: "CNY", ...patch,
});
function setup(today = "2026-02-01") {
  const db = openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES(1,'owner','fixture',0),(2,'other','fixture',0)");
  let now = at(today);
  const service = new SubscriptionService(db,"Asia/Shanghai",() => now);
  const payments = new PaymentService(db,undefined,"Asia/Shanghai",() => now);
  return { db, service, payments, backups:new BackupService(db), setDay:(date:string) => { now = at(date); } };
}

test("fixed expenses default to silent pending bills, while subscriptions keep their existing reminder behavior", t => {
  const {db,service,payments} = setup(); t.after(() => db.close());
  const fixed = service.execute(1,{action:"create",item:record()}).item!;
  assert.equal(fixed.reminderEnabled,false); assert.equal(fixed.autoRecord,false); assert.equal(fixed.billingDay,31);
  assert.equal(payments.all(1).length,1); assert.equal(payments.all(1)[0].payment,null);
  assert.equal(payments.all(1)[0].fixedBill!.plan,"月租");
  assert.equal(monthlyCostCny(fixed),58);
  assert.equal(paymentReport(payments.all(1),[fixed],"2026-02-01","","confirmed").total,0);
  assert.equal(service.listPublic()[0].reminderEnabled,false);
  const regular = service.execute(1,{action:"create",item:record({expenseType:"subscription"})}).item!;
  assert.equal(regular.reminderEnabled,true); assert.equal(payments.all(1).length,1);
  assert.equal(remindersEnabled(record()),false);
});

test("one bill per anchored month survives short months, offline gaps and repeated scheduler starts", t => {
  const {db,service,payments} = setup(); t.after(() => db.close());
  const fixed = service.execute(1,{action:"create",item:record({autoRecord:true})}).item!;
  assert.equal(service.advanceAutomaticRenewals(at("2026-05-31")),1);
  assert.equal(service.advanceAutomaticRenewals(at("2026-05-31")),0);
  assert.equal(new SubscriptionService(db,"Asia/Shanghai").advanceAutomaticRenewals(at("2026-05-31")),0);
  const logs = payments.all(1).sort((a,b) => a.newStartDate.localeCompare(b.newStartDate));
  assert.deepEqual(logs.map(log => log.newStartDate),["2026-01-31","2026-02-28","2026-03-31","2026-04-30","2026-05-31"]);
  assert.equal(new Set(logs.map(log => log.newStartDate)).size,5);
  assert.ok(logs.every(log => log.periods === 1 && log.payment?.amount === 58 && log.payment.source === "fixed"));
  const current = service.list(1).items.find(item => item.id === fixed.id)!;
  assert.equal(current.endDate,"2026-06-30"); assert.equal(current.billingDay,31);
  assert.equal(paymentReport(logs,[current],"2026-05-31","2026-05","confirmed").total,58);
  assert.equal(paymentReport(logs,[current],"2026-05-31","2026","confirmed").total,290);
});

test("price, category, plan and automatic-booking edits only affect newly generated bills", async t => {
  const {db,service,payments,setDay} = setup(); t.after(() => db.close());
  const first = service.execute(1,{action:"create",item:record()}).item!;
  const original = payments.all(1)[0];
  service.execute(1,{action:"update",id:first.id,version:first.version,item:{...first,amount:68,plan:"新套餐",category:"办公效率",autoRecord:true}});
  assert.deepEqual(payments.all(1)[0],original);
  await payments.confirm(1,{id:original.id,entry:{amount:60,currency:"CNY",paidOn:"2026-01-31",startDate:original.newStartDate,endDate:original.newEndDate,note:"实际多扣2元"}});
  const old = payments.all(1)[0].payment!;
  assert.equal(old.amount,60); assert.equal(old.plan,"月租"); assert.equal(old.category,"生活服务");
  setDay("2026-02-28"); service.advanceAutomaticRenewals(at("2026-02-28"));
  const newer = payments.all(1).find(log => log.newStartDate === "2026-02-28")!;
  assert.equal(newer.payment!.amount,68); assert.equal(newer.payment!.plan,"新套餐"); assert.equal(newer.payment!.source,"fixed");
  assert.equal(payments.all(1).find(log => log.id === original.id)!.payment!.amount,60);
});

test("future bills wait for their date, and resuming a paused expense skips paused months", t => {
  const {db,service,payments,setDay} = setup("2026-01-01"); t.after(() => db.close());
  const first = service.execute(1,{action:"create",item:record({autoRecord:true})}).item!;
  assert.equal(payments.all(1).length,0);
  setDay("2026-01-31"); service.advanceAutomaticRenewals(at("2026-01-31"));
  service.execute(1,{action:"update",id:first.id,version:first.version,item:{...service.list(1).items[0],autoRenew:false}});
  assert.equal(service.advanceAutomaticRenewals(at("2026-05-15")),0);
  assert.equal(payments.all(1).length,1);
  setDay("2026-05-15");
  const paused = service.list(1).items[0];
  const resumed = service.execute(1,{action:"update",id:paused.id,version:paused.version,item:{...paused,autoRenew:true}}).item!;
  assert.equal(resumed.startDate,"2026-04-30"); assert.equal(resumed.endDate,"2026-05-31"); assert.equal(resumed.billingDay,31);
  assert.deepEqual(payments.all(1).map(log => log.newStartDate).sort(),["2026-01-31","2026-04-30"]);
});

test("voided automatic payments never regenerate; corrected backfill remains owner scoped", async t => {
  const {db,service,payments} = setup(); t.after(() => db.close());
  const fixed = service.execute(1,{action:"create",item:record({autoRecord:true})}).item!;
  const log = payments.all(1)[0];
  assert.equal((await payments.preview(1,{subscriptionId:fixed.id,entries:[{amount:58,currency:"CNY",paidOn:"2026-01-31",startDate:fixed.startDate,endDate:fixed.endDate,note:""}]})).entries[0].duplicate,true);
  payments.void(1,{id:log.id}); service.advanceAutomaticRenewals(at("2026-02-01"));
  assert.equal(payments.all(1).length,1); assert.ok(payments.all(1)[0].payment!.voidedAt);
  assert.equal(paymentReport(payments.all(1),[fixed],"2026-02-01","","confirmed").total,0);
  const batch = {subscriptionId:fixed.id,entries:[{amount:63,currency:"CNY" as const,paidOn:"2026-01-31",startDate:fixed.startDate,endDate:fixed.endDate,note:"更正"}]};
  await assert.rejects(payments.add(2,batch),{status:404});
  assert.deepEqual(await payments.add(1,batch),{added:1,skipped:0});
  assert.equal(paymentReport(payments.all(1),[fixed],"2026-02-01","","confirmed").total,63);
});

test("fixed expenses use saved FX snapshots and unknown rates never become automatic payments", t => {
  const {db,service,payments} = setup(); t.after(() => db.close());
  const foreign = {currency:"USD" as const,purchaseDate:"2026-01-30",fxRateToCny:7.2,fxRateDate:"2026-01-30",fxRateSource:"manual" as const,autoRecord:true};
  service.execute(1,{action:"create",item:record(foreign)});
  service.execute(1,{action:"create",item:record({...foreign,ratePending:true})});
  service.advanceAutomaticRenewals(at("2026-03-01"));
  assert.equal(payments.all(1).filter(log => log.payment).length,2);
  assert.equal(payments.all(1).filter(log => !log.payment).length,2);
  assert.ok(payments.all(1).filter(log => log.payment).every(log => log.payment!.rate===7.2 && log.payment!.rateBasisDate==="2026-01-30"));
});

test("prepaid service intervals are not automatically charged again after conversion to fixed expense", async t => {
  const {db,service,payments,setDay} = setup();t.after(()=>db.close());
  const regular=service.execute(1,{action:"create",item:record({expenseType:"subscription",autoRenew:false})}).item!;
  await payments.add(1,{subscriptionId:regular.id,entries:[{amount:50,currency:"CNY",paidOn:"2026-01-31",startDate:"2026-02-28",endDate:"2026-03-31",note:"prepaid"}]});
  service.execute(1,{action:"update",id:regular.id,version:regular.version,item:{...regular,expenseType:"fixed",autoRenew:true,autoRecord:true}});
  setDay("2026-02-28");service.advanceAutomaticRenewals(at("2026-02-28"));
  assert.equal(payments.all(1).length,2);
  assert.equal(payments.all(1).filter(log=>log.payment?.source==="fixed").length,1);
  assert.equal(paymentReport(payments.all(1),service.list(1).items,"2026-02-28","2026-02","confirmed").total,0);
});

test("bounded catch-up continues from saved periods and never loses or duplicates old monthly bills", t => {
  const {db,service,payments} = setup("2031-01-31");t.after(()=>db.close());
  service.execute(1,{action:"create",item:record({startDate:"2020-01-31",endDate:"2020-02-29",autoRecord:true})});
  assert.equal(payments.all(1).length,120);
  service.advanceAutomaticRenewals(at("2031-01-31"));
  assert.equal(payments.all(1).length,133);
  assert.equal(service.advanceAutomaticRenewals(at("2031-01-31")),0);
  assert.equal(new Set(payments.all(1).map(log=>log.newStartDate)).size,133);
  assert.equal(service.list(1).items[0].endDate,"2031-02-28");
});

test("per-record reminders suppress email and Bark including zero-day automatic renewal fallback", async t => {
  const {db,service} = setup("2026-02-28"); t.after(() => db.close());
  const config=readConfig({EMAIL_NOTIFICATIONS:"true",SMTP_USER:"fixture@example.com",SMTP_PASSWORD:"fixture",BARK_NOTIFICATIONS:"true",BARK_KEY:"fixture",EMAIL_REMINDER_HOUR:"0"});
  service.execute(1,{action:"create",item:record({reminderDays:0,autoRecord:true})});
  service.execute(1,{action:"create",item:record({expenseType:"subscription",reminderEnabled:false,reminderDays:0})});
  service.advanceAutomaticRenewals(at("2026-02-28"));
  let email=0,bark=0;
  const mailer=new EmailNotificationService(db,config,{send:async()=>{email++;}});
  const push=new BarkNotificationService(db,config,{send:async()=>{bark++;}});
  assert.equal(await mailer.sendDueReminders(at("2026-02-28")),0);
  assert.equal(await push.sendDueReminders(at("2026-02-28")),0);
  assert.equal(email,0); assert.equal(bark,0);
  service.execute(1,{action:"create",item:record({startDate:"2026-02-01",endDate:"2026-03-01",reminderEnabled:true,reminderDays:3})});
  assert.equal(await mailer.sendDueReminders(at("2026-02-28")),1);
  assert.equal(await push.sendDueReminders(at("2026-02-28")),1);
});

test("v5 business backups preserve settings, fixed snapshots, voids and generation deduplication", t => {
  const {db,service,payments,backups} = setup(); t.after(() => db.close());
  service.execute(1,{action:"create",item:record({autoRecord:true})});
  payments.void(1,{id:payments.all(1)[0].id});
  const backup=backups.export(1); assert.equal(backup.formatVersion,5);
  backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(payments.all(2),payments.all(1));
  const samePeriod=structuredClone(backup);samePeriod.renewalLogs[0].id=randomUUID();
  const preview=backups.preview(2,samePeriod);assert.equal(preview.newLogs,0);
  assert.equal(backups.import(2,{backup:samePeriod,mode:"merge",expectedRevision:preview.revision}).importedLogs,0);
  assert.equal(service.list(2).items[0].expenseType,"fixed"); assert.equal(service.list(2).items[0].reminderEnabled,false);
  assert.equal(service.advanceAutomaticRenewals(at("2026-02-01")),0);
  const duplicate=structuredClone(backup); duplicate.renewalLogs.push({...duplicate.renewalLogs[0],id:randomUUID()});
  assert.throws(()=>backups.preview(1,duplicate));
  const older=structuredClone(backup); older.formatVersion=3; older.renewalLogs=[];
  for(const item of older.subscriptions){delete item.expenseType;delete item.reminderEnabled;delete item.autoRecord;delete item.billingDay;}
  backups.import(2,{backup:older,mode:"replace",confirmReplace:true,expectedRevision:backups.preview(2,older).revision});
  assert.equal(service.list(2).items[0].expenseType,"subscription"); assert.equal(service.list(2).items[0].reminderEnabled,true);
});

test("v9 migration preserves existing data and defaults without generating bills or changing credentials", t => {
  const folder=mkdtempSync(join(tmpdir(),"vip-fixed-migration-")), path=join(folder,"fixture.sqlite");
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  let db=new DatabaseSync(path);
  for(const name of ["001_initial.sql","002_automatic_renewals.sql","003_subscription_history.sql","004_multi_currency.sql","005_purchase_rate_snapshots.sql","006_email_notifications.sql","007_subscription_categories.sql","008_payment_ledger.sql","009_bark_notifications.sql"])db.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
  db.exec("PRAGMA user_version=9; INSERT INTO users VALUES(1,'owner','preserved-hash',0)");
  db.prepare("INSERT INTO subscriptions(user_id,id,name,plan,category,amount_cents,cycle,custom_days,start_date,end_date,reminder_days,auto_renew,note,color,updated_at) VALUES(1,?,'Legacy','','生活服务',5800,'monthly',30,'2026-01-01','2026-02-01',7,1,'private','#269979',0)").run(randomUUID());
  const before=db.prepare("SELECT * FROM subscriptions").get()!;db.close();
  db=openDatabase(path);
  try {
    const after=db.prepare("SELECT * FROM subscriptions").get()!;
    for(const [key,value] of Object.entries(before))assert.equal(after[key],value,key);
    assert.equal(after.expense_type,"subscription");assert.equal(after.reminder_enabled,1);assert.equal(after.auto_record,0);
    assert.equal(db.prepare("SELECT password_hash FROM users").get()!.password_hash,"preserved-hash");
    assert.equal(db.prepare("SELECT count(*) AS n FROM subscription_renewal_logs").get()!.n,0);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version,11);
  } finally {db.close();}
});

test("bill generation and date advancement roll back together if any monthly insert fails", t => {
  const {db,service,payments} = setup();t.after(()=>db.close());
  const first=service.execute(1,{action:"create",item:record({autoRecord:true})}).item!;
  db.exec("CREATE TRIGGER fail_fixed BEFORE INSERT ON subscription_renewal_logs WHEN NEW.new_start_date='2026-03-31' BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.throws(()=>service.advanceAutomaticRenewals(at("2026-05-31")));
  assert.equal(payments.all(1).length,1); assert.deepEqual(service.list(1).items,[first]);
});

test("invalid combinations are rejected and scheduled fixed bills cannot be manually renewed", t => {
  const {db,service} = setup();t.after(()=>db.close());
  for(const patch of [{cycle:"yearly" as const},{expenseType:"subscription" as const,autoRecord:true}])assert.throws(()=>service.execute(1,{action:"create",item:record(patch)}));
  const first=service.execute(1,{action:"create",item:record()}).item!;
  assert.throws(()=>service.execute(1,{action:"renew",id:first.id,version:first.version}),{code:"FIXED_EXPENSE_RENEWAL"});
});
