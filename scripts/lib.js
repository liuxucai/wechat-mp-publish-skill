/**
 * 微信公众号 Publisher - CDP 封装库
 *
 * 基于 Node.js ws 模块直连 Chrome DevTools Protocol。
 * 彻底解决 xb CLI 方案的 Shell 编码、React isTrusted 和端口管理问题。
 */
'use strict';

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-3af8d089';
const STATUS_FILE = path.join(WORKSPACE, 'wx_status.txt');
const CDP_PORT_DEFAULT = 9230;
const EDITOR_URL_BASE = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeStatus(msg) {
  try { fs.writeFileSync(STATUS_FILE, msg, 'utf8'); } catch (e) {}
}

// ==================== CDP 连接 ====================

/**
 * 连接指定端口的 Chrome CDP
 * @param {number} port - CDP 端口（默认 9230）
 * @returns {Promise<WebSocket>}
 */
async function connectCDP(port) {
  port = port || CDP_PORT_DEFAULT;

  // 获取页面列表
  const wsUrl = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + port + '/json', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const pages = JSON.parse(d);
          // 优先找已有页面（type: page）
          const target = pages.find(p => p.type === 'page' && p.url !== 'about:blank')
                       || pages.find(p => p.type === 'page');
          if (target) resolve(target.webSocketDebuggerUrl);
          else reject('No page target found on port ' + port);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // 启用必要域名
  await cdpCall(ws, 'Page.enable');
  await cdpCall(ws, 'Runtime.enable');

  return ws;
}

/**
 * CDP 命令调用封装
 * @param {WebSocket} ws
 * @param {string} method
 * @param {object} params
 * @param {number} timeoutMs
 * @returns {Promise<object>}
 */
function cdpCall(ws, method, params, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
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
    setTimeout(() => {
      ws.removeListener('message', handler);
      reject('CDP Timeout: ' + method);
    }, timeoutMs);
  });
}

/**
 * 执行 JavaScript 并返回值
 * @param {WebSocket} ws
 * @param {string} expression
 * @returns {Promise<string|null>}
 */
async function runJS(ws, expression) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expression,
    returnByValue: true
  });
  return r.result ? r.result.value : null;
}

/**
 * 截图保存
 * @param {WebSocket} ws
 * @param {string} filePath
 */
async function screenshotTo(ws, filePath) {
  const ss = await cdpCall(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(filePath, Buffer.from(ss.data, 'base64'));
  return filePath;
}

/**
 * 获取当前页面 URL
 */
async function getUrl(ws) {
  return await runJS(ws, 'window.location.href');
}

/**
 * 获取页面标题
 */
async function getTitle(ws) {
  return await runJS(ws, 'document.title');
}

/**
 * 导航到 URL 并等待加载
 */
async function navigate(ws, url) {
  await cdpCall(ws, 'Page.navigate', { url: url });
  await sleep(5000);
  // 额外等待页面稳定
  for (let i = 0; i < 20; i++) {
    const ready = await runJS(ws, 'document.readyState');
    if (ready === 'complete') break;
    await sleep(1000);
  }
}

// ==================== 微信编辑器操作 ====================

/**
 * 等待编辑器加载完成
 */
async function waitForEditor(ws) {
  for (let i = 0; i < 30; i++) {
    const n = parseInt(await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\').length') || '0');
    if (n >= 2) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * 获取当前 token
 */
async function getToken(ws) {
  const url = await getUrl(ws);
  const match = url.match(/token=(\d+)/);
  return match ? match[1] : null;
}

/**
 * 填写标题
 */
async function fillTitle(ws, title) {
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[0].innerText = \'' +
    title.replace(/'/g, "\\'") + '\'');
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[0].dispatchEvent(new Event("input", {bubbles:true}))');
}

/**
 * 填写正文（HTML）
 */
async function fillBody(ws, html) {
  // 用数组分段避免模板字符串冲突
  const escaped = html.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[2].innerHTML = \'' + escaped + '\'');
  await sleep(500);
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[2].dispatchEvent(new Event("input", {bubbles:true}))');
  await sleep(300);
}

/**
 * 检查正文长度
 */
async function checkBodyLen(ws) {
  const len = await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[2].innerText.length');
  return parseInt(len) || 0;
}

/**
 * 检查标题内容
 */
async function checkTitle(ws) {
  return await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[0].innerText');
}

// ==================== AI配图 ====================

/**
 * AI配图 — 完整流程
 * @param {WebSocket} ws
 * @param {string} promptText
 * @returns {boolean} 是否成功设置封面
 */
async function aiCoverFlow(ws, promptText) {
  console.log('--- AI配图流程 ---');

  // 1. 关闭可能的弹窗
  await runJS(ws, `(function(){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
    return 'escape_sent';
  })()`);
  await sleep(2000);

  // 2. 点击 AI配图按钮
  const aiResult = await runJS(ws, `(function(){
    var btn = document.querySelector('a.js_aiImage');
    if(!btn){
      var links = document.querySelectorAll('a');
      for(var i=0;i<links.length;i++){
        if(links[i].textContent.trim() === 'AI配图'){ btn = links[i]; break; }
      }
    }
    if(btn){
      btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1}));
      btn.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      return 'ai_clicked';
    }
    return 'no_ai_btn';
  })()`);
  console.log('  AI配图:', aiResult);
  await sleep(3000);

  // 3. 检测弹窗
  const hasInput = await runJS(ws, 'document.querySelector("#ai-image-prompt") ? "yes":"no"');
  if (hasInput !== 'yes') {
    console.log('  ⚠️ AI配图弹窗未打开');
    return false;
  }
  console.log('  弹窗已打开');

  // 4. 填 prompt
  const escapedPrompt = promptText.replace(/'/g, "\\'");
  await runJS(ws, `(function(){
    var inp = document.querySelector('#ai-image-prompt');
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    ns.call(inp,'${escapedPrompt}');
    ['input','change','keyup'].forEach(function(e){inp.dispatchEvent(new Event(e,{bubbles:true}));});
    return 'prompt_filled';
  })()`);
  console.log('  Prompt已填');
  await sleep(500);

  // 5. 点击发送按钮（找含 SVG 或空文本的 button）
  await runJS(ws, `(function(){
    var btns = document.querySelectorAll('button');
    for(var i=0;i<btns.length;i++){
      var t = btns[i].textContent.trim();
      if(!t || btns[i].querySelector('svg')){
        btns[i].click();
        return 'send_' + i;
      }
    }
    // Fallback: find button with background-image
    return 'no_send_btn';
  })()`);
  console.log('  发送已点击，等待AI生成...');

  // 6. 等待图片生成
  let imgCount = 0;
  for (let i = 0; i < 30; i++) {
    imgCount = parseInt(await runJS(ws, 'document.querySelectorAll(\'img[src*="myqcloud.com"]\').length') || '0');
    if (imgCount > 0) break;
    await sleep(2000);
    if (i % 5 === 0) process.stdout.write('.');
  }
  console.log('\n  生成图片:', imgCount);

  if (imgCount === 0) {
    console.log('  ⚠️ 未生成图片');
    return false;
  }

  await sleep(2000);

  // 7. 点击"使用"（DIV 元素，不是 button）
  const useResult = await runJS(ws, `(function(){
    var all = document.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      if(all[i].innerText.trim() === '使用' && all[i].offsetParent !== null){
        all[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1}));
        all[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
        all[i].dispatchEvent(new MouseEvent('click',{bubbles:true}));
        return 'use_clicked';
      }
    }
    return 'no_use_btn';
  })()`);
  console.log('  使用:', useResult);
  await sleep(3000);

  // 8. 点击"确认"（A 标签，不是 button）
  const confirmResult = await runJS(ws, `(function(){
    var all = document.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      if(all[i].innerText.trim() === '确认' && all[i].offsetParent !== null){
        all[i].click();
        return 'confirm_clicked';
      }
    }
    return 'no_confirm_btn';
  })()`);
  console.log('  确认:', confirmResult);
  await sleep(2000);

  return true;
}

// ==================== 发表 ====================

/**
 * 点击发表按钮
 */
async function clickPublishBtn(ws) {
  return await runJS(ws, `(function(){
    var btns = document.querySelectorAll('button');
    for(var i=0;i<btns.length;i++){
      if(btns[i].innerText.trim() === '发表' && btns[i].offsetParent !== null){
        btns[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,buttons:1}));
        btns[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
        btns[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        return 'pub_clicked';
      }
    }
    return 'no_pub_btn';
  })()`);
}

/**
 * 检测并处理发表确认弹窗
 * @returns {string} 处理结果描述
 */
async function handlePublishConfirm(ws) {
  await sleep(2000);

  const hasDialog = await runJS(ws, 'document.querySelector(".double_check_dialog") ? "yes":"no"');
  if (hasDialog !== 'yes') return 'no_dialog';

  await sleep(1000);
  const contResult = await runJS(ws, `(function(){
    var btns = document.querySelectorAll('.double_check_dialog button, button');
    for(var i=0;i<btns.length;i++){
      if(btns[i].innerText.trim() === '继续发表'){
        btns[i].style.setProperty('display','block','important');
        btns[i].style.setProperty('visibility','visible','important');
        btns[i].style.setProperty('opacity','1','important');
        btns[i].scrollIntoView({block:'center'});
        btns[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,buttons:1}));
        btns[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
        btns[i].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        return 'continue_clicked';
      }
    }
    return 'no_continue';
  })()`);
  return 'dialog_handled:' + contResult;
}

/**
 * 检测并处理微信验证弹窗
 * @param {WebSocket} ws
 * @param {function} onVerify - 验证完成回调
 */
async function handleWxVerify(ws, onVerify) {
  const hasVerify = await runJS(ws, 'document.body.innerText.includes("微信验证") ? "yes":"no"');
  if (hasVerify !== 'yes') return 'no_verify';

  console.log('⚠️ 需要管理员微信扫码验证');
  console.log('请用管理员微信的扫码功能完成验证...');
  writeStatus('等待管理员扫码验证');

  // 轮询等待验证完成
  for (let i = 0; i < 120; i++) {
    const still = await runJS(ws, 'document.body.innerText.includes("微信验证") ? "yes":"no"');
    if (still !== 'yes') {
      console.log('✅ 验证通过');
      writeStatus('扫码验证通过');
      await sleep(2000);

      // 验证后可能需要重新点"继续发表"
      const contAfter = await runJS(ws, `(function(){
        var btns = document.querySelectorAll('button');
        for(var i=0;i<btns.length;i++){
          if(btns[i].innerText.trim() === '继续发表'){
            btns[i].dispatchEvent(new MouseEvent('click',{bubbles:true}));
            return 'continue_after_verify';
          }
        }
        return 'no_continue';
      })()`);
      console.log('  继续发表(扫码后):', contAfter);
      await sleep(5000);
      if (onVerify) onVerify();
      return 'verified';
    }
    if (i % 20 === 0) process.stdout.write('.');
    await sleep(2000);
  }
  console.log('\n⚠️ 等待超时');
  return 'timeout';
}

/**
 * 检查发布结果
 * @returns {string} 'success' | 'pending' | 'unknown'
 */
async function checkPublishResult(ws) {
  const url = await getUrl(ws);
  console.log('最终URL:', url);

  if (url.includes('appmsgid=') && !url.includes('action=edit')) {
    return 'success';
  }
  if (url.includes('appmsgid=')) {
    return 'pending';
  }
  return 'unknown';
}

module.exports = {
  WORKSPACE, STATUS_FILE, CDP_PORT_DEFAULT, EDITOR_URL_BASE,
  sleep, writeStatus,
  connectCDP, cdpCall, runJS, screenshotTo, getUrl, getTitle, navigate,
  waitForEditor, getToken, fillTitle, fillBody, checkBodyLen, checkTitle,
  aiCoverFlow,
  clickPublishBtn, handlePublishConfirm, handleWxVerify, checkPublishResult
};
