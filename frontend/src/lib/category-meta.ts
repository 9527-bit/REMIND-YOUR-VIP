import {
  BriefcaseBusiness,
  Cloud,
  Coffee,
  Gamepad2,
  GraduationCap,
  LayoutGrid,
  Music2,
  Palette,
  ShoppingBag,
  Sparkles,
  Globe,
  type LucideIcon,
} from "lucide-react";

export const categoryIcons: Record<string, LucideIcon> = {
  "影音娱乐": Music2,
  "购物电商": ShoppingBag,
  "AI 工具": Sparkles,
  "云存储": Cloud,
  "办公效率": BriefcaseBusiness,
  "设计与创作": Palette,
  "云服务与网络": Globe,
  "生活服务": Coffee,
  "游戏会员": Gamepad2,
  "学习教育": GraduationCap,
  "其他服务": LayoutGrid,
};

export const categoryColors: Record<string, { bg: string; stroke: string; glow: string }> = {
  "AI 工具": { bg: "#8b5cf6", stroke: "#a78bfa", glow: "rgba(139, 92, 246, 0.45)" },
  "影音娱乐": { bg: "#f43f5e", stroke: "#fb7185", glow: "rgba(244, 63, 94, 0.45)" },
  "云存储": { bg: "#06b6d4", stroke: "#22d3ee", glow: "rgba(6, 182, 212, 0.45)" },
  "云服务与网络": { bg: "#3b82f6", stroke: "#60a5fa", glow: "rgba(59, 130, 246, 0.45)" },
  "办公效率": { bg: "#f59e0b", stroke: "#fbbf24", glow: "rgba(245, 158, 11, 0.45)" },
  "设计与创作": { bg: "#ec4899", stroke: "#f472b6", glow: "rgba(236, 72, 153, 0.45)" },
  "购物电商": { bg: "#10b981", stroke: "#34d399", glow: "rgba(16, 185, 129, 0.45)" },
  "游戏会员": { bg: "#14b8a6", stroke: "#2dd4bf", glow: "rgba(20, 184, 166, 0.45)" },
  "学习教育": { bg: "#6366f1", stroke: "#818cf8", glow: "rgba(99, 102, 241, 0.45)" },
  "生活服务": { bg: "#84cc16", stroke: "#a3e635", glow: "rgba(132, 204, 22, 0.45)" },
  "其他服务": { bg: "#71717a", stroke: "#a1a1aa", glow: "rgba(113, 113, 122, 0.35)" },
};
