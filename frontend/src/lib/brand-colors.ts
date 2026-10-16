import { matchBrand } from "../../../shared/brands.ts";

/**
 * Curated brand signature colors for high-fidelity ambient lighting.
 * Maps recognized brand keys to luminous accent colors.
 */
export const brandColorMap: Record<string, string> = {
  icloud: "#007aff",
  "baidu-netdisk": "#06a7ff",
  openai: "#10a37f",
  claude: "#d97757",
  deepseek: "#4d6bfe",
  gemini: "#4285f4",
  taobao: "#ff5000",
  jd: "#e1251b",
  hema: "#0ea5e9",
  "netease-music": "#d43c33",
  bilibili: "#00aeec",
  xingtu: "#ff2442",
  dmit: "#2563eb",
  yunyoo: "#3b82f6",
  isvoro: "#6366f1",
  netflix: "#e50914",
  spotify: "#1db954",
  youtube: "#ff0000",
  "youtube-music": "#ff0000",
  "apple-music": "#fa243c",
  "apple-tv": "#38bdf8",
  "google-drive": "#1fa463",
  "google-one": "#4285f4",
  dropbox: "#0061ff",
  onedrive: "#0078d4",
  "microsoft-office": "#ea580c",
  notion: "#ffffff",
  adobe: "#ef4444",
  figma: "#f24e1e",
  duolingo: "#58cc02",
  cursor: "#a855f7",
  perplexity: "#06b6d4",
  kimi: "#3b82f6",
  qwen: "#6366f1",
  doubao: "#3b82f6",
  grok: "#e4e4e7",
  midjourney: "#e4e4e7",
  minimax: "#2563eb",
  trae: "#00e599",
  manus: "#ff5722",
  "alibaba-cloud": "#ff6a00",
  "tencent-cloud": "#0052d9",
  playstation: "#003791",
  xbox: "#107c10",
  nintendo: "#e60012",
  nordvpn: "#4687ff",
  surfshark: "#14b8a6",
  steam: "#38bdf8",
  vultr: "#007bfc",
  digitalocean: "#0080ff",
  cloudflare: "#f38020",
  github: "#e4e4e7",
  "github-copilot": "#8b5cf6",
  bitwarden: "#175ddc",
  "1password": "#0572ec",
  "qq-vip": "#12b7f5",
  slack: "#4a154b",
  zoom: "#2d8cff",
  linear: "#5e6ad2",
  tailscale: "#2d3748",
  capcut: "#000000",
};

/**
 * Resolves the signature brand glow color, falling back to subscription color.
 */
export function resolveBrandColor(name: string, fallbackColor?: string): string {
  const brand = matchBrand(name);
  if (brand && brandColorMap[brand.key]) {
    return brandColorMap[brand.key];
  }
  if (fallbackColor && fallbackColor.startsWith("#")) {
    return fallbackColor;
  }
  return "#3b82f6";
}
