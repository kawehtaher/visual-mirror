#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import chalk from "chalk";
import open from "open";
import { input, password } from "@inquirer/prompts";
import { captureScreenshot } from "./capture.js";
import { readClipboardImage } from "./clipboard.js";
import { runDiff } from "./diff.js";
import { analyzeScreenshots } from "./analyze.js";
import { runInteractive } from "./interactive.js";
import { generateReport } from "./report.js";

const program = new Command();

program
  .name("visual-mirror")
  .description("Pixel diffs tell you something changed. Visual Mirror tells you what it means.")
  .version("1.0.0")
  .option(
    "--ref <path>",
    "Path to reference screenshot (PNG/JPG). If omitted, reads from clipboard",
  )
  .requiredOption("--url <url>", "URL to capture and compare")
  .option("--width <number>", "Viewport width", "1280")
  .option("--height <number>", "Viewport height", "720")
  .option("--out <path>", "Output directory for report", "./visual-mirror-report");

program.parse();

const opts = program.opts<{
  ref: string;
  url: string;
  width: string;
  height: string;
  out: string;
}>();

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;

  console.log(chalk.yellow("⚙") + " ANTHROPIC_API_KEY not found in your environment.");
  console.log(chalk.dim("  Get one at https://console.anthropic.com\n"));

  const key = await password({
    message: "Enter your Anthropic API key:",
    mask: "*",
  });

  const trimmed = key.trim();
  if (!trimmed) {
    console.error(chalk.red("No API key provided. Exiting."));
    process.exit(1);
  }

  process.env.ANTHROPIC_API_KEY = trimmed;

  const shell = path.basename(process.env.SHELL || "bash");
  const rcFile =
    shell === "zsh" ? "~/.zshrc" : shell === "fish" ? "~/.config/fish/config.fish" : "~/.bashrc";
  const exportCmd =
    shell === "fish"
      ? `set -Ux ANTHROPIC_API_KEY "${trimmed}"`
      : `export ANTHROPIC_API_KEY="${trimmed}"`;

  console.log();
  console.log(chalk.green("✔") + " API key set for this session.");
  console.log(chalk.dim("  To persist it, add this to ") + chalk.cyan(rcFile) + chalk.dim(":"));
  console.log(chalk.dim(`  ${exportCmd}`));
  console.log();
}

async function tryUrl(url: string): Promise<boolean> {
  try {
    if (url.startsWith("https://")) {
      // Use node:https to allow self-signed certs (common for local dev servers)
      return await new Promise<boolean>((resolve) => {
        const req = https.get(url, { rejectUnauthorized: false, timeout: 5000 }, (res) => {
          res.resume();
          resolve(true);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      });
    }
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function resolveUrl(url: string): Promise<string> {
  if (await tryUrl(url)) return url;

  // Try alternative ports if the URL has a port
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // Let it fail later with a proper error
  }

  if (parsed.port) {
    const basePort = parseInt(parsed.port, 10);
    const alternatives = [basePort + 1, basePort - 1, 8080, 3000, 5173, 4200, 8000];
    const uniquePorts = [
      ...new Set(alternatives.filter((p) => p !== basePort && p > 0 && p <= 65535)),
    ];

    console.log(chalk.yellow("⚙") + ` Could not reach ${chalk.cyan(url)}. Trying nearby ports...`);

    for (const port of uniquePorts) {
      const alt = new URL(url);
      alt.port = String(port);
      const altUrl = alt.toString();

      if (await tryUrl(altUrl)) {
        console.log(chalk.green("✔") + ` Found live server at ${chalk.cyan(altUrl)}`);

        const answer = await input({
          message: `Use ${altUrl} instead? (Y/n)`,
          default: "Y",
        });

        if (answer.trim().toLowerCase() !== "n") {
          return altUrl;
        }
      }
    }
  }

  // Nothing worked — give the user instructions
  console.error(chalk.red(`\nCould not reach ${url}`));
  console.error(chalk.dim("  Make sure your app is running. For example:\n"));
  console.error(chalk.dim("  # React / Vite / Next.js"));
  console.error(chalk.cyan("  npm run dev\n"));
  console.error(chalk.dim("  # Quick static file server"));
  console.error(chalk.cyan("  npx serve ./dist -p 3000\n"));
  console.error(chalk.dim("  # Python"));
  console.error(chalk.cyan("  python -m http.server 3000\n"));
  process.exit(1);
}

async function main() {
  // Step 0: Ensure API key
  await ensureApiKey();

  const width = parseInt(opts.width, 10);
  const height = parseInt(opts.height, 10);
  const outputDir = path.resolve(opts.out);

  // Resolve reference: from --ref flag or clipboard
  let refPath: string;
  if (opts.ref) {
    refPath = path.resolve(opts.ref);
    if (!fs.existsSync(refPath)) {
      console.error(chalk.red(`Reference file not found: ${refPath}`));
      process.exit(1);
    }
  } else {
    console.log(
      chalk.yellow("⚙") + " No --ref provided. Reading reference image from clipboard...",
    );
    refPath = await readClipboardImage(outputDir);
  }

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Resolve URL (check reachability, try alt ports)
  const resolvedUrl = await resolveUrl(opts.url);

  // Step 2: Capture screenshot
  let capturedPath: string;
  try {
    capturedPath = await captureScreenshot(resolvedUrl, outputDir, width, height);
  } catch (err) {
    console.error(chalk.red(`Could not capture screenshot from ${resolvedUrl}`));
    console.error(chalk.dim(String(err)));
    process.exit(1);
  }

  // Step 3: Pixel diff
  const { diffPath, diffPercent } = await runDiff(refPath, capturedPath, outputDir);

  // Step 4: Claude Vision analysis
  let analysis;
  try {
    analysis = await analyzeScreenshots(refPath, capturedPath);
  } catch (err) {
    console.error(chalk.red("Claude API error:"), err);
    process.exit(1);
  }

  // Step 5: Interactive selection + fix suggestions
  const fixes = await runInteractive(analysis);

  // Step 6: Generate report
  const reportPath = generateReport(
    resolvedUrl,
    refPath,
    capturedPath,
    diffPath,
    diffPercent,
    analysis,
    fixes,
    outputDir,
  );

  console.log(chalk.green("✔") + ` Report saved to ${chalk.cyan(reportPath)}`);
  console.log("  Opening report...");

  await open(reportPath);
}

main().catch((err) => {
  if (err instanceof Error && err.name === "ExitPromptError") {
    console.log("\nAborted.");
    process.exit(0);
  }
  console.error(chalk.red("Unexpected error:"), err);
  process.exit(1);
});
