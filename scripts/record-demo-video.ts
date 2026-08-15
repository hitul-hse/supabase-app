/**
 * HSE Hub — Product Demo Video Recorder
 *
 * Records a cinematic walkthrough of the live app at hseportal.hs-experts.com
 * and saves it as public/hse-hub-demo.webm (playable in all modern browsers).
 *
 * Usage:
 *   npx tsx scripts/record-demo-video.ts
 *
 * Output:
 *   public/hse-hub-demo.webm  — full demo video (~60s)
 *   public/screenshots/       — individual PNG frames for the /demo page
 */

import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://hseportal.hs-experts.com";
const OUT_DIR = path.join(process.cwd(), "public");
const SCREENSHOTS_DIR = path.join(OUT_DIR, "screenshots");

// Ensure output dirs exist
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

interface Scene {
  name: string;
  url: string;
  waitFor: string;
  pauseMs: number;
  screenshot: string;
  actions?: Array<{
    type: "scroll" | "hover" | "wait";
    selector?: string;
    amount?: number;
    ms?: number;
  }>;
}

const SCENES: Scene[] = [
  {
    name: "Login page",
    url: `${BASE_URL}/login`,
    waitFor: "form",
    pauseMs: 2000,
    screenshot: "01-login.png",
  },
  {
    name: "Overview dashboard",
    url: `${BASE_URL}/`,
    waitFor: "[data-tour='nav-overview']",
    pauseMs: 3000,
    screenshot: "02-overview.png",
    actions: [
      { type: "scroll", amount: 300 },
      { type: "wait", ms: 1500 },
      { type: "scroll", amount: 300 },
      { type: "wait", ms: 1500 },
    ],
  },
  {
    name: "Team Lead board",
    url: `${BASE_URL}/team-lead`,
    waitFor: "[data-tour='nav-teamlead']",
    pauseMs: 3000,
    screenshot: "03-team-lead.png",
    actions: [
      { type: "scroll", amount: 400 },
      { type: "wait", ms: 2000 },
    ],
  },
  {
    name: "People directory",
    url: `${BASE_URL}/people`,
    waitFor: "[data-tour='nav-people']",
    pauseMs: 2500,
    screenshot: "04-people.png",
  },
  {
    name: "Projects view",
    url: `${BASE_URL}/projects`,
    waitFor: "[data-tour='nav-projects']",
    pauseMs: 2500,
    screenshot: "05-projects.png",
    actions: [
      { type: "scroll", amount: 300 },
      { type: "wait", ms: 1500 },
    ],
  },
  {
    name: "Timesheets",
    url: `${BASE_URL}/timesheets`,
    waitFor: "[data-tour='nav-timesheets']",
    pauseMs: 2500,
    screenshot: "06-timesheets.png",
  },
  {
    name: "Role Permissions admin",
    url: `${BASE_URL}/admin/roles`,
    waitFor: "table",
    pauseMs: 3000,
    screenshot: "07-admin-roles.png",
    actions: [
      { type: "scroll", amount: 300 },
      { type: "wait", ms: 1500 },
    ],
  },
];

async function main() {
  console.log("🎬 Starting HSE Hub demo video recording...\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // ── Phase 1: Take individual screenshots for the /demo page ──────────────
  console.log("📸 Taking screenshots for demo page...");
  const screenshotContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // retina quality
  });

  const screenshotPage = await screenshotContext.newPage();

  for (const scene of SCENES) {
    console.log(`  → ${scene.name}`);
    try {
      await screenshotPage.goto(scene.url, {
        waitUntil: "networkidle",
        timeout: 15000,
      });
      await screenshotPage.waitForTimeout(1500);

      // Run any pre-screenshot actions
      if (scene.actions) {
        for (const action of scene.actions) {
          if (action.type === "scroll") {
            await screenshotPage.evaluate((amt) => window.scrollBy(0, amt), action.amount ?? 0);
          } else if (action.type === "wait") {
            await screenshotPage.waitForTimeout(action.ms ?? 1000);
          }
        }
      }

      await screenshotPage.screenshot({
        path: path.join(SCREENSHOTS_DIR, scene.screenshot),
        fullPage: false,
        type: "png",
      });
      console.log(`     ✓ Saved screenshots/${scene.screenshot}`);
    } catch {
      console.log(`     ⚠ Could not capture ${scene.name} (needs auth?) — skipping`);
    }
  }

  await screenshotContext.close();

  // ── Phase 2: Record the video walkthrough ────────────────────────────────
  console.log("\n🎥 Recording video walkthrough...");

  const videoContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: path.join(OUT_DIR, "video-tmp"),
      size: { width: 1440, height: 900 },
    },
  });

  const videoPage = await videoContext.newPage();

  for (const scene of SCENES) {
    console.log(`  🎬 Recording: ${scene.name}`);
    try {
      await videoPage.goto(scene.url, { waitUntil: "networkidle", timeout: 20000 });
      await videoPage.waitForTimeout(scene.pauseMs);

      if (scene.actions) {
        for (const action of scene.actions) {
          if (action.type === "scroll") {
            await videoPage.evaluate((amt) => window.scrollBy({ top: amt, behavior: "smooth" }), action.amount ?? 0);
          } else if (action.type === "wait") {
            await videoPage.waitForTimeout(action.ms ?? 1000);
          }
        }
      }
    } catch {
      console.log(`     ⚠ Skipped ${scene.name}`);
    }
  }

  await videoPage.waitForTimeout(2000);
  await videoContext.close();

  // Move the recorded video to public/
  const videoTmpDir = path.join(OUT_DIR, "video-tmp");
  if (fs.existsSync(videoTmpDir)) {
    const files = fs.readdirSync(videoTmpDir).filter((f) => f.endsWith(".webm"));
    if (files.length > 0) {
      const src = path.join(videoTmpDir, files[0]);
      const dest = path.join(OUT_DIR, "hse-hub-demo.webm");
      fs.renameSync(src, dest);
      fs.rmdirSync(videoTmpDir, { recursive: true });
      console.log(`\n✅ Video saved: public/hse-hub-demo.webm`);
    }
  }

  await browser.close();

  console.log("\n🎉 Done! Files created:");
  console.log("   public/hse-hub-demo.webm  — share this video anywhere");
  console.log("   public/screenshots/        — used by the /demo page");
  console.log("\nNext: commit & push so /demo page shows real screenshots.");
}

main().catch((e) => {
  console.error("Recording failed:", e);
  process.exit(1);
});
