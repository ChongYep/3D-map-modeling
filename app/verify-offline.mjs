import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const file = path.resolve('../index.html');
const url = pathToFileURL(file).href + '?still=1&t=1&theme=night';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const failures = [];
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failures.push(name);
};

const remote = [];
const failedReqs = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) remote.push(u);
});
page.on('requestfailed', (r) => failedReqs.push(r.url() + ' -> ' + (r.failure()?.errorText || '?')));
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 60000 });
await page.waitForTimeout(1000);

check('离线加载完成（body.loaded）', true);
check('无外部网络请求', remote.length === 0, remote.join(', '));
check('无失败请求', failedReqs.length === 0, failedReqs.join(', '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '));
check('8 个站点', (await page.locator('.stop-row').count()) === 8);
check('进度 8 / 8', (await page.textContent('#tlStation')).includes('第 8 / 8 站'));
check('时间轴总里程 25,000', (await page.textContent('#tlDist')).includes('25,000'));
check('当前海拔读数', /^[\d,]+$/.test((await page.textContent('#dhAlt')).trim()));
check('WebGL 画布有画面', await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return !!c && c.width > 1000 && c.height > 500;
}));
check('无外链资源标签', await page.evaluate(() => {
  const bad = [...document.querySelectorAll('[src],[href]')].filter((el) => {
    const v = el.getAttribute('src') || el.getAttribute('href') || '';
    return /^(https?:)?\/\//i.test(v);
  });
  return bad.length === 0;
}));

// 信息页在 file:// 下也要能打开
await page.locator('.lbl-box', { hasText: '泸定' }).click();
await page.waitForTimeout(1900);
check('离线打开信息页', await page.locator('#card').evaluate((el) => el.classList.contains('open') && el.classList.contains('story')));
check('信息页标题正确', (await page.textContent('#cardTitle')).includes('飞夺泸定桥'));
const bg = await page.getAttribute('#cardImg', 'src');
check('信息页背景为内嵌图片', !!bg && bg.startsWith('data:image'), (bg || '').slice(0, 24));
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
check('Esc 返回沙盘', !(await page.locator('#card').evaluate((el) => el.classList.contains('open'))));

check('全程仍无外部请求', remote.length === 0, remote.join(', '));
check('全程仍无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '));

await page.screenshot({ path: 'verify-offline.png' });

await browser.close();
console.log(failures.length ? 'FAILED: ' + failures.join(' | ') : 'offline verification passed');
if (failures.length) process.exitCode = 1;
