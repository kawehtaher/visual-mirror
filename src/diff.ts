import { createJimp } from "@jimp/core";
import png from "@jimp/js-png";
import jpeg from "@jimp/js-jpeg";
import * as resize from "@jimp/plugin-resize";
import path from "node:path";
import chalk from "chalk";

const Jimp = createJimp({ formats: [png, jpeg], plugins: [resize.methods] });

export type DiffResult = {
  diffPath: string;
  diffPercent: number;
}

export async function runDiff(
  referencePath: string,
  capturedPath: string,
  outputDir: string,
): Promise<DiffResult> {
  const refImage = await Jimp.read(referencePath);
  const capImage = await Jimp.read(capturedPath);

  const width = capImage.width;
  const height = capImage.height;

  // Resize reference to match captured dimensions if they differ
  if (refImage.width !== width || refImage.height !== height) {
    refImage.resize({ w: width, h: height });
  }

  const diffImage = new Jimp({ width, height });
  const threshold = 0.1;
  let diffPixels = 0;
  const totalPixels = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const refColor = refImage.getPixelColor(x, y);
      const capColor = capImage.getPixelColor(x, y);

      if (refColor !== capColor) {
        // Extract RGBA components
        const rRef = (refColor >> 24) & 0xff;
        const gRef = (refColor >> 16) & 0xff;
        const bRef = (refColor >> 8) & 0xff;

        const rCap = (capColor >> 24) & 0xff;
        const gCap = (capColor >> 16) & 0xff;
        const bCap = (capColor >> 8) & 0xff;

        const maxDiff = Math.max(
          Math.abs(rRef - rCap),
          Math.abs(gRef - gCap),
          Math.abs(bRef - bCap),
        );

        if (maxDiff / 255 > threshold) {
          // Highlight difference in red
          diffImage.setPixelColor(0xff0000ff, x, y);
          diffPixels++;
        } else {
          // Below threshold — show faded original
          const gray = Math.round((rCap + gCap + bCap) / 3);
          diffImage.setPixelColor(((gray << 24) | (gray << 16) | (gray << 8) | 0x80) >>> 0, x, y);
        }
      } else {
        // Identical pixel — show faded
        const r = (capColor >> 24) & 0xff;
        const g = (capColor >> 16) & 0xff;
        const b = (capColor >> 8) & 0xff;
        const gray = Math.round((r + g + b) / 3);
        diffImage.setPixelColor(((gray << 24) | (gray << 16) | (gray << 8) | 0x80) >>> 0, x, y);
      }
    }
  }

  const diffPath = path.join(outputDir, "diff.png");
  await diffImage.write(diffPath as `${string}.${string}`);

  const diffPercent = (diffPixels / totalPixels) * 100;
  console.log(
    chalk.green("✔") +
      ` Running pixel diff... (${chalk.yellow(diffPercent.toFixed(1) + "%")} difference)`,
  );

  return { diffPath, diffPercent };
}
