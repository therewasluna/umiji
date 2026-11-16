#!/usr/bin/env bash
# Seeds the lab 3x-ui 3.x through its API: 4 inbounds, clients attached to several, traffic, a host.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./xui-login.sh
PK=MNRsL8Lx8PW3cKGDQMeC9rCZRqbQzzyTuQWSEm_Fz0A
inb() { X POST /panel/api/inbounds/add -H 'content-type: application/json' -d "$1" | jq -c '{success, msg, id: .obj.id, tag: .obj.tag}'; }
st() { jq -c -n --arg s "$1" '$s'; }
inb "{\"remark\":\"XUI Reality\",\"enable\":true,\"port\":18743,\"protocol\":\"vless\",\"tag\":\"in-18743\",\"settings\":$(st '{"clients":[],"decryption":"none"}'),\"streamSettings\":$(st "{\"network\":\"tcp\",\"security\":\"reality\",\"realitySettings\":{\"show\":false,\"target\":\"www.microsoft.com:443\",\"serverNames\":[\"www.microsoft.com\"],\"privateKey\":\"$PK\",\"shortIds\":[\"\",\"6ba85179e30d4fc2\"],\"settings\":{\"publicKey\":\"9CDYq4NSaC1zuj-1JS9HSusy1_WHsle46Kltw8BW_yk\",\"fingerprint\":\"chrome\"}}}"),\"sniffing\":$(st '{"enabled":true,"destOverride":["http","tls"]}')}"
inb "{\"remark\":\"XUI Trojan\",\"enable\":true,\"port\":18782,\"protocol\":\"trojan\",\"tag\":\"in-18782\",\"settings\":$(st '{"clients":[]}'),\"streamSettings\":$(st '{"network":"ws","security":"none","wsSettings":{"path":"/tr"}}'),\"sniffing\":$(st '{}')}"
inb "{\"remark\":\"XUI SS\",\"enable\":true,\"port\":18783,\"protocol\":\"shadowsocks\",\"tag\":\"in-18783\",\"settings\":$(st '{"method":"chacha20-ietf-poly1305","network":"tcp,udp","clients":[]}'),\"streamSettings\":$(st '{"network":"tcp","security":"none"}'),\"sniffing\":$(st '{}')}"
inb "{\"remark\":\"XUI VMess\",\"enable\":true,\"port\":18781,\"protocol\":\"vmess\",\"tag\":\"in-18781\",\"trafficReset\":\"weekly\",\"settings\":$(st '{"clients":[]}'),\"streamSettings\":$(st '{"network":"ws","security":"none","wsSettings":{"path":"/vm"}}'),\"sniffing\":$(st '{}')}"
X GET /panel/api/inbounds/list | jq -c '[.obj[] | {id, tag, protocol}]'
id() { X GET /panel/api/inbounds/list | jq --arg t "$1" '.obj[] | select(.tag==$t) | .id'; }
R=$(id in-18743); T=$(id in-18782); S=$(id in-18783); V=$(id in-18781)
now=$(( $(date +%s) * 1000 ))
cl() { X POST /panel/api/clients/add -H 'content-type: application/json' -d "$1" | jq -c '{success, msg}'; }
cl "{\"client\":{\"id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"password\":\"xuiAlicePass1234\",\"flow\":\"xtls-rprx-vision\",\"email\":\"x_alice\",\"limitIp\":2,\"totalGB\":53687091200,\"expiryTime\":$((now+30*86400000)),\"enable\":true,\"tgId\":123456789,\"subId\":\"alicesub0000001a\",\"comment\":\"XUI VIP\",\"reset\":30,\"trafficReset\":\"monthly\"},\"inboundIds\":[$R,$T,$S,$V],\"traffic\":{\"up\":1073741824,\"down\":3221225472}}"
cl "{\"client\":{\"id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"flow\":\"xtls-rprx-vision\",\"email\":\"x_bob\",\"totalGB\":0,\"expiryTime\":-604800000,\"enable\":true,\"subId\":\"bobsub000000001b\"},\"inboundIds\":[$R]}"
cl "{\"client\":{\"id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"email\":\"x_carol\",\"expiryTime\":0,\"enable\":false,\"subId\":\"carolsub0000001c\"},\"inboundIds\":[$R,$T]}"
cl "{\"client\":{\"id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"email\":\"x_vmonly\",\"expiryTime\":0,\"enable\":true,\"subId\":\"vmonlysub00001d\"},\"inboundIds\":[$V]}"
cl "{\"client\":{\"password\":\"daveTrojanPass99\",\"email\":\"dave@home.lan\",\"totalGB\":1073741824,\"expiryTime\":$((now+5*86400000)),\"enable\":true,\"subId\":\"davesub00000001e\",\"trafficReset\":\"hourly\"},\"inboundIds\":[$T],\"traffic\":{\"up\":0,\"down\":2147483648}}"
for i in $(seq -w 1 50); do cl "{\"client\":{\"id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"flow\":\"xtls-rprx-vision\",\"email\":\"xload$i\",\"totalGB\":10737418240,\"expiryTime\":$((now+20*86400000)),\"enable\":true,\"subId\":\"xloadsub0000$i\"},\"inboundIds\":[$R,$S]}" >/dev/null; done
X POST /panel/api/hosts/add -H 'content-type: application/json' -d "{\"inboundIds\":[$T],\"remark\":\"XUI CDN\",\"hosts\":[\"cdn.xui.example.com\"],\"port\":443,\"security\":\"tls\",\"sni\":\"cdn.xui.example.com\",\"hostHeader\":\"cdn.xui.example.com\",\"path\":\"/tr\",\"alpn\":[\"h2\",\"http/1.1\"],\"fingerprint\":\"chrome\"}" | jq -c '{success, msg}'
X GET /panel/api/inbounds/list | jq -c '[.obj[] | {tag, clients: (.settings|if type=="string" then fromjson else . end|.clients|length), stats: (.clientStats|length)}]'
