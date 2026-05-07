# Flatten-mode migration premise spike

**Date:** 2026-05-07
**Author:** Carthage (Bob 2d48c3bd/Opus 4.7 1M)
**Plan under test:** `docs/superpowers/plans/2026-05-06-chrome-ws-lib-flatten-migration.md`
**Throwaway code:** `/tmp/carthage-spike/` (Bun, ~500 LOC, not committed)

## Why this exists

The migration plan rests on two architectural premises whose acceptance criteria are load-bearing tests in Stages 2 and 5. Before authorizing a multi-week migration, validate each premise with concrete evidence on real Chromium.

**Premise 1 (Stage 2 acceptance criteria, line 174):** Under flatten mode, when an attached page evaluates `window.open(...)`, Chrome reliably emits `Target.targetCreated` on the root browser session within a few hundred ms.

**Premise 2 (Stage 5 acceptance criterion, line 290):** Flatten mode fixes the screenshot-during-navigation wedge documented in PRI-1517, because page sessions ride different sessionIds and don't share a head-of-line block.

## Premise 1 — VALIDATED

**Test mechanism.** Spawn headless Chrome with `--remote-debugging-port=0`, pull `webSocketDebuggerUrl` from `/json/version`. Open one browser-level WebSocket. Send `Target.setDiscoverTargets({discover:true})`, then `Target.attachToTarget({targetId, flatten:true})` against the existing about:blank page. Navigate the parent off about:blank to a `data:` URL so it has a real document context. Register a listener on the root session for `Target.targetCreated`. Mark `t0` at `Runtime.evaluate` dispatch (with `userGesture:true` to bypass the popup blocker). Mark `t1` when the listener fires for a `type:page` target whose `openerId` matches the parent. Repeat 10 trials.

**Result.** 10/10 trials succeeded. Latency from evaluate dispatch to root-session `Target.targetCreated` arrival:

| min | median | mean | max |
|-----|--------|------|-----|
| 2ms | 2ms | 2.2ms | 3ms |

No flakiness. Chrome's popup target lands on the root session before the `Runtime.evaluate` reply itself, so even synchronous "fire eval, then await" code never misses it.

**Gotchas to know about.**

- `Runtime.evaluate` requires `userGesture: true` for `window.open` to actually create a popup. Without it, `window.open` returns a non-null window object but no target is created. (Cost me a debugging cycle.)
- The freshly-created popup target initially has `url: ""` and `title: ""`. The url and title fill in via a follow-up `Target.targetInfoChanged`. **Don't filter `targetCreated` by URL** — filter by `openerId` matching the parent target, or by `type:'page'` and a known absence in pre-call snapshot.
- Headless Chrome with a fresh `--user-data-dir` still autoloads system component extensions (Google Hangouts, etc.) on macOS; harmless but noisy in event sniffs.

**Implication for the plan.** Stage 2's load-bearing acceptance test (line 174) will pass cleanly. Premise 1 is real.

## Premise 2 — INCONCLUSIVE (with material findings)

This is the messier of the two. Three things to report.

### Finding 1: I could not reproduce the wedge in any configuration

**Test mechanism.** A Bun.serve fixture with a `/slow` endpoint that streams the HTML head fast then holds the connection open for 4-6 seconds before closing — keeping Chrome in `loading` state without finishing. Three variants tested, 3-5 trials each:

- **A) Per-target-WS, same page.** Open the page WS at `/devtools/page/<id>`. Fire `Page.navigate` to `/slow`, wait 50-100ms, fire `Page.captureScreenshot` on the same WS. Time the screenshot.
- **B) Flatten, same session.** Open browser WS, attach page session via `Target.attachToTarget(flatten:true)`. Same dispatch pattern, same sessionId.
- **C) Flatten, cross-session.** Open two page sessions. `Page.navigate` on session A to a slow URL. `Page.captureScreenshot` on session B (a different page).

I ran two versions. The second specifically tried cross-origin navigation (server A on port P1 → navigate to server B on port P2) hoping to provoke a renderer process swap and sever the per-target WS.

**Results.** All three variants screenshot in 14-30ms median across all trials. The slow nav body delay (4-6s) had no observable effect on screenshot latency. The per-target WS stayed alive (`wsAlive=true`) through cross-origin same-IP-different-port navigation.

```
                       median shot  range
per-target same page    24ms        [14, 30]
flatten same session    16-20ms     [15, 25]
flatten cross-session   20ms        [14, 24]
```

The cross-origin nav variant did not trigger a renderer swap and did not sever the WS. (This makes sense — `127.0.0.1:P1` and `127.0.0.1:P2` are same-site under Chrome's default `--site-per-process` policy.)

### Finding 2: The PRI-1517 spec itself doesn't pin down the wedge mechanism

From `docs/superpowers/specs/2026-05-06-pri-1517-design.md` line 23:

> "The deeper cause — what made Chrome (or the pool) take 30s to respond instead of 60ms — is not pinned down here. Plausible candidates include Chrome silently dropping requests across renderer-replacement during navigation, pool-internal request-id loss adjacent to PRI-1446, or eventHandler-slot contention."

PRI-1517 was a symptomatic fix (5s cap + decouple action result from screenshot result), not a root-cause fix. The migration plan's claim at line 290 that flatten mode fixes the wedge "at the architectural level" is therefore **a hypothesis layered on top of an unidentified mechanism**, not a follow-on from a known cause.

### Finding 3: The migration plan's stated mechanism doesn't quite hold up under scrutiny

The plan describes per-target-WS as having a "WS-level FIFO" that serializes screenshot behind navigate. But `chrome-ws-lib.js`'s pooled connection (`getPooledConnection`, `sendCdpCommandPooled`) tracks pending requests by `id` in a Map and matches responses by `id` — it does **not** enforce FIFO ordering at the WS layer; multiple in-flight requests are allowed and parallelize at whatever level Chrome supports.

If the wedge mechanism is "Chrome's per-page-session command queue serializes Page.navigate ahead of Page.captureScreenshot," then **flatten mode same-session does NOT fix it** — both commands still ride the same sessionId. Flatten mode only helps in the cross-target case (screenshot a different page than the one navigating).

The migration plan's text on line 290 — "screenshot and navigate ride different sessionIds" — is only true if you screenshot a different page. The PRI-1517 transcript that motivates the claim is screenshotting the page that just navigated. So the claimed architectural fix doesn't apply to the failing-case shape on its face.

### What this test does and does NOT prove

**Does NOT prove:**
- That flatten mode fixes PRI-1517's wedge. I never reproduced the wedge.
- That flatten mode does NOT fix it. I never tickled the right conditions to provoke either path.

**Does suggest:**
- The wedge depends on conditions I couldn't reproduce in 4-6 second slow-page setups against headless Chromium 137 — possibly tied to renderer process replacement, OAuth chains, specific Chrome build flags, or some interaction with the actual gauntlet adapter's selector-translation and click flow that I'm not exercising.
- The migration plan's architectural argument for why flatten fixes it (line 290) is **not airtight**. Same-session flatten can't help if the wedge is at Chrome's page-session level.
- The cross-target flatten case (variant C) genuinely rides separate sessionIds — that's a real win for any future "screenshot tab B while tab A is doing something" workflow, but it's not the PRI-1517 shape.

## Recommendation: **GO with caveats**

Premise 1 is solid. Stage 2 will work. That alone justifies Stages 1-4 of the migration — live target visibility, BrowserContext isolation, cross-target parallelism are all real wins independent of Premise 2.

Premise 2 should be **dropped from the migration's justification**, not used as an argument against migrating. Stage 5's acceptance criterion at line 290 ("Add a regression test that issues a screenshot mid-navigation and asserts it returns within 5s instead of 30s") is unfounded as written: I could not reproduce the 30s case to begin with, and the "different sessionIds" architectural mechanism doesn't apply to same-page screenshots. If Stage 5 is pursued, the executor should:

- Strike "screenshot-during-nav fix" from the Stage 5 motivation.
- Keep Stage 5 only on the merits of flatten mode being the canonical/maintained path, plus PRI-1517's `opts.timeoutMs` divergence retiring (which it does anyway — once flatten lands the param is no longer load-bearing for the adapter).
- If reproducing PRI-1517's wedge becomes important for any reason, the path forward is collecting more transcripts from production runs and looking for what they have in common — not trying to construct the failure synthetically.

Stage 4 is still the honest stop-point per the plan's own §8. Reaching it captures the validated wins. Continuing past Stage 4 should be a "we want flatten because it's the canonical path" decision, not a "we want flatten to fix PRI-1517" decision.

## How to re-run

```fish
set -l SPIKE_DIR /tmp/carthage-spike
mkdir -p $SPIKE_DIR
# (Recreate the four files: launch.js, flatten-client.js,
# premise1-window-open.js, premise2-v3.js — see the throwaway code
# referenced in this doc. Each is self-contained Bun + native WebSocket.)

bun run $SPIKE_DIR/premise1-window-open.js   # ~5s, 10 trials
bun run $SPIKE_DIR/premise2-v3.js            # ~60s, 9 trials across 3 variants
```

The premise-1 spike is small enough (one launcher, one client, one driver, ~150 LOC total) that another Bob can rewrite it from this description in 10 minutes.

The premise-2 spike was harder to design well. If someone wants to take a second crack at reproducing PRI-1517's wedge, the most promising directions I didn't pursue:

- Reproduce against the real `tutorial-06-post-and-verify` flow under per-target-WS but with extra logging on the pool's WS state — does the WS actually die mid-call?
- Test against a navigation that's *known* to trigger a renderer swap (e.g., navigate to a URL with a different `Cross-Origin-Opener-Policy`).
- Run the actual gauntlet adapter against the original failing fixture and see how often the wedge fires; the spec implies it's racy (sometimes succeeds in 60ms, sometimes hangs 30s).

Co-Authored-By: Carthage (Bob 2d48c3bd/Opus 4.7 1M)
