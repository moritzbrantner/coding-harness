import { resolve } from "node:path";

import type {
  CommandExecution,
  CommandRunner,
  ConvergenceReport,
  LayerEvidence,
  ProcessEvidence,
  RepositoryDelta,
  RepositoryEvidence,
  ResultStatus,
  ToolEnvelope,
  ValidationReport,
} from "./model.ts";
import { runCommand as defaultRunCommand } from "./process.ts";

const expectedExitCodes: Record<ResultStatus, number> = {
  passed: 0,
  failed: 1,
  unavailable: 2,
  error: 3,
};

export const validationLayers = [
  { id: "discovery", args: ["inspect", "--json"] },
  { id: "conformance", args: ["conformance", "--json"] },
  { id: "fast", args: ["run", "--tier", "fast", "--strict", "--json"] },
  {
    id: "integration",
    args: ["run", "--tier", "integration", "--strict", "--json"],
  },
  {
    id: "workflow",
    args: ["run", "--tier", "workflow", "--strict", "--json"],
  },
  { id: "e2e", args: ["run", "--tier", "e2e", "--strict", "--json"] },
  { id: "findings", args: ["findings", "--new", "--json"] },
] as const;

export type ToolingInvocation = {
  command: string;
  prefixArgs: string[];
};

export type HarnessDependencies = {
  runCommand?: CommandRunner;
};

function isResultStatus(value: unknown): value is ResultStatus {
  return value === "passed" || value === "failed" || value === "unavailable" || value === "error";
}

function isToolEnvelope(value: unknown): value is ToolEnvelope {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidLayer(evidence: LayerEvidence, error: string): LayerEvidence {
  return {
    ...evidence,
    status: "error",
    error,
  };
}

function unavailableLayer(
  id: string,
  command: string[],
  execution: CommandExecution,
): LayerEvidence {
  return {
    id,
    command,
    exitCode: execution.exitCode,
    status: "unavailable",
    stderr: execution.stderr || undefined,
    error: execution.error ?? "Command could not be executed",
  };
}

export function layerEvidence(
  id: string,
  command: string[],
  execution: CommandExecution,
): LayerEvidence {
  if (execution.error) return unavailableLayer(id, command, execution);

  let parsed: unknown;
  try {
    parsed = JSON.parse(execution.stdout) as unknown;
  } catch {
    return {
      id,
      command,
      exitCode: execution.exitCode,
      status: "error",
      stderr: execution.stderr || undefined,
      error: "coding-tooling did not return valid JSON",
    };
  }

  if (!isToolEnvelope(parsed)) {
    return {
      id,
      command,
      exitCode: execution.exitCode,
      status: "error",
      stderr: execution.stderr || undefined,
      error: "coding-tooling did not return a JSON object envelope",
    };
  }

  const output = parsed;
  if (!isResultStatus(output.status)) {
    return {
      id,
      command,
      exitCode: execution.exitCode,
      status: "error",
      output,
      stderr: execution.stderr || undefined,
      error: "coding-tooling returned an unknown result status",
    };
  }

  if (execution.exitCode !== expectedExitCodes[output.status]) {
    return {
      id,
      command,
      exitCode: execution.exitCode,
      status: "error",
      output,
      stderr: execution.stderr || undefined,
      error: `coding-tooling status ${output.status} did not match exit code ${execution.exitCode}`,
    };
  }

  return {
    id,
    command,
    exitCode: execution.exitCode,
    status: output.status,
    output,
    stderr: execution.stderr || undefined,
  };
}

export function convergenceEvidence(command: string[], execution: CommandExecution): LayerEvidence {
  const evidence = layerEvidence("converge", command, execution);
  if (!evidence.output) return evidence;
  if (evidence.output.operation !== "converge")
    return invalidLayer(evidence, "coding-tooling returned a non-convergence result");

  const data = evidence.output.data;
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return invalidLayer(evidence, "coding-tooling convergence result did not contain object data");

  const result = (data as Record<string, unknown>).result;
  if (result !== "converged" && result !== "partial" && result !== "blocked")
    return invalidLayer(evidence, "coding-tooling convergence result had an unknown result state");

  if ((evidence.status === "passed") === (result === "blocked"))
    return invalidLayer(evidence, "coding-tooling convergence result disagreed with its status");

  return evidence;
}

function processEvidence(
  command: string,
  args: string[],
  execution: CommandExecution,
): ProcessEvidence {
  return {
    command: [command, ...args],
    exitCode: execution.exitCode,
    stdout: execution.stdout,
    stderr: execution.stderr,
    error: execution.error,
  };
}

export function repositoryEvidence(root: string, runCommand: CommandRunner): RepositoryEvidence {
  const executions: ProcessEvidence[] = [];
  const headArgs = ["rev-parse", "HEAD"];
  const head = runCommand("git", headArgs, root);
  executions.push(processEvidence("git", headArgs, head));
  if (head.error || head.exitCode !== 0) {
    return {
      root,
      head: null,
      clean: null,
      statusPorcelain: [],
      executions,
      error: head.error ?? (head.stderr.trim() || "Could not resolve repository HEAD"),
    };
  }

  const statusArgs = ["status", "--porcelain=v1"];
  const status = runCommand("git", statusArgs, root);
  executions.push(processEvidence("git", statusArgs, status));
  if (status.error || status.exitCode !== 0) {
    return {
      root,
      head: head.stdout.trim(),
      clean: null,
      statusPorcelain: [],
      executions,
      error: status.error ?? (status.stderr.trim() || "Could not inspect repository worktree"),
    };
  }

  const statusPorcelain = status.stdout.split(/\r?\n/).filter(Boolean);
  return {
    root,
    head: head.stdout.trim(),
    clean: statusPorcelain.length === 0,
    statusPorcelain,
    executions,
  };
}

function worktreeStateByPath(statusPorcelain: string[]): Map<string, string> {
  return new Map(statusPorcelain.map((entry) => [entry.slice(3), entry.slice(0, 2)]));
}

export function repositoryDelta(
  before: RepositoryEvidence,
  after: RepositoryEvidence,
): RepositoryDelta {
  const headChanged =
    before.head === null || after.head === null ? null : before.head !== after.head;
  if (before.error || after.error) {
    return { headChanged, worktreeChanged: null, changedPaths: [] };
  }

  const beforeState = worktreeStateByPath(before.statusPorcelain);
  const afterState = worktreeStateByPath(after.statusPorcelain);
  const paths = new Set([...beforeState.keys(), ...afterState.keys()]);
  const changedPaths = [...paths]
    .filter((path) => beforeState.get(path) !== afterState.get(path))
    .sort();

  return {
    headChanged,
    worktreeChanged: changedPaths.length > 0,
    changedPaths,
  };
}

export function validateRepository(
  root: string,
  tooling: ToolingInvocation,
  dependencies: HarnessDependencies = {},
): ValidationReport {
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const resolvedRoot = resolve(root);
  const repository = repositoryEvidence(resolvedRoot, runCommand);
  const report: ValidationReport = {
    schemaVersion: 1,
    operation: "validate",
    status: "passed",
    repository,
    tooling: { ...tooling },
    layers: [],
    stoppedAt: null,
  };

  if (repository.error) {
    report.status = "error";
    report.stoppedAt = "repository";
    return report;
  }

  for (const layer of validationLayers) {
    const args = [...tooling.prefixArgs, ...layer.args];
    const command = [tooling.command, ...args];
    const execution = runCommand(tooling.command, args, resolvedRoot);
    const evidence = layerEvidence(layer.id, command, execution);
    report.layers.push(evidence);

    if (evidence.status !== "passed") {
      report.status = evidence.status;
      report.stoppedAt = layer.id;
      return report;
    }
  }

  return report;
}

export function convergeRepository(
  root: string,
  tooling: ToolingInvocation,
  dependencies: HarnessDependencies = {},
): ConvergenceReport {
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const resolvedRoot = resolve(root);
  const repositoryBefore = repositoryEvidence(resolvedRoot, runCommand);
  const report: ConvergenceReport = {
    schemaVersion: 1,
    operation: "converge",
    status: "passed",
    repositoryBefore,
    repositoryAfter: null,
    repositoryDelta: null,
    tooling: { ...tooling },
    convergence: null,
    validation: null,
    stoppedAt: null,
  };

  if (repositoryBefore.error) {
    report.status = "error";
    report.stoppedAt = "repository-before";
    return report;
  }

  const args = [...tooling.prefixArgs, "converge", "--no-verify", "--json"];
  const command = [tooling.command, ...args];
  const execution = runCommand(tooling.command, args, resolvedRoot);
  const convergence = convergenceEvidence(command, execution);
  report.convergence = convergence;

  if (convergence.status !== "passed") {
    const repositoryAfter = repositoryEvidence(resolvedRoot, runCommand);
    report.repositoryAfter = repositoryAfter;
    report.repositoryDelta = repositoryDelta(repositoryBefore, repositoryAfter);
    if (repositoryAfter.error) {
      report.status = "error";
      report.stoppedAt = "repository-after";
      return report;
    }
    report.status = convergence.status;
    report.stoppedAt = "converge";
    return report;
  }

  const validation = validateRepository(resolvedRoot, tooling, { runCommand });
  report.validation = validation;
  report.repositoryAfter = validation.repository;
  report.repositoryDelta = repositoryDelta(repositoryBefore, validation.repository);
  report.status = validation.status;
  if (validation.status !== "passed")
    report.stoppedAt = `validation:${validation.stoppedAt ?? "unknown"}`;
  return report;
}
