---
name: wechat-mp-publisher
description: 微信公众号文章自动发布：新建投稿、AI封面、发表全流程
status: production
version: v2
date: 2026-07-17
---

# 微信公众号发布 Skill

通过 isolated-browser 拉起的隔离 Chrome（CDP 直连）完成微信公众号（mp.weixin.qq.com）文章发布的自动化操作。

验证状态：✅ 封面/发表流程已实战跑通（2026-07-17）；最终「微信验证」需人工扫码。

## 文件结构

```
skills/wechat-mp-publisher/
├── SKILL.md               # 本文件
├── scripts/
│   ├── lib.js             # CDP WebSocket 封装库（直连 Chrome，含全部正确流程）
│   ├── launch_chrome.cjs  # 隔离 Chrome 启动器（回退用，CDP 端口 9230）
│   └── publish.js         # 一键发布脚本
└── references/
    ├── workflow.md          # 分步操作指南（实测可用流程）
    └── troubleshooting.md   # 全流程问题与解决方法（实战记录，含失效方案警示）
```

## 使用

### 一键发布
```bash
node skills/wechat-mp-publisher/scripts/publish.js
```
脚本自动完成：导航编辑器 → 填标题 → 填正文 → AI配图封面 → 发表。

遇到微信验证弹窗时，脚本会自动暂停等待扫码，扫码后按回车继续。

### 自定义内容环境变量
```powershell
$env:WX_TITLE="你的标题"
$env:WX_BODY="<p>正文HTML</p>"
$env:WX_AI_PROMPT="AI配图描述"
node skills/wechat-mp-publisher/scripts/publish.js
```

### 分步手动操作
参考 [references/workflow.md](references/workflow.md)（实测可用的分步流程）。
踩坑与排错汇总见 [references/troubleshooting.md](references/troubleshooting.md)。

## 适用场景

- 将文章发布到公众号（mp.weixin.qq.com）
- 自动设置 AI 配图封面
- 批量发布前的内容填充

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | isolated-browser 隔离 Chrome（CDP 直连，默认 9222） |
| 控制工具 | CDP（Chrome DevTools Protocol），通过 ws 直连 |
| 脚本语言 | Node.js（封装所有 CDP 调用，依赖 ws） |

## 核心设计

### 浏览器：使用 isolated-browser 隔离 Chrome
- 优先通过 isolated-browser 启动独立 Chrome（固定 profile `~/.chrome_qclaw_stable`，CDP 端口默认 9222）
- 脚本经 CDP 驱动真实点击，复用登录态
- 仅检查登录状态，未登录则提示用户手动扫码

### 编辑器结构
- 标题：`contenteditable` 元素（index 0）
- 正文：`contenteditable` 元素（index 2）
- 用 `innerText`/`innerHTML` 注入 + 派发 `input` 事件（更新 React 状态，非点击）

### 封面设置：AI配图（2026-07-17 实测走通路径，分辨率 1440×900）

⚠️ **核心原则：所有元素必须动态探测，禁止写死坐标。** 微信后台会改版，任何硬编码坐标都会失效（已验证：918,453 / 827,558 / 1013,825 / 1312,920 全错）。

正确流程（详见 workflow.md）：
1. **封面入口**：点 `.js_cover_btn_area`（无论封面已设/未设，这是唯一稳定入口；旧 `.js_chooseCoverWrap`/替换图标 (918,453) 已不存在）。读其 `getBoundingClientRect()` 中心坐标点开菜单。
2. **AI配图菜单项**：扫描菜单里文字含「AI配图」的叶子节点，取其坐标 CDP 点击（菜单项未被遮挡，坐标点击有效）。
3. **AI 对话框两种形态**：
   - A. 历史图片列表：每张图下方「使用」按钮 `.ai-image-op-btn` **被 IMG 覆盖层挡住**，CDP 坐标点击失效 → 必须用 **DOM `el.click()`**（trusted 事件绕过覆盖层）。
   - B. 生成新图：填 `#ai-image-prompt`（⚠️ 是 `<textarea>`，必须用 `HTMLTextAreaElement.prototype` 的 value setter，否则 prompt 留空）→ 点 `.send-btn` → 轮询 `img[src*="myqcloud"]` 数量增加确认生成 → 再取**新图 src 对应**的「使用」按钮（避免误用历史旧图）。
4. **编辑封面裁剪确认**：弹窗是 `.weui-desktop-dialog`，确认按钮 = `.weui-desktop-dialog__ft .weui-desktop-btn_primary`（文字「确认」）。⚠️ AI配图对话框 `.ai_image_dialog` 常残留遮挡此确认按钮，故必须用 **DOM `el.click()`**（trusted，不受遮挡），重试 4 次 + 坐标兜底 (682,787)。**禁用 CDP 坐标点确认**（会被遮挡拦截）。

**关键陷阱（已踩坑，详见 troubleshooting.md）**：
- 对话框可见性判定**不能用 `getBoundingClientRect().height`**（transform/滚动会返回 0）→ 改用 `offsetParent!==null && display!=='none' && visibility!=='hidden'`。
- 作者/标题等 **React 受控组件**：填值必须用 `HTMLTextAreaElement/HTMLInputElement.prototype` 的 value setter + 派发 `input` 事件；`el.value=...` 或 `dispatchEvent(MouseEvent)` 一律无效（React 不吃合成事件）。
- 封面生效校验：微信封面图写在 `.js_splice-cover` 的 **`background-image`**（非 `<img>`）。

### 发表弹窗处理（弹窗链顺序）
1. 点底部「发表」（`button.mass_send`，CDP/DOM click，坐标约 1115,592）。
2. 若弹「原创声明」弹窗（正文≥300字）：填作者（value setter）→ 勾选协议 → 点「确定」→ 需再点一次底部「发表」。
3. 弹「编辑封面」裁剪确认框（若前面没确认）→ 点「确认」（DOM click）。
4. 弹「发表」确认弹窗 → 点「发表」（green primary）。
5. 弹「群发通知」模态 → 点「继续发表」。
6. 弹「微信验证」二维码 → **人工扫码 + 管理员验证**（脚本无法绕过，只能提示并轮询）。
- 实现上 `handlePublishConfirm` 用循环处理「发表→继续发表→发表」嵌套弹窗，直到 URL 出现 `appmsgid`。

## 关键技术点（正确方式 vs 失效方式）

| 操作 | ✅ 正确方式 | ❌ 行不通（已弃用） |
|------|----------|----------|
| 标题/正文填写 | `innerText/innerHTML` + 派发 `input` 事件 | 不派发事件 → React 不检测 |
| 作者等 React 受控输入 | `HTML*Element.prototype` value setter + `input` 事件 | `el.value=...` 静默失败 |
| 任何点击 | 不依赖合成事件 | `dispatchEvent(MouseEvent)` 被 React 忽略 |
| 封面入口 | 动态读 `.js_cover_btn_area` 中心 | 写死 (918,453)/(827,464) |
| AI配图菜单项 | 扫描文字含「AI配图」的叶子节点取坐标 CDP 点击 | 写死 (964,628) |
| 历史图「使用」 | **DOM `el.click()`**（绕过 IMG 覆盖） | CDP 坐标点击命中 IMG 覆盖层 |
| 新图「使用」 | 按新图 src 向上 8 层精确匹配 | 按列表顺序取 → 误用历史旧图 |
| 编辑封面确认 | **DOM `el.click()`** `.weui-desktop-dialog__ft .weui-desktop-btn_primary` | CDP 坐标 (1013,825) 被遮挡拦截 |
| 对话框可见性 | `offsetParent!==null && display/visibility` | `getBoundingClientRect().height>0`（常误判） |
| 底部发表 | DOM click `button.mass_send` | 写死 (1312,920) |
| 微信验证 | 人工扫码 + 轮询 | 脚本无法绕过 |

## 依赖

- **isolated-browser skill**（推荐）— 拉起隔离 Chrome 并暴露 CDP 端口（默认 9222）；本技能通过 CDP 直连
- **Node.js + ws** — 运行脚本
