/* Optional end-to-end UI check. Requires Playwright. */
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const server = spawn(process.env.PYTHON || 'python3', ['serve_macro_lab.py'], {
    cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, PYTHONUNBUFFERED: '1'}
  });
  let browser;
  let errors = '';
  server.stderr.on('data', data => { errors += String(data); });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`server timeout: ${errors}`)), 45000);
      server.stdout.on('data', data => {
        if (String(data).includes('http://127.0.0.1:8011')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.once('exit', code => reject(new Error(`server exited ${code}: ${errors}`)));
    });
    browser = await chromium.launch({args: ['--no-sandbox', '--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:8011');
    assert.equal(await page.locator('.agent-card').count(), 7);
    assert.equal(await page.locator('.principle-card').count(), 9);
    await page.locator('#run-button').click();
    await page.waitForFunction(() => document.querySelector('#run-status')?.textContent.includes('COMPLETE'));
    assert.equal(await page.locator('#score-value').innerText(), '9/9');
    assert.equal(await page.locator('#metric-effects').innerText(), '0');
    assert.equal(await page.locator('#run-button').innerText(), '↻ Run again');
    assert.ok((await page.locator('.trace-event').count()) >= 20);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    if (process.env.SCREENSHOT_PATH) {
      await page.screenshot({path: process.env.SCREENSHOT_PATH, fullPage: true});
    }

    await page.locator('#scenario').selectOption('checkpoint_pause');
    await page.locator('#run-button').click();
    await page.waitForFunction(() => document.querySelector('#run-status')?.textContent.includes('PAUSED'));
    assert.equal(await page.locator('#resume-button').isVisible(), true);
    const toolCount = Number(await page.locator('#metric-tools').innerText());
    await page.locator('#resume-button').click();
    await page.waitForFunction(() => document.querySelector('#run-status')?.textContent.includes('COMPLETE'));
    assert.equal(Number(await page.locator('#metric-tools').innerText()), toolCount);
    assert.equal(await page.locator('#score-value').innerText(), '9/9');

    await page.goto('http://127.0.0.1:8011/architecture');
    await page.waitForSelector('[data-arch-node="director"]');
    assert.equal(await page.locator('[data-plane="agent"]').count(), 7);
    assert.equal(await page.locator('#architecture-canvas').isVisible(), true);
    assert.equal(await page.locator('[data-arch-node]').count(), 26);
    await page.locator('[data-arch-node="governor"]').click();
    assert.equal(await page.locator('#inspector').getAttribute('class'), 'inspector open');
    assert.match(await page.locator('#inspector-principles').innerText(), /P9/);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
