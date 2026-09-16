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

export type ProcessEvidence = CommandExecution & {
  command: string[];
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

export type WorktreePathEvidence = {
  status: string;
  path: string;
  previousPath?: string;
  contentIdentity: string | null;
};

export type RepositoryEvidence = {
  root: string;
  head: string | null;
  clean: boolean | null;
  statusPorcelain: string[];
  worktree: WorktreePathEvidence[];
  executions: ProcessEvidence[];
  error?: string;
};

export type RepositoryDelta = {
  headChanged: boolean | null;
  worktreeChanged: boolean | null;
  changedPaths: string[];
};

export type ToolingEvidence = {
  command: string;
  prefixArgs: string[];
};

export type ValidationReport = {
  schemaVersion: 1;
  operation: "validate";
  status: ResultStatus;
  repository: RepositoryEvidence;
  tooling: ToolingEvidence;
  layers: LayerEvidence[];
  stoppedAt: string | null;
};

export type ConvergenceReport = {
  schemaVersion: 1;
  operation: "converge";
  status: ResultStatus;
  repositoryBefore: RepositoryEvidence;
  repositoryAfter: RepositoryEvidence | null;
  repositoryDelta: RepositoryDelta | null;
  validationDelta: RepositoryDelta | null;
  tooling: ToolingEvidence;
  convergence: LayerEvidence | null;
  validation: ValidationReport | null;
  stoppedAt: string | null;
};

export type CommandRunner = (command: string, args: string[], cwd: string) => CommandExecution;
