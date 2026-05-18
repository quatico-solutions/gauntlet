# Gauntlet test audit — 2026-05-18

Author: Susan@280d483a · scope: wide-and-shallow assessment of `test/`
LOC surveyed: ~20.1k TypeScript across 129 test files
Test:source LOC ratio: 1.46 (~14k src)
Method: direct reads of dirtree + three parallel sub-agent sweeps
(Echo — duplication; Cassian — value/gaps; Inspector — categories/speed/infra).

## Erratum (added 2026-05-18 after independent verification)

Subsequent verification by Hadley@7383aafc (test-cleanup plan author) and Garibaldi
(plan reviewer) found **three factual errors** in this audit. The sub-Bobs that
surfaced these claims (Echo and Cassian) were wrong; I synthesized their output
without spot-checking and they slipped through. The corrections, in priority order:

1. **The CLI-adapter test pair does NOT use incompatible APIs.** Both
   `test/adapters/cli-adapter.test.ts` and `test/adapters/cli/adapter.test.ts`
   call `executeTool()`. They cover complementary angles (integration vs.
   API-contract) but the framing "unfinished migration" is wrong. The pair is
   still worth investigating — they share scope — but it's a *boundary
   question*, not a *migration cleanup*.
2. **`test/helpers/pick-free-port.test.ts` is NOT mock-and-mirror.** It calls
   the real `pickFreePort`, which itself uses `net.createServer().listen(0)`
   for genuine OS port acquisition. The real gap is narrower: the test
   doesn't verify the *returned* port is independently re-bindable. A useful
   tightening, not a "rewrite the test from scratch" claim.
3. **`test/cli/stream/wrap.test.ts:36` tautology — there is no
   `formatWidthPercent` function.** Cassian hallucinated it. The 6 tests in
   that file are meaningful assertions on `softWrap` / `truncateArgs`. There
   is nothing to delete here.

The "Top concerns" and "Candidate actions table" below still reflect the
pre-correction framing — read them through the lens of these errata. The
revised PRI-1630 plan at `docs/superpowers/plans/2026-05-18-test-cleanup-plan.md`
is the post-correction view; trust it over this document where they conflict.

The lesson for me (Susan): three sub-Bobs reported in parallel, I synthesized
without spot-checking source for each claim. `feedback_inferences_are_not_facts.md`
applies — when I built this audit on sub-agent reports, I treated their reports
as facts rather than as inferences requiring verification.

## TL;DR

The suite is **healthy**. No `mock.module()` calls (and so no process-global mock pollution — a known Bun footgun captured in `feedback_bun_mock_module_pollution.md`), no `it.only` / `describe.only` / `.skip` landmines, fixtures are non-stale, gating is opt-in via env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and tool availability (`tmuxAvailable`, `hasNano`) — both legitimate. A snapshot test exists at `test/agent/__snapshots__/prompt-baseline.txt` and it's the *good* kind — a drift detector for the system prompt, not regenerated mindlessly.

The mess is concentrated in **four places**:

1. **One genuinely duplicated test pair** (`test/adapters/cli-adapter.test.ts` + `test/adapters/cli/adapter.test.ts`) that signals an unfinished CLIAdapter API migration — they use incompatible call patterns.
2. **One mock-and-mirror test** (`test/helpers/pick-free-port.test.ts`) that mocks every dependency and proves nothing real about a mission-critical function.
3. **Genuine coverage gaps** in `streaming/`, `runtime/`, and a handful of error-path branches in well-covered modules.
4. **Boilerplate that's been copy-pasted ≥3 times** — `makeConfig()` lives in 4 test files, Hono+route setup in 9 test files. `test/helpers/` exists but is underused.

Plus a sprinkle of small-but-deletable items: 5 specific tests that are tautologies or trivial-getter checks, an `api/` test ratio of 4.21x (likely some over-specified edge-case sprawl), and `test/e2e/` is misnamed (tests are import-and-multi-turn integration, not black-box).

None of this is urgent. **All of it compounds quietly** as the test suite grows.

---

## Map at a glance

| Tier | Files | LOC | What's there |
|------|-------|-----|--------------|
| Unit (no I/O, no spawn, no net) | 9 | ~220 | `cards/`, `format/`, `util/`, `streaming/`, `helpers/` |
| Integration (FS, processes, in-process servers) | 101 | ~16,500 | `agent/`, `api/`, `adapters/`, `cli/`, `context/`, `evidence/`, `revival/`, `runs/` |
| "e2e" (multi-turn agent loop, in-process) | 12 | ~1,200 | `e2e/`, `examples/` |
| Snapshot data | 2 | 12 KB | `agent/__snapshots__/` |

Largest individual files: `adapters/web/adapter.test.ts` (1275 LOC, matches src), `agent/agent.test.ts` (796 LOC), `evidence/logger.test.ts` (510 LOC).

Gating in use:
- `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` — opt-in for Anthropic live calls
- `describe.skipIf(!process.env.OPENAI_API_KEY)` — opt-in for OpenAI live calls
- `describe.skipIf(!tmuxAvailable)` — only runs where `tmux` is installed
- `describe.skipIf(!hasTmux || !hasNano)` — TUI tests requiring real `nano`

These are legitimate per `feedback_no_default_gated_safety_tests.md` (the rule there is "no env-gate without concrete cost" — live API calls are paid; missing binaries are real). Nothing else is gated.

---

## Top concerns (ranked by leverage × ease)

### 1. CLI-adapter duplication signals an unfinished API migration

Two test files target the same source class:

- `test/adapters/cli-adapter.test.ts` (146 LOC) — uses `executeTool()`, `readOutput()`, real `EvidenceLogger`. Tests shell lifecycle, process reaping, interactive I/O, event flow.
- `test/adapters/cli/adapter.test.ts` (171 LOC) — uses `type()`, `readOutput()`, mock logger. Tests tool definitions, context/credential flags, viewport.

These are **complementary** angles (integration vs. API contract), but they use **incompatible** APIs (`executeTool` vs `type`, different constructor shapes). That's the real signal — the source class `CLIAdapter` is mid-migration and the two test files captured two different snapshots of its surface.

**Recommendation:** investigate whether `CLIAdapter` actually supports both `executeTool()` and `type()` paths today. If yes (intentional), document why. If no (one is dead), delete the dead-path tests. The wrong move is to assume both are fine — the inconsistency is a coupling-debt smell.

**Effort:** S (an afternoon of reading both files and reconciling). **Risk:** L (test-only changes).

### 2. `test/helpers/pick-free-port.test.ts` is mock-and-mirror

The picker function in `src/util/pick-free-port.ts` (26 LOC) is supposed to return a port that isn't currently in use. The test mocks "a list of in-use ports," calls the picker, and asserts the returned number isn't in the mocked list.

**It never actually binds to the port to verify it's free.** A regression where the picker returns a port the OS already has bound would pass this test and fail in production.

**Recommendation:** rewrite the test to use the real picker, attempt to bind a server socket to the returned port, assert the bind succeeds. This is one of the rare cases where a real network operation is the *right* thing in a test.

**Effort:** XS (replace 20 lines). **Risk:** L. **Value:** real — this is a mission-critical helper (every test that spins up a server uses it).

### 3. `makeConfig()` is copy-pasted across four files

```ts
// Appears in: test/api/fanout.test.ts, test/cli/run.test.ts,
//             test/cli/batch.test.ts, test/cli/run-one.test.ts
function makeConfig(projectRoot: string): AppConfig {
  return {
    projectRoot, port: 4400, defaultChrome: { host: "127.0.0.1", port: 9222 },
    defaultBudgetMs: 300000,
    models: { agent: "claude-sonnet-4-6", fanout: undefined },
    // ...
  };
}
```

Four near-identical copies, each lagging behind `AppConfig`'s actual shape — as `AppConfig` has grown (recent `credentialResolver`, `wsOriginAllowlist`, etc.), each copy was patched independently or, worse, left stale.

**Recommendation:** extract to `test/helpers/make-config.ts`. Same shape, single import. When `AppConfig` grows, one place to update.

**Effort:** S. **Risk:** L. **Bonus:** Phase 2 of the cleanup sweep (PRI-1628) collapses `EffectiveRunConfig` + `RunCoreConfig` into `ResolvedRunConfig` — these `makeConfig` helpers will need updates anyway. Bundle the extraction with that.

### 4. Hono + route setup repeated 9 times in `test/api/`

```ts
const app = new Hono();
app.route("/api/config", configRoutes(config));
const res = await app.request("/api/config");
const body = await res.json();
```

Same boilerplate in `test/api/caps.test.ts`, `config.test.ts`, `config-effective.test.ts`, and others. The pattern wants to be:

```ts
const { request, body } = await mountRouteAndGet(configRoutes(config), "/api/config");
```

**Recommendation:** `test/helpers/api-test-app.ts` with a small factory. Mounts routes, makes the request, parses JSON, returns both response and body.

**Effort:** S. **Risk:** L.

### 5. Real coverage gaps in `streaming/`, `runtime/`, and error branches

Cassian's gap list, deduped and ranked:

- **`src/streaming/screencast.ts`** (121 LOC) — only the constructor is tested (in `test/streaming/screencast.test.ts:14-17`, which is itself a smoke test). `start()`, `stop()`, frame-save logic, and the `onFrame` callback are untested. This is hot-path code for every web run.
- **`src/runtime/process-tree.ts`** — happy path only. Malformed `ps` output, empty process list, missing parent PIDs — none exercised.
- **`src/runtime/serve.ts` request error handling** — server bring-up and shutdown are well tested; per-request error branches (malformed JSON, oversized payloads, mid-flight closed connections) aren't.
- **`src/cli/stream/pretty.ts`** (409 LOC) — three fixture-based happy paths; no mid-render error paths (write failures, invalid event fields, signal interruption).
- **`src/context/read-tool.ts`** — file-not-found, permission-denied, symlink-escape paths all untested.
- **`src/agent/agent.ts` edge cases** — `null` tool calls and `undefined` usage metrics aren't covered.
- **`src/fanout/generator.ts` fault injection** — no tests exercise slow adapter, mid-run LLM failure, partial completion.

**Recommendation:** pick the *one or two* gaps most likely to bite. The `screencast` lifecycle gap is the highest-value because it's hot-path code; `runtime/serve.ts` request errors are the second-highest because they catch malformed-request hardening regressions.

**Effort:** M per gap. **Risk:** L (new tests, no behavioral change).

### 6. Five specific low-value tests to delete

Cassian called these by name:

| File:line | Why low-value |
|-----------|---------------|
| `test/paths.test.ts:37-39` | `expect(GAUNTLET_DIRNAME).toBe(".gauntlet")` — tautology |
| `test/agent/initial-message.test.ts:5-10` | First test compares function output to a string copy-pasted from source |
| `test/streaming/screencast.test.ts:14-17` | `streamer !== undefined` after construction — zero behavior |
| `test/helpers/pick-free-port.test.ts` | Mock-and-mirror (see #2 — fix it, don't delete) |
| `test/cli/stream/wrap.test.ts:36` | `formatWidthPercent(100, 0.5) === 50` — expected is computed the same way the function computes |

**Recommendation:** delete the first three outright. Fix #4 per concern 2. The `wrap.test.ts` case probably wants a few well-chosen integration tests of the wrap logic that replace the per-helper unit tests.

**Effort:** XS. **Risk:** L.

---

## Smaller observations

- **`api/` test ratio is 4.21x source LOC.** The api/ source is 854 LOC; the tests are 3600 LOC. The largest contributors are `run.test.ts` (401), `fanout.test.ts` (392), `results.test.ts` (285), `caps.test.ts` (261). Some of this is justified (route handlers are integration boundaries and deserve thorough HTTP-level testing), but the ratio suggests there's a long tail of edge-case assertions — likely cases where "returns 400 on bad input" is tested five different ways. Worth a focused review once the bigger items land.

- **`test/e2e/` is misnamed.** The 12 files in `test/e2e/` are not black-box end-to-end (no spawning the gauntlet binary, no running against a deployed environment). They import adapters and agents directly and run multi-turn scripted LLM loops. They're *long-form integration tests*. Either rename to `test/integration/` or add a *real* e2e tier — `test/cli/binary-smoke.test.ts` is the closest thing today (it does `spawnSync("bun", [entry, ...])`). The terminology slips through PR review and ticket scoping easily, so getting it right helps.

- **`test/helpers/pick-free-port.test.ts` is the only file in `test/helpers/`.** A test file living in the helpers directory is the wrong taxonomy — `helpers/` should be reserved for shared test utilities. Move the test to `test/util/pick-free-port.test.ts` (alongside the other util tests) and reserve `test/helpers/` for the make-config, api-test-app, credential-fixture-setup, etc. helpers that this audit identified as needed.

- **Agent loop tests use heavily layered mocks.** `test/agent/agent.test.ts` constructs `makeMockClient` (no real LLM), `makeMockAdapter` (no real tool execution), and `makeMockLogger` (no disk I/O). These are valuable as *contract tests* — they pin message-sequence invariants, turn counts, deadline checks. But they don't catch end-to-end agent behavior. The closest real e2e is `test/e2e/web-todomvc.test.ts` (in-process WebAdapter + scripted LLM). Worth being explicit in the test-suite docs: agent.test.ts is a contract test, not a behavioral test.

- **Credential-resolver temp setup repeated 3× in `test/adapters/cli/adapter.test.ts`** (lines ~107–162). Same `mkdtempSync` + `writeFileSync` + `chmodSync` + `try/finally rmSync` pattern, three times in one file. Extract to a local `withCredentialContext(fn)` helper inside the file (or into `test/helpers/credential-fixture.ts` if other tests want it).

- **Largest test file matches largest source file in LOC.** `adapters/web/adapter.test.ts` is 1275 LOC, matching `adapters/web/adapter.ts` at 1257. This is correlated, not coincidental — Phase 5 of the cleanup sweep (PRI-1628) splits the web adapter into per-capability files; the test file should follow the same split.

- **`test/agent/__snapshots__/prompt-baseline.txt` is the *good* kind of snapshot test.** It's a drift detector for the system-prompt template. Anyone touching `buildSystemPrompt()` either renews the snapshot deliberately (and reviews the diff) or sees a test fail. Keep this. Resist the temptation to add similar snapshots for non-stable output — most snapshot tests rot. This one earns it.

- **Snapshot dirs are clean.** Only the one baseline. No stale `.snap` files clinging on from removed features.

- **Inspector's infra suggestion (split `bun test` into unit vs integration via `bunfig.toml` / package scripts)** is plausible but **not urgent**. 9 pure unit tests vs 101 integration ones isn't enough volume to make the split pay off — the per-test overhead in `bun test` is low, and developers aren't running these in a TDD inner loop yet. If the unit tier grows to ~30+, revisit.

---

## Candidate actions table

| # | Action | Effort | Risk | Value |
|---|--------|--------|------|-------|
| 1 | Investigate + resolve `cli-adapter.test.ts` × `cli/adapter.test.ts` overlap | S | L | high (untangles migration) |
| 2 | Fix `pick-free-port.test.ts` to bind a real port | XS | L | high (closes real gap) |
| 3 | Extract `makeConfig()` to `test/helpers/make-config.ts` | S | L | medium |
| 4 | Extract Hono+route setup to `test/helpers/api-test-app.ts` | S | L | medium |
| 5 | Add `screencast` lifecycle tests | M | L | medium-high (hot path) |
| 6 | Add `runtime/serve.ts` request-error tests | M | L | medium |
| 7 | Delete the 4 named tautology tests | XS | L | low (but trivial) |
| 8 | Rename `test/e2e/` → `test/integration/` (or split out the real e2e) | S | L | low |
| 9 | Add `test/helpers/credential-fixture.ts`; refactor the 3 sites | XS | L | low |
| 10 | Audit `test/api/`'s 4.21x ratio for redundant edge-case sprawl | M | M | medium |
| 11 | Move `pick-free-port.test.ts` from `helpers/` to `util/` | XS | L | low (taxonomy) |

Pairings that compound:

- **(3) + the PRI-1628 Phase 2 config-type collapse** — `makeConfig()` already needs updates when `EffectiveRunConfig` → `ResolvedRunConfig` lands. Bundle.
- **(2) + (11)** — fix `pick-free-port` and move it in one PR.
- **(4) + (5) + (6)** — the new helper makes the new test scaffolding cheap; do them together.

---

## What I'd start with

If you want one focused PR's worth: **(1) + (2) + (3) + (7) + (11)**.

That's a "test-cleanup PR": resolves the duplicate, fixes the worst mock-and-mirror, lands the most-copied helper, deletes 4 dead tests, and tidies the helpers/ taxonomy. Single-day of work, all low-risk, and it leaves the suite *measurably* cleaner — one fewer test, one fewer mock-and-mirror, one new helper module that replaces 4 copies of 25 lines.

If you want broader impact: add **(5)** — the screencast lifecycle gap is a real one and worth closing while it's surfaced.

---

## Out of scope for this audit

- **No proposed test-runner config changes** (Inspector floated splitting unit vs. integration via `bunfig.toml`; not urgent at current scale).
- **No new e2e tier proposed** beyond renaming the existing one. A real black-box e2e suite would be a separate ticket.
- **No CI-time changes.** This audit doesn't touch how tests run, only what they test and how cleanly.
- **No coverage tool wiring** (e.g. `c8`, `bun test --coverage`). The audit deliberately uses qualitative judgment over coverage percentages — coverage tools tell you *which lines* execute, not *whether the assertion was meaningful*.
