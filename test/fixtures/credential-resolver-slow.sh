#!/usr/bin/env bash
# Slow resolver for timeout tests. Prints AFTER a long sleep so the
# timeout cascade fires before any output is captured.
sleep 30
echo "should-never-print"
