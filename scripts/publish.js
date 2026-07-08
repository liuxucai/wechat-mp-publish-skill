#!/usr/bin/env node
/**
 * 微信公众号文章发布脚本
 *
 * 用法：
 *   1. 直接运行，按提示交互
 *   2. 设置环境变量自动执行：
 *      $env:WX_TITLE="标题"
 *      $env:WX_BODY="正文HTML"
 *      $env:WX_AI_PROMPT="AI配图描述"
 *      node scripts/publish.js
 */
'use strict';

const lib = require('./lib');
const path = require('path');
const fs = require('fs');

// ==================== 配置 ====================

const CONFIG = {
  browser: 'cft',
  title: process.env.WX_TITLE || '',
  body: process.env.WX_BODY || '',
  aiPrompt: process.env.WX_AI_PROMPT || '网站访问量统计数据分析图表，数据可视化，SEO优化图表，营销分析'
};

// ==================== 正文生成（默认内容）====================

function generateDefaultBody(title) {
  // 如果已通过环境变量设置正文，直接使用
  if (CONFIG.body) return CONFIG.body;

  // 否则生成示例正文（实际使用时应从文件或参数传入）
  return '<p>在当今数字化时代，网站流量是衡量在线业务成功与否的核心指标之一。无论你是个人博主还是企业运营者，提升网站流量都是一项持续性的挑战。本文将为你分享10个经过实践验证的核心策略，帮助你系统性提升网站流量。</p>'
    + '<p><strong>1. 搜索引擎优化（SEO）——打地基</strong><br>SEO是获取免费流量的最佳途径之一。关键在于：关键词研究（使用工具挖掘高搜索量、低竞争的长尾关键词）、站内优化（标题标签、元描述、URL结构、H1-H3层级）、技术优化（页面加载速度、移动端适配、结构化数据标记）。</p>'
    + '<p><strong>2. 高质量内容创作——内容为王</strong><br>内容质量直接决定用户停留时间和分享意愿。建议：深度文章（考虑2000字以上的全面指南）、原创数据（原创调研或行业分析）、视觉优化（搭配信息图和高质量图片）、定期更新（保持内容新鲜度）。</p>'
    + '<p><strong>3. 社交媒体推广——多平台分发</strong><br>每个平台有其独特的内容消费习惯。在微信、微博、知乎、小红书等平台发布精简版内容，引导点击原文链接。关键在于为每个平台定制内容格式，而非简单复制粘贴。</p>'
    + '<p><strong>4. 邮件营销——最被低估的渠道</strong><br>邮件营销的平均ROI高达4200%。建立邮件列表，定期发送有价值的新闻通讯，推荐最新文章。使用个性化标题和分段发送策略，可以显著提升打开率。</p>'
    + '<p><strong>5. 合作互推与客座博客</strong><br>与同领域的其他网站主建立合作关系。互相推荐、交换友情链接，或在对方平台发布原创文章。这种策略不仅能带来直接流量，还能提升域名权威度。</p>'
    + '<p><strong>6. 利用数据分析指导决策</strong><br>使用Google Analytics、百度统计等工具分析用户行为。关注关键指标：页面浏览量、跳出率、平均会话时长、转化率。通过A/B测试优化CTA按钮位置、文案和配色方案。</p>'
    + '<p><strong>7. 内部链接策略——提升网站黏性</strong><br>合理的内链结构能显著降低跳出率。在新文章中引用相关旧文，创建专题内容聚合页，使用面包屑导航让用户轻松浏览深层内容。</p>'
    + '<p><strong>8. 视频内容战略</strong><br>视频内容的消费量正在快速增长。将博客文章转化为短视频或图文解说，发布在B站、抖音等平台。视频描述和评论区可以引导用户访问你的网站，形成流量闭环。</p>'
    + '<p><strong>9. 付费广告加速获客</strong><br>如果预算允许，SEM（搜索引擎竞价广告）、社交媒体广告和信息流广告能快速获取流量。关键要设定精准受众定位，建立转化跟踪，不断优化广告素材和落地页。</p>'
    + '<p><strong>10. 社区运营与用户互动</strong><br>建立你的用户社区（微信群、知识星球等）。培养忠诚用户，鼓励他们分享内容。积极回复评论和私信，与用户建立真实连接。口碑传播是成本最低但效果最长久的流量来源。</p>'
    + '<p><strong>总结</strong><br>网站流量提升没有捷径，是一个需要持续投入的系统工程。建议从SEO和内容创作入手打基础，然后逐步扩展到社交推广和数据优化。关键是始终保持对用户价值的关注，流量只是做好内容的自然结果。</p>';
}

// ==================== 核心流程 ====================

async function main() {
  lib.writeStatus('开始微信公众号发布流程');

  // 1. 获取或确认标题
  if (!CONFIG.title) {
    CONFIG.title = '内容型网站流量提升的10个核心策略';
    console.log('使用默认标题:', CONFIG.title);
  }
  console.log('标题:', CONFIG.title);

  // 2. 生成正文
  CONFIG.body = generateDefaultBody(CONFIG.title);
  console.log('正文长度:', CONFIG.body.length, '字符');

  // 3. 导航到编辑器页面
  lib.writeStatus('正在导航到公众号编辑器...');
  console.log('导航到', lib.EDITOR_URL);
  await lib.evalB64('window.location.href="' + lib.EDITOR_URL.replace(/"/g, '\\"') + '"', CONFIG.browser);

  // 4. 等待编辑器加载
  lib.writeStatus('等待编辑器加载...');
  var loaded = await lib.waitForEditor(CONFIG.browser);
  if (!loaded) {
    console.error('编辑器加载超时');
    lib.writeStatus('失败：编辑器加载超时');
    return;
  }
  console.log('编辑器加载完成');
  await lib.sleep(2000);

  // 5. 填写标题
  lib.writeStatus('填写标题...');
  var titleResult = await lib.fillTitle(CONFIG.title, CONFIG.browser);
  console.log('标题填写结果:', titleResult);
  await lib.sleep(500);

  // 6. 填写正文
  lib.writeStatus('填写正文...');
  var bodyResult = await lib.fillBody(CONFIG.body, CONFIG.browser);
  console.log('正文填写结果:', bodyResult);
  await lib.sleep(500);

  // 验证正文长度
  var bodyLen = await lib.checkBodyLen(CONFIG.browser);
  console.log('正文长度:', bodyLen, '字符');
  lib.writeStatus('正文已填写，长度: ' + bodyLen);

  // 7. AI配图封面
  lib.writeStatus('开始AI配图封面...');
  console.log('点击图片菜单...');
  var menuRef = await lib.clickImageMenu(CONFIG.browser);
  console.log('图片菜单 ref:', menuRef);
  await lib.sleep(1000);

  console.log('点击AI配图...');
  var aiResult = await lib.clickAiImage(CONFIG.browser);
  console.log('AI配图点击结果:', aiResult);
  await lib.sleep(1000);

  console.log('填写AI prompt...');
  var promptResult = await lib.fillAiPrompt(CONFIG.aiPrompt, CONFIG.browser);
  console.log('prompt填写结果:', promptResult);
  await lib.sleep(500);

  // 点击发送按钮（snapshot 中的 e15 通常是发送按钮）
  console.log('点击发送按钮...');
  await lib.click(CONFIG.browser, 'e15');
  lib.writeStatus('AI配图生成中，等待约30秒...');
  console.log('等待AI生成图片...');

  var imgCount = await lib.waitAiImages(CONFIG.browser);
  console.log('生成图片数:', imgCount);

  if (imgCount > 0) {
    // 默认第一张已选中，点击"使用"按钮
    await lib.sleep(1000);
    console.log('点击"使用"按钮...');
    await lib.click(CONFIG.browser, 'e49');
    await lib.sleep(1500);

    // 编辑封面对话框 → 点击"确认"
    console.log('确认编辑封面...');
    await lib.click(CONFIG.browser, 'e31');
    await lib.sleep(1000);
  } else {
    console.log('AI配图未生成，跳过封面设置');
  }

  lib.writeStatus('封面设置完成');

  // 8. 发表文章
  lib.writeStatus('准备发表...');
  console.log('点击发表按钮...');
  var pubResult = await lib.clickPublishBtn(CONFIG.browser);
  console.log('发表点击结果:', pubResult);
  await lib.sleep(2000);

  // 9. 处理发表确认弹窗
  var hasDialog = await lib.checkDoubleCheckDialog(CONFIG.browser);
  console.log('发表确认弹窗:', hasDialog);

  if (hasDialog === 'yes') {
    // 尝试点击"继续发表"
    lib.writeStatus('点击继续发表...');
    console.log('点击继续发表按钮...');
    var contResult = await lib.clickContinuePublish(CONFIG.browser);
    console.log('继续发表点击结果:', contResult);

    // 等待查看是否需要微信验证
    await lib.sleep(5000);

    var hasVerify = await lib.checkWxVerify(CONFIG.browser);
    if (hasVerify === 'yes') {
      console.log('⚠️ 需要微信扫码验证！');
      lib.writeStatus('需用户扫码验证');
      console.log('请用管理员微信扫码完成验证...');
      console.log('扫码完成后按回车键继续...');

      // 等待用户输入
      await new Promise(function (resolve) {
        process.stdin.once('data', function () { resolve(); });
      });

      // 扫码后可能还需要重新点"继续发表"
      var dialogStill = await lib.checkDoubleCheckDialog(CONFIG.browser);
      if (dialogStill === 'yes') {
        console.log('弹窗还在，重新点击继续发表...');
        await lib.clickContinuePublish(CONFIG.browser);
        await lib.sleep(3000);
      }
    }
  }

  // 10. 检查最终结果
  var finalUrl = await lib.getUrl(CONFIG.browser);
  console.log('最终URL:', finalUrl);

  if (finalUrl && (finalUrl.includes('appmsgid='))) {
    console.log('✅ 发布流程完成');
    lib.writeStatus('发布流程完成: ' + finalUrl);
  } else {
    console.log('⚠️ 发布状态待确认');
    lib.writeStatus('发布状态待确认: ' + finalUrl);
  }
}

// ==================== 入口 ====================

main().then(function () {
  console.log('=== 公众号发布脚本结束 ===');
  process.exit(0);
}).catch(function (err) {
  console.error('❌ 错误:', err.message || err);
  lib.writeStatus('失败: ' + (err.message || '未知错误'));
  process.exit(1);
});
