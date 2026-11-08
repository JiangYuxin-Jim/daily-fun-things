const { chromium } = require('/tmp/node_modules/playwright');
const Core = require('/home/admin/code/daily-fun-things/2026-11-09-wordle/core.js');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', m => console.log('[page]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:8937/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 1) 浏览器里直接跑评分，和 node 对比
  const inPage = await page.evaluate(() => {
    const C = window.WordleCore;
    return {
      poppy: C.scoreGuess('poppy', 'apple'),
      crane: C.scoreGuess('crane', 'slate'),
      allee: C.scoreGuess('allee', 'apple'),
      kb: C.keyboardStates([{ guess: 'crane', states: [2, 0, 1, 0, 0] }, { guess: 'cried', states: [2, 1, 0, 2, 0] }])
    };
  });
  console.log('browser poppy', JSON.stringify(inPage.poppy));
  console.log('browser crane', JSON.stringify(inPage.crane));
  console.log('browser allee', JSON.stringify(inPage.allee));
  console.log('browser kb', JSON.stringify(inPage.kb));
  console.log('node    poppy', JSON.stringify(Core.scoreGuess('poppy', 'apple')));

  // 2) 真实交互：输入答案，检查格子颜色
  const answer = await page.evaluate(() => window.Jinzi._state().answer);
  console.log('today answer', answer);
  for (const ch of answer) await page.keyboard.press(ch);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  const tiles = await page.$$eval('.tile', els => els.slice(0, 5).map(e => e.className));
  console.log('tiles after win:', JSON.stringify(tiles));
  const overlayShown = await page.$eval('#overlay', e => e.classList.contains('show'));
  console.log('overlay shown:', overlayShown);
  const cardText = await page.$eval('#card', e => e.textContent.slice(0, 120));
  console.log('card:', cardText.replace(/\s+/g, ' '));

  // 3) 提示按钮
  await page.evaluate(() => { window.Jinzi._newGame({ mode: 'practice', hard: false }); });
  await page.click('#btnHint');
  const hint = await page.$eval('#hintbar', e => e.textContent);
  console.log('hint:', hint);

  // 4) 非法词提示
  for (const ch of 'zzzzz') await page.keyboard.press(ch);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  console.log('toast:', await page.$eval('#toast', e => e.textContent));
  console.log('rows:', await page.evaluate(() => window.Jinzi._state().rows.length));

  await page.screenshot({ path: '/home/admin/code/daily-fun-things/2026-11-09-wordle/preview.png', fullPage: false });
  await browser.close();
})();
