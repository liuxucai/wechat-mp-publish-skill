# 微信公众号发布 — 问题与解决方法全表（v3 · 2026-09-29 实测）

> 全部条目来自实际发布过程（婚车租车文章 → appmsgid=100000087）。每条给出：症状 → 原因 → 解决方法（已落到 `scripts/publish_pw.js` / `probe_editor.js`）。

## A. 环境与浏览器

| # | 症状 | 原因 | 解决方法 |
|---|---|---|---|
| A1 | `netstat` 查不到 9230/CDP 端口，脚本连不上 | 用户自带的 Chrome 没开调试端口 | 用 `isolated-browser/scripts/launch.js` 拉**隔离实例**（端口 9222，profile `~/.chrome_qclaw_stable`），不碰用户浏览器 |
| A2 | 隔离 Chrome 启动后几秒就消失 | 沙箱在命令结束时回收 detached 子进程 | 启动命令必须 `run_in_background`，并接 `&& sleep 7200` 保活 |
| A3 | 发布时要求扫码登录 | 无登录态 | profile 已持久化公众号登录态（`token=1522032595`），通常免登；脚本取不到 token 时存 `need_login.png` 并退出码 2，人工扫码后重跑 |
| A4 | 页面里存在多个公众号标签页，选错会覆盖用户在编的草稿 | `ctx.pages()` 里有个 `masssendmodify?action=edit_new` 页 | 选页面优先级：`appmsg_edit` > 其它公众号页，但**排除 `masssendmodify`** |

## B. 交互方式（本轮最大的坑）

| # | 症状 | 原因 | 解决方法 |
|---|---|---|---|
| B1 | 封面菜单、弹窗按钮「点了没反应」 | 合成事件（`el.click()` / `dispatchEvent(new MouseEvent(...))`）在新版编辑器被 React 的 `isTrusted` 检查拒绝 | 一律改用**受信任输入**：`page.mouse.click(元素中心坐标)`（playwright 走真实输入管道） |
| B2 | 点"发表"偶发点到别的按钮 / 命中父容器 | 模糊文本匹配（`includes`）会命中包含该文字的祖先容器 | 精确匹配 `el.innerText.trim() === text`，且在一组可见匹配中取**最后一个**（最内层元素） |
| B3 | 旧文档要求"截图坐标 × 16/9 换算成 DOM 坐标" | 截图缩放与 CSS 视口不一致 | 已废弃换算：直接用 `getBoundingClientRect()` 中心坐标点击，坐标系天然一致 |
| B4 | 用 `el.offsetParent !== null` 判断元素可见失败（浮层判成不可见） | `position: fixed` 的浮层 `offsetParent` 为 `null` | 统一用 `getBoundingClientRect().width/height > 0` 判断可见 |
| B5 | 弹窗按钮点了没反应/点错 | 按钮被父容器 `display:none` 隐藏 | 已废弃"force-show 父容器 + MouseEvent 三件套"：改为坐标点击可见按钮即可（B1） |

## C. 编辑器结构与正文

| # | 症状 | 原因 | 解决方法 |
|---|---|---|---|
| C1 | 不知道哪个 contenteditable 是标题/正文 | 结构随版本变化 | 动态枚举：`[0]`=标题(ProseMirror, h≈30)、`[1]`=转载提示(h=0)、`[2]`=正文(ProseMirror, h≈590)；数量 <3 时正文取 `[1]` |
| C2 | 正文填完"正文字数"显示 0 或不被保存 | React 未感知 DOM 变化 | 写入 `innerHTML`/`innerText` 后必须 `dispatchEvent(new Event('input',{bubbles:true}))` |
| C3 | 图片只能插到正文末尾，无法插到段落之间 | 编辑器上传固定追加到末尾 | **先上传、后重组**：上传后取回 `img.outerHTML`（qpic 图床 URL 已可用），再按 `partA + <p>img</p> + partB` 整体写回 innerHTML |
| C4 | 脚本认为"正文里有 2 张图"，其实只有 1 张 | ProseMirror 内部会插入 `<img class="ProseMirror-separator" alt="">`（src 为空） | 统计真实插图时过滤 `src` 含 `qpic.cn` 的元素 |
| C5 | `setInputFiles` 报错/传错文件 | 页面有多个 `input[type=file]` | 优先选 `accept` 含 `image` 的那个，兜底取第一个 |

## D. 封面

| # | 症状 | 原因 | 解决方法 |
|---|---|---|---|
| D1 | 按旧文档找 `[role="listitem"]`/`a.js_aiImage`，封面流程走不通 | 新版封面菜单结构变了 | 正确入口：`.pop-opr__group.js_cover_null_pop` 菜单里的 `a.js_selectCoverFromContent`（从正文选择）/ `a.js_imagedialog`（图片库）/ `a.js_imageScan`（扫码上传）/ `a.js_aiImage`（AI 配图）。本轮采用**从正文选择本地素材图**，最稳 |
| D2 | 点"从正文选择"点到了提示文案 | 匹配串同时命中 `从正文选择可选视频封面` 提示 | 用 `a.js_selectCoverFromContent` 精确定位 + 文本精确匹配 |
| D3 | "选择图片"弹窗里点不到缩略图 | 缩略图是 `SPAN.appmsg_content_img.cover`（背景图元素），不是 `img` | 按该选择器取中心坐标点击 |
| D4 | 裁剪弹窗点"确认"没生效 | 按钮文本是「确认」（主按钮 `weui-desktop-btn_primary`），不是"完成/确定" | 依次尝试 `确认 → 完成 → 确定`，命中即停 |
| D5 | 按旧文档等"我知道了"教育弹窗，白等几秒 | 本轮该弹窗未出现 | 不写死等待：仅在检测到弹窗时关闭，关闭后重新点封面按钮 |
| D6 | 无法判断封面是否设置成功 | 成功标记不在 `img` 子元素上 | 判据：`.js_cover_preview_new` 的 `backgroundImage` 含 `qpic.cn` |

## E. 发表与验证

| # | 症状 | 原因 | 解决方法 |
|---|---|---|---|
| E1 | 等"AI生成声明"弹窗等不到，流程卡住 | 新版弹窗链不同（走"发表"通道时没有该弹窗） | 不写死单一按钮：循环 dump 可见弹窗，按优先级点 `无需声明并发表 → 无声明并继续发表 → 继续发表 → 发表 → 确定` |
| E2 | 第一次点"发表"后看似无反应 | 实际弹出了「群发通知」弹窗（文本含"今天没有通知次数"） | 在该弹窗里点主按钮「发表」；群发次数用尽不影响发布（走发布到主页的通道，可被推荐） |
| E3 | 精确文本 '发表' 误点工具栏同名按钮 | 工具栏与弹窗都有"发表" | 按钮只在弹窗容器（`.weui-desktop-dialog__wrp` / `.double_check_dialog`）内查找 |
| E4 | **假成功**：脚本报"无需验证"且 URL 已带 `appmsgid=...&reprint_confirm=0`，但页面上还挂着扫码弹窗 | 点"继续发表"后「微信验证」弹窗**延迟数秒**才渲染，立即检测必然漏判 | 点发表后先 `sleep 4000`；成功判定要求 URL 成功态**连续 2 次**（间隔 ≥4s）且无验证弹窗 |
| E5 | 需要管理员扫码，但无法把码给用户 | 二维码在弹窗内 | 页面内用 `canvas.drawImage(img.qrcode.js_qrcode) + toDataURL` 同源导出 `verify_qr.png`；取不到则退回整页截图 |
| E6 | 二维码扫了没反应 | 二维码 ticket 会过期且页面不自动刷新 | 超时后需关闭弹窗重新走发表流程获取新码；`--verify-wait` 控制等待时长（默认 300s） |
| E7 | 扫码完成后仍卡住 | 扫码后还需再触发一次发表 | 验证弹窗消失后补点一次「继续发表」 |
| E8 | 脚本在截图处崩溃，后续步骤全丢 | 页面 busy（等 fonts）时 `page.screenshot` 会 30s 超时抛错 | 截图统一封装：`timeout: 15000` + try/catch，异常只记日志不中断主流程 |
| E9 | 不确定是否真的发出去了 | URL 状态不足以作最终凭据 | 打开发表记录 `appmsgpublish?sub=list` 核对「今天 HH:MM 已发表」+ 标题 + 封面缩略图 |

## F. 配图选择

| # | 症状 | 原因 | 解决方法 |
|---|---|---|---|
| F1 | 按标签字面匹配选出的图与文章主题不符 | 标签库里"通用素材"也可能字面命中该标签 | 双指标 + 看图复核：`tagScore`（字面命中）优先，`themeHits`（关键词主题词）做参考；不符时 `--pick N` 指定。实测：婚车租车标签下图14 字面命中 2 个标签（通用多车型素材），图11 字面命中 0 但主题词最高（宾利婚车/鲜花装饰/爱心气球），最终选图11 |
| F2 | 文章配图落在正文末尾而非段落之间 | 编辑器上传固定追加到末尾 | 用 `body_partA` / `body_partB` 拆分正文，发布脚本先上传取 img HTML，再把两段与图片重组成完整 HTML 写回（见 C3） |
| F3 | 传入的标签不在 tag.txt 中 | 标签拼写或选错库 | `pick_image.js` 会打印 `WARN: 标签不在 tag.txt 中 —— xxx`，按提示回到 tag.txt 校正 |

## G. 已删除的失效做法（勿再使用）

| 做法 | 出处（已删除文件） | 删除原因 |
|---|---|---|
| xb CLI 驱动浏览器 | v1 SKILL.md 叙述 | 有安全锁、shell 中文编码问题，已被隔离实例 + CDP 取代 |
| Node `ws` 直连 + 合成事件派发（`aiCoverFlow`/`clickPublishBtn`/`handlePublishConfirm` 等） | `scripts/lib.js`、`scripts/publish.js` | 新版编辑器拒绝合成事件，封面与弹窗全部点不动 |
| "force-show 父容器"绕过按钮隐藏 | 同上 | 不解决 `isTrusted` 问题，已被坐标点击取代 |
| 硬编码默认正文（SEO 流量那篇） | `scripts/publish.js` | 与真实业务无关，改为 `content.example.json` 模板 + `--content` 传入 |
| 以 AI 配图作为唯一封面路径 | v2 SKILL.md | 未在新版验证且不稳；改用「从正文选择」本地素材图。AI 配图入口仍存在于菜单（`a.js_aiImage`），如需再启用请先实测 |
| 引用不存在的 `launch_chrome.cjs`、`publish_wx_v3.cjs` | v2 SKILL.md「参考文件」 | 文件不存在，改为指向 `isolated-browser/scripts/launch.js` |
