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
  defaultTheme: "candy",
  defaultShape: "default",
  maxDepth: 3,
  themes: [
    { id: "aurora", name: "极光霓虹", colors: [["#7f00ff", "#e100ff"], ["#00dbde", "#fc00ff"], ["#00c6ff", "#0072ff"]] },
    { id: "ocean",  name: "深海幽蓝", colors: [["#0f2027", "#2c5364"], ["#00b4db", "#0083b0"], ["#2193b0", "#6dd5ed"]] },
    { id: "flame",  name: "烈焰橙红", colors: [["#f12711", "#f5af19"], ["#eb3349", "#f45c43"], ["#ff9966", "#ff5e62"]] },
    { id: "forest", name: "翠绿森林", colors: [["#134e5e", "#71b280"], ["#56ab2f", "#a8e063"], ["#11998e", "#38ef7d"]] },
    { id: "peach",  name: "胭脂蜜桃", colors: [["#b03a68", "#e87598"], ["#d1643f", "#f2a67e"], ["#c98a3f", "#f3c98a"]] },
    { id: "taro",   name: "香芋奶紫", colors: [["#5f4b96", "#9c85d0"], ["#7d63b8", "#bda8e6"], ["#a06aae", "#d9aed6"]] },
    { id: "candy",  name: "马卡龙甜", colors: [["#f77062", "#fe5196"], ["#c471f5", "#fa71cd"], ["#43e97b", "#38f9d7"]] },
    { id: "cyber",  name: "赛博脉冲", colors: [["#020617", "#00e5ff"], ["#1a0518", "#ff00a0"], ["#0a1a05", "#ccff00"]] },
    { id: "purple", name: "暗夜紫钻", colors: [["#1e1b4b", "#4f46e5"], ["#4a1d96", "#a855f7"], ["#701a75", "#e879f9"]] },
    /* byBranch：整条分支共用一个纯色，块内不做渐变（分支数多于配色数时循环取用）。
     * colors[0] 是根节点，之后依次是第 1、2、3… 条分支。
     * 灰阶按 CIELAB L* 拉开（约 5→13→22→33→44→55），相邻分支有明显可分辨的灰度差，
     * 避免在深色背景下糊成同一个灰。
     * 文字强制白色，最浅一档 ~#7d8793（contrast ≈4:1）可读。 */
    { id: "mono",   name: "银灰极简", byBranch: true, colors: [
      ["#0b0d10", "#0b0d10"],
      ["#1c2128", "#1c2128"],
      ["#30373f", "#30373f"],
      ["#4a5561", "#4a5561"],
      ["#626c78", "#626c78"],
      ["#7d8793", "#7d8793"],
      ["#3d4651", "#3d4651"]
    ]}
  ],
  /* 节点形状。
   *   open / close：喂给 Mermaid 的语法标记，决定 Mermaid 的布局占位。
   *   geom        ：供 app.js 后处理重绘真实几何。Mermaid 原生形状普遍偏大偏圆
   *                 （如圆形直径取文字对角线 + padding，高度是矩形的 2.4 倍，
   *                 实测同级节点间距会出现负值＝真正重叠），因此需要按文字尺寸
   *                 重绘为更克制、横向更舒展的形状。
   *   注意：id 保持稳定，localStorage 里的形状偏好是按 id 记的，改名会丢失偏好。 */
  shapes: [
    { id: "default",  name: "默认（细长矩形）", open: "", close: "", geom: { kind: "rect", padX: 13, padY: 6, radius: 4 } },
    { id: "rounded",  name: "圆角 ( )", open: "(", close: ")", geom: { kind: "rect", padX: 15, padY: 9, radius: 10 } },
    { id: "circle",   name: "圆形 (( ))", open: "((", close: "))", geom: { kind: "ellipse", padRX: 11, padRY: 12, flat: 0.6 } },
    { id: "square",   name: "矩形 [ ]", open: "[", close: "]", geom: { kind: "rect", padX: 16, padY: 8, radius: 0 } },
    { id: "hexagon",  name: "六边形 {{ }}", open: "{{", close: "}}", geom: { kind: "hexagon", padX: 17, padY: 9, cut: 13 } },
    { id: "triangle", name: "三角形 △", open: "{{", close: "}}", geom: { kind: "triangle" } },
    { id: "cloud",    name: "云朵 ) (", open: ")", close: "(", geom: { kind: "cloud", padY: 15 } },
    /* 爆炸形保留 Mermaid 原生 path（形状本身就是装饰性的，重绘收益不大） */
    { id: "bang",     name: "爆炸 )) ((", open: "))", close: "((", geom: null }
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
