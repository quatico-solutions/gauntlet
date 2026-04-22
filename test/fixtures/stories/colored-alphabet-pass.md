---
id: colored-alphabet-pass
title: Agent can read ANSI colors from a TUI
status: ready
tags: tui, smoke, ansi
---

# Agent can read ANSI colors from a TUI

A fixture prints eight letters, each rendered in a specific ANSI color. The agent
must read the screen and report colors accurately. The letter-to-color mapping
is deliberately mismatched (e.g. `G` is red, not green) so correct answers
require parsing the ANSI escape sequences rather than guessing from the letter.

The ground truth:

- A = magenta
- B = green
- C = red
- D = cyan
- E = yellow
- F = blue
- G = red
- H = magenta

## Acceptance Criteria

- The screen shows the letter `G` rendered in red
- The letters `A` and `H` are rendered in the same color (magenta)
- The letter `B` is rendered in green (not blue)
- No letter on the screen is rendered in white
