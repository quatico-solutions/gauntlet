// Shared TODO model + state I/O for the Gauntlet fixture under
// examples/todo. All three frontends (cli, tui, web) import from
// here; nothing else touches the on-disk JSON.
//
// State path resolution: explicit argument > $TODO_STATE_FILE >
// ./.todo-state.json. The Gauntlet harness sets $TODO_STATE_FILE
// per run for isolation.
//
// This is a fixture. No locking, no schema migration, no validation
// beyond what the type system gives us. Don't use as a starter.

import { existsSync, readFileSync, writeFileSync } from "fs";

export type Filter = "all" | "active" | "completed";

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoState {
  items: TodoItem[];
  filter: Filter;
}

const DEFAULT_STATE_FILE = "./.todo-state.json";

export function resolveStatePath(arg?: string): string {
  if (arg) return arg;
  const env = process.env.TODO_STATE_FILE;
  if (env && env.length > 0) return env;
  return DEFAULT_STATE_FILE;
}

export function loadState(path?: string): TodoState {
  const file = resolveStatePath(path);
  if (!existsSync(file)) {
    return { items: [], filter: "all" };
  }
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as TodoState;
  return {
    items: parsed.items ?? [],
    filter: parsed.filter ?? "all",
  };
}

export function saveState(state: TodoState, path?: string): void {
  const file = resolveStatePath(path);
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// Alphabet: a-k, m, n, p-z, 2-9 (no 0/1/l/o, no ambiguous chars).
// 30 symbols, 4 chars => 810,000 distinct ids — plenty for a fixture.
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function generateId(existing: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = "";
    for (let i = 0; i < 4; i++) {
      id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    }
    if (!existing.has(id)) return id;
  }
  throw new Error("todo: failed to generate a unique id after 1000 attempts");
}

export function addItem(state: TodoState, text: string): TodoItem {
  const existing = new Set(state.items.map((i) => i.id));
  const item: TodoItem = {
    id: generateId(existing),
    text,
    done: false,
  };
  state.items.push(item);
  return item;
}

export function toggleItem(state: TodoState, id: string): TodoItem | null {
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  item.done = !item.done;
  return item;
}

export function deleteItem(state: TodoState, id: string): boolean {
  const before = state.items.length;
  state.items = state.items.filter((i) => i.id !== id);
  return state.items.length < before;
}

export function setFilter(state: TodoState, filter: Filter): void {
  state.filter = filter;
}

export function visibleItems(state: TodoState): TodoItem[] {
  switch (state.filter) {
    case "all":
      return state.items;
    case "active":
      return state.items.filter((i) => !i.done);
    case "completed":
      return state.items.filter((i) => i.done);
  }
}

export function activeCount(state: TodoState): number {
  return state.items.filter((i) => !i.done).length;
}

export function clearCompleted(state: TodoState): number {
  const before = state.items.length;
  state.items = state.items.filter((i) => !i.done);
  return before - state.items.length;
}
