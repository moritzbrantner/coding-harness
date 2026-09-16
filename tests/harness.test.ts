import assert from "node:assert/strict";
import test from "node:test";

import { parseCli } from "../src/cli.ts";
import {
  convergeRepository,
  convergenceEvidence,
  layerEvidence,
  repositoryDelta,
  validateRepository,
  validationLayers,
} from "../src/harness.ts";
import type {
  CommandExecution,
  CommandRunner,
  RepositoryEvidence,
  ResultStatus,
} from "../src/model.ts";

const exitCodes: Record<ResultStatus, number> = {
  passed: 0,
  failed: 1,
  unavailable: 2,
  error: 3,
};

function execution(status: ResultStatus, operation = "test"): CommandExecution {
  return {
    exitCode: exitCodes[status],
    stdout: JSON.stringify({ schemaVersion: 1, operation, status, data: {}, diagnostics: [] }),
    stderr: "",
  };
}

function convergenceExecution(
  status: ResultStatus = "passed",
  result: "converged" | "partial" | "blocked" = status === "passed" ? "converged" : "blocked",
): CommandExecution {
  return {
    exitCode: exitCodes[status],
    stdout: JSON.stringify({
      schemaVersion: 1,
      operation: "converge",
      status,
      data: { result },
      diagnostics: [],
    }),
    stderr: "",
  };
}

function fakeRunner(statusByLayer: Partial<Record<string, ResultStatus>> = {}): {
  run: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  let toolingIndex = 0;
  const run: CommandRunner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git" && args[0] === "rev-parse")
      return { exitCode: 0, stdout: "0123456789abcdef\n", stderr: "" };
    if (command === "git" && args[0] === "status") return { exitCode: 0, stdout: "", stderr: "" };

    const layer = validationLayers[toolingIndex++];
    assert.ok(layer);
    return execution(statusByLayer[layer.id] ?? "passed", layer.id);
  };
  return { run, calls };
}

function fakeConvergenceRunner(
  convergeStatus: ResultStatus = "passed",
  statusByLayer: Partial<Record<string, ResultStatus>> = {},
): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  let gitStatusCount = 0;
  let validationIndex = 0;
  const run: CommandRunner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git" && args[0] === "rev-parse")
      return { exitCode: 0, stdout: "0123456789abcdef\n", stderr: "" };
    if (command === "git" && args[0] === "status") {
      gitStatusCount += 1;
      return {
        exitCode: 0,
        stdout:
          gitStatusCount === 1
            ? " M src/existing.ts\n"
            : " M src/existing.ts\n M src/generated.ts\n",
        stderr: "",
      };
    }
    if (args.includes("converge")) return convergenceExecution(convergeStatus);

    const layer = validationLayers[validationIndex++];
    assert.ok(layer);
    return execution(statusByLayer[layer.id] ?? "passed", layer.id);
  };
  return { run, calls };
}

test("runs the validation layers in deterministic order", () => {
  const { run, calls } = fakeRunner();
  const report = validateRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.equal(report.status, "passed");
  assert.equal(report.stoppedAt, null);
  assert.equal(report.repository.head, "0123456789abcdef");
  assert.equal(report.repository.clean, true);
  assert.deepEqual(
    report.repository.executions.map((item) => item.command),
    [
      ["git", "rev-parse", "HEAD"],
      ["git", "status", "--porcelain=v1"],
    ],
  );
  assert.deepEqual(
    validationLayers.map((layer) => layer.id),
    ["discovery", "conformance", "fast", "integration", "workflow", "e2e", "findings"],
  );
  assert.deepEqual(
    report.layers.map((layer) => layer.id),
    validationLayers.map((layer) => layer.id),
  );
  assert.equal(calls.length, validationLayers.length + 2);
});

test("fails closed and stops after the first non-passing layer", () => {
  const { run } = fakeRunner({ integration: "failed" });
  const report = validateRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.equal(report.status, "failed");
  assert.equal(report.stoppedAt, "integration");
  assert.deepEqual(
    report.layers.map((layer) => layer.id),
    ["discovery", "conformance", "fast", "integration"],
  );
});

test("runs workflow validation after integration and before e2e", () => {
  const { run, calls } = fakeRunner({ workflow: "failed" });
  const report = validateRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.equal(report.status, "failed");
  assert.equal(report.stoppedAt, "workflow");
  assert.deepEqual(
    report.layers.map((layer) => layer.id),
    ["discovery", "conformance", "fast", "integration", "workflow"],
  );
  assert.deepEqual(calls[calls.length - 1], [
    "coding-tooling",
    "run",
    "--tier",
    "workflow",
    "--strict",
    "--json",
  ]);
});

test("records a dirty worktree without pretending it is an exact clean-head run", () => {
  let toolingIndex = 0;
  const run: CommandRunner = (command, args) => {
    if (command === "git" && args[0] === "rev-parse")
      return { exitCode: 0, stdout: "abc\n", stderr: "" };
    if (command === "git" && args[0] === "status")
      return { exitCode: 0, stdout: " M src/example.ts\n?? scratch.txt\n", stderr: "" };
    const layer = validationLayers[toolingIndex++];
    assert.ok(layer);
    return execution("passed", layer.id);
  };

  const report = validateRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );
  assert.equal(report.status, "passed");
  assert.equal(report.repository.clean, false);
  assert.deepEqual(report.repository.statusPorcelain, [" M src/example.ts", "?? scratch.txt"]);
});

test("rejects malformed, non-object, and exit-status-inconsistent tooling evidence", () => {
  const malformed = layerEvidence("discovery", ["coding-tooling", "inspect", "--json"], {
    exitCode: 0,
    stdout: "not json",
    stderr: "",
  });
  assert.equal(malformed.status, "error");

  const nullEnvelope = layerEvidence("discovery", ["coding-tooling", "inspect", "--json"], {
    exitCode: 0,
    stdout: "null",
    stderr: "",
  });
  assert.equal(nullEnvelope.status, "error");
  assert.equal(nullEnvelope.error, "coding-tooling did not return a JSON object envelope");

  const mismatch = layerEvidence("discovery", ["coding-tooling", "inspect", "--json"], {
    exitCode: 0,
    stdout: JSON.stringify({ status: "failed" }),
    stderr: "",
  });
  assert.equal(mismatch.status, "error");
});

test("preserves exit evidence for Git repository inspection", () => {
  const { run } = fakeRunner();
  const report = validateRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.deepEqual(
    report.repository.executions.map((item) => item.exitCode),
    [0, 0],
  );
  assert.equal(report.repository.executions[0]?.stdout, "0123456789abcdef\n");
});

test("reports missing coding-tooling as unavailable", () => {
  const missing = layerEvidence("discovery", ["coding-tooling", "inspect", "--json"], {
    exitCode: null,
    stdout: "",
    stderr: "",
    error: "ENOENT",
  });
  assert.equal(missing.status, "unavailable");
});

test("rejects malformed convergence result states", () => {
  const evidence = convergenceEvidence(["coding-tooling", "converge", "--no-verify", "--json"], {
    exitCode: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      operation: "converge",
      status: "passed",
      data: { result: "unknown" },
      diagnostics: [],
    }),
    stderr: "",
  });

  assert.equal(evidence.status, "error");
  assert.equal(evidence.error, "coding-tooling convergence result had an unknown result state");
});

test("tracks repository changes without attributing pre-existing dirt to convergence", () => {
  const base = {
    root: "/repo",
    head: "abc",
    clean: false,
    executions: [],
  } satisfies Omit<RepositoryEvidence, "statusPorcelain">;
  const delta = repositoryDelta(
    { ...base, statusPorcelain: [" M src/existing.ts"] },
    { ...base, statusPorcelain: [" M src/existing.ts", "?? src/generated.ts"] },
  );

  assert.equal(delta.headChanged, false);
  assert.equal(delta.worktreeChanged, true);
  assert.deepEqual(delta.changedPaths, ["src/generated.ts"]);
});

test("does not invent a worktree delta when post-convergence evidence is unavailable", () => {
  const before: RepositoryEvidence = {
    root: "/repo",
    head: "abc",
    clean: false,
    statusPorcelain: [" M src/existing.ts"],
    executions: [],
  };
  const after: RepositoryEvidence = {
    root: "/repo",
    head: "abc",
    clean: null,
    statusPorcelain: [],
    executions: [],
    error: "Could not inspect repository worktree",
  };

  assert.deepEqual(repositoryDelta(before, after), {
    headChanged: false,
    worktreeChanged: null,
    changedPaths: [],
  });
});

test("converges without duplicate tooling verification and validates the resulting worktree", () => {
  const { run, calls } = fakeConvergenceRunner();
  const report = convergeRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.equal(report.status, "passed");
  assert.equal(report.stoppedAt, null);
  assert.equal(report.repositoryBefore.clean, false);
  assert.deepEqual(report.convergence?.command, [
    "coding-tooling",
    "converge",
    "--no-verify",
    "--json",
  ]);
  assert.equal(report.convergence?.status, "passed");
  assert.equal(report.repositoryAfter?.clean, false);
  assert.deepEqual(report.repositoryAfter?.statusPorcelain, [
    " M src/existing.ts",
    " M src/generated.ts",
  ]);
  assert.deepEqual(report.repositoryDelta, {
    headChanged: false,
    worktreeChanged: true,
    changedPaths: ["src/generated.ts"],
  });
  assert.equal(report.validation?.status, "passed");
  assert.equal(report.repositoryAfter, report.validation?.repository);
  assert.deepEqual(
    report.validation?.layers.map((layer) => layer.id),
    validationLayers.map((layer) => layer.id),
  );
  assert.equal(calls.length, validationLayers.length + 5);
});

test("does not validate after a blocked convergence operation", () => {
  const { run, calls } = fakeConvergenceRunner("failed");
  const report = convergeRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.equal(report.status, "failed");
  assert.equal(report.stoppedAt, "converge");
  assert.equal(report.convergence?.status, "failed");
  assert.deepEqual(report.repositoryDelta?.changedPaths, ["src/generated.ts"]);
  assert.equal(report.validation, null);
  assert.equal(calls.length, 5);
});

test("does not validate malformed convergence evidence", () => {
  const calls: string[][] = [];
  let gitStatusCount = 0;
  const run: CommandRunner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git" && args[0] === "rev-parse")
      return { exitCode: 0, stdout: "0123456789abcdef\n", stderr: "" };
    if (command === "git" && args[0] === "status") {
      gitStatusCount += 1;
      return {
        exitCode: 0,
        stdout: gitStatusCount === 1 ? "" : " M src/partial.ts\n",
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: "not json", stderr: "" };
  };

  const report = convergeRepository(
    "/repo",
    { command: "coding-tooling", prefixArgs: [] },
    { runCommand: run },
  );

  assert.equal(report.status, "error");
  assert.equal(report.stoppedAt, "converge");
  assert.equal(report.convergence?.error, "coding-tooling did not return valid JSON");
  assert.deepEqual(report.repositoryAfter?.statusPorcelain, [" M src/partial.ts"]);
  assert.deepEqual(report.repositoryDelta?.changedPaths, ["src/partial.ts"]);
  assert.equal(report.validation, null);
  assert.equal(calls.length, 5);
});

test("uses a dedicated convergence report path by default", () => {
  const options = parseCli(["converge", "--root", "."]);
  assert.equal(options.command, "converge");
  assert.equal(options.report, ".artifacts/coding-harness/convergence.json");
});
