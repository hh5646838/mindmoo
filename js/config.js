/* ============================================================
 * config.js —— 内置默认配置 + config.json 热加载
 * 优先级：config.json（若可加载）> 此处内置默认值
 * 说明：
 *   · 通过本地 HTTP 服务打开时：修改同目录 config.json 即可热生效；
 *   · 直接 file:// 双击打开时：浏览器禁止 fetch，config.json 不会被读取，
 *     此时想自定义配色/链接请直接修改本文件下方的
 *     themes（渐变配色）、homepageUrl、followUrl、appTitle 等字段。
 * ============================================================ */
window.APP_CONFIG = {
  appTitle: "无限脑图",
  appSubtitle: "3 级下钻视区 · Mermaid Mindmap",
  homepageUrl: "https://www.doubao.com",
  homepageText: "工具主页",
  followUrl: "https://www.doubao.com",
  followText: "关注我",
  avatarUrl: "",
  defaultDark: true,
  defaultTheme: "aurora",
  defaultShape: "default",
  maxDepth: 3,
  themes: [
    { id: "aurora", name: "极光霓虹", colors: [["#7f00ff", "#e100ff"], ["#00dbde", "#fc00ff"], ["#00c6ff", "#0072ff"]] },
    { id: "ocean",  name: "深海幽蓝", colors: [["#0f2027", "#2c5364"], ["#00b4db", "#0083b0"], ["#2193b0", "#6dd5ed"]] },
    { id: "flame",  name: "烈焰橙红", colors: [["#f12711", "#f5af19"], ["#eb3349", "#f45c43"], ["#ff9966", "#ff5e62"]] },
    { id: "forest", name: "翡翠森林", colors: [["#134e5e", "#71b280"], ["#56ab2f", "#a8e063"], ["#11998e", "#38ef7d"]] },
    { id: "candy",  name: "马卡龙甜", colors: [["#f77062", "#fe5196"], ["#c471f5", "#fa71cd"], ["#43e97b", "#38f9d7"]] },
    { id: "cyber",  name: "赛博脉冲", colors: [["#00f5a0", "#00d9f5"], ["#f83600", "#f9d423"], ["#9d4edd", "#3c096c"]] },
    { id: "purple", name: "暗夜紫钻", colors: [["#41295a", "#2f0743"], ["#8e2de2", "#4a00e0"], ["#c31432", "#240b36"]] },
    { id: "mono",   name: "银灰极简", colors: [["#3a3d40", "#8e8e93"], ["#4b5563", "#9ca3af"], ["#6b7280", "#d1d5db"]] }
  ],
  shapes: [
    { id: "default", name: "默认（圆角矩形）", open: "", close: "" },
    { id: "rounded", name: "圆角 ( )", open: "(", close: ")" },
    { id: "circle",  name: "圆形 (( ))", open: "((", close: "))" },
    { id: "square",  name: "方形 [ ]", open: "[", close: "]" },
    { id: "hexagon", name: "六边形 {{ }}", open: "{{", close: "}}" },
    { id: "cloud",   name: "云朵 ) (", open: ")", close: "(" },
    { id: "bang",    name: "爆炸 )) ((", open: "))", close: "((" }
  ]
};

window.__CONFIG_LOADED__ = false;
window.__CONFIG_FILE_ERROR__ = false;

/* 尝试加载同目录 config.json（本地 HTTP 服务下生效） */
async function loadAppConfig() {
  try {
    const r = await fetch("config.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    Object.assign(window.APP_CONFIG, j);
    window.__CONFIG_LOADED__ = true;
  } catch (e) {
    window.__CONFIG_FILE_ERROR__ = true;
    console.warn("[config] config.json 加载失败，使用内置默认配置（file:// 直开时属正常现象）", e);
  }
}
