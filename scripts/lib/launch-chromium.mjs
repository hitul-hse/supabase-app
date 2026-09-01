/*
 * One way to launch headless Chromium for a gate, with a frame clock that is
 * known to tick before the gate is allowed to click anything.
 *
 * WHY THIS EXISTS
 * ---------------
 * check-sso-ui.mjs died on a Playwright TimeoutError at `.click()` even though
 * the button was visible, enabled, unobstructed, geometrically still, and had
 * no animation on it or on any ancestor. The page was not the problem: a bare
 * `<button>` in `page.setContent()` failed the same way, with no dev server
 * involved at all.
 *
 * The cause is the compositor. Playwright's actionability check for a click
 * waits for the element to be "stable", which it defines as an unchanged
 * bounding box across two consecutive requestAnimationFrame callbacks. On this
 * WSL2 rig (Chromium 151 / Playwright 1.62.1, /dev/dxg GPU passthrough
 * present) the default headless launch has an erratic frame clock. Measured
 * over three 5-second runs on a blank page:
 *
 *     default                                    1 fps | 60 fps | no frame at all
 *     --disable-gpu                              none  | none   | none
 *     --disable-frame-rate-limit                 none  | none   | none
 *     --use-gl=angle --use-angle=swiftshader     none  | none   | none
 *     --disable-gpu --disable-software-rasterizer  60 fps from the first ms, x3
 *
 * With no rAF the "stable" wait can never complete, so every click in every
 * gate times out; with a 1 fps clock it completes late and the gate flakes.
 * Neither is a property of the page under test. The one configuration that was
 * reliable is the pair that takes the GPU process out of frame production
 * entirely: `--disable-gpu` alone still routes through a software GL in the
 * GPU process, which is exactly the path that stalls here.
 *
 * That pair is used unconditionally rather than probed-and-fallen-back-to,
 * because the default clock can be healthy for one launch and dead the next
 * (see the table), so a probe that happened to pass would leave a flake window
 * open behind it. On a machine with a working GPU the flags cost nothing a
 * gate can observe: these gates read text and URLs, they do not measure
 * rendering performance.
 *
 * The clock is then VERIFIED after launch. If three consecutive frames do not
 * arrive within the budget the gate fails right here, naming the environment,
 * instead of dying minutes later on a TimeoutError deep inside a click that
 * reads as a page bug.
 */
import { chromium } from "playwright";

export const SOFTWARE_COMPOSITING_ARGS = ["--disable-gpu", "--disable-software-rasterizer"];

/**
 * Resolves with the ms until the third consecutive rAF, or null if the clock
 * did not tick that often within `budgetMs`.
 */
export async function measureFrameClock(page, budgetMs = 2000) {
  return page.evaluate(
    (budget) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let n = 0;
        const done = setTimeout(() => resolve(null), budget);
        const tick = () => {
          n += 1;
          if (n >= 3) {
            clearTimeout(done);
            resolve(Math.round(performance.now() - t0));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    budgetMs,
  );
}

/**
 * `chromium.launch()` with software compositing and a verified frame clock.
 * Extra `options` are passed through; `options.args` are appended after ours.
 */
export async function launchChromium(options = {}) {
  const browser = await chromium.launch({
    ...options,
    args: [...SOFTWARE_COMPOSITING_ARGS, ...(options.args ?? [])],
  });

  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>frame clock</title>");
  const ms = await measureFrameClock(page);
  await page.close();

  if (ms === null) {
    await browser.close();
    throw new Error(
      "headless Chromium produced no animation frames on a blank page within 2s, so " +
        "Playwright's click stability check can never pass. This is the browser " +
        "environment, not the page under test (WSL2 GPU passthrough is the known " +
        `case here; launched ${browser.version()} with ${SOFTWARE_COMPOSITING_ARGS.join(" ")}).`,
    );
  }

  return browser;
}
