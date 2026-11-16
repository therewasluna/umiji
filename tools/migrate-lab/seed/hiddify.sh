#!/usr/bin/env bash
# Seeds the lab Hiddify panel through its v2 admin API: users of every kind and a sub-admin with users.
set -euo pipefail
cd "$(dirname "$0")/.."; . ./lib.sh
B=http://127.0.0.1:18006/dEJc7Q9F8vWUPLMVbzSnr479oGZOqy/api/v2/admin; K=ad0519b5-bf19-4ec5-a266-8b9fd6ffd9df
api() { local m=$1 p=$2 k=${4:-$K}; c -X "$m" "$B$p" -H "Hiddify-API-Key: $k" -H 'content-type: application/json' -d "$3"; }
d() { date -u -d "$1" +%Y-%m-%d; }
mk() { api POST /user/ "$1" ${2:-} | jq -c '{name, uuid, err: (.msg // .message // null)}'; }
mk "{\"name\":\"hd_alice\",\"usage_limit_GB\":50,\"package_days\":30,\"mode\":\"monthly\",\"start_date\":\"$(d '-5 days')\",\"comment\":\"HD VIP\",\"telegram_id\":777000111,\"enable\":true}"
mk "{\"name\":\"hd_new\",\"usage_limit_GB\":20,\"package_days\":14,\"mode\":\"no_reset\",\"start_date\":null,\"enable\":true}"
mk "{\"name\":\"hd_off\",\"usage_limit_GB\":10,\"package_days\":30,\"mode\":\"weekly\",\"start_date\":\"$(d '-1 days')\",\"enable\":false}"
mk "{\"name\":\"Ali Reza\",\"usage_limit_GB\":5,\"package_days\":10,\"mode\":\"daily\",\"start_date\":\"$(d '-2 days')\",\"enable\":true}"
mk "{\"name\":\"hd_old\",\"usage_limit_GB\":5,\"package_days\":30,\"mode\":\"no_reset\",\"start_date\":\"$(d '-60 days')\",\"enable\":true}"
for i in $(seq -w 1 40); do mk "{\"name\":\"hdload$i\",\"usage_limit_GB\":10,\"package_days\":30,\"mode\":\"no_reset\",\"start_date\":\"$(d '-3 days')\",\"enable\":true}" >/dev/null; done
A=$(api POST /admin_user/ '{"name":"agent1","mode":"agent","can_add_admin":false,"max_users":10,"max_active_users":10}' | tee /dev/stderr | jq -r .uuid)
mk "{\"name\":\"agent_user1\",\"usage_limit_GB\":3,\"package_days\":7,\"mode\":\"no_reset\",\"start_date\":\"$(d '-1 days')\",\"enable\":true}" "$A"
api GET /user/ '' | jq -c 'length'
