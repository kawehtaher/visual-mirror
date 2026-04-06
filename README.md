# visual-mirror

> Pixel diffs tell you something changed. Visual Mirror tells you what it means.

[![npm version](https://img.shields.io/npm/v/visual-mirror.svg)](https://www.npmjs.com/package/visual-mirror)
[![license](https://img.shields.io/npm/l/visual-mirror.svg)](LICENSE)

A CLI tool for visual regression testing powered by AI. It captures a screenshot of a live URL, diffs it pixel-by-pixel against a reference image, then uses Claude Vision to provide an intelligent, human-readable analysis of what changed — complete with actionable fix suggestions.

## Install

```bash
npm install -g visual-mirror
```

## Quick Start

```bash
# Option 1: Paste from clipboard — just copy a screenshot and run:
visual-mirror --url http://localhost:3000

# Option 2: Provide a reference file:
visual-mirror --ref ./reference.png --url http://localhost:3000
```

## How It Works

1. **Capture** — Takes a headless Chromium screenshot of your live URL via Playwright
2. **Diff** — Compares the captured screenshot against your reference image pixel-by-pixel using Jimp, generating a visual diff overlay
3. **Analyze** — Sends both screenshots to Claude Vision, which identifies specific UI issues (not just "something changed" — it tells you *what* changed)
4. **Select** — Presents issues in an interactive terminal prompt (like `yay` on Arch) where you pick which ones to get fix suggestions for
5. **Report** — Generates a self-contained HTML report with all three images, issues, and fix suggestions, then auto-opens it in your browser

## Usage

```bash
visual-mirror --ref <path> --url <url> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--ref <path>` | Path to reference screenshot (PNG/JPG). If omitted, reads from clipboard | *optional* |
| `--url <url>` | URL to capture and compare | *required* |
| `--width <number>` | Viewport width in pixels | `1280` |
| `--height <number>` | Viewport height in pixels | `720` |
| `--out <path>` | Output directory for report | `./visual-mirror-report` |

### Example

```bash
visual-mirror --ref ./designs/homepage.png --url http://localhost:3000 --width 1440 --height 900
```

### Interactive Flow

After analysis, you'll see something like:

```
  Severity: MINOR

  Issues found:
    1  Button alignment shifted 8px to the right          .cta-button
    2  Font color changed from #333 to #555               body
    3  Hero image 12px taller than reference              .hero-image

  ==> Select issues to get fix suggestions for (e.g. 1,2 or * for all)
  ==> 1,3
```

Then you'll get targeted fix suggestions:

```
  Fix suggestions:

  [1] Button alignment shifted 8px to the right
      → Check margin-right on .cta-button, likely a padding change.
        Try: padding-right: 16px;

  [3] Hero image 12px taller than reference
      → Set an explicit height on .hero-image: height: 320px;

  ✔ Report saved to ./visual-mirror-report/index.html
  Opening report...
```

## Environment Setup

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

Get one at [console.anthropic.com](https://console.anthropic.com).

## Publishing

```bash
npm login
npm publish
```

The `prepublishOnly` script runs `tsc` automatically before publishing.

## License

MIT
