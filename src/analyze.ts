import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import chalk from "chalk";

export type Issue = {
  id: number;
  title: string;
  description: string;
  area: string;
};

export type Severity = "OK" | "MINOR" | "MAJOR";

export type AnalysisResult = {
  severity: Severity;
  verdict: string;
  issues: Issue[];
};

export type Fix = {
  id: number;
  title: string;
  suggestion: string;
};

export type FixResult = {
  fixes: Fix[];
};

function imageToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

function getMediaType(filePath: string): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  const ext = filePath.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

export async function analyzeScreenshots(
  referencePath: string,
  capturedPath: string,
): Promise<AnalysisResult> {
  const client = new Anthropic();

  const refBase64 = imageToBase64(referencePath);
  const capBase64 = imageToBase64(capturedPath);
  const refMediaType = getMediaType(referencePath);
  const capMediaType = getMediaType(capturedPath);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: "You are a visual QA engineer reviewing UI screenshots.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: refMediaType,
              data: refBase64,
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: capMediaType,
              data: capBase64,
            },
          },
          {
            type: "text",
            text: `Compare these two screenshots. First is the reference/expected design. Second is the actual rendered result.
Return ONLY valid JSON with no markdown or backticks:
{
  "severity": "OK" | "MINOR" | "MAJOR",
  "verdict": "string",
  "issues": [
    {
      "id": number,
      "title": "string",
      "description": "string",
      "area": "string"
    }
  ]
}
Each issue should be atomic and specific (e.g. 'Button shifted 8px right', not 'Layout problems'). area should be a CSS selector or component name if identifiable.
If the screenshots look identical, return severity "OK" with an empty issues array.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  console.log(chalk.green("✔") + " Analyzing with Claude...");

  const result: AnalysisResult = JSON.parse(text);
  return result;
}

export async function getFixSuggestions(issues: Issue[]): Promise<FixResult> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a senior frontend developer. For each of the following visual issues found in a UI screenshot comparison, provide a specific, actionable CSS or code fix suggestion. Be concrete — reference property names, values, and selectors where possible.

Issues:
${JSON.stringify(issues, null, 2)}

Return ONLY valid JSON with no markdown:
{
  "fixes": [
    {
      "id": number,
      "title": "string",
      "suggestion": "string"
    }
  ]
}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  const result: FixResult = JSON.parse(text);
  return result;
}
