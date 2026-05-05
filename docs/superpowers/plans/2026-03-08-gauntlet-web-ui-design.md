# Vet Web UI Design

## Goal

Add a web UI to vet that provides visual management of story cards and live test run observation, embedded in the existing `vet serve` Hono server.

## Architecture

Single Hono server serves both the API (`/api/*`) and the React frontend (static assets from `ui/dist/`). In dev, Vite dev server runs on a separate port with a proxy to the API.

```
vet/
  src/           # API code (Hono)
  ui/            # React frontend
    src/
      components/
      routes/
      lib/
    index.html
    vite.config.ts
    tailwind.config.ts
  test/
```

**Tech stack**: React 19, React Router (client-side only), Vite, Tailwind CSS v4.

**Design language**: Brainstorm's tokens — teal accent (#1a6b5a), Fraunces (headings) + DM Sans (body), surface (#f6f8fa), panel (#eef1f5), edge (#e1e4e8), 8px border radius. No emoji, no shadows on cards.

**API boundary**: All existing routes move under `/api/` prefix. Hono serves `ui/dist/index.html` as catch-all for client-side routing.

**Live streaming**: WebSocket endpoint at `/api/ws` for CDP screencast frames and run progress events.

## Cards Tab

Left sidebar: flat list of all story cards. Each entry shows id, title, status badge (draft/ready), and tags. Filterable by status and tags. Cards with a `parent` are indented slightly under their parent to show fanout tree structure visually — still a flat list, not collapsible.

Top of sidebar: "New Card" button.

Main area: selected card in an editable view.

- Frontmatter fields (id, title, status, tags, parent, stakeholder) as form inputs at the top
- Description and acceptance criteria as a markdown textarea
- Action bar: Save, Delete, Approve (sets status to ready), Fanout (triggers variation generation)
- When fanout completes, new cards appear in the sidebar under the parent

No live markdown preview — just a textarea.

## Runs Tab

Left sidebar: list of runs, newest first. Each entry shows card title, timestamp, and result badge (pass/fail/error/running). Filterable by status.

Top of sidebar: "New Run" button — opens modal to select card(s), target URL, and model.

### Running test view

- CDP screencast stream — live browser view, takes most of the space
- Below: streaming LLM output (tool calls, observations) as scrolling log
- Card title and acceptance criteria in collapsible header

### Completed run view

- Recorded .mp4 video player at top
- Result summary: pass/fail, observations list, evidence screenshots
- Actions: "Generate from observations" (fanout), "Analyze failure" (fanout) — create new cards and switch to Cards tab
- Link back to source card

## WebSocket Protocol

Server sends JSON messages over `/api/ws`:

- `{ type: "frame", data: "<base64 jpeg>" }` — CDP screencast frame
- `{ type: "progress", status: "running", card: "...", message: "..." }` — LLM activity
- `{ type: "complete", result: { ... } }` — run finished

## Video and Screenshot Capture

Playwright `recordVideo` captures .mp4 per run. Videos stored alongside result JSON: `results/<run-id>/video.webm`.

API serves videos at `/api/results/:id/video` and screenshots at `/api/results/:id/screenshots/:name`.

## Storage

Filesystem only (current behavior). No database.

## Decisions

- Embedded in `vet serve`, not a separate app
- `ui/` directory with own Vite config, separate from `src/` API code
- Full CRUD for story cards in UI
- Live CDP screencast (not screenshot polling) via `Page.startScreencast`
- Two-tab layout: Cards and Runs
- No SSR — client-side React Router only
