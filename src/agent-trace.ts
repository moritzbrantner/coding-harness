import {
  parseAgentRunTrace,
  type AgentEnvironmentTrace,
  type AgentInvocationTrace,
  type AgentRunTrace,
  type AgentSpanKind,
  type AgentSpanTrace,
  type AgentTokenUsage,
} from "./agent-evidence.ts";
import type { ResultStatus } from "./model.ts";

export type AgentTraceRecorderOptions = {
  runId: string;
  taskHash: string;
  environment?: AgentEnvironmentTrace;
  now?: () => number;
};

export type AgentInvocationStart = {
  id: string;
  stage: string;
  provider: string;
  model: string;
  agent?: string;
  attempt?: number;
};

export type AgentInvocationFinish = {
  status: ResultStatus;
  tokens?: AgentTokenUsage;
};

export type AgentSpanStart = {
  id: string;
  invocationId?: string;
  stage?: string;
  kind: AgentSpanKind;
  name: string;
};

export type AgentInvocationHandle = {
  finish(result: AgentInvocationFinish): AgentInvocationTrace;
};

export type AgentSpanHandle = {
  finish(status: ResultStatus): AgentSpanTrace;
};

type OpenInvocation = {
  input: AgentInvocationStart;
  sequence: number;
  startedAt: number;
};

type OpenSpan = {
  input: AgentSpanStart;
  sequence: number;
  startedAt: number;
};

function assertClock(value: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`${context} clock value must be finite`);
  return value;
}

function elapsed(startedAt: number, finishedAt: number, context: string): number {
  const duration = finishedAt - startedAt;
  if (duration < 0) throw new Error(`${context} clock moved backwards`);
  return duration;
}

function bySequence<T extends { sequence: number; id: string }>(left: T, right: T): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

export class AgentTraceRecorder {
  private readonly now: () => number;
  private readonly runStartedAt: number;
  private readonly invocations: AgentInvocationTrace[] = [];
  private readonly spans: AgentSpanTrace[] = [];
  private readonly openInvocations = new Map<string, OpenInvocation>();
  private readonly openSpans = new Map<string, OpenSpan>();
  private readonly invocationIds = new Set<string>();
  private readonly spanIds = new Set<string>();
  private nextSequence = 1;
  private closed = false;

  public constructor(private readonly options: AgentTraceRecorderOptions) {
    this.now = options.now ?? performance.now.bind(performance);
    this.runStartedAt = this.readClock("run start");
  }

  public startInvocation(input: AgentInvocationStart): AgentInvocationHandle {
    this.assertOpen();
    if (this.invocationIds.has(input.id)) throw new Error(`duplicate invocation id ${input.id}`);

    const open: OpenInvocation = {
      input: { ...input },
      sequence: this.nextSequence++,
      startedAt: this.readClock(`invocation ${input.id} start`),
    };
    this.invocationIds.add(input.id);
    this.openInvocations.set(input.id, open);

    let finished = false;
    return {
      finish: (result) => {
        if (finished) throw new Error(`invocation ${input.id} is already finished`);
        const invocation = this.finishInvocation(input.id, result);
        finished = true;
        return invocation;
      },
    };
  }

  public startSpan(input: AgentSpanStart): AgentSpanHandle {
    this.assertOpen();
    if (this.spanIds.has(input.id)) throw new Error(`duplicate span id ${input.id}`);
    if (input.invocationId && !this.invocationIds.has(input.invocationId)) {
      throw new Error(`span ${input.id} references unknown invocation ${input.invocationId}`);
    }

    const open: OpenSpan = {
      input: { ...input },
      sequence: this.nextSequence++,
      startedAt: this.readClock(`span ${input.id} start`),
    };
    this.spanIds.add(input.id);
    this.openSpans.set(input.id, open);

    let finished = false;
    return {
      finish: (status) => {
        if (finished) throw new Error(`span ${input.id} is already finished`);
        const span = this.finishSpan(input.id, status);
        finished = true;
        return span;
      },
    };
  }

  public finish(status: ResultStatus): AgentRunTrace {
    this.assertOpen();
    if (this.openInvocations.size > 0) {
      throw new Error(
        `cannot finish run with open invocations: ${this.sortedIds(this.openInvocations)}`,
      );
    }
    if (this.openSpans.size > 0) {
      throw new Error(`cannot finish run with open spans: ${this.sortedIds(this.openSpans)}`);
    }

    const finishedAt = this.readClock("run finish");
    const trace = parseAgentRunTrace({
      schemaVersion: 1,
      runId: this.options.runId,
      taskHash: this.options.taskHash,
      status,
      durationMs: elapsed(this.runStartedAt, finishedAt, "run"),
      ...(this.options.environment ? { environment: this.options.environment } : {}),
      invocations: [...this.invocations].sort(bySequence),
      spans: [...this.spans].sort(bySequence),
    });
    this.closed = true;
    return trace;
  }

  private finishInvocation(id: string, result: AgentInvocationFinish): AgentInvocationTrace {
    this.assertOpen();
    const open = this.openInvocations.get(id);
    if (!open) throw new Error(`invocation ${id} is not open`);

    const finishedAt = this.readClock(`invocation ${id} finish`);
    const invocation: AgentInvocationTrace = {
      ...open.input,
      sequence: open.sequence,
      status: result.status,
      durationMs: elapsed(open.startedAt, finishedAt, `invocation ${id}`),
      ...(result.tokens ? { tokens: { ...result.tokens } } : {}),
    };
    this.invocations.push(invocation);
    this.openInvocations.delete(id);
    return invocation;
  }

  private finishSpan(id: string, status: ResultStatus): AgentSpanTrace {
    this.assertOpen();
    const open = this.openSpans.get(id);
    if (!open) throw new Error(`span ${id} is not open`);

    const finishedAt = this.readClock(`span ${id} finish`);
    const span: AgentSpanTrace = {
      ...open.input,
      sequence: open.sequence,
      status,
      durationMs: elapsed(open.startedAt, finishedAt, `span ${id}`),
    };
    this.spans.push(span);
    this.openSpans.delete(id);
    return span;
  }

  private readClock(context: string): number {
    return assertClock(this.now(), context);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("agent trace recorder is already finished");
  }

  private sortedIds(values: Map<string, unknown>): string {
    return [...values.keys()].sort().join(", ");
  }
}
