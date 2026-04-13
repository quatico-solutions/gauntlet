# Gauntlet run format

This document describes the on-disk format of a Gauntlet run. It is a stable
public contract: CLI tools, ecosystem integrations, CI reporters, humans, and
LLMs are all expected to read these files directly. The HTTP API is one
consumer among several, not the primary contract.

## Directory layout

Every run produces a directory under `<data-dir>/results/<scenario-id>/`:

```
<data-dir>/results/<scenario>/
  result.json        Structured result + manifest of evidence
  result.md          Human- and LLM-readable rendering of result.json
  run.jsonl          Append-only action log, one JSON object per tool call
  screenshots/       Agent-captured screenshots referenced in the manifest
    001.png
    002.png
    ...
  frames/            Passive screencast frames for playback (not yet in manifest)
    frame-00000.jpg
    ...
  issues/            Per-observation markdown, derived from result.json
    001-bug-...md
    002-ux-...md
    ...
```

The run directory is self-contained. Copying it anywhere preserves the full
record of the run.

## `result.json`: the manifest

`result.json` is both the structured result and the evidence manifest for the
run. Example (abbreviated):

```json
{
  "schemaVersion": 1,
  "scenario": "login-001",
  "status": "pass",
  "summary": "User can log in with valid credentials.",
  "reasoning": "Navigated to /login, entered valid credentials, ...",
  "observations": [
    { "kind": "ux", "description": "Password field has no show/hide toggle." }
  ],
  "evidence": {
    "screenshots": ["screenshots/001.png", "screenshots/002.png"],
    "log": "run.jsonl"
  },
  "duration_ms": 14203,
  "usage": { "inputTokens": 12500, "outputTokens": 840, "turns": 7 }
}
```

### Fields

- `schemaVersion` (number) — The format version. Currently `1`. A reader that
  does not recognize the version should fail loudly rather than guess.
- `scenario` (string) — The id of the story card this run tested.
- `status` (`"pass" | "fail" | "investigate"`) — The agent's verdict.
- `summary` (string) — One- or two-sentence summary.
- `reasoning` (string) — The agent's explanation of how it reached the verdict.
- `observations` (array) — Incidental findings. Each has `kind` (`bug`, `ux`,
  `typo`, `suggestion`, `a11y`, `performance`) and `description`.
- `evidence` (object) — The manifest. See below.
- `duration_ms` (number) — Total wall-clock time for the run.
- `usage` (object, optional) — Token and turn counts from the LLM.

### The evidence manifest

`evidence` is the manifest portion of `result.json`. It lists files that are
part of the run's evidentiary record.

```json
"evidence": {
  "screenshots": ["screenshots/001.png", "screenshots/002.png"],
  "log": "run.jsonl"
}
```

**The rule — and the only rule — a reader needs:** every string in the
manifest is a **relative path from the run directory**. To locate the file,
join it with the run directory root. No hidden mappings, no kind-to-subdir
translation, no code required to interpret it.

This property is what makes the manifest portable. You can read `result.json`
from anywhere — a shell script, another language, an LLM — and resolve every
entry without knowing Gauntlet's internals.

### What is and isn't in the manifest

The manifest lists **evidence**: files the writer considers part of the run's
authoritative record. Currently:

- `screenshots` — intentional agent captures.
- `log` — the append-only action log (`run.jsonl`).

Not (yet) in the manifest:

- `frames/` — passive screencast frames for video playback. May be manifested
  later if we decide they are evidence rather than a playback medium.
- `issues/*.md` — per-observation markdown files. These are **derivations**
  of `result.json` (the `observations` array), not independent evidence, and
  can be regenerated from the manifest.
- `result.md` — human-readable rendering of `result.json`. Also a derivation.
- Any video file — video generation is not yet implemented.

A derivation is a file that can be recomputed from the manifest. The manifest
does not list derivations because listing them would create drift: if you
change how they're rendered, you'd have to update the manifest too. Keep the
manifest about source-of-truth evidence and let derivations be derived.

## HTTP access

The Gauntlet server exposes run data through a small API under `/api/results`:

- `GET /api/results` — list all runs (returns parsed `result.json` contents).
- `GET /api/results/:scenario` — get one run's parsed `result.json`.
- `GET /api/results/:scenario/file/:relativePath` — serve any file inside a run
  directory, given its relative path from the run root. This matches the
  manifest contract: whatever path you find in `evidence.screenshots[i]`, you
  can request via this endpoint.

Example: a screenshot listed in the manifest as `"screenshots/001.png"` is
served by `GET /api/results/login-001/file/screenshots/001.png`. Path traversal
outside the run directory is blocked.

The HTTP API intentionally does not invent its own evidence schema. It is a
thin controller that surfaces what the manifest already describes, plus the
ability to fetch any named file. If you want presentation-layer data (URLs,
captions, linked observations) beyond what the manifest provides, that is a
separate view-model concern to be added on top — the manifest itself should
stay stable and consumer-agnostic.

## Schema versioning

`schemaVersion` is bumped when an incompatible change is made to `result.json`
or the surrounding directory layout. Additive changes (new optional fields,
new subdirectories that don't break existing readers) do not require a bump.
Removing or renaming fields, changing the meaning of existing fields, or
rearranging the directory layout does.

When bumping, document the change here so downstream consumers can update.

### Changelog

- **v1** — Initial published format. Directory layout and `result.json` shape
  as described above.
