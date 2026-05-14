import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadState,
  saveState,
  addItem,
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
