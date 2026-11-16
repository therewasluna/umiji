#!/usr/bin/env bash
# Seeds the lab PasarGuard through its API: a core with 4 inbounds, 2 groups, hosts, users, a second admin.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh
U=https://127.0.0.1:18002
T=$(c -X POST $U/api/admin/token --data-urlencode username=admin --data-urlencode 'password=AdminPass123!' | jq -r .access_token)
api() { local m=$1 p=$2; shift 2; c -X "$m" "$U$p" -H "authorization: Bearer $T" -H 'content-type: application/json' "$@"; }
CFG=$(jq -c '.inbounds |= map(.port += 100)' xray-inbounds.json)
api POST /api/core -d "{\"name\":\"Main Core\",\"type\":\"xray\",\"config\":$CFG,\"exclude_inbound_tags\":[],\"fallbacks_inbound_tags\":[]}" | jq -c '{id,name}'
api POST /api/group -d '{"name":"All protocols","inbound_tags":["VLESS TCP REALITY","Trojan WS","Shadowsocks TCP","VMess WS"]}' | jq -c '{id,name}'
api POST /api/group -d '{"name":"VLESS only","inbound_tags":["VLESS TCP REALITY"]}' | jq -c '{id,name}'
G1=$(api GET /api/groups | jq '.groups[] | select(.name=="All protocols") | .id'); G2=$(api GET /api/groups | jq '.groups[] | select(.name=="VLESS only") | .id')
now=$(date +%s)
exp() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
mk() { api POST /api/user -d "$1" | jq -c '{id, username, status, err: .detail}'; }
mk "{\"username\":\"pg_alice\",\"group_ids\":[$G1],\"expire\":\"$(exp $((now+30*86400)))\",\"data_limit\":53687091200,\"data_limit_reset_strategy\":\"month\",\"note\":\"PG VIP\",\"hwid_limit\":3,\"status\":\"active\",\"proxy_settings\":{\"shadowsocks\":{\"method\":\"aes-256-gcm\"}}}"
mk "{\"username\":\"pg_bob\",\"group_ids\":[$G2],\"expire\":\"$(exp $((now+3*86400)))\",\"data_limit\":0,\"status\":\"active\"}"
mk "{\"username\":\"pg_onhold\",\"group_ids\":[$G1],\"status\":\"on_hold\",\"on_hold_expire_duration\":1209600,\"data_limit\":10737418240,\"data_limit_reset_strategy\":\"year\"}"
mk "{\"username\":\"pg_dis\",\"group_ids\":[$G1,$G2],\"status\":\"disabled\"}"
for i in $(seq -w 1 60); do mk "{\"username\":\"pgload$i\",\"group_ids\":[$G1],\"expire\":\"$(exp $((now+40*86400)))\",\"data_limit\":5368709120,\"status\":\"active\"}" >/dev/null; done
api POST /api/host/ -d '{"remark":"PG Reality {USERNAME}","address":["pg1.example.com","pg2.example.com"],"port":null,"inbound_tag":"VLESS TCP REALITY","sni":["www.microsoft.com"],"fingerprint":"chrome","priority":1}' | jq -c '{id,remark,err:.detail}'
api POST /api/host/ -d '{"remark":"PG Trojan","address":["tr.example.com"],"port":443,"inbound_tag":"Trojan WS","security":"tls","sni":["tr.example.com"],"host":["tr.example.com"],"path":"/tr","alpn":["h2","http/1.1"],"priority":2}' | jq -c '{id,remark,err:.detail}'
api POST /api/host/ -d '{"remark":"PG SS","address":["ss.pg.example.com"],"inbound_tag":"Shadowsocks TCP","priority":3}' | jq -c '{id,remark,err:.detail}'
api GET '/api/users?limit=1' | jq -c '{total}'
