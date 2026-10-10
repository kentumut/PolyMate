import assert from 'node:assert/strict';

// Kent coordinates adding Playwright to the workspace. Until then, a separately
// installed module can run this acceptance journey without lockfile changes.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.STUDY_PREVIEW_ORIGIN || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const results = [];

async function check(name, run, options = {}) {
  const context = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${origin}/dev/study-block`);
    await page.getByRole('heading', { name: 'Study-block dialog preview' }).waitFor();
    await run(page);
    assert.deepEqual(errors, [], 'Unexpected browser errors');
    results.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'failed', error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function open(page, mode = 'create', outcome = 'success') {
  await page.getByLabel('Dialog mode').selectOption(mode);
  await page.getByLabel('Submission outcome').selectOption(outcome);
  await page.getByRole('button', { name: 'Open study-block dialog' }).click();
  await page.locator('dialog').waitFor({ state: 'visible' });
}

const dialog = page => page.locator('dialog');
const request = async page => JSON.parse(await page.getByRole('region', { name: 'Callback inspection' }).locator('pre').first().textContent());
const saved = async page => {
  const text = await page.getByRole('region', { name: 'Callback inspection' }).locator('pre').last().textContent();
  return text.startsWith('{') ? JSON.parse(text) : null;
};
const count = async page => Number((await page.getByRole('heading', { name: /Callback calls:/ }).textContent()).split(':')[1]);
const success = page => dialog(page).getByRole('status').getByText(/Fixture block .*No Google event was saved/).waitFor();

try {
  await check('Create: validation, Zurich timestamps, and duplicate-submit protection', async page => {
    await open(page);
    await dialog(page).getByRole('button', { name: 'Create', exact: true }).click();
    assert.equal(await count(page), 0);
    assert.equal(await dialog(page).getByLabel('Title').getAttribute('aria-invalid'), 'true');
    assert.equal(await dialog(page).getByLabel('Title').evaluate(input => input === document.activeElement), true);
    await dialog(page).getByLabel('Title').fill('  Attempt questions 1–2  ');
    await dialog(page).getByLabel('Start time', { exact: true }).fill('10:00');
    assert.equal(await dialog(page).getByLabel('End time', { exact: true }).inputValue(), '10:50');
    await dialog(page).getByRole('button', { name: 'Create', exact: true }).evaluate(button => { button.click(); button.click(); });
    assert.equal(await dialog(page).getByRole('button', { name: 'Creating…' }).isDisabled(), true);
    await dialog(page).waitFor({ state: 'hidden' });
    assert.equal(await count(page), 1);
    assert.deepEqual(await request(page), { action: 'create', input: {
      title: 'Attempt questions 1–2', startAt: '2026-10-09T08:00:00.000Z', endAt: '2026-10-09T08:50:00.000Z', timezone: 'Europe/Zurich',
    } });
  });

  await check('Edit/move: saved duration, original ETag, and reopened saved values', async page => {
    await open(page, 'edit');
    assert.equal(await dialog(page).getByLabel('End time', { exact: true }).inputValue(), '10:15');
    await dialog(page).getByLabel('Start time', { exact: true }).fill('11:00');
    assert.equal(await dialog(page).getByLabel('End time', { exact: true }).inputValue(), '12:15');
    await dialog(page).getByLabel('Title').fill('New task');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    const sent = await request(page);
    assert.equal(sent.action, 'update');
    assert.equal(sent.eventId, 'fixture-study-block');
    assert.equal(sent.expectedEtag, '"fixture-v1"');
    assert.equal(sent.input.startAt, '2026-10-09T09:00:00.000Z');
    assert.equal(sent.input.endAt, '2026-10-09T10:15:00.000Z');
    const updated = await saved(page);
    assert.notEqual(updated.etag, sent.expectedEtag);
    await open(page, 'edit');
    assert.equal(await dialog(page).getByLabel('Title').inputValue(), 'New task');
    assert.equal(await dialog(page).getByLabel('Start time', { exact: true }).inputValue(), '11:00');
  });

  await check('Custom end is preserved; invalid ranges and DST times cannot submit', async page => {
    await open(page);
    await dialog(page).getByLabel('Title').fill('Task');
    await dialog(page).getByLabel('End time', { exact: true }).fill('12:00');
    await dialog(page).getByLabel('Start time', { exact: true }).fill('13:00');
    assert.equal(await dialog(page).getByLabel('End time', { exact: true }).inputValue(), '12:00');
    await dialog(page).getByRole('button', { name: 'Create', exact: true }).click();
    await dialog(page).getByText('End time must be after start time.').waitFor();
    for (const [date, message] of [['2026-03-29', 'does not exist'], ['2026-10-25', 'occurs twice']]) {
      await dialog(page).getByLabel('Start date', { exact: true }).fill(date);
      await dialog(page).getByLabel('Start time', { exact: true }).fill('02:30');
      await dialog(page).getByRole('button', { name: 'Create', exact: true }).click();
      await dialog(page).getByText(new RegExp(message)).waitFor();
    }
    assert.equal(await count(page), 0);
  });

  await check('Mark done uses saved metadata despite invalid unsaved edits', async page => {
    await open(page, 'edit');
    await dialog(page).getByLabel('Title').fill('');
    await dialog(page).getByText(/You have unsaved edits/).waitFor();
    await dialog(page).getByRole('button', { name: 'Mark done', exact: true }).click();
    await success(page);
    assert.deepEqual(await request(page), { action: 'complete', eventId: 'fixture-study-block', expectedEtag: '"fixture-v1"' });
    assert.equal((await saved(page)).title, 'Attempt algorithms questions 1–2');
    assert.equal((await saved(page)).completion, 'done');
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    await open(page, 'edit');
    assert.equal(await dialog(page).getByRole('button', { name: 'Mark done', exact: true }).count(), 0);
    assert.equal(await dialog(page).getByRole('button', { name: 'Delete', exact: true }).count(), 1);
  });

  await check('Delete cancellation preserves draft, saved details, callback count, and focus', async page => {
    await open(page, 'edit');
    await dialog(page).getByLabel('Title').fill('Unsaved title');
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog(page).getByText('Delete “Attempt algorithms questions 1–2” from the fixture calendar?').waitFor();
    assert.equal(await count(page), 0);
    assert.equal(await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).evaluate(button => button === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog(page).getByLabel('Title').inputValue(), 'Unsaved title');
    assert.equal(await dialog(page).getByRole('button', { name: 'Delete', exact: true }).evaluate(button => button === document.activeElement), true);
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await count(page), 0);
    assert.equal(await dialog(page).getByLabel('Title').inputValue(), 'Unsaved title');
  });

  await check('Confirmed deletion removes only the saved fixture and prevents reopening', async page => {
    await open(page, 'edit');
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).evaluate(button => { button.click(); button.click(); });
    assert.notEqual(await saved(page), null);
    await success(page);
    assert.equal(await count(page), 1);
    assert.deepEqual(await request(page), { action: 'delete', eventId: 'fixture-study-block', expectedEtag: '"fixture-v1"' });
    assert.equal(await saved(page), null);
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Open study-block dialog' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Reset saved fixture' }).click();
    assert.equal(await page.getByRole('button', { name: 'Open study-block dialog' }).isEnabled(), true);
  });

  for (const action of ['update', 'complete', 'delete']) {
    await check(`Failed ${action} preserves saved data and allows recovery`, async page => {
      await open(page, 'edit', 'failure');
      if (action === 'update') await dialog(page).getByLabel('Title').fill('Unsaved edit');
      const button = action === 'update' ? 'Save' : action === 'complete' ? 'Mark done' : 'Delete';
      await dialog(page).getByRole('button', { name: button, exact: true }).click();
      if (action === 'delete') await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
      await dialog(page).getByRole('status').getByText(/Simulated/).waitFor();
      assert.equal((await saved(page)).completion, 'open');
      assert.equal((await saved(page)).etag, '"fixture-v1"');
      assert.equal((await saved(page)).title, 'Attempt algorithms questions 1–2');
      assert.equal(await dialog(page).getByRole('button', { name: button, exact: true }).isEnabled(), true);
      if (action === 'update') assert.equal(await dialog(page).getByLabel('Title').inputValue(), 'Unsaved edit');
    });
  }

  for (const outcome of ['unknown', 'throws']) {
    await check(`${outcome} deletion remains uncertain, preserves data, and blocks repeat writes`, async page => {
      await open(page, 'edit', outcome);
      await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
      await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
      await dialog(page).getByRole('status').getByText(/Uncertain:/).waitFor();
      assert.equal(await dialog(page).getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true);
      assert.notEqual(await saved(page), null);
      assert.equal(await count(page), 1);
    });
  }

  await check('Returned pending completion stays unconfirmed until the adapter resolves it', async page => {
    await open(page, 'edit', 'pending');
    await dialog(page).getByRole('button', { name: 'Mark done', exact: true }).click();
    await page.waitForTimeout(1600);
    assert.equal((await saved(page)).completion, 'open');
    assert.equal(await dialog(page).getByRole('button', { name: 'Marking done…' }).isDisabled(), true);
    await success(page);
    assert.equal((await saved(page)).completion, 'done');
  });

  await check('Personal events have no mutation controls', async page => {
    await open(page, 'personal');
    assert.equal(await dialog(page).getByLabel('Title').isDisabled(), true);
    for (const name of ['Save', 'Create', 'Mark done', 'Delete']) assert.equal(await dialog(page).getByRole('button', { name, exact: true }).count(), 0);
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await count(page), 0);
  });

  await check('Mobile layout and modal keyboard containment', async page => {
    await open(page, 'edit');
    const box = await dialog(page).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.height <= 844);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog(page).evaluate(element => element.contains(document.activeElement)), true);
    }
    if (process.env.STUDY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.STUDY_SCREENSHOT_DIR}/study-dialog-mobile.png` });
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    if (process.env.STUDY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.STUDY_SCREENSHOT_DIR}/study-dialog-delete.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Open study-block dialog' }).evaluate(button => button === document.activeElement), true);
  }, { viewport: { width: 390, height: 844 } });
} finally {
  await browser.close();
}

console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.status === 'passed').length, results }, null, 2));
if (results.some(result => result.status === 'failed')) process.exitCode = 1;
