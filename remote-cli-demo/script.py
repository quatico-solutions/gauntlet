#!/usr/bin/env python3
"""A tiny interactive TODO-list CLI for exercising the Gauntlet remote-cli adapter.

Commands:
    add <text>   append an item to the list
    list         print the current items, numbered from 1
    done <n>     remove item n (1-indexed) from the list
    help         print the command list
    quit         exit with status 0

Unknown input prints an error line and continues. Output is unbuffered line-by-line
so the LLM sees progress immediately.
"""
from __future__ import annotations

import sys


def main() -> int:
    items: list[str] = []
    print("todo> ready. type 'help' for commands.", flush=True)
    while True:
        try:
            raw = input()
        except EOFError:
            print("todo> eof, bye", flush=True)
            return 0
        line = raw.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "add":
            if not arg:
                print("todo> error: add requires text", flush=True)
                continue
            items.append(arg)
            print(f"todo> added: {arg}", flush=True)
        elif cmd == "list":
            if not items:
                print("todo> (no items)", flush=True)
            else:
                for i, it in enumerate(items, 1):
                    print(f"todo> {i}. {it}", flush=True)
        elif cmd == "done":
            try:
                n = int(arg)
            except ValueError:
                print("todo> error: done requires a number", flush=True)
                continue
            if n < 1 or n > len(items):
                print(f"todo> error: no item {n}", flush=True)
                continue
            removed = items.pop(n - 1)
            print(f"todo> done: {removed}", flush=True)
        elif cmd == "help":
            print("todo> commands: add <text> | list | done <n> | help | quit", flush=True)
        elif cmd == "quit":
            print("todo> bye", flush=True)
            return 0
        else:
            print(f"todo> error: unknown command '{cmd}'", flush=True)


if __name__ == "__main__":
    sys.exit(main())
