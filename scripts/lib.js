/**
 * 微信公众号 Publisher - xb CLI 封装库
 *
 * 基于 xb snapshot/click/eval/eval --base64 原生命令的封装。
 * 所有含中文/特殊字符的 eval 必须走 base64 编码，避免 PowerShell GBK 乱码。
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const XB = 'F:\\qclaw\\v0.2.32.610\\resources\\openclaw\\config\\skills\\xbrowser\\scripts\\xb.cjs';
const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-3af8d089';
const STATUS_FILE = path.join(WORKSPACE, 'wx_status.txt');

const EDITOR_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeStatus(msg) {
  try { fs.writeFileSync(STATUS_FILE, msg, 'utf8'); } catch (e) {}
}

function encodeB64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function getResult(resp) {
  if (!resp || !resp.ok) return null;
  var d = resp.data;
  if (!d || !d.result) return null;
  var r = d.result;
  if (r && r.success) return r.data;
  return null;
}

// ==================== xb CLI 封装 ====================

function xb(args, timeout) {
  timeout = timeout || 30000;
  return new Promise(function (resolve, reject) {
    var proc = spawn('node', [XB].concat(args), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    var out = '';
    var timer = setTimeout(function () {
      try { proc.kill(); } catch (e) {}
      reject(new Error('xb timeout: ' + args.join(' ')));
    }, timeout);
    proc.stdout.on('data', function (d) { out += d.toString(); });
    proc.on('close', function (code) {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch (e) {
        resolve({ ok: false, error: 'JSON parse failed', raw: out.substring(0, 500) });
      }
    });
    proc.on('error', function (err) { clearTimeout(timer); reject(err); });
  });
}

// ==================== 基础操作 ====================

/**
 * 获取页面 snapshot
 */
async function snapshot(browser) {
  browser = browser || 'cft';
  var resp = await xb(['run', '--browser', browser, 'snapshot', '-i']);
  return getResult(resp);
}

/**
 * 截图
 */
async function screenshot(browser) {
  browser = browser || 'cft';
  var resp = await xb(['run', '--browser', browser, 'screenshot']);
  var r = getResult(resp);
  return r ? r.path : null;
}

/**
 * 点击元素
 */
async function click(browser, target) {
  browser = browser || 'cft';
  var resp = await xb(['run', '--browser', browser, 'click', target]);
  return resp && resp.ok;
}

/**
 * 获取页面 URL
 */
async function getUrl(browser) {
  browser = browser || 'cft';
  var b64 = encodeB64('window.location.href');
  var resp = await xb(['run', '--browser', browser, 'eval', '--base64', b64]);
  var r = getResult(resp);
  return r ? r.result : null;
}

/**
 * 执行 JS eval（base64 编码）
 */
async function evalB64(js, browser) {
  browser = browser || 'cft';
  var b64 = encodeB64(js);
  var resp = await xb(['run', '--browser', browser, 'eval', '--base64', b64]);
  var r = getResult(resp);
  return r ? r.result : null;
}

/**
 * 执行 JS eval（直接传参）
 */
async function evalRaw(expr, browser) {
  browser = browser || 'cft';
  var resp = await xb(['run', '--browser', browser, 'eval', expr]);
  var r = getResult(resp);
  return r ? r.result : null;
}

// ==================== 微信公众号专用操作 ====================

/**
 * 等待编辑器加载完成
 */
async function waitForEditor(browser) {
  browser = browser || 'cft';
  for (var i = 0; i < 30; i++) {
    var url = await getUrl(browser);
    if (url && url.includes('appmsg')) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * 填写标题
 */
async function fillTitle(title, browser) {
  browser = browser || 'cft';
  var js = '(function(){var el=document.querySelectorAll(\'[contenteditable="true"]\')[0];if(!el)return"no_title_el";el.innerText="' + title.replace(/"/g, '\\"') + '";return"ok";})()';
  return await evalB64(js, browser);
}

/**
 * 填写正文
 */
async function fillBody(html, browser) {
  browser = browser || 'cft';
  var escaped = html.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  var js = '(function(){var els=document.querySelectorAll(\'[contenteditable="true"]\');var el=els[2];if(!el)return"no_body_el";el.innerHTML=\'' + escaped + '\';el.dispatchEvent(new Event("input",{bubbles:true}));return"body_len:"+el.innerText.length;})()';
  return await evalB64(js, browser);
}

/**
 * 检查正文长度
 */
async function checkBodyLen(browser) {
  browser = browser || 'cft';
  var js = '(function(){var els=document.querySelectorAll(\'[contenteditable="true"]\');if(els[2])return els[2].innerText.length.toString();return"0";})()';
  return await evalB64(js, browser);
}

/**
 * AI配图 — 点击图片工具栏菜单
 */
async function clickImageMenu(browser) {
  browser = browser || 'cft';
  var snap = await snapshot(browser);
  if (!snap || !snap.refs) return null;
  var refs = snap.refs;
  for (var key in refs) {
    if (refs[key].name && refs[key].name.includes('本地上传')) {
      await click(browser, key);
      return key;
    }
  }
  return null;
}

/**
 * AI配图 — 点击 AI配图 按钮
 */
async function clickAiImage(browser) {
  browser = browser || 'cft';
  var js = '(function(){var btn=document.querySelector(\'a.js_aiImage\');if(!btn)return"not_found";btn.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));btn.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));btn.dispatchEvent(new MouseEvent("click",{bubbles:true}));return"clicked_js_aiImage";})()';
  return await evalB64(js, browser);
}

/**
 * AI配图 — 填写 prompt
 */
async function fillAiPrompt(promptText, browser) {
  browser = browser || 'cft';
  var escaped = promptText.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  var js = '(function(){var input=document.querySelector("#ai-image-prompt");if(!input)return"no_input";var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;ns.call(input,"' + escaped + '");["input","change","keyup"].forEach(function(e){input.dispatchEvent(new Event(e,{bubbles:true}))});return"prompt_set";})()';
  return await evalB64(js, browser);
}

/**
 * AI配图 — 等待图片生成
 */
async function waitAiImages(browser, timeoutMs) {
  timeoutMs = timeoutMs || 45000;
  browser = browser || 'cft';
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    var js = '(function(){var imgs=document.querySelectorAll("img[src*=\'cos.myqcloud.com\']");if(imgs.length>0)return imgs.length.toString();return"0";})()';
    var result = await evalB64(js, browser);
    if (result && parseInt(result) > 0) return parseInt(result);
    await sleep(3000);
  }
  return 0;
}

/**
 * 点击发布按钮
 */
async function clickPublishBtn(browser) {
  browser = browser || 'cft';
  var js = '(function(){var els=document.querySelectorAll("button");for(var i=0;i<els.length;i++){if(els[i].textContent.trim()==="\\u53d1\\u8868"&&els[i].offsetParent){els[i].dispatchEvent(new MouseEvent("mousedown",{bubbles:true,bubbles:true,cancelable:true,view:window,buttons:1}));els[i].dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,view:window}));els[i].dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));return"clicked";}}return"no_visible_publish_btn";})()';
  return await evalB64(js, browser);
}

/**
 * 点击"继续发表"按钮
 */
async function clickContinuePublish(browser) {
  browser = browser || 'cft';
  var js = '(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){if(btns[i].textContent.trim()==="\\u7ee7\\u7eed\\u53d1\\u8868"){var wrp=btns[i].closest(".weui-desktop-btn_wrp");if(wrp){wrp.style.display="block";wrp.style.visibility="visible";wrp.style.opacity="1";}btns[i].style.display="block";btns[i].style.visibility="visible";btns[i].style.opacity="1";btns[i].scrollIntoView({block:"center"});btns[i].dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,buttons:1}));btns[i].dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true}));btns[i].dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));return"clicked";}}return"no_continue_btn";})()';
  return await evalB64(js, browser);
}

/**
 * 检查是否有微信验证弹窗
 */
async function checkWxVerify(browser) {
  browser = browser || 'cft';
  var js = '(function(){var hs=document.querySelectorAll("h3,h2,h1,h4");for(var i=0;i<hs.length;i++){if(hs[i].textContent.trim()==="\\u5fae\\u4fe1\\u9a8c\\u8bc1")return"yes";}return"no";})()';
  return await evalB64(js, browser);
}

/**
 * 检查是否有发表确认弹窗
 */
async function checkDoubleCheckDialog(browser) {
  browser = browser || 'cft';
  var js = '(function(){var d=document.querySelector(".double_check_dialog");return d&&d.offsetParent?"yes":"no";})()';
  return await evalB64(js, browser);
}

/**
 * 退出浏览器
 */
async function closeBrowser(browser) {
  browser = browser || 'cft';
  var resp = await xb(['run', '--browser', browser, 'close']);
  return resp && resp.ok;
}

module.exports = {
  XB, WORKSPACE, EDITOR_URL, STATUS_FILE,
  sleep, writeStatus, encodeB64, getResult,
  xb, snapshot, screenshot, click, getUrl, evalB64, evalRaw,
  waitForEditor, fillTitle, fillBody, checkBodyLen,
  clickImageMenu, clickAiImage, fillAiPrompt, waitAiImages,
  clickPublishBtn, clickContinuePublish,
  checkWxVerify, checkDoubleCheckDialog, closeBrowser
};
