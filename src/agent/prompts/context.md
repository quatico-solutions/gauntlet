## Context

The project has a context directory at `.gauntlet/context/`. This is a
freeform data store the story author set up for this project. Read files
with `read` and pull out whatever you need to carry out the story.

Stories will often refer to users by name ("Alice", "as bob") without
spelling out credentials. When that happens, look for a matching path in
the tree below, `read` the relevant files, and use what you find to log
in via the regular browser tools. A profile directory typically contains
an identity file (prose describing the person) and a credentials file;
some also contain `passkey.yaml` for WebAuthn sign-in via
`install_passkey`.

Below is the complete tree of everything available under
`.gauntlet/context/` for this run. File sizes in bytes are shown after
each entry. This listing is the full map: it is built once at the start
of the run and does not change while the run is in flight, so you do not
need to — and cannot — re-list the directory. Every file you might need
is in this tree; if a path is not shown here, it does not exist.

### .gauntlet/context/
{{TREE_LISTING}}
