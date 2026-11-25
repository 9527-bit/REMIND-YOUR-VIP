/** Phone-account workflows use an isolated database and synthetic numbers only. */
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
  page.setDefaultTimeout(10_000);
  await page.clock.install({time:now});await page.goto(config.publicOrigin);
  async function addPhone(label,number,balance="") {
    await page.getByRole("button",{name:"添加号码",exact:true}).click();
    await page.getByLabel("号码备注 *",{exact:true}).fill(label);await page.getByLabel("手机号码 *",{exact:true}).fill(number);
    if(balance) await page.getByLabel("当前余额（元）",{exact:true}).fill(balance);
    await page.getByRole("button",{name:"保存号码",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  }
  await addPhone("主用卡","13800000000","-8.25");await addPhone("备用卡","13900001234");
  assert.equal(await page.locator(".phone-card").count(),2);assert.equal(phones.list(1).length,2);
  const primary=page.getByRole("article",{name:"号码 主用卡",exact:true});
  assert.ok(!(await primary.innerText()).includes("13800000000"));assert.match(await primary.innerText(),/-8.25/);
  async function addCharge(type,name,amount) {
    await primary.getByRole("button",{name:"为 主用卡 添加费用",exact:true}).click();
    await page.getByLabel("费用类型",{exact:true}).selectOption(type);await page.getByLabel("费用名称 *",{exact:true}).fill(name);
    const label=type==="yearly"?"年包总价（元）":type==="once"?"本次费用（元）":"每月费用（元）";
    await page.getByLabel(`${label} *`,{exact:true}).fill(amount);
    await page.getByRole("button",{name:"保存费用",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  }
  await addCharge("monthly","保号月租","8");await addCharge("yearly","年度流量包","240");await addCharge("once","临时流量","10");
  await primary.locator(".phone-metrics").getByText("¥28.00",{exact:false}).waitFor();
  assert.equal(service.list(1).items.length,3);assert.equal(payments.all(1).length,3);assert.equal(await page.locator(".subscription-card").count(),0);
  await primary.locator("summary").click();assert.match(await primary.innerText(),/不计入常规月均/);assert.match(await primary.innerText(),/仅记录本期/);
  const annualRow=primary.locator(".phone-charge-list>li").filter({hasText:"年度流量包"});
  await annualRow.getByRole("button",{name:"流水",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"确认付款",exact:true}).click();
  await page.getByRole("button",{name:"确认已支付",exact:true}).click();
  await page.locator(".payment-badge.paid").waitFor();await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  const annual=service.list(1).items.find(item=>item.phoneChargeType==="yearly");
  assert.equal(payments.all(1).find(log=>log.subscriptionId===annual.id).payment.amount,240);
  await annualRow.getByRole("button",{name:"编辑费用",exact:true}).click();
  await page.getByLabel("年包总价（元） *",{exact:true}).fill("360");
  await page.setViewportSize({width:320,height:1100});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole("dialog").evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({animations:"disabled",style:"[data-sonner-toaster]{visibility:hidden!important}",path:join(output,"phone-charge-editor-320.png")});
  await page.getByRole("button",{name:"保存费用",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal(payments.all(1).find(log=>log.subscriptionId===annual.id).payment.amount,240);
  await primary.locator(".phone-metrics").getByText("¥38.00",{exact:false}).waitFor();
  console.log("PASS multiple masked numbers, monthly/annual/one-off budgets, real confirmation and frozen annual history");

  const legacy=service.execute(1,{action:"create",item:{...service.list(1).items.find(item=>item.phoneChargeType==="monthly"),id:randomUUID(),phoneAccountId:undefined,phoneChargeType:undefined,expenseType:"fixed",name:"已有月租",plan:"旧套餐",amount:58}}).item;
  const legacyLogs=payments.all(1).filter(log=>log.subscriptionId===legacy.id);
  await page.reload();await primary.waitFor();
  await page.getByRole("article",{name:"号码 备用卡",exact:true}).getByRole("button",{name:"为 备用卡 添加费用",exact:true}).click();
  await page.getByLabel("关联已有记录（可选）",{exact:true}).selectOption(legacy.id);
  await page.getByRole("button",{name:"保存费用",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.deepEqual(payments.all(1).filter(log=>log.subscriptionId===legacy.id),legacyLogs);
  assert.equal(await page.locator(".subscription-card").count(),0);
  await page.getByRole("group",{name:"记录范围",exact:true}).getByRole("button",{name:"手机话费",exact:true}).click();
  assert.equal(await page.locator(".phone-card").count(),2);
  await page.getByRole("textbox",{name:"搜索手机号码",exact:true}).fill("备用卡");assert.equal(await page.locator(".phone-card").count(),1);
  await page.getByRole("textbox",{name:"搜索手机号码",exact:true}).fill("");assert.equal(await page.locator(".phone-card").count(),2);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1100});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Phone dashboard overflow: ${width}`);
    await page.screenshot({animations:"disabled",style:"[data-sonner-toaster]{visibility:hidden!important}",path:join(output,`phone-dashboard-${width}.png`),fullPage:true});
    if(width===390||width===1440)await page.locator(".phone-section").screenshot({animations:"disabled",style:"[data-sonner-toaster]{visibility:hidden!important}",path:join(output,`phone-cards-${width}.png`)});
  }
  await page.getByRole("button",{name:"切换到黑夜模式",exact:true}).click();
  await page.screenshot({animations:"disabled",style:"[data-sonner-toaster]{visibility:hidden!important}",path:join(output,"phone-dashboard-dark.png"),fullPage:true});
  await page.getByRole("button",{name:"切换到明亮模式",exact:true}).click();
  await page.getByRole("button",{name:"备份",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  await primary.locator("summary").click();
  const once=primary.locator(".phone-charge-list>li").filter({hasText:"临时流量"});
  await once.getByRole("button",{name:"移除",exact:true}).click();await page.getByRole("button",{name:"确认移除",exact:true}).click();await page.getByRole("alertdialog").waitFor({state:"hidden"});
  assert.equal(service.list(1).items.length,3);assert.equal(payments.all(1).length,4);
  assert.deepEqual(errors,[]);
  await context.request.post(config.publicOrigin+"/api/auth/logout",{headers,data:{}});
  const signedOut=page.waitForResponse(response=>response.url().endsWith("/api/dashboard"));await page.reload();assert.equal((await signedOut).status(),401);
  await page.locator(".topbar").getByRole("button",{name:"管理员登录",exact:true}).waitFor();assert.equal(await page.locator(".phone-card").count(),0);
  await writeFile(join(output,"validation.json"),JSON.stringify({result:"passed",browserErrors:errors,viewports:[320,390,768,1440],syntheticNumbersOnly:true,productionDataTouched:false},null,2)+"\n");
  console.log("PASS legacy association without duplicate bills, responsive light/dark layouts, retained history and logout privacy");
} catch(error) {
  if(page) { await page.screenshot({animations:"disabled",style:"[data-sonner-toaster]{visibility:hidden!important}",path:join(output,"failure.png"),fullPage:true});await writeFile(join(output,"failure.txt"),await page.locator("body").innerText());console.error(await page.getByRole("dialog").allTextContents()); }
  throw error;
} finally {
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));db.close();
}
