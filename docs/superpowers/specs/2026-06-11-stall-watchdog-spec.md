# Spec: Stall watchdog for the agent loop (stuck-judge indeterminates)

**Linear:** PRI-2081
**Date:** 2026-06-11
**Status:** Implemented in the same PR (the watchdog is the gauntlet-side quick win; the rest of the ticket's scope is ownership-split below)

## Why

PRI-2081's audit found that roughly half of the non-rate-limit indeterminate
runs are a stuck Gauntlet-Agent ("Pattern 5"): the QA judge enters a
`read_screen` poll loop against a frozen surface and burns its entire
wall-clock budget producing no verdict. Worst observed: **6.2M tokens /
4430s for nothing** — full judge + subject spend, no signal.

Two prior layers were supposed to prevent this and demonstrably don't:

1. **Prompt steering.** The 2026-05-11 time-budget spec deliberately chose
   "stuckness is recognized by the model, not detector code." The TUI/Claude
   adapter prompt even has a hard rule: *"if `read_screen` returns the same
   content as the previous call, your next action MUST be a `bash` call that
   inspects the active session log."* Pattern 5 runs show the model ignoring
   that rule for dozens of consecutive turns.
2. **Reflection checkpoints** (PRI-1569) fire every N turns but trace
   *mutating* calls — a pure read-poll loop produces an empty trace and a
   reminder the model evidently shrugs off.

The budget deadline does eventually stop the run, but only after paying the
full budget for an `investigate`. The fix is mechanical enforcement —
detector code this time — with the existing prompt rule as its escalation
text.

## Detection

The agent loop fingerprints each turn after tool execution:

- The turn consists of **exactly one tool call**;
- the adapter classifies that tool as **non-mutating** (`isMutatingTool`
  false — `read_screen`, `read_output`, `screenshot`, `wake_on_idle_log`,
  ...);
- the call's `(name, JSON(arguments), result text)` is **byte-identical** to
  the previous turn's fingerprint.

Consecutive identical turns increment a stall counter; anything else (a
mutating call, a multi-call turn, different args, different result text)
resets it to zero.

Byte-identity is deliberately conservative: a screen with a clock, a
spinner, or a scrolling log produces different capture text and never trips
the watchdog. Only a *truly frozen* read loop counts. This also means the
watchdog cannot fire on a healthy-but-slow subject whose screen still
updates — the case the TUI prompt warns about (Claude Code's parent screen
freezing while its session log stays live) is exactly the case where the
model should be in `bash`, not `read_screen`.

`wake_on_idle_log` results that are byte-identical across consecutive
solo-call turns count too: waiting forever on logs that never change is the
same stall with a different tool name.

## Escalation

Two thresholds, both constants (no new CLI flags — tune by editing the
constant if field data demands it):

- **`STALL_WARNING_AFTER = 2` repeats** (third identical turn): inject a
  `<SYSTEM-REMINDER>` into the tool-result message restating the
  log-inspection rule mechanically: the surface is frozen, polling it again
  is a wasted turn, consult the authoritative record (session logs, files,
  command output) or report what you have. Logged as `agent_stall_warning`
  `{turn, tool, repeats}`.
- **`STALL_FORCED_REPORT_AFTER = 5` repeats** (sixth identical turn): stop
  offering adapter tools and demand a final `report_result` — the same
  grace-turn machinery the deadline path uses, with stall-specific reminder
  text. The run ends with the model's own best-effort verdict (usually
  `investigate` + a useful "stuck on X" summary) instead of burning the
  remaining budget. Logged as `agent_stall_forced_report`
  `{turn, tool, repeats}`.

A forced report still passes through the PRI-2140 validation path (re-ask
budget already spent or not, salvage as last resort), and the PRI-2160
criteria citations are accepted-if-valid but not re-asked, exactly like the
deadline grace turn.

### Why force a report instead of erroring

An early `investigate` with "I polled read_screen 6 times while the screen
stayed frozen; the session log showed no activity after <X>" is strictly
more useful than the same `investigate` 20 minutes and 6M tokens later —
and unlike an internal `errored` result, it keeps the model's account of
what it saw. The verdict quality is unchanged (these runs were never going
to pass); the cost is cut by an order of magnitude.

## Schema impact

None. Both new rows are generic `event` rows in `run.jsonl`; `result.json`
is unchanged. The forced-report grace turn reuses the existing
`deadline_reminder`-style machinery with its own event names.

## Out of scope for gauntlet (ownership split)

The other two PRI-2081 scope items live in the **consuming harness**
(superpowers-evals), not in this repo:

- **Empty-trace capture guard** — the zero-row tool-call capture
  (`stage="capture"` indeterminate) is the harness reading the *coding
  agent's* capture, a pipeline gauntlet is not part of. Recommendation for
  the harness: treat a zero-row capture as retryable (re-read after a
  delay; the file is written append-wise) and only mark indeterminate after
  N attempts, and distinguish "file missing" from "file empty" in the
  failure detail. Gauntlet's own evidence (run.jsonl) is written
  append-only synchronously and has not exhibited the empty-capture mode.
- **Token/economics symmetry across backends** (gemini/pi return None) —
  harness-side accounting of subject-agent backends. Gauntlet already emits
  its own per-call `usage.jsonl` sidecar (PRI-2125) for both providers it
  ships (Anthropic, OpenAI).

If a deeper change is wanted later (e.g. a per-tool `read_screen` budget,
or screen-similarity rather than byte-identity), it should start from the
field data the two new events will produce: how often the warning fires,
how often it self-corrects vs. escalates to a forced report.
