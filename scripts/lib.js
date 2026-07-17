/**
 * 微信公众号 Publisher - CDP 封装库（实战可用版）
 *
 * 基于 Node.js ws 模块直连 Chrome DevTools Protocol。
 * 关键原则：所有"点击"必须用 CDP Input.dispatchMouseEvent 真实坐标点击（isTrusted=true）；
 *          JS 合成 dispatchEvent(MouseEvent) 会被 React 忽略，绝对不能用。
 *          仅"填写"类（innerText/innerHTML + input 事件）可用 JS 注入，因为那是更新状态而非触发点击。
 */
'use strict';

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-d0d04e07';
const STATUS_FILE = path.join(WORKSPACE, 'wx_status.txt');
const CDP_PORT_DEFAULT = 9230;
const EDITOR_URL_BASE = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeStatus(msg) {
  try { fs.writeFileSync(STATUS_FILE, msg, 'utf8'); } catch (e) {}
}

// ==================== CDP 连接 ====================

async function connectCDP(port) {
  port = port || CDP_PORT_DEFAULT;

  const wsUrl = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + port + '/json', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const pages = JSON.parse(d);
          const target = pages.find(p => p.type === 'page' && p.url && p.url.indexOf('mp.weixin.qq.com') >= 0)
                       || pages.find(p => p.type === 'page' && p.url !== 'about:blank')
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

  await cdpCall(ws, 'Page.enable');
  await cdpCall(ws, 'Runtime.enable');

  return ws;
}

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

async function runJS(ws, expression) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expression,
    returnByValue: true
  });
  return r.result ? r.result.value : null;
}

async function scrollIntoView(ws, selector) {
  await runJS(ws, '(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');if(el)el.scrollIntoView({block:"center",behavior:"instant"});})()');
  await sleep(600);
}

async function screenshotTo(ws, filePath) {
  const ss = await cdpCall(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(filePath, Buffer.from(ss.data, 'base64'));
  return filePath;
}

async function getUrl(ws) {
  return await runJS(ws, 'window.location.href');
}

async function getTitle(ws) {
  return await runJS(ws, 'document.title');
}

async function navigate(ws, url) {
  await cdpCall(ws, 'Page.navigate', { url: url });
  await sleep(5000);
  for (let i = 0; i < 20; i++) {
    const ready = await runJS(ws, 'document.readyState');
    if (ready === 'complete') break;
    await sleep(1000);
  }
}

// ==================== CDP 真实坐标点击 ====================

/**
 * 在视口坐标 (x,y) 发起一次真实左键点击（mousePressed + mouseReleased）。
 * 这是唯一能被 React 接受的点击方式（isTrusted=true）。
 */
async function cdpClick(ws, x, y, after) {
  await cdpCall(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: x, y: y, button: 'left', buttons: 1, clickCount: 1
  });
  await cdpCall(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x, y: y, button: 'left', buttons: 0, clickCount: 1
  });
  await sleep(after || 400);
}

/**
 * 计算某元素（JS 表达式返回）的视口中心坐标；不可见/几何为 0 时返回 null。
 */
async function getCenter(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: '(function(){try{var el=(' + expr + ');if(!el)return null;' +
      'var rc=el.getBoundingClientRect();' +
      'if(rc.width===0||rc.height===0)return null;' +
      'return {x:Math.round(rc.left+rc.width/2),y:Math.round(rc.top+rc.height/2)};' +
      '}catch(e){return null;}})()',
    returnByValue: true
  });
  return r.result ? r.result.value : null;
}

/**
 * 通过 elementFromPoint 竖向扫描，定位文字恰好为 text 的元素中心点。
 * 用于 getBoundingClientRect() 返回 0 的延迟渲染菜单项（如「AI配图」）。
 */
async function scanTextCenter(ws, text, x, yFrom, yTo) {
  yFrom = yFrom || 400; yTo = yTo || 640;
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: '(function(){var x=' + x + ';for(var y=' + yFrom + ';y<' + yTo + ';y+=4){' +
      'var el=document.elementFromPoint(x,y);' +
      'if(el&&(el.innerText||\'\').trim()===' + JSON.stringify(text) + '){return {x:x,y:y};}}return null;})()',
    returnByValue: true
  });
  return r.result ? r.result.value : null;
}

async function scrollIntoViewBySelector(ws, selector) {
  await runJS(ws, '(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');if(el){el.scrollIntoView({block:"center",behavior:"instant"});}})()');
  await sleep(600);
}

/** 点击「按可见文字匹配」的元素（先滚入视口，再取实时坐标点击；失败回退扫描） */
async function clickByText(ws, text, opts) {
  opts = opts || {};
  // 先把可能匹配的元素滚入视口，避免坐标落在视口外
  await runJS(ws, '(function(){var els=Array.from(document.querySelectorAll(\'*\')).filter(function(e){return e.innerText&&e.innerText.trim()===' + JSON.stringify(text) + ';});if(els[0])els[0].scrollIntoView({block:"center",behavior:"instant"});})()');
  await sleep(500);
  let c = await getCenter(ws,
    'Array.from(document.querySelectorAll(\'*\')).find(function(e){return e.innerText&&e.innerText.trim()===' +
    JSON.stringify(text) + '&&e.offsetParent!==null;})');
  if (!c && opts.scanX) c = await scanTextCenter(ws, text, opts.scanX, opts.yFrom, opts.yTo);
  if (!c) return null;
  await cdpClick(ws, c.x, c.y, opts.after);
  return c;
}

/** 点击「按选择器匹配」的元素（先滚入视口，再取实时坐标点击） */
async function clickBySelector(ws, selector, opts) {
  opts = opts || {};
  await scrollIntoViewBySelector(ws, selector);
  let c = await getCenter(ws, 'document.querySelector(' + JSON.stringify(selector) + ')');
  if (!c && opts.scanX) c = await scanTextCenter(ws, opts.scanText || '', opts.scanX, opts.yFrom, opts.yTo);
  if (!c) return null;
  await cdpClick(ws, c.x, c.y, opts.after);
  return c;
}

/**
 * 点弹窗内主操作按钮（优先精确坐标，兜底扫描 primary 绿按钮）。
 * 用于「发表」「继续发表」等——页面可能同时存在底部工具栏的普通按钮，
 * 用坐标/primary 类区分，避免误点。
 */
async function clickPrimaryByText(ws, text, opts) {
  opts = opts || {};
  await sleep(400);
  // 1) 优先用给定坐标
  if (opts.x && opts.y) {
    await cdpClick(ws, opts.x, opts.y, opts.after || 1500);
    return { x: opts.x, y: opts.y };
  }
  // 2) 兜底：扫视口内文字精确匹配且 class 含 primary 的按钮
  const c = await runJS(ws, '(function(){function vis(e){return e.offsetParent!==null&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";}var b=Array.from(document.querySelectorAll("button,.weui-desktop-btn")).find(function(e){return vis(e)&&(e.innerText||"").trim()===' + JSON.stringify(text) + '&&/primary/.test(e.className);});if(!b)return null;var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()');
  if (c) { const p = JSON.parse(c); await cdpClick(ws, p.x, p.y, opts.after || 1500); return p; }
  return null;
}

// ==================== 微信编辑器操作 ====================

async function waitForEditor(ws) {
  for (let i = 0; i < 30; i++) {
    const n = parseInt(await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\').length') || '0');
    if (n >= 2) return true;
    await sleep(1000);
  }
  return false;
}

async function getToken(ws) {
  const url = await getUrl(ws);
  const match = url.match(/token=(\d+)/);
  return match ? match[1] : null;
}

/** 填写标题：用 innerText 注入 + 派发 input 事件（React 更新状态，非点击，可用） */
async function fillTitle(ws, title) {
  const esc = title.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[0].innerText = \'' + esc + '\'');
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[0].dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(300);
}

/** 填写正文（HTML）：innerHTML 注入 + 派发 input 事件 */
async function fillBody(ws, html) {
  const esc = html.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[2].innerHTML = \'' + esc + '\'');
  await sleep(500);
  await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[2].dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(300);
}

async function checkBodyLen(ws) {
  const len = await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[2].innerText.length');
  return parseInt(len) || 0;
}

async function checkTitle(ws) {
  return await runJS(ws, 'document.querySelectorAll(\'[contenteditable="true"]\')[0].innerText');
}

// ==================== AI配图 ====================

/**
 * 完整封面流程（2026-07-17 实测走通路径，分辨率 1440×900）。
 *
 * ⚠️ 核心原则：所有元素动态探测，禁止写死坐标。微信后台会改版，旧坐标(918,453/964,628/1013,825)已失效。
 *
 * 实测 UI 模型：
 *   - 封面入口 = .js_cover_btn_area（封面已设/未设都走它；旧 .js_chooseCoverWrap/替换图标(918,453)已不存在）
 *     动态读其中心坐标 → 点开菜单 → 扫描文字含「AI配图」的叶子节点 CDP 坐标点击（菜单项未被遮挡）
 *   - AI 对话框打开后两种形态：
 *       A. 历史图片列表：每张图下方「使用」按钮 .ai-image-op-btn 被 IMG 覆盖，CDP 坐标点击失效
 *          → 必须用 **DOM el.click()**（trusted 事件）绕过覆盖层
 *       B. 生成新图（带 #ai-image-prompt textarea）：填 prompt(textarea value setter) → 点 .send-btn →
 *          轮询 img[src*=myqcloud] 增加 → 取**新图 src 对应**的「使用」按钮（避免误用历史旧图）
 *   - 点「使用」→ 弹「编辑封面」弹窗 .weui-desktop-dialog，确认按钮 = .weui-desktop-dialog__ft
 *     内的 .weui-desktop-btn_primary（文字「确认」）。⚠️ AI配图对话框(.ai_image_dialog)常残留遮挡此按钮，
 *     故必须用 **DOM el.click()**（trusted，不受遮挡），重试 4 次 + 坐标兜底(682,787)。
 *
 * @returns {boolean} 封面是否设置成功
 */
async function aiCoverFlow(ws, promptText) {
  console.log('--- AI配图流程 ---');
  await sleep(1000);
  await scrollIntoViewBySelector(ws, '.setting-group__cover_area').catch(() => {});
  await sleep(400);

  // 对话框可见性判定（实测 getBoundingClientRect().height 会因 transform/滚动返回 0，
  // 因此只用 offsetParent + display/visibility 判定，更可靠）
  const isDlgOpen = '(function(){var e=document.querySelector(".ai_image_dialog");if(!e)return false;var cs=getComputedStyle(e);return e.offsetParent!==null && cs.display!=="none" && cs.visibility!=="hidden";})()';
  let dialogOpen = (await runJS(ws, isDlgOpen)) === true;

  if (!dialogOpen) {
    // 封面入口：点击「拖拽或选择封面」按钮 = .js_cover_btn_area 中心（实测约 629,313）。
    // 旧结构 .js_chooseCoverWrap / 替换图标(918,453) 在新版微信已不存在，切勿再用。
    const btnC = await runJS(ws, '(function(){var e=document.querySelector(".js_cover_btn_area");if(!e)return null;var r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()');
    if (!btnC) { console.log('  ⚠️ 找不到封面选择按钮 .js_cover_btn_area'); return false; }
    const bc = JSON.parse(btnC);
    console.log('  点封面选择按钮 (' + bc.x + ',' + bc.y + ')');
    await cdpClick(ws, bc.x, bc.y, 1200);
    // 菜单弹出，含「从正文选择/从图片库选择/微信扫码上传/AI配图」。
    // 扫描菜单项文字含「AI」且含「配图」的叶子节点，点其真实坐标（菜单项可被正常坐标点击）。
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      const aiPt = await runJS(ws, '(function(){function vis(e){return e.offsetParent!==null&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";}var ai=Array.from(document.querySelectorAll("*")).find(function(e){return vis(e)&&e.children.length===0&&/AI配图|AI 配图/.test((e.innerText||"").replace(/\\s+/g,""));});if(!ai)return null;var r=ai.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()');
      if (aiPt) { const p = JSON.parse(aiPt); console.log('  点 AI配图菜单项 (' + p.x + ',' + p.y + ')'); await cdpClick(ws, p.x, p.y, 1500); }
      await sleep(1500);
      opened = (await runJS(ws, isDlgOpen)) === true;
      if (!opened && attempt < 2) {
        // 菜单可能收起，重新点封面选择按钮
        await cdpClick(ws, bc.x, bc.y, 800);
        await sleep(800);
      }
    }
    if (!opened) { console.log('  ⚠️ AI配图弹窗未打开（菜单点击失败）'); return false; }
    console.log('  弹窗已打开');
  } else {
    console.log('  弹窗已开着，直接复用');
  }

  // 判定分支：是否有 prompt 输入框（未生成过图 → 需要生成新图）
  const hasPrompt = (await runJS(ws, '(function(){var e=document.querySelector("#ai-image-prompt");return (e&&e.offsetParent!==null)?"yes":"no";})()')) === 'yes';

  let newSrc = null; // 生成新图后最新的图片 src，供下方「使用」精确匹配，避免误点历史图
  if (hasPrompt) {
    // —— 生成新图分支 ——
    console.log('  检测到 prompt 输入框，走生成新图分支');
    const esc = promptText.replace(/'/g, "\\'");
    // #ai-image-prompt 实为 <textarea>，必须用 HTMLTextAreaElement 的 value setter
    await runJS(ws, '(function(){var inp=document.querySelector("#ai-image-prompt");if(!inp)return "NOPROMPT";' +
      'var proto = (inp.tagName==="TEXTAREA")?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;' +
      'var ns=Object.getOwnPropertyDescriptor(proto,"value").set;' +
      'ns.call(inp,\'' + esc + '\');' +
      '["input","change","keyup"].forEach(function(e){inp.dispatchEvent(new Event(e,{bubbles:true}));});return "ok";})()');
    await sleep(600);
    const baseline = (await runJS(ws, 'Array.from(document.querySelectorAll(\'img[src*="myqcloud"]\')).map(function(i){return i.src;})')) || [];
    const baseSet = Array.isArray(baseline) ? baseline : [];
    // 发送按钮：优先 .send-btn；没有则扫圆形生成按钮（实测坐标约 1015,492）
    const send = await getCenter(ws,
      'Array.from(document.querySelectorAll(".send-btn")).find(function(b){var cs=getComputedStyle(b);return b.offsetParent!==null && cs.display!=="none" && cs.visibility!=="hidden";})')
      || await runJS(ws, '(function(){var b=Array.from(document.querySelectorAll("button")).find(function(b){return b.offsetParent!==null&&(b.className||"").indexOf("send")>=0;});if(!b)return null;var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()')
      || { x: 1015, y: 492 };
    await cdpClick(ws, send.x, send.y, 1200);
    console.log('  已点发送 @', JSON.stringify(send));
    for (let i = 0; i < 30; i++) {
      const cur = (await runJS(ws, 'Array.from(document.querySelectorAll(\'img[src*="myqcloud"]\')).map(function(i){return i.src;})')) || [];
      newSrc = cur.find(function (s) { return baseSet.indexOf(s) < 0; });
      if (newSrc) break;
      await sleep(2000);
    }
    if (!newSrc) { console.log('  ⚠️ 未生成新图'); return false; }
    await sleep(1500);
  }

  // 3. 在 AI 对话框内点「使用」
  //    关键：历史图与新图都各自带 .ai-image-op-btn(DIV) 的「使用」按钮。
  //    按钮在对话框内可能为滚动/负坐标（视口外），但仍是 visible（offsetParent!==null）。
  //    必须用 DOM el.click()（trusted 事件），不能依赖 CDP 坐标（坐标可能为负/不可点）。
  //    若生成了新图：精确匹配「新图 src 对应容器的使用按钮」，杜绝误点历史旧图（如敬老图）。
  const newSrcJson = JSON.stringify(newSrc || '');
  const useClicked = await runJS(ws, '(function(){\n' +
    '  function vis(e){return e.offsetParent!==null && getComputedStyle(e).visibility!=="hidden" && getComputedStyle(e).display!=="none";}\n' +
    '  function useBtnIn(node){if(!node)return null;return Array.from(node.querySelectorAll(".ai-image-op-btn")).find(function(b){return vis(b)&&(b.innerText||"").trim().replace(/\\s+/g,"")==="使用";});}\n' +
    '  var NEW_SRC = ' + newSrcJson + ';\n' +
    '  var target=null;\n' +
    '  if(NEW_SRC){\n' +
    '    var imgs=Array.from(document.querySelectorAll("img")).filter(function(im){return (im.src||"")===NEW_SRC;});\n' +
    '    for(var k=0;k<imgs.length;k++){var node=imgs[k];for(var d=0;d<8;d++){node=node.parentElement;if(!node)break;var ub=useBtnIn(node);if(ub){target=ub;break;}}if(target)break;}\n' +
    '  }\n' +
    '  if(!target){\n' +
    '    // 无新图：取最后一个可见「使用」（最新历史图，避免误用最旧图）\n' +
    '    var btns=Array.from(document.querySelectorAll(".ai-image-op-btn")).filter(function(e){return vis(e)&&(e.innerText||"").trim().replace(/\\s+/g,"")==="使用";});\n' +
    '    if(!btns.length) return "NOBTN";\n' +
    '    target=btns[btns.length-1];\n' +
    '  }\n' +
    '  target.click();\n' +
    '  return "CLICKED";\n' +
    '})()');
  console.log('  使用按钮:', useClicked);
  if (useClicked !== 'CLICKED') { console.log('  ⚠️ 未找到「使用」'); return false; }
  // 等裁剪框完全渲染/可交互（实测 <3s 时确认点击会落空）
  await sleep(4000);

  // 4. 点「编辑封面」弹窗的「确认」按钮关闭弹窗。
  //    关键：AI配图对话框(.ai_image_dialog)常残留并遮挡，CDP 坐标点击会被其拦截。
  //    因此必须用 DOM el.click()（trusted 事件，不受遮挡/层级影响）点中真正的确认按钮。
  //    确认按钮 = .weui-desktop-dialog__ft 内的 .weui-desktop-btn_primary（文字「确认」）。
  let confirmOk = false;
  for (let attempt = 0; attempt < 4 && !confirmOk; attempt++) {
    const clicked = await runJS(ws, `
      (function(){
        function vis(e){return e&&e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';}
        var b=Array.from(document.querySelectorAll('.weui-desktop-dialog__ft .weui-desktop-btn_primary, .weui-desktop-dialog__ft button')).find(function(e){return vis(e)&&(e.innerText||'').trim()==='确认';});
        if(!b) return 'NOBTN';
        b.click();
        return 'CLICKED';
      })()
    `);
    console.log('  点 确认(DOM):', clicked, 'attempt', attempt + 1);
    await sleep(2500);
    const stillCrop = (await runJS(ws, `(function(){var d=document.querySelector('.weui-desktop-dialog');return (d&&getComputedStyle(d).display!=='none')?'yes':'no';})()`)) === 'yes';
    if (!stillCrop) confirmOk = true;
  }
  if (!confirmOk) {
    // 兜底：CDP 坐标点击(682,787)
    await cdpClick(ws, 682, 787, 2500);
    await sleep(2500);
  }

  // 5. 校验封面是否生效：微信封面图写在 .js_splice-cover 的 background-image（非 <img>）
  const coverOk = await runJS(ws, '(function(){var c=document.querySelector(".js_cover_preview_new");if(!c)return "no";var bg=getComputedStyle(c).backgroundImage||"";var sp=c.querySelector(".js_splice-cover")||c.querySelector(".splice-cover-preview");if(sp){var b2=getComputedStyle(sp).backgroundImage||"";if(b2.indexOf("url(")>=0&&b2.indexOf("none")<0)bg=bg||b2;}return (bg.indexOf("url(")>=0&&bg.indexOf("none")<0)?"yes":"no";})()');
  console.log('  封面设置:', coverOk);
  return coverOk === 'yes';
}

// ==================== 发表 ====================

/** 点击「发表」按钮：优先 DOM click button.mass_send（trusted，避免坐标落在 span/被遮挡），兜底坐标 */
async function clickPublishBtn(ws) {
  const clicked = await runJS(ws, '(function(){function vis(e){return e.offsetParent!==null&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";}var b=Array.from(document.querySelectorAll("button.mass_send,button")).find(function(e){return vis(e)&&(e.innerText||"").trim()==="发表";});if(!b)return "NOBTN";b.click();return "CLICKED";})()');
  console.log('  底部发表 DOM.click:', clicked);
  if (clicked === 'CLICKED') { await sleep(1500); return 'pub_clicked'; }
  // 兜底坐标
  const c = await clickPrimaryByText(ws, '发表', { x: 1115, y: 592 });
  if (c) return 'pub_clicked';
  await cdpClick(ws, 1115, 592, 1000);
  return 'pub_clicked';
}

/**
 * 处理发表后的弹窗链（真实坐标点击）：
 *   编辑封面「确认」 → 再点「发表」 → 群发通知「继续发表」
 */
async function handlePublishConfirm(ws) {
  await sleep(2500);

  // —— 原创声明弹窗（正文≥300字时触发）——
  // 弹窗含「作者」输入框 + 协议勾选 + 确定按钮；必须先填作者并勾选，否则确定后发表按钮仍灰色。
  const hasOriginal = await runJS(ws, '(function(){function vis(e){return e.offsetParent!==null&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";}return Array.from(document.querySelectorAll("*")).some(function(e){return vis(e)&&/原创声明/.test(e.innerText||"");});})()');
  if (hasOriginal === true) {
    console.log('  检测到原创声明弹窗，填写作者并确认');
    // 作者输入框：placeholder 含「作者」，用 textarea/input value setter 填（React 受控组件）
    await runJS(ws, '(function(){var inp=Array.from(document.querySelectorAll("input,textarea")).find(function(e){return (e.placeholder||"").indexOf("作者")>=0;});if(!inp)return;var proto=(inp.tagName==="TEXTAREA")?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;var ns=Object.getOwnPropertyDescriptor(proto,"value").set;ns.call(inp,"行");["input","change","keyup"].forEach(function(ev){inp.dispatchEvent(new Event(ev,{bubbles:true}));});})()');
    await sleep(500);
    // 勾选协议（若未勾选）：找 type=checkbox 或勾选态元素，CDP 点击
    const cb = await runJS(ws, '(function(){function vis(e){return e.offsetParent!==null&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";}var cbs=Array.from(document.querySelectorAll("input[type=checkbox]")).filter(vis).filter(function(c){return !c.checked;});if(!cbs.length)return null;var r=cbs[0].getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()');
    if (cb) { const p = JSON.parse(cb); await cdpClick(ws, p.x, p.y, 500); }
    await sleep(500);
    // 点「确定」关闭原创弹窗（优先真实坐标，兜底扫描文字）
    const okBtn = await runJS(ws, '(function(){function vis(e){return e.offsetParent!==null&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";}var b=Array.from(document.querySelectorAll("button")).find(function(e){return vis(e)&&(e.innerText||"").trim()==="确定";});if(!b)return null;var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()');
    if (okBtn) { const p = JSON.parse(okBtn); await cdpClick(ws, p.x, p.y, 1500); }
    else { await clickByText(ws, '确定', { after: 1500 }); }
    await sleep(2000);
    // 原创弹窗关闭后，需再点一次底部「发表」才会出发表确认弹窗
    console.log('  原创弹窗已关，再点底部发表');
    await cdpClick(ws, 1115, 592, 1500);
    await sleep(2000);
  }

  // 编辑封面裁剪确认框
  const hasCrop = await runJS(ws, '(function(){var d=document.querySelector(".weui-desktop-dialog");return d&&d.innerText.indexOf("确认")>=0?"yes":"no";})()');
  if (hasCrop === 'yes') {
    const cf = await clickByText(ws, '确认', { after: 1500 });
    console.log('  编辑封面确认:', cf ? 'clicked' : 'miss');
    await sleep(1500);
  }

  // —— 发表确认弹窗链（可能嵌套 1~2 层）——
  // 步骤：弹窗内「发表」→（群发通知弹窗）「继续发表」→ 真正的「发表」确认（含群发开关）→「发表」
  // 用 DOM click 文字匹配的 primary 按钮，循环处理直到出现 appmsgid 或微信验证。
  const clickPrimaryText = async (txt) => {
    return await runJS(ws, `(function(){
      function vis(e){return e&&e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';}
      var b=Array.from(document.querySelectorAll('button.weui-desktop-btn_primary,button.btn_primary,.weui-desktop-btn_primary')).find(function(e){return vis(e)&&(e.innerText||'').trim()==='${txt}';});
      if(!b) return 'NOBTN';
      b.click();
      return 'CLICKED';
    })()`);
  };

  for (let step = 0; step < 6; step++) {
    await sleep(2000);
    // 是否已发布（URL 含 appmsgid 且非 edit 草稿态）
    const url = await getUrl(ws);
    if (url.indexOf('appmsgid=') >= 0 && url.indexOf('action=edit') < 0) return 'published';
    // 微信验证优先
    const hasVerify = await runJS(ws, 'document.body.innerText.indexOf("微信验证")>=0 ? "yes":"no"');
    if (hasVerify === 'yes') return 'need_verify';

    // 优先点真正的「发表」确认（绿色 primary，弹窗底部）
    let r = await clickPrimaryText('发表');
    if (r === 'CLICKED') { console.log('  点 发表(确认) step', step); await sleep(2500); continue; }
    // 再点「继续发表」（群发通知/中间确认弹窗）
    r = await clickPrimaryText('继续发表');
    if (r === 'CLICKED') { console.log('  点 继续发表 step', step); await sleep(2500); continue; }
    // 兜底：扫描视口内任意文字匹配
    const fb = await clickByText(ws, '发表', { after: 1000 }) || await clickByText(ws, '继续发表', { after: 1000 });
    if (fb) { console.log('  兜底点 发表/继续发表 step', step); await sleep(2500); continue; }
    // 无可点弹窗按钮，结束循环
    break;
  }
  const finalUrl = await getUrl(ws);
  if (finalUrl.indexOf('appmsgid=') >= 0 && finalUrl.indexOf('action=edit') < 0) return 'published';
  return 'no_modal';
}

/**
 * 检测并处理微信验证弹窗（人工扫码环节，无法自动）。
 * 检测到后提示用户，轮询等待消失；消失后再点一次「继续发表」收尾。
 */
async function handleWxVerify(ws, onVerify) {
  const hasVerify = await runJS(ws, 'document.body.innerText.indexOf("微信验证")>=0 ? "yes":"no"');
  if (hasVerify !== 'yes') return 'no_verify';

  console.log('⚠️ 需要管理员微信扫码验证');
  console.log('请用管理员微信扫码完成验证，本脚本将自动等待...');
  writeStatus('等待管理员扫码验证');

  for (let i = 0; i < 120; i++) {
    const still = await runJS(ws, 'document.body.innerText.indexOf("微信验证")>=0 ? "yes":"no"');
    if (still !== 'yes') {
      console.log('✅ 验证通过');
      writeStatus('扫码验证通过');
      await sleep(2000);
      const cont = await clickByText(ws, '继续发表', { after: 1500 });
      console.log('  继续发表(扫码后):', cont ? 'clicked' : 'miss');
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

/** 检查结果：出现 appmsgid 且非 action=edit = 成功 */
async function checkPublishResult(ws) {
  const url = await getUrl(ws);
  console.log('最终URL:', url);
  if (url.indexOf('appmsgid=') >= 0 && url.indexOf('action=edit') < 0) return 'success';
  if (url.indexOf('appmsgid=') >= 0) return 'pending';
  return 'unknown';
}

module.exports = {
  WORKSPACE, STATUS_FILE, CDP_PORT_DEFAULT, EDITOR_URL_BASE,
  sleep, writeStatus,
  connectCDP, cdpCall, runJS, screenshotTo, getUrl, getTitle, navigate,
  cdpClick, getCenter, scanTextCenter, clickByText, clickBySelector,
  waitForEditor, getToken, fillTitle, fillBody, checkBodyLen, checkTitle,
  aiCoverFlow,
  clickPublishBtn, handlePublishConfirm, handleWxVerify, checkPublishResult
};
