import assert from "node:assert/strict";
import test from "node:test";

import { layerEvidence, validateRepository, validationLayers } from "../src/harness.ts";
import type { CommandExecution, CommandRunner, ResultStatus } from "../src/model.ts";

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
    if (command === "git" && args[0] === "status")
      return { exitCode: 0, stdout: "", stderr: "" };

    const layer = validationLayers[toolingIndex++];
    assert.ok(layer);
    return execution(statusByLayer[layer.id] ?? "passed", layer.id);
  };
  return { run, calls };
}

test("runs the validation layers in deterministic order", () => {
  const { run, calls } = fakeRunner();
  const report = validateRepository("/repo", { command: "coding-tooling", prefixArgs: [] }, { runCommand: run });

  assert.equal(report.status, "passed");
  assert.equal(report.stoppedAt, null);
  assert.equal(report.repository.head, "0123456789abcdef");
  assert.equal(report.repository.clean, true);
  assert.deepEqual(
    report.layers.map((layer) => layer.id),
    validationLayers.map((layer) => layer.id),
  );
  assert.equal(calls.length, validationLayers.length + 2);
});

test("fails closed and stops after the first non-passing layer", () => {
  const { run } = fakeRunner({ integration: "failed" });
  const report = validateRepository("/repo", { command: "coding-tooling", prefixArgs: [] }, { runCommand: run });

  assert.equal(report.status, "failed");
  assert.equal(report.stoppedAt, "integration");
  assert.deepEqual(report.layers.map((layer) => layer.id), [
    "discovery",
    "conformance",
    "fast",
    "integration",
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

  const report = validateRepository("/repo", { command: "coding-tooling", prefixArgs: [] }, { runCommand: run });
  assert.equal(report.status, "passed");
  assert.equal(report.repository.clean, false);
  assert.deepEqual(report.repository.statusPorcelain, [" M src/example.ts", "?? scratch.txt"]);
});

test("rejects malformed or exit-status-inconsistent tooling evidence", () => {
  const malformed = layerEvidence("discovery", ["coding-tooling", "inspect", "--json"], {
    exitCode: 0,
    stdout: "not json",
    stderr: "",
  });
  assert.equal(malformed.status, "error");

  const mismatch = layerEvidence("discovery", ["coding-tooling", "inspect", "--json"], {
    exitCode: 0,
    stdout: JSON.stringify({ status: "failed" }),
    stderr: "",
  });
  assert.equal(mismatch.status, "error");
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
