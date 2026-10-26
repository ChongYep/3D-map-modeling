import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5201';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const failures = [];
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failures.push(name);
};

// ≤1180 收起统计 / 站点列表 / 数据卡 / 图例；≤820 另外收起署名
const cases = [
  { name: '1920', w: 1920, h: 1080, hidden: [] },
  { name: '1366', w: 1366, h: 768, hidden: [] },
  { name: '1024', w: 1024, h: 768, hidden: ['stats', 'stops', 'data', 'mapinfo'] },
  { name: 'mobile', w: 390, h: 844, hidden: ['stats', 'stops', 'data', 'mapinfo', 'credit'], mobile: true },
];

for (const s of cases) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 1,
    isMobile: !!s.mobile,
    hasTouch: !!s.mobile,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${BASE}/?t=1&still=1&theme=night`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 60000 });
  await page.waitForTimeout(900);

  const tag = `[${s.name}] `;
  check(tag + '无报错', errs.length === 0, errs.join(' | '));
  check(tag + '无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
  check(tag + '画布铺满视口', await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
  }));

  const box = async (sel) => page.locator(sel).first().boundingBox().catch(() => null);
  const pairs = [
    ['title', '.hud.top'],
    ['stats', '.hud.stats'],
    ['stops', '#stops'],
    ['timeline', '.timeline'],
    ['data', '.data-hud'],
    ['mapinfo', '.mapinfo'],
    ['credit', '.attribution'],
  ];
  const boxes = {};
  const hiddenOk = [];
  for (const [k, sel] of pairs) {
    boxes[k] = await box(sel);
    if (s.hidden.includes(k)) {
      hiddenOk.push(boxes[k] === null);
      continue;
    }
    const b = boxes[k];
    if (!b) { check(tag + k + ' 存在', false); continue; }
    check(tag + k + ' 在视口内', b.x >= -2 && b.y >= -2 && b.x + b.width <= s.w + 2 && b.y + b.height <= s.h + 2,
      `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  if (s.hidden.length) check(tag + '窄屏按设计收起：' + s.hidden.join('/'), hiddenOk.every(Boolean));

  const overlaps = (a, b) => a && b && a.x < b.x + b.width - 2 && b.x < a.x + a.width - 2 && a.y < b.y + b.height - 2 && b.y < a.y + a.height - 2;
  if (!s.hidden.includes('stats')) check(tag + '标题与统计不重叠', !overlaps(boxes.title, boxes.stats));
  if (!s.hidden.includes('data')) check(tag + '统计与数据卡不重叠', !overlaps(boxes.stats, boxes.data));
  if (!s.hidden.includes('stops')) check(tag + '站点列表与时间轴不重叠', !overlaps(boxes.stops, boxes.timeline));
  if (!s.hidden.includes('mapinfo')) check(tag + '时间轴与图例不重叠', !overlaps(boxes.timeline, boxes.mapinfo));
  if (!s.hidden.includes('credit')) check(tag + '时间轴与署名不重叠', !overlaps(boxes.timeline, boxes.credit));
  check(tag + '进度 8 / 8', (await page.textContent('#tlStation')).includes('第 8 / 8 站') || s.mobile);

  await page.screenshot({ path: `resp-${s.name}.png` });

  // 信息页
  const lbl = page.locator('.lbl-box', { hasText: '遵义' }).first();
  if (await lbl.count()) {
    await lbl.click({ force: true });
    await page.waitForTimeout(2100);
    const open = await page.locator('#card').evaluate((el) => el.classList.contains('open')).catch(() => false);
    check(tag + '信息页可打开', open);
    if (open) {
      const body = await box('.card-body');
      const card = await box('#card');
      const isMobile = !!s.mobile;
      check(tag + '信息页铺满视口', !!card && Math.abs(card.width - s.w) <= 2 && Math.abs(card.height - s.h) <= 2,
        card ? `${Math.round(card.width)}x${Math.round(card.height)}` : 'null');
      if (isMobile) {
        check(tag + '信息页可滚动', await page.locator('#card').evaluate((el) => el.scrollHeight > el.clientHeight + 4));
        await page.locator('#card').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(400);
        check(tag + '滚动到底可见资料来源', await page.evaluate(() => {
          const src = document.getElementById('cardSource');
          const r = src.getBoundingClientRect();
          return r.top < window.innerHeight - 60 && r.bottom > 0;
        }));
        await page.screenshot({ path: `resp-${s.name}-story.png` });
      } else {
        check(tag + '信息正文在视口内', !!body && body.x >= -2 && body.y >= -2 && body.x + body.width <= s.w + 2 && body.y + body.height <= s.h + 2,
          body ? `${Math.round(body.x)},${Math.round(body.y)} ${Math.round(body.width)}x${Math.round(body.height)}` : 'null');
        const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#cardText')).fontSize));
        check(tag + '正文字号 >= 15', fs >= 15, fs + 'px');
        check(tag + '正文未被裁切', await page.locator('.card-body').evaluate((el) => el.scrollHeight - el.clientHeight <= 2));
        await page.screenshot({ path: `resp-${s.name}-story.png` });
      }
      check(tag + '导航按钮可见', await page.locator('#storyNext').isVisible());
      await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(failures.length ? 'FAILED: ' + failures.join(' | ') : 'responsive checks passed');
if (failures.length) process.exitCode = 1;
