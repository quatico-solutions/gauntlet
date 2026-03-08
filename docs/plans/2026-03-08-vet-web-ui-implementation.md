# Vet Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a web UI to vet for managing story cards and watching test runs with live browser streaming.

**Architecture:** React 19 frontend in `ui/` directory, served as static assets by the existing Hono server. API routes move under `/api/*` prefix. WebSocket at `/api/ws` streams CDP screencast frames and LLM progress during test runs. Playwright `recordVideo` captures .mp4 artifacts.

**Tech Stack:** React 19, React Router 7 (client-side only), Vite 6, Tailwind CSS v4, Hono, Bun, WebSocket, Chrome DevTools Protocol

**Design reference:** `docs/plans/2026-03-08-vet-web-ui-design.md`

**Design approach:** Use brainstorm's design tokens (Fraunces/DM Sans, teal accent, surface/panel/edge colors) as the foundation, but apply the frontend-design skill's philosophy within those constraints. Each UI task should include a design thinking step before coding — consider spatial composition, motion, rhythm, and micro-interactions. The component code in this plan is structural scaffolding; the implementer should treat it as a starting point and apply real design intentionality to make each view feel crafted, not assembled. Match brainstorm's *feel*, not its exact layouts.

---

### Task 1: API Prefix Migration

Move all existing API routes under `/api/` prefix so the root path is free for serving the UI.

**Files:**
- Modify: `src/api/server.ts`
- Modify: `test/api/scenarios.test.ts`
- Modify: `test/api/results.test.ts`
- Modify: `test/api/run.test.ts`
- Modify: `test/api/fanout.test.ts`
- Modify: `test/e2e/cli-fanout.test.ts` (if it uses API paths)

**Step 1: Update test files to use `/api/` prefix**

In each test file under `test/api/`, update all `app.request(...)` paths to include the `/api/` prefix. For example:

In `test/api/scenarios.test.ts`:
```typescript
// Before:
const res = await app.request("/scenarios");
// After:
const res = await app.request("/api/scenarios");

// Before:
const res = await app.request("/scenarios/story-001");
// After:
const res = await app.request("/api/scenarios/story-001");
```

Do the same for all paths in `test/api/results.test.ts`, `test/api/run.test.ts`, `test/api/fanout.test.ts`.

Search for `app.request("` in each file and prefix every path with `/api`.

**Step 2: Run tests to verify they fail**

Run: `bun test test/api/`
Expected: All tests FAIL (404s because routes are still at old paths)

**Step 3: Update `src/api/server.ts` to use `/api/` prefix**

```typescript
import { Hono } from "hono";
import { join } from "path";
import { scenarioRoutes } from "./routes/scenarios";
import { resultRoutes } from "./routes/results";
import { fanoutRoutes } from "./routes/fanout";
import { runRoutes } from "./routes/run";

export function createApp(dataDir: string) {
  const app = new Hono();

  const api = new Hono();
  api.route("/scenarios", scenarioRoutes(dataDir));
  api.route("/results", resultRoutes(join(dataDir, "results")));
  api.route("/fanout", fanoutRoutes(dataDir));
  api.route("/run", runRoutes(dataDir));

  app.route("/api", api);

  return app;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test test/api/`
Expected: ALL PASS

**Step 5: Update e2e tests if they use API paths**

Check `test/e2e/cli-fanout.test.ts` — if it hits the API server, update those paths too.

**Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS (110 pass, 4 skip, 0 fail)

**Step 7: Commit**

```bash
git add src/api/server.ts test/api/ test/e2e/
git commit -m "refactor: move API routes under /api/ prefix"
```

---

### Task 2: Scaffold UI Directory

Set up the React frontend project inside `ui/` with Vite, React, Tailwind CSS v4, and React Router.

**Files:**
- Create: `ui/package.json`
- Create: `ui/tsconfig.json`
- Create: `ui/vite.config.ts`
- Create: `ui/index.html`
- Create: `ui/src/main.tsx`
- Create: `ui/src/app.css`
- Create: `ui/src/App.tsx`

**Step 1: Create `ui/package.json`**

```json
{
  "name": "vet-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Step 2: Create `ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create `ui/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

**Step 4: Create `ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>vet</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=DM+Sans:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Create `ui/src/app.css`**

Copy the design tokens and component styles from brainstorm. This is the Tailwind v4 `@theme` block plus reusable component classes:

```css
@import "tailwindcss";

@theme {
  --color-ink: #1b2631;
  --color-ink-light: #374a5e;
  --color-slate: #6b7c8f;
  --color-teal: #1a6b5a;
  --color-teal-dark: #135c4c;
  --color-teal-light: #d4ece8;
  --color-teal-wash: #eaf5f2;
  --color-surface: #f6f8fa;
  --color-panel: #eef1f5;
  --color-edge: #e1e4e8;
  --color-edge-light: #eef1f5;

  --font-display: "Fraunces", serif;
  --font-body: "DM Sans", sans-serif;
}

body {
  font-family: var(--font-body);
  color: var(--color-ink);
  background: var(--color-surface);
}

.btn-primary {
  background-color: var(--color-teal);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 0.15s;
}
.btn-primary:hover {
  background-color: color-mix(in srgb, var(--color-teal) 90%, black);
}
.btn-primary:disabled {
  opacity: 0.5;
}

.btn-secondary {
  background-color: white;
  color: var(--color-ink);
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid var(--color-edge);
  transition: border-color 0.15s;
}
.btn-secondary:hover {
  border-color: var(--color-teal);
}

.btn-danger {
  background-color: white;
  color: #b91c1c;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid #fecaca;
  transition: border-color 0.15s;
}
.btn-danger:hover {
  border-color: #b91c1c;
}

.input-field {
  width: 100%;
  border: 1px solid var(--color-edge);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
}
.input-field:focus {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-teal) 30%, transparent);
  border-color: var(--color-teal);
}

.card {
  background: white;
  border: 1px solid var(--color-edge);
  border-radius: 0.5rem;
  transition: border-color 0.15s;
}
.card:hover {
  border-color: color-mix(in srgb, var(--color-teal) 40%, transparent);
}

.heading-display {
  font-family: var(--font-display);
  font-weight: 500;
  color: var(--color-ink);
}

.section-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-slate);
}

/* Scrollbar */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-edge) transparent;
}
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background-color: var(--color-edge);
  border-radius: 3px;
}
*::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-slate);
}

/* Tab bar */
.top-tab-bar {
  display: flex;
  border-bottom: 2px solid var(--color-edge);
  background: white;
}
.top-tab-bar button {
  flex: 1;
  padding: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-slate);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
}
.top-tab-bar button:hover {
  color: var(--color-ink);
}
.top-tab-bar button.active {
  color: var(--color-teal);
  border-bottom-color: var(--color-teal);
}
```

**Step 6: Create `ui/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

**Step 7: Create `ui/src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from "react-router-dom";

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-surface">
      <h1 className="heading-display text-2xl">{name}</h1>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/cards" replace />} />
      <Route path="/cards" element={<Placeholder name="Cards" />} />
      <Route path="/runs" element={<Placeholder name="Runs" />} />
    </Routes>
  );
}
```

**Step 8: Install dependencies**

Run: `cd ui && bun install`
Expected: Installs successfully, creates `bun.lock`

**Step 9: Verify the dev server starts**

Run: `cd ui && bun run dev`
Expected: Vite dev server starts on port 5173. Visit `http://localhost:5173/` in browser — should redirect to `/cards` and show "Cards" heading in Fraunces font on grey background.

Kill the dev server after verifying.

**Step 10: Verify the build works**

Run: `cd ui && bun run build`
Expected: Builds to `ui/dist/` with `index.html`, JS, and CSS assets.

**Step 11: Commit**

```bash
git add ui/
git commit -m "feat: scaffold UI directory with React, Vite, Tailwind v4"
```

---

### Task 3: Serve Static UI from Hono

Configure the Hono server to serve built UI assets and fall back to `index.html` for client-side routing.

**Files:**
- Modify: `src/api/server.ts`
- Create: `test/api/static-serving.test.ts`

**Step 1: Write the failing test**

Create `test/api/static-serving.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/api/server";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Static UI serving", () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-static-"));
    mkdirSync(join(dataDir, "stories"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("serves index.html for unknown routes when UI is built", () => {
    const uiDir = join(dataDir, "ui-dist");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<html><body>vet ui</body></html>");

    app = createApp(dataDir, uiDir);
    return app.request("/cards").then(async (res) => {
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("vet ui");
    });
  });

  test("serves static assets from UI dist", () => {
    const uiDir = join(dataDir, "ui-dist");
    const assetsDir = join(uiDir, "assets");
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, "main.js"), "console.log('hello')");

    app = createApp(dataDir, uiDir);
    return app.request("/assets/main.js").then(async (res) => {
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("console.log('hello')");
    });
  });

  test("API routes still work with UI serving enabled", () => {
    const uiDir = join(dataDir, "ui-dist");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<html></html>");

    app = createApp(dataDir, uiDir);
    return app.request("/api/scenarios").then(async (res) => {
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  test("works without UI dist directory", () => {
    app = createApp(dataDir);
    return app.request("/cards").then((res) => {
      expect(res.status).toBe(404);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/static-serving.test.ts`
Expected: FAIL — `createApp` doesn't accept a second parameter yet

**Step 3: Update `src/api/server.ts` to serve static files**

```typescript
import { Hono } from "hono";
import { join } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { scenarioRoutes } from "./routes/scenarios";
import { resultRoutes } from "./routes/results";
import { fanoutRoutes } from "./routes/fanout";
import { runRoutes } from "./routes/run";

export function createApp(dataDir: string, uiDir?: string) {
  const app = new Hono();

  const api = new Hono();
  api.route("/scenarios", scenarioRoutes(dataDir));
  api.route("/results", resultRoutes(join(dataDir, "results")));
  api.route("/fanout", fanoutRoutes(dataDir));
  api.route("/run", runRoutes(dataDir));

  app.route("/api", api);

  if (uiDir && existsSync(uiDir)) {
    app.get("*", (c) => {
      const urlPath = new URL(c.req.url).pathname;
      const filePath = join(uiDir, urlPath);

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const content = readFileSync(filePath);
        const ext = filePath.split(".").pop() || "";
        const mimeTypes: Record<string, string> = {
          html: "text/html",
          js: "application/javascript",
          css: "text/css",
          json: "application/json",
          png: "image/png",
          jpg: "image/jpeg",
          svg: "image/svg+xml",
          woff2: "font/woff2",
          webm: "video/webm",
          mp4: "video/mp4",
        };
        return new Response(content, {
          headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
        });
      }

      const indexPath = join(uiDir, "index.html");
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { "Content-Type": "text/html" },
        });
      }

      return c.notFound();
    });
  }

  return app;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/api/static-serving.test.ts`
Expected: ALL PASS

**Step 5: Update `src/index.ts` to pass UI dir**

In the `case "serve"` block, update to pass the UI directory:

```typescript
case "serve": {
  const { createApp } = await import("./api/server");
  const { join } = await import("path");
  const dataDir = args.dataDir ?? ".";
  const uiDir = join(import.meta.dir, "..", "ui", "dist");
  const app = createApp(dataDir, uiDir);
  const port = args.port;
  console.error(`vet server listening on port ${port}`);
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  break;
}
```

**Step 6: Update existing API tests to pass with new signature**

The existing tests call `createApp(dataDir)` with one argument — this should still work since `uiDir` is optional. Run the full test suite to verify:

Run: `bun test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/api/server.ts src/index.ts test/api/static-serving.test.ts
git commit -m "feat: serve built UI assets from Hono with SPA fallback"
```

---

### Task 4: App Shell and Tab Navigation

Build the main layout with header and two-tab navigation (Cards / Runs).

**Files:**
- Create: `ui/src/components/AppShell.tsx`
- Create: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/components/AppShell.tsx`**

```tsx
import type { ReactNode } from "react";

interface AppShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex items-center justify-between border-b border-edge bg-white px-4 py-2">
        <h1 className="heading-display text-lg">vet</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 flex-shrink-0 border-r border-edge bg-white overflow-y-auto">
          {sidebar}
        </aside>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

**Step 2: Create `ui/src/components/Sidebar.tsx`**

```tsx
import type { ReactNode } from "react";

interface SidebarProps {
  tabs: { label: string; path: string }[];
  activeTab: string;
  onTabChange: (path: string) => void;
  action?: ReactNode;
  children: ReactNode;
}

export function Sidebar({ tabs, activeTab, onTabChange, action, children }: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="top-tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            className={activeTab === tab.path ? "active" : ""}
            onClick={() => onTabChange(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {action && (
        <div className="p-3 border-b border-edge">
          {action}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
```

**Step 3: Update `ui/src/App.tsx`**

```tsx
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Sidebar } from "./components/Sidebar";

const TABS = [
  { label: "Cards", path: "/cards" },
  { label: "Runs", path: "/runs" },
];

function CardsPage() {
  return <div className="p-6 text-slate">Select a card from the sidebar</div>;
}

function RunsPage() {
  return <div className="p-6 text-slate">Select a run from the sidebar</div>;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.startsWith("/runs") ? "/runs" : "/cards";

  return (
    <AppShell
      sidebar={
        <Sidebar
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(path) => navigate(path)}
        >
          <div className="p-3 text-sm text-slate">
            {activeTab === "/cards" ? "Loading cards..." : "Loading runs..."}
          </div>
        </Sidebar>
      }
    >
      <Routes>
        <Route path="/" element={<Navigate to="/cards" replace />} />
        <Route path="/cards/*" element={<CardsPage />} />
        <Route path="/runs/*" element={<RunsPage />} />
      </Routes>
    </AppShell>
  );
}
```

**Step 4: Verify UI renders**

Run: `cd ui && bun run dev`
Expected: App shows at `http://localhost:5173/` — header with "vet" in Fraunces, two tabs (Cards/Runs) in sidebar, clicking tabs navigates between them.

Kill dev server after verifying.

**Step 5: Commit**

```bash
git add ui/src/
git commit -m "feat: add app shell with tab navigation"
```

---

### Task 5: API Client Module

Create a typed API client for the frontend to talk to the backend.

**Files:**
- Create: `ui/src/lib/api.ts`

**Step 1: Create `ui/src/lib/api.ts`**

```typescript
export interface CardSummary {
  id: string;
  title: string;
  status: string;
  tags: string[];
}

export interface CardDetail {
  id: string;
  title: string;
  status: string;
  tags: string[];
  parent?: string;
  stakeholder?: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface VetResult {
  scenario: string;
  status: "pass" | "fail" | "investigate";
  summary: string;
  reasoning: string;
  observations: { kind: string; description: string; evidence?: string[] }[];
  evidence: { screenshots: string[]; log: string };
  duration_ms: number;
  usage?: { inputTokens: number; outputTokens: number; turns: number };
}

export interface FanoutResult {
  parent: string;
  generated: { id: string; title: string; filename: string }[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  cards: {
    list: () => request<CardSummary[]>("/scenarios"),
    get: (id: string) => request<CardDetail>(`/scenarios/${id}`),
    update: (id: string, data: Partial<CardDetail>) =>
      request<CardDetail>(`/scenarios/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    approve: (id: string) =>
      request<CardDetail>(`/scenarios/${id}/approve`, { method: "POST" }),
    create: (data: Omit<CardDetail, "acceptanceCriteria"> & { acceptanceCriteria?: string[] }) =>
      request<CardDetail>("/scenarios", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/scenarios/${id}`, { method: "DELETE" }),
  },
  results: {
    list: () => request<VetResult[]>("/results"),
    get: (id: string) => request<VetResult>(`/results/${id}`),
  },
  fanout: {
    generate: (id: string) =>
      request<FanoutResult>(`/fanout/${id}`, { method: "POST" }),
    fromObservations: (id: string) =>
      request<FanoutResult>(`/fanout/${id}/observations`, { method: "POST" }),
    fromFailure: (id: string) =>
      request<FanoutResult>(`/fanout/${id}/failure`, { method: "POST" }),
  },
  run: {
    start: (id: string, body: { target: string; model?: string; adapter?: string; chrome?: string }) =>
      request<VetResult>(`/run/${id}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
};
```

**Step 2: Commit**

```bash
git add ui/src/lib/api.ts
git commit -m "feat: add typed API client module"
```

---

### Task 6: Cards List Sidebar

Fetch and display story cards in the sidebar with filtering.

**Files:**
- Create: `ui/src/components/CardsList.tsx`
- Create: `ui/src/hooks/useCards.ts`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/hooks/useCards.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import { api, type CardSummary } from "../lib/api";

export function useCards() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.cards.list();
      setCards(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cards, loading, error, refresh };
}
```

**Step 2: Create `ui/src/components/CardsList.tsx`**

```tsx
import { useState } from "react";
import type { CardSummary } from "../lib/api";

interface CardsListProps {
  cards: CardSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === "ready"
      ? "bg-teal-wash text-teal-dark"
      : "bg-panel text-slate";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors}`}>
      {status}
    </span>
  );
}

export function CardsList({ cards, selectedId, onSelect }: CardsListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  const allTags = [...new Set(cards.flatMap((c) => c.tags))].sort();

  const filtered = cards.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (tagFilter !== "all" && !c.tags.includes(tagFilter)) return false;
    return true;
  });

  // Group by parent: root cards first, children indented below
  const roots = filtered.filter((c) => !("parent" in c) || !(c as any).parent);
  const children = filtered.filter((c) => (c as any).parent);

  const ordered: { card: CardSummary; indent: boolean }[] = [];
  for (const root of roots) {
    ordered.push({ card: root, indent: false });
    for (const child of children) {
      if ((child as any).parent === root.id) {
        ordered.push({ card: child, indent: true });
      }
    }
  }
  // Orphan children (parent not in filtered set)
  const placedChildIds = new Set(ordered.filter((o) => o.indent).map((o) => o.card.id));
  for (const child of children) {
    if (!placedChildIds.has(child.id)) {
      ordered.push({ card: child, indent: true });
    }
  }

  return (
    <div className="flex flex-col">
      <div className="p-2 border-b border-edge flex gap-1.5">
        <select
          className="input-field !w-auto !p-1 !text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="ready">Ready</option>
        </select>
        {allTags.length > 0 && (
          <select
            className="input-field !w-auto !p-1 !text-xs"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="all">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        {filtered.length === 0 && (
          <div className="p-3 text-sm text-slate">No cards found</div>
        )}
        {ordered.map(({ card, indent }) => (
          <button
            key={card.id}
            className={`w-full text-left px-3 py-2 border-b border-edge-light transition-colors ${
              card.id === selectedId
                ? "bg-teal-wash"
                : "hover:bg-panel"
            } ${indent ? "pl-6" : ""}`}
            onClick={() => onSelect(card.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{card.title}</span>
              <StatusBadge status={card.status} />
            </div>
            <div className="text-xs text-slate mt-0.5">{card.id}</div>
            {card.tags.length > 0 && (
              <div className="flex gap-1 mt-1">
                {card.tags.map((t) => (
                  <span key={t} className="text-xs text-slate bg-panel px-1 rounded">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Update `ui/src/App.tsx` to use CardsList**

Wire the cards list into the sidebar when on the Cards tab. Update the `CardsPage` and sidebar rendering to use `useCards` and `CardsList`. Use `useNavigate` to navigate to `/cards/:id` when a card is selected.

**Step 4: Verify cards list renders**

Run the vet API server with some test data:
```bash
bun run src/index.ts serve --data-dir test/fixtures
```
Then run the Vite dev server:
```bash
cd ui && bun run dev
```
Expected: Cards tab shows the story cards from `test/fixtures/stories/`, filterable by status and tags. Clicking a card navigates to `/cards/:id`.

Kill both servers after verifying.

**Step 5: Commit**

```bash
git add ui/src/
git commit -m "feat: add cards list sidebar with filtering"
```

---

### Task 7: Card Detail and Editor

Display and edit a selected story card.

**Files:**
- Create: `ui/src/components/CardEditor.tsx`
- Create: `ui/src/hooks/useCard.ts`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/hooks/useCard.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import { api, type CardDetail } from "../lib/api";

export function useCard(id: string | undefined) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) {
      setCard(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.cards.get(id);
      setCard(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load card");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { card, loading, error, refresh, setCard };
}
```

**Step 2: Create `ui/src/components/CardEditor.tsx`**

```tsx
import { useState, useEffect } from "react";
import type { CardDetail } from "../lib/api";
import { api } from "../lib/api";

interface CardEditorProps {
  card: CardDetail;
  onSave: () => void;
  onDelete: () => void;
}

export function CardEditor({ card, onSave, onDelete }: CardEditorProps) {
  const [title, setTitle] = useState(card.title);
  const [status, setStatus] = useState(card.status);
  const [tags, setTags] = useState(card.tags.join(", "));
  const [stakeholder, setStakeholder] = useState(card.stakeholder || "");
  const [description, setDescription] = useState(card.description);
  const [criteria, setCriteria] = useState(card.acceptanceCriteria.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(card.title);
    setStatus(card.status);
    setTags(card.tags.join(", "));
    setStakeholder(card.stakeholder || "");
    setDescription(card.description);
    setCriteria(card.acceptanceCriteria.join("\n"));
    setError(null);
  }, [card]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await api.cards.update(card.id, {
        title,
        status,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        stakeholder: stakeholder || undefined,
        description,
        acceptanceCriteria: criteria.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    try {
      setSaving(true);
      setError(null);
      await api.cards.approve(card.id);
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete card "${card.id}"?`)) return;
    try {
      await api.cards.delete(card.id);
      onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="heading-display text-xl">{card.id}</h2>
        <div className="flex gap-2">
          {card.status === "draft" && (
            <button className="btn-primary" onClick={handleApprove} disabled={saving}>
              Approve
            </button>
          )}
          <button className="btn-danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-2 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="section-label block mb-1">Title</label>
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="section-label block mb-1">Status</label>
            <select
              className="input-field"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="section-label block mb-1">Tags (comma-separated)</label>
            <input
              className="input-field"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="section-label block mb-1">Stakeholder</label>
          <input
            className="input-field"
            value={stakeholder}
            onChange={(e) => setStakeholder(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="section-label block mb-1">Description</label>
          <textarea
            className="input-field min-h-32"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="section-label block mb-1">Acceptance Criteria (one per line)</label>
          <textarea
            className="input-field min-h-24"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="Each line becomes a criterion"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Update `ui/src/App.tsx`**

Add a route for `/cards/:id` that loads and displays the `CardEditor`. When no card is selected, show "Select a card from the sidebar" placeholder.

**Step 4: Verify card editing works**

Start both servers (vet API + Vite dev), select a card, edit fields, save. Verify the saved data persists by reloading.

**Step 5: Commit**

```bash
git add ui/src/
git commit -m "feat: add card detail view with editor"
```

---

### Task 8: Card Create and Delete API Routes

The UI needs POST (create) and DELETE endpoints that don't exist yet on the API.

**Files:**
- Modify: `src/api/routes/scenarios.ts`
- Modify: `test/api/scenarios.test.ts`

**Step 1: Write the failing tests**

Add to `test/api/scenarios.test.ts`:

```typescript
test("POST /api/scenarios creates a new card", async () => {
  const res = await app.request("/api/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "new-card",
      title: "New card",
      status: "draft",
      tags: ["test"],
      description: "A new card",
      acceptanceCriteria: ["Works correctly"],
    }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  expect(data.id).toBe("new-card");
  expect(data.title).toBe("New card");

  // Verify persisted
  const getRes = await app.request("/api/scenarios/new-card");
  expect(getRes.status).toBe(200);
});

test("POST /api/scenarios returns 400 for missing id", async () => {
  const res = await app.request("/api/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "No id" }),
  });
  expect(res.status).toBe(400);
});

test("POST /api/scenarios returns 409 for duplicate id", async () => {
  const res = await app.request("/api/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "story-001",
      title: "Duplicate",
      description: "",
      acceptanceCriteria: [],
    }),
  });
  expect(res.status).toBe(409);
});

test("DELETE /api/scenarios/:id deletes a card", async () => {
  const res = await app.request("/api/scenarios/story-001", {
    method: "DELETE",
  });
  expect(res.status).toBe(200);

  const getRes = await app.request("/api/scenarios/story-001");
  expect(getRes.status).toBe(404);
});

test("DELETE /api/scenarios/:id returns 404 for unknown card", async () => {
  const res = await app.request("/api/scenarios/nonexistent", {
    method: "DELETE",
  });
  expect(res.status).toBe(404);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test test/api/scenarios.test.ts`
Expected: New tests FAIL (405 or 404)

**Step 3: Add POST and DELETE routes to `src/api/routes/scenarios.ts`**

Add after the existing `router.post("/:id/approve", ...)`:

```typescript
router.post("/", async (c) => {
  const body = await c.req.json();
  const { id, title } = body;
  if (!id || !title) return c.json({ error: "id and title are required" }, 400);

  const existing = findCard(storiesDir, id);
  if (existing) return c.json({ error: "card already exists" }, 409);

  const card: StoryCard = {
    id,
    title,
    status: body.status || "draft",
    tags: body.tags || [],
    parent: body.parent || undefined,
    stakeholder: body.stakeholder || undefined,
    description: body.description || "",
    acceptanceCriteria: body.acceptanceCriteria || [],
    raw: "",
  };
  card.raw = serializeStoryCard(card);

  mkdirSync(storiesDir, { recursive: true });
  writeFileSync(join(storiesDir, `${id}.md`), card.raw);

  const { raw: _raw, ...rest } = card;
  return c.json(rest, 201);
});

router.delete("/:id", (c) => {
  const entry = findCard(storiesDir, c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);

  unlinkSync(join(storiesDir, entry.filename));
  return c.json({ deleted: entry.card.id });
});
```

Add `mkdirSync` and `unlinkSync` to the imports from `"fs"`.

**Step 4: Run tests to verify they pass**

Run: `bun test test/api/scenarios.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/api/routes/scenarios.ts test/api/scenarios.test.ts
git commit -m "feat: add POST and DELETE endpoints for story cards"
```

---

### Task 9: New Card Form in UI

Add a "New Card" button and form to create cards from the UI.

**Files:**
- Create: `ui/src/components/NewCardForm.tsx`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/components/NewCardForm.tsx`**

```tsx
import { useState } from "react";
import { api } from "../lib/api";

interface NewCardFormProps {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function NewCardForm({ onCreated, onCancel }: NewCardFormProps) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!id || !title) {
      setError("ID and title are required");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await api.cards.create({
        id,
        title,
        status: "draft",
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        description,
        acceptanceCriteria: criteria.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create card");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="heading-display text-xl mb-4">New Story Card</h2>

      {error && (
        <div className="mb-4 p-2 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="section-label block mb-1">ID</label>
            <input
              className="input-field"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. login-happy-path"
            />
          </div>
          <div className="flex-1">
            <label className="section-label block mb-1">Title</label>
            <input
              className="input-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="section-label block mb-1">Tags (comma-separated)</label>
          <input
            className="input-field"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div>
          <label className="section-label block mb-1">Description</label>
          <textarea
            className="input-field min-h-32"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="section-label block mb-1">Acceptance Criteria (one per line)</label>
          <textarea
            className="input-field min-h-24"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Creating..." : "Create Card"}
          </button>
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Wire into App.tsx**

Add "New Card" button in the sidebar action slot. When clicked, navigate to `/cards/new`. Add a route for `/cards/new` that renders `NewCardForm`. On create, navigate to `/cards/:id` and refresh the cards list.

**Step 3: Verify**

Start both servers, click "New Card", fill in fields, create. Verify card appears in sidebar and is editable.

**Step 4: Commit**

```bash
git add ui/src/
git commit -m "feat: add new card creation form"
```

---

### Task 10: Fanout Action on Cards

Add a "Fanout" button to the card editor that triggers variation generation.

**Files:**
- Modify: `ui/src/components/CardEditor.tsx`

**Step 1: Add fanout button and handler**

Add to `CardEditor` after the Approve button:

```tsx
const [fanning, setFanning] = useState(false);

const handleFanout = async () => {
  try {
    setFanning(true);
    setError(null);
    const result = await api.fanout.generate(card.id);
    onSave(); // refresh card list to show new cards
    alert(`Generated ${result.generated.length} variations`);
  } catch (e) {
    setError(e instanceof Error ? e.message : "Fanout failed");
  } finally {
    setFanning(false);
  }
};
```

Add the button in the action bar:
```tsx
<button className="btn-secondary" onClick={handleFanout} disabled={fanning}>
  {fanning ? "Generating..." : "Fanout"}
</button>
```

**Step 2: Verify**

Start both servers with a model configured (`VET_FANOUT_MODEL=...`). Click Fanout on a card. Verify new variation cards appear in the sidebar.

**Step 3: Commit**

```bash
git add ui/src/components/CardEditor.tsx
git commit -m "feat: add fanout action to card editor"
```

---

### Task 11: Runs List and Results Display

Build the Runs tab — list runs and display completed run details.

**Files:**
- Create: `ui/src/components/RunsList.tsx`
- Create: `ui/src/components/RunDetail.tsx`
- Create: `ui/src/hooks/useResults.ts`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/hooks/useResults.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import { api, type VetResult } from "../lib/api";

export function useResults() {
  const [results, setResults] = useState<VetResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.results.list();
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load results");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { results, loading, error, refresh };
}
```

**Step 2: Create `ui/src/components/RunsList.tsx`**

```tsx
import type { VetResult } from "../lib/api";

interface RunsListProps {
  results: VetResult[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pass: "bg-green-100 text-green-800",
    fail: "bg-red-100 text-red-800",
    investigate: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[status] || "bg-panel text-slate"}`}>
      {status}
    </span>
  );
}

export function RunsList({ results, selectedId, onSelect }: RunsListProps) {
  return (
    <div>
      {results.length === 0 && (
        <div className="p-3 text-sm text-slate">No runs yet</div>
      )}
      {results.map((r) => (
        <button
          key={r.scenario}
          className={`w-full text-left px-3 py-2 border-b border-edge-light transition-colors ${
            r.scenario === selectedId ? "bg-teal-wash" : "hover:bg-panel"
          }`}
          onClick={() => onSelect(r.scenario)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{r.scenario}</span>
            <StatusBadge status={r.status} />
          </div>
          <div className="text-xs text-slate mt-0.5">
            {Math.round(r.duration_ms / 1000)}s
            {r.observations.length > 0 && ` · ${r.observations.length} observations`}
          </div>
        </button>
      ))}
    </div>
  );
}
```

**Step 3: Create `ui/src/components/RunDetail.tsx`**

```tsx
import type { VetResult } from "../lib/api";
import { api } from "../lib/api";
import { useState } from "react";

interface RunDetailProps {
  result: VetResult;
  onFanout: () => void;
}

export function RunDetail({ result, onFanout }: RunDetailProps) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleObservationFanout = async () => {
    try {
      setActing(true);
      setError(null);
      const res = await api.fanout.fromObservations(result.scenario);
      onFanout();
      alert(`Generated ${res.generated.length} cards from observations`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  };

  const handleFailureFanout = async () => {
    try {
      setActing(true);
      setError(null);
      const res = await api.fanout.fromFailure(result.scenario);
      onFanout();
      alert(`Generated ${res.generated.length} cards from failure analysis`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="heading-display text-xl">{result.scenario}</h2>
        <span className={`text-sm px-2 py-1 rounded ${
          result.status === "pass" ? "bg-green-100 text-green-800" :
          result.status === "fail" ? "bg-red-100 text-red-800" :
          "bg-yellow-100 text-yellow-800"
        }`}>
          {result.status}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-2 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {error}
        </div>
      )}

      <div className="card p-4 mb-4">
        <h3 className="section-label mb-2">Summary</h3>
        <p className="text-sm">{result.summary}</p>
      </div>

      <div className="card p-4 mb-4">
        <h3 className="section-label mb-2">Reasoning</h3>
        <p className="text-sm whitespace-pre-wrap">{result.reasoning}</p>
      </div>

      {result.observations.length > 0 && (
        <div className="card p-4 mb-4">
          <h3 className="section-label mb-2">Observations ({result.observations.length})</h3>
          <ul className="space-y-2">
            {result.observations.map((obs, i) => (
              <li key={i} className="text-sm">
                <span className="text-xs px-1.5 py-0.5 rounded bg-panel text-slate mr-2">
                  {obs.kind}
                </span>
                {obs.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.evidence.screenshots.length > 0 && (
        <div className="card p-4 mb-4">
          <h3 className="section-label mb-2">Screenshots</h3>
          <div className="grid grid-cols-2 gap-2">
            {result.evidence.screenshots.map((src, i) => (
              <img
                key={i}
                src={`/api/results/${result.scenario}/screenshots/${src}`}
                alt={`Screenshot ${i + 1}`}
                className="rounded border border-edge"
              />
            ))}
          </div>
        </div>
      )}

      {result.usage && (
        <div className="card p-4 mb-4">
          <h3 className="section-label mb-2">Usage</h3>
          <div className="text-sm text-slate">
            {result.usage.inputTokens} input / {result.usage.outputTokens} output · {result.usage.turns} turns · {Math.round(result.duration_ms / 1000)}s
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        {result.observations.length > 0 && (
          <button className="btn-secondary" onClick={handleObservationFanout} disabled={acting}>
            Generate from Observations
          </button>
        )}
        {result.status === "fail" && (
          <button className="btn-secondary" onClick={handleFailureFanout} disabled={acting}>
            Analyze Failure
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Wire into App.tsx**

Update the Runs tab section to use `useResults`, `RunsList` in sidebar, and `RunDetail` in the main area. Add routes for `/runs` and `/runs/:id`.

**Step 5: Add screenshot serving to results API**

The `RunDetail` references `/api/results/:id/screenshots/:name`. Add this route to `src/api/routes/results.ts`:

```typescript
router.get("/:scenario/screenshots/:name", (c) => {
  const scenario = c.req.param("scenario");
  const name = c.req.param("name");
  const filePath = join(resultsDir, scenario, name);

  if (!existsSync(filePath)) {
    return c.json({ error: "not found" }, 404);
  }

  const content = readFileSync(filePath);
  const ext = name.split(".").pop() || "png";
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return new Response(content, {
    headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
  });
});
```

**Step 6: Add screenshot route test**

Add to `test/api/results.test.ts`:

```typescript
test("GET /api/results/:scenario/screenshots/:name serves image", async () => {
  // Write a fake PNG file
  writeFileSync(join(resultsDir, "story-001", "evidence.png"), "fake-png-data");

  const res = await app.request("/api/results/story-001/screenshots/evidence.png");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");
});

test("GET /api/results/:scenario/screenshots/:name returns 404", async () => {
  const res = await app.request("/api/results/story-001/screenshots/nope.png");
  expect(res.status).toBe(404);
});
```

**Step 7: Run tests**

Run: `bun test`
Expected: ALL PASS

**Step 8: Verify**

Start both servers with result data. Click Runs tab, select a result, see detail view with summary, reasoning, observations, and screenshots.

**Step 9: Commit**

```bash
git add ui/src/ src/api/routes/results.ts test/api/results.test.ts
git commit -m "feat: add runs list and result detail view"
```

---

### Task 12: New Run Modal

Add a modal to start a new test run from the Runs tab.

**Files:**
- Create: `ui/src/components/NewRunModal.tsx`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/components/NewRunModal.tsx`**

```tsx
import { useState, useEffect } from "react";
import { api, type CardSummary } from "../lib/api";

interface NewRunModalProps {
  onClose: () => void;
  onStarted: (scenarioId: string) => void;
}

export function NewRunModal({ onClose, onStarted }: NewRunModalProps) {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [selectedCard, setSelectedCard] = useState("");
  const [target, setTarget] = useState("");
  const [model, setModel] = useState("");
  const [chrome, setChrome] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.cards.list().then(setCards);
  }, []);

  const handleStart = async () => {
    if (!selectedCard || !target) {
      setError("Card and target URL are required");
      return;
    }
    try {
      setStarting(true);
      setError(null);
      onStarted(selectedCard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run");
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="card p-6 w-full max-w-md">
        <h2 className="heading-display text-lg mb-4">New Run</h2>

        {error && (
          <div className="mb-4 p-2 rounded bg-red-50 text-red-700 text-sm border border-red-200">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="section-label block mb-1">Story Card</label>
            <select
              className="input-field"
              value={selectedCard}
              onChange={(e) => setSelectedCard(e.target.value)}
            >
              <option value="">Select a card...</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="section-label block mb-1">Target URL</label>
            <input
              className="input-field"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>

          <div>
            <label className="section-label block mb-1">Model (optional, falls back to env)</label>
            <input
              className="input-field"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. anthropic:claude-sonnet-4-20250514"
            />
          </div>

          <div>
            <label className="section-label block mb-1">Chrome endpoint (optional)</label>
            <input
              className="input-field"
              value={chrome}
              onChange={(e) => setChrome(e.target.value)}
              placeholder="e.g. http://localhost:9222"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleStart} disabled={starting}>
            {starting ? "Starting..." : "Start Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Wire into the Runs tab**

Add "New Run" button in the sidebar action slot for the Runs tab. When clicked, show the `NewRunModal`. On start, navigate to the live run view (Task 14).

**Step 3: Verify**

Start both servers, click "New Run" in Runs tab, see modal with card selector and target input.

**Step 4: Commit**

```bash
git add ui/src/
git commit -m "feat: add new run modal"
```

---

### Task 13: WebSocket Infrastructure

Add a WebSocket endpoint to the Hono server for streaming run progress and CDP frames.

**Files:**
- Create: `src/api/ws.ts`
- Modify: `src/index.ts`
- Create: `test/api/ws.test.ts`

**Step 1: Write the failing test**

Create `test/api/ws.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { RunBroadcaster } from "../../src/api/ws";

describe("RunBroadcaster", () => {
  test("broadcasts messages to all connected clients", () => {
    const broadcaster = new RunBroadcaster();
    const received: string[] = [];

    // Simulate two connected clients
    const fakeWs1 = {
      send: (data: string) => received.push(`ws1:${data}`),
      readyState: 1, // OPEN
    };
    const fakeWs2 = {
      send: (data: string) => received.push(`ws2:${data}`),
      readyState: 1,
    };

    broadcaster.addClient("run-1", fakeWs1 as any);
    broadcaster.addClient("run-1", fakeWs2 as any);

    broadcaster.send("run-1", { type: "progress", message: "hello" });

    expect(received).toEqual([
      'ws1:{"type":"progress","message":"hello"}',
      'ws2:{"type":"progress","message":"hello"}',
    ]);
  });

  test("removes closed clients", () => {
    const broadcaster = new RunBroadcaster();
    const received: string[] = [];

    const fakeWs = {
      send: (data: string) => received.push(data),
      readyState: 3, // CLOSED
    };

    broadcaster.addClient("run-1", fakeWs as any);
    broadcaster.send("run-1", { type: "progress", message: "hello" });

    expect(received).toEqual([]);
  });

  test("different run IDs are isolated", () => {
    const broadcaster = new RunBroadcaster();
    const received: string[] = [];

    const ws1 = { send: (d: string) => received.push(`1:${d}`), readyState: 1 };
    const ws2 = { send: (d: string) => received.push(`2:${d}`), readyState: 1 };

    broadcaster.addClient("run-a", ws1 as any);
    broadcaster.addClient("run-b", ws2 as any);

    broadcaster.send("run-a", { type: "frame", data: "abc" });

    expect(received).toEqual(['1:{"type":"frame","data":"abc"}']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/ws.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Create `src/api/ws.ts`**

```typescript
interface WsLike {
  send(data: string): void;
  readyState: number;
}

export class RunBroadcaster {
  private clients = new Map<string, Set<WsLike>>();

  addClient(runId: string, ws: WsLike) {
    if (!this.clients.has(runId)) {
      this.clients.set(runId, new Set());
    }
    this.clients.get(runId)!.add(ws);
  }

  removeClient(runId: string, ws: WsLike) {
    this.clients.get(runId)?.delete(ws);
  }

  send(runId: string, message: Record<string, unknown>) {
    const clients = this.clients.get(runId);
    if (!clients) return;

    const data = JSON.stringify(message);
    for (const ws of clients) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(data);
      } else {
        clients.delete(ws);
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/api/ws.test.ts`
Expected: ALL PASS

**Step 5: Update `src/index.ts` to handle WebSocket upgrades**

Update the `case "serve"` block to handle WebSocket connections:

```typescript
case "serve": {
  const { createApp } = await import("./api/server");
  const { RunBroadcaster } = await import("./api/ws");
  const { join } = await import("path");
  const dataDir = args.dataDir ?? ".";
  const uiDir = join(import.meta.dir, "..", "ui", "dist");
  const broadcaster = new RunBroadcaster();
  const app = createApp(dataDir, uiDir, broadcaster);
  const port = args.port;
  console.error(`vet server listening on port ${port}`);
  Bun.serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/api/ws") {
        const runId = url.searchParams.get("run") || "";
        const upgraded = server.upgrade(req, { data: { runId } });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: {
      open(ws) {
        const runId = (ws.data as any).runId;
        if (runId) broadcaster.addClient(runId, ws as any);
      },
      close(ws) {
        const runId = (ws.data as any).runId;
        if (runId) broadcaster.removeClient(runId, ws as any);
      },
      message() {},
    },
  });
  break;
}
```

**Step 6: Update `createApp` to accept broadcaster**

In `src/api/server.ts`, add `broadcaster` as an optional third parameter and pass it to `runRoutes`:

```typescript
export function createApp(dataDir: string, uiDir?: string, broadcaster?: RunBroadcaster) {
```

This will be used in Task 14 when we integrate CDP streaming.

**Step 7: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/api/ws.ts src/api/server.ts src/index.ts test/api/ws.test.ts
git commit -m "feat: add WebSocket infrastructure for run streaming"
```

---

### Task 14: CDP Screencast Integration

Add CDP screencast capture to the run endpoint and stream frames over WebSocket.

**Files:**
- Create: `src/streaming/screencast.ts`
- Modify: `src/api/routes/run.ts`
- Create: `test/streaming/screencast.test.ts`

**Step 1: Write the failing test**

Create `test/streaming/screencast.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { ScreencastStreamer } from "../../src/streaming/screencast";

describe("ScreencastStreamer", () => {
  test("sends frames to broadcast callback", async () => {
    const frames: any[] = [];
    const fakeCdpSession = {
      send: async (method: string, params?: any) => {},
      on: (event: string, cb: (data: any) => void) => {
        if (event === "Page.screencastFrame") {
          // Simulate a frame arriving
          setTimeout(() => {
            cb({ data: "base64data", metadata: { width: 1280 }, sessionId: 1 });
          }, 10);
        }
      },
    };

    const streamer = new ScreencastStreamer(fakeCdpSession as any, (frame) => {
      frames.push(frame);
    });

    await streamer.start();
    await new Promise((r) => setTimeout(r, 50));
    await streamer.stop();

    expect(frames.length).toBe(1);
    expect(frames[0].data).toBe("base64data");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/streaming/screencast.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Create `src/streaming/screencast.ts`**

```typescript
interface CDPSession {
  send(method: string, params?: Record<string, unknown>): Promise<void>;
  on(event: string, callback: (data: any) => void): void;
}

export interface ScreencastFrame {
  data: string; // base64 jpeg
  metadata: { width: number; height: number };
}

export class ScreencastStreamer {
  private session: CDPSession;
  private onFrame: (frame: ScreencastFrame) => void;
  private running = false;

  constructor(session: CDPSession, onFrame: (frame: ScreencastFrame) => void) {
    this.session = session;
    this.onFrame = onFrame;
  }

  async start(options?: { quality?: number; maxWidth?: number; maxHeight?: number }) {
    this.running = true;

    this.session.on("Page.screencastFrame", async (event: any) => {
      if (!this.running) return;

      this.onFrame({
        data: event.data,
        metadata: {
          width: event.metadata?.deviceWidth || event.metadata?.width || 0,
          height: event.metadata?.deviceHeight || event.metadata?.height || 0,
        },
      });

      await this.session.send("Page.screencastFrameAck", {
        sessionId: event.sessionId,
      });
    });

    await this.session.send("Page.startScreencast", {
      format: "jpeg",
      quality: options?.quality ?? 70,
      maxWidth: options?.maxWidth ?? 1280,
      maxHeight: options?.maxHeight ?? 720,
      everyNthFrame: 2,
    });
  }

  async stop() {
    this.running = false;
    try {
      await this.session.send("Page.stopScreencast");
    } catch {
      // Ignore errors when stopping
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/streaming/screencast.test.ts`
Expected: ALL PASS

**Step 5: Integrate with run route**

Modify `src/api/routes/run.ts` to accept a `RunBroadcaster` and stream screencast frames during execution. The integration point is after the adapter starts and before `runAgent` — get a CDP session from the web adapter's page, create a `ScreencastStreamer`, and pipe frames through the broadcaster.

This requires the web adapter to expose its Playwright page. Check the adapter interface:

```typescript
// In runRoutes, after adapter.start(target):
if (adapterType === "web" && broadcaster) {
  const page = (adapter as any).page; // WebAdapter must expose this
  if (page) {
    const cdpSession = await page.context().newCDPSession(page);
    const streamer = new ScreencastStreamer(cdpSession, (frame) => {
      broadcaster.send(entry.card.id, {
        type: "frame",
        data: frame.data,
        width: frame.metadata.width,
        height: frame.metadata.height,
      });
    });
    await streamer.start();
    // Store for cleanup
  }
}
```

The exact integration depends on how `WebAdapter` exposes its page. If it doesn't currently expose it, add a `page` getter.

**Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/streaming/ src/api/routes/run.ts test/streaming/
git commit -m "feat: add CDP screencast streaming during test runs"
```

---

### Task 15: Live Run View in UI

Build the frontend component that shows the live CDP stream and LLM progress.

**Files:**
- Create: `ui/src/components/LiveRun.tsx`
- Create: `ui/src/hooks/useRunStream.ts`
- Modify: `ui/src/App.tsx`

**Step 1: Create `ui/src/hooks/useRunStream.ts`**

```typescript
import { useState, useEffect, useRef, useCallback } from "react";

interface RunMessage {
  type: "frame" | "progress" | "complete";
  data?: string;
  width?: number;
  height?: number;
  message?: string;
  status?: string;
  result?: any;
}

export function useRunStream(runId: string | null) {
  const [frame, setFrame] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!runId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?run=${runId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg: RunMessage = JSON.parse(event.data);
      switch (msg.type) {
        case "frame":
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          break;
        case "progress":
          setMessages((prev) => [...prev, msg.message || ""]);
          break;
        case "complete":
          setResult(msg.result);
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId]);

  return { frame, messages, result, connected };
}
```

**Step 2: Create `ui/src/components/LiveRun.tsx`**

```tsx
import { useRunStream } from "../hooks/useRunStream";
import { useEffect, useRef } from "react";

interface LiveRunProps {
  runId: string;
  cardTitle: string;
  onComplete: () => void;
}

export function LiveRun({ runId, cardTitle, onComplete }: LiveRunProps) {
  const { frame, messages, result, connected } = useRunStream(runId);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (result) {
      onComplete();
    }
  }, [result, onComplete]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-edge bg-white">
        <div>
          <h2 className="heading-display text-lg">{cardTitle}</h2>
          <span className={`text-xs ${connected ? "text-teal" : "text-slate"}`}>
            {connected ? "Connected" : "Connecting..."}
          </span>
        </div>
        {result && (
          <span className={`text-sm px-2 py-1 rounded ${
            result.status === "pass" ? "bg-green-100 text-green-800" :
            result.status === "fail" ? "bg-red-100 text-red-800" :
            "bg-yellow-100 text-yellow-800"
          }`}>
            {result.status}
          </span>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Browser viewport */}
        <div className="flex-1 bg-ink flex items-center justify-center p-2 min-h-0">
          {frame ? (
            <img
              src={frame}
              alt="Browser view"
              className="max-w-full max-h-full object-contain rounded"
            />
          ) : (
            <div className="text-slate text-sm">Waiting for browser...</div>
          )}
        </div>

        {/* LLM output log */}
        <div
          ref={logRef}
          className="h-48 flex-shrink-0 overflow-y-auto border-t border-edge bg-white p-3 font-mono text-xs"
        >
          {messages.length === 0 && (
            <div className="text-slate">Waiting for output...</div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className="text-ink-light whitespace-pre-wrap">
              {msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Wire into App.tsx**

When a run is started from `NewRunModal`, transition to a live run view:
1. Call `api.run.start(...)` (this returns a promise that resolves when the run completes)
2. Simultaneously display the `LiveRun` component connected via WebSocket
3. When the run completes, refresh results and show the result detail

**Step 4: Verify**

This requires a full integration test with a running browser. Start the vet server, start a run against a real target, and verify the live view shows browser frames and LLM output.

**Step 5: Commit**

```bash
git add ui/src/
git commit -m "feat: add live run view with CDP screencast stream"
```

---

### Task 16: Video Recording

Enable Playwright video recording and serve recorded videos through the API.

**Files:**
- Modify: `src/adapters/web/adapter.ts` (or wherever WebAdapter creates browser context)
- Modify: `src/api/routes/results.ts`
- Create: `test/api/video-serving.test.ts`

**Step 1: Write the failing test for video serving**

Create `test/api/video-serving.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/api/server";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Video serving", () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-video-"));
    const resultsDir = join(dataDir, "results", "test-run");
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, "result.json"), JSON.stringify({ scenario: "test-run", status: "pass" }));
    writeFileSync(join(resultsDir, "video.webm"), "fake-video-data");
    app = createApp(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("GET /api/results/:id/video serves video file", async () => {
    const res = await app.request("/api/results/test-run/video");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/webm");
  });

  test("GET /api/results/:id/video returns 404 when no video", async () => {
    const noVideoDir = join(dataDir, "results", "no-video");
    mkdirSync(noVideoDir, { recursive: true });
    writeFileSync(join(noVideoDir, "result.json"), JSON.stringify({ scenario: "no-video", status: "pass" }));

    const res = await app.request("/api/results/no-video/video");
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/video-serving.test.ts`
Expected: FAIL — route doesn't exist

**Step 3: Add video route to `src/api/routes/results.ts`**

```typescript
router.get("/:scenario/video", (c) => {
  const scenario = c.req.param("scenario");

  // Try common video extensions
  for (const ext of ["webm", "mp4"]) {
    const videoPath = join(resultsDir, scenario, `video.${ext}`);
    if (existsSync(videoPath)) {
      const content = readFileSync(videoPath);
      return new Response(content, {
        headers: { "Content-Type": `video/${ext}` },
      });
    }
  }

  return c.json({ error: "no video found" }, 404);
});
```

**Step 4: Run test to verify it passes**

Run: `bun test test/api/video-serving.test.ts`
Expected: ALL PASS

**Step 5: Enable video recording in WebAdapter**

Check the WebAdapter source to understand how it creates a browser context. Add `recordVideo` to the context options:

```typescript
// In WebAdapter, when creating context:
const context = await browser.newContext({
  recordVideo: {
    dir: this.videoDir, // Pass video output directory
    size: { width: 1280, height: 720 },
  },
});
```

The `videoDir` should be set when the run endpoint creates the adapter. Pass the results output directory so the video is saved alongside `result.json`.

**Important:** After the page closes, Playwright finishes writing the video file. You may need to call `await page.video()?.saveAs(path)` or `await context.close()` to ensure the video is fully written.

**Step 6: Update RunDetail component to show video**

In `ui/src/components/RunDetail.tsx`, add a video player at the top:

```tsx
{/* Video player */}
<div className="mb-4">
  <video
    controls
    className="w-full rounded border border-edge"
    src={`/api/results/${result.scenario}/video`}
    onError={(e) => {
      // Hide if no video exists
      (e.target as HTMLVideoElement).style.display = "none";
    }}
  />
</div>
```

**Step 7: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/adapters/web/ src/api/routes/results.ts ui/src/components/RunDetail.tsx test/api/video-serving.test.ts
git commit -m "feat: add video recording and playback"
```

---

### Task 17: LLM Progress Streaming

Stream LLM tool calls and messages through the WebSocket during runs.

**Files:**
- Modify: `src/api/routes/run.ts`
- Modify: `src/api/ws.ts` (if needed)

**Step 1: Update the run route to broadcast LLM progress**

The `EvidenceLogger` or `runAgent` likely has hooks or callbacks for progress. Add broadcasting of LLM activity:

```typescript
// In the run route, after starting screencast:
const originalLog = logger.log.bind(logger);
logger.log = (message: string) => {
  originalLog(message);
  if (broadcaster) {
    broadcaster.send(entry.card.id, {
      type: "progress",
      message,
      status: "running",
      card: entry.card.id,
    });
  }
};
```

The exact integration depends on how `EvidenceLogger` and `runAgent` emit events. Check the logger interface and find the right hook point. The goal: every tool call, tool result, and LLM response gets sent as a `progress` message over WebSocket.

After `runAgent` completes, send the completion message:

```typescript
broadcaster.send(entry.card.id, {
  type: "complete",
  result,
});
```

**Step 2: Verify**

Start a run through the UI with WebSocket connected. Verify progress messages appear in the log panel below the browser viewport.

**Step 3: Commit**

```bash
git add src/api/routes/run.ts
git commit -m "feat: stream LLM progress over WebSocket during runs"
```

---

### Task 18: Polish and Integration Testing

Final polish — ensure all pieces work together end-to-end.

**Files:**
- Modify: `ui/src/App.tsx` (final wiring)
- Modify: `ui/src/app.css` (any remaining style fixes)

**Step 1: Build the UI**

Run: `cd ui && bun run build`
Expected: Builds successfully to `ui/dist/`

**Step 2: Start the server with built UI**

Run: `bun run src/index.ts serve --data-dir test/fixtures --port 3000`
Expected: Server starts, visit `http://localhost:3000/` — see the full UI served from Hono.

**Step 3: Verify Cards tab**

- Cards load in sidebar
- Click a card — see detail/editor
- Edit and save a card — changes persist
- Create a new card — appears in sidebar
- Delete a card — removed from sidebar
- Filter by status/tags works

**Step 4: Verify Runs tab**

- Previous run results show in sidebar
- Click a result — see detail with summary, observations, screenshots
- Video player shows if video exists

**Step 5: Verify live run (requires real browser + LLM)**

- Click "New Run", select a card, enter target and model
- See live CDP stream in browser viewport
- See LLM progress in log panel
- On completion, result appears in runs list

**Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add .
git commit -m "feat: polish and verify vet web UI integration"
```
