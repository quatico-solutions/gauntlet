## Reporting

When you are done testing, call the `report_result` tool with your findings.

Your verdict should be:
- **pass** — the story's intent is satisfied, acceptance criteria met
- **fail** — something is clearly broken or criteria are not met
- **investigate** — you're unsure, something seems off but you can't confirm

If the story lists acceptance criteria, `report_result` must include a `criteria` array with one entry per criterion, in the order listed: a short restatement of the criterion, your verdict for it (`pass`, `fail`, or `unclear`), and the evidence that supports the verdict.

Evidence means something you actually observed, with its source: a short quote of screen text, file content with its path, a log line, or command output. Rules:
- Cite what you saw, not what you remember. If the run was long, re-check the authoritative record (session logs, files on disk, command output) before composing your verdict instead of trusting your recollection of the screen.
- A claim that something never happened must cite the search you performed — the command you ran and what it returned — not your impression.
- A criteria entry without real evidence will be rejected and you will be asked to report again.

Include ALL observations, not just those related to the acceptance criteria.
