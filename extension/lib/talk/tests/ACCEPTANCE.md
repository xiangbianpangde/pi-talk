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
| Scope isolation | pi-lifecycle.mjs queuedStale test, introduced in f85bba1 | Actual ExtensionRunner: queue brief then concurrently emit session_before_switch; stale-scope rejection and no added transcript entry asserted. This is not an OS process-switch race. |
| Routine suppression default | SDK before-settled publication | User-started task is not explicit stage authorization |
| Completed outcome mislabeled routine | Unit regression + controlled live completion mode | Validated completed outcome publishes once; routine label cannot hide completion |
| Completion evidence | entry.ts information matrix + strict criterion tests | Every registered requirement needs an exact observed claim/evidence matching its criterion and acceptance set; inferred/unrelated evidence cannot cover requirement |
| Observation safety | Exact text support + operator/unit/uncertainty and JSON/locator redaction tests | Symbols, units, scope, uncertainty and serialized credentials fail closed |
| Delivery baseline | `recordBaseline` removed; `markDelivered` requires captured scope + sent receipt | Drafts never mutate baseline; captured scope + successful receipt required, including explicit override of a suppressed draft |
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
| Automatic compaction during queued task | Actual AgentSession threshold fixture + queued follow-up; full event trace assertions | PASS with synthetic usage: queued → threshold-start → threshold-end → stream-2; every marker must exist. No real provider compaction race. |
| Real provider retry/abort race | Not executed | OPEN |
| Task-boundary state extraction | createReportScope owns start/summary/settled/reset state | PASS; evidence collection and presentation adapters remain in talk.ts |
| Trigger scope hardening | Full-source review found stale-branch clear, mutable exposure, unbounded dedup and disposal-error gaps; fixes + regressions in 710741a/53fcc59 | PASS for reviewed local contracts; same-session delayed settlement still requires caller ordering |
| Summary after abort | scope state test, ebb33ac | Abort removes publishable opportunity but retains an internal summary anchor; bare summary preserves evidence |
| Report scope invalidation | Independent report version checked at queued tool boundary, ebb33ac | Summary starts invalidate queued briefs even when information evidence is preserved; concurrent summary race not separately tested |
| Full trigger boundary/freeze review | Complete system/caller review not obtained | OPEN; task-scope core is hardened, but do not freeze whole Trigger Engine |

## Side-channel review

Existing `/review` and `/codex-review` entrances were run read-only with the configured model. Broad review was blocked by truncated source, so it is not a freeze approval. Smaller commit reviews approved the queue and cancellation deltas with explicit surrounding-source limitations. Review of task-boundary extraction found a pending-summary regression: bare `/talk` followed by nonempty `/talk` before start could retain old evidence. The pending flag now accepts a boolean, nonempty requests clear it, and a targeted regression passes. Subsequent complete-source reviews of trigger.ts and talk.ts found branch/task mutation, unbounded history, inconsistent disposal, stale abort clearing another scope, aborted-summary evidence loss and missing report-version queue protection; local fixes and regressions are recorded above. The adapter currently passes sessionId as its stable scope identity (not tree-leaf identity); session_tree resets provide same-session navigation isolation. This naming limitation and caller event ordering remain part of the unfrozen adapter contract. This is same-model side-channel review, not independent human or different-model acceptance. Raw review output remains local.

### Complete-source observation/delivery review corrections

Complete-source review found that token equivalence erased signs/units/uncertainty and that unrelated evidence could satisfy a criterion. Observation and criterion support now require exact trimmed text; semantic paraphrases remain inferred and cannot prove acceptance. This does not establish that the producer's criteria fully cover the user goal. Redaction covers serialized credential keys, escaped quoted values, locator and goal text; it is still best-effort and is not a general secret detector.

Draft-time baseline mutation was removed from the public API. A baseline commit requires captured information scope and a sent receipt; the adapter also rechecks reporting scope after publication. This cannot retract already displayed output. Explicit override publication may commit its actual delivered content even if the original draft was suppressed. Goal truncation uses redacted length, preventing redaction expansion from silently dropping requirements.

### Test-review corrections

Side-channel review of the compaction test found that counting compactions and streams did not establish their ordering. The test now requires every trace marker to exist and asserts queueing precedes threshold compaction, which completes before the second provider invocation. An intermediate vacuous assertion was discarded rather than accepted as verification. The installed Pi emits `compaction_end` with `reason="threshold"`, not `auto_compaction_end`; the test follows the actual API.

Review also identified that the controlled completion probe could pass without the requested `routine` mode. It now inspects the actual publication tool arguments (`state=completed`, `publish=true`, `explicit=false`, `updatePurpose=routine`) and requires observed result claims, requirement registration and evidence mapping. A tightened live rerun passed. The single-commit reviewer initially lacked the earlier queued-scope test; the ledger now cites `f85bba1` and its precise ExtensionRunner boundary rather than claiming an OS process-switch race.

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
