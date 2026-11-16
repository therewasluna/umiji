#!/usr/bin/env bash
# Deletes test-panel users whose names match $1 (a jq regex) and squads/profiles/hosts named in $2 (regex).
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh
. ./env.sh; T=$UMIJI_TOKEN
H=(-H 'content-type: application/json' -H 'x-umiji-client-type: browser' -H 'x-forwarded-for: 127.0.0.1' -H 'x-forwarded-proto: https' -H "authorization: Bearer $T")
B=$UMIJI_URL/api
U=$(c "${H[@]}" "$B/users/stream?size=1000" | jq -c --arg re "$1" '[.response.users[] | select(.username|test($re)) | .id]')
echo "users: $(jq length <<<"$U")"
[[ $(jq length <<<"$U") -gt 0 ]] && c "${H[@]}" -X POST "$B/users/bulk/delete" -d "{\"userIds\":$U}" | jq -c '.response // .'
if [[ -n ${2:-} ]]; then
  for s in $(c "${H[@]}" "$B/internal-squads" | jq -r --arg re "$2" '.response.internalSquads[] | select(.name|test($re)) | .uuid'); do c "${H[@]}" -X DELETE "$B/internal-squads/$s" | jq -c '.response // .'; done
  for p in $(c "${H[@]}" "$B/config-profiles" | jq -r --arg re "$2" '.response.configProfiles[] | select(.name|test($re)) | .uuid'); do
    for h in $(c "${H[@]}" "$B/hosts" | jq -r --arg p "$p" '.response[] | select(.inbound.configProfileUuid==$p) | .uuid'); do c "${H[@]}" -X DELETE "$B/hosts/$h" >/dev/null; done
    c "${H[@]}" -X DELETE "$B/config-profiles/$p" | jq -c '.response // .'; done
fi
