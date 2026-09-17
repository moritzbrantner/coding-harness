import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentPerformanceEvidence, parseAgentRunTrace } from "../src/agent-evidence.ts";
import { parseCli } from "../src/cli.ts";
import type { RepositoryEvidence } from "../src/model.ts";

const taskHash = `sha256:${"a".repeat(64)}`;
const repository: RepositoryEvidence = {
  root: "/repo",
  head: "0123456789abcdef",
  clean: true,
  statusPorcelain: [],
  worktree: [],
  executions: [
    {
      command: ["git", "rev-parse", "HEAD"],
      cwd: "/repo",
      exitCode: 0,
      stdout: "0123456789abcdef\n",
      stderr: "",
    },
  ],
};

function measurement(
  evidence: ReturnType<typeof buildAgentPerformanceEvidence>,
  name: string,
): number | undefined {
  for (const group of Object.values(evidence.measurements)) {
    const match = group.find((item) => item.name === name);
    if (match) return match.value;
  }
  return undefined;
}

test("parses agent-evidence with its deterministic default report path", () => {
  const options = parseCli(["agent-evidence", "--root", "/repo", "--input", "trace.json"]);
  assert.equal(options.command, "agent-evidence");
  assert.equal(options.report, ".artifacts/coding-harness/agent-performance.json");
  if (options.command === "agent-evidence") assert.equal(options.input, "trace.json");
});

test("aggregates agent tokens and time into performance evidence", () => {
  const trace = parseAgentRunTrace({
    schemaVersion: 1,
    runId: "run-17",
    taskHash,
    status: "passed",
    durationMs: 12000,
    environment: {
      fingerprint: `sha256:${"b".repeat(64)}`,
      platform: { os: "linux", arch: "x64" },
      toolchain: { harness: "0.1.0" },
    },
    invocations: [
      {
        id: "repair-2",
        sequence: 2,
        stage: "repair",
        provider: "openai",
        model: "gpt-5.6",
        attempt: 2,
        status: "passed",
        durationMs: 5000,
        tokens: { input: 300, cachedInput: 200, output: 120, reasoning: 40 },
      },
      {
        id: "inspect-1",
        sequence: 1,
        stage: "inspect",
        provider: "openai",
        model: "gpt-5.6",
        status: "passed",
        durationMs: 2500,
        tokens: { input: 100, cachedInput: 0, output: 50, reasoning: 0 },
      },
    ],
    spans: [
      {
        id: "ci-1",
        sequence: 2,
        invocationId: "repair-2",
        stage: "repair",
        kind: "ci",
        name: "github-actions",
        status: "passed",
        durationMs: 3000,
      },
      {
        id: "tool-1",
        sequence: 1,
        invocationId: "inspect-1",
        kind: "tool",
        name: "github-search",
        status: "passed",
        durationMs: 400,
      },
    ],
  });

  const evidence = buildAgentPerformanceEvidence(trace, repository);
  assert.equal(evidence.schema_version, "1.0.0");
  assert.equal(evidence.scenario.id, "coding-agent/run");
  assert.equal(evidence.source.revision, repository.head);
  assert.equal(measurement(evidence, "agent.input_tokens"), 400);
  assert.equal(measurement(evidence, "agent.cached_input_tokens"), 200);
  assert.equal(measurement(evidence, "agent.output_tokens"), 170);
  assert.equal(measurement(evidence, "agent.reasoning_tokens"), 40);
  assert.equal(measurement(evidence, "agent.invocations.duration_ms"), 7500);
  assert.equal(measurement(evidence, "agent.span.ci.duration_ms"), 3000);
  assert.equal(measurement(evidence, "agent.stage.repair.span.ci.duration_ms"), 3000);
  assert.equal(measurement(evidence, "agent.run.time_to_green_ms"), 12000);
  assert.equal(measurement(evidence, "agent.stage.repair.input_tokens"), 300);
  assert.deepEqual(evidence.extensions["coding-harness.agent"].repository, repository);
  assert.deepEqual(
    evidence.extensions["coding-harness.agent"].invocations.map((item) => item.id),
    ["inspect-1", "repair-2"],
  );
  assert.deepEqual(
    evidence.extensions["coding-harness.agent"].stage_totals.map((item) => item.stage),
    ["inspect", "repair"],
  );
  assert.equal(evidence.extensions["coding-harness.agent"].model_totals[0]?.tokens.input, 400);
});

test("does not turn unreported token categories into zero usage", () => {
  const trace = parseAgentRunTrace({
    schemaVersion: 1,
    runId: "run-18",
    taskHash,
    status: "failed",
    durationMs: 1000,
    invocations: [
      {
        id: "review-1",
        sequence: 1,
        stage: "review",
        provider: "local",
        model: "unknown",
        status: "failed",
        durationMs: 900,
      },
    ],
    spans: [],
  });

  const evidence = buildAgentPerformanceEvidence(trace, repository);
  assert.equal(measurement(evidence, "agent.input_tokens"), undefined);
  assert.equal(measurement(evidence, "agent.run.time_to_green_ms"), undefined);
  assert.deepEqual(evidence.extensions["coding-harness.agent"].stage_totals[0]?.tokens, {});
});

test("omits partial token aggregates at run, stage, and model level", () => {
  const trace = parseAgentRunTrace({
    schemaVersion: 1,
    runId: "run-18-partial",
    taskHash,
    status: "passed",
    durationMs: 2000,
    invocations: [
      {
        id: "repair-1",
        sequence: 1,
        stage: "repair",
        provider: "openai",
        model: "gpt-5.6",
        status: "failed",
        durationMs: 800,
        tokens: { input: 100, output: 25 },
      },
      {
        id: "repair-2",
        sequence: 2,
        stage: "repair",
        provider: "openai",
        model: "gpt-5.6",
        attempt: 2,
        status: "passed",
        durationMs: 900,
        tokens: { output: 30 },
      },
    ],
    spans: [],
  });

  const evidence = buildAgentPerformanceEvidence(trace, repository);
  assert.equal(measurement(evidence, "agent.input_tokens"), undefined);
  assert.equal(measurement(evidence, "agent.output_tokens"), 55);
  assert.equal(measurement(evidence, "agent.stage.repair.input_tokens"), undefined);
  assert.equal(measurement(evidence, "agent.stage.repair.output_tokens"), 55);
  const extension = evidence.extensions["coding-harness.agent"];
  assert.equal(extension.stage_totals[0]?.tokens.input, undefined);
  assert.equal(extension.stage_totals[0]?.tokens.output, 55);
  assert.equal(extension.model_totals[0]?.tokens.input, undefined);
  assert.equal(extension.model_totals[0]?.tokens.output, 55);
});

test("rejects transcript-like fields and broken references", () => {
  assert.throws(
    () =>
      parseAgentRunTrace({
        schemaVersion: 1,
        runId: "run-19",
        taskHash,
        status: "passed",
        durationMs: 1,
        prompt: "secret prompt",
        invocations: [],
        spans: [],
      }),
    /unknown field prompt/,
  );

  assert.throws(
    () =>
      parseAgentRunTrace({
        schemaVersion: 1,
        runId: "run-20",
        taskHash,
        status: "passed",
        durationMs: 1,
        invocations: [],
        spans: [
          {
            id: "tool-1",
            sequence: 1,
            invocationId: "missing",
            kind: "tool",
            name: "github-search",
            status: "passed",
            durationMs: 1,
          },
        ],
      }),
    /unknown invocation missing/,
  );
});

test("fails closed without exact repository provenance", () => {
  const trace = parseAgentRunTrace({
    schemaVersion: 1,
    runId: "run-21",
    taskHash,
    status: "passed",
    durationMs: 1,
    invocations: [],
    spans: [],
  });

  assert.throws(
    () => buildAgentPerformanceEvidence(trace, { ...repository, head: null }),
    /exact HEAD/,
  );
});
