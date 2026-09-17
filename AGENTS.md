# Repository agent guidance

`coding-harness` is the orchestration layer for personal repository work. Keep it thin.

## Boundaries

- Delegate repository discovery, conformance, deterministic findings, validation capabilities, and deterministic remediation to `coding-tooling`.
- Delegate the portable performance vocabulary, comparison model, and downstream presentation contract to `performance-evidence`.
- Keep coding-agent telemetry provider-neutral inside the harness. Provider adapters may translate native responses, but provider-specific response shapes must not become the core evidence model.
- Do not copy analyzer rules, convention text, or repository-specific test commands into the harness.
- Keep validation read-only. Mutation belongs behind explicit convergence or bootstrap operations.
- Fail closed when a required layer fails, is unavailable, returns malformed evidence, or disagrees with its process exit code.

## Evidence

- Record the target repository root, exact Git HEAD, worktree cleanliness, invoked command, exit code, and machine-readable tool output.
- Preserve layer order in reports. Do not silently retry or skip a failed required layer.
- A dirty worktree may be validated, but its report must not imply that the result describes a clean exact-head checkout.
- For coding-agent evidence, preserve provider/model, stage, attempt, status, provider-reported token categories, wall duration, invocation duration, and tool/CI/wait spans when available.
- Treat missing token categories as unreported, not zero.
- Keep wall-clock duration separate from cumulative invocation/span duration because spans may overlap.
- Do not collect prompt or response bodies in performance evidence. Use stable IDs and hashes unless a separate explicit transcript artifact is introduced.

## Development

- Keep the runtime dependency-free where practical.
- Use Bun 1.4.0 for repository tests.
- Add focused tests for orchestration behavior before extending the execution graph.
