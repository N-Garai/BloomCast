#!/usr/bin/env bash
# verify-no-card.sh — assert nothing in this project requires a credit card.
#
# Fails if it finds: a paid Render plan, a managed DB, a paid Redis, a
# persistent disk, or any other billing reference. Exits 0 when clean.
#
# Run:  bash scripts/verify-no-card.sh

set -o pipefail
fail=0

say() { printf '%s\n' "$*"; }

check_no_paid() {
  local files="$1" label="$2" hits=""
  hits=$(grep -rEi --include='*.yaml' --include='*.yml' --include='*.json' \
            '(plan:[[:space:]]*(starter|standard|pro|plus|enterprise|hobby))' \
            $files 2>/dev/null | grep -vE '^[[:space:]]*#' || true)
  if [[ -n "$hits" ]]; then
    say "FAIL: $label declares a paid plan"; say "$hits"; fail=1
  else
    say "OK  $label - no paid plan"
  fi

  hits=$(sed -E 's/#.*//; s://.*::' $(ls -1 $files 2>/dev/null) 2>/dev/null | grep -iE 'postgres|redis|attachpath|persistent[[:space:]]*:|disk[[:space:]]+size|stripe|billing' || true)
  if [[ -n "$hits" ]]; then
    say "FAIL: $label references a paid resource (managed DB / disk / billing)"; say "$hits"; fail=1
  else
    say "OK  $label - no managed DB, disk, or billing reference"
  fi
}

check_no_paid "render.yaml" "render.yaml"
check_no_paid ".github" "GitHub Actions"

if [[ "$fail" -eq 0 ]]; then
  say ""
  say "PASS: BloomCast runs entirely on free tiers - no credit card required."
else
  say ""
  say "FAIL: a paid resource was found. Review the output above."
fi

exit "$fail"
