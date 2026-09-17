import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { buildAgentPerformanceEvidence, parseAgentRunTrace } from "./agent-evidence.ts";
import {
  convergeRepository,
  repositoryEvidence,
  validateRepository,
  type ToolingInvocation,
} from "./harness.ts";
import type { ResultStatus } from "./model.ts";
import { runCommand } from "./process.ts";

type CommonCliOptions = {
  root: string;
  report: string;
  json: boolean;
};

export type RepositoryCliOptions = CommonCliOptions & {
  command: "validate" | "converge";
  tooling: string;
};

export type AgentEvidenceCliOptions = CommonCliOptions & {
  command: "agent-evidence";
  input: string;
};

export type CliOptions = RepositoryCliOptions | AgentEvidenceCliOptions;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage: coding-harness <validate|converge> [--root <path>] [--tooling <command-or-path>] [--report <path>] [--json]\n" +
      "       coding-harness agent-evidence --input <trace.json> [--root <path>] [--report <path>] [--json]",
  );
  process.exit(2);
}

export function parseCli(argv: string[]): CliOptions {
  const [command, ...rest] = argv;
  if (command !== "validate" && command !== "converge" && command !== "agent-evidence") usage();

  let root = process.cwd();
  let tooling = process.env.CODING_TOOLING_BIN ?? "coding-tooling";
  let input: string | null = null;
  let report =
    command === "validate"
      ? ".artifacts/coding-harness/validation.json"
      : command === "converge"
        ? ".artifacts/coding-harness/convergence.json"
        : ".artifacts/coding-harness/agent-performance.json";
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (option === "--json") {
      json = true;
      continue;
    }
    const allowed =
      command === "agent-evidence"
        ? option === "--root" || option === "--input" || option === "--report"
        : option === "--root" || option === "--tooling" || option === "--report";
    if (!allowed) usage(`Unknown option for ${command}: ${option}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) usage(`Missing value for ${option}`);
    if (option === "--root") root = value;
    if (option === "--tooling") tooling = value;
    if (option === "--input") input = value;
    if (option === "--report") report = value;
    index += 1;
  }

  const resolvedRoot = resolve(root);
  if (command === "agent-evidence") {
    if (!input) usage("agent-evidence requires --input <trace.json>");
    return { command, root: resolvedRoot, input, report, json };
  }
  return { command, root: resolvedRoot, tooling, report, json };
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

function writeReport(root: string, report: string, result: unknown, json: boolean): void {
  const reportPath = resolve(root, report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, json ? 0 : 2));
}

function collectAgentEvidence(options: AgentEvidenceCliOptions): ResultStatus {
  try {
    const inputPath = resolve(options.root, options.input);
    const trace = parseAgentRunTrace(JSON.parse(readFileSync(inputPath, "utf8")) as unknown);
    const repository = repositoryEvidence(options.root, runCommand);
    const result = buildAgentPerformanceEvidence(trace, repository);
    writeReport(options.root, options.report, result, options.json);
    return trace.status;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return "error";
  }
}

export function main(argv = process.argv.slice(2)): number {
  const options = parseCli(argv);
  if (options.command === "agent-evidence") return exitCode(collectAgentEvidence(options));

  const tooling = resolveToolingInvocation(options.tooling);
  const result =
    options.command === "validate"
      ? validateRepository(options.root, tooling)
      : convergeRepository(options.root, tooling);
  writeReport(options.root, options.report, result, options.json);
  return exitCode(result.status);
}
