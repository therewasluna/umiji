#!/usr/bin/env bash
# Seeds the lab Remnawave through its API: a profile, 2 squads, hosts, users with every field set.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh; R=http://127.0.0.1:18005/api
H=(-H 'content-type: application/json' -H 'x-forwarded-for: 127.0.0.1' -H 'x-forwarded-proto: https' -H "authorization: Bearer $(cat rw.token)")
api() { local m=$1 p=$2; shift 2; c "${H[@]}" -X "$m" "$R$p" "$@"; }
CFG=$(jq -c '.inbounds |= (map(select(.protocol != "vmess")) | map(.port += 400 | .tag = ("RW " + .tag)))' xray-inbounds.json)
P=$(api POST /config-profiles -d "{\"name\":\"RW Main\",\"config\":$CFG}" | tee /dev/stderr | jq -r .response.uuid)
ib() { api GET /config-profiles/$P | jq -r --arg t "$1" '.response.inbounds[] | select(.tag==$t) | .uuid'; }
V=$(ib 'RW VLESS TCP REALITY'); T=$(ib 'RW Trojan WS'); S=$(ib 'RW Shadowsocks TCP')
S1=$(api POST /internal-squads -d "{\"name\":\"RW Everything\",\"inbounds\":[\"$V\",\"$T\",\"$S\"]}" | jq -r .response.uuid)
S2=$(api POST /internal-squads -d "{\"name\":\"RW Reality\",\"inbounds\":[\"$V\"]}" | jq -r .response.uuid)
echo "squads $S1 $S2"
api POST /hosts -d "{\"inbound\":{\"configProfileUuid\":\"$P\",\"configProfileInboundUuid\":\"$V\"},\"remark\":\"RW Reality {{USERNAME}}\",\"address\":\"rw1.example.com\",\"port\":443,\"sni\":\"www.microsoft.com\",\"fingerprint\":\"chrome\",\"tag\":\"DE\"}" | jq -c '{uuid: .response.uuid, err: .message}'
api POST /hosts -d "{\"inbound\":{\"configProfileUuid\":\"$P\",\"configProfileInboundUuid\":\"$T\"},\"remark\":\"RW Trojan CDN\",\"address\":\"cdn.rw.example.com\",\"port\":443,\"path\":\"/tr\",\"sni\":\"cdn.rw.example.com\",\"host\":\"cdn.rw.example.com\",\"alpn\":\"h2,http/1.1\",\"securityLayer\":\"TLS\",\"isDisabled\":true}" | jq -c '{uuid: .response.uuid, err: .message}'
api POST /hosts -d "{\"inbound\":{\"configProfileUuid\":\"$P\",\"configProfileInboundUuid\":\"$S\"},\"remark\":\"RW SS\",\"address\":\"ss.rw.example.com\",\"port\":18483}" | jq -c '{uuid: .response.uuid, err: .message}'
exp() { date -u -d "@$(( $(date +%s) + $1 ))" +%Y-%m-%dT%H:%M:%S.000Z; }
mk() { api POST /users -d "$1" | jq -c '{u: .response.username, s: .response.shortUuid, err: .message, e: .errors}'; }
mk "{\"username\":\"rw_alice\",\"expireAt\":\"$(exp 2592000)\",\"trafficLimitBytes\":107374182400,\"trafficLimitStrategy\":\"MONTH\",\"description\":\"RW VIP\",\"tag\":\"VIP\",\"telegramId\":555000111,\"email\":\"alice@rw.example.com\",\"hwidDeviceLimit\":4,\"activeInternalSquads\":[\"$S1\"],\"shortUuid\":\"rwAliceShort0001\"}"
mk "{\"username\":\"rw_bob\",\"expireAt\":\"2099-12-31T23:59:59.000Z\",\"trafficLimitStrategy\":\"NO_RESET\",\"activeInternalSquads\":[\"$S2\"]}"
mk "{\"username\":\"rw_off\",\"status\":\"DISABLED\",\"expireAt\":\"$(exp 864000)\",\"activeInternalSquads\":[\"$S1\",\"$S2\"]}"
mk "{\"username\":\"rw_old\",\"expireAt\":\"$(exp -86400)\",\"activeInternalSquads\":[\"$S1\"]}"
for i in $(seq -w 1 30); do mk "{\"username\":\"rwload$i\",\"expireAt\":\"$(exp 2592000)\",\"trafficLimitBytes\":10737418240,\"trafficLimitStrategy\":\"WEEK\",\"activeInternalSquads\":[\"$S1\"]}" >/dev/null; done
api GET '/users?size=1' | jq -c '{total: .response.total}'
