# Reporting acceptance ledger

This ledger records executed checks, not user acceptance. Overall release/freeze status remains **NO-GO**.

## Executed controls

| Requirement | Evidence | Result / boundary |
|---|---|---|
| Main-transcript text default | entry.ts extension command integration | Bare/message-only talk creates no picker, side session or server |
| Non-blocking publication | pi-lifecycle.mjs real tool + session manager | First message persisted; routine and duplicate create no entry; explicit repetition persists |
| Publication does not trigger model turn | delivery uses sendMessage triggerTurn:false; SDK loop tests | User-message injection is not used |
| Preview/failure baseline | entry.ts and real SDK preview-before-publish | Preview does not consume baseline; failed send retryable |
| Concurrent publication | entry.ts delivery queue | Identical concurrent operations serialized, failure does not poison queue |
| Cancellation | pi-lifecycle.mjs | Aborted publication rejected without transcript entry |
| Scope isolation | scopeVersion guard; SDK switch/fork/reload tests | Queued operation checks captured scope; real cross-scope queued race not separately exercised |
| Routine suppression default | SDK before-settled publication | User-started task is not explicit stage authorization |
| Completion evidence | entry.ts information matrix | Every registered requirement needs observed claim in acceptance set; inferred cannot cover requirement |
| Immutable requirements | entry.ts | Same task cannot silently shrink list |
| Failure resolution | entry.ts | Same tool/input later success requires explicit link; transport success is not general business verification |
| Critical truncation | entry.ts | Incidental truncation warning; truncated acceptance/goal or dropped failure blocks completion |
| Report patch governance | entry.ts real tool and resume tests | Target style governs audit/permit; cross-style rejected; surface identity persists |
| Live publication | live-stage-evaluation.mjs delivery mode | One controlled live case: exactly two risk entries including explicit repetition; routine/automatic repeat suppressed; no final exact-phrase repetition |

## Trigger lifecycle matrix

All SDK tests run against actual installed Pi in isolated HOME. Provider fixture tests are not live provider reliability tests.

| Scenario | Executed evidence | Status |
|---|---|---|
| Consecutive task loops | AgentSession.prompt twice | PASS with fixture |
| Queued continuation | session.followUp during message_end | PASS with fixture |
| Abort and subsequent recovery | Abort pending response stream, prompt again | PASS with fixture |
| Retry and settlement | One fixture 503, Pi retry scheduler, successful next stream | PASS; no real network failure |
| Reload | session.reload | PASS; evidence clears, tool registration unique |
| New session replacement | AgentSessionRuntime.newSession | PASS with synthetic file-backed history |
| Resume | AgentSessionRuntime.switchSession | PASS; transcript restored, evidence clears |
| Fork | AgentSessionRuntime.fork | PASS; new scope evidence empty |
| Report publication and deduplication | Real ExtensionRunner/tool definitions/session entries | PASS; TUI visual rendering not tested |
| Fresh process resume | New Node process opens synthetic persisted history | PASS; transcript restored, evidence clears |
| Crash during write | Not executed | OPEN; fresh-process resume is not crash-consistency proof |
| Manual compaction | Actual session.compact with fixture summary override | PASS; ephemeral goal/evidence unchanged, compaction entry persisted |
| Automatic compaction during queued task | Not executed | OPEN |
| Real provider retry/abort race | Not executed | OPEN |
| Task-boundary state extraction | createReportScope owns start/summary/settled/reset state | PASS; evidence collection and presentation adapters remain in talk.ts |
| Full trigger boundary/freeze review | Complete review not obtained | OPEN; do not freeze whole Trigger Engine |

## Quality and cost

- Twenty unique local-history structural replays: control invariants, not independent semantic A/B.
- Twenty-case qualitative review: single assistant, bounded sources, not independent scoring.
- Five user preference comparisons: B preferred 5/5, both variants assistant-authored.
- Live controlled continuation tests and one live delivery case passed; timing/token totals are current-policy measurements only.
- Naturalistic long-task quality, causal Token/latency improvement, authoritative full-source scoring and independent review remain OPEN.
- Publication is producer-invoked; no default background model calls or autonomous settled producer.

## Reproduction

Core + SDK + browser-required checks:

```sh
PI_CODING_AGENT_PACKAGE=/path/to/pi-coding-agent \
CHROME_PATH=/path/to/chrome-headless-shell TALK_REQUIRE_CHROME=1 \
node extension/lib/talk/tests/run-tests.mjs
```

Live/history evaluators are explicitly opt-in and are not run by normal regression. Dependency bundling still requires installed esbuild, parse5 and typebox. No portable CI claim is made.
