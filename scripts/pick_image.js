#!/usr/bin/env node
/**
 * 素材图匹配脚本 —— 按文章标签从素材库 pic-tag.txt 中挑出最匹配的一张配图
 *
 * 用法：
 *   node scripts/pick_image.js --tags "婚庆用车,婚庆婚车车队" --keyword 婚车租车 [--dir D:/skills/car]
 *   node scripts/pick_image.js --tags "..." --pick 11          # 复核后强制指定图片编号
 *
 * 规则与两个指标：
 *   1) tagScore   —— 标签在 pic-tag.txt 块内的**精确命中数**（字面匹配，最可靠）
 *   2) themeHits  —— 关键词主题词（关键词切出的 2-gram）在块内的出现**次数**（主题贴近度）
 *   默认推荐 = tagScore 最高者，同分时比 themeHits；
 *   tagScore 全为 0 → 取 themeHits 最高者；两者都全 0 → **随机挑一张**。
 *
 * ⚠️ 实测教训：字面命中的候选可能是"通用素材"而非主题画面。
 *    2026-09-29 婚车租车案例中，图14 字面命中两个标签（一站式租车服务），
 *    但图11（宾利婚车/鲜花装饰/爱心气球 的婚嫁专属婚车车队）主题更贴。
 *    因此：**推荐结果需看图复核，不符时用 --pick N 覆盖**。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const flag = k => A.includes(k);

const DIR = arg('--dir', 'D:/skills/car');
const PIC_TAG = path.join(DIR, arg('--picfile', 'pic-tag.txt'));
const TAG_FILE = path.join(DIR, arg('--tagfile', 'tag.txt'));
const KEYWORD = (arg('--keyword', '') || '').trim();
const PICK = parseInt(arg('--pick', '0'), 10) || 0;
const TAGS = (arg('--tags', '') || '').split(/[,，、|]/).map(s => s.trim()).filter(Boolean);

if (!TAGS.length) { console.error('用法: node pick_image.js --tags "标签1,标签2" [--keyword 关键词] [--dir D:/skills/car] [--pick N]'); process.exit(1); }
if (!fs.existsSync(PIC_TAG)) { console.error('未找到图片标签库:', PIC_TAG); process.exit(1); }

const norm = s => (s || '').replace(/[\s\u3000]/g, '');

// 1) 标签合法性校验（不在 tag.txt 中的标签给出警告，但仍参与匹配）
if (fs.existsSync(TAG_FILE)) {
  const known = norm(fs.readFileSync(TAG_FILE, 'utf8'));
  TAGS.forEach(t => { if (!known.includes(norm(t))) console.error('WARN: 标签不在 tag.txt 中 —— ' + t); });
} else {
  console.error('WARN: 未找到文章标签库:', TAG_FILE);
}

// 2) 解析图片标签块（## 图 N（名称））
const lines = fs.readFileSync(PIC_TAG, 'utf8').split(/\r?\n/);
const blocks = [];
let cur = null;
for (const line of lines) {
  const m = line.match(/^#{1,2}\s*图\s*(\d+)\s*(?:[（(](.*?)[）)])?/);
  if (m) { cur = { n: parseInt(m[1], 10), name: (m[2] || '').trim(), raw: line }; blocks.push(cur); continue; }
  if (cur) cur.raw += '\n' + line;
}
if (!blocks.length) { console.error('pic-tag.txt 解析为空（需要 "## 图 N（名称）" 形式的标题）'); process.exit(1); }

// 3) 编号 → 图片文件
const byNum = {};
fs.readdirSync(DIR).filter(f => /^\d+\.(jpe?g|png|webp)$/i.test(f)).forEach(f => { byNum[parseInt(f, 10)] = path.join(DIR, f); });

// 4) 主题词：关键词切出的 2-gram（去重），用于 themeHits
const themeTokens = [];
if (KEYWORD) {
  const k = norm(KEYWORD);
  for (let i = 0; i + 2 <= k.length; i++) {
    const g = k.slice(i, i + 2);
    if (!themeTokens.includes(g)) themeTokens.push(g);
  }
}
const countOccur = (text, sub) => { let c = 0, i = 0; while ((i = text.indexOf(sub, i)) !== -1) { c++; i += sub.length; } return c; };

// 5) 打分
const scored = blocks.map(b => {
  const blob = norm(b.raw);
  const hits = TAGS.filter(t => blob.includes(norm(t)));
  const themeHits = themeTokens.reduce((s, g) => s + countOccur(blob, g), 0);
  return { n: b.n, name: b.name, tagScore: hits.length, hits, themeHits, image: byNum[b.n] || null };
}).filter(s => s.image);

if (!scored.length) { console.error('素材库中没有与图片编号对应的图片文件'); process.exit(1); }

scored.sort((a, b) => b.tagScore - a.tagScore || b.themeHits - a.themeHits || a.n - b.n);

// 6) 选择
let mode, chosen;
if (PICK) {
  chosen = scored.find(s => s.n === PICK);
  if (!chosen) { console.error('--pick 指定的图号不存在:', PICK); process.exit(1); }
  mode = 'manual';
} else if (scored[0].tagScore > 0) {
  chosen = scored[0]; mode = 'tag';
} else if (scored[0].themeHits > 0) {
  chosen = scored[0]; mode = 'theme';
} else {
  chosen = scored[Math.floor(Math.random() * scored.length)]; mode = 'random';
}

const result = {
  mode,                                  // tag=字面命中 | theme=关键词主题贴近 | random=都不匹配→随机 | manual=--pick 指定
  tags: TAGS,
  keyword: KEYWORD || null,
  chosen: { number: chosen.n, name: chosen.name, tagScore: chosen.tagScore, matches: chosen.hits, themeHits: chosen.themeHits, image: chosen.image },
  ranking: scored.slice(0, 5).map(s => ({ n: s.n, name: s.name, tagScore: s.tagScore, themeHits: s.themeHits, matches: s.hits })),
  note: '字面命中的候选可能是通用素材，请看图复核主题一致性；不符时用 --pick N 覆盖'
};

if (flag('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('标签:', TAGS.join('、'), KEYWORD ? '| 关键词:' + KEYWORD : '');
  console.log('模式:', { tag: '标签字面命中', theme: '关键词主题贴近', random: '无匹配 → 随机挑选', manual: '指定图片（--pick）' }[mode]);
  console.log('选中: 图 ' + chosen.n + (chosen.name ? '（' + chosen.name + '）' : '') +
    ' | 标签命中 ' + chosen.tagScore + (chosen.hits.length ? '（' + chosen.hits.join('、') + '）' : '') +
    ' | 主题词 ' + chosen.themeHits);
  console.log('图片:', chosen.image);
  console.log('候选前 5:', scored.slice(0, 5).map(s => '图' + s.n + '[标签' + s.tagScore + '/主题' + s.themeHits + ']').join(' > '));
  console.log('提示:', result.note);
}
