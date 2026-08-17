import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

/**
 * Every page under (app) is gated by requireProfile()/requireUser(), so the nav
 * only renders for a signed-in user with an admin-provisioned profile. Point
 * E2E_EMAIL / E2E_PASSWORD at such an account (see .env.local.example for the
 * Supabase project the dev server talks to).
 */
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  expect(
    email && password,
    "Set E2E_EMAIL and E2E_PASSWORD to a provisioned Supabase account before running the e2e suite.",
  ).toBeTruthy();

  await page.goto("/auth/login");
  await page.locator("#email").fill(email!);
  await page.locator("#password").fill(password!);
  await page.getByRole("button", { name: "Log in" }).click();

  // Landing on the overview means the session cookie and the profile both exist.
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: "Overview" }).first()).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
