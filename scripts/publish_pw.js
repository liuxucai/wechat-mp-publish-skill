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
 *   2) playwright-core —— 路径由 ../../isolated-browser/scripts/pathkit.js 运行时探测，
 *      也可设 OPENCLAW_NODE_MODULES 覆盖
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

function loadPlaywright() {
  // 首选：公共解析器（不写死用户名 / 盘符 / 版本号）
  try {
    return require(path.resolve(__dirname, '..', '..', 'isolated-browser', 'scripts', 'pathkit.js')).resolvePlaywright();
  } catch (e) { /* 回退本地探测 */ }
  const NM = process.env.OPENCLAW_NODE_MODULES
    || path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
  return require(path.join(NM, 'playwright-core'));
}

const { chromium } = loadPlaywright();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const flag = k => A.includes(k);

const CDP_PORT = arg('--cdp', process.env.ISOB_CDP_PORT || '9222');
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

/**
 * ⚠️ 视口外坐标点击会落空（2026-10-12 实测，与搜狐发布按钮同一个坑）：
 * page.mouse.click 用的是「视口坐标」，getBoundingClientRect 在元素位于视口外时
 * 返回的 y 远超视口高度，点击打在视口外 → 无任何反应、无报错。
 * 所以两个点击工具都必须先 scrollIntoView 把元素滚进视口、等渲染稳定后**重取坐标**再点。
 */

/** 选择器 + 精确文本，取最后一个可见匹配（最内层元素）后按坐标点击 */
async function clickExact(page, selector, text, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = await page.evaluate(({ selector, text }) => {
      const m = [];
      document.querySelectorAll(selector).forEach(el => {
        if ((el.innerText || '').trim() !== text) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) m.push({ el, x: r.x + r.width / 2, y: r.y + r.height / 2 });
      });
      const t = m.length ? m[m.length - 1] : null;
      if (t && t.el.scrollIntoView) t.el.scrollIntoView({ block: 'center' });
      return t ? { x: t.x, y: t.y } : null;
    }, { selector, text }).catch(() => null);
    if (hit) {
      await sleep(350); // 等滚动/重渲染完成
      const p2 = await page.evaluate(({ selector, text }) => {
        const m = [];
        document.querySelectorAll(selector).forEach(el => {
          if ((el.innerText || '').trim() !== text) return;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) m.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
        });
        return m.length ? m[m.length - 1] : null;
      }, { selector, text }).catch(() => null);
      if (p2) { await page.mouse.click(p2.x, p2.y); return true; }
    }
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
      if (!(r.width > 0 && r.height > 0)) return null;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector).catch(() => null);
    if (p) {
      await sleep(350); // 等滚动/重渲染完成
      const p2 = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return (r.width > 0 && r.height > 0) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }, selector).catch(() => null);
      if (p2) { await page.mouse.click(p2.x, p2.y); return true; }
    }
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

/**
 * 封面（从正文选择）——2026-10-13 实测的新版三步流程：
 *   ① 点封面区 `.select-cover__btn.js_cover_btn_area` → 弹 `pop-opr` 菜单
 *   ② 菜单「从正文选择」→ 弹 `.weui-desktop-dialog_img-picker`「选择图片」
 *      —— **单选**（ctrl 多选无效，实测 2026-10-13）：点 `span.appmsg_content_img.cover`
 *         缩略图选中 → 「下一步」由 disabled 变可用
 *   ③ 弹 `.weui-desktop-dialog`「编辑封面」：左侧 Jcrop 裁剪区 + 右侧两张预览卡
 *        「2.35:1 (消息列表)」「1:1 (转发卡片和公众号主页)」
 *      —— **一张源图派生两张封面**，这就是公众号图文消息的封面上限（图文无三图封面；
 *         三图封面仅「图片消息/小绿书」支持，见 references/troubleshooting.md D7）
 *      → 点「确认」落库
 * 判据：`.js_cover_preview_new` 显示且背景图含 qpic.cn（新流程下也接受 `.card-cover-img` 有图）。
 */
async function setCoverFromContent(page) {
  log('设置封面（从正文选择）...');
  if (!await clickSel(page, '.select-cover__btn.js_cover_btn_area', 5000)
    && !await clickSel(page, '.js_cover_btn_area', 3000)) {
    log('WARN: 未找到封面按钮，跳过封面');
    return false;
  }
  await sleep(2500);
  // 若出现引导/切换账号等干扰弹窗先关掉再重点一次封面按钮
  for (const t of ['我知道了', '取消']) {
    if (await clickInDialogs(page, t)) { log('关闭干扰弹窗:', t); await sleep(1200); }
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
  // 等「下一步」可用再点（未选图时它是 disabled，点了没反应）
  const nextOk = await waitEnabledText(page, '下一步', 8000);
  if (!nextOk) { log('WARN: “下一步”按钮未变为可用，跳过封面'); return false; }
  await clickExact(page, 'button', '下一步', 3000);
  await sleep(3000);
  // 「编辑封面」裁剪步骤 → 确认（老版本可能是 完成/确定）
  let confirmed = false;
  for (const t of ['确认', '完成', '确定']) { if (await clickExact(page, 'button', t, 3000)) { confirmed = true; break; } }
  log(confirmed ? '编辑封面已确认（2.35:1 + 1:1 两张封面）' : 'WARN: 未点到“确认”');
  await sleep(3000);
  const st = await page.evaluate(() => {
    const el = document.querySelector('.js_cover_preview_new');
    const disp = el ? getComputedStyle(el).display : 'none';
    const bg = el ? getComputedStyle(el).backgroundImage : '';
    const cardImgs = Array.from(document.querySelectorAll('.js_cover_preview_new img, .select-splice-cover img, .card-cover-img'))
      .filter(im => ((im.getAttribute('src') || '')).includes('mmbiz.qpic.cn')).length;
    return { disp, bg, cardImgs };
  }).catch(() => ({ disp: 'none', bg: '', cardImgs: 0 }));
  const ok = (st.disp !== 'none' && (st.bg.includes('qpic.cn') || st.cardImgs > 0));
  log(ok ? '封面设置成功' : ('WARN: 封面预览未更新 ' + JSON.stringify(st)));
  await shot(page, 'cover.png');
  return ok;
}

/** 等待某个按钮文本出现且不含 disabled 类 */
async function waitEnabledText(page, text, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const ok = await page.evaluate(t => {
      let en = false;
      document.querySelectorAll('button').forEach(b => {
        if ((b.innerText || '').trim() !== t) return;
        const r = b.getBoundingClientRect();
        if (r.width > 0 && !b.className.includes('disabled')) en = true;
      });
      return en;
    }, text).catch(() => false);
    if (ok) return true;
    await sleep(500);
  }
  return false;
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

  /**
   * 正文模板（三种来源，优先级从高到低）：
   *   1) body_html[]：数组 join 后用 `<!--IMAGE-->` 占位 —— 图片**按占位符位置分布**到段落之间（推荐）
   *   2) body_partA + body_partB：图片**统一插在两段之间**（旧行为，兼容）
   * composeBody() 把占位符按顺序替换成已上传图片的 <p>img</p>；
   * 占位符只有 1 个但图片多张时，全部塞在该处（等价旧行为）；图片多于占位符时多出的追加到末尾。
   */
  let BODY_TEMPLATE = '';
  if (Array.isArray(C.body_html) && C.body_html.length) BODY_TEMPLATE = C.body_html.join('');
  else if (typeof C.body_html === 'string' && C.body_html) BODY_TEMPLATE = C.body_html;
  else BODY_TEMPLATE = partA + '<!--IMAGE-->' + partB;

  function composeBody(imgs) {
    const blocks = imgs.map(h => '<p>' + h + '</p>');
    const marks = (BODY_TEMPLATE.match(/<!--IMAGE-->/g) || []).length;
    if (!marks) return BODY_TEMPLATE + blocks.join('');
    let i = 0;
    let out = BODY_TEMPLATE.replace(/<!--IMAGE-->/g, () => {
      if (i === 0 && marks === 1) { const all = blocks.slice(i); i = blocks.length; return all.join(''); }
      return blocks[i++] || '';
    });
    if (i < blocks.length) out += blocks.slice(i).join('');
    return out;
  }

  // 配图：content.json 的 images[]（或旧的 image）优先；否则按 keyword+tags 从素材库自动挑 Top-N（默认 3 张）
  const { planImages } = require(path.resolve(__dirname, '..', '..', 'isolated-browser', 'scripts', 'post_images.js'));
  const explicit = Array.isArray(C.images) ? C.images : (C.image ? [C.image] : []);
  const plan = planImages({
    explicit, noImage: C.no_image === true, keyword: C.keyword || C.title, tags: C.tags,
    top: C.image_top, dir: C.image_dir,
  });
  const IMAGES = plan.images;
  log(`[配图] ${IMAGES.length} 张（来源 ${plan.source}）`);
  if (plan.detail) plan.detail.chosen.forEach((c, i) => log(`  ${i + 1}) 图${c.number} ${c.name || ''} → ${c.image}`));

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

  await setHTML(page, bodyIdx, BODY_TEMPLATE.replace(/<!--IMAGE-->/g, ''));
  await sleep(1500);

  let inserted = 0;
  if (IMAGES.length) {
    const inputs = await page.$$('input[type=file]');
    let target = null;
    for (const inp of inputs) {
      const accept = await inp.getAttribute('accept').catch(() => null);
      if (accept && accept.includes('image')) { target = inp; break; }
    }
    if (!target && inputs.length) target = inputs[0];
    if (!target) log('WARN: 未找到 input[type=file]，跳过插图');
    else {
      const htmls = [];
      for (let k = 0; k < IMAGES.length; k++) {
        if (!fs.existsSync(IMAGES[k])) { log('WARN: 配图不存在，跳过:', IMAGES[k]); continue; }
        const before = (await realImgs(page, bodyIdx)).length;
        log(`上传插图 ${k + 1}/${IMAGES.length}:`, IMAGES[k]);
        await target.setInputFiles(IMAGES[k]);
        let got = null;
        for (let i = 0; i < 40; i++) {
          await sleep(1500);
          const imgs = await realImgs(page, bodyIdx);
          if (imgs.length > before) { got = imgs[imgs.length - 1]; break; }
        }
        if (got) htmls.push(got); else log(`WARN: 第 ${k + 1} 张插图上传超时`);
      }
      if (htmls.length) {
        inserted = htmls.length;
        await setHTML(page, bodyIdx, composeBody(htmls));
        await sleep(2000);
        log(`正文重组完成（${inserted} 张图片置于段落之间）`);
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
