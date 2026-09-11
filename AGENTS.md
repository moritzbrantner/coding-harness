# Repository agent guidance

`coding-harness` is the orchestration layer for personal repository work. Keep it thin.

## Boundaries

- Delegate repository discovery, conformance, deterministic findings, validation capabilities, and deterministic remediation to `coding-tooling`.
- Do not copy analyzer rules, convention text, or repository-specific test commands into the harness.
- Keep validation read-only. Mutation belongs behind explicit convergence or bootstrap operations.
- Fail closed when a required layer fails, is unavailable, returns malformed evidence, or disagrees with its process exit code.

## Evidence

- Record the target repository root, exact Git HEAD, worktree cleanliness, invoked command, exit code, and machine-readable tool output.
- Preserve layer order in reports. Do not silently retry or skip a failed required layer.
- A dirty worktree may be validated, but its report must not imply that the result describes a clean exact-head checkout.

## Development

- Keep the runtime dependency-free where practical.
- Use Bun 1.4.0 for repository tests.
- Add focused tests for orchestration behavior before extending the execution graph.
