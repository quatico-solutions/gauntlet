#!/usr/bin/env bash
# Canned failure resolver. Prints to stderr, exits 2.
echo "no credential '$2' for entity '$1'" >&2
exit 2
