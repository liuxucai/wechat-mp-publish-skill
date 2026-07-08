---
name: wechat-mp-publisher
description: 微信公众号文章自动发布：新建投稿、AI封面、发表全流程
status: draft
version: v2
date: 2026-07-08
---

# 微信公众号发布 Skill

通过 **CDP (Chrome DevTools Protocol) 直连** 完成微信公众号文章发布。

v2 重大升级：从 xb CLI 迁移到 CDP WebSocket 直连，彻底解决 shell 编码问题和 React isTrusted 限制。

验证状态：✅ v1 已验证（2026-07-07 xb CLI 流程）  
✅ v2 已验证（2026-07-08 CDP 直连，appmsgid=100000019，含 AI 配图 + 发表）

## 文件结构

```
skills/wechat-mp-publisher/
├── SKILL.md               # 本文件
├── scripts/
│   ├── lib.js             # CDP 封装库（ws 直连 Chrome）
│   └── publish.js         # 一键发布脚本
└── references/
    └── workflow.md        # 分步操作指南 + 故障排查
```

## 使用

### 1. 启动 Chrome（首次需扫码登录）

```bash
node skill_references/launch_chrome.cjs 9230
```

浏览器使用 `%USERPROFILE%\.chrome_qclaw_stable` 作为用户目录（持久化登录态）。

### 2. 一键发布

```bash
node skills/wechat-mp-publisher/scripts/publish.js
```

脚本自动完成：导航编辑部 → 填标题 → 填正文 → AI配图 → 发表 → 处理验证弹窗。

### 3. 自定义内容

```bash
$env:WX_TITLE="你的标题"
$env:WX_BODY="<p>HTML正文</p>"
$env:WX_AI_PROMPT="AI配图描述"
node skills/wechat-mp-publisher/scripts/publish.js
```

## 适用场景

- 将文章发布到公众号（mp.weixin.qq.com）
- 自动设置 AI 配图封面
- 批量发布前的内容填充

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | Google Chrome（v144+ 含 CDP 支持） |
| 控制方式 | Node.js ws 模块直连 CDP WebSocket |
| 运行时 | Node.js |

## 核心架构

### 浏览器启动

```
launch_chrome.cjs → Chrome(port=9230, profile=.chrome_qclaw_stable)
     ↓
Node.js publish.js → ws://127.0.0.1:9230/devtools/... → CDP 命令
```

### 编辑器结构

- **标题**：`contenteditable` 元素 index 0 → `innerText` 写入
- **正文**：`contenteditable` 元素 index 2 → `innerHTML` + dispatch `input`
- **封面按钮**：`[role="listitem"]` → 鼠标事件展开 → `a.js_aiImage` 点 AI配图
- **AI配图弹窗**：`#ai-image-prompt` native setter → 带 SVG 的发送按钮 → 等待 `img[src*="myqcloud.com"]`
- **"使用"按钮**：DIV 元素（不是 BUTTON），`innerText === '使用'` 匹配
- **"确认"按钮**：A 标签（不是 BUTTON），`innerText === '确认'` 匹配

### 发表弹窗

- `double_check_dialog` 弹窗 → force-show `继续发表` 按钮父容器 → MouseEvent 序列
- 微信验证弹窗 → 提示用户扫码 → 脚本等待扫码完成 → 再点"继续发表"

## 关键技术点

| 操作 | 正确方式 | 陷阱 |
|------|----------|------|
| Chrome 启动 | `--remote-debugging-port=9230 --user-data-dir=%USERPROFILE%\.chrome_qclaw_stable` | 中文路径在 PS 中需引号 |
| CDP 连接 | `ws://127.0.0.1:9230/devtools/page/{id}` | 端口可能被占用，换 9231/9232 |
| 标题填写 | `contenteditable[0].innerText = 标题` | 不需要额外事件也能保存 |
| 正文填写 | `contenteditable[2].innerHTML = html` + dispatch input | 不触发 input React 不检测 |
| AI prompt | native setter + input/change/keyup 事件 | 只用 `input.value = x` React 不会更新 |
| "使用"按钮 | 找 `innerText === '使用'` 的 **DIV** | 不是 button，用 tag 名匹配会漏 |
| "确认"按钮 | 找 `innerText === '确认'` 的 **A** 标签 | 同样是 DIV/A 不是 button |
| 发表按钮 | button innerText "发表" + MouseEvent 三件套 | 需用 MouseEvent 构造器加 buttons/cancelable |
| 继续发表 | force-show 父容器（display/visibility/opacity）+ 滚动 + MouseEvent 三件套 | React 的 isTrusted 检查拒绝合成事件 |
| CDP 调用 | pending 对象跟踪请求（ws.on message + ID 匹配） | ws.on+ws.off 组合不可靠 |
| Shell 中文 | Node.js 脚本直接处理，避免 PS 命令行引号转义问题 | |

## CDP 调用关键模式

```js
function cdpCall(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    const handler = (d) => {
      try {
        const r = JSON.parse(d.toString());
        if (r.id === id) {
          ws.removeListener('message', handler);
          if (r.error) reject(JSON.stringify(r.error));
          else resolve(r.result);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); reject('Timeout'); }, 30000);
  });
}
```

## 依赖

- **Node.js** — 运行脚本
- **ws** (内置 Node.js 模块) — CDP WebSocket 连接

## 参考文件

- `launch_chrome.cjs` — 工作目录下的 Chrome 启动脚本
- `publish_wx_v3.cjs` — 验证通过的完整发布脚本
