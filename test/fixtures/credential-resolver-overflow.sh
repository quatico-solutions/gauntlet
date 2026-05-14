#!/usr/bin/env bash
# Resolver that prints 100 KiB of 'x' to stdout, exceeding the 64 KiB cap.
# Used to exercise the stdout_overflow guard.
head -c 102400 /dev/zero | tr '\0' 'x'
