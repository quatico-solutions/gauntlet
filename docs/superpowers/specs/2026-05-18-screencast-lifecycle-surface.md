# Screencast lifecycle surface (PRI-1630 phase 6 design)

**Author:** Surgeon@daef2708 · **Date:** 2026-05-18 · **Source state:** `src/streaming/screencast.ts` at `pri-1630-phase-6` (pre-Task 6.1.2).

This doc captures the exact session-side surface that `ScreencastStreamer` consumes, so the stub session in `test/streaming/screencast.test.ts` mirrors reality. The lifecycle tests in Task 6.1.3 destructure these exact shapes — drift in this doc means drift in the tests.

## Session surface used by `screencast.ts`

The streamer is constructed with a `chromeSession` (typed loosely as `Record<string, any>` because the chrome-ws-lib session is a moving target). It then drills into a per-tab page session.

| Call | Signature | Site | Sync/await |
|---|---|---|---|
| `chrome.getTabs()` | `() => Promise<Tab[]>` | `start()` line 56 | `await` |
| `tab.getPageSession()` | `() => Promise<PageSession>` (called on `tabs[tabIndex]`) | `start()` line 60 | `await` |
| `pageSession.onEvent(handler)` | `(handler: (event) => unknown) => () => void` (returns an unsubscribe) | `start()` line 63 | sync (the returned function is stored as `unsubFrame`) |
| `pageSession.send("Page.startScreencast", opts)` | `(method: string, params: object) => Promise<void>` | `start()` line 94 | `await` |
| `pageSession.send("Page.screencastFrameAck", { sessionId })` | same | inside the event handler (line 83) | `await` |
| `pageSession.send("Page.stopScreencast")` | same (no params) | `stop()` line 107 | `await` (wrapped in try/catch) |
| `unsubFrame()` | `() => void` (the value returned by `pageSession.onEvent`) | `stop()` line 110 | sync |

The page session is **not** detached — the streamer leaves session cleanup to the tab cache. This is intentional (line-115 comment) so a stub session does not need a `detach()` method.

## Frame event shape (CDP `Page.screencastFrame`)

The event handler at line 63 destructures:

```ts
{
  method: "Page.screencastFrame";  // events with other methods are no-ops
  params: {
    data: string;          // base64-encoded JPEG
    sessionId: number;     // echoed back in screencastFrameAck
    metadata?: {
      deviceWidth?: number;
      deviceHeight?: number;
    };
  };
}
```

The frame the streamer hands to the `onFrame` callback is a different shape:

```ts
// ScreencastFrame, exported from screencast.ts:
{
  data: string;                       // same base64 string
  metadata: {
    width: number;                    // params.metadata?.deviceWidth || 0
    height: number;                   // params.metadata?.deviceHeight || 0
  };
}
```

Events with `method !== "Page.screencastFrame"` are silently ignored (line 65 early return). Events that arrive after `stop()` are also silently ignored (line 64 `if (!this.running) return`).

## `stop()` idempotency

`stop()` is **effectively idempotent**, with one wrinkle:

- Sets `running = false`.
- Tries to `await pageSession.send("Page.stopScreencast")` — wrapped in its own try/catch (best-effort).
- Tries to call `unsubFrame()` — wrapped in its own try/catch (best-effort), then nulls `unsubFrame`.
- Nulls `pageSession`.
- An outer try/catch swallows any error from the above.

On a second `stop()` call:
- `running` is already false (no-op).
- `pageSession` is null, so the `if (this.pageSession)` guard skips the `Page.stopScreencast` send.
- `unsubFrame` is null, so the `if (this.unsubFrame)` guard skips the unsub.
- Net: second `stop()` is a no-op. `session._calls.stopScreencast` should equal **1** after two `stop()` calls.

Calling `stop()` *before* `start()` is also a no-op: both `pageSession` and `unsubFrame` are null from construction, so both guards skip.

## Frame-save synchrony

Frames are saved with `writeFileSync` (line 78, imported synchronously from `fs`). The write completes before the next `await ps.send("Page.screencastFrameAck", ...)` runs. **Synchronous from the test's POV** — emit a frame, then `readdirSync(saveDir)` immediately should show the file. No polling needed.

The filename pattern is `frame-${String(this.frameCount).padStart(5, "0")}.jpg`. The first frame is `frame-00000.jpg`. The frame count is module-internal — tests assert `files.length > 0`, not specific filenames.

## Test affordances the stub needs

For the lifecycle tests in Task 6.1.3, the stub `pageSession` must expose:

- `send(method: string, params?: object): Promise<void>` — records call counts. Specifically increments `_calls.startScreencast` when `method === "Page.startScreencast"`, `_calls.stopScreencast` when `method === "Page.stopScreencast"`, ignores ack.
- `onEvent(handler): () => void` — stores the handler in a closure-scoped variable; returns a function that nulls the handler.
- An `_emit(event)` test affordance to push an event through to the stored handler.

The stub `chromeSession` must expose:
- `getTabs(): Promise<Tab[]>` — returns `[stubTab]`.

The stub `tab` must expose:
- `getPageSession(): Promise<PageSession>` — returns the stub page session.

That's the complete surface. Any method not on this list is NOT called by `screencast.ts`; if the test stub adds methods that aren't here, the doc is the source of truth — update the doc first.
