/** Phone summary and manager regression; synthetic identities, isolated memory DB, no provider access. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { createApp } from "../backend/src/app.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { PhoneAccounts } from "../backend/src/phones.ts";
import { PaymentService } from "../backend/src/payments.ts";

const playwright=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output=process.env.VIP_PHONE_OUTPUT_DIR || join(homedir(),"Desktop","CodexArtifacts","vip-manager","phone-tests");
const now=new Date("2026-11-26T02:00:00Z");
const config=readConfig({PUBLIC_ORIGIN:"http://127.0.0.1",COOKIE_SECURE:"false",ADMIN_PASSWORD:randomUUID()});
const db=openDatabase(":memory:"), service=new SubscriptionService(db,config.timeZone,()=>now), phones=new PhoneAccounts(db), payments=new PaymentService(db,undefined,config.timeZone,()=>now);
let server,browser,page;
try {
  await mkdir(output,{recursive:true});await bootstrapAdmin(db,config);
  const api=createApp(db,config,undefined,undefined,()=>now), web=express();
  web.use((req,res,next)=>req.path.startsWith("/api/")?api(req,res,next):next());
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/",import.meta.url))));
  server=web.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  config.publicOrigin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:"America/Los_Angeles"});
  const headers={Origin:config.publicOrigin,"X-Requested-With":"membership-dashboard"};
  assert.equal((await context.request.post(config.publicOrigin+"/api/auth/login",{headers,data:{username:config.adminUsername,password:config.adminPassword}})).status(),200);
  page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.clock.install({time:now});await page.goto(config.publicOrigin);
  const ranges=page.getByRole("group",{name:"记录范围",exact:true});
  const manager=page.locator(".phone-manager-dialog");
  const summary=page.getByRole("article",{name:"手机话费汇总",exact:true});
  async function openManager(){await page.getByRole("button",{name:"管理手机话费",exact:true}).click();await manager.waitFor();}
  async function closeManager(){await manager.getByRole("button",{name:"Close",exact:true}).click();await manager.waitFor({state:"hidden"});}
  async function expand(label){const row=manager.getByRole("article",{name:`号码 ${label}`,exact:true});if(!await row.locator("details").evaluate(el=>el.open))await row.locator("summary").click();return row;}
  async function screenshot(name,locator=page){await locator.screenshot({animations:"disabled",style:"[data-sonner-toaster]{visibility:hidden!important}",path:join(output,name),...(locator===page?{fullPage:true}:{})});}
  await ranges.getByRole("button",{name:"手机话费",exact:true}).click();
  await summary.waitFor();assert.equal(await page.getByRole("button",{name:"添加号码",exact:true}).count(),0,"homepage has no number management actions");
  await openManager();
  async function addPhone(label,number,balance="") {
    await manager.getByRole("button",{name:"添加号码",exact:true}).click();
    await page.getByLabel("号码备注 *",{exact:true}).fill(label);await page.getByLabel("手机号码 *",{exact:true}).fill(number);
    if(balance)await page.getByLabel("当前余额（元）",{exact:true}).fill(balance);
    await manager.getByRole("button",{name:"保存号码",exact:true}).click();await manager.getByRole("button",{name:"添加号码",exact:true}).waitFor();
  }
  await addPhone("主用卡","13800000000","-8.25");await addPhone("备用卡","13900001234");
  assert.equal(await manager.locator(".phone-account-row").count(),2);assert.equal(phones.list(1).length,2);
  let primary=await expand("主用卡");
  assert.ok(!(await primary.innerText()).includes("13800000000"));assert.match(await primary.innerText(),/-8.25/);
  async function addCharge(type,name,amount) {
    primary=await expand("主用卡");await primary.getByRole("button",{name:"为 主用卡 添加费用",exact:true}).click();
    await page.getByLabel("费用类型",{exact:true}).selectOption(type);await page.getByLabel("费用名称 *",{exact:true}).fill(name);
    const label=type==="yearly"?"年包总价（元）":type==="once"?"本次费用（元）":"每月费用（元）";
    await page.getByLabel(`${label} *`,{exact:true}).fill(amount);
    if(type==="yearly")await page.getByLabel("本期年包生效日 *",{exact:true}).fill("2026-11-01");
    await manager.getByRole("button",{name:"保存费用",exact:true}).click();await manager.getByRole("button",{name:"添加号码",exact:true}).waitFor();
  }
  await addCharge("monthly","保号月租","8");await addCharge("yearly","年度流量包","240");await addCharge("once","临时流量","10");
  primary=await expand("主用卡");await primary.locator(".phone-account-cost").getByText("¥28.00",{exact:false}).waitFor();
  assert.equal(service.list(1).items.length,3);assert.equal(payments.all(1).length,3);
  assert.match(await primary.innerText(),/不计入常规月均/);assert.match(await primary.innerText(),/仅记录本期/);
  const annualRow=primary.locator(".phone-charge-list>li").filter({hasText:"年度流量包"});
  await annualRow.getByRole("button",{name:"流水",exact:true}).click();
  const ledger=page.locator(".ledger-dialog");await ledger.getByRole("button",{name:"确认付款",exact:true}).click();
  await ledger.getByRole("button",{name:"确认已支付",exact:true}).click();
  await ledger.locator(".payment-badge.paid").waitFor();await ledger.getByRole("button",{name:"Close",exact:true}).click();await ledger.waitFor({state:"hidden"});
  assert.equal(await manager.isVisible(),true,"closing payment history returns to phone manager");
  const annual=service.list(1).items.find(item=>item.phoneChargeType==="yearly");
  assert.equal(payments.all(1).find(log=>log.subscriptionId===annual.id).payment.amount,240);
  await annualRow.getByRole("button",{name:"编辑费用",exact:true}).click();await page.getByLabel("年包总价（元） *",{exact:true}).fill("360");
  await page.setViewportSize({width:320,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await manager.evaluate(el=>{el.scrollTop=0;});await screenshot("phone-charge-editor-320.png");
  await manager.getByRole("button",{name:"保存费用",exact:true}).click();await manager.getByRole("button",{name:"添加号码",exact:true}).waitFor();
  assert.equal(payments.all(1).find(log=>log.subscriptionId===annual.id).payment.amount,240);
  await closeManager();
  await summary.locator(".phone-summary-cost .currency-value").getByText("38.00",{exact:true}).waitFor();
  assert.equal(await page.locator(".phone-account-row").count(),0);assert.equal(await page.locator(".subscription-grid>.phone-summary-card").count(),1);
  assert.ok(!(await summary.innerText()).includes("138"));assert.ok(!(await summary.innerText()).includes("-8.25"));
  assert.equal(await summary.getByRole("progressbar",{name:"套餐剩余进度",exact:true}).getAttribute("aria-valuenow"),"93");
  assert.ok((await summary.locator(".phone-summary-remaining").innerText()).includes("340"));
  const monthly=service.list(1).items.find(item=>item.phoneChargeType==="monthly");
  await openManager();
  await manager.getByRole("combobox",{name:"首页展示套餐",exact:true}).selectOption(monthly.id);
  await manager.getByRole("combobox",{name:"首页展示套餐",exact:true}).waitFor({state:"visible"});
  await page.waitForFunction(()=>!document.querySelector('[aria-label="首页展示套餐"]').disabled);
  assert.equal(phones.preference(1).selectedChargeId,monthly.id);
  assert.ok(!(await manager.getByRole("combobox",{name:"首页展示套餐",exact:true}).locator("option").allTextContents()).some(text=>text.includes("临时流量")));
  await closeManager();assert.ok((await summary.innerText()).includes("保号月租"));
  assert.ok((await summary.innerText()).includes("指定套餐"));assert.equal(await summary.locator(".phone-summary-cost .currency-value").innerText(),"38.00");
  await page.reload();await summary.waitFor();assert.ok((await summary.innerText()).includes("保号月租"));
  await openManager();assert.equal(await manager.getByRole("combobox",{name:"首页展示套餐",exact:true}).inputValue(),monthly.id);
  await manager.getByRole("combobox",{name:"首页展示套餐",exact:true}).selectOption("");
  await page.waitForFunction(()=>!document.querySelector('[aria-label="首页展示套餐"]').disabled);
  await closeManager();assert.ok((await summary.innerText()).includes("年度流量包"));

  console.log("PASS single cost-first summary, private number/fee management, nested ledger return and frozen annual history");

  const legacy=service.execute(1,{action:"create",item:{...service.list(1).items.find(item=>item.phoneChargeType==="monthly"),id:randomUUID(),phoneAccountId:undefined,phoneChargeType:undefined,expenseType:"fixed",name:"已有月租",plan:"旧套餐",amount:58}}).item;
  const legacyLogs=payments.all(1).filter(log=>log.subscriptionId===legacy.id);
  await page.reload();await ranges.getByRole("button",{name:"全部记录",exact:true}).waitFor();await openManager();
  const backup=await expand("备用卡");await backup.getByRole("button",{name:"为 备用卡 添加费用",exact:true}).click();
  await page.getByLabel("关联已有记录（可选）",{exact:true}).selectOption(legacy.id);
  await manager.getByRole("button",{name:"保存费用",exact:true}).click();await manager.getByRole("button",{name:"添加号码",exact:true}).waitFor();
  assert.deepEqual(payments.all(1).filter(log=>log.subscriptionId===legacy.id),legacyLogs);
  await manager.getByRole("textbox",{name:"搜索手机号码",exact:true}).fill("备用卡");assert.equal(await manager.locator(".phone-account-row").count(),1);
  await manager.getByRole("textbox",{name:"搜索手机号码",exact:true}).fill("");assert.equal(await manager.locator(".phone-account-row").count(),2);
  await closeManager();assert.equal(await page.locator(".subscription-grid>article").count(),1);
  assert.equal(await page.locator(".hero-metric-primary .metric-number span").innerText(),"96.00","summary is not added to the budget twice");
  for(const [name,category,amount] of [["视频会员测试","影音娱乐",10],["AI 会员测试","AI 工具",20]]) {
    service.execute(1,{action:"create",item:{...service.list(1).items.find(item=>item.phoneChargeType==="monthly"),id:randomUUID(),phoneAccountId:undefined,phoneChargeType:undefined,expenseType:"subscription",autoRecord:false,autoRenew:false,name,category,amount}});
  }
  await page.setViewportSize({width:1440,height:1100});await page.reload();await summary.waitFor();
  assert.equal(await page.locator(".subscription-grid>article").count(),3);
  await page.getByRole("combobox",{name:"排序方式",exact:true}).click();await page.getByRole("option",{name:"月均费用从高到低",exact:true}).click();
  assert.equal(await page.locator(".subscription-grid>article").first().getAttribute("aria-label"),"手机话费汇总");
  await screenshot("phone-summary-with-subscriptions.png",page.locator(".subscription-grid"));
  await page.getByRole("textbox",{name:"搜索订阅",exact:true}).fill("备用卡");assert.equal(await summary.count(),1);
  await page.getByRole("textbox",{name:"搜索订阅",exact:true}).fill("no-match");assert.equal(await summary.count(),0);
  await page.getByRole("textbox",{name:"搜索订阅",exact:true}).fill("");
  await page.getByRole("tab",{name:/生活服务/}).click();assert.equal(await summary.count(),1);
  await ranges.getByRole("button",{name:"会员订阅",exact:true}).click();assert.equal(await summary.count(),0);
  await ranges.getByRole("button",{name:"手机话费",exact:true}).click();await summary.waitFor();
  await page.getByRole("button",{name:"紧凑列表视图",exact:true}).click();assert.equal(await page.locator(".phone-summary-row").count(),1);
  await openManager();await closeManager();await page.getByRole("button",{name:"卡片视图",exact:true}).click();
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Summary overflow: ${width}`);
    await screenshot(`phone-summary-${width}.png`);await screenshot(`phone-summary-card-${width}.png`,summary);
    await openManager();assert.ok(await manager.evaluate(el=>el.scrollWidth<=el.clientWidth),`Manager overflow: ${width}`);
    await screenshot(`phone-manager-${width}.png`);await closeManager();
  }
  await page.getByRole("button",{name:"切换到黑夜模式",exact:true}).click();await screenshot("phone-summary-dark.png");
  await openManager();await screenshot("phone-manager-dark.png");await closeManager();await page.getByRole("button",{name:"切换到明亮模式",exact:true}).click();
  console.log("PASS legacy association, one-time aggregate budget, search/category filters, compact view and responsive light/dark manager");

  await openManager();primary=await expand("主用卡");
  await primary.getByRole("button",{name:"编辑号码 主用卡",exact:true}).click();await page.getByLabel("号码备注 *",{exact:true}).fill("未保存");
  await manager.getByRole("button",{name:"返回号码列表",exact:true}).click();assert.equal(await manager.getByRole("article",{name:"号码 主用卡",exact:true}).count(),1);
  primary=await expand("主用卡");const once=primary.locator(".phone-charge-list>li").filter({hasText:"临时流量"});
  await once.getByRole("button",{name:"移除",exact:true}).click();await page.getByRole("button",{name:"确认移除",exact:true}).click();await page.getByRole("alertdialog").waitFor({state:"hidden"});
  assert.equal(service.list(1).items.length,5);assert.equal(payments.all(1).length,4);
  await closeManager();await page.getByRole("button",{name:/提醒中心/}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  await summary.getByRole("button",{name:"管理手机话费",exact:true}).focus();await page.keyboard.press("Enter");await manager.waitFor();
  await page.keyboard.press("Escape");await manager.waitFor({state:"hidden"});
  await openManager();
  await context.request.post(config.publicOrigin+"/api/auth/logout",{headers,data:{}});
  await page.clock.fastForward(120_000);assert.equal(await manager.isVisible(),true,"polling pauses during number management");
  await closeManager();const signedOut=page.waitForResponse(response=>response.url().endsWith("/api/dashboard"));
  await page.clock.fastForward(60_000);assert.equal((await signedOut).status(),401);await page.locator(".topbar").getByRole("button",{name:"管理员登录",exact:true}).waitFor();
  assert.equal(await page.locator(".phone-summary-card,.phone-summary-row,.phone-account-row").count(),0);
  assert.deepEqual(errors,[]);
  await writeFile(join(output,"validation.json"),JSON.stringify({result:"passed",browserErrors:errors,viewports:[320,390,768,1440],syntheticNumbersOnly:true,productionDataTouched:false},null,2)+"\n");
  console.log("PASS editor back navigation, retained ledger after deletion, keyboard controls and expired-session privacy");
} catch(error) {
  if(page) {await page.screenshot({path:join(output,"failure.png"),fullPage:true,animations:"disabled"});await writeFile(join(output,"failure.txt"),await page.locator("body").innerText());}
  throw error;
} finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));db.close();}
