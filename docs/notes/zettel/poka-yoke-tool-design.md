---
title: Poka-yoke the agent-computer interface — make wrong tool use harder than right
created: 2026-05-12
source: ../sources/anthropic-building-effective-agents.md
links:
  - bloated-tool-sets-cause-ambiguity
  - tool-descriptions-load-bearing-on-46
  - three-surfaces-prompt-tool-harness
---

# Poka-yoke the agent-computer interface — make wrong tool use harder than right

From Anthropic's "Building effective agents": invest in the
agent-computer interface (ACI) with the same rigor as a human
interface. The poka-yoke principle: "restructure arguments so that
it is harder to make mistakes." Make obvious tool names; make
parameter names self-explanatory ("it is probably also true for the
model"); name expected formats inline; bound argument types.

Two illustrative patterns from Anthropic's own work:

1. **Absolute paths over relative paths.** Their SWE-bench coding
   agent kept losing context after directory changes when paths
   were relative. The fix wasn't a prompt patch ("remember to cd
   back") — it was a tool-surface change requiring absolute paths.
   The wrong move is now structurally harder to make.

2. **Tool docs as behavioral spec.** "Example usage, edge cases,
   input format requirements, and clear boundaries from other
   tools." Tool descriptions describe *when* the tool fits and
   *when it doesn't* — not just what it does.

For Gauntlet's web adapter, the poka-yoke moves are concrete:

- **Eval-like tools should be the structurally awkward choice.**
  If `evaluate_js` has a description like "Evaluate JavaScript in
  the page context. Use only for read-only inspection of computed
  styles, ARIA attributes, or state — never to dispatch events,
  fill forms, or click. Use `click`, `type`, `fill_form` for
  action," then both the description and (ideally) a runtime check
  on disallowed patterns make eval-misuse harder.

- **`fill_form` should be obvious enough that the agent reaches for
  it.** If the agent doesn't notice a `fill_form` tool exists, or
  if `fill_form`'s description doesn't make the React-form case
  clear, the agent will reach for evaluate-JS as a workaround. The
  fix is on the tool side: a `fill_form` that actually handles the
  React-form case and is *named obviously enough* that it shows up
  in the agent's first scan of options.

- **Side-trip tools (`new_tab`, `close_tab`) should make their
  intended use cheap.** The current `adapter-web.md` already does
  this: it tells the agent that `new_tab` is for side trips and
  `navigate` resets the original page. That's a prompt patch over
  a tool-surface question — but a working one. The harder fix would
  be a tool design where `navigate` for an in-flight form would
  raise a warning or require confirmation.

Source: Anthropic, "Building effective agents."
