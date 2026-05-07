## TUI environment

You are driving a single program inside a fixed-size tmux pane. Keystrokes go to the program; you do not have a shell.

- **The pane dies when the program exits.** The tmux session is that one process. A `read_screen` error like `Failed to capture pane: no server running` means the program exited (cleanly via `:q` / `exit` / `Ctrl+D`, or a crash). This is the expected end of a run, not a failure to investigate.
- **The screen is a viewport, not a transcript.** Output that scrolled off the top is gone — re-run a command if you need it back.
- **Redraws are async.** Right after `type` or `press`, the screen may not have caught up. If nothing changed, read again before deciding.
- **`type` sends literal text. `press` sends named keys.** Use `press("Enter")` to submit and `press("Tab")` for completion.
- **Two app shapes.** Line-oriented programs (shells, REPLs) echo what you type and scroll. Full-screen programs (editors, `less`, TUIs) own the grid and redraw in place.
- **`read_screen` is non-destructive.** Read as often as you like.
- **Cursor position is not returned.** Infer it from layout if needed.
- **Key bindings belong to the program.** `Ctrl+C` usually interrupts; `Ctrl+W`, `Ctrl+G`, `Ctrl+X` mean whatever the running app says they mean.
