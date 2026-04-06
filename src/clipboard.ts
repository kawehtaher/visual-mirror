import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { input } from "@inquirer/prompts";

type ClipboardTool = {
  cmd: string;
  name: string;
}

function hasCommand(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getLinuxClipboardTools(): ClipboardTool[] {
  const tools: ClipboardTool[] = [];

  // wl-paste is preferred on Wayland but xclip works too (via XWayland)
  if (hasCommand("wl-paste")) {
    tools.push({ cmd: "wl-paste --type image/png", name: "wl-paste" });
  }
  if (hasCommand("xclip")) {
    tools.push({ cmd: "xclip -selection clipboard -target image/png -o", name: "xclip" });
  }
  if (hasCommand("xsel")) {
    tools.push({ cmd: "xsel --clipboard --output", name: "xsel" });
  }

  return tools;
}

function tryReadClipboard(tool: ClipboardTool): Buffer | null {
  try {
    const buf = execSync(tool.cmd, {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (buf.length > 0) return buf;
    return null;
  } catch {
    return null;
  }
}

export async function readClipboardImage(outputDir: string): Promise<string> {
  let tools: ClipboardTool[] = [];

  if (process.platform === "darwin") {
    if (hasCommand("pngpaste")) {
      tools.push({ cmd: "pngpaste -", name: "pngpaste" });
    }
    if (hasCommand("osascript")) {
      // pbpaste doesn't support images, but osascript can write clipboard image to a file
      const tmpPath = path.join(outputDir, "clipboard-ref.png");
      tools.push({
        cmd: `osascript -e 'try' -e 'set imgData to the clipboard as «class PNGf»' -e 'set fp to open for access POSIX file "${tmpPath}" with write permission' -e 'write imgData to fp' -e 'close access fp' -e 'end try'`,
        name: "osascript",
      });
    }
  } else if (process.platform === "linux") {
    tools = getLinuxClipboardTools();
  } else if (process.platform === "win32") {
    tools.push({
      cmd: `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $img.Save([Console]::OpenStandardOutput(), [System.Drawing.Imaging.ImageFormat]::Png) } else { exit 1 }"`,
      name: "powershell",
    });
  }

  if (tools.length === 0) {
    console.error(
      chalk.red("No clipboard tool found.\n") +
      chalk.dim("  Install one of: wl-clipboard, xclip, xsel\n") +
      chalk.cyan("  sudo pacman -S xclip          # Arch\n") +
      chalk.cyan("  sudo apt install xclip        # Debian/Ubuntu"),
    );
    process.exit(1);
  }

  // Try each available tool until one returns image data
  for (const tool of tools) {
    const buf = tryReadClipboard(tool);
    if (buf) {
      fs.mkdirSync(outputDir, { recursive: true });
      const outPath = path.join(outputDir, "clipboard-ref.png");
      fs.writeFileSync(outPath, buf);

      console.log(
        chalk.green("✔") +
        ` Read reference image from clipboard via ${tool.name} (${(buf.length / 1024).toFixed(0)} KB)`,
      );

      return outPath;
    }
  }

  console.log(
    chalk.yellow("⚙") +
    " No image found in clipboard.",
  );
  console.log(
    chalk.dim("  You can drag & drop an image file into this terminal, or paste its path.\n"),
  );

  const filePath = await input({
    message: "Path to reference image (drag file here or paste path):",
  });

  const cleaned = filePath.trim().replace(/^['"]|['"]$/g, "");
  if (!cleaned || !fs.existsSync(cleaned)) {
    console.error(chalk.red("File not found: ") + chalk.dim(cleaned || "(empty)"));
    process.exit(1);
  }

  const ext = path.extname(cleaned).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext)) {
    console.error(chalk.red("Unsupported image format: ") + chalk.dim(ext));
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, "clipboard-ref" + ext);
  fs.copyFileSync(cleaned, outPath);

  const size = fs.statSync(outPath).size;
  console.log(
    chalk.green("✔") +
    ` Using reference image: ${chalk.cyan(path.basename(cleaned))} (${(size / 1024).toFixed(0)} KB)`,
  );

  return outPath;
}
