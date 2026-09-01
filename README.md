# 🧠 无限脑图 · 3级下钻视区

基于 **Mermaid.js mindmap** 的「无限脑图」单页应用：全局保存完整树，渲染时只取以当前节点为根的 **3 层视区**，点击「仍有子节点」的第 3 层节点即可下钻，配合 **CSS View Transitions API** 实现"点击节点放大到中心成为新根"的无限延伸感。

## 运行方式

**方式一（推荐，本地服务器，config.json 可热加载）：**
```bash
cd 无限脑图
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

**方式二：直接双击 `index.html`（file:// 直开）**
- 功能完全可用；仅 `config.json` 因浏览器 file:// 限制无法 fetch，会回退到 `js/config.js` 中的内置默认配置（界面会提示）。
- 依赖已全部本地化（`lib/`），无需联网。

## 目录结构

```
无限脑图/
├── index.html            # 入口
├── config.json           # ★ 可编辑配置：主页链接 / 头像 / 主题 / 形状 / 标题
├── css/style.css         # 全部样式（渐变发光 / View Transitions / 深浅色）
├── js/
│   ├── config.js         # 内置默认配置 + config.json 加载
│   ├── parser.js         # 缩进树解析 / 3层截取 / Mermaid 转换 / 搜索
│   └── app.js            # 渲染管线 / 视图过渡 / 面包屑 / 微缩地图 / 导入导出
├── lib/                  # 本地依赖（mermaid 10.9.1 + CodeMirror 5.65.16）
└── data/example.mmd      # 示例数据
```

## 核心机制

- **数据流**：左侧编辑器源码 → 300ms 防抖 → 全局 JSON 树 → 按 `currentFocusId` 截取 3 层 → 转 Mermaid mindmap → View Transitions → 画布。
- **3 层视区**：`根 → 一级 → 二级` 共 3 层；第 3 层节点在全局仍有子节点时注入 `.has-more-glowing` 发光呼吸动画，点击即可下钻。
- **无限延伸动画**：`document.startViewTransition()` 包裹渲染；点击的节点（旧视图）与新视图中的同一逻辑节点共享 `vt-target`，浏览器自动把旧节点平移到中心并放大为新根，其余部分淡入淡出。
- **防错机制**：`mermaid.initialize({ mindmap: { htmlLabels: false } })` + 显式 CSS `opacity:1 !important; display:inline-block !important`，杜绝 foreignObject 尺寸为 0 导致的"节点消失只剩连线"。
- **连线外观**：后处理注入主题色锥形线宽（root 14px / 一级 8px / 二级 4.5px，圆角折点），并随当前主题变化色相，比 Mermaid 原生 14/11 的层级差异更明显。
- **长节点自动换行**：parser 按 CJK/ASCII 显示宽度自动拆行（root 约 9 汉字 / 一级约 7 汉字 / 二级约 6 汉字），避免单个节点把整体布局撑宽。
- **反向定位**：画布点击任意节点 → 编辑器自动展开并滚动高亮源码对应行。
- **微缩地图**：右下角实时标出当前 3 级视区在全局树中的位置（亮色区域 + 高亮路径 + 焦点外圈）。
- **导航**：面包屑 `O → … → joint5 → joint10 → $`（最多 6 个、根/上级/当前必显、超长中间等分取 3 个并显示省略号）；左侧 `←` 上一级；全局搜索回车平滑跳转，无结果提示"未找到该节点"。

## 交互一览

| 操作 | 效果 |
|---|---|
| `Ctrl + /` 或左上 `^` | 呼出 / 收回左侧编辑器 |
| 点击泛光节点 | 下钻（成为新伪根，放大到中心） |
| 点击当前根节点 | 上钻一级 |
| 面包屑 / `←` / `⚛️` | 跳到指定祖先 / 上一级 / 回根 |
| 全局搜索 + 回车 | 跳转到目标节点 |
| `🌈` / `🔷` / `🌙☀️` | 渐变主题 / 节点形状 / 深浅色 |
| `🎞️` | 导入 .md/.mmd、导出 .md/.mmd/**图片.png**、复制 Mermaid |
| `？` | 帮助与快捷键 |

## 编辑 config.json

```jsonc
{
  "appTitle": "无限脑图",          // 顶部标题
  "homepageUrl": "https://...",   // ★ 工具主页链接
  "avatarUrl": "https://...",     // ★ 头像图片地址（留空则显示"关"字圆形占位）
  "followUrl": "https://...",     // ★ 头像点击跳转（关注我）
  "defaultTheme": "candy",       // 默认渐变主题（内置：极光霓虹 / 深海幽蓝 / 烈焰橙红 / 翠绿森林 / 胭脂蜜桃 / 香芋奶紫 / 马卡龙甜 / 赛博脉冲 / 暗夜紫钻 / 银灰极简）
  "defaultShape": "default",      // 默认节点形状（内置：默认细长矩形 / 圆角 / 圆形 / 矩形 / 六边形 / 三角形 / 云朵 / 爆炸）
  "maxDepth": 3,                  // 视区层数
  // 渐变主题：每主题 3 组渐变色（对应 根/一级/二级）。
  // 加 "byBranch: true" 后切换为「整条分支共用一个纯色」：colors[0] 是根，
  // 之后依次是第 1、2、3… 条分支的纯色（pair 两端取同色值 → 块内无渐变），
  // 分支数超过配色数时循环取用。银灰极简 即用此模式实现"不同分支有不同深度的灰"。
  "themes": [ ... ],
  "shapes": [ ... ]               // 节点形状：open/close 为 Mermaid mindmap 形状标记
}
```

> 提示：`file://` 直开时修改 config.json 不生效（浏览器限制），请使用本地服务器方式。
