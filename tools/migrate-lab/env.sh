# Sourced by the lab scripts. UMIJI_URL and UMIJI_TOKEN point at the Umiji panel the users move into:
# a dev backend on a throwaway database, never a real one. umiji.jwt holds an owner login for it.
LAB=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export NO_PROXY='*' no_proxy='*'
export UMIJI_URL=${UMIJI_URL:-http://127.0.0.1:3003} UMIJI_TOKEN=${UMIJI_TOKEN:-$(cat "$LAB/umiji.jwt" 2>/dev/null)}
M=$LAB/../../migrate.mjs
