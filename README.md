# coding-harness

Personal orchestration for taking a repository from inspection to deterministic validation evidence without duplicating repository policy or analyzer logic.

`coding-harness` sits above `coding-tooling`. The harness decides **which layer runs next and what evidence must be retained**; `coding-tooling` remains authoritative for component discovery, capabilities, conformance, findings, and repository-owned validation commands.

## First vertical slice

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

## Usage

With `coding-tooling` installed on `PATH`:

```bash
coding-harness validate --root ../media-player
```

Against a local `coding-tooling` checkout:

```bash
coding-harness validate \
  --root ../media-player \
  --tooling /absolute/path/to/coding-tooling/src/entry.ts
```

For compact stdout:

```bash
coding-harness validate --root ../media-player --json
```

`CODING_TOOLING_BIN` may be used instead of `--tooling` for an installed executable.

## Responsibility split

- `coding-agent-conventions`: durable code and engineering policy.
- `coding-tooling`: deterministic analysis, capabilities, conformance, normalization, and convergence mechanics.
- `coding-harness`: orchestration, layer sequencing, stop/escalation decisions, and evidence aggregation.
- target repository: its actual test/build/runtime commands and local exceptions.

This boundary is deliberate: the harness should not become another analyzer or another repository-script registry.

## Next slices

The next useful slices are explicit convergence orchestration (delegating mutation to `coding-tooling converge` and then rerunning layered validation), environment bootstrap/verification, hosted/Pages acceptance, and finally fleet execution. Those should reuse this evidence contract instead of adding parallel report formats.
