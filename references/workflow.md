# 微信公众号发布 — 已验证流程（v3 · playwright-core CDP）

> 全部步骤为 2026-09-29 实测通过版本（appmsgid=100000087）。踩坑与修复见 [troubleshooting.md](troubleshooting.md)。

## 0. 拉起隔离 Chrome（后台保活）

```bash
cd ~/.workbuddy/skills/isolated-browser/scripts && node launch.js "https://mp.weixin.qq.com/" && sleep 7200
```

- 必须 `run_in_background`，并带 `sleep` 保活；否则沙箱在命令结束时回收 detached 子进程，Chrome 立刻被杀。
- 端口默认 9222，profile `~/.chrome_qclaw_stable`（公众号登录态已持久化，通常免扫码）。
- 验证端口就绪：`curl -s http://127.0.0.1:9222/json/version`。

## 1. 一键发布

```bash
export OPENCLAW_NODE_MODULES="<home>/.workbuddy/binaries/node/workspace/node_modules"
node scripts/publish_pw.js --content ./content.json --cdp 9222 --out ./out
```

脚本内固定流程：

| 步骤 | 关键点 |
|---|---|
| 选页面 | 优先复用 `appmsg_edit` 页；否则选公众号页但**排除** `masssendmodify`（别打断用户草稿） |
| 登录检查 | URL 取 `token=(\d+)`；取不到 → 存 `need_login.png` 并退出码 2 |
| 打开编辑器 | `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&token=<token>` |
| 编辑器结构 | `[contenteditable="true"]`：`[0]`=标题(ProseMirror)、`[1]`=转载提示(高 0)、`[2]`=正文(ProseMirror) |
| 填标题 | `el.innerText = title` + `dispatchEvent(new Event('input',{bubbles:true}))` |
| 填正文上半 | `el.innerHTML = partA` + input 事件（不派发 input 字数会显示 0） |
| 插图 | 找 `accept` 含 image 的 `input[type=file]` → `setInputFiles(本地图)` → 轮询取 `img[src*="qpic.cn"]` 的 `outerHTML` |
| 正文重组 | `partA + '<p>'+imgHtml+'</p>' + partB` 一次性写回 innerHTML + input 事件 → 图片落在段落之间 |
| 封面 | `.select-cover__btn.js_cover_btn_area` → `a.js_selectCoverFromContent` → `span.appmsg_content_img.cover` → `button 下一步` → `button 确认` |
| 发表 | `button.mass_send` → 弹窗循环（详见下） |
| 成功判定 | 验证弹窗消失 **且** URL 同时含 `appmsgid=` 与 `reprint_confirm=0`（连续 2 次确认） |

## 2. 发表弹窗链（与旧文档不同，以实际 dump 为准）

1. 点 `button.mass_send` → 弹「**群发通知**」弹窗（文本含"今天没有通知次数"）→ 点主按钮「**发表**」（不是群发通道）
2. → `double_check_dialog`（"内容将展示在公众号主页…"）→ 点「**继续发表**」
3. → 「**微信验证**」弹窗 → 脚本导出 `verify_qr.png` → 管理员微信扫码 → 弹窗自动消失，可能需再点一次「继续发表」
4. 群发通知次数用尽**不影响发布**：走"发表"通道（内容展示在公众号主页，可被推荐）。

> 按钮查找规则：**只在弹窗容器内**（`.weui-desktop-dialog__wrp` / `.double_check_dialog`）按精确文本匹配，取最后一个可见匹配。工具栏上的「发表」同名按钮必须排除。

## 3. 配图选择（可选）

```bash
node scripts/pick_image.js --tags "婚庆用车,婚庆婚车车队" --keyword "婚车租车" --dir "D:/skills/car"
node scripts/pick_image.js --tags "..." --pick 11     # 看图复核后强制指定
```

- `tagScore` = 标签在 `pic-tag.txt` 块内的字面命中数；`themeHits` = 关键词 2-gram 在该块的出现次数。
- 选择顺序：`tagScore` 最高 → 同分比 `themeHits` → `tagScore` 全 0 时取 `themeHits` 最高 → 全 0 时**随机挑一张**。
- **推荐结果必须看图复核**：字面命中可能是通用素材（实测：图14 命中两标签但画面是通用多车型，图11 主题更贴 → 用 `--pick 11`）。

## 4. 排障

```bash
node scripts/probe_editor.js --cdp 9222      # 结构/弹窗/插图数/封面状态 + probe.png
```

改版后先跑 probe，确认选择器是否仍有效，再调整 `publish_pw.js`。

## 5. 结果核实

打开 `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=5&token=<token>`，
发表记录中出现「今天 HH:MM 已发表」+ 文章标题 + 封面缩略图，即为最终成功证据。
