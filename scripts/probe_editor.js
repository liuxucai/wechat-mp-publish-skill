#!/usr/bin/env node
/**
 * 公众号编辑器诊断脚本（排障第一步）
 *
 * 用法：node scripts/probe_editor.js [--cdp 9222] [--out .]
 *
 * 输出：当前页面 URL、contenteditable 结构、标题/正文长度、真实插图数、
 *       可见弹窗（含弹窗内按钮文本）、封面预览背景、以及 probe.png 截图。
 * 编辑器改版后先跑本脚本确认选择器是否仍有效，再决定是否调整 publish_pw.js。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const NM = process.env.OPENCLAW_NODE_MODULES
  || path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
const { chromium } = require(path.join(NM, 'playwright-core'));

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const CDP_PORT = arg('--cdp', '9222');
const OUT_DIR = path.resolve(arg('--out', process.cwd()));
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
  const ctx = browser.contexts()[0];
  console.log('== 打开的页面 ==');
  ctx.pages().forEach((p, i) => console.log(' ', i, p.url().slice(0, 110)));

  const page = ctx.pages().find(p => p.url().includes('appmsg_edit'))
    || ctx.pages().find(p => p.url().includes('mp.weixin.qq.com') && !p.url().includes('masssendmodify'));
  if (!page) { console.log('NO_EDITOR_PAGE: 未找到公众号编辑页'); process.exit(0); }
  console.log('\n== 当前页面 ==\n ', page.url());

  const info = await page.evaluate(() => {
    const ced = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .map((el, i) => ({ i, cls: (el.className || '').toString().slice(0, 40), h: el.getBoundingClientRect().height | 0, text: (el.innerText || '').slice(0, 30) }));

    const dialogs = [];
    document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog, .double_check_dialog').forEach(d => {
      const r = d.getBoundingClientRect();
      if (r.width < 10) return;
      const btns = [];
      d.querySelectorAll('button, a, .weui-desktop-btn').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t && el.getBoundingClientRect().width > 0) btns.push(t);
      });
      dialogs.push({ cls: (d.className || '').toString().slice(0, 50), text: (d.innerText || '').replace(/\n/g, '|').slice(0, 200), btns });
    });

    const body = document.querySelectorAll('[contenteditable="true"]')[2];
    const cover = document.querySelector('.js_cover_preview_new');
    return {
      ced,
      dialogs,
      verifyText: document.body.innerText.includes('微信验证'),
      realImgs: body ? Array.from(body.querySelectorAll('img')).filter(im => ((im.getAttribute('src') || '')).includes('qpic.cn')).length : 0,
      allImgs: body ? Array.from(body.querySelectorAll('img')).map(im => ({ src: (im.getAttribute('src') || '').slice(0, 60), cls: (im.className || '').toString().slice(0, 40) })) : [],
      coverBg: cover ? getComputedStyle(cover).backgroundImage.slice(0, 90) : null,
      coverBtn: !!document.querySelector('.select-cover__btn.js_cover_btn_area, .js_cover_btn_area')
    };
  });

  console.log('\n== contenteditable ==\n', JSON.stringify(info.ced, null, 1));
  console.log('\n== 可见弹窗 ==\n', JSON.stringify(info.dialogs, null, 1));
  console.log('\n== 微信验证弹窗在场 ==', info.verifyText);
  console.log('== 正文真实插图数 ==', info.realImgs);
  console.log('== 正文全部 img ==\n', JSON.stringify(info.allImgs, null, 1));
  console.log('== 封面预览背景 ==', info.coverBg);
  console.log('== 封面按钮存在 ==', info.coverBtn);

  const p = path.join(OUT_DIR, 'probe.png');
  try { await page.screenshot({ path: p, timeout: 15000 }); console.log('\n截图:', p); } catch (e) { console.log('\n截图跳过:', (e.message || '').split('\n')[0]); }
  process.exit(0);
})().catch(e => { console.error('ERROR:', (e && e.message) || e); process.exit(1); });
