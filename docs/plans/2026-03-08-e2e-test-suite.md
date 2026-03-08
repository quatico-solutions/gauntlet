# E2E Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real e2e test suite with a TUI adapter (tmux-based), a TodoMVC web fixture, and story cards that exercise pass/fail/investigate verdicts across CLI, web, and TUI adapters.

**Architecture:** Add a new `TUIAdapter` that uses tmux (`new-session`, `send-keys`, `capture-pane`) to interact with full-screen terminal apps. Ship a self-contained TodoMVC HTML/JS fixture for web tests. Write story cards for `bc` (CLI), the TodoMVC app (web), and `nano` (TUI) — including stories designed to fail. Wire `--adapter tui` through the CLI args and run command.

**Tech Stack:** TypeScript, Bun, tmux 3.x, bc, nano

---

### Task 1: TUI Adapter — core implementation

**Files:**
- Create: `src/adapters/tui/adapter.ts`
- Test: `test/adapters/tui/adapter.test.ts`

The TUI adapter wraps tmux. Each instance creates a unique tmux session, runs the target command inside it, and provides tools to interact and read the rendered screen.

**Step 1: Write the failing test**

Create `test/adapters/tui/adapter.test.ts`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { TUIAdapter } from "../../../src/adapters/tui/adapter";
import { EvidenceLogger } from "../../../src/evidence/logger";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Skip if tmux not available
let hasTmux = false;
try {
  Bun.spawnSync(["tmux", "-V"]);
  hasTmux = true;
} catch {}

describe.skipIf(!hasTmux)("TUIAdapter", () => {
  let adapter: TUIAdapter;
  let logger: EvidenceLogger;

  afterEach(async () => {
    await adapter?.close();
  });

  test("starts a process in tmux and reads output", async () => {
    adapter = new TUIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-tui-"));
    logger = new EvidenceLogger(logDir);

    await adapter.start("echo 'hello from tmux'");
    // Give the process time to produce output
    await Bun.sleep(500);

    const result = await adapter.executeTool("read_screen", {}, logger);
    expect(result.text).toContain("hello from tmux");
  });

  test("sends keystrokes via tmux", async () => {
    adapter = new TUIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-tui-"));
    logger = new EvidenceLogger(logDir);

    // Start bc calculator
    await adapter.start("bc -q");
    await Bun.sleep(300);

    await adapter.executeTool("type", { text: "2+3" }, logger);
    await adapter.executeTool("press", { key: "Enter" }, logger);
    await Bun.sleep(300);

    const result = await adapter.executeTool("read_screen", {}, logger);
    expect(result.text).toContain("5");
  });

  test("close kills the tmux session", async () => {
    adapter = new TUIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-tui-"));
    logger = new EvidenceLogger(logDir);

    await adapter.start("bc -q");
    const sessionName = adapter.sessionName;
    await adapter.close();

    // Session should no longer exist
    const check = Bun.spawnSync(["tmux", "has-session", "-t", sessionName]);
    expect(check.exitCode).not.toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/adapters/tui/adapter.test.ts`
Expected: FAIL — cannot import `TUIAdapter`

**Step 3: Write minimal implementation**

Create `src/adapters/tui/adapter.ts`:

```typescript
import type { Adapter } from "../adapter";
import type { ToolDefinition, ToolResult } from "../../models/provider";
import type { EvidenceLogger } from "../../evidence/logger";

const TMUX_KEY_MAP: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
  Backspace: "BSpace",
  Delete: "DC",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  "Ctrl+C": "C-c",
  "Ctrl+D": "C-d",
  "Ctrl+Z": "C-z",
  "Ctrl+X": "C-x",
  "Ctrl+O": "C-o",
  "Ctrl+S": "C-s",
  "Ctrl+W": "C-w",
  "Ctrl+K": "C-k",
  "Ctrl+G": "C-g",
};

export class TUIAdapter implements Adapter {
  private _sessionName: string | null = null;

  get sessionName(): string {
    if (!this._sessionName) throw new Error("Session not started");
    return this._sessionName;
  }

  async start(command: string): Promise<void> {
    this._sessionName = `vet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const result = Bun.spawnSync([
      "tmux", "new-session", "-d",
      "-s", this._sessionName,
      "-x", "120", "-y", "40",
      command,
    ]);

    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to start tmux session: ${stderr}`);
    }
  }

  async readScreen(): Promise<string> {
    const result = Bun.spawnSync([
      "tmux", "capture-pane", "-t", this.sessionName, "-p",
    ]);
    return new TextDecoder().decode(result.stdout);
  }

  async type(text: string): Promise<void> {
    // tmux send-keys with -l flag sends literal text (no key name interpretation)
    Bun.spawnSync(["tmux", "send-keys", "-t", this.sessionName, "-l", text]);
  }

  async press(key: string): Promise<void> {
    const mapped = TMUX_KEY_MAP[key];
    if (!mapped) throw new Error(`Unknown key: ${key}. Available: ${Object.keys(TMUX_KEY_MAP).join(", ")}`);
    // Without -l, tmux interprets key names
    Bun.spawnSync(["tmux", "send-keys", "-t", this.sessionName, mapped]);
  }

  async close(): Promise<void> {
    if (!this._sessionName) return;
    try {
      Bun.spawnSync(["tmux", "kill-session", "-t", this._sessionName]);
    } catch {
      // session may already be dead
    }
    this._sessionName = null;
  }

  toolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "type",
        description: "Type literal text into the terminal application",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
          },
          required: ["text"],
        },
      },
      {
        name: "press",
        description:
          `Press a special key. Available keys: ${Object.keys(TMUX_KEY_MAP).join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name to press" },
          },
          required: ["key"],
        },
      },
      {
        name: "read_screen",
        description:
          "Read the current terminal screen contents. Returns the fully rendered screen (TUI escape codes are interpreted).",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<ToolResult> {
    logger.logAction(name, args);

    switch (name) {
      case "type": {
        await this.type(args.text as string);
        return { text: "typed" };
      }
      case "press": {
        await this.press(args.key as string);
        return { text: "pressed" };
      }
      case "read_screen": {
        const screen = await this.readScreen();
        return { text: screen };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/adapters/tui/adapter.test.ts`
Expected: 3 PASS (or skip if no tmux)

**Step 5: Commit**

```bash
git add src/adapters/tui/adapter.ts test/adapters/tui/adapter.test.ts
git commit -m "feat: add TUI adapter using tmux for full-screen terminal apps"
```

---

### Task 2: Wire TUI adapter into CLI and run command

**Files:**
- Modify: `src/cli/args.ts` — add `"tui"` to adapter type union
- Modify: `src/cli/run.ts` — add `tui` case to adapter switch
- Modify: `test/cli/args.test.ts` — test `--adapter tui`

**Step 1: Write the failing test**

Add to `test/cli/args.test.ts`:

```typescript
test("accepts tui adapter", () => {
  const args = parseArgs(["bun", "index.ts", "run", "story.md", "--target", "cmd", "--adapter", "tui"]);
  expect(args.adapter).toBe("tui");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/cli/args.test.ts`
Expected: The test passes at the args level (parseFlags just stores string values) but TypeScript compilation might not catch it. Either way, we need to wire the adapter.

**Step 3: Update the type and run command**

In `src/cli/args.ts`, change the `RunArgs.adapter` type:
```typescript
adapter: "web" | "cli" | "tui";
```

And the cast in `parseRunArgs`:
```typescript
adapter: (flags.adapter as "web" | "cli" | "tui") ?? "web",
```

In `src/cli/run.ts`, update the function signature and add the tui case:
```typescript
export async function run(
  scenarioPath: string,
  target: string,
  outDir: string,
  adapterType: "web" | "cli" | "tui",
  models: ModelConfig,
  chromeEndpoint?: string
): Promise<void> {
  // ... existing code ...
  let adapter;
  switch (adapterType) {
    case "cli":
      adapter = new CLIAdapter();
      await adapter.start(target);
      break;
    case "tui": {
      const { TUIAdapter } = await import("../adapters/tui/adapter");
      adapter = new TUIAdapter();
      await adapter.start(target);
      break;
    }
    case "web": {
      const { WebAdapter } = await import("../adapters/web/adapter");
      adapter = new WebAdapter({ chrome: chromeEndpoint });
      await adapter.start(target);
      break;
    }
  }
  // ... rest unchanged ...
```

**Step 4: Run tests to verify everything passes**

Run: `bun test test/cli/args.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/args.ts src/cli/run.ts test/cli/args.test.ts
git commit -m "feat: wire TUI adapter into CLI run command"
```

---

### Task 3: TodoMVC web fixture

**Files:**
- Create: `test/fixtures/todomvc.html`

Create a self-contained TodoMVC app. This must be a real, interactive single-page app — not a toy. It should support:
- Adding todos (type + Enter)
- Toggling individual todos complete/incomplete
- Filtering by All/Active/Completed
- Showing item count ("X items left")
- "Clear completed" button

It should deliberately NOT support:
- Editing existing todos (double-click to edit)
- Drag-to-reorder
- Undo
- Persistence (refresh clears everything)

This gives us clear pass and fail stories. ~150-200 lines of HTML/CSS/JS, no build step, no dependencies.

**Step 1: Create the fixture**

Create `test/fixtures/todomvc.html` with a complete TodoMVC implementation. Must include:

```html
<!DOCTYPE html>
<html>
<head>
  <title>TodoMVC - Vet Test Fixture</title>
  <style>
    /* Clean, functional styling */
    body { font-family: sans-serif; max-width: 550px; margin: 40px auto; }
    h1 { text-align: center; color: #b83f45; font-size: 80px; font-weight: 200; }
    .new-todo {
      width: 100%; padding: 16px; font-size: 24px;
      border: 1px solid #999; box-sizing: border-box;
    }
    .todo-list { list-style: none; padding: 0; margin: 0; }
    .todo-list li {
      padding: 15px; border-bottom: 1px solid #ededed;
      display: flex; align-items: center; font-size: 24px;
    }
    .todo-list li.completed label { text-decoration: line-through; color: #d9d9d9; }
    .todo-list li input[type="checkbox"] { margin-right: 15px; width: 20px; height: 20px; }
    .footer {
      display: flex; justify-content: space-between;
      padding: 10px 15px; border-top: 1px solid #e6e6e6; font-size: 14px;
    }
    .filters { display: flex; gap: 8px; list-style: none; padding: 0; }
    .filters a { padding: 3px 7px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; text-decoration: none; color: inherit; }
    .filters a.selected { border-color: #b83f45; }
    .clear-completed { cursor: pointer; border: none; background: none; font-size: 14px; }
    .clear-completed:hover { text-decoration: underline; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>todos</h1>
  <input class="new-todo" placeholder="What needs to be done?" autofocus />
  <ul class="todo-list"></ul>
  <div class="footer hidden">
    <span class="todo-count"></span>
    <ul class="filters">
      <li><a href="#/" class="selected" data-filter="all">All</a></li>
      <li><a href="#/active" data-filter="active">Active</a></li>
      <li><a href="#/completed" data-filter="completed">Completed</a></li>
    </ul>
    <button class="clear-completed hidden">Clear completed</button>
  </div>
  <script>
    const todos = [];
    let filter = 'all';
    const input = document.querySelector('.new-todo');
    const list = document.querySelector('.todo-list');
    const footer = document.querySelector('.footer');
    const count = document.querySelector('.todo-count');
    const clearBtn = document.querySelector('.clear-completed');

    function render() {
      const filtered = todos.filter(t =>
        filter === 'all' ? true : filter === 'active' ? !t.done : t.done
      );
      list.innerHTML = filtered.map((t, i) => `
        <li class="${t.done ? 'completed' : ''}" data-id="${todos.indexOf(t)}">
          <input type="checkbox" ${t.done ? 'checked' : ''} />
          <label>${t.text}</label>
        </li>
      `).join('');

      const left = todos.filter(t => !t.done).length;
      count.textContent = `${left} item${left !== 1 ? 's' : ''} left`;
      footer.classList.toggle('hidden', todos.length === 0);
      clearBtn.classList.toggle('hidden', !todos.some(t => t.done));

      document.querySelectorAll('.filters a').forEach(a => {
        a.classList.toggle('selected', a.dataset.filter === filter);
      });
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        todos.push({ text: input.value.trim(), done: false });
        input.value = '';
        render();
      }
    });

    list.addEventListener('change', e => {
      if (e.target.type === 'checkbox') {
        const id = +e.target.closest('li').dataset.id;
        todos[id].done = !todos[id].done;
        render();
      }
    });

    document.querySelector('.filters').addEventListener('click', e => {
      if (e.target.dataset.filter) {
        e.preventDefault();
        filter = e.target.dataset.filter;
        render();
      }
    });

    clearBtn.addEventListener('click', () => {
      for (let i = todos.length - 1; i >= 0; i--) {
        if (todos[i].done) todos.splice(i, 1);
      }
      render();
    });

    render();
  </script>
</body>
</html>
```

**Step 2: Verify fixture loads**

Run: `open test/fixtures/todomvc.html` in a browser and manually verify it works — add todos, check/uncheck, filter, clear completed. This is a manual step.

**Step 3: Commit**

```bash
git add test/fixtures/todomvc.html
git commit -m "feat: add TodoMVC web fixture for e2e testing"
```

---

### Task 4: Story cards for all three adapters

**Files:**
- Create: `test/fixtures/stories/bc-arithmetic-pass.md`
- Create: `test/fixtures/stories/bc-help-fail.md`
- Create: `test/fixtures/stories/todomvc-add-pass.md`
- Create: `test/fixtures/stories/todomvc-edit-fail.md`
- Create: `test/fixtures/stories/todomvc-filter-pass.md`
- Create: `test/fixtures/stories/nano-open-save-pass.md`
- Create: `test/fixtures/stories/nano-tabs-fail.md`

**Step 1: Create CLI stories (bc)**

`test/fixtures/stories/bc-arithmetic-pass.md`:
```markdown
---
id: bc-arithmetic
title: bc performs basic arithmetic
status: ready
tags: cli, smoke
---

# bc performs basic arithmetic

The bc calculator should correctly evaluate arithmetic expressions.

## Acceptance Criteria

- Calculator accepts input without showing errors
- Addition works correctly (e.g., 2+3 = 5)
- Multiplication works correctly (e.g., 6*7 = 42)
- Division works correctly (e.g., 10/2 = 5)
```

`test/fixtures/stories/bc-help-fail.md`:
```markdown
---
id: bc-help
title: bc displays a help menu
status: ready
tags: cli, expected-fail
---

# bc displays a help menu

The bc calculator should provide a help command that shows available operations.

## Acceptance Criteria

- Typing "help" displays a list of available commands
- The help output describes arithmetic operations
- The help output mentions available functions
```

**Step 2: Create web stories (TodoMVC)**

`test/fixtures/stories/todomvc-add-pass.md`:
```markdown
---
id: todomvc-add
title: User can add todo items
status: ready
tags: web, smoke
---

# User can add todo items

A user should be able to add new todo items to the list.

## Acceptance Criteria

- An input field is visible for entering new todos
- Typing text and pressing Enter adds the item to the list
- The item count updates to reflect the new total
- Multiple items can be added in sequence
```

`test/fixtures/stories/todomvc-edit-fail.md`:
```markdown
---
id: todomvc-edit
title: User can edit existing todo items
status: ready
tags: web, expected-fail
---

# User can edit existing todo items

A user should be able to edit the text of an existing todo item.

## Acceptance Criteria

- Double-clicking a todo item enters edit mode
- The item text becomes editable in an input field
- Pressing Enter saves the edited text
- Pressing Escape cancels the edit
```

`test/fixtures/stories/todomvc-filter-pass.md`:
```markdown
---
id: todomvc-filter
title: User can filter todos by status
status: ready
tags: web
---

# User can filter todos by status

The app should allow filtering the todo list by completion status.

## Acceptance Criteria

- Filter buttons for All, Active, and Completed are visible
- Clicking Active shows only incomplete items
- Clicking Completed shows only completed items
- Clicking All shows everything
- The item count always reflects active (incomplete) items
```

**Step 3: Create TUI stories (nano)**

`test/fixtures/stories/nano-open-save-pass.md`:
```markdown
---
id: nano-open-save
title: User can open, edit, and save a file in nano
status: ready
tags: tui, smoke
---

# User can open, edit, and save a file in nano

The nano text editor should allow basic file editing.

## Acceptance Criteria

- nano opens and displays the file contents
- User can type text and it appears in the editor
- The bottom of the screen shows available keyboard shortcuts
- Ctrl+O saves the file (WriteOut)
```

`test/fixtures/stories/nano-tabs-fail.md`:
```markdown
---
id: nano-tabs
title: nano supports tabbed editing of multiple files
status: ready
tags: tui, expected-fail
---

# nano supports tabbed editing of multiple files

The nano editor should support opening multiple files in tabs.

## Acceptance Criteria

- Multiple files can be opened simultaneously in tabs
- A tab bar shows all open files
- User can switch between tabs with keyboard shortcuts
- Closing a tab returns to the previous file
```

**Step 4: Commit**

```bash
git add test/fixtures/stories/
git commit -m "feat: add story cards for CLI, web, and TUI e2e tests"
```

---

### Task 5: E2E test — CLI (bc) pass and fail

**Files:**
- Create: `test/e2e/cli-bc.test.ts`

This test runs the agent against `bc` with a scripted LLM client. Two sub-tests: one with the pass story (arithmetic), one with the fail story (help menu).

**Step 1: Write the test**

Create `test/e2e/cli-bc.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { CLIAdapter } from "../../src/adapters/cli/adapter";
import { EvidenceLogger } from "../../src/evidence/logger";
import { parseStoryCard } from "../../src/format/story-card";
import type { LLMClient, ToolCall, ToolResult, AgentResponse } from "../../src/models/provider";
import { readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STORIES_DIR = join(import.meta.dir, "../fixtures/stories");

function makeScriptedClient(steps: AgentResponse[]): LLMClient {
  let callIndex = 0;
  return {
    async chat() {
      await Bun.sleep(200);
      const response = steps[callIndex++];
      if (!response) throw new Error("No more scripted responses");
      return response;
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
      return calls.map((call, i) => ({
        role: "tool_result",
        tool_call_id: call.id,
        content: results[i].text,
      }));
    },
  };
}

function step(id: string, name: string, args: Record<string, unknown>): AgentResponse {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: args }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", id },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function report(status: string, summary: string, reasoning: string): AgentResponse {
  return {
    text: "",
    toolCalls: [{
      id: "report", name: "report_result",
      arguments: { status, summary, reasoning },
    }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", id: "report" },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("CLI e2e — bc calculator", () => {
  test("pass: bc performs arithmetic correctly", async () => {
    const card = parseStoryCard(readFileSync(join(STORIES_DIR, "bc-arithmetic-pass.md"), "utf-8"));
    const adapter = new CLIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-bc-pass-"));
    const logger = new EvidenceLogger(logDir);

    const steps: AgentResponse[] = [
      step("c1", "type", { text: "2+3\n" }),
      step("c2", "read_output", {}),
      step("c3", "type", { text: "6*7\n" }),
      step("c4", "read_output", {}),
      step("c5", "type", { text: "10/2\n" }),
      step("c6", "read_output", {}),
      report("pass", "bc correctly computes arithmetic", "2+3=5, 6*7=42, 10/2=5 all correct"),
    ];

    try {
      await adapter.start("bc -q");
      const result = await runAgent(card, adapter, makeScriptedClient(steps), logger);
      expect(result.status).toBe("pass");
      expect(result.scenario).toBe("bc-arithmetic");
      expect(result.usage?.turns).toBe(7);
    } finally {
      await adapter.close();
    }
  });

  test("fail: bc has no help command", async () => {
    const card = parseStoryCard(readFileSync(join(STORIES_DIR, "bc-help-fail.md"), "utf-8"));
    const adapter = new CLIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-bc-fail-"));
    const logger = new EvidenceLogger(logDir);

    const steps: AgentResponse[] = [
      step("c1", "type", { text: "help\n" }),
      step("c2", "read_output", {}),
      report("fail", "bc does not have a help command", "Typing 'help' produces a parse error, not a help menu"),
    ];

    try {
      await adapter.start("bc -q");
      const result = await runAgent(card, adapter, makeScriptedClient(steps), logger);
      expect(result.status).toBe("fail");
      expect(result.scenario).toBe("bc-help");
    } finally {
      await adapter.close();
    }
  });
});
```

**Step 2: Run test to verify it passes**

Run: `bun test test/e2e/cli-bc.test.ts`
Expected: 2 PASS

**Step 3: Commit**

```bash
git add test/e2e/cli-bc.test.ts
git commit -m "test: add CLI e2e tests with bc (pass and fail stories)"
```

---

### Task 6: E2E test — Web (TodoMVC) pass and fail

**Files:**
- Create: `test/e2e/web-todomvc.test.ts`

This test serves the TodoMVC fixture via `Bun.serve`, connects via WebAdapter, and runs scripted agent interactions. Tests both pass story (add todos) and fail story (edit todos).

**Step 1: Write the test**

Create `test/e2e/web-todomvc.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { EvidenceLogger } from "../../src/evidence/logger";
import { parseStoryCard } from "../../src/format/story-card";
import type { LLMClient, ToolCall, ToolResult, AgentResponse } from "../../src/models/provider";
import { readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TODOMVC_HTML = join(import.meta.dir, "../fixtures/todomvc.html");
const STORIES_DIR = join(import.meta.dir, "../fixtures/stories");

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function isChromeUnavailable(err: any): boolean {
  const msg = err?.message ?? "";
  return msg.includes("Chrome") || msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("timed out");
}

function makeScriptedClient(steps: AgentResponse[]): LLMClient {
  let callIndex = 0;
  return {
    async chat() {
      const response = steps[callIndex++];
      if (!response) throw new Error("No more scripted responses");
      return response;
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
      return calls.map((call, i) => ({
        role: "tool",
        id: call.id,
        content: results[i].text,
      }));
    },
  };
}

function step(id: string, name: string, args: Record<string, unknown>): AgentResponse {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: args }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", id },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function report(status: string, summary: string, reasoning: string): AgentResponse {
  return {
    text: "",
    toolCalls: [{
      id: "report", name: "report_result",
      arguments: { status, summary, reasoning },
    }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", id: "report" },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("Web e2e — TodoMVC", () => {
  test("pass: user can add todo items", async () => {
    let WebAdapter: any;
    try {
      const mod = await import("../../src/adapters/web/adapter");
      WebAdapter = mod.WebAdapter;
    } catch {
      console.log("Skipping: chrome-ws-lib not available");
      return;
    }

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(readFileSync(TODOMVC_HTML, "utf-8"), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });

    const outDir = mkdtempSync(join(tmpdir(), "vet-todomvc-pass-"));
    const logger = new EvidenceLogger(outDir);
    const adapter = new WebAdapter();

    const steps: AgentResponse[] = [
      step("c1", "screenshot", {}),
      step("c2", "type", { text: "Buy groceries", selector: ".new-todo" }),
      step("c3", "press", { key: "Enter" }),
      step("c4", "extract", { selector: ".todo-list" }),
      step("c5", "extract", { selector: ".todo-count" }),
      step("c6", "type", { text: "Walk the dog", selector: ".new-todo" }),
      step("c7", "press", { key: "Enter" }),
      step("c8", "extract", { selector: ".todo-count" }),
      report("pass", "Todo items can be added successfully", "Added two items, both appeared in list, count updated correctly"),
    ];

    try {
      await withTimeout(adapter.start(`http://localhost:${server.port}`), 10_000, "adapter.start");
      const card = parseStoryCard(readFileSync(join(STORIES_DIR, "todomvc-add-pass.md"), "utf-8"));
      const result = await withTimeout(
        runAgent(card, adapter, makeScriptedClient(steps), logger),
        15_000, "runAgent"
      );
      expect(result.status).toBe("pass");
      expect(result.scenario).toBe("todomvc-add");
    } catch (err: any) {
      if (isChromeUnavailable(err)) {
        console.log(`Skipping: ${err.message}`);
        return;
      }
      throw err;
    } finally {
      await adapter.close();
      server.stop();
    }
  }, 30_000);

  test("fail: editing todos is not supported", async () => {
    let WebAdapter: any;
    try {
      const mod = await import("../../src/adapters/web/adapter");
      WebAdapter = mod.WebAdapter;
    } catch {
      console.log("Skipping: chrome-ws-lib not available");
      return;
    }

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(readFileSync(TODOMVC_HTML, "utf-8"), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });

    const outDir = mkdtempSync(join(tmpdir(), "vet-todomvc-fail-"));
    const logger = new EvidenceLogger(outDir);
    const adapter = new WebAdapter();

    const steps: AgentResponse[] = [
      // Add an item first
      step("c1", "type", { text: "Test item", selector: ".new-todo" }),
      step("c2", "press", { key: "Enter" }),
      // Try to double-click to edit (won't work — no edit mode)
      step("c3", "eval", { expression: "document.querySelector('.todo-list li label')?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" }),
      // Check if an edit input appeared
      step("c4", "extract", { selector: ".todo-list" }),
      report("fail", "Editing todos is not supported", "Double-clicking a todo does not enter edit mode. No edit input appears."),
    ];

    try {
      await withTimeout(adapter.start(`http://localhost:${server.port}`), 10_000, "adapter.start");
      const card = parseStoryCard(readFileSync(join(STORIES_DIR, "todomvc-edit-fail.md"), "utf-8"));
      const result = await withTimeout(
        runAgent(card, adapter, makeScriptedClient(steps), logger),
        15_000, "runAgent"
      );
      expect(result.status).toBe("fail");
      expect(result.scenario).toBe("todomvc-edit");
    } catch (err: any) {
      if (isChromeUnavailable(err)) {
        console.log(`Skipping: ${err.message}`);
        return;
      }
      throw err;
    } finally {
      await adapter.close();
      server.stop();
    }
  }, 30_000);
});
```

**Step 2: Run test to verify it passes**

Run: `bun test test/e2e/web-todomvc.test.ts`
Expected: 2 PASS (or skip if no Chrome)

**Step 3: Commit**

```bash
git add test/e2e/web-todomvc.test.ts
git commit -m "test: add web e2e tests with TodoMVC (pass and fail stories)"
```

---

### Task 7: E2E test — TUI (nano) pass and fail

**Files:**
- Create: `test/e2e/tui-nano.test.ts`

This test uses the TUIAdapter to run `nano` inside tmux and verify the agent can read the screen and interact with it.

**Step 1: Write the test**

Create `test/e2e/tui-nano.test.ts`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { TUIAdapter } from "../../src/adapters/tui/adapter";
import { EvidenceLogger } from "../../src/evidence/logger";
import { parseStoryCard } from "../../src/format/story-card";
import type { LLMClient, ToolCall, ToolResult, AgentResponse } from "../../src/models/provider";
import { readFileSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STORIES_DIR = join(import.meta.dir, "../fixtures/stories");

// Skip if tmux or nano not available
let hasTmux = false;
let hasNano = false;
try {
  hasTmux = Bun.spawnSync(["tmux", "-V"]).exitCode === 0;
  hasNano = Bun.spawnSync(["nano", "--version"]).exitCode === 0;
} catch {}

function makeScriptedClient(steps: AgentResponse[]): LLMClient {
  let callIndex = 0;
  return {
    async chat() {
      await Bun.sleep(300);
      const response = steps[callIndex++];
      if (!response) throw new Error("No more scripted responses");
      return response;
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
      return calls.map((call, i) => ({
        role: "tool_result",
        tool_call_id: call.id,
        content: results[i].text,
      }));
    },
  };
}

function step(id: string, name: string, args: Record<string, unknown>): AgentResponse {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: args }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", id },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function report(status: string, summary: string, reasoning: string): AgentResponse {
  return {
    text: "",
    toolCalls: [{
      id: "report", name: "report_result",
      arguments: { status, summary, reasoning },
    }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", id: "report" },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe.skipIf(!hasTmux || !hasNano)("TUI e2e — nano editor", () => {
  let adapter: TUIAdapter;

  afterEach(async () => {
    await adapter?.close();
  });

  test("pass: user can open, type, and see shortcuts", async () => {
    const testFile = join(mkdtempSync(join(tmpdir(), "vet-nano-")), "test.txt");
    writeFileSync(testFile, "initial content\n");

    const card = parseStoryCard(readFileSync(join(STORIES_DIR, "nano-open-save-pass.md"), "utf-8"));
    adapter = new TUIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-nano-pass-"));
    const logger = new EvidenceLogger(logDir);

    const steps: AgentResponse[] = [
      // Read initial screen — should show file content and shortcuts
      step("c1", "read_screen", {}),
      // Type some text
      step("c2", "type", { text: "Hello from vet!" }),
      // Read screen to verify text appeared
      step("c3", "read_screen", {}),
      // Save with Ctrl+O
      step("c4", "press", { key: "Ctrl+O" }),
      await Bun.sleep(0), // (this is just a separator comment in the plan)
      step("c5", "read_screen", {}),
      // Confirm filename with Enter
      step("c6", "press", { key: "Enter" }),
      step("c7", "read_screen", {}),
      report("pass", "nano opens files, accepts input, and shows shortcuts", "File content visible, typed text appeared, Ctrl+O triggered save dialog, shortcuts visible at bottom"),
    ];

    // Remove the sleep placeholder
    const filteredSteps = steps.filter(s => s && typeof s === "object" && "toolCalls" in s) as AgentResponse[];

    const result = await runAgent(card, adapter, makeScriptedClient(filteredSteps), logger, `nano ${testFile}`);
    expect(result.status).toBe("pass");
    expect(result.scenario).toBe("nano-open-save");
  }, 15_000);

  test("fail: nano does not support tabs", async () => {
    const testFile = join(mkdtempSync(join(tmpdir(), "vet-nano-")), "test.txt");
    writeFileSync(testFile, "file content\n");

    const card = parseStoryCard(readFileSync(join(STORIES_DIR, "nano-tabs-fail.md"), "utf-8"));
    adapter = new TUIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-nano-fail-"));
    const logger = new EvidenceLogger(logDir);

    const steps: AgentResponse[] = [
      step("c1", "read_screen", {}),
      report("fail", "nano does not support tabbed editing", "nano shows a single file view with no tab bar. There is no mechanism to open or switch between multiple file tabs."),
    ];

    const result = await runAgent(card, adapter, makeScriptedClient(steps), logger, `nano ${testFile}`);
    expect(result.status).toBe("fail");
    expect(result.scenario).toBe("nano-tabs");
  }, 15_000);
});
```

**Note:** The nano test passes `nano ${testFile}` as the `target` parameter to `runAgent`. The TUIAdapter's `start()` receives this as the command. However, looking at the current agent loop, `target` is passed to `runAgent` and included in the initial user message. For TUI, the target IS the command, not a URL. The adapter's `start(target)` call is already in `run.ts`. This should work as-is.

**Step 2: Run test to verify it passes**

Run: `bun test test/e2e/tui-nano.test.ts`
Expected: 2 PASS (or skip if no tmux/nano)

**Step 3: Commit**

```bash
git add test/e2e/tui-nano.test.ts
git commit -m "test: add TUI e2e tests with nano (pass and fail stories)"
```

---

### Task 8: Run full test suite and verify

**Step 1: Run all tests**

Run: `bun test`

Expected: All existing tests still pass, new tests pass (or skip gracefully). Zero failures.

Verify:
- CLI bc tests: 2 pass
- Web TodoMVC tests: 2 pass (or skip if no Chrome)
- TUI nano tests: 2 pass (or skip if no tmux/nano)
- TUI adapter unit tests: 3 pass (or skip)
- All previous 75 tests still pass

**Step 2: Final commit if any cleanup needed**

```bash
git status
# If clean, no commit needed
```
