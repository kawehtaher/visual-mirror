import chalk from "chalk";
import { input } from "@inquirer/prompts";
import type { AnalysisResult, Issue, Fix } from "./analyze.js";
import { getFixSuggestions } from "./analyze.js";

function severityColor(severity: string): string {
  switch (severity) {
    case "OK":
      return chalk.green(severity);
    case "MINOR":
      return chalk.yellow(severity);
    case "MAJOR":
      return chalk.red(severity);
    default:
      return severity;
  }
}

function displayResults(analysis: AnalysisResult): void {
  console.log();
  console.log(`  Severity: ${severityColor(analysis.severity)}`);
  console.log();

  if (analysis.issues.length === 0) {
    console.log(chalk.green("  No issues found — screenshots match!"));
    console.log();
    return;
  }

  console.log("  Issues found:");

  for (const issue of analysis.issues) {
    const id = chalk.white(String(issue.id).padStart(3));
    const title = chalk.white(issue.title.padEnd(55));
    const area = chalk.dim(issue.area);
    console.log(`  ${id}  ${title} ${area}`);
  }

  console.log();
}

function parseSelection(input: string, maxId: number): number[] | null {
  const trimmed = input.trim();
  if (trimmed === "*") {
    return Array.from({ length: maxId }, (_, i) => i + 1);
  }

  const parts = trimmed.split(",").map((s) => s.trim());
  const ids: number[] = [];

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 1 || num > maxId) {
      return null;
    }
    ids.push(num);
  }

  return ids.length > 0 ? [...new Set(ids)] : null;
}

export async function runInteractive(analysis: AnalysisResult): Promise<Fix[]> {
  displayResults(analysis);

  if (analysis.issues.length === 0) {
    return [];
  }

  let selectedIds: number[] | null = null;

  while (selectedIds === null) {
    const answer = await input({
      message:
        chalk.cyan("==>") +
        " Select issues to get fix suggestions for (e.g. 1,2 or * for all)\n" +
        chalk.cyan("==>"),
    });

    selectedIds = parseSelection(answer, analysis.issues.length);
    if (selectedIds === null) {
      console.log(
        chalk.red("  Invalid selection. Enter issue numbers separated by commas, or * for all."),
      );
    }
  }

  const selectedIssues: Issue[] = analysis.issues.filter((issue) =>
    selectedIds!.includes(issue.id),
  );

  console.log();
  console.log(chalk.dim("  Fetching fix suggestions from Claude..."));

  const fixResult = await getFixSuggestions(selectedIssues);

  console.log();
  console.log("  Fix suggestions:");
  console.log();

  for (const fix of fixResult.fixes) {
    console.log(chalk.white(`  [${fix.id}] ${fix.title}`));
    const lines = fix.suggestion.split("\n");
    for (const line of lines) {
      console.log(chalk.dim(`      → ${line}`));
    }
    console.log();
  }

  return fixResult.fixes;
}
