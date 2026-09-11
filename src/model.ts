export type ResultStatus = "passed" | "failed" | "unavailable" | "error";

export type ToolEnvelope = {
  schemaVersion?: unknown;
  operation?: unknown;
  status?: unknown;
  data?: unknown;
  diagnostics?: unknown;
  [key: string]: unknown;
};

export type CommandExecution = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type LayerEvidence = {
  id: string;
  command: string[];
  exitCode: number | null;
  status: ResultStatus;
  output?: ToolEnvelope;
  stderr?: string;
  error?: string;
};

export type RepositoryEvidence = {
  root: string;
  head: string | null;
  clean: boolean | null;
  statusPorcelain: string[];
  error?: string;
};

export type ValidationReport = {
  schemaVersion: 1;
  operation: "validate";
  status: ResultStatus;
  repository: RepositoryEvidence;
  tooling: {
    command: string;
    prefixArgs: string[];
  };
  layers: LayerEvidence[];
  stoppedAt: string | null;
};

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => CommandExecution;
