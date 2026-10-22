#!/usr/bin/env bash
# Stop hook: if code changed on this branch but CLAUDE.md didn't, ask Claude once
# to update CLAUDE.md (or confirm nothing durable changed). Never loops: it stays
# quiet when already continuing from a stop hook, and reminds only once per
# distinct set of changed files.
input=$(cat)
printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

base=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null)
changed=$(
  {
    [ -n "$base" ] && git diff --name-only "$base" HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } 2>/dev/null | sort -u
)

printf '%s\n' "$changed" | grep -qE '^(app|lib|components|extension|supabase|scripts)/|^(proxy\.ts|vercel\.json|package\.json)$' || exit 0
printf '%s\n' "$changed" | grep -qx 'CLAUDE.md' && exit 0

marker=$(git rev-parse --git-path claude-md-reminder 2>/dev/null) || exit 0
sig=$(printf '%s' "$changed" | cksum | cut -d' ' -f1)
[ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$sig" ] && exit 0
printf '%s' "$sig" > "$marker" 2>/dev/null

cat <<'JSON'
{"decision":"block","reason":"Code changed on this branch but CLAUDE.md didn't. If this work changed anything durable (architecture, a convention, a command, an env var, a marketplace decision, or a gotcha you hit), update CLAUDE.md in the same branch. If nothing durable changed, just finish; this reminder won't repeat for the same changes."}
JSON
