import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { detectLoginFields, performLogin } from "./login.js";
import type { LoginFields, LoginCredentials } from "./login.js";

async function ensureChromium(): Promise<void> {
  const { chromium } = await import("playwright");
  const execPath = chromium.executablePath();

  if (!fs.existsSync(execPath)) {
    console.log(chalk.yellow("⚙") + " Chromium not found. Installing via Playwright...");
    try {
      execSync("npx playwright install chromium", { stdio: "inherit" });
      console.log(chalk.green("✔") + " Chromium installed successfully.");
    } catch {
      console.error(
        chalk.red("Failed to install Chromium. Try running manually:\n") +
          chalk.cyan("  npx playwright install chromium"),
      );
      process.exit(1);
    }
  }
}

/**
 * Handler the caller provides when a login screen is detected. It receives
 * the detected fields and returns either credentials (to log in and then
 * screenshot the post-login page) or `null` (to screenshot the login page
 * as-is).
 */
export type LoginHandler = (fields: LoginFields) => Promise<LoginCredentials | null>;

export async function captureScreenshot(
  url: string,
  outputDir: string,
  width: number,
  height: number,
  onLoginDetected?: LoginHandler,
): Promise<string> {
  await ensureChromium();

  const { chromium } = await import("playwright");
  const screenshotPath = path.join(outputDir, "captured.png");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Detect login screen before taking the screenshot.
    if (onLoginDetected) {
      const fields = await detectLoginFields(page);
      if (fields) {
        const credentials = await onLoginDetected(fields);
        if (credentials) {
          try {
            await performLogin(page, fields, credentials);
            console.log(chalk.green("✔") + " Logged in successfully.");
          } catch (err) {
            console.error(
              chalk.red("Login failed: ") + (err instanceof Error ? err.message : String(err)),
            );
            console.error(chalk.dim("  Continuing with the current page..."));
          }
        }
      }
    }

    await page.screenshot({ path: screenshotPath, fullPage: false });

    console.log(chalk.green("✔") + ` Captured screenshot from ${chalk.cyan(page.url())}`);
  } finally {
    await browser.close();
  }

  return screenshotPath;
}
