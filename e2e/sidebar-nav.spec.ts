import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Regression tests for the sidebar nav highlight.
 *
 * The bug: hover state was JS-animated by Framer Motion (`whileHover` writing
 * `backgroundColor`), and the active bar used one hardcoded `layoutId` shared by
 * the two mounted sidebars, wrapped in an AnimatePresence exit. Result: the item
 * you left kept its highlight, and the accent bar stranded on the old route.
 *
 * The invariant these tests pin down: at any moment the only highlighted rows
 * are the current route's row and the row under the pointer — nothing else.
 */

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const HIGHLIGHT = "rgb(61, 69, 80)"; // --surface-hover #3d4550

/** The desktop rail. The mobile drawer mounts a second copy that stays hidden at this viewport. */
function sidebar(page: Page): Locator {
  return page.locator("aside:visible");
}

function navLink(page: Page, href: string): Locator {
  return sidebar(page).locator(`nav a[href="${href}"]`);
}

/** The row div inside a nav link — this is what carries the background. */
function navRow(page: Page, href: string): Locator {
  return navLink(page, href).locator("> div");
}

/** Labels of every row currently painted with a background, in DOM order. */
async function highlighted(page: Page): Promise<string[]> {
  return sidebar(page).evaluate((aside) =>
    Array.from(aside.querySelectorAll("nav a > div"))
      .filter((row) => getComputedStyle(row).backgroundColor !== "rgba(0, 0, 0, 0)")
      .map((row) => row.textContent?.trim() ?? ""),
  );
}

async function expectHighlighted(page: Page, labels: string[]) {
  await expect.poll(() => highlighted(page), { timeout: 3000 }).toEqual(labels);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(navLink(page, "/")).toHaveAttribute("aria-current", "page");
});

test("moving the pointer between items does not leave the previous one highlighted", async ({
  page,
}) => {
  await navRow(page, "/people").hover();
  await expectHighlighted(page, ["Overview", "People"]);

  await navRow(page, "/projects").hover();
  await expectHighlighted(page, ["Overview", "Projects"]);

  await navRow(page, "/timesheets").hover();
  await expectHighlighted(page, ["Overview", "Timesheets"]);

  // Park the pointer off the nav entirely — only the active route stays lit.
  await page.mouse.move(900, 400);
  await expectHighlighted(page, ["Overview"]);
});

test("the highlight clears after a click that navigates", async ({ page }) => {
  // The original repro: press an item, let the route change re-render the tree,
  // then move away. Framer's hover-end is deferred while pressed and was being
  // dropped, freezing the inline background on the item you clicked from.
  await navRow(page, "/people").click();
  await page.waitForURL("/people");

  await navRow(page, "/projects").hover();
  await expectHighlighted(page, ["People", "Projects"]);

  await page.mouse.move(900, 400);
  await expectHighlighted(page, ["People"]);
});

test("hovering an item while inactive does not suppress its highlight once active", async ({
  page,
}) => {
  // Inverse of the same bug: Framer left an inline `background-color: rgba(0,0,0,0)`
  // behind after hover-out, and inline styles outrank the active Tailwind class.
  await navRow(page, "/projects").hover();
  await page.mouse.move(900, 400);
  await expect(navRow(page, "/projects")).toHaveCSS("background-color", TRANSPARENT);

  await navLink(page, "/projects").click();
  await page.waitForURL("/projects");
  await page.mouse.move(900, 400);

  await expect(navRow(page, "/projects")).toHaveCSS("background-color", HIGHLIGHT);
});

test("hover state is CSS-only — nothing writes an inline background", async ({ page }) => {
  const row = navRow(page, "/people");

  await row.hover();
  await expect(row).toHaveCSS("background-color", HIGHLIGHT);
  expect(await row.evaluate((el: HTMLElement) => el.style.backgroundColor)).toBe("");

  await page.mouse.move(900, 400);
  await expect(row).toHaveCSS("background-color", TRANSPARENT);
  // An inline value here — of any colour — is the bug coming back.
  expect(await row.evaluate((el: HTMLElement) => el.style.backgroundColor)).toBe("");
});

test("exactly one accent bar, and it follows the route", async ({ page }) => {
  const bars = sidebar(page).locator("nav a > span");
  await expect(bars).toHaveCount(1);
  await expect(navLink(page, "/").locator("> span")).toBeVisible();

  await navRow(page, "/timesheets").click();
  await page.waitForURL("/timesheets");

  await expect(bars).toHaveCount(1);
  await expect(navLink(page, "/timesheets").locator("> span")).toBeVisible();
  await expect(sidebar(page).locator("nav [aria-current='page']")).toHaveCount(1);

  // The bar must stay inside the visible rail. The two sidebars used to share a
  // single layoutId, which let the hidden drawer's copy win the shared-layout
  // stack and project the visible bar toward off-screen coordinates.
  const barBox = await bars.boundingBox();
  const railBox = await sidebar(page).boundingBox();
  expect(barBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(barBox!.x).toBeGreaterThanOrEqual(railBox!.x);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width);
});

test("keyboard focus gets the same highlight as hover", async ({ page }) => {
  await navLink(page, "/people").focus();
  await expect(navRow(page, "/people")).toHaveCSS("background-color", HIGHLIGHT);
  await expectHighlighted(page, ["Overview", "People"]);
});

test("only the desktop rail owns the onboarding tour anchors", async ({ page }) => {
  // OnboardingTour resolves these with querySelector(), which returns the first
  // match regardless of visibility — a duplicate in the hidden drawer would send
  // the spotlight to a display:none element with a zeroed bounding box.
  for (const id of ["tour-overview", "tour-people", "tour-projects", "tour-timesheets"]) {
    await expect(page.locator(`[data-tour="${id}"]`)).toHaveCount(1);
  }
});
