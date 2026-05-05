# Spec — Screencast save is opt-in

## Problem

Web runs persist their screencast video to the run's evidence directory by default. Each file is typically 100MB–1GB. The data is rarely consulted: post-run investigations usually lean on the screenshot gallery and the action transcript. The screencast is primarily useful *during* the run, for a user watching live via the Web UI.

The disk cost is sustained — every completed run keeps its screencast forever — and grows with run volume.

## Change

Stop persisting the screencast to disk by default. Keep the live WebSocket stream to watching clients exactly as it is today.

### Surface

- **AppConfig:** add `defaultSaveScreencast: boolean` (default `false`).
- **Env:** `GAUNTLET_SAVE_SCREENCAST=1` enables.
- **CLI flag:** `--save-screencast` on `gauntlet run` and `gauntlet serve`.
- **Request body:** `saveScreencast?: boolean` on `POST /api/run/:id`, overrides the app default per-run.
- **Web UI:** checkbox in `NewRunModal` wired to the request-body field. Unchecked by default.

### Gate

The screencast writer (likely `src/streaming/screencast.ts` or wherever the WebAdapter hands frames to disk) consults the effective flag at run start. When false, the live stream still flows to the broadcaster; the disk writer is simply not instantiated.

**Important — do not conflate:** the live WS stream must remain on regardless of the flag. Only disk persistence is gated.

## Out of scope

- Retention / cleanup policy for existing screencasts on disk.
- Format changes to the screencast.
- Selectively saving only "interesting" screencasts (e.g. failed runs).
- Changes to screenshots — those stay saved by default.

## Acceptance

- Fresh run with no flag → no screencast file in evidence dir.
- Live Web UI viewing a run still sees the stream.
- `--save-screencast` or env or body override → screencast file present as before.
- Existing tests pass; a new test asserts the gate in both directions.

## Estimate

Small. Half a day at most. Appropriate for a Guppy with clear instructions or a Bob picking it up between larger pieces.
