#!/usr/bin/env bash
# Stderr overflow resolver: writes > 8 KiB to stderr, then exits 0.
head -c 10240 /dev/zero | tr '\0' 'y' >&2
exit 0
