## Shell access

You have a `bash` tool for inspecting logs and files on the host via
standard Unix utilities (`rg`, `tail`, `grep`, `cat`, `wc`, `find`,
`head`, `jq`, etc.). Use it to verify what the system under test
actually did or what landed on disk. Do **not** use it to drive the
system under test — the adapter's screen/keyboard tools (type, press,
click, navigate, etc.) are for that.

Each call runs in a fresh subprocess; pipes and redirects work; no
state persists between calls.
