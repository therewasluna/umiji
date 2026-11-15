#!/usr/bin/env bash
# Rebuilds docs/api/spec.json from the backend source. Run after any API change:
#   ./tools/api-docs/build.sh            (from the umiji repo; the backend repo must sit next to it)
# Needs the backend's node_modules. Touches nothing in the backend: the bundle goes to a temp dir.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
backend="$(cd "$here/../../../backend" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$backend"
BUILD_GEN_DOC=1 npx rspack build --mode development --entry "$here/gen-meta.ts" -o "$tmp/out" >/dev/null
# preview mode never connects, but the config schema wants these set
NODE_PATH="$backend/node_modules" DATABASE_URL='postgresql://x:x@x:5432/x' APP_SECRET="$(printf 'x%.0s' {1..64})" \
    FRONT_END_DOMAIN=x SUB_PUBLIC_DOMAIN=x METRICS_USER=x METRICS_PASS=x REDIS_HOST=localhost REDIS_PORT=6379 \
    INSTANCE_TYPE=api META_OUT="$tmp/meta.json" node "$tmp/out/main.js"
python3 "$here/build-spec.py" "$tmp/meta.json" "$here/../../docs/api/spec.json"
