#!/usr/bin/env node
/**
 * 微信公众号文章发布脚本（CDP 直连版）
 *
 * 用法：
 *   node scripts/publish.js                      # 使用默认内容
 *
 *   自定义内容（环境变量）：
 *   $env:WX_TITLE="你的标题"
 *   $env:WX_BODY="<p>正文HTML</p>"
 *   $env:WX_AI_PROMPT="AI配图描述"
 *   node scripts/publish.js
 *
 * 前置条件：
 *   1. Chrome 已启动并监听 CDP 端口（默认 9230）
 *   2. 已登录微信公众平台（URL 包含 token=）
 */
'use strict';

const lib = require('./lib');
const fs = require('fs');

// ==================== 配置 ====================

const CONFIG = {
  cdpPort: parseInt(process.env.WX_CDP_PORT || '9230'),
  title: process.env.WX_TITLE || '',
  body: process.env.WX_BODY || '',
  aiPrompt: process.env.WX_AI_PROMPT || '网站访问量数据分析图表，数据可视化，SEO流量增长趋势图，科技感蓝色调'
};

// ==================== 正文生成 ====================

function generateDefaultBody(title) {
  if (CONFIG.body) return CONFIG.body;

  return [
    '<p>在当今数字化时代，网站流量是衡量在线业务成功与否的核心指标之一。无论你是个人博主还是企业运营者，提升网站流量都是一项持续性的挑战。本文将为你分享10个经过实践验证的核心策略，帮助你系统性提升网站流量。</p>',
    '<p><strong>1. 搜索引擎优化（SEO）——打地基</strong><br>SEO是获取免费流量的最佳途径之一。关键在于：关键词研究（使用工具挖掘高搜索量、低竞争的长尾关键词）、站内优化（标题标签、元描述、URL结构、H1-H3层级）、技术优化（页面加载速度、移动端适配、结构化数据标记）。</p>',
    '<p><strong>2. 高质量内容创作——内容为王</strong><br>内容质量直接决定用户停留时间和分享意愿。建议：深度文章（考虑2000字以上的全面指南）、原创数据（原创调研或行业分析）、视觉优化（搭配信息图和高质量图片）、定期更新（保持内容新鲜度）。</p>',
    '<p><strong>3. 社交媒体推广——多平台分发</strong><br>每个平台有其独特的内容消费习惯。在微信、微博、知乎、小红书等平台发布精简版内容，引导点击原文链接。关键在于为每个平台定制内容格式，而非简单复制粘贴。</p>',
    '<p><strong>4. 邮件营销——最被低估的渠道</strong><br>邮件营销的平均ROI高达4200%。建立邮件列表，定期发送有价值的新闻通讯，推荐最新文章。使用个性化标题和分段发送策略，可以显著提升打开率。</p>',
    '<p><strong>5. 合作互推与客座博客</strong><br>与同领域的其他网站主建立合作关系。互相推荐、交换友情链接，或在对方平台发布原创文章。这种策略不仅能带来直接流量，还能提升域名权威度。</p>',
    '<p><strong>6. 利用数据分析指导决策</strong><br>使用Google Analytics、百度统计等工具分析用户行为。关注关键指标：页面浏览量、跳出率、平均会话时长、转化率。通过A/B测试优化CTA按钮位置、文案和配色方案。</p>',
    '<p><strong>7. 内部链接策略——提升网站黏性</strong><br>合理的内链结构能显著降低跳出率。在新文章中引用相关旧文，创建专题内容聚合页，使用面包屑导航让用户轻松浏览深层内容。</p>',
    '<p><strong>8. 视频内容战略</strong><br>视频内容的消费量正在快速增长。将博客文章转化为短视频或图文解说，发布在B站、抖音等平台。视频描述和评论区可以引导用户访问你的网站，形成流量闭环。</p>',
    '<p><strong>9. 付费广告加速获客</strong><br>如果预算允许，SEM（搜索引擎竞价广告）、社交媒体广告和信息流广告能快速获取流量。关键要设定精准受众定位，建立转化跟踪，不断优化广告素材和落地页。</p>',
    '<p><strong>10. 社区运营与用户互动</strong><br>建立你的用户社区（微信群、知识星球等）。培养忠诚用户，鼓励他们分享内容。积极回复评论和私信，与用户建立真实连接。口碑传播是成本最低但效果最长久的流量来源。</p>',
    '<p><strong>总结</strong><br>网站流量提升没有捷径，是一个需要持续投入的系统工程。建议从SEO和内容创作入手打基础，然后逐步扩展到社交推广和数据优化。关键是始终保持对用户价值的关注，流量只是做好内容的自然结果。</p>'
  ].join('');
}

// ==================== 主流程 ====================

async function main() {
  lib.writeStatus('开始微信公众号发布流程（CDP v2）');

  console.log('=== 微信公众号发布脚本 v2 ===');
  console.log('CDP 端口:', CONFIG.cdpPort);

  // 0. 连接 Chrome
  console.log('连接 Chrome...');
  const ws = await lib.connectCDP(CONFIG.cdpPort);
  console.log('✅ CDP 已连接');

  // 1. 检查登录状态
  lib.writeStatus('检查登录状态...');
  const token = await lib.getToken(ws);
  if (!token) {
    console.error('❌ 未登录！请先扫码登录微信公众平台');
    lib.writeStatus('失败：未登录');
    ws.close();
    process.exit(1);
  }
  console.log('✅ 已登录, token:', token);

  // 2. 导航到编辑器
  lib.writeStatus('导航到编辑器...');
  const editorUrl = lib.EDITOR_URL_BASE + '&token=' + token;
  console.log('导航到编辑器...');
  await lib.navigate(ws, editorUrl);
  console.log('等待编辑器加载...');

  const loaded = await lib.waitForEditor(ws);
  if (!loaded) {
    console.error('❌ 编辑器加载超时');
    lib.writeStatus('失败：编辑器加载超时');
    ws.close();
    process.exit(1);
  }
  console.log('✅ 编辑器加载完成');

  // 3. 填写标题
  if (!CONFIG.title) {
    CONFIG.title = '内容型网站流量提升的10个核心策略';
  }
  console.log('标题:', CONFIG.title);
  lib.writeStatus('填写标题...');
  await lib.fillTitle(ws, CONFIG.title);
  const titleCheck = await lib.checkTitle(ws);
  console.log('  标题确认:', titleCheck.substring(0, 40));
  await lib.sleep(500);

  // 4. 填写正文
  CONFIG.body = generateDefaultBody(CONFIG.title);
  console.log('正文长度:', CONFIG.body.length, '字符');
  lib.writeStatus('填写正文...');
  await lib.fillBody(ws, CONFIG.body);
  const bodyLen = await lib.checkBodyLen(ws);
  console.log('  正文确认:', bodyLen, '字');

  // 5. AI配图
  lib.writeStatus('AI配图...');
  const coverOk = await lib.aiCoverFlow(ws, CONFIG.aiPrompt);
  if (coverOk) {
    console.log('✅ 封面设置完成');
    lib.writeStatus('AI封面设置完成');
  } else {
    console.log('⚠️ 封面未设置，继续发布流程');
  }

  await lib.sleep(2000);

  // 6. 截图当前状态（AI 封面后的页面）
  const stateFile = lib.WORKSPACE + '\\wx_pre_publish.png';
  try { await lib.screenshotTo(ws, stateFile); console.log('截图:', stateFile); } catch (e) {}

  // 7. 发表
  lib.writeStatus('点击发表...');
  console.log('\n点击发表...');
  const pubResult = await lib.clickPublishBtn(ws);
  console.log('  发表:', pubResult);

  // 8. 处理发表确认弹窗
  const dialogResult = await lib.handlePublishConfirm(ws);
  console.log('  弹窗处理:', dialogResult);

  // 9. 处理微信验证弹窗
  const verifyResult = await lib.handleWxVerify(ws);
  console.log('  验证处理:', verifyResult);

  // 10. 检查最终结果
  await lib.sleep(3000);
  const result = await lib.checkPublishResult(ws);
  console.log('\n=== 发布结果:', result, '===');
  lib.writeStatus('发布结果: ' + result);

  // 最终截图
  try {
    const finalFile = lib.WORKSPACE + '\\wx_final.png';
    await lib.screenshotTo(ws, finalFile);
    console.log('最终截图:', finalFile);
  } catch (e) {}

  ws.close();
  console.log('✅ 流程完成');
}

// ==================== 入口 ====================

main().then(() => {
  console.log('=== 公众号发布脚本结束 ===');
  process.exit(0);
}).catch(err => {
  console.error('❌ 错误:', err.message || err);
  lib.writeStatus('失败: ' + (err.message || '未知错误'));
  process.exit(1);
});
