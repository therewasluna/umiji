#!/usr/bin/env bash
# Seeds the lab 3x-ui 2.x: clients live inside each inbound's settings, one email per inbound, joined by subId.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh
U=http://127.0.0.1:18007; J=xui2.cookie; : > $J
c -c $J -X POST $U/login -d 'username=admin&password=AdminPass123' | jq -c '{success, msg}'
X() { local m=$1 p=$2; shift 2; c -b $J -c $J -X "$m" "$U$p" "$@"; }
PK=MNRsL8Lx8PW3cKGDQMeC9rCZRqbQzzyTuQWSEm_Fz0A
now=$(( $(date +%s) * 1000 ))
u() { cat /proc/sys/kernel/random/uuid; }
VCL="[{\"id\":\"$(u)\",\"flow\":\"xtls-rprx-vision\",\"email\":\"v2_alice\",\"limitIp\":3,\"totalGB\":21474836480,\"expiryTime\":$((now+15*86400000)),\"enable\":true,\"tgId\":\"\",\"subId\":\"v2alicesub000001\",\"comment\":\"old 3x-ui\",\"reset\":0},{\"id\":\"$(u)\",\"flow\":\"\",\"email\":\"v2_noflow\",\"limitIp\":0,\"totalGB\":0,\"expiryTime\":0,\"enable\":true,\"tgId\":\"\",\"subId\":\"v2noflowsub00001\",\"reset\":0}"
for i in $(seq -w 1 12); do VCL+=",{\"id\":\"$(u)\",\"flow\":\"xtls-rprx-vision\",\"email\":\"v2load$i\",\"limitIp\":0,\"totalGB\":0,\"expiryTime\":0,\"enable\":true,\"tgId\":\"\",\"subId\":\"v2loadsub0000$i\",\"reset\":0}"; done
VCL+="]"
SET=$(jq -c -n --argjson c "$VCL" '{clients: $c, decryption: "none", fallbacks: []}' | jq -Rs .)
STREAM=$(jq -c -n --arg pk $PK '{network:"tcp",security:"reality",realitySettings:{show:false,dest:"www.microsoft.com:443",serverNames:["www.microsoft.com"],privateKey:$pk,shortIds:["","6ba85179e30d4fc2"],settings:{publicKey:"9CDYq4NSaC1zuj-1JS9HSusy1_WHsle46Kltw8BW_yk",fingerprint:"chrome"}}}' | jq -Rs .)
X POST /panel/api/inbounds/add -H 'content-type: application/json' -d "{\"remark\":\"v2 Reality\",\"enable\":true,\"port\":18843,\"protocol\":\"vless\",\"settings\":$SET,\"streamSettings\":$STREAM,\"sniffing\":$(jq -Rs . <<<'{"enabled":true,"destOverride":["http","tls"]}')}" | jq -c '{success, msg}'
TCL="[{\"password\":\"v2AliceTrojan123\",\"email\":\"v2_alice_tr\",\"limitIp\":3,\"totalGB\":21474836480,\"expiryTime\":$((now+15*86400000)),\"enable\":true,\"tgId\":\"\",\"subId\":\"v2alicesub000001\",\"reset\":0}]"
SET=$(jq -c -n --argjson c "$TCL" '{clients: $c, fallbacks: []}' | jq -Rs .)
X POST /panel/api/inbounds/add -H 'content-type: application/json' -d "{\"remark\":\"v2 Trojan\",\"enable\":true,\"port\":18882,\"protocol\":\"trojan\",\"settings\":$SET,\"streamSettings\":$(jq -Rs . <<<'{"network":"ws","security":"none","wsSettings":{"path":"/tr"}}'),\"sniffing\":$(jq -Rs . <<<'{}')}" | jq -c '{success, msg}'
X GET /panel/api/inbounds/list | jq -c '[.obj[] | {id, tag, settingsType: (.settings|type), clients: (.settings|fromjson|.clients|length)}]'
X POST /panel/setting/all | jq -c '.obj | {subPath, subJsonPath, subPort, subEnable}'
