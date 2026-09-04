/**
 * Debug screenshot via CDP into the user's Windows browser.
 *
 * Usage:
 *   node scripts/shot.mjs [outPath] [--eval <js>] [--wait <ms>] [--click x,y]
 *                                          [--drag ax,ay,bx,by]
 *
 * Requires an Edge/Chrome instance started with --remote-debugging-port=9222.
 * WSL mirrored networking makes 127.0.0.1 reach the Windows host directly.
 * Edge must launch with its own --user-data-dir or the flag is ignored.
 *
 * Coordinates for --click/--drag are CSS px (same space as app logic).
 * Screenshots come back scaled ~1.94x — divide by (width/innerWidth) before
 * feeding pixel positions from a capture back into this script.
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const out = args.find((a, i) => !a.startsWith('-') && i === 0) ?? 'tmp/shot.png';
const waitIdx = args.indexOf('--wait');
const waitMs = waitIdx >= 0 ? Number(args[waitIdx + 1] ?? 400) : 400;
const clickIdx = args.indexOf('--click');
const click = clickIdx >= 0 ? args[clickIdx + 1]?.split(',').map(Number) : null;
const dragIdx = args.indexOf('--drag');
const drag = dragIdx >= 0 ? args[dragIdx + 1]?.split(',').map(Number) : null;

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes('localhost:5173'));
if (!page) page = await ctx.newPage();

if (drag && drag.length === 4) {
  const [ax, ay, bx, by] = drag;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(ax + ((bx - ax) * i) / 12, ay + ((by - ay) * i) / 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

if (click) {
  const [x, y] = click;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
const url = page.url();
console.log(`saved ${out} (${url})`);
await browser.close();
