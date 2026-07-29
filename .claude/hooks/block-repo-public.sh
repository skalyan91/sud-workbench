#!/usr/bin/env bash
# PreToolUse(Bash) guard: refuse any command that would make this repository PUBLIC.
#
# WHY. `grammars/` is vendored verbatim from surfacesyntacticud/tools, which declares no licence
# anywhere — not in the repository, not in the vendored files. No licence means no grant of
# redistribution rights, so publishing this repository as it stands republishes someone else's
# work without permission. See THIRD-PARTY-NOTICES.md, which states the three ways out.
#
# Exit 2 blocks the tool call and feeds this script's stderr back to the model, so the reason
# travels with the refusal instead of being a silent failure.
#
# SCOPE — worth being honest about: this can only see commands run through Claude Code. Flipping
# visibility in the GitHub web UI, or from a shell outside this harness, is not something a hook
# can reach. It is a tripwire against the automated path, not an enforcement boundary.
set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# STRIP HEREDOC BODIES before matching. Caught by this guard blocking its own commit: the commit
# message described the patterns it blocks, that prose travelled inside a `git commit -F - <<'EOF'`
# heredoc, and the whole thing is one Bash command string — so a command that merely MENTIONS
# `gh repo create --public` looked identical to one that runs it. Any commit message, grep, echo or
# doc edit quoting these flags would have tripped it. The line introducing the heredoc is kept (it
# is the real command); only the body is dropped.
cmd=$(printf '%s' "$cmd" | awk '
  skip { if ($0 == term) skip = 0; next }
  { line = $0
    if (match(line, /<<-?[ \t]*'"'"'?"?[A-Za-z_][A-Za-z0-9_]*'"'"'?"?/)) {
      t = substr(line, RSTART, RLENGTH); sub(/^<<-?[ \t]*/, "", t); gsub(/['"'"'"]/, "", t)
      term = t; skip = 1 }
    print line }')

# Newlines become `;` rather than spaces, so a line break stays a COMMAND BOUNDARY for the
# command-position anchor below instead of dissolving into the middle of the previous command.
flat=$(printf '%s' "$cmd" | tr '\n' ';' | tr -s '[:space:]' ' ')

# `gh` must sit where a command can actually start — beginning of the string, or after a shell
# separator. Without this, `grep 'gh repo edit' …` or prose containing the flags reads as an
# invocation. CP is that anchor, reused by every pattern below.
CP='(^|[;&|(])[[:space:]]*'

blocked=""

# `gh repo edit … --visibility public` (also --visibility=public)
if printf '%s' "$flat" | grep -Eq "${CP}gh +repo +edit" \
   && printf '%s' "$flat" | grep -Eq -- '--visibility[= ]+public([[:space:]]|;|$)'; then
  blocked="gh repo edit --visibility public"
fi

# `gh repo create … --public`. Matched as a whole word so --private is untouched.
if printf '%s' "$flat" | grep -Eq "${CP}gh +repo +create" \
   && printf '%s' "$flat" | grep -Eq -- '--public([[:space:]]|;|$)'; then
  blocked="gh repo create --public"
fi

# `gh api … -X PATCH … visibility=public` / `private=false` against a repos endpoint.
# Requires the write method, so read-only calls (gh api repos/… --jq .visibility) pass.
if printf '%s' "$flat" | grep -Eq "${CP}gh +api" \
   && printf '%s' "$flat" | grep -Eq -- '(-X *PATCH|--method[= ]+PATCH|-XPATCH)' \
   && printf '%s' "$flat" | grep -Eq -- '(visibility["'"'"']?[=:] *["'"'"']?public|private["'"'"']?[=:] *["'"'"']?false)'; then
  blocked="gh api PATCH setting repository visibility"
fi

[ -n "$blocked" ] || exit 0

cat >&2 <<EOF
BLOCKED: $blocked

This repository cannot be made public yet. \`grammars/\` is vendored verbatim from
surfacesyntacticud/tools, which declares NO LICENCE — so there is no grant of redistribution
rights for that subtree, and publishing the repository would republish it without permission.

Read THIRD-PARTY-NOTICES.md (section "Unresolved: grammars/"). The three ways out, in the order
worth trying:

  1. Ask the upstream authors to declare a licence.
  2. Replace the vendored copy with a fetch step that pulls the grammars onto the user's own
     machine at install time.
  3. Drop UD conversion from the shipped build.

Once one of those is done, delete this hook from .claude/settings.json (and this script) in the
same change that resolves the issue — a guard nobody can retire is one people learn to bypass.
EOF
exit 2
