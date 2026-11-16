#!/usr/bin/env bash
# Seeds the lab Marzneshin through its API: a marznode, 2 services, hosts, users of every expire kind.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh
U=https://127.0.0.1:18003
T=$(c -X POST $U/api/admins/token -d "username=admin&password=AdminPass123" | jq -r .access_token)
api() { local m=$1 p=$2; shift 2; c -X "$m" "$U$p" -H "authorization: Bearer $T" -H 'content-type: application/json' "$@"; }
[[ $(api GET /api/nodes | jq "[.items[] | select(.name==\"de-node\")] | length") -gt 0 ]] || api POST /api/nodes -d '{"name":"de-node","address":"marznode","port":53042,"connection_backend":"grpclib","usage_coefficient":1}' | jq -c '{id,name,status,err:.detail}'
for i in $(seq 1 20); do n=$(api GET /api/inbounds | jq '.items|length'); [[ $n -gt 0 ]] && break; sleep 2; done
api GET /api/inbounds | jq -c '.items[] | {id,tag,protocol,node:.node.id}'
id() { api GET /api/inbounds | jq --arg t "$1" '.items[] | select(.tag==$t) | .id'; }
V=$(id 'VLESS TCP REALITY'); TR=$(id 'Trojan WS'); SS=$(id 'Shadowsocks TCP'); VM=$(id 'VMess WS')
api POST /api/services -d "{\"name\":\"Full access\",\"inbound_ids\":[$V,$TR,$SS,$VM]}" | jq -c '{id,name}'
api POST /api/services -d "{\"name\":\"Reality only\",\"inbound_ids\":[$V]}" | jq -c '{id,name}'
S1=$(api GET /api/services | jq '.items[] | select(.name=="Full access") | .id'); S2=$(api GET /api/services | jq '.items[] | select(.name=="Reality only") | .id')
api POST /api/inbounds/$V/hosts -d '{"remark":"MZ Reality","address":"mz.example.com","port":443,"sni":"www.microsoft.com","fingerprint":"chrome","security":"inbound_default"}' | jq -c '{id,remark,err:.detail}'
api POST /api/inbounds/$TR/hosts -d '{"remark":"MZ Trojan","address":"trmz.example.com","port":8443,"security":"tls","sni":"trmz.example.com","host":"trmz.example.com","path":"/tr","alpn":"h2"}' | jq -c '{id,remark,err:.detail}'
api POST /api/inbounds/$SS/hosts -d '{"remark":"MZ SS","address":"ssmz.example.com","security":"inbound_default"}' | jq -c '{id,remark,err:.detail}'
exp() { date -u -d "@$(( $(date +%s) + $1 ))" +%Y-%m-%dT%H:%M:%S; }
mk() { api POST /api/users -d "$1" | jq -c '{username, key, expire_strategy, err: .detail}'; }
mk "{\"username\":\"mz_alice\",\"service_ids\":[$S1],\"expire_strategy\":\"fixed_date\",\"expire_date\":\"$(exp 2592000)\",\"data_limit\":32212254720,\"data_limit_reset_strategy\":\"month\",\"note\":\"MZ note\"}"
mk "{\"username\":\"mz_never\",\"service_ids\":[$S2],\"expire_strategy\":\"never\",\"data_limit\":0}"
mk "{\"username\":\"mz_firstuse\",\"service_ids\":[$S1],\"expire_strategy\":\"start_on_first_use\",\"usage_duration\":864000,\"data_limit\":0}"
mk "{\"username\":\"mz_off\",\"service_ids\":[$S1,$S2],\"expire_strategy\":\"never\",\"data_limit\":0}"
api POST /api/users/mz_off/disable | jq -c '{username, enabled}'
for i in $(seq -w 1 40); do mk "{\"username\":\"mzload$i\",\"service_ids\":[$S1],\"expire_strategy\":\"fixed_date\",\"expire_date\":\"$(exp 3456000)\",\"data_limit\":5368709120}" >/dev/null; done
api GET '/api/users?size=1' | jq -c '{total}'
