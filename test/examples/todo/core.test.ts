import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadState,
  saveState,
  addItem,
  toggleItem,
  deleteItem,
  setFilter,
  visibleItems,
  activeCount,
  clearCompleted,
  type TodoState,
} from "../../../examples/todo/core";

let tmp: string;
let stateFile: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "todo-core-"));
  stateFile = join(tmp, "state.json");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadState", () => {
  test("returns empty state when file does not exist", () => {
    const s = loadState(stateFile);
    expect(s).toEqual({ items: [], filter: "all" });
  });

  test("reads an existing state file", () => {
    writeFileSync(
      stateFile,
      JSON.stringify({
        items: [{ id: "a3xq", text: "buy milk", done: false }],
        filter: "active",
      }),
    );
    const s = loadState(stateFile);
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.text).toBe("buy milk");
    expect(s.filter).toBe("active");
  });
});

describe("saveState", () => {
  test("writes pretty-printed JSON", () => {
    const s: TodoState = {
      items: [{ id: "a3xq", text: "buy milk", done: false }],
      filter: "all",
    };
    saveState(s, stateFile);
    expect(existsSync(stateFile)).toBe(true);
    const raw = readFileSync(stateFile, "utf8");
    expect(raw).toContain("\n");
    expect(JSON.parse(raw)).toEqual(s);
  });

  test("save + load roundtrip preserves state", () => {
    const s: TodoState = {
      items: [
        { id: "a3xq", text: "first", done: false },
        { id: "b7kn", text: "second", done: true },
      ],
      filter: "completed",
    };
    saveState(s, stateFile);
    expect(loadState(stateFile)).toEqual(s);
  });
});

describe("addItem", () => {
  test("appends an active item and returns it", () => {
    const s: TodoState = { items: [], filter: "all" };
    const added = addItem(s, "buy milk");
    expect(s.items.length).toBe(1);
    expect(s.items[0]).toBe(added);
    expect(added.text).toBe("buy milk");
    expect(added.done).toBe(false);
  });

  test("preserves insertion order across multiple adds", () => {
    const s: TodoState = { items: [], filter: "all" };
    addItem(s, "first");
    addItem(s, "second");
    addItem(s, "third");
    expect(s.items.map((i) => i.text)).toEqual(["first", "second", "third"]);
  });

  test("generated IDs are 4 chars from the unambiguous alphabet", () => {
    const s: TodoState = { items: [], filter: "all" };
    for (let i = 0; i < 50; i++) addItem(s, `item ${i}`);
    for (const item of s.items) {
      expect(item.id).toMatch(/^[a-km-np-z2-9]{4}$/);
    }
  });

  test("IDs are unique within a state", () => {
    const s: TodoState = { items: [], filter: "all" };
    for (let i = 0; i < 100; i++) addItem(s, `item ${i}`);
    const seen = new Set(s.items.map((i) => i.id));
    expect(seen.size).toBe(s.items.length);
  });
});

describe("toggleItem", () => {
  test("flips done from false to true", () => {
    const s: TodoState = { items: [], filter: "all" };
    const added = addItem(s, "x");
    const toggled = toggleItem(s, added.id);
    expect(toggled?.done).toBe(true);
    expect(s.items[0]?.done).toBe(true);
  });

  test("flips done from true to false", () => {
    const s: TodoState = { items: [], filter: "all" };
    const added = addItem(s, "x");
    toggleItem(s, added.id);
    const toggled = toggleItem(s, added.id);
    expect(toggled?.done).toBe(false);
  });

  test("returns null for unknown id, no mutation", () => {
    const s: TodoState = { items: [], filter: "all" };
    addItem(s, "x");
    const result = toggleItem(s, "zzzz");
    expect(result).toBeNull();
    expect(s.items[0]?.done).toBe(false);
  });
});

describe("deleteItem", () => {
  test("removes the named item and returns true", () => {
    const s: TodoState = { items: [], filter: "all" };
    const a = addItem(s, "a");
    const b = addItem(s, "b");
    const c = addItem(s, "c");
    expect(deleteItem(s, b.id)).toBe(true);
    expect(s.items.map((i) => i.text)).toEqual(["a", "c"]);
    expect(s.items.map((i) => i.id)).toEqual([a.id, c.id]);
  });

  test("returns false for unknown id, no mutation", () => {
    const s: TodoState = { items: [], filter: "all" };
    addItem(s, "x");
    expect(deleteItem(s, "zzzz")).toBe(false);
    expect(s.items.length).toBe(1);
  });
});

describe("setFilter / visibleItems", () => {
  function seed(): TodoState {
    const s: TodoState = { items: [], filter: "all" };
    addItem(s, "a");
    const b = addItem(s, "b");
    addItem(s, "c");
    toggleItem(s, b.id);
    return s;
  }

  test("filter=all shows every item", () => {
    const s = seed();
    setFilter(s, "all");
    expect(visibleItems(s).map((i) => i.text)).toEqual(["a", "b", "c"]);
  });

  test("filter=active shows only undone items", () => {
    const s = seed();
    setFilter(s, "active");
    expect(visibleItems(s).map((i) => i.text)).toEqual(["a", "c"]);
  });

  test("filter=completed shows only done items", () => {
    const s = seed();
    setFilter(s, "completed");
    expect(visibleItems(s).map((i) => i.text)).toEqual(["b"]);
  });

  test("setFilter mutates state.filter", () => {
    const s = seed();
    setFilter(s, "completed");
    expect(s.filter).toBe("completed");
  });
});

describe("activeCount", () => {
  test("counts items where done=false, ignoring filter", () => {
    const s: TodoState = { items: [], filter: "completed" };
    addItem(s, "a");
    const b = addItem(s, "b");
    addItem(s, "c");
    toggleItem(s, b.id);
    expect(activeCount(s)).toBe(2);
  });
});

describe("clearCompleted", () => {
  test("removes all done items and returns the count removed", () => {
    const s: TodoState = { items: [], filter: "all" };
    addItem(s, "a");
    const b = addItem(s, "b");
    addItem(s, "c");
    const d = addItem(s, "d");
    toggleItem(s, b.id);
    toggleItem(s, d.id);
    expect(clearCompleted(s)).toBe(2);
    expect(s.items.map((i) => i.text)).toEqual(["a", "c"]);
  });

  test("removes nothing when no items are done", () => {
    const s: TodoState = { items: [], filter: "all" };
    addItem(s, "a");
    addItem(s, "b");
    expect(clearCompleted(s)).toBe(0);
    expect(s.items.length).toBe(2);
  });
});
