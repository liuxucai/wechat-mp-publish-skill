---
name: wechat-mp-publisher
description: 微信公众号文章自动发布：新建投稿、AI封面、发表全流程
status: draft
version: v1
date: 2026-07-07
---

# 微信公众号发布 Skill

通过 xbrowser（CfT浏览器）完成微信公众号（mp.weixin.qq.com）文章发布的自动化操作。

验证状态：✅ v1 已验证（2026-07-07）

## 文件结构

```
skills/wechat-mp-publisher/
├── SKILL.md               # 本文件
├── scripts/
│   ├── lib.js             # xb CLI 封装库
│   └── publish.js         # 一键发布脚本
└── references/
    └── workflow.md        # 分步操作指南 + 故障排查
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
参考 [references/workflow.md](references/workflow.md)。

## 适用场景

- 将文章发布到公众号（mp.weixin.qq.com）
- 自动设置 AI 配图封面
- 批量发布前的内容填充

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | CfT 浏览器（--browser cft） |
| 控制工具 | xb CLI |
| 脚本语言 | Node.js（封装所有 xb 调用） |

## 核心设计

### 浏览器：使用 CfT 浏览器
- 所有操作通过 xb CLI 操作 CfT 浏览器
- 复用已有浏览器连接，不关闭用户打开的浏览器
- 脚本只检查登录状态，未登录则提示用户手动扫码

### 编辑器结构
- 标题：`contenteditable` 元素（index 0）
- 正文：`contenteditable` 元素（index 2）
- 均用 `innerText` / `innerHTML` + dispatchEvent 写入

### 封面设置：AI配图
通过图片工具栏菜单 → AI配图对话框 → native setter 填充 prompt → 选择图片 → 确认编辑封面

### 发表弹窗处理
- 首次点击"发表"按钮弹出 `double_check_dialog`
- 点击"继续发表"：需 force-show 父容器 + CDP 级别事件（React isTrusted 检查）
- 可能触发"微信验证"弹窗，需用户扫码

## 关键技术点

| 操作 | 正确方式 | 陷阱 |
|------|----------|------|
| 标题填写 | `innerText = 内容` | 不触发事件也能工作 |
| 正文填写 | `innerHTML = html` + dispatch input 事件 | 不触发 input 事件 React 不检测 |
| AI配图 prompt | native setter + input/change/keyup 事件 | React 监听 input 非 change |
| 发表按钮 | MouseEvent 三件套（mousedown/mouseup/click） | 仅 click 可能不够 |
| 继续发表 | 先 force-show 父容器，再 CDP dispatchMouseEvent | 合成事件 isTrusted=false 被忽略 |
| Shell 中文 | temp JS 文件 + UTF-8 base64 | PowerShell GBK 乱码 |

## 依赖

- **xbrowser skill**（必须）— xb CLI 控制浏览器
- **Node.js** — 运行脚本
