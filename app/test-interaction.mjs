import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failures.push(name);
}
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('CONSOLE', msg.type(), msg.text()); });
page.on('pageerror', (err) => { console.log('PAGEERROR', err.message); failures.push('pageerror'); });

await page.goto((process.env.BASE || 'http://127.0.0.1:5199') + '/?t=1&still=1&theme=night', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.body.classList.contains('loaded'));
await page.waitForTimeout(800);
check('8 个站点', (await page.locator('.stop-row').count()) === 8);
check('时间轴停在吴起', (await page.textContent('#tlStation')).includes('第 8 / 8 站'));
check('数据卡显示当前海拔', /^[\d,]+$/.test((await page.textContent('#dhAlt')).trim()));
check('时间轴显示总里程', (await page.textContent('#tlDist')).includes('25,000'));
check('图例可见', await page.locator('.mapinfo').isVisible());

await page.click('#stopsToggle');
check('站点列表可收起', !(await page.locator('#stops').evaluate((el) => el.classList.contains('open'))));
await page.click('#stopsToggle');
check('站点列表可展开', await page.locator('#stops').evaluate((el) => el.classList.contains('open')));

// 点击后先俯冲，落地后才出现信息页
await page.locator('.lbl-box', { hasText: '遵义' }).click();
await page.waitForTimeout(500);
check('俯冲期间信息页未出现', !(await page.locator('#card').evaluate((el) => el.classList.contains('open'))));
await page.waitForTimeout(1800);
check('俯冲结束进入信息页', await page.locator('#card').evaluate((el) => el.classList.contains('open') && el.classList.contains('story')));
check('信息页：遵义会议', (await page.textContent('#cardTitle')).includes('遵义会议'));
check('卡片要点 3 条', (await page.locator('#cardFacts .fact').count()) === 3);
check('定位小图已绘制', await page.evaluate(() => {
  const c = document.getElementById('locator');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n > 800;
}));
check('进度随信息页同步', (await page.textContent('#tlStation')).includes('第 3 / 8 站'));
check('页码 03 / 08', (await page.textContent('#storyIndex')).includes('03 / 08'));
check('信息页背景为站点照片', (await page.getAttribute('#cardImg', 'src')).startsWith('data:image'));
check('底层 HUD 已隐藏', (await page.locator('.timeline').evaluate((el) => getComputedStyle(el).opacity)) === '0');

await page.click('#storyNext');
await page.waitForTimeout(400);
check('下一站：四渡赤水', (await page.textContent('#cardTitle')).includes('四渡赤水'));
await page.click('#storyPrev');
await page.waitForTimeout(400);
check('上一站：遵义', (await page.textContent('#cardTitle')).includes('遵义会议'));

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
check('信息页方向键切换', (await page.textContent('#cardTitle')).includes('四渡赤水'));
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(300);

await page.click('#storyBack');
await page.waitForTimeout(1200);
check('返回沙盘', !(await page.locator('#card').evaluate((el) => el.classList.contains('open'))));
check('信息页关闭后状态复位', await page.evaluate(() => !document.body.classList.contains('story-open') && !document.getElementById('card').classList.contains('story')));

await page.click('.theme-switch button[data-theme="dawn"]');
await page.waitForTimeout(500);
check('晨光主题', await page.evaluate(() => document.body.classList.contains('theme-dawn')));
await page.click('.theme-switch button[data-theme="night"]');
await page.waitForTimeout(300);

check('34 个省级行政区注记', (await page.locator('.prov').count()) === 34);
await page.click('#provBtn');
await page.waitForTimeout(450);
check('省名可隐藏', await page.evaluate(() => Array.from(document.querySelectorAll('.prov')).every((el) => getComputedStyle(el).opacity === '0')));
await page.click('#provBtn');
await page.waitForTimeout(450);
check('省名可恢复', await page.evaluate(() => Array.from(document.querySelectorAll('.prov')).some((el) => getComputedStyle(el).opacity !== '0')));

check('追击路线默认显示', await page.evaluate(() => window.__sbx.pursuitGroup.visible));
await page.click('#pursuitBtn');
await page.waitForTimeout(350);
check('追击路线可隐藏', !(await page.evaluate(() => window.__sbx.pursuitGroup.visible)));
await page.click('#pursuitBtn');
await page.waitForTimeout(350);
check('追击路线可恢复', await page.evaluate(() => window.__sbx.pursuitGroup.visible));

check('6 个途中事件点', (await page.locator('.way-dot').count()) === 6);
check('途中事件点默认显示', await page.evaluate(() => {
  const dot = document.querySelector('.way-dot i');
  return !!dot && getComputedStyle(dot).opacity !== '0' && !document.body.classList.contains('waynotes-off');
}));
await page.evaluate(() => window.__sbx.openWayEvent(0));
await page.waitForTimeout(250);
check('途中事件卡：通道转兵', (await page.textContent('#wayTitle')).includes('通道转兵')
  && await page.locator('#wayCard').evaluate((el) => el.classList.contains('open')));
await page.click('#wayClose');
await page.waitForTimeout(250);
check('途中事件卡可关闭', !(await page.locator('#wayCard').evaluate((el) => el.classList.contains('open'))));
await page.click('#wayBtn');
await page.waitForTimeout(300);
check('途中事件点可隐藏', await page.evaluate(() => {
  const dot = document.querySelector('.way-dot i');
  return document.body.classList.contains('waynotes-off') && getComputedStyle(dot).opacity === '0';
}));
await page.click('#wayBtn');

await page.click('#tourBtn');
await page.waitForTimeout(2200);
check('导览启动', (await page.textContent('#tourBtn')).includes('停止') && await page.evaluate(() => window.__sbx.tour.active));
check('导览第一站进入信息页', (await page.textContent('#cardTitle')).includes('瑞金'));
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
check('导览停止', !(await page.evaluate(() => window.__sbx.tour.active)));
check('导览停止后关闭信息页', !(await page.locator('#card').evaluate((el) => el.classList.contains('open'))));

await page.click('#playBtn');
await page.waitForTimeout(1800);
const fill = await page.locator('#tlFill').evaluate((el) => parseFloat(el.style.width) || 0);
check('播放推进进度', fill > 0);
await page.keyboard.press('Space');
await page.waitForTimeout(300);
check('空格暂停', (await page.textContent('#playBtn')).includes('▶'));

await page.locator('.tick', { hasText: '草地' }).click();
await page.waitForTimeout(2200);
check('时间轴节点：草地', (await page.textContent('#cardTitle')).includes('松潘草地'));
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
check('Esc 关闭信息页', !(await page.locator('#card').evaluate((el) => el.classList.contains('open'))));

await browser.close();
if (failures.length) {
  console.log('FAILED:', failures.length, failures.join(' | '));
  process.exitCode = 1;
} else {
  console.log('all interaction checks passed');
}
