#!/usr/bin/env node
/**
 * 微信公众号图文一键发布（playwright-core 直连 CDP）
 *
 * 用法：
 *   node scripts/publish_pw.js --content ./content.json --cdp 9222 --out ./out
 *
 * 参数：
 *   --content <file>   内容 JSON（不传则用 cwd/content.json），字段见 content.example.json
 *   --cdp <port>       CDP 端口，默认 9222
 *   --out <dir>        截图/二维码/结果输出目录，默认 cwd
 *   --no-cover         跳过封面设置
 *   --dry-run          填完标题/正文/插图即停（不点发表）
 *   --verify-wait <s>  等待管理员扫码秒数，默认 300
 *
 * 前置：
 *   1) 隔离 Chrome 已后台拉起（isolated-browser/scripts/launch.js，端口 9222，profile 已登录公众号）
 *   2) OPENCLAW_NODE_MODULES 指向含 playwright-core 的 node_modules
 *
 * 关键结论（详见 references/troubleshooting.md）：
 *   - 所有交互必须用受信任输入 page.mouse.click(元素中心)；合成事件在新版编辑器失效
 *   - 按钮按精确文本匹配并取最后一个可见匹配（最内层）
 *   - 插入正文图片：先上传取 img HTML，再与前后正文重组 innerHTML 写回（图片才落在段落之间）
 *   - 成功判定：验证弹窗消失 + URL 同时含 appmsgid= 与 reprint_confirm=0（只看 URL 会误判）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const NM = process.env.OPENCLAW_NODE_MODULES
  || path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
const { chromium } = require(path.join(NM, 'playwright-core'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const flag = k => A.includes(k);

const CDP_PORT = arg('--cdp', '9222');
const CONTENT_PATH = path.resolve(arg('--content', path.join(process.cwd(), 'content.json')));
const OUT_DIR = path.resolve(arg('--out', process.cwd()));
const VERIFY_WAIT_MS = parseInt(arg('--verify-wait', '300'), 10) * 1000;
const DO_COVER = !flag('--no-cover');
const DRY_RUN = flag('--dry-run');

const T0 = Date.now();
const log = (...a) => console.log('[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]', ...a);
fs.mkdirSync(OUT_DIR, { recursive: true });

/** 截图：页面 busy 时 screenshot 会超时，必须限时 + 吞异常，不能中断主流程 */
async function shot(page, name) {
  try { await page.screenshot({ path: path.join(OUT_DIR, name), timeout: 15000 }); return name; }
  catch (e) { log('截图跳过(' + name + '):', (e.message || '').split('\n')[0]); return null; }
}

/* ------------------------- 受信任点击工具 ------------------------- */

/** 选择器 + 精确文本，取最后一个可见匹配（最内层元素）后按坐标点击 */
async function clickExact(page, selector, text, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = await page.evaluate(({ selector, text }) => {
      const m = [];
      document.querySelectorAll(selector).forEach(el => {
        if ((el.innerText || '').trim() !== text) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) m.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      });
      return m.length ? m[m.length - 1] : null;
    }, { selector, text }).catch(() => null);
    if (hit) { await page.mouse.click(hit.x, hit.y); return true; }
    await sleep(400);
  }
  return false;
}

/** 按 CSS 选择器点击元素中心 */
async function clickSel(page, selector, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const p = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, selector).catch(() => null);
    if (p) { await page.mouse.click(p.x, p.y); return true; }
    await sleep(400);
  }
  return false;
}

/* --------------------------- 弹窗工具 --------------------------- */

/** 列出所有可见弹窗及其可见按钮（按钮只在弹窗容器内找，避免误点工具栏同名按钮） */
async function visibleDialogs(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog, .double_check_dialog').forEach(d => {
      const r = d.getBoundingClientRect();
      if (r.width < 10) return;
      const btns = [];
      d.querySelectorAll('button, a, .weui-desktop-btn').forEach(el => {
        const t = (el.innerText || '').trim();
        const br = el.getBoundingClientRect();
        if (t && br.width > 0 && br.height > 0) btns.push({ t, x: br.x + br.width / 2, y: br.y + br.height / 2 });
      });
      out.push({ text: (d.innerText || '').replace(/\n/g, '|').slice(0, 220), btns });
    });
    return out;
  }).catch(() => []);
}

async function clickInDialogs(page, text) {
  const dialogs = await visibleDialogs(page);
  for (const d of dialogs) {
    const hits = d.btns.filter(b => b.t === text);
    if (hits.length) {
      const b = hits[hits.length - 1];
      await page.mouse.click(b.x, b.y);
      return true;
    }
  }
  return false;
}

const hasVerifyDialog = page =>
  page.evaluate(() => document.body.innerText.includes('微信验证')).catch(() => false);

/* --------------------------- 编辑器工具 --------------------------- */

async function cedList(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[contenteditable="true"]'))
    .map((el, i) => ({ i, cls: (el.className || '').toString().slice(0, 40), h: el.getBoundingClientRect().height | 0 })));
}

async function setHTML(page, idx, html) {
  await page.evaluate(({ idx, html }) => {
    const el = document.querySelectorAll('[contenteditable="true"]')[idx];
    el.focus();
    el.innerHTML = html;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { idx, html });
}

async function setText(page, idx, text) {
  await page.evaluate(({ idx, text }) => {
    const el = document.querySelectorAll('[contenteditable="true"]')[idx];
    el.focus();
    el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { idx, text });
}

/** 真实插图（排除 ProseMirror-separator 这类空 src 内部元素） */
async function realImgs(page, idx) {
  return page.evaluate(i => {
    const b = document.querySelectorAll('[contenteditable="true"]')[i];
    if (!b) return [];
    return Array.from(b.querySelectorAll('img'))
      .filter(im => ((im.getAttribute('src') || '')).includes('qpic.cn'))
      .map(im => im.outerHTML);
  }, idx);
}

/* ----------------------------- 封面 ----------------------------- */

async function setCoverFromContent(page) {
  log('设置封面（从正文选择）...');
  if (!await clickSel(page, '.select-cover__btn.js_cover_btn_area', 5000)
    && !await clickSel(page, '.js_cover_btn_area', 3000)) {
    log('WARN: 未找到封面按钮，跳过封面');
    return false;
  }
  await sleep(2500);
  // 若出现引导弹窗先关掉再重点一次封面按钮
  if (await clickInDialogs(page, '我知道了')) {
    await sleep(1500);
    await clickSel(page, '.js_cover_btn_area', 4000);
    await sleep(2500);
  }
  if (!await clickExact(page, 'a.js_selectCoverFromContent', '从正文选择', 6000)
    && !await clickExact(page, 'a', '从正文选择', 3000)) {
    log('WARN: 未找到“从正文选择”菜单项，跳过封面');
    return false;
  }
  await sleep(2500);
  // 缩略图是 SPAN.appmsg_content_img.cover（背景图元素，不是 img）
  if (!await clickSel(page, 'span.appmsg_content_img.cover', 8000)) {
    log('WARN: 未找到正文图片缩略图（正文里是否已有插图？），跳过封面');
    return false;
  }
  await sleep(1500);
  await clickExact(page, 'button', '下一步', 5000);
  await sleep(3000);
  for (const t of ['确认', '完成', '确定']) { if (await clickExact(page, 'button', t, 2500)) break; }
  await sleep(3000);
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.js_cover_preview_new');
    return el ? getComputedStyle(el).backgroundImage : '';
  }).catch(() => '');
  const ok = !!bg && bg.includes('qpic.cn');
  log(ok ? '封面设置成功' : 'WARN: 封面预览未更新');
  await shot(page, 'cover.png');
  return ok;
}

/* --------------------------- 扫码验证 --------------------------- */

async function handleVerify(page) {
  try {
    const data = await page.evaluate(() => {
      const im = document.querySelector('img.qrcode.js_qrcode') || document.querySelector('img.js_qrcode');
      if (!im || !im.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      return c.toDataURL('image/png');
    });
    if (data) {
      const p = path.join(OUT_DIR, 'verify_qr.png');
      fs.writeFileSync(p, Buffer.from(data.split(',')[1], 'base64'));
      log('扫码二维码已保存:', p);
    } else {
      log('WARN: 未取到二维码元素，改用整页截图');
    }
  } catch (e) { log('二维码抓取失败(改用整页截图):', (e.message || '').split('\n')[0]); }

  await shot(page, 'verify_dialog.png');
  console.log('VERIFY_NEEDED: 请管理员微信扫码（最长等待 ' + (VERIFY_WAIT_MS / 1000) + ' 秒）');

  const end = Date.now() + VERIFY_WAIT_MS;
  while (Date.now() < end) {
    if (!await hasVerifyDialog(page)) {
      log('验证弹窗已消失');
      await sleep(3000);
      if (await clickInDialogs(page, '继续发表')) { log('→ 扫码后补点“继续发表”'); await sleep(4000); }
      return true;
    }
    await sleep(3000);
  }
  log('WARN: 扫码等待超时（二维码会过期，需重新走发表流程）');
  return false;
}

/* --------------------------- 发表流程 --------------------------- */

async function publish(page) {
  log('点击发表（button.mass_send）...');
  const ok = await clickSel(page, 'button.mass_send', 6000) || await clickExact(page, 'button', '发表', 3000);
  if (!ok) throw new Error('找不到发表按钮（button.mass_send）');
  const clickAt = Date.now();
  await sleep(4000); // 关键：弹窗可能延迟数秒渲染，不能立刻判定“无需验证”

  let successStreak = 0;
  for (let round = 0; round < 20; round++) {
    const url = page.url();
    const urlOk = url.includes('appmsgid=') && url.includes('reprint_confirm=0');
    const verifying = await hasVerifyDialog(page);

    if (urlOk && !verifying && Date.now() - clickAt > 8000) {
      successStreak++;
      log('URL 已达成功态，二次确认中...（' + successStreak + '/2）');
      if (successStreak >= 2) return 'success';
      await sleep(4000);
      continue;
    }
    successStreak = 0;

    if (verifying) { await handleVerify(page); continue; }

    const dialogs = await visibleDialogs(page);
    if (!dialogs.length) { await sleep(2500); continue; }

    log('弹窗:', dialogs.map(d => d.text).join(' ‖ ').slice(0, 220));
    let clicked = false;
    for (const t of ['无需声明并发表', '无声明并继续发表', '继续发表', '发表', '确定']) {
      if (await clickInDialogs(page, t)) { log('→ 点击弹窗按钮:', t); clicked = true; await sleep(3500); break; }
    }
    if (!clicked) { log('弹窗内无匹配按钮，继续等待...'); await sleep(2500); }
  }
  return 'timeout';
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  if (!fs.existsSync(CONTENT_PATH)) throw new Error('内容文件不存在: ' + CONTENT_PATH);
  const C = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
  const partA = Array.isArray(C.body_partA) ? C.body_partA.join('') : (C.body_partA || '');
  const partB = Array.isArray(C.body_partB) ? C.body_partB.join('') : (C.body_partB || '');
  const imagePath = C.image ? path.resolve(C.image) : null;
  if (imagePath && !fs.existsSync(imagePath)) throw new Error('配图不存在: ' + imagePath);

  log('连接 CDP 127.0.0.1:' + CDP_PORT);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
  const ctx = browser.contexts()[0];
  // 优先复用已有的编辑页；否则选一个公众号页面（排除 masssendmodify，避免打断用户正在编辑的草稿）
  let page = ctx.pages().find(p => p.url().includes('appmsg_edit'))
    || ctx.pages().find(p => p.url().includes('mp.weixin.qq.com') && !p.url().includes('masssendmodify'))
    || await ctx.newPage();

  if (!page.url().includes('token=')) { await page.goto('https://mp.weixin.qq.com/'); await sleep(5000); }
  const token = (page.url().match(/token=(\d+)/) || [])[1];
  if (!token) {
    await shot(page, 'need_login.png');
    console.log('NEED_LOGIN: 公众号未登录，请扫码后重跑（见 ' + path.join(OUT_DIR, 'need_login.png') + '）');
    process.exit(2);
  }
  log('已登录 token=' + token);

  await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&token=' + token);
  await page.waitForSelector('[contenteditable="true"]', { timeout: 60000 });
  await sleep(3000);

  const ces = await cedList(page);
  log('编辑器结构:', JSON.stringify(ces));
  if (ces.length < 2) { await shot(page, 'editor_err.png'); throw new Error('编辑器结构异常（contenteditable 数量 < 2）'); }
  const titleIdx = 0;
  const bodyIdx = ces.length >= 3 ? 2 : 1;

  await setText(page, titleIdx, C.title || '');
  await sleep(800);
  log('标题已填:', C.title);

  await setHTML(page, bodyIdx, partA);
  await sleep(1500);

  let inserted = 0;
  if (imagePath) {
    const inputs = await page.$$('input[type=file]');
    let target = null;
    for (const inp of inputs) {
      const accept = await inp.getAttribute('accept').catch(() => null);
      if (accept && accept.includes('image')) { target = inp; break; }
    }
    if (!target && inputs.length) target = inputs[0];
    if (!target) log('WARN: 未找到 input[type=file]，跳过插图');
    else {
      log('上传插图:', imagePath);
      await target.setInputFiles(imagePath);
      let imgHtml = null;
      for (let i = 0; i < 40; i++) {
        const imgs = await realImgs(page, bodyIdx);
        if (imgs.length) { imgHtml = imgs[0]; break; }
        await sleep(1500);
      }
      if (!imgHtml) log('WARN: 插图上传超时，未插入配图');
      else {
        inserted = 1;
        await setHTML(page, bodyIdx, partA + '<p>' + imgHtml + '</p>' + partB);
        await sleep(2000);
        log('正文重组完成（图片置于段落之间）');
      }
    }
  }

  const bodyLen = await page.evaluate(i => document.querySelectorAll('[contenteditable="true"]')[i].innerText.length, bodyIdx);
  const imgCount = (await realImgs(page, bodyIdx)).length;
  log('正文状态: 字数=' + bodyLen + ' 真实插图数=' + imgCount);
  await shot(page, 'body.png');

  let coverSet = false;
  if (DO_COVER) coverSet = await setCoverFromContent(page);
  else log('已按 --no-cover 跳过封面');

  if (DRY_RUN) {
    log('--dry-run：不发表，流程结束');
    await writeResult({ result: 'dry-run', title: C.title, bodyLen, imgCount, coverSet, url: page.url() });
    return browser.close();
  }

  const result = await publish(page);
  const finalUrl = page.url();
  await shot(page, 'final.png');
  log('最终 URL:', finalUrl);
  if (result === 'success') console.log('PUBLISH_SUCCESS');
  else console.log('PUBLISH_UNCONFIRMED: ' + finalUrl);
  await writeResult({ result, title: C.title, bodyLen, imgCount, coverSet, url: finalUrl });
  return browser.close();
}

async function writeResult(o) {
  const p = path.join(OUT_DIR, 'publish_result.json');
  fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
  log('结果已写入:', p);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('ERROR:', (e && e.message) || e);
  process.exit(1);
});
