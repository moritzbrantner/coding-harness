import { createHash } from "node:crypto";

import type { RepositoryEvidence, ResultStatus } from "./model.ts";

const identifierPattern = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;

export type AgentTokenUsage = {
  input?: number;
  cachedInput?: number;
  output?: number;
  reasoning?: number;
};

export type AgentInvocationTrace = {
  id: string;
  sequence: number;
  stage: string;
  provider: string;
  model: string;
  agent?: string;
  attempt?: number;
  status: ResultStatus;
  durationMs: number;
  tokens?: AgentTokenUsage;
};

export type AgentSpanKind = "tool" | "ci" | "wait" | "other";

export type AgentSpanTrace = {
  id: string;
  sequence: number;
  invocationId?: string;
  stage?: string;
  kind: AgentSpanKind;
  name: string;
  status: ResultStatus;
  durationMs: number;
};

export type AgentEnvironmentTrace = {
  fingerprint?: string;
  platform?: Record<string, string>;
  toolchain?: Record<string, string>;
};

export type AgentRunTrace = {
  schemaVersion: 1;
  runId: string;
  taskHash: string;
  status: ResultStatus;
  durationMs: number;
  environment?: AgentEnvironmentTrace;
  invocations: AgentInvocationTrace[];
  spans: AgentSpanTrace[];
};

export type PerformanceMeasurement = {
  name: string;
  value: number;
  unit: string;
  measurement_type: "counter" | "gauge" | "duration" | "size" | "rate" | "ratio";
  description?: string;
};

export type StageTotal = {
  stage: string;
  invocations: number;
  passed: number;
  failed: number;
  duration_ms: number;
  retry_invocations: number;
  span_duration_ms: number;
  span_duration_by_kind: Partial<Record<AgentSpanKind, number>>;
  tokens: {
    input?: number;
    cached_input?: number;
    output?: number;
    reasoning?: number;
  };
};

export type ModelTotal = {
  provider: string;
  model: string;
  invocations: number;
  passed: number;
  failed: number;
  duration_ms: number;
  retry_invocations: number;
  tokens: StageTotal["tokens"];
};

export type AgentPerformanceEvidence = {
  schema_version: "1.0.0";
  scenario: {
    id: "coding-agent/run";
    description: string;
    workload: {
      id: string;
      hash: string;
      parameters: {
        run_id_hash: string;
        invocation_count: number;
        span_count: number;
      };
    };
  };
  source: {
    revision: string;
    dirty: boolean;
  };
  environment: {
    fingerprint: string;
    platform?: Record<string, string>;
    toolchain?: Record<string, string>;
    collector: {
      name: "coding-harness";
      version: "0.1.0";
    };
  };
  measurements: {
    useful_work: PerformanceMeasurement[];
    induced_work: PerformanceMeasurement[];
    outcomes: PerformanceMeasurement[];
  };
  extensions: {
    "coding-harness.agent": {
      schema_version: 1;
      run_id: string;
      task_hash: string;
      status: ResultStatus;
      repository: RepositoryEvidence;
      invocations: Array<{
        id: string;
        sequence: number;
        stage: string;
        provider: string;
        model: string;
        agent?: string;
        attempt?: number;
        status: ResultStatus;
        duration_ms: number;
        tokens?: {
          input?: number;
          cached_input?: number;
          output?: number;
          reasoning?: number;
        };
      }>;
      spans: Array<{
        id: string;
        sequence: number;
        invocation_id?: string;
        stage?: string;
        kind: AgentSpanKind;
        name: string;
        status: ResultStatus;
        duration_ms: number;
      }>;
      stage_totals: StageTotal[];
      model_totals: ModelTotal[];
      privacy: {
        prompt_content: "not_collected";
        response_content: "not_collected";
      };
    };
  };
};

type TokenAccumulator = {
  input: number;
  inputReported: number;
  cachedInput: number;
  cachedInputReported: number;
  output: number;
  outputReported: number;
  reasoning: number;
  reasoningReported: number;
};

type InvocationAccumulator = TokenAccumulator & {
  invocations: number;
  passed: number;
  failed: number;
  durationMs: number;
  retries: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], context: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${context} contains unknown field ${key}`);
  }
}

function assertString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function assertIdentifier(value: unknown, context: string): string {
  const identifier = assertString(value, context);
  if (!identifierPattern.test(identifier))
    throw new Error(`${context} must be a stable identifier`);
  return identifier;
}

function assertSha256(value: unknown, context: string): string {
  const hash = assertString(value, context);
  if (!sha256Pattern.test(hash)) throw new Error(`${context} must be a sha256:<hex> hash`);
  return hash;
}

function assertNonNegativeNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${context} must be a finite non-negative number`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, context: string): number {
  const number = assertNonNegativeNumber(value, context);
  if (!Number.isInteger(number)) throw new Error(`${context} must be an integer`);
  return number;
}

function assertPositiveInteger(value: unknown, context: string): number {
  const number = assertNonNegativeInteger(value, context);
  if (number < 1) throw new Error(`${context} must be at least 1`);
  return number;
}

function assertStatus(value: unknown, context: string): ResultStatus {
  if (value !== "passed" && value !== "failed" && value !== "unavailable" && value !== "error") {
    throw new Error(`${context} has an unknown status`);
  }
  return value;
}

function parseStringMap(value: unknown, context: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  const parsed: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    parsed[key] = assertString(value[key], `${context}.${key}`);
  }
  return parsed;
}

function parseTokens(value: unknown, context: string): AgentTokenUsage | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  assertExactKeys(value, ["input", "cachedInput", "output", "reasoning"], context);
  const result: AgentTokenUsage = {};
  if (value.input !== undefined) {
    result.input = assertNonNegativeInteger(value.input, `${context}.input`);
  }
  if (value.cachedInput !== undefined) {
    result.cachedInput = assertNonNegativeInteger(value.cachedInput, `${context}.cachedInput`);
  }
  if (value.output !== undefined) {
    result.output = assertNonNegativeInteger(value.output, `${context}.output`);
  }
  if (value.reasoning !== undefined) {
    result.reasoning = assertNonNegativeInteger(value.reasoning, `${context}.reasoning`);
  }
  return result;
}

function parseInvocation(value: unknown, index: number): AgentInvocationTrace {
  const context = `invocations[${index}]`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  assertExactKeys(
    value,
    [
      "id",
      "sequence",
      "stage",
      "provider",
      "model",
      "agent",
      "attempt",
      "status",
      "durationMs",
      "tokens",
    ],
    context,
  );
  const parsed: AgentInvocationTrace = {
    id: assertIdentifier(value.id, `${context}.id`),
    sequence: assertNonNegativeInteger(value.sequence, `${context}.sequence`),
    stage: assertIdentifier(value.stage, `${context}.stage`),
    provider: assertString(value.provider, `${context}.provider`),
    model: assertString(value.model, `${context}.model`),
    status: assertStatus(value.status, `${context}.status`),
    durationMs: assertNonNegativeNumber(value.durationMs, `${context}.durationMs`),
  };
  if (value.agent !== undefined) parsed.agent = assertString(value.agent, `${context}.agent`);
  if (value.attempt !== undefined) {
    parsed.attempt = assertPositiveInteger(value.attempt, `${context}.attempt`);
  }
  const tokens = parseTokens(value.tokens, `${context}.tokens`);
  if (tokens) parsed.tokens = tokens;
  return parsed;
}

function parseSpan(value: unknown, index: number): AgentSpanTrace {
  const context = `spans[${index}]`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  assertExactKeys(
    value,
    ["id", "sequence", "invocationId", "stage", "kind", "name", "status", "durationMs"],
    context,
  );
  const kind = value.kind;
  if (kind !== "tool" && kind !== "ci" && kind !== "wait" && kind !== "other") {
    throw new Error(`${context}.kind has an unknown span kind`);
  }
  const parsed: AgentSpanTrace = {
    id: assertIdentifier(value.id, `${context}.id`),
    sequence: assertNonNegativeInteger(value.sequence, `${context}.sequence`),
    kind,
    name: assertIdentifier(value.name, `${context}.name`),
    status: assertStatus(value.status, `${context}.status`),
    durationMs: assertNonNegativeNumber(value.durationMs, `${context}.durationMs`),
  };
  if (value.invocationId !== undefined) {
    parsed.invocationId = assertIdentifier(value.invocationId, `${context}.invocationId`);
  }
  if (value.stage !== undefined) parsed.stage = assertIdentifier(value.stage, `${context}.stage`);
  return parsed;
}

function parseEnvironment(value: unknown): AgentEnvironmentTrace | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("environment must be an object");
  assertExactKeys(value, ["fingerprint", "platform", "toolchain"], "environment");
  const environment: AgentEnvironmentTrace = {};
  if (value.fingerprint !== undefined) {
    environment.fingerprint = assertSha256(value.fingerprint, "environment.fingerprint");
  }
  const platform = parseStringMap(value.platform, "environment.platform");
  if (platform) environment.platform = platform;
  const toolchain = parseStringMap(value.toolchain, "environment.toolchain");
  if (toolchain) environment.toolchain = toolchain;
  return environment;
}

export function parseAgentRunTrace(value: unknown): AgentRunTrace {
  if (!isRecord(value)) throw new Error("agent run trace must be an object");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "runId",
      "taskHash",
      "status",
      "durationMs",
      "environment",
      "invocations",
      "spans",
    ],
    "agent run trace",
  );
  if (value.schemaVersion !== 1) throw new Error("agent run trace schemaVersion must be 1");
  if (!Array.isArray(value.invocations)) {
    throw new Error("agent run trace invocations must be an array");
  }
  if (!Array.isArray(value.spans)) throw new Error("agent run trace spans must be an array");

  const trace: AgentRunTrace = {
    schemaVersion: 1,
    runId: assertString(value.runId, "agent run trace runId"),
    taskHash: assertSha256(value.taskHash, "agent run trace taskHash"),
    status: assertStatus(value.status, "agent run trace status"),
    durationMs: assertNonNegativeNumber(value.durationMs, "agent run trace durationMs"),
    invocations: value.invocations.map(parseInvocation),
    spans: value.spans.map(parseSpan),
  };
  const environment = parseEnvironment(value.environment);
  if (environment) trace.environment = environment;

  const invocationById = new Map<string, AgentInvocationTrace>();
  for (const invocation of trace.invocations) {
    if (invocationById.has(invocation.id))
      throw new Error(`duplicate invocation id ${invocation.id}`);
    invocationById.set(invocation.id, invocation);
  }
  const spanIds = new Set<string>();
  for (const span of trace.spans) {
    if (spanIds.has(span.id)) throw new Error(`duplicate span id ${span.id}`);
    spanIds.add(span.id);
    if (!span.invocationId) continue;
    const invocation = invocationById.get(span.invocationId);
    if (!invocation)
      throw new Error(`span ${span.id} references unknown invocation ${span.invocationId}`);
    if (span.stage && span.stage !== invocation.stage) {
      throw new Error(`span ${span.id} stage disagrees with invocation ${span.invocationId}`);
    }
  }
  return trace;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key]);
  return result;
}

function hashValue(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function emptyAccumulator(): InvocationAccumulator {
  return {
    invocations: 0,
    passed: 0,
    failed: 0,
    durationMs: 0,
    retries: 0,
    input: 0,
    inputReported: 0,
    cachedInput: 0,
    cachedInputReported: 0,
    output: 0,
    outputReported: 0,
    reasoning: 0,
    reasoningReported: 0,
  };
}

function accumulateTokens(target: TokenAccumulator, tokens: AgentTokenUsage | undefined): void {
  if (!tokens) return;
  if (tokens.input !== undefined) {
    target.input += tokens.input;
    target.inputReported += 1;
  }
  if (tokens.cachedInput !== undefined) {
    target.cachedInput += tokens.cachedInput;
    target.cachedInputReported += 1;
  }
  if (tokens.output !== undefined) {
    target.output += tokens.output;
    target.outputReported += 1;
  }
  if (tokens.reasoning !== undefined) {
    target.reasoning += tokens.reasoning;
    target.reasoningReported += 1;
  }
}

function accumulateInvocation(
  target: InvocationAccumulator,
  invocation: AgentInvocationTrace,
): void {
  target.invocations += 1;
  if (invocation.status === "passed") target.passed += 1;
  else target.failed += 1;
  target.durationMs += invocation.durationMs;
  if ((invocation.attempt ?? 1) > 1) target.retries += 1;
  accumulateTokens(target, invocation.tokens);
}

function tokenObject(source: InvocationAccumulator): StageTotal["tokens"] {
  const tokens: StageTotal["tokens"] = {};
  if (source.invocations > 0 && source.inputReported === source.invocations) tokens.input = source.input;
  if (source.invocations > 0 && source.cachedInputReported === source.invocations)
    tokens.cached_input = source.cachedInput;
  if (source.invocations > 0 && source.outputReported === source.invocations)
    tokens.output = source.output;
  if (source.invocations > 0 && source.reasoningReported === source.invocations)
    tokens.reasoning = source.reasoning;
  return tokens;
}

function invocationTotalsByStage(
  invocations: AgentInvocationTrace[],
): Map<string, InvocationAccumulator> {
  const totals = new Map<string, InvocationAccumulator>();
  for (const invocation of invocations) {
    const total = totals.get(invocation.stage) ?? emptyAccumulator();
    accumulateInvocation(total, invocation);
    totals.set(invocation.stage, total);
  }
  return totals;
}

function spanStage(
  span: AgentSpanTrace,
  invocationById: Map<string, AgentInvocationTrace>,
): string | undefined {
  return (
    span.stage ?? (span.invocationId ? invocationById.get(span.invocationId)?.stage : undefined)
  );
}

function stageTotals(invocations: AgentInvocationTrace[], spans: AgentSpanTrace[]): StageTotal[] {
  const invocationById = new Map(invocations.map((invocation) => [invocation.id, invocation]));
  const totals = invocationTotalsByStage(invocations);
  const spanTotals = new Map<
    string,
    { duration: number; byKind: Partial<Record<AgentSpanKind, number>> }
  >();
  for (const span of spans) {
    const stage = spanStage(span, invocationById);
    if (!stage) continue;
    const current = spanTotals.get(stage) ?? { duration: 0, byKind: {} };
    current.duration += span.durationMs;
    current.byKind[span.kind] = (current.byKind[span.kind] ?? 0) + span.durationMs;
    spanTotals.set(stage, current);
  }
  const stages = new Set([...totals.keys(), ...spanTotals.keys()]);
  return [...stages].sort().map((stage) => {
    const total = totals.get(stage) ?? emptyAccumulator();
    const span = spanTotals.get(stage) ?? { duration: 0, byKind: {} };
    return {
      stage,
      invocations: total.invocations,
      passed: total.passed,
      failed: total.failed,
      duration_ms: total.durationMs,
      retry_invocations: total.retries,
      span_duration_ms: span.duration,
      span_duration_by_kind: span.byKind,
      tokens: tokenObject(total),
    };
  });
}

function modelTotals(invocations: AgentInvocationTrace[]): ModelTotal[] {
  const totals = new Map<
    string,
    { provider: string; model: string; total: InvocationAccumulator }
  >();
  for (const invocation of invocations) {
    const key = JSON.stringify([invocation.provider, invocation.model]);
    const current = totals.get(key) ?? {
      provider: invocation.provider,
      model: invocation.model,
      total: emptyAccumulator(),
    };
    accumulateInvocation(current.total, invocation);
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((left, right) => {
      if (left.provider === right.provider) return left.model.localeCompare(right.model);
      return left.provider.localeCompare(right.provider);
    })
    .map(({ provider, model, total }) => ({
      provider,
      model,
      invocations: total.invocations,
      passed: total.passed,
      failed: total.failed,
      duration_ms: total.durationMs,
      retry_invocations: total.retries,
      tokens: tokenObject(total),
    }));
}

function counter(name: string, value: number, unit = "count"): PerformanceMeasurement {
  return { name, value, unit, measurement_type: "counter" };
}

function duration(name: string, value: number): PerformanceMeasurement {
  return { name, value, unit: "ms", measurement_type: "duration" };
}

function gauge(name: string, value: number, unit = "count"): PerformanceMeasurement {
  return { name, value, unit, measurement_type: "gauge" };
}

function tokenMeasurements(prefix: string, total: InvocationAccumulator): PerformanceMeasurement[] {
  const measurements: PerformanceMeasurement[] = [];
  if (total.invocations > 0 && total.inputReported === total.invocations) {
    measurements.push(counter(`${prefix}.input_tokens`, total.input, "token"));
  }
  if (total.invocations > 0 && total.cachedInputReported === total.invocations) {
    measurements.push(counter(`${prefix}.cached_input_tokens`, total.cachedInput, "token"));
  }
  if (total.invocations > 0 && total.outputReported === total.invocations) {
    measurements.push(counter(`${prefix}.output_tokens`, total.output, "token"));
  }
  if (total.invocations > 0 && total.reasoningReported === total.invocations) {
    measurements.push(counter(`${prefix}.reasoning_tokens`, total.reasoning, "token"));
  }
  return measurements;
}

function environmentFor(trace: AgentRunTrace): AgentPerformanceEvidence["environment"] {
  const platform = trace.environment?.platform ?? {
    os: process.platform,
    arch: process.arch,
  };
  const bunVersion = (process.versions as Record<string, string | undefined>).bun;
  const toolchain = trace.environment?.toolchain ?? {
    node: process.versions.node,
    ...(bunVersion ? { bun: bunVersion } : {}),
  };
  const fingerprint = trace.environment?.fingerprint ?? hashValue({ platform, toolchain });
  return {
    fingerprint,
    platform,
    toolchain,
    collector: { name: "coding-harness", version: "0.1.0" },
  };
}

export function buildAgentPerformanceEvidence(
  trace: AgentRunTrace,
  repository: RepositoryEvidence,
): AgentPerformanceEvidence {
  if (repository.error) throw new Error(`repository evidence unavailable: ${repository.error}`);
  if (!repository.head) throw new Error("repository evidence did not contain an exact HEAD");
  if (repository.clean === null) {
    throw new Error("repository evidence did not determine worktree cleanliness");
  }

  const invocations = [...trace.invocations].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
  const spans = [...trace.spans].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
  const overall = emptyAccumulator();
  for (const invocation of invocations) accumulateInvocation(overall, invocation);
  const stages = stageTotals(invocations, spans);
  const models = modelTotals(invocations);

  const spanDurationByKind = new Map<AgentSpanKind, number>();
  for (const span of spans) {
    spanDurationByKind.set(span.kind, (spanDurationByKind.get(span.kind) ?? 0) + span.durationMs);
  }

  const usefulWork = [counter("agent.invocations.passed", overall.passed)];
  const inducedWork: PerformanceMeasurement[] = [
    counter("agent.invocations.total", overall.invocations),
    counter("agent.invocations.retry", overall.retries),
    duration("agent.invocations.duration_ms", overall.durationMs),
    counter("agent.spans.total", spans.length),
    ...tokenMeasurements("agent", overall),
  ];

  const invocationStageTotals = invocationTotalsByStage(invocations);
  for (const stage of stages) {
    const total = invocationStageTotals.get(stage.stage) ?? emptyAccumulator();
    inducedWork.push(
      counter(`agent.stage.${stage.stage}.invocations`, stage.invocations),
      duration(`agent.stage.${stage.stage}.duration_ms`, stage.duration_ms),
      duration(`agent.stage.${stage.stage}.span_duration_ms`, stage.span_duration_ms),
      ...tokenMeasurements(`agent.stage.${stage.stage}`, total),
    );
    for (const kind of ["tool", "ci", "wait", "other"] as const) {
      const value = stage.span_duration_by_kind[kind];
      if (value !== undefined) {
        inducedWork.push(duration(`agent.stage.${stage.stage}.span.${kind}.duration_ms`, value));
      }
    }
  }
  for (const kind of ["tool", "ci", "wait", "other"] as const) {
    const value = spanDurationByKind.get(kind);
    if (value !== undefined) inducedWork.push(duration(`agent.span.${kind}.duration_ms`, value));
  }

  const outcomes: PerformanceMeasurement[] = [
    duration("agent.run.duration_ms", trace.durationMs),
    gauge("agent.run.succeeded", trace.status === "passed" ? 1 : 0),
    counter("agent.invocations.non_passing", overall.failed),
  ];
  if (trace.status === "passed") {
    outcomes.push(duration("agent.run.time_to_green_ms", trace.durationMs));
  }

  const runIdHash = hashValue(trace.runId);
  return {
    schema_version: "1.0.0",
    scenario: {
      id: "coding-agent/run",
      description: "Coding-agent execution cost and timing evidence collected by coding-harness.",
      workload: {
        id: `coding-agent/${runIdHash.slice("sha256:".length, "sha256:".length + 16)}`,
        hash: trace.taskHash,
        parameters: {
          run_id_hash: runIdHash,
          invocation_count: invocations.length,
          span_count: spans.length,
        },
      },
    },
    source: {
      revision: repository.head,
      dirty: !repository.clean,
    },
    environment: environmentFor(trace),
    measurements: {
      useful_work: usefulWork,
      induced_work: inducedWork,
      outcomes,
    },
    extensions: {
      "coding-harness.agent": {
        schema_version: 1,
        run_id: trace.runId,
        task_hash: trace.taskHash,
        status: trace.status,
        repository,
        invocations: invocations.map((invocation) => ({
          id: invocation.id,
          sequence: invocation.sequence,
          stage: invocation.stage,
          provider: invocation.provider,
          model: invocation.model,
          ...(invocation.agent ? { agent: invocation.agent } : {}),
          ...(invocation.attempt ? { attempt: invocation.attempt } : {}),
          status: invocation.status,
          duration_ms: invocation.durationMs,
          ...(invocation.tokens
            ? {
                tokens: {
                  ...(invocation.tokens.input !== undefined
                    ? { input: invocation.tokens.input }
                    : {}),
                  ...(invocation.tokens.cachedInput !== undefined
                    ? { cached_input: invocation.tokens.cachedInput }
                    : {}),
                  ...(invocation.tokens.output !== undefined
                    ? { output: invocation.tokens.output }
                    : {}),
                  ...(invocation.tokens.reasoning !== undefined
                    ? { reasoning: invocation.tokens.reasoning }
                    : {}),
                },
              }
            : {}),
        })),
        spans: spans.map((span) => ({
          id: span.id,
          sequence: span.sequence,
          ...(span.invocationId ? { invocation_id: span.invocationId } : {}),
          ...(span.stage ? { stage: span.stage } : {}),
          kind: span.kind,
          name: span.name,
          status: span.status,
          duration_ms: span.durationMs,
        })),
        stage_totals: stages,
        model_totals: models,
        privacy: {
          prompt_content: "not_collected",
          response_content: "not_collected",
        },
      },
    },
  };
}
