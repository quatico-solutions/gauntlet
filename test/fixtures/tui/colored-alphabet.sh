#!/bin/sh
# Deliberately mismatched letter/color pairs. A semantic-hallucinating agent
# will guess wrong; a reading agent parses the ANSI escapes and gets it right.
#
# Mapping:
#   A = magenta (35)
#   B = green   (32)
#   C = red     (31)
#   D = cyan    (36)
#   E = yellow  (33)
#   F = blue    (34)
#   G = red     (31)   -- deliberately NOT green
#   H = magenta (35)   -- same color as A
#
# Two letters share magenta (A, H); two share red (C, G); no letter is white.
printf '\033[35mA\033[32mB\033[31mC\033[36mD\033[33mE\033[34mF\033[31mG\033[35mH\033[0m\n'
# Keep the session alive, but ignore any keystrokes the agent sends — a
# blocking `read` would terminate the script the instant the agent typed
# anything, killing the tmux session along with it.
sleep 86400
