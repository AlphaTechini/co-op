# docs

Project documents. The root [README](../README.md) is the entry point; these hold the detail behind it.

| File | Purpose |
|---|---|
| [PRD.md](PRD.md) | Product requirements: problem, mechanism, scope, capability checks, deadline |
| [SPEC.md](SPEC.md) | Interface spec: contract methods and views, JSON shapes, server API, events |
| [CLAIMS.md](CLAIMS.md) | Every factual claim in the README with its code location and its proof (test, evidence file, or "pending testnet run") |
| [HACKATHON.md](HACKATHON.md) | Snapshot of the hackathon rules taken 2026-10-29; re-read the live page before submitting |

## Decisions and tradeoffs

- **Claims are mapped to proof.** [CLAIMS.md](CLAIMS.md) exists so a reviewer can check any README statement without trusting it; the cost is keeping its line references current when code moves.
- **Where the implementation differs from the PRD, the README says so** (for example the group calculation, PRD section 6.4).
- To find interface names and JSON shapes visit [SPEC.md](SPEC.md).
