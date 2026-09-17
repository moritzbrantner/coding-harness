import assert from "node:assert/strict";
import test from "node:test";

import { AgentTraceRecorder } from "../src/agent-trace.ts";

const taskHash = `sha256:${"d".repeat(64)}`;

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

test("records invocation, span, token, and run durations from one monotonic clock", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({
    runId: "run-recorder-1",
    taskHash,
    environment: { platform: { os: "test" } },
    now: clock.now,
  });

  const invocation = recorder.startInvocation({
    id: "implement-1",
    stage: "implement",
    provider: "openai",
    model: "example-model",
  });
  clock.set(1010);
  const span = recorder.startSpan({
    id: "tool-1",
    invocationId: "implement-1",
    kind: "tool",
    name: "repository-search",
  });
  clock.set(1030);
  span.finish("passed");
  clock.set(1080);
  invocation.finish({
    status: "passed",
    tokens: { input: 120, cachedInput: 80, output: 40, reasoning: 10 },
  });
  clock.set(1100);

  const trace = recorder.finish("passed");
  assert.equal(trace.durationMs, 100);
  assert.deepEqual(trace.invocations, [
    {
      id: "implement-1",
      sequence: 1,
      stage: "implement",
      provider: "openai",
      model: "example-model",
      status: "passed",
      durationMs: 80,
      tokens: { input: 120, cachedInput: 80, output: 40, reasoning: 10 },
    },
  ]);
  assert.deepEqual(trace.spans, [
    {
      id: "tool-1",
      sequence: 2,
      invocationId: "implement-1",
      kind: "tool",
      name: "repository-search",
      status: "passed",
      durationMs: 20,
    },
  ]);
  assert.deepEqual(trace.environment, { platform: { os: "test" } });
});

test("assigns sequence at start so completion order cannot rewrite causality", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({ runId: "run-recorder-2", taskHash, now: clock.now });
  const first = recorder.startInvocation({
    id: "inspect-1",
    stage: "inspect",
    provider: "openai",
    model: "example-model",
  });
  clock.set(1010);
  const second = recorder.startInvocation({
    id: "review-1",
    stage: "review",
    provider: "openai",
    model: "example-model",
  });
  clock.set(1020);
  second.finish({ status: "passed" });
  clock.set(1030);
  first.finish({ status: "passed" });
  clock.set(1040);

  const trace = recorder.finish("passed");
  assert.deepEqual(
    trace.invocations.map((item) => [item.id, item.sequence, item.durationMs]),
    [
      ["inspect-1", 1, 30],
      ["review-1", 2, 10],
    ],
  );
});

test("rejects clock regressions between operations without consuming sequence", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({
    runId: "run-recorder-global-clock",
    taskHash,
    now: clock.now,
  });

  clock.set(1100);
  const first = recorder.startInvocation({
    id: "inspect-1",
    stage: "inspect",
    provider: "openai",
    model: "example-model",
  });

  clock.set(1050);
  assert.throws(
    () =>
      recorder.startInvocation({
        id: "review-1",
        stage: "review",
        provider: "openai",
        model: "example-model",
      }),
    /clock moved backwards/,
  );

  clock.set(1110);
  const second = recorder.startInvocation({
    id: "review-1",
    stage: "review",
    provider: "openai",
    model: "example-model",
  });
  clock.set(1120);
  first.finish({ status: "passed" });
  clock.set(1130);
  second.finish({ status: "passed" });
  clock.set(1140);

  const trace = recorder.finish("passed");
  assert.deepEqual(
    trace.invocations.map((item) => [item.id, item.sequence]),
    [
      ["inspect-1", 1],
      ["review-1", 2],
    ],
  );
});

test("fails closed on duplicate ids, unknown invocation references, and open work", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({ runId: "run-recorder-3", taskHash, now: clock.now });
  const invocation = recorder.startInvocation({
    id: "repair-1",
    stage: "repair",
    provider: "openai",
    model: "example-model",
  });

  assert.throws(
    () =>
      recorder.startInvocation({
        id: "repair-1",
        stage: "repair",
        provider: "openai",
        model: "example-model",
      }),
    /duplicate invocation id repair-1/,
  );
  assert.throws(
    () =>
      recorder.startSpan({
        id: "tool-unknown",
        invocationId: "missing",
        kind: "tool",
        name: "repository-search",
      }),
    /unknown invocation missing/,
  );
  assert.throws(() => recorder.finish("passed"), /open invocations: repair-1/);

  clock.set(1010);
  invocation.finish({ status: "passed" });
  const span = recorder.startSpan({ id: "ci-1", kind: "ci", name: "exact-head-validation" });
  assert.throws(() => recorder.finish("passed"), /open spans: ci-1/);
  clock.set(1020);
  span.finish("passed");
  recorder.finish("passed");
});

test("rejects backwards clocks and use after finalization", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({ runId: "run-recorder-4", taskHash, now: clock.now });
  const invocation = recorder.startInvocation({
    id: "review-1",
    stage: "review",
    provider: "local",
    model: "example-model",
  });

  clock.set(999);
  assert.throws(() => invocation.finish({ status: "passed" }), /clock moved backwards/);
  clock.set(1010);
  invocation.finish({ status: "passed" });
  clock.set(1020);
  recorder.finish("passed");

  assert.throws(
    () => recorder.startSpan({ id: "tool-1", kind: "tool", name: "repository-search" }),
    /already finished/,
  );
  assert.throws(() => recorder.finish("passed"), /already finished/);
});

test("prevents handles from being completed twice", () => {
  const clock = controlledClock();
  const recorder = new AgentTraceRecorder({ runId: "run-recorder-5", taskHash, now: clock.now });
  const invocation = recorder.startInvocation({
    id: "implement-1",
    stage: "implement",
    provider: "openai",
    model: "example-model",
  });
  clock.set(1010);
  invocation.finish({ status: "passed" });
  assert.throws(() => invocation.finish({ status: "passed" }), /already finished/);

  const span = recorder.startSpan({ id: "wait-1", kind: "wait", name: "ci-queue" });
  clock.set(1020);
  span.finish("passed");
  assert.throws(() => span.finish("passed"), /already finished/);
});
