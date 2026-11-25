import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { readConfig } from "../src/config.ts";
import { bootstrapAdmin } from "../src/auth.ts";
import { createApp } from "../src/app.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { BackupService } from "../src/backups.ts";
import { paymentReport } from "../../shared/payment-reports.ts";
import { dateInTimeZone } from "../../shared/billing.ts";
import { monthlyCostCny, subscriptionAmountCny, type Subscription, type DashboardSnapshot } from "../../shared/subscriptions.ts";

const fixture = (patch: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "Snapshot fixture", plan: "", category: "AI 工具", amount: 20,
  cycle: "monthly", customDays: 30, startDate: "2026-11-01", endDate: "2026-12-01",
  reminderDays: 7, autoRenew: false, note: "", color: "#269979", version: 0,
  currency: "USD", purchaseDate: "2026-11-01", fxRateToCny: 8.6, fxRateDate: "2026-11-01", fxRateSource: "manual", ...patch,
});

test("HTTP create and note-only edits preserve manual and imported rates without contacting the provider", async t => {
  const db = openDatabase(":memory:");
  const config = readConfig({ PUBLIC_ORIGIN: "http://fixture.test", COOKIE_SECURE: "false", ADMIN_PASSWORD: randomUUID() });
  await bootstrapAdmin(db, config);
  let queries = 0;
  const rates = new ExchangeRates(async () => { queries++; throw new Error("Provider is offline"); });
  const server = createApp(db, config, undefined, rates).listen(0, "127.0.0.1");
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const headers = { Origin: config.publicOrigin, "Content-Type": "application/json", "X-Requested-With": "membership-dashboard" };
  const login = await fetch(base + "/auth/login", { method: "POST", headers, body: JSON.stringify({ username: config.adminUsername, password: config.adminPassword }) });
  assert.equal(login.status, 200);
  const Cookie = login.headers.get("set-cookie")!.split(";")[0];
  const post = (body: unknown) => fetch(base + "/subscriptions", { method: "POST", headers: { ...headers, Cookie }, body: JSON.stringify(body) });
  for (const source of ["manual", "frankfurter"] as const) {
    const created = await post({ action: "create", item: fixture({ fxRateSource: source }) });
    assert.equal(created.status, 201);
    const before = (await created.json() as { item: Subscription }).item;
    const updated = await post({ action: "update", id: before.id, version: before.version, item: { ...before, note: "Only this field changed" } });
    assert.equal(updated.status, 200);
    const after = (await updated.json() as { item: Subscription }).item;
    assert.equal(after.fxRateToCny, 8.6); assert.equal(after.fxRateSource, source);
    assert.equal(after.purchaseDate, before.purchaseDate); assert.equal(after.fxRateDate, before.fxRateDate);
    assert.equal(after.ratePending, false); assert.equal(monthlyCostCny(after), 172);
  }
  assert.equal(queries, 0);
  assert.equal((await post(null)).status, 400);
});

test("confirmed consumption excludes estimates and reconciles all selected summaries and groups", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','fixture',0)");
  const service = new SubscriptionService(db, "Asia/Shanghai");
  const item = service.execute(1, { action: "create", item: fixture({ currency: "CNY", fxRateToCny: 1, amount: 100 }) }).item!;
  const payments = new PaymentService(db);
  const empty = paymentReport([], [item], "2026-11-25", "2026-11", "confirmed");
  assert.equal(empty.monthTotal, 0); assert.equal(empty.total, 0); assert.equal(empty.details.length, 0);
  await payments.add(1, { subscriptionId: item.id, entries: [{ amount: 80, currency: "CNY", paidOn: "2026-11-03", startDate: item.startDate, endDate: item.endDate, note: "" }] });
  const logs = payments.all(1), report = paymentReport(logs, [item], "2026-11-25", "2026-11", "confirmed");
  assert.equal(report.monthTotal, 80); assert.equal(report.yearTotal, 80); assert.equal(report.total, 80);
  assert.equal(report.subscriptionCount, 0); assert.equal(report.confirmedCount, 1);
  assert.equal(report.categories.reduce((sum, row) => sum + row.amount, 0), 80);
  assert.equal(report.months.reduce((sum, row) => sum + row.amount, 0), 80);
  payments.void(1, { id: logs[0].id });
  assert.equal(paymentReport(payments.all(1), [item], "2026-11-25", "2026-11", "confirmed").total, 0);
});

test("foreign prepayments use the actual paid date; late payments and date corrections remain restorable", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','fixture',0),(2,'restored','fixture',0)");
  const clock = () => new Date("2026-11-25T04:00:00Z");
  const dates: string[] = [];
  const rates = new ExchangeRates(async input => {
    const date = new URL(String(input)).searchParams.get("date")!; dates.push(date);
    return Response.json({ date, base: "USD", quote: "CNY", rate: 7.2 });
  }, "Asia/Shanghai", clock);
  const service = new SubscriptionService(db, "Asia/Shanghai", clock, rates);
  const item = service.execute(1, { action: "create", item: fixture() }).item!;
  const renewed = service.execute(1, { action: "renew", id: item.id, version: item.version });
  const payments = new PaymentService(db, rates, "Asia/Shanghai", clock);
  await payments.confirm(1, { id: renewed.renewal!.id, entry: { amount: 20, currency: "USD", paidOn: "2026-11-25", startDate: "2026-12-01", endDate: "2027-01-01", note: "Prepayment" } });
  await payments.add(1, { subscriptionId: item.id, entries: [{ amount: 30, currency: "USD", paidOn: "2026-11-20", startDate: "2026-10-01", endDate: "2026-11-01", note: "Late payment" }] });
  assert.deepEqual(dates, ["2026-11-25", "2026-11-20"]);
  const late = payments.all(1).find(log => log.payment?.source === "backfill")!;
  assert.equal(late.payment!.rateBasisDate, "2026-11-20");
  payments.correctDate(1, { id: late.id, paidOn: "2026-10-25", expectedPaidOn: "2026-11-20" });
  assert.equal(payments.all(1).find(log => log.id === late.id)!.payment!.rateBasisDate, "2026-11-20");
  const backups = new BackupService(db), backup = backups.export(1);
  backups.import(2, { backup, mode: "merge", expectedRevision: backups.preview(2, backup).revision });
  assert.deepEqual(payments.all(2), payments.all(1));
});

test("payment dates, FX dates and pending scans follow the configured business timezone at midnight", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','fixture',0)");
  const clock = () => new Date("2026-11-24T16:30:00Z");
  const rates = new ExchangeRates(async input => Response.json({ date: new URL(String(input)).searchParams.get("date"), base: "USD", quote: "CNY", rate: 7.2 }), "Asia/Shanghai", clock);
  assert.equal(dateInTimeZone(clock(), "Asia/Shanghai"), "2026-11-25");
  assert.equal((await rates.lookup({ currency: "USD", date: "2026-11-25" })).rate, 7.2);
  await assert.rejects(rates.lookup({ currency: "USD", date: "2026-11-26" }), { status: 400 });
  const service = new SubscriptionService(db, "Asia/Shanghai", clock, rates);
  const item = service.execute(1, { action: "create", item: fixture({ purchaseDate: "2026-11-25", fxRateDate: "2026-11-25", ratePending: true }) }).item!;
  const payments = new PaymentService(db, rates, "Asia/Shanghai", clock);
  await payments.preview(1, { subscriptionId: item.id, entries: [{ amount: 20, currency: "USD", paidOn: "2026-11-25", startDate: "2026-12-01", endDate: "2027-01-01", note: "" }] });
  await assert.rejects(payments.preview(1, { subscriptionId: item.id, entries: [{ amount: 20, currency: "CNY", paidOn: "2026-11-26", startDate: "2026-12-01", endDate: "2027-01-01", note: "" }] }), { status: 400 });
  await service.refreshPendingRates();
  assert.equal(service.list(1).items[0].ratePending, false);
  assert.equal(service.list(1).items[0].fxRateDate, "2026-11-25");
  const saved = service.execute(1, { action: "update", id: item.id, version: item.version, item: { ...item, note: "Editor was open during the rate scan" } }).item!;
  assert.equal(saved.ratePending, false); assert.equal(saved.fxRateToCny, 7.2);
  const westernClock = () => new Date("2026-11-25T01:00:00Z");
  const westernRates = new ExchangeRates(async () => { throw new Error("No query for a future local date"); }, "America/Los_Angeles", westernClock);
  await assert.rejects(westernRates.lookup({ currency: "USD", date: "2026-11-25" }), { status: 400 });
  const config = readConfig({ PUBLIC_DASHBOARD: "true" });
  const server = createApp(db, config, undefined, rates, clock).listen(0, "127.0.0.1");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const snapshot = await (await fetch(`http://127.0.0.1:${address.port}/api/dashboard`)).json() as DashboardSnapshot;
  assert.equal(snapshot.today, "2026-11-25"); assert.equal(snapshot.timeZone, "Asia/Shanghai");
});

test("unknown FX stays out of known renewal totals and is explicitly counted", () => {
  const item = fixture({ endDate: "2026-11-28", ratePending: true, fxRateToCny: 1 });
  assert.equal(subscriptionAmountCny(item), null);
  const report = paymentReport([], [item], "2026-11-25", "2026-11", "confirmed");
  assert.equal(report.forecast, 0); assert.equal(report.forecastPending, 1);
  assert.equal(report.upcoming[0].cny, null);
});
