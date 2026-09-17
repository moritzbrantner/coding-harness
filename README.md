# coding-harness

Personal orchestration for taking a repository from inspection to deterministic validation evidence without duplicating repository policy or analyzer logic.

`coding-harness` sits above `coding-tooling`. The harness decides **which layer runs next and what evidence must be retained**; `coding-tooling` remains authoritative for component discovery, capabilities, conformance, findings, and repository-owned validation commands.

## Validation

`validate` runs one fail-closed sequence against a target repository:

1. capture Git HEAD and worktree state;
2. `coding-tooling inspect --json`;
3. `coding-tooling conformance --json`;
4. strict `fast` validation (static checks, unit tests, and build capabilities declared by the repository);
5. strict `integration` validation;
6. strict `workflow` validation for multi-operation/business-workflow integration;
7. strict `e2e` validation;
8. deterministic new-findings inspection.

Each successful layer unlocks the next one. A failed, unavailable, malformed, or process-status-inconsistent result stops the run. Tiers with no applicable repository capability remain empty and pass according to `coding-tooling`; the harness does not invent substitute commands. The harness keeps `workflow` separate from both endpoint/component integration and browser/full-system E2E so its orchestration matches the authoritative `coding-tooling` convergence sequence.

The default report is written to `.artifacts/coding-harness/validation.json`. It records the repository HEAD, whether the worktree was clean, every invoked command, exit code, and parsed machine-readable output.

## Convergence

`converge` adds one explicit mutation step before the same validation ladder:

1. capture repository HEAD and worktree state;
2. run `coding-tooling converge --no-verify --json`;
3. stop immediately when deterministic convergence is blocked, unavailable, malformed, or process-status-inconsistent;
4. otherwise run the normal harness validation sequence against the resulting worktree;
5. re-observe repository state after validation and fail closed if validation itself changed Git-visible state;
6. write one report containing convergence evidence, validation evidence, repository state before and after, convergence deltas, and validation-mutation deltas.

The harness deliberately passes `--no-verify` to `coding-tooling converge`. `coding-tooling` remains authoritative for deterministic scaffolding, normalization, fixed-point/cycle detection, and semantic handoff generation, while the harness remains authoritative for validation-layer promotion. This avoids running the same verification twice.

A `partial` tooling convergence result is still a successful deterministic fixed point and is therefore followed by validation. A blocked or otherwise non-passing convergence result is not. The harness snapshots the repository both before and after validation instead of assuming repository-owned build or test commands are read-only. A changed HEAD or changed dirty-path status/content during validation invalidates the run. Dirty paths carry bounded content identities, so edits to files that were already dirty before convergence are still distinguished from unchanged pre-existing work without hashing the whole repository.

The default convergence report is written to `.artifacts/coding-harness/convergence.json`.

## Agent performance evidence

`agent-evidence` turns a provider-neutral coding-agent trace into the canonical `performance-evidence` `1.0.0` shape. It tracks token categories and time at run, invocation, stage, model, and tool/CI/wait-span level while preserving exact repository provenance.

`AgentTraceRecorder` is the recording foundation for real agent wrappers. It assigns sequence numbers when work starts and measures run, invocation, and span durations from one monotonic clock. Provider integrations only supply identity, outcome, and token categories actually reported by the provider; they do not calculate timing or construct trace JSON manually.

The trace contract accepts hashes and stable IDs rather than prompt or response bodies. Missing provider token categories remain unreported instead of being treated as zero, and wall-clock time is kept separate from cumulative invocation/span duration so overlapping work is not double-counted.

The default report is `.artifacts/coding-harness/agent-performance.json`. See `docs/agent-evidence.md` and `fixtures/agent-run.json` for the contract and an example.

## Usage

With `coding-tooling` installed on `PATH`:

```bash
coding-harness validate --root ../media-player
coding-harness converge --root ../media-player
coding-harness agent-evidence \
  --root ../media-player \
  --input /path/to/agent-run.json
```

Against a local `coding-tooling` checkout:

```bash
coding-harness converge \
  --root ../media-player \
  --tooling /absolute/path/to/coding-tooling/src/entry.ts
```

For compact stdout:

```bash
coding-harness converge --root ../media-player --json
```

`CODING_TOOLING_BIN` may be used instead of `--tooling` for an installed executable.

## Responsibility split

- `coding-agent-conventions`: durable code and engineering policy.
- `coding-tooling`: deterministic analysis, capabilities, conformance, normalization, and convergence mechanics.
- `coding-harness`: orchestration, layer sequencing, stop/escalation decisions, and evidence aggregation.
- `performance-evidence`: portable performance-evidence vocabulary, comparison, and downstream presentation.
- target repository: its actual test/build/runtime commands and local exceptions.

This boundary is deliberate: the harness should not become another analyzer, another repository-script registry, or a provider-specific telemetry parser.

## Next slices

The next useful agent-evidence slice is provider adapters that translate native coding-agent usage results into `AgentTraceRecorder` completion data. Environment bootstrap/verification, hosted/Pages acceptance, and fleet execution should continue reusing the same evidence contracts instead of adding parallel report formats.
