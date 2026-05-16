#!/usr/bin/env bash
# v1.0 readiness gate. Runs the full local verification matrix and captures
# the combined output to evidence/v1.0-readiness.<timestamp>.txt. Exits 0
# only if every step passes.
#
# Run from the repo root:
#   bash scripts/v1-readiness-check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="$REPO_ROOT/evidence"
mkdir -p "$EVIDENCE_DIR"
OUT="$EVIDENCE_DIR/v1.0-readiness.$TS.txt"

# Tee everything (stdout + stderr) into the evidence file.
exec > >(tee "$OUT") 2>&1

step() {
  printf '\n=== %s ===\n' "$1"
}
pass() {
  printf 'PASS: %s\n' "$1"
}
fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}

step "Environment"
echo "Node: $(node --version)"
echo "npm:  $(npm --version)"
echo "Docker: $(docker --version 2>&1 | head -1)"
echo "Repo: $REPO_ROOT @ $(git rev-parse HEAD)"

step "Step 1: npm ci (clean install)"
if npm ci; then pass "npm ci"; else fail "npm ci"; fi

step "Step 2: npm run typecheck"
if npm run typecheck; then pass "typecheck"; else fail "typecheck"; fi

step "Step 3: npm run lint"
if npm run lint; then pass "lint"; else fail "lint"; fi

step "Step 4: npm run format:check"
if npm run format:check; then pass "format:check"; else fail "format:check"; fi

step "Step 5: npm run test:unit"
if npm run test:unit; then pass "test:unit"; else fail "test:unit"; fi

step "Step 6: npm run test:property"
if npm run test:property; then pass "test:property"; else fail "test:property"; fi

step "Step 7: npm run test:integration"
if npm run test:integration; then pass "test:integration"; else fail "test:integration"; fi

step "Step 8: node scripts/check-tool-coverage.mjs"
if node scripts/check-tool-coverage.mjs; then pass "tool-coverage"; else fail "tool-coverage"; fi

step "Step 9: npm pack (verify tarball installs + binary --version)"
PACK_DIR="$(mktemp -d)"
# Suppress npm pack's verbose `npm notice` output by sending stderr to /dev/null,
# and use --json for a parseable result.
PACK_JSON="$(npm pack --pack-destination "$PACK_DIR" --json 2>/dev/null)"
TARBALL_NAME="$(echo "$PACK_JSON" | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{ const j=JSON.parse(s); process.stdout.write(j[0].filename); });")"
TARBALL="$PACK_DIR/$TARBALL_NAME"
if [ ! -f "$TARBALL" ]; then
  fail "npm pack did not produce a tarball at $TARBALL"
fi
echo "tarball: $TARBALL"
# Install + run --version in a temp dir.
TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"
npm init -y >/dev/null
if ! npm install --omit=dev "$TARBALL"; then
  fail "npm install of the packed tarball failed"
fi
if ! node node_modules/@jp5lab/flow-otter/dist/bin/flow-otter.js --version >/dev/null; then
  fail "flow-otter.js --version failed from the packed tarball"
fi
echo "tarball version: $(node node_modules/@jp5lab/flow-otter/dist/bin/flow-otter.js --version)"
pass "npm pack + install + --version"
cd "$REPO_ROOT"
rm -rf "$TEST_DIR"

step "Step 10: docker build"
if docker build -f deploy/Dockerfile -t flow-otter:v1-readiness . >/dev/null; then
  pass "docker build"
else
  fail "docker build"
fi

step "Step 11: npm audit (prod deps only)"
if npm audit --omit=dev 2>&1 | tee /tmp/audit.out | tail -3; then
  if grep -q "0 vulnerabilities" /tmp/audit.out; then
    pass "npm audit (prod)"
  else
    fail "npm audit (prod) reported vulnerabilities — see /tmp/audit.out"
  fi
else
  fail "npm audit (prod) failed"
fi

step "Summary"
echo "All v1.0 readiness checks PASSED."
echo "Evidence file: $OUT"
