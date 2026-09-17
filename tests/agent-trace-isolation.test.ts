import assert from "node:assert/strict";
import test from "node:test";

import { AgentTraceRecorder } from "../src/agent-trace.ts";

const taskHash = `sha256:${"e".repeat(64)}`;

function controlledClock(initial = 1000): {
  now: () => number;
  set(value: number): void;
} {
  let current = initial;
  return {
    now: () => current,
    set: (value) => {
      current = value;
    },
  };
}

test("copies only declared invocation, span, and token fields into recorder state", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({
    runId: "run-isolation-fields",
    taskHash,
    now: clock.now,
  });

  const invocationInput = {
    id: "implement-1",
    stage: "implement",
    provider: "openai",
    model: "example-model",
    prompt: "must-not-be-collected",
  };
  const invocation = recorder.startInvocation(invocationInput);
  invocationInput.provider = "mutated-after-start";

  clock.set(1010);
  const spanInput = {
    id: "tool-1",
    invocationId: "implement-1",
    kind: "tool" as const,
    name: "repository-search",
    response: "must-not-be-collected",
  };
  const span = recorder.startSpan(spanInput);
  spanInput.name = "mutated-after-start";

  clock.set(1020);
  const completedSpan = span.finish("passed");
  assert.equal("response" in completedSpan, false);
  assert.equal(completedSpan.name, "repository-search");

  clock.set(1030);
  const tokenInput = {
    input: 10,
    output: 5,
    transcript: "must-not-be-collected",
  };
  const completedInvocation = invocation.finish({ status: "passed", tokens: tokenInput });
  assert.equal("prompt" in completedInvocation, false);
  assert.equal("transcript" in (completedInvocation.tokens ?? {}), false);
  assert.equal(completedInvocation.provider, "openai");

  clock.set(1040);
  const trace = recorder.finish("passed");
  assert.equal(JSON.stringify(trace).includes("must-not-be-collected"), false);
  assert.equal(trace.invocations[0]?.provider, "openai");
  assert.equal(trace.spans[0]?.name, "repository-search");
});

test("completion handles return detached snapshots", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({
    runId: "run-isolation-results",
    taskHash,
    now: clock.now,
  });

  const invocation = recorder.startInvocation({
    id: "review-1",
    stage: "review",
    provider: "openai",
    model: "example-model",
  });
  clock.set(1010);
  const span = recorder.startSpan({
    id: "wait-1",
    invocationId: "review-1",
    kind: "wait",
    name: "ci-queue",
  });
  clock.set(1020);
  const completedSpan = span.finish("passed");
  clock.set(1030);
  const completedInvocation = invocation.finish({
    status: "passed",
    tokens: { input: 11, output: 7 },
  });

  completedSpan.name = "tampered-span";
  completedSpan.durationMs = 999;
  completedInvocation.provider = "tampered-provider";
  completedInvocation.durationMs = 999;
  if (completedInvocation.tokens) completedInvocation.tokens.input = 999;

  clock.set(1040);
  const trace = recorder.finish("passed");
  assert.equal(trace.invocations[0]?.provider, "openai");
  assert.equal(trace.invocations[0]?.durationMs, 30);
  assert.equal(trace.invocations[0]?.tokens?.input, 11);
  assert.equal(trace.spans[0]?.name, "ci-queue");
  assert.equal(trace.spans[0]?.durationMs, 10);
});
