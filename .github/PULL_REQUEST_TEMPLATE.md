<!--
This template is the pull-request evidence template from docs/evaluation.md
section 13, plus a checklist mapped to the "Definition of done" in AGENTS.md.
Fill in every field with actual commands and results. Use N/A only with a
reason attached; never report an unrun gate as passing.
-->

## Evidence

```text
Issue:
Commit:
Commands run:
Automated suites and browser projects:
Fixture manifest version:
Eval JSON artifact links:
Before/after metric comparison:
Devices/OS/browser used:
Screenshots/traces:
Known limitations:
ADR updated (yes/no, link):
```

## Definition of done checklist

- [ ] All acceptance criteria and the user-visible checkpoint from the assigned
      issue are satisfied.
- [ ] The complete previously working slice still functions (nothing else
      regressed).
- [ ] Required automated and real-device evidence is recorded above, with
      commands, environment, and artifact links — not just "tests pass".
- [ ] No test/eval gate was silently weakened, skipped, or marked unsupported
      without an explicit reviewed ADR.
- [ ] Recovery, accessibility, security, privacy, and licensing implications
      were handled in proportion to the change.
- [ ] Documentation and ADRs match the implementation.
- [ ] This handoff names the commands run, their results, any unrun gates, and
      any known limitations.
