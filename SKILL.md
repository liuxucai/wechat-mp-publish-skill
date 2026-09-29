---
name: wechat-mp-publisher
description: 微信公众号图文发布（playwright-core 直连 CDP）：新建图文、正文插图插入段落之间、从正文选封面、发表+管理员扫码验证全流程。触发词：公众号发布、发文章到公众号、微信公众号、mp.weixin.qq.com。
status: verified
version: v3.0.0
date: 2026-09-29
---

# 微信公众号发布 Skill（v3 · playwright-core CDP 直连）

对 `mp.weixin.qq.com` 完成 **新建图文 → 填标题正文 → 正文插图（插入段落之间）→ 设置封面 → 发表 → 扫码验证** 的全自动流程。

- v1：xb CLI（已废弃删除）
- v2：Node `ws` 直连 CDP + **合成事件派发**（`el.click()` / `dispatchEvent(MouseEvent)`）—— **新版编辑器下失效，已删除**
- **v3（当前）**：playwright-core 直连 CDP，所有交互改用**受信任输入**（`page.mouse.click(元素中心坐标)`），实测跑通（2026-09-29，appmsgid=100000087，含正文插图 + 封面 + 发表 + 扫码验证）

## 文件结构

```
wechat-mp-publish-skill/
├── SKILL.md                     # 本文件
├── VERSION
├── content.example.json         # 内容模板（改字段即可复用）
├── scripts/
│   ├── publish_pw.js            # ★ 一键发布（登录检查→填空→插图→封面→发表→验证）
│   ├── probe_editor.js          # 编辑器诊断（结构/插图数/弹窗/封面状态，排障第一步）
│   └── pick_image.js            # 按标签从素材库匹配配图（读 tag.txt / pic-tag.txt）
└── references/
    ├── workflow.md              # 已验证操作流程（精炼版）
    └── troubleshooting.md       # ★ 问题 → 解决方法全表（踩坑必读）
```

## 依赖（发布过程的实际依赖）

| 依赖 | 位置 / 说明 |
|---|---|
| Node.js | 本机托管版 `~/.workbuddy/binaries/node/versions/22.22.2-3/node.exe` |
| playwright-core | `~/.workbuddy/binaries/node/workspace/node_modules`，运行前设 `OPENCLAW_NODE_MODULES` 指向该目录 |
| 隔离 Chrome | `isolated-browser` skill 的 `scripts/launch.js`，profile `~/.chrome_qclaw_stable`（公众号登录态已持久化） |
| 素材库 | `D:\skills\car\`（`tag.txt` 文章标签库、`pic-tag.txt` 图片标签库、`*.jpg` 图片） |

## 使用

### 1. 后台拉起隔离 Chrome（必须 run_in_background + sleep 保活）

```bash
cd ~/.workbuddy/skills/isolated-browser/scripts && node launch.js "https://mp.weixin.qq.com/" && sleep 7200
```

沙箱会在命令结束时回收 detached 子进程，因此**必须**后台常驻，否则 Chrome 秒被杀。

### 2. 一键发布

```bash
export OPENCLAW_NODE_MODULES="<home>/.workbuddy/binaries/node/workspace/node_modules"
node scripts/publish_pw.js --content ./content.json --cdp 9222 --out ./out
```

参数：`--no-cover`（跳过封面）、`--dry-run`（填完内容即停，不点发表）、`--verify-wait 300`（扫码等待秒数）。

首次使用或编辑器改版后先诊断：

```bash
node scripts/probe_editor.js --cdp 9222
```

### 3. 配图选择（可选）

```bash
node scripts/pick_image.js --tags "婚庆用车,婚庆婚车车队" --keyword "婚车租车" --dir "D:/skills/car"
node scripts/pick_image.js --tags "..." --pick 11        # 复核后强制指定图片编号
```

输出两个指标：`tagScore`（标签字面命中数）与 `themeHits`（关键词主题词出现次数）。默认取 `tagScore` 最高，其次比 `themeHits`；**两者都为零 → 随机挑一张**（符合"都不匹配则随机"的要求）。

⚠️ **必须看图复核**：字面命中的候选可能是通用素材。2026-09-29 实测中，图14 字面命中两个标签（一站式租车服务），但图11（宾利婚车/鲜花装饰/爱心气球 的婚嫁专属婚车车队）主题更贴 —— 最终用 `--pick 11` 选定图11。**文章配图也务必插入正文段落之间**（发布脚本已实现）。

## 核心原则

1. **只用受信任输入**：`page.mouse.click(rect中心)`；合成事件在新版编辑器一律失效。
2. **按钮按精确文本匹配**，一组可见匹配中取**最后一个**（最内层元素），否则会命中父容器（如 '发表' 命中含 '继续发表' 的容器）。
3. **弹窗按钮只在弹窗容器内找**（`.weui-desktop-dialog__wrp` / `.double_check_dialog`），避免误点工具栏同名按钮。
4. **正文插图靠"先上传、后重组"**：编辑器上传只会把图追加到正文末尾，需取出上传结果的 `img` HTML，再与前后半段正文拼成完整 HTML 一次性写回，图片才会落在段落之间。
5. **封面走"从正文选择"**，用本地素材图直接做封面（无需 AI 配图）。
6. **成功判定**：验证弹窗消失 + URL 同时含 `appmsgid=` 与 `reprint_confirm=0`。只看 URL 会误判（URL 先变、验证弹窗后弹）。

## 相关文档

- 已验证步骤 → [references/workflow.md](references/workflow.md)
- 全部踩坑与修复 → [references/troubleshooting.md](references/troubleshooting.md)
