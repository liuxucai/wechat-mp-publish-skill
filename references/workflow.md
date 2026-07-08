# 微信公众号发布 — 分步操作指南

## 0. 环境准备：启动 Chrome（CDP）

在独立用户目录启动 Chrome（持久化登录态，不干扰其他浏览器窗口）：

```bash
node launch_chrome.cjs 9230
```

这会启动 Chrome 并使用 `%USERPROFILE%\.chrome_qclaw_stable` 作为用户目录。

**端口规则**：9230→9231→9232→... 逐个尝试，直到该端口空闲。

**登录**：首次需手动扫码，后续复用 cookie。

## 1. CDP 连接模式

### 连接步骤

```js
// 1. 获取页面列表
http.get('http://127.0.0.1:9230/json', (res) => { /* 解析 target.webSocketDebuggerUrl */ });

// 2. WebSocket 连接
const ws = new WebSocket(wsUrl);

// 3. 启用域名
await cdpCall(ws, 'Page.enable');
await cdpCall(ws, 'Runtime.enable');
```

### CDP 调用封装

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

## 2. 导航到编辑器

```js
await cdpCall(ws, 'Page.navigate', {
  url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&token=' + TOKEN
});
await sleep(5000);
```

检测编辑器加载完成：

```js
var ceCount = document.querySelectorAll('[contenteditable="true"]').length;
// 直到 >= 3（标题、正文、其他）
```

## 3. 填写标题

```js
document.querySelectorAll('[contenteditable="true"]')[0].innerText = '标题内容';
document.querySelectorAll('[contenteditable="true"]')[0].dispatchEvent(new Event('input', {bubbles:true}));
```

## 4. 填写正文

```js
var body = '<p>第一段</p><p>第二段</p><p>...</p>';
document.querySelectorAll('[contenteditable="true"]')[2].innerHTML = body;
document.querySelectorAll('[contenteditable="true"]')[2].dispatchEvent(new Event('input', {bubbles:true}));
```

验证：检查 `innerText.length` 是否 > 0。

## 5. AI配图封面

### 5.1 展开图片菜单

```js
// 找 [role="listitem"] 中含"本地上传"或"上传"的元素
var items = document.querySelectorAll('[role="listitem"]');
// dispatchEvent MouseEvent 序列（mousedown+mouseup+click）
items[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1}));
items[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
items[i].dispatchEvent(new MouseEvent('click',{bubbles:true}));
```

⚠️ 如果菜单不展开（现代版 JS_cover_area），可直接跳过此步找 `a.js_aiImage` 点。

### 5.2 点击 AI配图

```js
var btn = document.querySelector('a.js_aiImage');
// 如果找不到，遍历所有 <a> 找 innerText === 'AI配图'
btn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,buttons:1}));
btn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
btn.dispatchEvent(new MouseEvent('click', {bubbles:true}));
```

### 5.3 填写 prompt（关键：必须用 native setter）

```js
var input = document.querySelector('#ai-image-prompt');
var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
ns.call(input, '网站访问量数据分析图表');
['input', 'change', 'keyup'].forEach(function(e) {
  input.dispatchEvent(new Event(e, {bubbles:true}));
});
```

⚠️ 普通赋值 `input.value = 'xxx'` React 检测不到。

### 5.4 点击发送按钮

找 button 中 innerText 为空或包含 SVG 图标的（发送按钮是圆形箭头图标）。

```js
var btns = document.querySelectorAll('button');
// 找 textContent.trim() 为空但有 SVG 子元素的 button
```

### 5.5 等待图片生成

```js
// 轮询检测 img[src*="cos.myqcloud.com"]
for (let i = 0; i < 30; i++) {
  var count = document.querySelectorAll('img[src*="myqcloud.com"]').length;
  if (count > 0) break;
  await sleep(2000);
}
```

### 5.6 选择图片 → 确认

**重要发现**：AI配图弹窗中的"使用"是 **DIV** 元素（不是 button），"确认"是 **A** 标签。

```js
// 点击"使用"（找 innerText === '使用' 的 DIV）
var allDivs = document.querySelectorAll('div');
for (var i = 0; i < allDivs.length; i++) {
  if (allDivs[i].innerText.trim() === '使用' && allDivs[i].offsetParent !== null) {
    allDivs[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1}));
    allDivs[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    allDivs[i].dispatchEvent(new MouseEvent('click',{bubbles:true}));
    break;
  }
}
```

等待 2-3 秒，然后：

```js
// 点击"确认"（找 innerText === '确认' 的 A 标签）
var allEls = document.querySelectorAll('*');
for (var i = 0; i < allEls.length; i++) {
  if (allEls[i].innerText.trim() === '确认' && allEls[i].offsetParent !== null) {
    allEls[i].click(); // 可以简化，确认按钮对普通 click 响应
    break;
  }
}
```

封面设置完成。

## 6. 发表文章

### 6.1 点击发表

```js
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
  if (btns[i].innerText.trim() === '发表' && btns[i].offsetParent !== null) {
    btns[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,buttons:1}));
    btns[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
    btns[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    break;
  }
}
```

### 6.2 处理 double_check_dialog

检测 `.double_check_dialog` 是否存在。如果存在，找 `innerText === '继续发表'` 的按钮，但 **需要先 force-show**：

```js
// 1. force-show 父容器
var wrp = btn.closest('.weui-desktop-btn_wrp');
if (wrp) {
  wrp.style.setProperty('display', 'block', 'important');
  wrp.style.setProperty('visibility', 'visible', 'important');
  wrp.style.setProperty('opacity', '1', 'important');
}
btn.style.setProperty('display', 'block', 'important');
btn.style.setProperty('opacity', '1', 'important');
btn.scrollIntoView({block: 'center'});

// 2. MouseEvent 三件套
btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,buttons:1}));
btn.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
```

### 6.3 微信验证弹窗

检测 `document.body.innerText.includes('微信验证')`。

**必须由管理员微信扫码完成验证**。脚本应：
1. 提示用户扫码
2. 轮询检测验证弹窗是否消失
3. 验证通过后再点"继续发表"

```js
for (let i = 0; i < 120; i++) {
  var still = document.body.innerText.includes('微信验证') ? 'yes' : 'no';
  if (still !== 'yes') {
    // 验证通过，点击继续发表
    break;
  }
  await sleep(2000);
}
```

### 6.4 发布成功判断

- URL 包含 `appmsgid=100000019` 参数
- 如果 URL 停留在编辑页（`action=edit` 还在）说明需人工确认
- URL 跳转到列表页或 URL 带 `reprint_confirm=0` 表明发表成功

---

# 常见问题

## Q1: 正文填完字数显示 0

**原因**：React 未检测到 contenteditable 变化

**解决**：设置 innerHTML 后 dispatch `input` 事件：
```js
el.dispatchEvent(new Event('input', {bubbles: true}));
```

## Q2: 点击"继续发表"没反应

**原因**：按钮被父容器 `display:none` 隐藏（对话框可见但按钮不可见），合成事件 isTrusted=false

**解决**：先 force-show 再点：
```js
btn.style.setProperty('display', 'block', 'important');
btn.style.setProperty('opacity', '1', 'important');
btn.scrollIntoView({block:'center'});
```

## Q3: AI配图弹不出来

**原因**：未先展开图片工具栏下拉菜单

**解决**：先点 `[role="listitem"]` 中含"本地上传"的菜单项，再点 AI配图。如果菜单展开后未出现 AI配图，可直接用 `document.querySelector('a.js_aiImage')` 点击。

## Q4: CDP 端口连接失败

**原因**：Chrome 崩溃或未以正确的参数启动

**解决**：
```bash
taskkill /F /PID <old_pid>
node launch_chrome.cjs 9230
```

## Q5: 发表后页面不跳转

**原因**：触发微信验证弹窗，验证未完成

**解决**：检查是否有 heading "微信验证"。扫码完成后弹窗自动关闭，但还需重新点"继续发表"。

## Q6: "使用"按钮点不到

**原因**：AI配图弹窗中的"使用"是 DIV 元素，不是 button，用 button 选择器找不到

**解决**：遍历所有 DIV/Document 元素，`innerText.trim() === '使用'` + `offsetParent !== null` 匹配。

## Q7: CDP Runtime.evaluate 花括号/模板字符串错误

**原因**：在长字符串 JS 代码中的嵌套花括号、模板字符串与字符串拼接冲突

**解决**：将大段 HTML 正文用数组 `join('')` 拼成，分解变量名避免嵌套：
```js
// 用变量拆分，避免嵌套花括号
const bodyParts = ['<p>第1段</p>', '<p>第2段</p>'];
const fullBody = bodyParts.join('');
```

## Q8: 启动 Chrome 中文路径问题

**原因**：PowerShell 中 `$env:USERPROFILE\.chrome_qclaw_stable` 语法错误

**解决**：在 Node.js 中用 `process.env.USERPROFILE + '\\.chrome_qclaw_stable'` 拼接。
