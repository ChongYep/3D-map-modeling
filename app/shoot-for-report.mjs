import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = '../docs/screenshots';
fs.mkdirSync(outDir, { recursive: true });
const out = (name) => `${outDir}/${name}`;

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));

await page.goto('http://127.0.0.1:5199/?t=1&still=1&theme=night', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.body.classList.contains('loaded'));
await page.waitForTimeout(900);
await page.screenshot({ path: out('01-全路线.png') });

// 02：点击站点，保留俯冲，落地后进入全屏信息页
await page.locator('.lbl-box', { hasText: '遵义' }).click();
await page.waitForTimeout(2800);
await page.screenshot({ path: out('02-遵义会议.png') });

// 03：信息页内切到草地（不重新俯冲）
await page.evaluate(() => window.__sbx.selectEvent(6, { fly: false }));
await page.waitForTimeout(1100);
await page.screenshot({ path: out('03-松潘草地.png') });

// 04：低角度 3/4 视角，只留红军主线，展示地形起伏
await page.goto('http://127.0.0.1:5199/?t=1&still=1&theme=night&pursuit=0', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.body.classList.contains('loaded'));
await page.waitForTimeout(700);
await page.evaluate(() => {
  const s = window.__sbx;
  s.controls.autoRotate = false;
  s.controls.enabled = true;
  s.camera.position.set(10, 30, 54);
  s.controls.target.set(-6, 2, 2);
  s.controls.update();
});
await page.waitForTimeout(900);
await page.screenshot({ path: out('04-地形立体视角.png') });

// 05：西南近景，红军主线与薛岳部追击路线同框
await page.goto('http://127.0.0.1:5199/?t=1&still=1&theme=night&pursuit=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.body.classList.contains('loaded'));
await page.waitForTimeout(700);
await page.evaluate(() => {
  const s = window.__sbx;
  s.controls.autoRotate = false;
  s.controls.enabled = true;
  s.camera.position.set(-2, 24, 34);
  s.controls.target.set(-10, 2, 10);
  s.controls.update();
});
await page.waitForTimeout(900);
await page.screenshot({ path: out('05-追堵态势.png') });

// 06：途中次级事件小卡（通道转兵）
await page.goto('http://127.0.0.1:5199/?t=1&still=1&theme=night', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.body.classList.contains('loaded'));
await page.waitForTimeout(700);
await page.evaluate(() => window.__sbx.openWayEvent(0));
await page.waitForTimeout(500);
await page.screenshot({ path: out('06-途中事件.png') });

await browser.close();
console.log('shots done: 01-06 ->', outDir);
