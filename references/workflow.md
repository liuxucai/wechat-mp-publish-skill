# 微信公众号发布 — 分步操作指南（实测走通版，2026-07-17）

> 分辨率 1440×900，浏览器为 isolated-browser 隔离 Chrome（CDP 端口 9222）。
> ⚠️ **核心原则：所有元素动态探测，禁止写死坐标。** 微信后台会改版，写死坐标必失效。
> 任何点击**不要用** JS 合成 `dispatchEvent(MouseEvent)`（React 忽略），优先 DOM `el.click()`（trusted）。

## 0. 环境准备：拉起浏览器（CDP）

优先调用 **isolated-browser skill**（端口 9222）。若未安装，再 fallback 到本 skill 的
`scripts/launch_chrome.cjs`（端口 9230）。

确认 CDP 就绪：
```bash
curl -s http://127.0.0.1:9222/json | head
```

## 1. 导航到编辑器

`Page.navigate` 到：
`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&lang=zh_CN&token=<TOKEN>`
等待 `document.readyState === 'complete'`。

## 2. 填写标题 / 正文

- 标题：`contenteditable` 列表 index 0，用 `innerText` 注入 + 派发 `input` 事件（更新 React 状态，可用）。
- 正文：`contenteditable` 列表 index 2，用 `innerHTML` 注入 + 派发 `input` 事件。
- ⚠️ 必须派发 `input` 事件，否则 React 检测不到内容变化。

```js
// 标题/正文 注入示例（runJS 内执行）
el.innerText = '标题内容';
el.dispatchEvent(new Event('input', { bubbles: true }));
```

## 3. 设置封面（AI配图）— 动态探测

### 3.1 入口：封面选择按钮（唯一稳定入口）

⚠️ **不要**用旧结构的 `.js_chooseCoverWrap`/替换图标 (918,453)（新版已不存在，点击落空）。
正确入口是 `.js_cover_btn_area`（封面**已设/未设**都走它）。动态读其中心坐标点开菜单：

```js
const c = JSON.parse(await runJS(ws, `(function(){
  var e=document.querySelector('.js_cover_btn_area');if(!e)return null;
  var r=e.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
})()`));
await cdpClick(ws, c.x, c.y, 1200);
```

### 3.2 菜单点「AI配图」（扫描叶子节点取坐标）

菜单弹出后，扫描文字含「AI配图」的叶子节点，取坐标 CDP 点击（菜单项未被遮挡，坐标点击有效）：

```js
const ai = JSON.parse(await runJS(ws, `(function(){
  function vis(e){return e.offsetParent!==null && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';}
  var ai=Array.from(document.querySelectorAll('*')).find(function(e){
    return vis(e) && e.children.length===0 && /AI配图|AI 配图/.test((e.innerText||'').replace(/\s+/g,''));
  });
  if(!ai) return null;
  var r=ai.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
})()`));
await cdpClick(ws, ai.x, ai.y, 1500);
```

### 3.3 AI 配图对话框 — 两种模式

打开对话框后先探测是哪种（**可见性判定只用 `offsetParent` + display/visibility，不要用 height**）：

```js
const visible = '(function(){var e=document.querySelector(".ai_image_dialog");if(!e)return false;var cs=getComputedStyle(e);return e.offsetParent!==null && cs.display!=="none" && cs.visibility!=="hidden";})()';
```

#### 模式 A：历史图片列表（无 prompt 输入框）
每张图下方有「调整」「使用」按钮 `.ai-image-op-btn`。

⚠️ **关键**：这些「使用」按钮被上层 `img` 覆盖，`elementFromPoint` 命中 IMG →
**CDP 坐标点击无效**，必须用 **DOM `el.click()`**（绕过覆盖层）：

```js
await runJS(ws, `(function(){
  function vis(e){return e.offsetParent!==null && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';}
  var btns=Array.from(document.querySelectorAll('.ai-image-op-btn')).filter(function(e){return vis(e) && (e.innerText||'').trim().replace(/\s+/g,'')==='使用';});
  if(!btns.length) return 'NOBTN';
  btns[btns.length-1].click();   // DOM 点击，绕过 IMG 覆盖层
  return 'CLICKED';
})()`);
```

#### 模式 B：生成新图（有 prompt 输入框 `#ai-image-prompt`）
1. 填 prompt。⚠️ 该框是 **`<textarea>`**，必须用 `HTMLTextAreaElement.prototype` 的 value setter：

```js
const promptText = '科技感 AI 配图，主题描述';
await runJS(ws, `(function(){
  var inp=document.querySelector('#ai-image-prompt');if(!inp)return;
  var proto=(inp.tagName==='TEXTAREA')?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  var ns=Object.getOwnPropertyDescriptor(proto,'value').set;
  ns.call(inp, ${JSON.stringify(promptText)});
  ['input','change','keyup'].forEach(function(e){inp.dispatchEvent(new Event(e,{bubbles:true}));});
})()`);
```

2. 点发送按钮 `.send-btn`（用 class 定位，坐标兜底约 1015,492）：
```js
const send = await getCenter(ws, "Array.from(document.querySelectorAll('.send-btn')).find(function(b){return b.offsetParent!==null;})") || {x:1015,y:492};
await cdpClick(ws, send.x, send.y, 1500);
```

3. 轮询 `img[src*="myqcloud"]` 数量增加确认生成完成，拿到新图 src。

#### 新图「使用」精确匹配（避免误用历史旧图）
生成新图后，按**新图 src** 向上 8 层 DOM 找对应的 `.ai-image-op-btn`（DOM click）：
```js
await runJS(ws, `(function(){
  function vis(e){return e.offsetParent!==null && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';}
  function useBtnIn(node){if(!node)return null;return Array.from(node.querySelectorAll('.ai-image-op-btn')).find(function(b){return vis(b)&&(b.innerText||'').trim().replace(/\s+/g,'')==='使用';});}
  var NEW_SRC=${JSON.stringify(newSrc)};
  var target=null;
  if(NEW_SRC){
    var imgs=Array.from(document.querySelectorAll('img')).filter(function(im){return (im.src||'')===NEW_SRC;});
    for(var k=0;k<imgs.length;k++){var node=imgs[k];for(var d=0;d<8;d++){node=node.parentElement;if(!node)break;var ub=useBtnIn(node);if(ub){target=ub;break;}}if(target)break;}
  }
  if(!target){var bs=Array.from(document.querySelectorAll('.ai-image-op-btn')).filter(function(e){return vis(e)&&(e.innerText||'').trim().replace(/\s+/g,'')==='使用';});if(!bs.length)return 'NOBTN';target=bs[bs.length-1];}
  target.click();
  return 'CLICKED';
})()`);
```

### 3.4 编辑封面裁剪框 → 确认（DOM click，禁止 CDP 坐标）

点「使用」后弹「编辑封面」弹窗 `.weui-desktop-dialog`。

⚠️ **关键**：
- AI配图对话框 `.ai_image_dialog` 常残留并**遮挡**此确认按钮，CDP 坐标点击会被拦截 →
  **必须用 DOM `el.click()`**（trusted，不受遮挡）。
- 确认按钮 = `.weui-desktop-dialog__ft` 内的 `.weui-desktop-btn_primary`（文字「确认」）。
- 点「使用」后等 **3~4 秒** 让裁剪框稳定，否则确认落空。

```js
await sleep(4000);
for (let attempt=0; attempt<4; attempt++) {
  const clicked = await runJS(ws, `(function(){
    function vis(e){return e&&e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';}
    var b=Array.from(document.querySelectorAll('.weui-desktop-dialog__ft .weui-desktop-btn_primary, .weui-desktop-dialog__ft button')).find(function(e){return vis(e)&&(e.innerText||'').trim()==='确认';});
    if(!b) return 'NOBTN';
    b.click();
    return 'CLICKED';
  })()`);
  await sleep(2500);
  const stillCrop = (await runJS(ws, `(function(){var d=document.querySelector('.weui-desktop-dialog');return (d&&getComputedStyle(d).display!=='none')?'yes':'no';})()`)) === 'yes';
  if (!stillCrop) break;
}
// 兜底：cdpClick(ws, 682, 787, 2500);
```

### 3.5 封面生效校验

⚠️ 微信封面图写在 `.js_splice-cover` 的 **`background-image`**（非 `<img>`）。正确校验：

```js
const coverOk = (await runJS(ws, `(function(){
  var c=document.querySelector('.js_cover_preview_new');if(!c)return 'no';
  var bg=getComputedStyle(c).backgroundImage||'';
  var sp=c.querySelector('.js_splice-cover')||c.querySelector('.splice-cover-preview');
  if(sp){var b2=getComputedStyle(sp).backgroundImage||'';if(b2.indexOf('url(')>=0&&b2.indexOf('none')<0)bg=bg||b2;}
  return (bg.indexOf('url(')>=0&&bg.indexOf('none')<0)?'yes':'no';
})()`)) === 'yes';
```

## 4. 发表弹窗链（循环处理嵌套弹窗）

```js
// 点底部「发表」：优先 DOM click button.mass_send，兜底坐标 (1115,592)
await clickPublishBtn(ws);

// handlePublishConfirm 内循环处理：
//   原创声明弹窗（≥300字）：填作者(value setter)→勾选协议→确定→再点底部发表
//   → 编辑封面确认(DOM click) → 发表确认(primary) → 继续发表 → 直到 URL 含 appmsgid
// 出现「微信验证」→ 返回 need_verify，提示人工扫码
```

## 5. 结果判定

最终 URL 含 `appmsgid=` 且不含 `action=edit` → 发表成功（需先过微信验证扫码）。

## 附录：本文用到的动态探测选择器（请勿写死坐标）

| 元素 | 探测方式 | 点击方式 |
|------|----------|----------|
| 封面入口 | `.js_cover_btn_area` 中心坐标 | CDP 坐标 |
| AI配图菜单项 | 扫描 `innerText` 含「AI配图」的叶子节点 | CDP 坐标 |
| 历史图「使用」`.ai-image-op-btn` | 动态查 | **DOM .click()**（绕过 IMG 覆盖） |
| 生成新图 prompt `#ai-image-prompt` | `#ai-image-prompt` | textarea value setter |
| 发送按钮 `.send-btn` | `.send-btn` class | CDP 坐标（兜底 1015,492） |
| 编辑封面确认 `.weui-desktop-dialog__ft .weui-desktop-btn_primary` | 文字「确认」+ dialog__ft | **DOM .click()**（防遮挡） |
| 底部发表 `button.mass_send` | `button.mass_send` | DOM .click()（兜底 1115,592） |
| 微信验证 | `body.innerText` 含「微信验证」 | 人工扫码 |
