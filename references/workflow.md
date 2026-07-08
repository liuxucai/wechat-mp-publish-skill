# 微信公众号发布 — 分步操作指南

## 1. 登录

- URL：`https://mp.weixin.qq.com/`
- **不自动填写账号密码**。打开页面让用户手动扫码登录
- 验证登录态：检查 URL 是否包含 `token=`

## 2. 导航到编辑器

```powershell
# 导航到新建文章页面
node xb.cjs run --browser cft eval --base64 "d2luZG93LmxvY2F0aW9uLmhyZWY9J2h0dHBzOi8vbXAud2VpeGluLnFxLmNvbS9jZ2ktYmluL2FwcG1zZz90PW1lZGlhL2FwcG1zZ19lZGl0JmFjdGlvbj1lZGl0JnR5cGU9Nzc="
```

## 3. 填写标题

```js
document.querySelectorAll('[contenteditable="true"]')[0].innerText = '标题';
```

## 4. 填写正文

```js
var body = '<p>第一段</p><p>第二段</p><p>...</p>';
document.querySelectorAll('[contenteditable="true"]')[2].innerHTML = body;
// 触发 React input 事件
document.querySelectorAll('[contenteditable="true"]')[2]
  .dispatchEvent(new Event('input', {bubbles: true}));
```

## 5. AI配图封面

### 5.1 展开图片菜单
```powershell
# 在 snapshot 中找到包含"本地上传"的 listitem
node xb.cjs run --browser cft snapshot -i
# 点击图片菜单 ref（如 e30）
node xb.cjs run --browser cft click e30
```

### 5.2 点击 AI配图
```js
var btn = document.querySelector('a.js_aiImage');
btn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
btn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
btn.dispatchEvent(new MouseEvent('click', {bubbles:true}));
```

### 5.3 填写 prompt（必须 native setter）
```js
var input = document.querySelector('#ai-image-prompt');
var ns = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
ns.call(input, '网站访问量统计数据分析图表');
['input','change','keyup'].forEach(function(e) {
  input.dispatchEvent(new Event(e, {bubbles:true}));
});
```

### 5.4 点击发送按钮 → 等待 ~30秒 → 点击"使用" → 确认编辑封面

## 6. 发表

### 6.1 首次点击发表
```powershell
node xb.cjs run --browser cft click e43
```

### 6.2 发表确认弹窗 → 点击"继续发表"
1. 先 force-show 按钮父容器（.weui-desktop-btn_wrp 可能 display:none）
2. 再通过 CDP dispatchMouseEvent 触发真实事件

### 6.3 微信验证（如果出现）
需要用户手动完成扫码，之后弹窗自动关闭。

### 6.4 发布成功判断
- URL 包含 `appmsgid=100000009` 等参数
- 文章进入审核队列

---

# 常见问题

## Q1: 正文填完字数显示 0

**原因**：React 未检测到 contenteditable 变化

**解决**：设置 innerHTML 后 dispatch `input` 事件：
```js
el.dispatchEvent(new Event('input', {bubbles: true}));
```

## Q2: 点击"继续发表"没反应

**原因**：React 的 isTrusted 检查 — 合成 MouseEvent.isTrusted=false，被 React 忽略

**解决**：
1. force-show 父容器：`wrp.style.display='block'`
2. scrollIntoView
3. 用 CDP Input.dispatchMouseEvent（真实事件）或用 xb click

## Q3: AI配图弹不出来

**原因**：必须先展开图片工具栏下拉菜单

**解决**：通过 snapshot 找到图片菜单 ref，先 xb click 展开，再点 AI配图

## Q4: Shell 中文乱码

**原因**：PowerShell 的 GBK 编码环境，内联中文参数转成乱码

**解决**：所有含中文的 JS 代码写入 temp 文件 → UTF-8 base64 编码 → xb --base64 传入

```powershell
$bytes = [Text.Encoding]::UTF8.GetBytes((Get-Content -Raw "temp.js" -Encoding UTF8))
$b64 = [Convert]::ToBase64String($bytes)
node xb.cjs run --browser cft eval --base64 $b64
```

## Q5: 发表后页面不跳转

**原因**：公众号弹出微信验证，验证未完成

**解决**：检测是否有 heading "微信验证"，提示用户扫码。若关闭了验证弹窗，需重新点发表流程。

## Q6: xb eval 里 return 报错

**原因**：eval 内容必须是一个表达式

**解决**：用 IIFE 包裹：
```js
// 正确
Buffer.from('(function(){return result;})()').toString('base64')
// 错误
Buffer.from('return result').toString('base64')  // SyntaxError
```
