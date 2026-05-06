# Prompt extraction, project augmentation, and `--show-prompt-and-exit` — design

**Status:** Draft, awaiting Matt review.
**Author:** Jeeves (Bob 959e656e / claude-opus-4-7[1m]).
**Related:** `src/agent/prompts.ts`, `src/agent/agent.ts`, `src/context/tree.ts`, `src/cli/args.ts`, `src/runs/orchestrator.ts`.

---

## Problem

The system prompt today is hard-coded inside `src/agent/prompts.ts`: persona text, evaluation guidance, reporting schema, and adapter-specific overlays all live as TypeScript string literals inside `buildSystemPrompt`. Three things follow from that:

1. **Prompt iteration costs a rebuild.** Editing the persona means editing source.
2. **Callers can't augment the prompt without forking.** A project that wants to add app-specific guidance ("when you see a TenantId field, ignore it — it's prefilled") has no insertion point.
3. **There's no way to inspect what gets sent.** Debugging a weird verdict means reading source and mentally reconstructing the composition.

This design addresses all three: extract the static prose into `.md` files, add a Project augmentation slot, and add a `--show-prompt-and-exit` introspection flag.

## Goals

- Move all static prompt prose out of TypeScript into editable `.md` files.
- Provide a single, well-defined slot for caller-supplied augmentation, with a sensible default location.
- Provide a deterministic, side-effect-free way to render the composed prompt for inspection.
- Preserve the current behavior bit-for-bit when no Project prompt is supplied — this is a refactor + additive feature, not a behavior change.

## Non-goals

- No template engine inside `.md` files. They are raw text.
- No directory-of-files Project model. One file, one path. (Can revisit if a real use case appears.)
- No runtime override of `Persona`/`Evaluation`/`Adapter`/`Context` files by callers. Only the Project slot is caller-controlled.
- No caching strategy work. Files are read on each composition; cache only if profiling demands it.

## Composition model

`buildSystemPrompt` produces a `parts: string[]` joined with `\n\n`. The order is fixed:

| # | Block | Source | Kind |
|---|-------|--------|------|
| 1 | Persona | `src/agent/prompts/persona.md` | static include |
| 2 | Scenario | current card data (title, body, acceptance criteria) | data injection |
| 3 | Evaluation & Reporting | `src/agent/prompts/evaluation.md` | static include |
| 4 | Adapter | `src/agent/prompts/adapter-{name}.md` (one per registered adapter) | static include |
| 5 | Project | caller-supplied path or `.gauntlet/project.md` | optional include |
| 6 | Context | `src/agent/prompts/context.md` (wrapper) + rendered `.gauntlet/context/` tree | template + data |

The order is deliberate. Persona establishes identity. Scenario gives the task. Evaluation tells the agent how to think about the task. Adapter describes the available affordances. Project layers app-specific guidance on top — placed before Context so that subsequent reading of the context tree happens through that lens. Context comes last because it is the largest and most concrete, and serves as ground truth.

### Block 3: Evaluation & Reporting

Today's `src/agent/prompts.ts` has two adjacent static blocks: acceptance-criteria guidance ("evaluate each criterion based on what you observe") and reporting schema (verdict enum, observation schema). Both concern *how to produce the output* and have the same lifetime. They merge into a single `evaluation.md` file. The combined file is the only file change to existing prose; the text is moved verbatim.

### Block 4: Adapter

Each registered adapter has a corresponding `adapter-{name}.md` file (`adapter-web.md`, `adapter-tui.md`, `adapter-cli.md`). At composition time, the file matching the active adapter's name is included.

Currently only the web adapter has prompt-level guidance (`WEB_SIDE_TRIP_GUIDANCE`); `adapter-cli.md` and `adapter-tui.md` are created with empty or minimal content as honest placeholders. We expect TUI to grow content soon (tmux skills) — having the file already exist removes friction.

### Block 5: Project

The Project block is the single point of caller customization. Resolution:

1. If `--project-prompt <path>` is supplied on the CLI, read that file. **Missing file is a hard error.**
2. Otherwise, if `.gauntlet/project.md` exists in the project directory, read it.
3. Otherwise, the Project block is omitted from composition. In introspect output it shows as `(none)`.

The file's contents are included verbatim. There is no schema, no frontmatter, no template syntax. It is prose.

### Block 6: Context

`context.md` is a small wrapper file that introduces the rendered tree (the prose currently at lines 14–33 of `src/agent/prompts.ts`). The rendered tree is appended after the wrapper. Today's `renderContextTree` (`src/context/tree.ts:73`) is unchanged.

## File layout

```
src/agent/prompts/
  persona.md
  evaluation.md
  adapter-web.md
  adapter-tui.md
  adapter-cli.md
  context.md
```

`.md` files live next to the existing `src/agent/prompts.ts` rather than at the repo root. Reasoning: they are program data, not user-edited content; co-locating with the loader keeps imports relative and the bundling story trivial.

`prompts.ts` becomes a thin loader plus `buildSystemPrompt`. The string literals it currently holds move to the corresponding `.md` files verbatim.

## Loading and packaging

Files are read with `fs.readFileSync(path.join(import.meta.dir, "prompts", "<name>.md"), "utf8")` on every `buildSystemPrompt` call. No caching in v1. This:

- Keeps the loader simple.
- Lets a developer edit a `.md` file and have the next run pick it up without a restart.
- Adds a few microseconds per run, which is irrelevant next to LLM round-trip time.

`import.meta.dir` works correctly under `bun run`, `bun build`, and compiled binaries. Task 1 of the implementation plan must verify this end-to-end with a built binary, not just `bun run`.

## CLI surface

Two new flags on the `run` subcommand (parsed in `src/cli/args.ts:175` `parseRunArgs`, allow-listed at `src/cli/args.ts:47`):

### `--project-prompt <path>`

- Value: filesystem path to a `.md` file (any extension accepted, but `.md` is the convention).
- If the file does not exist or is unreadable, `gauntlet run` exits non-zero with a clear message naming the path.
- Threaded through `RunCommandOptions` → `runOne` → `executeRunCore` → `buildSystemPrompt(..., projectPrompt)`.

### `--show-prompt-and-exit`

- Boolean flag. Requires a positional card argument (same as a normal `run`).
- When present:
  - All other run-time machinery is skipped: no Chrome launch, no LLM client construction, no API key lookup, no adapter `start()`, no run directory creation.
  - The system prompt is composed using the same `buildSystemPrompt` call a real run would use, with the supplied card, the selected adapter (default if not specified), the rendered context tree from `.gauntlet/context/`, and the Project prompt if applicable.
  - The composed prompt is rendered to stdout in the format described in the next section.
  - Exit code 0 on success.

The adapter used for composition follows the same flag resolution as a real run (`--adapter <name>`, defaulting to whatever `parseRunArgs` defaults to today). If no adapter can be resolved, exit with the same error a real run would produce.

The flag is intentionally verbose (`--show-prompt-and-exit`, not `--introspect`) so that its terminal nature is unambiguous from the command line.

## Introspect output format

Stdout, one block per composition step, in composition order:

```
─── Persona ──────────────  src/agent/prompts/persona.md
You are a thorough QA tester. You test software by using it...
[full file contents]

─── Scenario ─────────────  (from card: ./cards/sign-in.md)
Story: Matt signs in
[rendered card framing exactly as the agent would see it]

─── Evaluation ───────────  src/agent/prompts/evaluation.md
[full file contents]

─── Adapter (web) ────────  src/agent/prompts/adapter-web.md
[full file contents]

─── Project ──────────────  /Users/mw/projects/foo/project.md   (caller-supplied)
[full file contents]

─── Context ──────────────  src/agent/prompts/context.md + .gauntlet/context/  (3 files, 412 bytes)
[wrapper prose]

[rendered context tree]
```

Rules:

- Every block in the composition table appears, in order, every time. Skipped blocks (e.g., no Project) print the header with `(none)` and no body. This makes diffs between two runs structurally comparable.
- Each header carries provenance: the file path for static includes, the data source for templated blocks, or `(caller-supplied)` for Project.
- The body is the literal text that would be sent to the model — no truncation, no summary.
- Output is plain text, no ANSI color, no escape sequences. Pipe-friendly.
- Headers use `─` (U+2500) box-drawing by default. Downgrade to ASCII `---` when `NO_COLOR` is set in the environment or `process.stdout.isTTY` is false (i.e., output is piped or redirected). Same convention as the existing `PrettyRenderer`.

## Failure modes

| Condition | Behavior |
|-----------|----------|
| `persona.md`, `evaluation.md`, or `context.md` missing at startup | Hard error from the loader naming the missing file. These are required. |
| `adapter-{name}.md` missing for the selected adapter | Hard error naming the missing file. Keeps adapter registration honest. |
| `--project-prompt <path>` supplied, file missing or unreadable | Hard error naming the path. Caller asked for it; don't silently drop. |
| `.gauntlet/project.md` absent (no flag supplied) | Silent skip. Project block prints as `(none)` in introspect. |
| `--show-prompt-and-exit` supplied without a card argument | CLI parse error, same as a normal `run` missing its card. |
| Card unparseable under `--show-prompt-and-exit` | Same error path as a normal run; we want introspection failures to mirror real failures. |

## Test surface

- Unit: `buildSystemPrompt` produces the same final string as today's implementation when given equivalent inputs and no Project. (Snapshot test against current output as a refactor safety net.)
- Unit: `buildSystemPrompt` with a Project string inserts it in position 5 between Adapter and Context.
- Unit: Loader throws a clear error when a required file is missing.
- Integration: `gauntlet run --show-prompt-and-exit ./test-card.md` exits 0 and prints all six section headers.
- Integration: `gauntlet run --show-prompt-and-exit ./test-card.md --project-prompt ./extra.md` includes the Project block contents.
- Integration: `gauntlet run --show-prompt-and-exit` without a card exits non-zero with a usage error.
- Bun-binary smoke: the compiled binary loads `.md` files from its bundle (verifies `import.meta.dir` packaging).

## Out of scope / future

- **Project as a directory.** If a use case emerges for multiple project-level files, follow the Context model (`.gauntlet/prompts.d/` rendered as a tree). Not now.
- **Per-card prompt overrides** (frontmatter or sidecar). Not asked for.
- **Templating inside `.md` files.** If a real need arises, evaluate then; until then, do not invent placeholders.
- **Caching loaded files.** Add only if profiling shows it matters.
- **`--show-prompt-and-continue` variant.** Deliberately deferred. If "show then run" becomes useful, it's a separate flag, not a mode.
- **Web-product introspection.** This spec covers CLI only. Exposing the same composed-prompt view via the web product is a follow-up; the underlying `buildSystemPrompt` is shared, so the work is wiring a route, not a new model.
