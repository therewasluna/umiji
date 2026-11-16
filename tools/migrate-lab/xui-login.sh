# Logs in to the lab 3x-ui; sets X (curl wrapper with cookie + csrf).
. ./lib.sh
XU=http://127.0.0.1:18004
: > xui.cookie
CSRF=$(c -c xui.cookie -b xui.cookie $XU/ | grep -o 'name="csrf-token" content="[^"]*"' | sed 's/.*content="//; s/"$//')
c -c xui.cookie -b xui.cookie -X POST $XU/login -H "x-csrf-token: $CSRF" -d 'username=admin&password=AdminPass123' >/dev/null
X() { local m=$1 p=$2; shift 2; c -b xui.cookie -c xui.cookie -X "$m" "$XU$p" -H "x-csrf-token: $CSRF" -H 'x-requested-with: XMLHttpRequest' "$@"; }
