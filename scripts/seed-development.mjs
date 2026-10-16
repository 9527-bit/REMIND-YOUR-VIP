import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../backend/src/database.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { readConfig } from "../backend/src/config.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { dateKey, shiftDate } from "../shared/subscriptions.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
process.env.DATABASE_PATH = join(root, "backend/data/development.sqlite");
process.env.ADMIN_PASSWORD = "DemoPassword123456!";
process.env.ADMIN_USERNAME = "admin";
process.env.PUBLIC_ORIGIN = "http://127.0.0.1:5173";
process.env.COOKIE_SECURE = "false";

const config = readConfig();
const db = openDatabase(config.databasePath);
await bootstrapAdmin(db, config);

const service = new SubscriptionService(db, config.timeZone);
const existing = service.list(1);

if (existing.items.length === 0) {
  const today = dateKey();
  const samples = [
    {
      name: "ChatGPT Plus",
      plan: "GPT-4o / Canvas",
      category: "AI 工具",
      amount: 20,
      currency: "USD",
      purchaseDate: shiftDate(today, -24),
      fxRateToCny: 7.25,
      fxRateDate: shiftDate(today, -24),
      fxRateSource: "manual",
      cycle: "monthly",
      customDays: 30,
      startDate: shiftDate(today, -24),
      endDate: shiftDate(today, 6),
      reminderDays: 7,
      autoRenew: true,
      color: "#10a37f",
      note: "团队订阅共享使用，美元扣费",
    },
    {
      name: "Spotify",
      plan: "Premium 个人版",
      category: "影音娱乐",
      amount: 15,
      currency: "CNY",
      purchaseDate: shiftDate(today, -12),
      fxRateToCny: 1,
      fxRateDate: shiftDate(today, -12),
      fxRateSource: "manual",
      cycle: "monthly",
      customDays: 30,
      startDate: shiftDate(today, -12),
      endDate: shiftDate(today, 18),
      reminderDays: 7,
      autoRenew: true,
      color: "#1db954",
      note: "无损音质无缝串流",
    },
    {
      name: "Netflix",
      plan: "4K UHD 尊贵家庭车",
      category: "影音娱乐",
      amount: 98,
      currency: "CNY",
      purchaseDate: shiftDate(today, -88),
      fxRateToCny: 1,
      fxRateDate: shiftDate(today, -88),
      fxRateSource: "manual",
      cycle: "quarterly",
      customDays: 90,
      startDate: shiftDate(today, -88),
      endDate: shiftDate(today, 2),
      reminderDays: 7,
      autoRenew: false,
      color: "#e50914",
      note: "即将到期，需联系车头充值",
    },
    {
      name: "DeepSeek",
      plan: "API 预充值额度",
      category: "AI 工具",
      amount: 100,
      currency: "CNY",
      purchaseDate: shiftDate(today, -20),
      fxRateToCny: 1,
      fxRateDate: shiftDate(today, -20),
      fxRateSource: "manual",
      cycle: "custom",
      customDays: 60,
      startDate: shiftDate(today, -20),
      endDate: shiftDate(today, 40),
      reminderDays: 7,
      autoRenew: false,
      color: "#4d6bfe",
      note: "V3 / R1 推理计算调用",
    },
    {
      name: "哔哩哔哩",
      plan: "年度大会员",
      category: "影音娱乐",
      amount: 148,
      currency: "CNY",
      purchaseDate: shiftDate(today, -120),
      fxRateToCny: 1,
      fxRateDate: shiftDate(today, -120),
      fxRateSource: "manual",
      cycle: "yearly",
      customDays: 365,
      startDate: shiftDate(today, -120),
      endDate: shiftDate(today, 245),
      reminderDays: 14,
      autoRenew: false,
      color: "#00aeec",
      note: "4K 高码率与专属漫剧",
    },
    {
      name: "百度网盘",
      plan: "超级会员 SVIP",
      category: "云存储",
      amount: 198,
      currency: "CNY",
      purchaseDate: shiftDate(today, -368),
      fxRateToCny: 1,
      fxRateDate: shiftDate(today, -368),
      fxRateSource: "manual",
      cycle: "yearly",
      customDays: 365,
      startDate: shiftDate(today, -368),
      endDate: shiftDate(today, -3),
      reminderDays: 7,
      autoRenew: false,
      color: "#06a7ff",
      note: "极速下载，已逾期3天待续费",
    },
    {
      name: "DMIT",
      plan: "PVM.LAX.Pro.Pocket VPS",
      category: "云服务与网络",
      amount: 159.99,
      currency: "USD",
      purchaseDate: shiftDate(today, -200),
      fxRateToCny: 7.22,
      fxRateDate: shiftDate(today, -200),
      fxRateSource: "manual",
      cycle: "yearly",
      customDays: 365,
      startDate: shiftDate(today, -200),
      endDate: shiftDate(today, 165),
      reminderDays: 14,
      autoRenew: true,
      color: "#2563eb",
      note: "美西 CN2 GIA 高速云服务器",
    },
    {
      name: "iCloud+",
      plan: "200GB 家庭共享空间",
      category: "云存储",
      amount: 21,
      currency: "CNY",
      purchaseDate: shiftDate(today, -15),
      fxRateToCny: 1,
      fxRateDate: shiftDate(today, -15),
      fxRateSource: "manual",
      cycle: "monthly",
      customDays: 30,
      startDate: shiftDate(today, -15),
      endDate: shiftDate(today, 15),
      reminderDays: 7,
      autoRenew: true,
      color: "#007aff",
      note: "照片与设备备份",
    },
  ];

  for (const item of samples) {
    service.execute(1, { action: "create", item });
  }
  console.log("已成功写入演示数据：8 个具有代表性的订阅卡片。");
} else {
  console.log(`现有数据库已包含 ${existing.items.length} 个订阅。`);
}

db.close();
