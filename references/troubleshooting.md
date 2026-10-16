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
| D6 | 无法判断封面是否设置成功 | 成功标记不在 `img` 子元素上 | 判据：`.js_cover_preview_new` 的 `backgroundImage` 含 `qpic.cn`；新版裁剪流程下再接受 `.card-cover-img` 有 `mmbiz.qpic.cn` 图 |
| D7 | **「封面多张」需求**：想给一篇图文设多张封面 | 实测（2026-10-13）**图文消息的封面选择弹窗是单选**：ctrl+点击第二张会取消第一张的选中（`li.appmsg_content_img_item.selected` 始终只有一个）；「下一步」→「编辑封面」弹窗也只有**一张源图**的 Jcrop 裁剪区 | **图文消息封面上限 = 1 张源图，派生 2 张封面**：编辑封面弹窗右侧两张预览卡「2.35:1 (消息列表)」+「1:1 (转发卡片和公众号主页)」。**三图封面是「图片消息(小绿书)」专属**（编辑器 DOM 注释：`setting-group__cover_splice 三图` 标注为图片消息；`cover_normal 16:9`/`cover_standard 3:4` 同），且官方答复「少于3张默认单图封面，超过或等于3张默认三图封面」也是指图片消息。想三图封面只能发图片消息（另一种内容体裁），图文无解 |
| D8 | 「下一步」点了没反应 | 「选择图片」弹窗未选中图时「下一步」是 `weui-desktop-btn_disabled`，点了无效 | 先点缩略图选中，再**轮询等按钮不含 disabled 类**才点（`waitEnabledText()`） |
| D9 | 裁剪弹窗按钮文本变了 | 新版是「编辑封面」弹窗，主按钮是**「确认」**（不是"完成/确定"） | 依次尝试 `确认 → 完成 → 确定`，命中即停（与 D4 一致） |

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

## H. 多图（3 张）改造（2026-10-12）

| # | 变更 | 说明 |
|---|---|---|
| H1 | `content.json` 新增 `images[]` 数组 | 旧的 `image`（单张）仍兼容；两者都不给时按 `keyword`+`tags` 从素材库自动挑 3 张 |
| H2 | 新增 `no_image` / `image_top` / `image_dir` / `keyword` / `tags` 字段 | 与其它平台命名统一；挑图逻辑走共享工具 `../../isolated-browser/scripts/post_images.js` |
| H3 | 多图上传与重组 | **沿用 C3 的「先上传、后重组」**：逐张 `setInputFiles` → 等 `realImgs()` 数递增 → 取回 `img.outerHTML`；全部取完后再一次性 `setHTML(partA + 每张<p>img</p> + partB)` |
| H4 | 统计真实插图仍要过滤占位符 | 见 C4：用 `src` 含 `qpic.cn` 过滤，`ProseMirror-separator`（src 为空）不算 |

### 已证伪（勿再试）
| 做法 | 为什么不行 |
|---|---|
| 一次性 `setInputFiles(三个文件)` | 该 input 按单张处理；必须逐张上传再统一重组 |
| 每上传一张就立刻重组正文 | 会被下一次上传覆盖；必须先全部取回 `outerHTML`，最后一次性重组 |
| 按 `querySelectorAll('img').length` 统计 | `ProseMirror-separator` 占位符导致虚高（见 C4） |

> **状态**：本机 2026-10-12 复核时**微信公众号未登录**，多图链路**尚未真实发布验证**；
> 逻辑与既有单图链路同源，扫码登录后按 SKILL.md 流程跑一次即可确认。

## I. 2026-10-12 真实发布验证（全流程跑通 + 新坑）

**结果**：《婚车租车怎么选不踩坑？车型、价格、预订时机一篇讲透》17:24 **发表成功**
（发表记录可见「已发表」，标题/正文 888 字/3 张插图/封面全部就位）。

### I1. 视口外坐标点击落空（本轮头号坑，与搜狐发布按钮同坑）

- **现象**：dry-run 时「设置封面」报 `未找到"从正文选择"菜单项`；
  实际上**点击封面按钮是点了，但点在视口外**——封面区在文档 y≈3741，
  视口高仅 953，`page.mouse.click` 用视口坐标点击视口外位置 → 无任何反应、无报错。
- **✅ 解决**：`clickSel` / `clickExact` 统一改为「`scrollIntoView({block:'center'})`
  → 等 350ms → **重取坐标** → 再 `mouse.click`」（滚动后 rect 会变，必须重取）。
- **教训**：任何「按 getBoundingClientRect 坐标点击」的工具都必须先保证元素在视口内。

### I2. 封面按钮菜单需要真实指针事件

- 封面按钮 `.js_cover_btn_area` 点击后弹出 `pop-opr` 菜单，
  里面才有 `a.js_selectCoverFromContent`（「从正文选择」）与「微信扫码上传」。
  DOM click 无效，必须 mouse.click（本脚本本就走真实鼠标，坑只在视口外）。

### I3. 发表必须管理员扫码验证 + 成功判定修正

- 点「发表」→ 弹「发表/群发通知」→「继续发表」→ 弹「微信验证」二维码
  （管理员/运营者扫码直接通过）。`--verify-wait` 秒内扫码即可，脚本会自动继续。
- ⚠️ **成功判定**：脚本之前在验证通过、URL 跳回 home 后报
  `PUBLISH_UNCONFIRMED`（未确认）。核实方法：发表记录页
  `/cgi-bin/appmsgpublish?sub=list&begin=0&count=10&token=<token>&lang=zh_CN`
  搜标题 —— **注意不是** `/cgi-bin/appmsg?action=list_ex`（那是素材库图文列表，不是发表记录）。
- 二维码有效期短：脚本每轮 `verify-wait`（默认 300s）后二维码过期会重新弹码；
  人工扫码要在弹码后尽快完成。

### I4. Chrome 中途退出 / 页面僵死的处置

- 自动化过程中隔离 Chrome 退出过一次（9222 拒绝连接）：直接重跑
  `isolated-browser/scripts/launch.js`，profile 登录态保留（公众号 token 仍有效）。
- 公众号后台页面也会僵死（goto 'load' 卡死、body.innerText 为空、菜单链接抓不到）：
  关掉所有 weixin 标签页重开即可。pathkit 的 `connectCDP({keep})` 已内置清理。

### I5. 多图链路验证结论（H 节收口）

- 3 张图逐张上传 + 最后一次性重组正文：**实测通过**（字数=888，真实插图数=3，
  图片置于段落之间）；封面「从正文选择」设置成功。
- 上一节"待真实发布验证"的状态就此关闭。

## J. 2026-10-13 改造（body_html 分布插图 + 新版三步封面）

| # | 变更 | 说明 |
|---|---|---|
| J1 | `content.json` 新增 `body_html[]` | 数组 join 成正文模板，`<!--IMAGE-->` 占位符处按顺序填入已上传图片 —— 配图**分布在指定段落之间**（旧 `body_partA/partB` 是"所有图集中插在两段之间"，仍兼容，优先级低于 body_html） |
| J2 | 占位符与图片数不一致的兜底 | 占位符只有 1 个而图片多张 → 全部塞在该处（等价旧行为）；图片多于占位符 → 多出的追加到正文末尾；初始填充时占位符替换为空串 |
| J3 | 封面改为新版三步流程 | 封面按钮 →「从正文选择」→ 选图（**单选**）→ 等待「下一步」可用 → 「编辑封面」→「确认」。一张源图派生 2.35:1 + 1:1 两张封面（见 D7/D8/D9） |
| J4 | 干扰弹窗兜底 | 封面流程开头先尝试点掉「我知道了」「取消」弹窗（本次实测出现过无关的「切换账号」提示弹窗覆盖在裁剪弹窗上） |

### 实测记录

- 《陪表弟订婚车跑了两周，这些细节比价格更值得先问清》779 字 + 3 图（11/9/12.jpg 分布段落之间）
  + 封面（11.jpg → 2.35:1 + 1:1）→ 发表 → 管理员扫码验证。
- 探测结论均来自 DOM 实证（`select-cover_multi_drop` 类名存在但仅用于图片消息体裁；
  选择弹窗 ctrl 多选实测无效；编辑封面弹窗 `edit-cover-type="2.35_1"` 只有一张源图）。
