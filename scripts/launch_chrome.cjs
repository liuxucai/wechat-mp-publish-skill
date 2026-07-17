#!/usr/bin/env node
/**
 * 启动与用户默认 Chrome 完全隔离的独立 Chrome 实例（用于微信公众号发布 CDP 直连）。
 *
 * 用法：
 *   node launch_chrome.cjs            # 默认 CDP 端口 9230，打开 mp.weixin.qq.com
 *   node launch_chrome.cjs 9231       # 指定端口
 *
 * profile 固定为 ~/.chrome_qclaw_stable（用户主目录下），
 * 与默认 User Data 互不干扰，登录态可长期复用。
 *
 * 依赖：系统稳定版 Chrome、Node.js。不依赖 xb CLI。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// CDP 端口：命令行第一个参数，否则 9230（与公众号 skill 约定一致）
const CDP_PORT = parseInt(process.argv[2] || '9230', 10);
// profile 固定为当前用户主目录下的 .chrome_qclaw_stable
const PROFILE_DIR = process.env.ISOB_PROFILE_DIR
  || path.join(os.homedir(), '.chrome_qclaw_stable');

// 解析 Chrome 可执行文件
function findChrome() {
  const cands = [
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'chrome'; // 期望在 PATH 中
}

const chrome = findChrome();

if (!fs.existsSync(chrome)) {
  console.error('找不到 Chrome 可执行文件:', chrome);
  console.error('  请设置 AGENT_BROWSER_EXECUTABLE_PATH 指向稳定版 Chrome，或将 Chrome 加入 PATH。');
  process.exit(1);
}

fs.mkdirSync(PROFILE_DIR, { recursive: true });

const args = [
  '--new-instance',                                  // 独立进程
  `--user-data-dir=${PROFILE_DIR}`,                  // 固定隔离 profile
  `--remote-debugging-port=${CDP_PORT}`,             // 开放 CDP，供 publish.js ws 直连
  '--no-first-run',
  '--no-default-browser-check',
  process.argv[3] || 'https://mp.weixin.qq.com/',    // 起始 URL（默认打开公众号首页）
];

console.log('=== 启动隔离 Chrome 实例（微信公众号发布） ===');
console.log('Chrome  :', chrome);
console.log('Profile :', PROFILE_DIR);
console.log('CDP端口 :', CDP_PORT);
console.log('');

const child = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();

child.on('error', (e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});

// 给一点时间让进程起来
setTimeout(() => {
  console.log(`已发起隔离 Chrome（PID ${child.pid}）。`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 在打开的窗口中手动登录微信公众平台（不填密码，由用户操作）');
  console.log('  2. 登录完成后运行发布脚本：');
  console.log(`     node scripts/publish.js`);
  console.log('  或带环境变量自定义内容：');
  console.log(`     $env:WX_TITLE="标题"; $env:WX_BODY="<p>HTML正文</p>"; node scripts/publish.js`);
  console.log('');
  console.log('注意：该实例使用 ~/.chrome_qclaw_stable 作为隔离 profile，与你的默认浏览器登录态互不干扰，可长期使用、避免重复登录。');
}, 1500);
