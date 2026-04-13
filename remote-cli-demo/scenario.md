---
id: remote-cli-todo-001
title: Remote CLI TODO app golden path
status: ready
tags: remote-cli, smoke
stakeholder: end-user
---

You are testing `script.py`, a minimal interactive TODO-list CLI. It prints a
`todo> ready. type 'help' for commands.` banner on startup and then accepts
single-line commands on stdin: `add <text>`, `list`, `done <n>`, `help`, `quit`.
Every response line is prefixed with `todo>`.

The program is already running on the remote host via the relay adapter —
your `type`/`press`/`read_output` tools write directly into its stdin and read
from its stdout. Always `read_output` after sending input to see the reply.

Exercise the happy path end-to-end:

1. After the startup banner, add two items, e.g. `buy milk` and `write tests`.
2. Run `list` and confirm both items appear, numbered 1 and 2.
3. Run `done 1` to remove the first item, then `list` again and confirm only
   the second item remains (now numbered 1).
4. Type `quit` and confirm the program prints `todo> bye` and exits.

Report `pass` only if every acceptance criterion below is observed in the
real stdout of the program.

## Acceptance Criteria

- Adding two items produces two `todo> added: …` lines matching the inputs.
- After both adds, `list` prints exactly two numbered items in insertion order.
- After `done 1`, a subsequent `list` shows exactly one item — the originally-second one — renumbered as item 1.
- Typing `quit` causes the program to print `todo> bye` and terminate.
