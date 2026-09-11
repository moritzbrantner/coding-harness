import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { validateRepository, type ToolingInvocation } from "./harness.ts";
import type { ResultStatus } from "./model.ts";

export type CliOptions = {
  command: "validate";
  root: string;
  tooling: string;
  report: string;
  json: boolean;
};

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage: coding-harness validate [--root <path>] [--tooling <command-or-path>] [--report <path>] [--json]",
  );
  process.exit(2);
}

export function parseCli(argv: string[]): CliOptions {
  const [command, ...rest] = argv;
  if (command !== "validate") usage();

  let root = process.cwd();
  let tooling = process.env.CODING_TOOLING_BIN ?? "coding-tooling";
  let report = ".artifacts/coding-harness/validation.json";
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (option === "--json") {
      json = true;
      continue;
    }
    if (option !== "--root" && option !== "--tooling" && option !== "--report")
      usage(`Unknown option: ${option}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) usage(`Missing value for ${option}`);
    if (option === "--root") root = value;
    if (option === "--tooling") tooling = value;
    if (option === "--report") report = value;
    index += 1;
  }

  return { command, root: resolve(root), tooling, report, json };
}

export function resolveToolingInvocation(tooling: string): ToolingInvocation {
  if (extname(tooling) === ".ts") {
    return { command: "bun", prefixArgs: [resolve(tooling)] };
  }
  return { command: tooling, prefixArgs: [] };
}

function exitCode(status: ResultStatus): number {
  return status === "passed" ? 0 : status === "failed" ? 1 : status === "unavailable" ? 2 : 3;
}

export function main(argv = process.argv.slice(2)): number {
  const options = parseCli(argv);
  const result = validateRepository(options.root, resolveToolingInvocation(options.tooling));
  const reportPath = resolve(options.root, options.report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, options.json ? 0 : 2));
  return exitCode(result.status);
}
