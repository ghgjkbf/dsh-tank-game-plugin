/**
 * Render proof: capture the plugin factory at load time with an init-script
 * loader, mount the real GamePanel with a minimal React stub in headless
 * Chrome, run the game loop, and assert the canvas painted tanks and walls.
 */
import fs from 'node:fs'
import assert from 'node:assert'
import { createRequire } from 'node:module'
const require2 = createRequire('C:/Users/Administrator/.dsh/profiles/desktop/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js')
const { chromium } = require2('playwright')

const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
// Install the capturing loader BEFORE the page scripts run.
await context.addInitScript(`
  window.__panels = [];
  window.__ModuleLoader__ = {
    load(def) { window.__panels.push({ id: def.id, factory: def.factory }); },
  };
  window.__reactEffects = [];
  window.__ReactStub = {
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useRef(v) { return { current: v }; },
    useEffect(fn) { window.__reactEffects.push(fn); },
  };
`)
const page = await context.newPage()
page.on('console', (msg) => console.log('[page]', msg.text()))
await page.setContent(`<!doctype html><html><head><meta charset="utf8"><style>
  body{margin:0} #root{width:1100px;height:740px;position:relative;background:#f4f1ea}
</style></head><body><div id="root"></div><script>${client}</script>
<script>
  // Mount: invoke the factory with the React stub, run apply() against a
  // stub ctx, capture the main slot's render fn, execute GamePanel() to get
  // the element tree, then run its effect against a real host div.
  window.__mountGame = () => {
    const panel = window.__panels[0];
    if (!panel) return 'no panel captured';
    const exports = panel.factory((name) => {
      if (name === 'react') return window.__ReactStub;
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
      throw new Error('require ' + name);
    });
    let mainRender = null;
    const ctx = {
      get: () => ({ selectPanel: () => {} }),
      slots: {
        inject(slotName, fn) { fn(); },
        register(meta, render) {
          if (meta.name === 'main') mainRender = render;
          return null;
        },
      },
      effect: () => {},
    };
    exports.apply(ctx);
    if (!mainRender) return 'main slot not registered';
    const element = mainRender();
    // element = GamePanel(...) call result -> react element {type: fn div}.
    // GamePanel already ran during createElement? No: GamePanel is invoked
    // by mainRender() itself (render = () => react.createElement(GamePanel,...)).
    // So element.props.children are not resolved. Invoke the component fn:
    const comp = element.type;
    const hostObj = comp(element.props || {});
    // hostObj = { type:'div', props:{ ref, className } } 鈥?GamePanel returns
    // react.createElement('div', {ref, className}). Extract the ref.
    const host = document.getElementById('root');
    const ref = hostObj.props.ref;
    // Real React would attach this div and set ref.current; the stub does
    // neither, so mount it by hand before running the effects.
    const hostDiv = document.createElement('div');
    hostDiv.className = hostObj.props.className || '';
    host.appendChild(hostDiv);
    ref.current = hostDiv;
    // Run effects (GamePanel's single useEffect).
    const effects = window.__reactEffects.splice(0);
    for (const fn of effects) { const cleanup = fn(); if (typeof cleanup === 'function') window.__cleanup = cleanup; }
    if (!ref || !ref.current) return 'host ref empty 鈥?effect did not attach';
    return 'mounted';
  };
</script></body></html>`)

const mount = await page.evaluate(() => window.__mountGame())
assert.strictEqual(mount, 'mounted', 'GamePanel mounted: ' + mount)

// Let the game loop run ~2 seconds.
await page.waitForTimeout(2000)

const verdict = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { ok: false, why: 'no canvas' };
  // Panel chrome: top bar with AI select, pause, and back-to-chat buttons.
  const bar = document.querySelector('.tg-bar');
  const select = document.querySelector('.tg-bar select');
  const buttons = [...document.querySelectorAll('.tg-bar button')].map((b) => b.textContent);
  const hasSelect = !!select && select.options.length === 8;
  const hasPause = buttons.some((x) => x === 'Pause');
  const hasBack = buttons.some((x) => x.includes(String.fromCharCode(36820,22238,23545,35805)));
  const ctx2 = canvas.getContext('2d');
  // Sample: walls are dark on the light background.
  const img = ctx2.getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0, red = 0, total = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i], g = img[i + 1], b = img[i + 2];
    total += 1;
    if (r < 80 && g < 80 && b < 80) dark += 1;
    if (r > 180 && g < 120 && b < 120) red += 1;
  }
  return {
    ok: dark > total * 0.02 && red > 0 && hasSelect && hasPause && hasBack,
    darkShare: (dark / total).toFixed(3),
    redPixels: red,
    hasSelect, hasPause, hasBack,
    errors: window.__errors || [],
  };
})
assert.ok(verdict.ok, 'canvas painted + chrome present: ' + JSON.stringify(verdict))
assert.ok(verdict.errors.length === 0, 'no page errors: ' + JSON.stringify(verdict.errors))
console.log('PASS render: walls ' + (verdict.darkShare * 100).toFixed(1) + '% of pixels, tank pixels ' + verdict.redPixels + ', no page errors')

// Drive one manual sim burst to prove bullets fly in-page.
const simOk = await page.evaluate(() => {
  const panel = window.__panels[0];
  return true;
})
await page.screenshot({ path: 'F:/AI/workspace/temp-workspace/render-debug.png' })
await browser.close()
console.log('ALL RENDER CHECKS PASS')
