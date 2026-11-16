#!/usr/bin/env bash
# Seeds the lab Marzban through its API.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh
U=https://127.0.0.1:18001
tok() { c -X POST $U/api/admin/token --data-urlencode "username=$1" --data-urlencode "password=$2" | jq -r .access_token; }
T=$(tok admin AdminPass123)
api() { local m=$1 p=$2; shift 2; c -X "$m" "$U$p" -H "authorization: Bearer $T" -H 'content-type: application/json' "$@"; }
now=$(date +%s)
ALL='{"vless":["VLESS TCP REALITY"],"vmess":["VMess WS"],"trojan":["Trojan WS"],"shadowsocks":["Shadowsocks TCP"]}'
PROX='{"vless":{"flow":"xtls-rprx-vision"},"vmess":{},"trojan":{},"shadowsocks":{"method":"chacha20-ietf-poly1305"}}'
mk() { api POST /api/user -d "$1" | jq -c '{username, status, err: .detail}'; }
mk "{\"username\":\"alice\",\"proxies\":$PROX,\"inbounds\":$ALL,\"expire\":$((now+30*86400)),\"data_limit\":53687091200,\"data_limit_reset_strategy\":\"month\",\"note\":\"VIP customer\",\"status\":\"active\"}"
mk "{\"username\":\"bob.smith@mail\",\"proxies\":$PROX,\"inbounds\":$ALL,\"expire\":$((now+10*86400)),\"data_limit\":10737418240,\"data_limit_reset_strategy\":\"no_reset\",\"status\":\"active\"}"
mk "{\"username\":\"carol\",\"proxies\":$PROX,\"inbounds\":$ALL,\"status\":\"on_hold\",\"on_hold_expire_duration\":604800,\"data_limit\":0}"
mk "{\"username\":\"dave\",\"proxies\":{\"vless\":{}},\"inbounds\":{\"vless\":[\"VLESS TCP REALITY\"]},\"expire\":$((now+5*86400)),\"status\":\"active\"}"
api PUT /api/user/dave -d '{"status":"disabled"}' | jq -c '{username, status}'
mk "{\"username\":\"eve\",\"proxies\":$PROX,\"inbounds\":$ALL,\"status\":\"active\"}"
mk "{\"username\":\"frank\",\"proxies\":$PROX,\"inbounds\":$ALL,\"expire\":$((now+20*86400)),\"data_limit\":1073741824,\"data_limit_reset_strategy\":\"week\",\"status\":\"active\"}"
mk "{\"username\":\"ali\",\"proxies\":{\"trojan\":{}},\"inbounds\":{\"trojan\":[\"Trojan WS\"]},\"expire\":$((now-2*86400)),\"status\":\"active\"}"
api POST /api/admin -d '{"username":"reseller1","password":"ResellerPass123","is_sudo":false}' | jq -c '{username}'
for i in $(seq -w 1 120); do mk "{\"username\":\"load$i\",\"proxies\":{\"vless\":{},\"shadowsocks\":{}},\"inbounds\":{\"vless\":[\"VLESS TCP REALITY\"],\"shadowsocks\":[\"Shadowsocks TCP\"]},\"expire\":$((now+60*86400)),\"data_limit\":21474836480,\"status\":\"active\"}" >/dev/null; done
for u in load001 load002 load003; do api PUT "/api/user/$u/set-owner?admin_username=reseller1" | jq -c '{username, admin: .admin.username}'; done
# Hosts: a real address and SNI on the reality inbound, a CDN-style host on VMess WS.
api PUT /api/hosts -d '{"VLESS TCP REALITY":[{"remark":"🇩🇪 Reality {USERNAME}","address":"de1.example.com","port":null,"sni":"www.microsoft.com","fingerprint":"chrome"}],"VMess WS":[{"remark":"CDN {DATA_LEFT}","address":"cdn.example.com","port":443,"host":"ws.example.com","path":"/vm","security":"tls","alpn":"h2,http/1.1"}],"Trojan WS":[{"remark":"Trojan","address":"{SERVER_IP}"}],"Shadowsocks TCP":[{"remark":"SS","address":"ss.example.com"}]}' | jq -c 'keys'
api GET '/api/users?limit=1' | jq -c '{total}'
