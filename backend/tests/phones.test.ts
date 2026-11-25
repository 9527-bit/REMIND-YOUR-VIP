import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/database.ts";
import { PhoneAccounts } from "../src/phones.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { BackupService } from "../src/backups.ts";
import { readConfig } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { bootstrapAdmin } from "../src/auth.ts";
import { EmailNotificationService } from "../src/notifications.ts";
import { BarkNotificationService } from "../src/bark.ts";
import { monthlyCostCny, renewDate, type Subscription, type DashboardSnapshot } from "../../shared/subscriptions.ts";
import { phoneMonthlyCost, type PhoneAccount, type PhoneChargeType } from "../../shared/phones.ts";
import { paymentReport } from "../../shared/payment-reports.ts";

const at = (date: string) => new Date(date + "T02:00:00Z");
const phone = (patch: Partial<PhoneAccount> = {}): PhoneAccount => ({ id:randomUUID(),label:"Fixture primary",number:"13800000000",carrier:"中国移动",note:"synthetic only",balance:-8.25,balanceAsOf:"2026-11-26",version:0,...patch });
const fee = (account: PhoneAccount, type: PhoneChargeType, patch: Partial<Subscription> = {}): Subscription => ({
  id:randomUUID(),name:`${account.label} · ${type}`,plan:type,category:"生活服务",amount:type === "yearly" ? 240 : type === "monthly" ? 8 : 10,
  currency:"CNY",cycle:type === "once" ? "custom" : type,customDays:type === "once" ? 1 : 30,
  startDate:"2026-11-26",endDate:renewDate("2026-11-26",type === "once" ? "custom" : type,1),
  autoRenew:type !== "once",autoRecord:false,reminderEnabled:type === "yearly",reminderDays:7,note:"",color:"#269979",version:0,
  expenseType:"phone",phoneAccountId:account.id,phoneChargeType:type,...patch,
});
function setup(today = "2026-11-26") {
  const db = openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES(1,'owner','fixture',0),(2,'other','fixture',0)");
  let now = at(today);
  return { db, phones:new PhoneAccounts(db), service:new SubscriptionService(db,"Asia/Shanghai",() => now),
    payments:new PaymentService(db,undefined,"Asia/Shanghai",() => now), backups:new BackupService(db), setDay:(date:string) => { now=at(date); } };
}

test("phone identities support several numbers, negative manual balances, owner isolation and stale-edit protection", t => {
  const {db,phones} = setup(); t.after(()=>db.close());
  const first = phones.execute(1,{action:"create",item:phone()}).item!;
  phones.execute(1,{action:"create",item:phone({number:"13900001234",label:"Fixture backup"})});
  assert.equal(phones.list(1).length,2);assert.equal(phones.list(2).length,0);assert.equal(first.balance,-8.25);
  assert.throws(()=>phones.execute(1,{action:"create",item:phone()}),{code:"PHONE_EXISTS"});
  assert.throws(()=>phones.execute(2,{action:"delete",id:first.id,version:0}),{status:404});
  const updated = phones.execute(1,{action:"update",id:first.id,version:0,item:{...first,balance:15}}).item!;
  assert.equal(updated.version,1);
  assert.throws(()=>phones.execute(1,{action:"update",id:first.id,version:0,item:first}),{code:"VERSION_CONFLICT"});
  assert.throws(()=>phones.execute(1,{action:"create",item:phone({number:"invalid"})}));
  assert.throws(()=>phones.execute(1,{action:"create",item:phone({balanceAsOf:null})}));
});

test("monthly, annual and one-off charges share a ledger without turning annual amortisation or balances into payments", async t => {
  const {db,phones,service,payments} = setup();t.after(()=>db.close());
  const owner = phones.execute(1,{action:"create",item:phone()}).item!;
  for (const type of ["monthly","yearly","once"] as const) service.execute(1,{action:"create",item:fee(owner,type)});
  const children=service.list(1).items;
  assert.equal(phoneMonthlyCost(children,"2026-11-26"),28);
  assert.equal(monthlyCostCny(children.find(item=>item.phoneChargeType==="once")!),0);
  assert.equal(payments.all(1).length,3);assert.ok(payments.all(1).every(log=>log.fixedBill && !log.payment));
  assert.equal(paymentReport(payments.all(1),children,"2026-11-26","2026-11","confirmed").total,0);
  for (const log of payments.all(1)) await payments.confirm(1,{id:log.id,entry:{amount:log.amount,currency:"CNY",paidOn:"2026-11-26",startDate:log.newStartDate,endDate:log.newEndDate,note:"fixture"}});
  assert.equal(paymentReport(payments.all(1),children,"2026-11-26","2026-11","confirmed").total,258);
  assert.equal(phones.list(1)[0].balance,-8.25,"manual balance is a snapshot, never an inferred wallet");
  assert.equal(service.listPublic().length,0);
});

test("annual billing stays annual across monthly catch-up and preserves historical prices", t => {
  const {db,phones,service,payments,setDay} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  service.execute(1,{action:"create",item:fee(owner,"monthly",{autoRecord:true})});
  const annual=service.execute(1,{action:"create",item:fee(owner,"yearly",{autoRecord:true})}).item!;
  service.execute(1,{action:"update",id:annual.id,version:annual.version,item:{...annual,amount:360,plan:"new annual price"}});
  setDay("2027-02-26");service.advanceAutomaticRenewals(at("2027-02-26"));service.advanceAutomaticRenewals(at("2027-02-26"));
  assert.equal(payments.all(1).filter(log=>log.subscriptionId===annual.id).length,1);
  assert.equal(payments.all(1).find(log=>log.subscriptionId===annual.id)!.payment!.amount,240);
  setDay("2027-11-26");service.advanceAutomaticRenewals(at("2027-11-26"));
  const logs=payments.all(1).filter(log=>log.subscriptionId===annual.id).sort((a,b)=>a.newStartDate.localeCompare(b.newStartDate));
  assert.deepEqual(logs.map(log=>log.payment!.amount),[240,360]);
  assert.deepEqual(logs.map(log=>log.newStartDate),["2026-11-26","2027-11-26"]);
});

test("future and one-off fees wait until their date, run once, and cannot reappear after voiding", t => {
  const {db,phones,service,payments,setDay} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  const once=service.execute(1,{action:"create",item:fee(owner,"once",{startDate:"2026-12-01",endDate:"2026-12-02",autoRecord:true})}).item!;
  service.execute(1,{action:"create",item:fee(owner,"yearly",{startDate:"2026-12-01",endDate:"2027-12-01",autoRenew:false})});
  assert.equal(payments.all(1).length,0);assert.equal(phoneMonthlyCost(service.list(1).items,"2026-11-26"),0);
  setDay("2026-12-01");service.advanceAutomaticRenewals(at("2026-12-01"));
  assert.equal(payments.all(1).length,2);
  payments.void(1,{id:payments.all(1).find(log=>log.subscriptionId===once.id)!.id});
  service.advanceAutomaticRenewals(at("2028-12-01"));service.advanceAutomaticRenewals(at("2028-12-01"));
  assert.equal(payments.all(1).length,2);
});

test("existing fixed phone fees can move under a number without duplicating their bill or losing payment history", t => {
  const {db,phones,service,payments} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  const {phoneAccountId,phoneChargeType,...raw}=fee(owner,"monthly");
  const old=service.execute(1,{action:"create",item:{...raw,expenseType:"fixed",autoRecord:true}}).item!;
  const history=payments.all(1);
  service.execute(1,{action:"update",id:old.id,version:old.version,item:{...old,expenseType:"phone",phoneAccountId,phoneChargeType}});
  assert.deepEqual(payments.all(1),history);assert.equal(service.listPublic().length,0);
});

test("removing charges and numbers retains paid history and blocks accidental cascading deletion", t => {
  const {db,phones,service,payments} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  const child=service.execute(1,{action:"create",item:fee(owner,"once",{autoRecord:true})}).item!;
  assert.throws(()=>phones.execute(1,{action:"delete",id:owner.id,version:owner.version}),{code:"PHONE_HAS_CHARGES"});
  service.execute(1,{action:"delete",id:child.id,version:child.version});
  phones.execute(1,{action:"delete",id:owner.id,version:owner.version});
  assert.equal(phones.list(1).length,0);assert.equal(payments.all(1).length,1);assert.equal(payments.all(1)[0].payment!.amount,10);
});

test("phone associations, one-off cadence and monetary limits are validated before writing", t => {
  const {db,phones,service} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  assert.throws(()=>service.execute(2,{action:"create",item:fee(owner,"monthly")}),{status:404});
  for(const patch of [{autoRenew:true},{reminderEnabled:true},{customDays:30},{endDate:"2026-12-26"},{phoneAccountId:undefined},{currency:"USD",purchaseDate:"2026-11-26",fxRateDate:"2026-11-26",fxRateToCny:7,fxRateSource:"manual"}]) {
    assert.throws(()=>service.execute(1,{action:"create",item:fee(owner,"once",patch as Partial<Subscription>)}));
  }
  assert.equal(service.list(1).items.length,0);
});

test("v5 backup restores phone relationships, freezes old bills and includes phone edits in the import revision", t => {
  const {db,phones,service,payments,backups} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  service.execute(1,{action:"create",item:fee(owner,"yearly",{autoRecord:true})});
  const document=backups.export(1);assert.equal(document.formatVersion,5);assert.equal(document.phoneAccounts!.length,1);
  const preview=backups.preview(2,document);assert.equal(preview.newPhoneAccounts,1);
  backups.import(2,{backup:document,mode:"merge",expectedRevision:preview.revision});
  assert.equal(phones.list(2)[0].number,owner.number);assert.deepEqual(payments.all(2),payments.all(1));
  assert.equal(service.list(2).items[0].phoneAccountId,owner.id);
  const stale=backups.preview(1,document);
  phones.execute(1,{action:"update",id:owner.id,version:0,item:{...owner,label:"Renamed"}});
  assert.throws(()=>backups.import(1,{backup:document,mode:"replace",confirmReplace:true,expectedRevision:stale.revision}),{code:"VERSION_CONFLICT"});
  const fresh=backups.preview(1,document);
  backups.import(1,{backup:document,mode:"replace",confirmReplace:true,expectedRevision:fresh.revision});
  assert.equal(phones.list(1)[0].label,owner.label);assert.ok(phones.list(1)[0].version>owner.version);
  const invalid=structuredClone(document);invalid.phoneAccounts=[];
  assert.throws(()=>backups.preview(1,invalid));
  const duplicate=structuredClone(document);duplicate.phoneAccounts!.push({...owner,id:randomUUID()});
  assert.throws(()=>backups.preview(1,duplicate));
});

test("backup merge rejects phone ID collisions atomically instead of attaching bills to another identity", t => {
  const {db,phones,service,backups} = setup();t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  service.execute(1,{action:"create",item:fee(owner,"monthly")});
  phones.execute(2,{action:"create",item:phone({id:owner.id,number:"13900001234"})});
  const document=backups.export(1), before=backups.export(2);
  assert.throws(()=>backups.import(2,{backup:document,mode:"merge",expectedRevision:backups.preview(2,document).revision}),{code:"PHONE_EXISTS"});
  assert.deepEqual(backups.export(2).subscriptions,before.subscriptions);assert.deepEqual(phones.list(2),before.phoneAccounts);
});

test("phone APIs require login and the public dashboard never reveals phone identities or charge names", async t => {
  const db=openDatabase(":memory:");
  const config=readConfig({PUBLIC_ORIGIN:"http://127.0.0.1",COOKIE_SECURE:"false",PUBLIC_DASHBOARD:"true",ADMIN_PASSWORD:randomUUID()});
  await bootstrapAdmin(db,config);
  const phones=new PhoneAccounts(db), service=new SubscriptionService(db,config.timeZone);
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  service.execute(1,{action:"create",item:fee(owner,"monthly")});
  const server=createApp(db,config).listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
  config.publicOrigin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const publicBody=await (await fetch(config.publicOrigin+"/api/dashboard")).json() as DashboardSnapshot;
  assert.deepEqual(publicBody.items,[]);assert.equal(publicBody.phoneAccounts,undefined);
  assert.equal((await fetch(config.publicOrigin+"/api/phones")).status,401);
  const login=await fetch(config.publicOrigin+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json","X-Requested-With":"membership-dashboard",Origin:config.publicOrigin},body:JSON.stringify({username:config.adminUsername,password:config.adminPassword})});
  const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const privateBody=await (await fetch(config.publicOrigin+"/api/dashboard",{headers:{Cookie:cookie}})).json() as DashboardSnapshot;
  assert.equal(privateBody.phoneAccounts![0].number,owner.number);assert.equal(privateBody.items[0].phoneAccountId,owner.id);
});

test("v10 migration preserves subscriptions, renewal audit children and credentials, and re-enables foreign keys", t => {
  const folder=mkdtempSync(join(tmpdir(),"vip-phone-migration-")), path=join(folder,"fixture.sqlite");
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  let db=new DatabaseSync(path);
  for (const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(name=>name.endsWith(".sql")).sort().slice(0,10)) db.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
  db.exec("PRAGMA user_version=10; INSERT INTO users VALUES(1,'owner','fixture-hash',0)");
  const id=randomUUID();
  db.prepare("INSERT INTO subscriptions(user_id,id,name,plan,category,amount_cents,cycle,custom_days,start_date,end_date,reminder_days,auto_renew,note,color,updated_at) VALUES(1,?,'Legacy','','生活服务',5800,'monthly',30,'2026-01-31','2026-02-28',7,1,'private','#269979',0)").run(id);
  db.prepare("INSERT INTO automatic_renewal_events(user_id,subscription_id,previous_start_date,previous_end_date,new_start_date,new_end_date,periods_advanced,created_at) VALUES(1,?,'2025-12-31','2026-01-31','2026-01-31','2026-02-28',1,0)").run(id);
  const before={...db.prepare("SELECT * FROM subscriptions").get()!}, audit={...db.prepare("SELECT * FROM automatic_renewal_events").get()!};db.close();
  db=openDatabase(path);
  try {
    const after={...db.prepare("SELECT * FROM subscriptions").get()!};
    for(const [key,value] of Object.entries(before))assert.equal(after[key],value,key);
    assert.deepEqual({...db.prepare("SELECT * FROM automatic_renewal_events").get()!},audit);
    assert.equal(db.prepare("SELECT password_hash FROM users").get()!.password_hash,"fixture-hash");
    assert.equal(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys,1);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    db.close();db=openDatabase(path);assert.equal(db.prepare("PRAGMA user_version").get()!.user_version,12);
  } finally {db.close();}
});

test("annual phone packages use existing reminder channels while silent monthly and one-off fees stay quiet", async t => {
  const {db,phones,service}=setup("2026-12-01");t.after(()=>db.close());
  const owner=phones.execute(1,{action:"create",item:phone()}).item!;
  service.execute(1,{action:"create",item:fee(owner,"yearly",{autoRenew:false,startDate:"2025-12-08",endDate:"2026-12-08"})});
  service.execute(1,{action:"create",item:fee(owner,"monthly",{startDate:"2026-11-08",endDate:"2026-12-08"})});
  service.execute(1,{action:"create",item:fee(owner,"once")});
  const config=readConfig({EMAIL_NOTIFICATIONS:"true",SMTP_USER:"fixture@example.com",SMTP_PASSWORD:"fixture",BARK_NOTIFICATIONS:"true",BARK_KEY:"fixture",EMAIL_REMINDER_HOUR:"0"});
  let email=0,bark=0;
  const mailer=new EmailNotificationService(db,config,{send:async()=>{email++;}});
  const push=new BarkNotificationService(db,config,{send:async()=>{bark++;}});
  assert.equal(await mailer.sendDueReminders(at("2026-12-01")),1);assert.equal(await push.sendDueReminders(at("2026-12-01")),1);
  assert.equal(await mailer.sendDueReminders(at("2026-12-01")),0);assert.equal(await push.sendDueReminders(at("2026-12-01")),0);
  assert.equal(email,1);assert.equal(bark,1);
});

test("failed phone-table rebuild rolls back the entire migration without discarding existing audit rows", t => {
  const folder=mkdtempSync(join(tmpdir(),"vip-phone-rollback-")), path=join(folder,"fixture.sqlite");
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  let db=new DatabaseSync(path);
  for(const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(name=>name.endsWith(".sql")).sort().slice(0,10))db.exec(readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8"));
  db.exec("PRAGMA user_version=10; PRAGMA foreign_keys=OFF; INSERT INTO users VALUES(1,'owner','fixture',0)");
  db.prepare("INSERT INTO automatic_renewal_events(user_id,subscription_id,previous_start_date,previous_end_date,new_start_date,new_end_date,periods_advanced,created_at) VALUES(1,?,'2026-01-01','2026-02-01','2026-02-01','2026-03-01',1,0)").run(randomUUID());
  db.close();assert.throws(()=>openDatabase(path),/数据库打开或迁移失败/);
  db=new DatabaseSync(path);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version,10);
    assert.equal(db.prepare("SELECT count(*) n FROM automatic_renewal_events").get()!.n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('phone_accounts','subscriptions_v11')").get()!.n,0);
  } finally {db.close();}
});
