// Bisect: which app-side state makes document.exitFullscreen() a no-op?
import { chromium } from "playwright";

const doc = `<style>html,body{margin:0}#stage{width:640px;height:360px;background:#06c;position:absolute;left:0;top:40px}.custom-sandbox-fullscreen{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9999!important;background:#000!important}#go{position:fixed;top:4px;left:4px;z-index:2147483000}</style>
<button id=go>GO</button><div id=stage></div>
<script>
document.getElementById('go').addEventListener('click', function () {
  var stage = document.getElementById('stage');
  if (!window.__entered) {
    if (window.__variant.indexOf('class') >= 0) stage.classList.add('custom-sandbox-fullscreen');
    if (window.__variant.indexOf('overflow') >= 0) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    if (stage.requestFullscreen) stage.requestFullscreen();
    window.__entered = true;
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    window.__exited = true;
  }
});
document.addEventListener('fullscreenchange', function () {
  window.__events = (window.__events || 0) + 1;
  window.__lastFsEl = document.fullscreenElement;
});
</script>`;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.bringToFront();
await page.goto("data:text/html," + encodeURIComponent(doc));

const runVariant = async (variant) => {
  await page.reload();
  await page.evaluate((v) => {
    window.__variant = v;
    window.__entered = false;
    window.__exited = false;
    window.__events = 0;
    window.__lastFsEl = null;
  }, variant);
  await page.mouse.click(10, 12); // trusted enter
  await page.waitForTimeout(450);
  const afterEnter = await page.evaluate(() => ({
    fsEl: !!document.fullscreenElement,
  }));
  await page.mouse.click(10, 12); // trusted exit
  await page.waitForTimeout(600);
  const afterExit = await page.evaluate(() => ({
    fsEl: !!document.fullscreenElement,
    events: window.__events,
    entered: window.__entered,
    exited: window.__exited,
  }));
  return { afterEnter, afterExit };
};

const out = {};
for (const variant of ["none", "class", "overflow", "class+overflow"]) {
  out[variant] = await runVariant(variant);
}

console.log(JSON.stringify(out, null, 2));
await browser.close();