import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";

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

export async function captureScreenshot(
  url: string,
  outputDir: string,
  width: number,
  height: number,
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
    await page.screenshot({ path: screenshotPath, fullPage: false });

    console.log(chalk.green("✔") + ` Captured screenshot from ${chalk.cyan(url)}`);
  } finally {
    await browser.close();
  }

  return screenshotPath;
}
