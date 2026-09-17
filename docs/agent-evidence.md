# Agent performance evidence

`coding-harness agent-evidence` converts one provider-neutral coding-agent trace into the canonical `performance-evidence` document shape.

The harness owns collection and aggregation. `performance-evidence` remains authoritative for the portable evidence vocabulary and downstream comparison/visualization.

## Trace contract

The input trace records one task run with ordered agent invocations and child spans:

- `runId`: stable run identity. It is retained in the namespaced extension and hashed for the generic workload id.
- `taskHash`: SHA-256 identity for the task/workload. Raw task or prompt text is not accepted.
- `status` and `durationMs`: final outcome and wall-clock duration for the whole run.
- `invocations`: provider/model, stage, attempt, status, duration, and provider-reported token categories.
- `spans`: tool, CI, wait, or other child work with duration and optional invocation/stage ownership.
- `environment`: optional stable platform/toolchain metadata or a caller-provided environment fingerprint.

See `fixtures/agent-run.json` for a complete serialized example.

Unknown fields fail closed. In particular, prompt and response bodies are not part of this evidence contract. If a future workflow needs transcript retention, that must be a separate explicit artifact with its own privacy and retention policy.

## Recording real runs

`AgentTraceRecorder` is the preferred way for agent wrappers and harness integrations to create a trace. Callers no longer need to calculate durations or sequence numbers themselves.

```ts
const recorder = new AgentTraceRecorder({ runId, taskHash });
const invocation = recorder.startInvocation({
  id: "implement-1",
  stage: "implement",
  provider: "openai",
  model,
});

const tool = recorder.startSpan({
  id: "tool-1",
  invocationId: "implement-1",
  kind: "tool",
  name: "repository-search",
});
// run tool
tool.finish("passed");

// run provider invocation and read its native usage result
invocation.finish({ status: "passed", tokens: normalizedProviderTokens });
const trace = recorder.finish("passed");
```

The recorder uses one monotonic clock for run, invocation, and span timing. Sequence numbers are assigned when work starts and final traces are serialized in sequence order, so concurrent completion order cannot rewrite causality. A run cannot finish while invocations or spans remain open, duplicate IDs fail closed, unknown invocation references are rejected, and a backwards or non-finite clock is an error.

Provider adapters remain deliberately thin: they translate native provider usage fields into the existing optional `input`, `cachedInput`, `output`, and `reasoning` categories when those values are actually reported. They do not provide durations, sequence numbers, prompts, or responses to the core recorder.

## Token semantics

Token categories are provider-reported and are not assumed to be mutually exclusive. For example, cached-input tokens may be a subset of input tokens and reasoning tokens may be accounted differently between providers.

The harness therefore preserves and aggregates each reported category independently:

- input tokens;
- cached-input tokens;
- output tokens;
- reasoning tokens.

A category that a provider does not report is omitted rather than recorded as zero. Aggregate token measurements are emitted only when every invocation in that aggregate reports the category; mixed reporting remains unknown rather than becoming a misleading partial total.

## Time semantics

The emitted evidence keeps three different notions of time separate:

- `agent.run.duration_ms`: wall-clock duration of the whole task run;
- invocation durations: cumulative time measured for agent invocations;
- span durations: cumulative tool/CI/wait/other time.

Invocation and span durations can overlap and therefore must not be added to wall time. Stage and span-kind breakdowns are intended to answer where time was spent, not to manufacture a single additive elapsed-time total.

## Performance-evidence mapping

The generic document uses the `performance-evidence` `1.0.0` structure:

- `useful_work`: passing agent invocations;
- `induced_work`: invocation count, retries, token categories, invocation duration, span count, stage breakdowns, and span-kind durations;
- `outcomes`: wall duration, success indicator, non-passing invocation count, and time-to-green for successful runs;
- `extensions["coding-harness.agent"]`: complete repository provenance, ordered invocation/span details, and deterministic stage and provider/model totals.

The source revision and dirty-worktree flag are captured from the target repository when the evidence document is produced. The namespaced extension retains the complete repository inspection evidence used to establish that source identity. Collection fails closed when exact repository provenance cannot be established.

## CLI

```bash
coding-harness agent-evidence \
  --root ../target-repository \
  --input /path/to/agent-run.json
```

The default output is `.artifacts/coding-harness/agent-performance.json` under the target repository. `--report` overrides that path and `--json` emits compact stdout.

This command and the recorder are deliberately provider-neutral. Provider adapters should translate native usage data into this trace contract rather than teach the harness provider-specific response formats.
