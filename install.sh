#!/usr/bin/env bash
# Umiji installer: sets up the panel, the sub page or a node in Docker. It asks only what it needs, with
# a default you can take with Enter, and shows one line per step. Run it as root on the server:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/therewasluna/umiji/main/install.sh)
#
# Add panel, sub or node at the end to tick that part in the menu. It also installs itself as the
# umiji command: run on a server that already has Umiji, it shows a menu to install more, update,
# change the owner's password, back up or restore the panel's database, and uninstall.

set -uo pipefail

PANEL_DIR=${UMIJI_DIR:-/opt/umiji}
SUB_DIR=${UMIJI_SUB_DIR:-/opt/umiji-sub}
NODE_DIR=${UMIJI_NODE_DIR:-/opt/umiji-node}
LOG=${UMIJI_LOG:-/var/log/umiji-install.log}
# Where the install files come from. Tests point it at a local copy.
RAW=${UMIJI_RAW:-https://raw.githubusercontent.com/therewasluna}
BRANCH=${UMIJI_BRANCH:-main}
WIKI=https://umiji.wiki
SCRIPT_URL=https://raw.githubusercontent.com/therewasluna/umiji/main/install.sh
SUB_NGINX_URL=https://github.com/therewasluna/umiji-subscription-page/blob/main/DEPLOY.md#your-own-nginx
# Same as generateNodeDockerCompose in the backend contract (constants/nodes/install).
NODE_IMAGE=ghcr.io/therewasluna/umiji-node:latest
# The Subpage preset in Umiji Settings → API Tokens.
SUB_SCOPES='"subscription-page-configs:list","subscription-page-configs:get","subscriptions:subpage-config","system:metadata","users:by-username"'
CMD=/usr/local/bin/umiji
# Same as hashPassword in the backend (common/utils/password): scrypt over an HMAC keyed with APP_SECRET.
HASH_JS='const c=require("crypto");let p="";process.stdin.setEncoding("utf8").on("data",d=>p+=d).on("end",()=>{const k=c.createHmac("sha256",process.env.APP_SECRET).update(p).digest("hex"),s=c.randomBytes(16).toString("hex");process.stdout.write(s+":"+c.scryptSync(k,s,64).toString("hex"))})'
# Adds the node on this server to the panel, from inside the panel's container. It signs a 10-minute
# owner login the way the panel does (HS256 with APP_SECRET, see auth.service.ts), so nobody has to
# type a password. NODE_ACT=key prints the node's SECRET_KEY; NODE_ACT=add creates the node and waits
# for it to connect. Exit 3: no config profile has an inbound. Exit 4: added, not connected yet.
NODE_JS='
const c = require("crypto"), e = process.env, now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const head = b64({ alg: "HS256", typ: "JWT" }) + "." +
    b64({ username: e.OWNER_NAME, uuid: e.OWNER_UUID, role: "ADMIN", iat: now, exp: now + 600 });
const jwt = head + "." + c.createHmac("sha256", e.APP_SECRET).update(head).digest("base64url");
const api = async (method, path, body) => {
    const r = await fetch("http://127.0.0.1:3000/api/" + path, {
        method,
        headers: { authorization: "Bearer " + jwt, "x-umiji-client-type": "browser",
            "x-forwarded-for": "127.0.0.1", "x-forwarded-proto": "https", "content-type": "application/json" },
        body: body && JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + " /api/" + path + ": " + r.status + " " + JSON.stringify(j).slice(0, 300));
    return j.response;
};
(async () => {
    if (e.NODE_ACT === "key") return process.stdout.write((await api("GET", "keygen")).secretKey);
    let node = (await api("GET", "nodes")).find((n) => n.address === e.NODE_ADDR);
    if (node) {
        console.log("The panel already has this node: " + node.name);
    } else {
        const ps = (await api("GET", "config-profiles")).configProfiles.filter((p) => p.inbounds.length);
        const p = ps.find((p) => p.uuid === "00000000-0000-0000-0000-000000000000") || ps[0];
        if (!p) { console.log("No config profile has an inbound yet."); process.exit(3); }
        node = await api("POST", "nodes", { name: e.NODE_NAME, address: e.NODE_ADDR, port: +e.NODE_PORT,
            configProfile: { activeConfigProfileUuid: p.uuid, activeInbounds: p.inbounds.map((i) => i.uuid) } });
        console.log("Added " + node.name + " at " + e.NODE_ADDR + ":" + e.NODE_PORT + " with the profile " + p.name);
    }
    for (let i = 0; i < 30; i++) {
        node = await api("GET", "nodes/" + node.uuid);
        if (node.isConnected) return console.log("The panel is connected to it.");
        await new Promise((r) => setTimeout(r, 3000));
    }
    console.log("Not connected yet. The panel says: " + (node.lastStatusMessage || "nothing"));
    process.exit(4);
})().catch((err) => { console.log(err.message); process.exit(1); });
'
NODE_NAME='Panel server'

# ── Look ──────────────────────────────────────────────────────────────────────────────────────────

setup_term() {
    FANCY=0
    B='' D='' R='' ROSE='' GREEN='' RED='' YELLOW='' CLR=''
    if [[ -t 1 && ${TERM:-dumb} != dumb ]]; then
        FANCY=1
        CLR=$'\r\e[K'
        if [[ -z ${NO_COLOR:-} ]]; then
            B=$'\e[1m' D=$'\e[2m' R=$'\e[0m'
            ROSE=$'\e[38;5;211m' GREEN=$'\e[38;5;114m' RED=$'\e[38;5;203m' YELLOW=$'\e[38;5;221m'
        fi
    fi
    case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
        *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*)
            OK='✓' BAD='✗' WARN='!' DOT='·' BAR='│' ARROW='→' WAVE='≈≈≈'
            SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
            ;;
        *)
            OK='+' BAD='x' WARN='!' DOT='-' BAR='|' ARROW='->' WAVE='~~~'
            # shellcheck disable=SC1003 # a lone backslash, not an escaped quote
            SPIN=('|' '/' '-' '\')
            ;;
    esac
}

say() { printf '  %s\n' "$*"; }
bad() { printf '  %s%s %s%s\n' "$RED" "$BAD" "$*" "$R" >&2; }
warn() { printf '  %s%s%s %s\n' "$YELLOW" "$WARN" "$R" "$*"; }
good() { printf '  %s%s%s %s\n' "$GREEN" "$OK" "$R" "$*"; }
note() { printf '  %s%s%s\n' "$D" "$*" "$R"; }
title() { printf '\n  %s%s%s\n' "$B$ROSE" "$*" "$R"; }

banner() {
    printf '\n'
    printf '  %s%s%s  %sUmiji installer%s\n' "$ROSE" "$WAVE" "$R" "$B" "$R"
    printf '  %s%s%s  %spanel, sub page and nodes, in Docker%s\n' "$ROSE" "$WAVE" "$R" "$D" "$R"
}

fmt_time() {
    local s=$1
    if ((s < 60)); then printf '%ds' "$s"; else printf '%dm %02ds' $((s / 60)) $((s % 60)); fi
}

# Prints the problem and what to do about it, then stops.
die() {
    local what=$1 fix=${2:-} line
    printf '\n'
    bad "$what"
    if [[ -n $fix ]]; then
        printf '\n    %sHow to fix it%s\n' "$B" "$R"
        while IFS= read -r line; do printf '    %s%s%s %s\n' "$ROSE" "$BAR" "$R" "$line"; done <<<"$fix"
    fi
    printf '\n'
    exit 1
}

# ── Input (always from the terminal, so it also works when piped from curl) ───────────────────────

trim() {
    local s=$1
    s=${s#"${s%%[![:space:]]*}"}
    printf '%s' "${s%"${s##*[![:space:]]}"}"
}

# ask VAR "Question" "default" [check] — Enter takes the default. A check prints the cleaned-up
# value, or prints an error and fails.
ask() {
    local var=$1 q=$2 def=${3:-} check=${4:-} ans out
    while :; do
        printf '  %s%s%s' "$B" "$q" "$R"
        [[ -n $def ]] && printf ' %s[%s]%s' "$D" "$def" "$R"
        printf ': '
        IFS= read -r -u 3 ans || exit 1
        ans=$(trim "$ans")
        [[ -z $ans ]] && ans=$def
        if [[ -z $ans ]]; then
            bad "This one is needed."
            continue
        fi
        if [[ -n $check ]]; then
            out=$("$check" "$ans") || continue
            ans=$out
        fi
        printf -v "$var" '%s' "$ans"
        return
    done
}

# ask_secret VAR "Question" — nothing shows while typing or pasting. A terminal line holds 4095
# characters; the longest thing pasted here, the node's secret key, is about 2600.
ask_secret() {
    local var=$1 q=$2 ans
    printf '  %s%s%s %s(it won'\''t show)%s: ' "$B" "$q" "$R" "$D" "$R"
    IFS= read -rs -u 3 ans || exit 1
    printf '\n'
    ans=${ans//$'\e[200~'/}
    ans=${ans//$'\e[201~'/}
    printf -v "$var" '%s' "$(trim "$ans")"
}

confirm() {
    local q=$1 def=$2 ans hint='y/N'
    [[ $def == Y ]] && hint='Y/n'
    while :; do
        printf '  %s%s%s %s[%s]%s ' "$B" "$q" "$R" "$D" "$hint" "$R"
        IFS= read -r -u 3 ans || exit 1
        ans=$(trim "${ans,,}")
        [[ -z $ans ]] && ans=${def,,}
        case $ans in
            y | yes) return 0 ;;
            n | no) return 1 ;;
        esac
        bad "Type y or n."
    done
}

# choose VAR "Question" default "Label|explanation" ...
choose() {
    local var=$1 q=$2 def=$3 i=1 o ans
    shift 3
    printf '  %s%s%s\n' "$B" "$q" "$R"
    for o in "$@"; do
        printf '    %s%d%s  %-16s %s%s%s\n' "$ROSE" "$i" "$R" "${o%%|*}" "$D" "${o#*|}" "$R"
        i=$((i + 1))
    done
    while :; do
        printf '  %sNumber%s %s[%s]%s: ' "$B" "$R" "$D" "$def" "$R"
        IFS= read -r -u 3 ans || exit 1
        ans=$(trim "$ans")
        ans=${ans:-$def}
        [[ $ans =~ ^[0-9]+$ ]] && ((ans >= 1 && ans <= $#)) && break
        bad "Type a number from 1 to $#."
    done
    printf -v "$var" '%s' "$ans"
}

# ── Checks for answers ────────────────────────────────────────────────────────────────────────────

check_domain() {
    local d=${1,,}
    d=${d#http://}
    d=${d#https://}
    d=${d%%/*}
    if [[ $d =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]]; then
        printf '%s' "$d"
    else
        bad "That isn't a domain. Type it like panel.example.com, without https://"
        return 1
    fi
}

check_ip() {
    local ip=$1 o
    if [[ $ip =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
        for o in "${BASH_REMATCH[@]:1}"; do
            if ((10#$o > 255)); then
                bad "That isn't an IP address. One looks like 203.0.113.10"
                return 1
            fi
        done
        printf '%s' "$ip"
    elif [[ $ip == *:*:* && $ip =~ ^[0-9a-fA-F:]+$ ]]; then
        printf '%s' "${ip,,}"
    else
        bad "That isn't an IP address. One looks like 203.0.113.10"
        return 1
    fi
}

check_free_port() {
    local p=$1
    if ! [[ $p =~ ^[0-9]{1,5}$ ]] || ((10#$p < 1 || 10#$p > 65535)); then
        bad "A port is a number from 1 to 65535."
        return 1
    fi
    p=$((10#$p))
    if port_busy "$p"; then
        bad "Port $p is already in use here, by $(port_owner "$p"). Pick another one."
        return 1
    fi
    printf '%s' "$p"
}

check_username() {
    if [[ $1 =~ ^[A-Za-z0-9_.-]{3,32}$ ]]; then
        printf '%s' "$1"
    else
        bad "Use 3 to 32 letters, digits, dots, dashes or underscores."
        return 1
    fi
}

# The panel's rule for the owner's password.
password_ok() { [[ ${#1} -ge 24 && $1 =~ [A-Z] && $1 =~ [a-z] && $1 =~ [0-9] ]]; }

make_password() {
    local p=''
    until password_ok "$p"; do p=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 28); done
    printf '%s' "$p"
}

# ── Facts about this server ───────────────────────────────────────────────────────────────────────

have() { command -v "$1" >/dev/null 2>&1; }
# How to run this again: the umiji command once it's there.
again() { if [[ -x $CMD ]]; then printf 'type umiji to run it'; else printf 'run the installer'; fi; }
compose_ok() { docker compose version >/dev/null 2>&1; }

port_busy() {
    have ss || return 1
    [[ -n $(ss -Hltn "sport = :$1" 2>/dev/null) ]]
}

port_owner() {
    local who
    who=$(ss -Hltnp "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n 1)
    printf '%s' "${who:-another program}"
}

container_running() { [[ $(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null) == true ]]; }

# Ports 80 and 443 are free, or held by Umiji's own Caddy.
web_ports_free() {
    local p
    container_running umiji-caddy || container_running umiji-sub-caddy && return 0
    for p in 80 443; do port_busy "$p" && return 1; done
    return 0
}

public_ip() {
    local u ip
    for u in https://api.ipify.org https://ipv4.icanhazip.com; do
        ip=$(curl -fsS4 -m 6 "$u" 2>/dev/null | tr -d '[:space:]')
        if [[ $ip =~ ^[0-9.]+$ ]]; then
            printf '%s' "$ip"
            return
        fi
    done
}

resolve4() {
    have getent || return 0
    getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//'
}

get_env() { [[ -f $1 ]] && sed -n "s/^$2=//p" "$1" | tail -n 1; }

# set_env FILE KEY VALUE — replaces the line, or adds it. Keeps the file's permissions.
set_env() {
    local f=$1 k=$2 v=$3
    if grep -q "^$k=" "$f"; then
        awk -v k="$k" -v v="$v" 'index($0, k "=") == 1 { $0 = k "=" v } { print }' "$f" >"$f.new" &&
            cat "$f.new" >"$f" && rm -f "$f.new"
    else
        printf '%s=%s\n' "$k" "$v" >>"$f"
    fi
}

# ── Steps: one line each on screen, their output in the log ───────────────────────────────────────

PLAN=()
TMP=''
CUR_PID=''

# plan "Doing" "Done" function
plan() { PLAN+=("$1|$2|$3"); }

hint() { printf '%s\n' "$*" >>"$TMP/hint"; }

# A step that worked, but with something to tell: shown in yellow, and the install goes on.
soft_fail() {
    printf '%s' "$*" >"$TMP/warn"
    return 2
}

# What to do about common errors, from the step's output.
guess_fix() {
    case $1 in
        *'address already in use'* | *'port is already allocated'*)
            echo "Another program already uses a port Umiji needs. See which one: ss -ltnp"
            echo "Stop it, or run the installer again and pick your own nginx for HTTPS."
            ;;
        *'Cannot connect to the Docker daemon'* | *'Is the docker daemon running'*)
            echo "Docker isn't running. Start it: systemctl enable --now docker"
            ;;
        *'no space left'*)
            echo "The disk is full. See what takes the space: df -h"
            echo "Old Docker images can go with: docker image prune -a"
            ;;
        *'manifest unknown'* | *'pull access denied'* | *'denied:'* | *'unauthorized'*)
            echo "The image couldn't be downloaded: ghcr.io doesn't have it, or doesn't let this server in."
            echo "Check the image name in docker-compose.yml, then run the installer again."
            ;;
        *'TLS handshake'* | *'i/o timeout'* | *'Could not resolve'* | *'network is unreachable'* | *'Connection timed out'*)
            echo "This server couldn't reach the internet. Check its DNS (/etc/resolv.conf) and firewall."
            echo "If its network blocks GitHub or Docker, see Troubleshooting: https://github.com/therewasluna/umiji-backend/blob/main/DEPLOY.md#troubleshooting"
            ;;
        *'Unsupported distribution'* | *'unsupported'*)
            echo "Docker's quick installer doesn't know this Linux. Install Docker with your system's"
            echo "package manager (docs.docker.com/engine/install), then run the installer again."
            ;;
    esac
}

run_plan() {
    local total=${#PLAN[@]} n=0 entry doing finished fn tag rc t0 off i out fix msg line
    for entry in "${PLAN[@]}"; do
        doing=${entry%%|*}
        entry=${entry#*|}
        finished=${entry%%|*}
        fn=${entry#*|}
        n=$((n + 1))
        tag="${D}[$n/$total]${R}"
        rm -f "$TMP/hint" "$TMP/warn"
        printf '\n=== [%s] %s\n' "$(date -u '+%F %T')" "$doing" >>"$LOG"
        off=$(wc -c <"$LOG")
        t0=$SECONDS

        if ((FANCY)); then
            ("$fn") >>"$LOG" 2>&1 </dev/null &
            CUR_PID=$!
            i=0
            while kill -0 "$CUR_PID" 2>/dev/null; do
                printf '%s  %s %s%s%s %s %s%s%s' "$CLR" "$tag" "$ROSE" "${SPIN[i % ${#SPIN[@]}]}" "$R" \
                    "$doing" "$D" "$(fmt_time $((SECONDS - t0)))" "$R"
                i=$((i + 1))
                sleep 0.12
            done
            wait "$CUR_PID"
            rc=$?
            CUR_PID=''
        else
            printf '  [%d/%d] %s ...\n' "$n" "$total" "$doing"
            ("$fn") >>"$LOG" 2>&1 </dev/null
            rc=$?
        fi

        if ((rc == 0)); then
            printf '%s  %s %s%s%s %s %s%s%s\n' "$CLR" "$tag" "$GREEN" "$OK" "$R" "$finished" "$D" \
                "$(fmt_time $((SECONDS - t0)))" "$R"
            continue
        fi
        if ((rc == 2)); then
            msg=$(cat "$TMP/warn" 2>/dev/null)
            printf '%s  %s %s%s%s %s\n' "$CLR" "$tag" "$YELLOW" "$WARN" "$R" "${msg:-$finished}"
            continue
        fi

        printf '%s  %s %s%s %s%s\n' "$CLR" "$tag" "$RED" "$BAD" "$doing" "$R"
        out=$(tail -c +$((off + 1)) "$LOG" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -v '^[[:space:]]*$' | tail -n 12)
        fix=$(cat "$TMP/hint" 2>/dev/null)
        [[ -z $fix ]] && fix=$(guess_fix "$out")
        printf '\n    %sWhat happened%s\n' "$B" "$R"
        while IFS= read -r line; do printf '    %s%s %s%s\n' "$D" "$BAR" "${line:0:150}" "$R"; done <<<"${out:-(no output)}"
        if [[ -n $fix ]]; then
            printf '\n    %sHow to fix it%s\n' "$B" "$R"
            while IFS= read -r line; do printf '    %s%s%s %s\n' "$ROSE" "$BAR" "$R" "$line"; done <<<"$fix"
        fi
        if [[ -f $TMP/owner-made ]]; then
            printf '\n    %sYour admin account was made before this, so here it is:%s\n' "$B" "$R"
            show_login | sed 's/^/  /'
        fi
        printf '\n    %sThe whole log: %s%s\n' "$D" "$LOG" "$R"
        printf '    %sWhen it'\''s fixed, %s again. It keeps what it has done so far.%s\n\n' "$D" "$(again)" "$R"
        exit 1
    done
}

# Downloads one install file.
fetch() {
    echo "GET $1"
    if ! curl -fsSL --retry 3 -m 60 -o "$2.new" "$1"; then
        rm -f "$2.new"
        hint "Couldn't download $1"
        hint "Check that this server can open GitHub: curl -I https://raw.githubusercontent.com"
        return 1
    fi
    mv -f "$2.new" "$2"
}

# docker compose pull in DIR. A server that can't download can still use images loaded by hand.
pull_images() {
    cd "$1" || return 1
    docker compose pull && return 0
    local img missing=0
    for img in $(docker compose config --images 2>/dev/null); do
        docker image inspect "$img" >/dev/null 2>&1 || missing=1
    done
    ((missing)) && return 1
    soft_fail "Couldn't download the newest images, so the ones already on this server are used"
}

# Waits until a container is healthy, or has run 15 seconds without restarting.
wait_container() {
    local name=$1 limit=$2 t=0 st r0 r
    r0=$(docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || echo 0)
    while ((t < limit)); do
        st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null)
        r=$(docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || echo 0)
        if ((r > r0)); then
            echo "$name stopped and restarted. Its last log lines:"
            docker logs --tail 25 "$name" 2>&1
            return 1
        fi
        [[ $st == healthy ]] && return 0
        [[ $st == running && $t -ge 15 ]] && return 0
        sleep 3
        t=$((t + 3))
    done
    echo "$name isn't ready after $(fmt_time "$limit") (it says: ${st:-not there}). Its last log lines:"
    docker logs --tail 25 "$name" 2>&1
    return 1
}

# ── Docker ────────────────────────────────────────────────────────────────────────────────────────

s_docker() {
    if ! have docker; then
        curl -fsSL --retry 3 https://get.docker.com -o "$TMP/get-docker.sh" || {
            hint "Couldn't download Docker's installer from get.docker.com. Check this server's internet."
            return 1
        }
        sh "$TMP/get-docker.sh" || return 1
    fi
    if ! docker info >/dev/null 2>&1; then
        systemctl enable --now docker 2>&1 || service docker start 2>&1
        sleep 2
    fi
    if ! docker info >/dev/null 2>&1; then
        hint "Docker is installed but won't start. See why: systemctl status docker"
        return 1
    fi
    if ! compose_ok; then
        if have apt-get; then
            apt-get update -qq && { apt-get install -y -qq docker-compose-plugin || apt-get install -y -qq docker-compose-v2; }
        elif have dnf; then
            dnf install -y -q docker-compose-plugin
        elif have yum; then
            yum install -y -q docker-compose-plugin
        fi
    fi
    if ! compose_ok; then
        hint "Docker Compose v2 is missing and couldn't be added. Install the docker-compose-plugin"
        hint "package (docs.docker.com/compose/install/linux), then run the installer again."
        return 1
    fi
    docker --version
    docker compose version
}

# ── Panel ─────────────────────────────────────────────────────────────────────────────────────────

s_panel_files() {
    local base="$RAW/umiji-backend/$BRANCH/tools/deploy" f="$PANEL_DIR/.env"
    mkdir -p "$PANEL_DIR/caddy" && cd "$PANEL_DIR" || return 1
    fetch "$base/docker-compose.yml" docker-compose.yml || return 1
    fetch "$base/caddy/Caddyfile" caddy/Caddyfile || return 1
    [[ -f $f ]] || fetch "$base/env.example" .env || return 1
    chmod 600 "$f"
    set_env "$f" PANEL_DOMAIN "$PANEL_DOMAIN"
    set_env "$f" SUB_DOMAIN "$SUB_DOMAIN"
    set_env "$f" SUB_PAGE_HERE "$SUB_PAGE_HERE"
    set_env "$f" SUB_PAGE_IP "$SUB_PAGE_IP"
    set_env "$f" COMPOSE_PROFILES "$PANEL_PROFILES"
    echo "Wrote $f"
}

s_panel_pull() { pull_images "$PANEL_DIR"; }
s_panel_start() { cd "$PANEL_DIR" && docker compose up -d; }

s_panel_wait() {
    wait_container umiji 300 && return 0
    hint "See the panel's log: cd $PANEL_DIR && docker compose logs umiji"
    return 1
}

# The sub page runs on this server and reaches the panel inside Docker.
sub_next_to_panel() { [[ $(get_env "$SUB_DIR/.env" UMIJI_PANEL_URL) == http://umiji:3000 ]]; }

# SQL into the panel's database, as its admin.
db_sql() { docker exec -i umiji-db sh -c 'psql -qtAX -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'; }

# A backup is one .tar: database.sql.gz (pg_dump), app_secret (passwords and the brokers' bot tokens
# are keyed to it) and, when the sub page runs here, sub_token, its API token, which lives in the
# database too. Older backups and DEPLOY.md's by-hand ones are a bare .sql.gz.
s_panel_backup() {
    cd "$PANEL_DIR" || return 1
    if ! container_running umiji-db; then
        echo "The database isn't running, so there's nothing to back up."
        return 0
    fi
    umask 077
    local dir out secret files=(database.sql.gz app_secret)
    mkdir -p backups && chmod 700 backups && dir=$(mktemp -d backups/.new-XXXXXX) || return 1
    out="backups/umiji-$(date -u +%Y%m%d-%H%M%S).tar"
    if ! docker exec umiji-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip >"$dir/database.sql.gz"; then
        rm -rf "$dir"
        hint "The backup failed, so nothing was changed. See: cd $PANEL_DIR && docker compose logs umiji-db"
        return 1
    fi
    # A value in .env wins over the file, so that's the one the panel uses.
    secret=$(get_env .env APP_SECRET)
    [[ -n $secret ]] || secret=$(cat secrets/app_secret 2>/dev/null)
    printf '%s' "$secret" >"$dir/app_secret"
    if sub_next_to_panel; then
        get_env "$SUB_DIR/.env" UMIJI_API_TOKEN >"$dir/sub_token"
        files+=(sub_token)
    fi
    if ! tar -cf "$out" -C "$dir" "${files[@]}"; then
        rm -rf "$dir" "$out"
        return 1
    fi
    rm -rf "$dir"
    printf '%s' "$PANEL_DIR/$out" >"$TMP/backup-file"
    echo "Saved $PANEL_DIR/$out"
}

is_bundle() { tar -tf "$1" database.sql.gz >/dev/null 2>&1; }

# Prints the backup's SQL.
dump_sql() {
    if is_bundle "$1"; then tar -xOf "$1" database.sql.gz | gunzip -c; else gunzip -c "$1"; fi
}

# A backup file to restore: it must be a whole pg_dump (its last line says so), or nothing is touched.
check_backup() {
    local f=${1/#\~/$HOME}
    if [[ ! -f $f ]]; then
        bad "There's no file at $f"
        return 1
    fi
    if ! grep -q 'PostgreSQL database dump complete' < <(dump_sql "$f" 2>/dev/null | tail -c 512); then
        bad "That isn't a whole Umiji backup. Pick a .tar file that umiji made, or a .sql.gz database dump."
        return 1
    fi
    readlink -f "$f"
}

s_restore_stop() { cd "$PANEL_DIR" && docker compose stop umiji; }

# One transaction: if any of it fails, the database stays as it was.
s_restore_db() {
    cd "$PANEL_DIR" || return 1
    local secret token
    if ! { printf 'DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n' && dump_sql "$RESTORE_FILE"; } |
        docker exec -i umiji-db sh -c 'psql -q -X -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" "$POSTGRES_DB"' >/dev/null; then
        docker compose start umiji >/dev/null 2>&1
        hint "Nothing was changed: the database is as it was, and the panel is running again."
        hint "If the backup comes from a newer panel, update this one first: type umiji and pick Update all."
        return 1
    fi
    echo "Database restored from $RESTORE_FILE"
    if is_bundle "$RESTORE_FILE"; then
        secret=$(tar -xOf "$RESTORE_FILE" app_secret 2>/dev/null)
        if [[ -n $secret && $secret != *[[:space:]]* ]]; then
            if [[ -n $(get_env .env APP_SECRET) ]]; then
                set_env .env APP_SECRET "$secret"
            else
                (umask 077 && printf '%s' "$secret" >secrets/app_secret)
            fi
            echo "APP_SECRET restored"
        fi
        token=$(tar -xOf "$RESTORE_FILE" sub_token 2>/dev/null)
        if [[ $token =~ ^[A-Za-z0-9._-]+$ ]] && ((HAVE[1])) && sub_next_to_panel; then
            set_env "$SUB_DIR/.env" UMIJI_API_TOKEN "$token"
            echo "The sub page's API token restored"
        fi
    fi
    # Valkey keeps nothing on disk, so a restart empties the cache of the old database's settings.
    docker compose restart umiji-redis
}

# After a restore the sub page's token must be one the restored database knows.
s_restore_sub() {
    local code
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'X-Forwarded-For: 127.0.0.1' -H 'X-Forwarded-Proto: https' \
        -H "@"<(printf 'Authorization: Bearer %s\n' "$(get_env "$SUB_DIR/.env" UMIJI_API_TOKEN)") \
        http://127.0.0.1:3000/api/system/metadata)
    if [[ $code == 401 || $code == 403 ]]; then
        touch "$TMP/sub-token-bad"
        soft_fail "The restored panel doesn't know the sub page's API token. See below"
        return
    fi
    cd "$SUB_DIR" && docker compose up -d --force-recreate umiji-subscription-page && s_sub_wait
}

# ── The owner's password ──────────────────────────────────────────────────────────────────────────

# Sets a new password on the owner account, and turns password login back on in case it was off.
s_owner_password() {
    local hash db
    # shellcheck disable=SC2016 # $1 is for the container's shell
    hash=$(printf '%s' "$ADMIN_PASS" |
        docker exec -i umiji sh -c '. /opt/app/docker-secrets.sh && load_secrets && exec node -e "$1"' sh "$HASH_JS")
    if ! [[ $hash =~ ^[0-9a-f]{32}:[0-9a-f]{128}$ ]]; then
        echo "The panel couldn't make the password's hash."
        return 1
    fi
    db_sql <<SQL || return 1
UPDATE admin SET password_hash = '$hash', updated_at = now() WHERE role = 'ADMIN';
UPDATE umiji_settings SET password_settings = jsonb_set(coalesce(password_settings, '{}'::jsonb), '{enabled}', 'true');
SQL
    db=$(get_env "$PANEL_DIR/.env" REDIS_DB)
    docker exec umiji-redis valkey-cli -s /var/run/valkey/valkey.sock -n "${db:-1}" DEL ioraw:umiji_settings
    echo "Password changed and password login is on."
}

# ── The umiji command and uninstalling ────────────────────────────────────────────────────────────

# Installs this script as the umiji command: the file it runs from, or else the published one.
s_command() {
    if [[ -f $0 && $(readlink -f "$0") != "$CMD" ]]; then
        cp -f "$0" "$CMD.new" && mv -f "$CMD.new" "$CMD"
    else
        fetch "$RAW/umiji/$BRANCH/install.sh" "$CMD" ||
            soft_fail "Couldn't download the umiji command. It's added the next time this runs"
    fi
    chmod 755 "$CMD" 2>/dev/null
    return 0
}

# Removes images the part used. Docker keeps any another container still uses.
rm_images() {
    local i
    for i in "$@"; do docker image rm "$i" >/dev/null 2>&1 && echo "Removed image $i"; done
    return 0
}

# Stops and removes a part's containers, then its folder. KEEP keeps the panel's data.
remove_part() {
    local dir=$1 keep=${2:-0} imgs
    cd "$dir" || return 1
    imgs=$(docker compose config --images 2>/dev/null)
    if ((keep)); then
        docker compose down --remove-orphans || return 1
        rm -f docker-compose.yml
    else
        docker compose down --volumes --remove-orphans || return 1
        # The backups stay.
        find . -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf {} +
        cd / && rmdir "$dir" 2>/dev/null
    fi
    # shellcheck disable=SC2086 # one image per word
    rm_images $imgs
}

s_rm_panel() { remove_part "$PANEL_DIR" "$KEEP_DATA"; }
s_rm_sub() { remove_part "$SUB_DIR" "$SUB_KEEP"; }
s_rm_node() { remove_part "$NODE_DIR"; }
s_rm_command() { rm -f "$CMD"; }

# Talks to the panel on this server. The panel only answers requests that came through an HTTPS
# proxy, so the two forwarded headers stand in for one.
panel_api() {
    local method=$1 path=$2 auth=${3:-}
    local args=(-sS -m 20 -X "$method" "http://127.0.0.1:3000/api/$path"
        -H 'X-Forwarded-For: 127.0.0.1' -H 'X-Forwarded-Proto: https' -H 'Content-Type: application/json')
    # The owner's login only works from the panel's own pages. Making the sub page's token at install
    # time is the owner's setup, so it says it's one of them.
    [[ -n $auth ]] && args+=(-H "@$auth" -H 'X-Umiji-Client-Type: browser')
    [[ $method == POST ]] && args+=(--data-binary @-)
    curl "${args[@]}"
}

# none: the panel has no owner yet. exists: it has one. unknown: the panel isn't answering.
owner_state() {
    local s
    s=$(panel_api GET auth/status 2>/dev/null)
    case $s in
        *'"isRegisterAllowed":true'*) echo none ;;
        *isRegisterAllowed*) echo exists ;;
        *) echo unknown ;;
    esac
}

json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }

json_escape() {
    local s=${1//\\/\\\\}
    printf '%s' "${s//\"/\\\"}"
}

# Makes the owner account, then the sub page's API token when the sub page is installed here too.
# The password and the tokens stay out of the log.
s_panel_owner() {
    local state res jwt token t=0
    until state=$(owner_state) && [[ $state != unknown ]]; do
        if ((t >= 90)); then
            echo "The panel's API didn't answer on 127.0.0.1:3000."
            return 1
        fi
        sleep 3
        t=$((t + 3))
    done
    if [[ $state == exists ]]; then
        echo "The panel already has an owner account."
        ((OWNER_QUIET)) && return 0
        soft_fail "The panel already has an owner account, so no new one was made"
        return
    fi
    res=$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USER" "$(json_escape "$ADMIN_PASS")" |
        panel_api POST auth/register)
    jwt=$(json_field accessToken <<<"$res")
    if [[ -z $jwt ]]; then
        echo "The panel refused the new account: ${res:0:300}"
        return 1
    fi
    echo "Owner account $ADMIN_USER created."
    touch "$TMP/owner-made"
    ((MAKE_TOKEN)) || return 0

    printf 'Authorization: Bearer %s\n' "$jwt" >"$TMP/auth"
    res=$(printf '{"name":"Sub page","expiresInDays":3650,"scopes":[%s]}' "$SUB_SCOPES" |
        panel_api POST tokens "$TMP/auth")
    rm -f "$TMP/auth"
    token=$(json_field token <<<"$res")
    if [[ -z $token ]]; then
        echo "The panel didn't make an API token: ${res:0:300}"
        hint "Sign in to the panel and make one: Umiji Settings $ARROW API Tokens $ARROW Create API token, with the Subpage preset."
        hint "Then run the installer again, tick Sub page, and paste it."
        return 1
    fi
    printf '%s' "$token" >"$TMP/sub-token"
    echo "API token for the sub page created."
}

s_panel_cert() {
    local t=0 logs
    while ((t < 120)); do
        logs=$(docker logs umiji-caddy 2>&1)
        grep -q "certificate obtained successfully.*\"$PANEL_DOMAIN\"" <<<"$logs" && return 0
        sleep 4
        t=$((t + 4))
    done
    grep -iF "$PANEL_DOMAIN" <<<"$logs" | grep -i error | tail -n 3
    soft_fail "No certificate for $PANEL_DOMAIN yet. Caddy keeps trying; check the domain's DNS"
}

# ── Sub page ──────────────────────────────────────────────────────────────────────────────────────

s_sub_files() {
    local base="$RAW/umiji-subscription-page/$BRANCH/deploy" f="$SUB_DIR/.env" token
    token=${SUB_TOKEN:-$(cat "$TMP/sub-token" 2>/dev/null)}
    # Left by an uninstall that kept the data.
    [[ -n $token ]] || token=$(get_env "$f" UMIJI_API_TOKEN)
    if [[ -z $token ]]; then
        echo "There's no API token for the sub page."
        hint "Sign in to the panel and make one: Umiji Settings $ARROW API Tokens $ARROW Create API token, with the Subpage preset."
        hint "Then run the installer again, tick Sub page, and paste it."
        return 1
    fi
    mkdir -p "$SUB_DIR/caddy" && cd "$SUB_DIR" || return 1
    fetch "$base/docker-compose.yml" docker-compose.yml || return 1
    fetch "$base/caddy/Caddyfile" caddy/Caddyfile || return 1
    [[ -f $f ]] || fetch "$base/env.example" .env || return 1
    chmod 600 "$f"
    set_env "$f" SUB_DOMAIN "$SUB_DOMAIN"
    set_env "$f" UMIJI_PANEL_URL "$SUB_PANEL_URL"
    set_env "$f" UMIJI_API_TOKEN "$token"
    set_env "$f" COMPOSE_PROFILES "$SUB_PROFILES"
    echo "Wrote $f"
}

# On the panel's server the panel's Caddy serves the sub page, so it has to know the sub page is here.
s_sub_tell_panel() {
    set_env "$PANEL_DIR/.env" SUB_PAGE_HERE yes
    set_env "$PANEL_DIR/.env" SUB_PAGE_IP ''
    cd "$PANEL_DIR" && docker compose up -d
}

s_sub_pull() { pull_images "$SUB_DIR"; }
s_sub_start() { cd "$SUB_DIR" && docker compose up -d; }

s_sub_wait() {
    wait_container umiji-subscription-page 60 && return 0
    hint "Usually the API token or the panel's address in $SUB_DIR/.env is wrong."
    hint "Fix UMIJI_API_TOKEN or UMIJI_PANEL_URL there, then: cd $SUB_DIR && docker compose up -d"
    return 1
}

# ── Node ──────────────────────────────────────────────────────────────────────────────────────────

# Runs NODE_JS in the panel's container as its owner. Arguments are NAME=value pairs for it.
node_api() {
    local owner env=() kv
    owner=$(db_sql <<<"SELECT username || '|' || uuid FROM admin WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1;")
    if [[ $owner != *'|'* ]]; then
        echo "The panel has no owner account yet, so it can't add the node."
        hint "Sign in to the panel once it has an owner, then $(again) again and tick Node."
        return 1
    fi
    for kv in "OWNER_NAME=${owner%%|*}" "OWNER_UUID=${owner#*|}" "$@"; do env+=(-e "$kv"); done
    # shellcheck disable=SC2016 # $1 is for the container's shell
    docker exec "${env[@]}" umiji sh -c '. /opt/app/docker-secrets.sh && load_secrets && exec node -e "$1"' sh "$NODE_JS"
}

# The first IPv4 gateway or subnet of the panel's Docker network. The panel reaches a node on this
# server at the gateway, which works on clouds whose public IP isn't on the server itself.
panel_net() {
    docker network inspect umiji-network -f "{{range .IPAM.Config}}{{.$1}} {{end}}" 2>/dev/null |
        tr ' ' '\n' | grep -m 1 -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$'
}

s_node_key() {
    local key
    key=$(node_api NODE_ACT=key) || {
        echo "$key"
        hint "The panel has to run for this. Start it: cd $PANEL_DIR && docker compose up -d"
        return 1
    }
    printf '%s' "$key" >"$TMP/node-secret"
    echo "Got the node's secret key from the panel (${#key} characters)."
}

s_node_add() {
    local addr rc
    addr=$(panel_net Gateway)
    if [[ -z $addr ]]; then
        echo "Couldn't find the address of the umiji-network Docker network."
        hint "Add the node in the panel: Nodes $ARROW Create node $ARROW Manual setup, with this server's IP and port $NODE_PORT."
        return 1
    fi
    node_api NODE_ACT=add "NODE_ADDR=$addr" "NODE_PORT=$NODE_PORT" "NODE_NAME=$NODE_NAME"
    rc=$?
    case $rc in
        0) touch "$TMP/node-added" ;;
        3) soft_fail "No config profile has an inbound yet, so the node wasn't added. Add it in the panel" ;;
        4)
            touch "$TMP/node-added"
            soft_fail "The node is in the panel as $NODE_NAME, but isn't connected yet. See the log"
            ;;
        *)
            hint "Add the node in the panel instead: Nodes $ARROW Create node $ARROW Manual setup, address $addr, port $NODE_PORT."
            return 1
            ;;
    esac
}

s_node_files() {
    [[ -n $NODE_SECRET ]] || NODE_SECRET=$(cat "$TMP/node-secret" 2>/dev/null)
    mkdir -p "$NODE_DIR" && cd "$NODE_DIR" || return 1
    cat >docker-compose.yml <<EOF
services:
  umiji-node:
    container_name: umiji-node
    hostname: umiji-node
    image: $NODE_IMAGE
    network_mode: host
    restart: always
    cap_add:
      - NET_ADMIN
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576
    environment:
      - NODE_PORT=$NODE_PORT
      - SECRET_KEY="$NODE_SECRET"
EOF
    chmod 600 docker-compose.yml
    echo "Wrote $NODE_DIR/docker-compose.yml"
}

s_node_firewall() {
    local from=$NODE_PANEL_IP
    ((NODE_AUTO)) && from=$(panel_net Subnet)
    [[ -n $from ]] || return 1
    ufw allow from "$from" to any port "$NODE_PORT" proto tcp
}
s_node_pull() { pull_images "$NODE_DIR"; }
s_node_start() { cd "$NODE_DIR" && docker compose up -d; }

s_node_wait() {
    local port t=0
    port=$(sed -n 's/.*NODE_PORT=\([0-9]*\).*/\1/p' "$NODE_DIR/docker-compose.yml")
    while ((t < 60)); do
        [[ -n $(ss -Hltn "sport = :$port" 2>/dev/null) ]] && return 0
        container_running umiji-node || break
        sleep 3
        t=$((t + 3))
    done
    echo "The node isn't listening on port $port. Its last log lines:"
    docker logs --tail 25 umiji-node 2>&1
    hint "If the log talks about SECRET_KEY, copy the secret key from the panel again and run the"
    hint "installer again."
    return 1
}

s_prune() { docker image prune -f; }

# ── Questions ─────────────────────────────────────────────────────────────────────────────────────

pick_parts() {
    local names=(Panel 'Sub page' Node)
    local about=('where you manage users, nodes and resellers'
        'the page your users open from their link'
        'carries your users'\'' traffic')
    local ans c d i box tagline msg='' first=1
    while :; do
        ((!first && FANCY)) && printf '\e[5A'
        first=0
        for i in 0 1 2; do
            box='[ ]'
            tagline=''
            ((PICK[i])) && box="[${GREEN}x${R}]"
            ((HAVE[i])) && tagline="  ${YELLOW}installed, tick to update${R}"
            printf '%s    %s %s%d%s  %-9s %s%s%s%s\n' "$CLR" "$box" "$ROSE" $((i + 1)) "$R" "${names[i]}" \
                "$D" "${about[i]}" "$R" "$tagline"
        done
        printf '%s    %s\n' "$CLR" "${msg:-${D}Type a number to tick or untick it, then press Enter.${R}}"
        printf '%s  %sYour choice%s: ' "$CLR" "$B" "$R"
        IFS= read -r -u 3 ans || exit 1
        ans=$(trim "$ans")
        msg=''
        if [[ -z $ans ]]; then
            ((PICK[0] || PICK[1] || PICK[2])) && break
            msg="${RED}Tick at least one: type 1, 2 or 3.${R}"
            continue
        fi
        for ((c = 0; c < ${#ans}; c++)); do
            d=${ans:c:1}
            case $d in
                [123])
                    i=$((d - 1))
                    PICK[i]=$((1 - PICK[i]))
                    ;;
                [[:space:],]) ;;
                *) msg="${RED}Only 1, 2 and 3 do something here.${R}" ;;
            esac
        done
    done
    WANT_PANEL=${PICK[0]} WANT_SUB=${PICK[1]} WANT_NODE=${PICK[2]}
}

# Warns when a domain doesn't point at this server. Behind Cloudflare's orange cloud that's expected.
check_dns() {
    local d=$1 ips
    [[ -z $SERVER_IP ]] && return 0
    ips=$(resolve4 "$d")
    if [[ -z $ips ]]; then
        warn "$d doesn't point anywhere yet. Give it an A record with the value $SERVER_IP"
        note "    How: $WIKI/guide/#dns. The certificate arrives on its own once it points here."
        DNS_LATER+=("$d")
    elif [[ " $ips " != *" $SERVER_IP "* ]]; then
        warn "$d points at $ips, not at this server ($SERVER_IP)."
        note "    Behind Cloudflare's orange cloud that's expected. If not, change its A record to $SERVER_IP."
        DNS_LATER+=("$d")
    else
        good "$d points at this server"
    fi
}

ask_https() {
    local var=$1 who=$2 pick
    choose pick "How should $who get HTTPS?" 1 \
        "Built-in|Caddy gets and renews the certificates itself (recommended)" \
        "My own nginx|for a server that already runs other websites"
    if ((pick == 1)) && ! web_ports_free; then
        warn "Built-in HTTPS needs ports 80 and 443, but this server already uses them for something else."
        if confirm "Use your own nginx instead?" Y; then
            pick=2
        else
            die "Ports 80 and 443 are in use." "Stop what uses them (for nginx: systemctl disable --now nginx),
then run the installer again."
        fi
    fi
    if ((pick == 1)); then printf -v "$var" caddy; else printf -v "$var" ''; fi
}

ask_admin() {
    ask ADMIN_USER "Admin username" admin check_username
    ask_password
    MAKE_OWNER=1 OWNER_QUIET=0
}

ask_password() {
    local p1 p2
    while :; do
        ask_secret p1 "Admin password, or Enter to make a strong one"
        if [[ -z $p1 ]]; then
            ADMIN_PASS=$(make_password) ADMIN_PASS_MADE=1
            good "A strong password will be made. You'll see it at the end."
            break
        fi
        if ! password_ok "$p1"; then
            bad "It needs 24 characters or more, with capital letters, small letters and digits."
            continue
        fi
        ask_secret p2 "The same password again"
        if [[ $p1 == "$p2" ]]; then
            ADMIN_PASS=$p1 ADMIN_PASS_MADE=0
            break
        fi
        bad "The two passwords aren't the same. Try again."
    done
}

questions_panel() {
    title "Panel"
    if ((HAVE[0])); then
        PANEL_DOMAIN=$(get_env "$PANEL_DIR/.env" PANEL_DOMAIN)
        SUB_DOMAIN=$(get_env "$PANEL_DIR/.env" SUB_DOMAIN)
        PANEL_PROFILES=$(get_env "$PANEL_DIR/.env" COMPOSE_PROFILES)
        SUB_PAGE_HERE=$(get_env "$PANEL_DIR/.env" SUB_PAGE_HERE)
        say "It's in $PANEL_DIR ($PANEL_DOMAIN) and gets the newest version. Its settings stay."
        case $(owner_state) in
            none)
                note "It has no admin account yet. Make one now; the first account owns the panel."
                ask_admin
                ;;
            # A first install that stopped early: an owner is made if the panel still has none.
            unknown)
                ADMIN_USER=admin ADMIN_PASS=$(make_password) ADMIN_PASS_MADE=1
                MAKE_OWNER=1 OWNER_QUIET=1
                ;;
        esac
        return 0
    fi
    note "Both domains must point at this server: an A record each, with the value $IP_TEXT."
    note "Not done yet? Here's how: $WIKI/guide/#dns"
    ask PANEL_DOMAIN "Panel domain, e.g. panel.example.com" '' check_domain
    local guess="sub.${PANEL_DOMAIN#*.}"
    [[ $PANEL_DOMAIN == *.*.* ]] || guess="sub.$PANEL_DOMAIN"
    while :; do
        ask SUB_DOMAIN "Sub page domain" "$guess" check_domain
        [[ $SUB_DOMAIN != "$PANEL_DOMAIN" ]] && break
        bad "The sub page needs a domain of its own, not the panel's."
    done

    if ((!WANT_SUB && !HAVE[1])); then
        local where
        choose where "Where will the sub page run?" 1 \
            "On this server|install it now or later with this installer" \
            "Another server|this panel then trusts that server's IP"
        if ((where == 2)); then
            SUB_PAGE_HERE=no
            ask SUB_PAGE_IP "That server's IP address" '' check_ip
        fi
    fi
    ask_https PANEL_PROFILES "the panel"

    printf '\n'
    note "Your admin account. The first account owns the panel, so making it now means nobody else can."
    ask_admin

    printf '\n'
    check_dns "$PANEL_DOMAIN"
    [[ $SUB_PAGE_HERE == yes ]] && check_dns "$SUB_DOMAIN"
    return 0
}

ask_token() {
    note "It needs an API token. In the panel: Umiji Settings $ARROW API Tokens $ARROW Create API token."
    note "Pick the Subpage preset, press Create, and copy the token."
    while :; do
        ask_secret SUB_TOKEN "Paste the API token"
        [[ -n $SUB_TOKEN ]] && break
        bad "This one is needed."
    done
}

questions_sub() {
    title "Sub page"
    if ((HAVE[1])); then
        SUB_DOMAIN=$(get_env "$SUB_DIR/.env" SUB_DOMAIN)
        say "It's in $SUB_DIR ($SUB_DOMAIN) and gets the newest version. Its settings stay."
        return 0
    fi
    if ((WANT_PANEL || HAVE[0])); then
        # Next to the panel: the panel's sub domain, its network and its HTTPS.
        [[ -z $SUB_DOMAIN ]] && SUB_DOMAIN=$(get_env "$PANEL_DIR/.env" SUB_DOMAIN)
        SUB_PANEL_URL=http://umiji:3000 SUB_PROFILES=''
        say "It runs next to the panel, at https://$SUB_DOMAIN, and uses the panel's HTTPS."
        if ((!MAKE_OWNER)) && ((HAVE[0])); then
            case $(owner_state) in
                none)
                    note "The panel has no admin account yet. Make one now; the first account owns the panel."
                    ask_admin
                    ;;
                *) ask_token ;;
            esac
        fi
        if ((MAKE_OWNER)) && [[ -z $SUB_TOKEN ]]; then
            MAKE_TOKEN=1
            note "Its API token is made for you once the panel runs."
        fi
        return 0
    fi

    SUB_ALONE=1
    note "This server runs only the sub page. Its domain must point here: an A record with the value $IP_TEXT."
    ask SUB_DOMAIN "Sub page domain, e.g. sub.example.com" '' check_domain
    local panel_domain code
    while :; do
        ask panel_domain "Your panel's domain" '' check_domain
        [[ $panel_domain != "$SUB_DOMAIN" ]] && break
        bad "That's the sub page's domain. Type the panel's."
    done
    SUB_PANEL_URL="https://$panel_domain"
    while :; do
        ask_token
        code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "@"<(printf 'Authorization: Bearer %s\n' "$SUB_TOKEN") \
            "$SUB_PANEL_URL/api/system/metadata")
        case $code in
            200)
                good "The panel accepted the token"
                break
                ;;
            401 | 403) bad "The panel at $SUB_PANEL_URL refused this token. Copy it again; it's shown only once." ;;
            *)
                warn "Couldn't check the token: $SUB_PANEL_URL didn't answer from here (code $code)."
                confirm "Use it anyway?" Y && break
                ;;
        esac
    done
    ask_https SUB_PROFILES "the sub page"
    printf '\n'
    check_dns "$SUB_DOMAIN"
}

questions_node() {
    title "Node"
    if ((HAVE[2])); then
        say "It's in $NODE_DIR and gets the newest version. Its settings stay."
        return 0
    fi
    if ((WANT_PANEL || HAVE[0])); then
        NODE_AUTO=1
        say "It runs next to the panel, and the installer adds it to the panel's Nodes for you."
        [[ -n ${PANEL_PROFILES:-$(get_env "$PANEL_DIR/.env" COMPOSE_PROFILES)} ]] &&
            note "The panel's Caddy holds ports 80 and 443 here, so give this node's inbounds other ports."
        ask NODE_PORT "Node port, which the panel connects to" 2222 check_free_port
        have ufw && ufw status 2>/dev/null | grep -q '^Status: active' && NODE_UFW=1
        return 0
    fi
    note "The easiest way to add a node is from the panel: Nodes $ARROW Create node $ARROW Automatic install."
    note "It logs in to this server and does all of this. This installer is for Manual setup."
    ask NODE_PORT "Node port, which the panel connects to" 2222 check_free_port
    note "In the panel's Create node, on Manual setup, copy the Secret key."
    while :; do
        ask_secret NODE_SECRET "Paste the secret key"
        NODE_SECRET=${NODE_SECRET//[[:space:]\"]/}
        NODE_SECRET=${NODE_SECRET##*SECRET_KEY=}
        local decoded
        decoded=$(printf '%s' "$NODE_SECRET" | base64 -d 2>/dev/null)
        if [[ $decoded == *'"caCertPem"'* && $decoded == *'"nodeKeyPem"'* ]]; then
            good "That's a secret key (${#NODE_SECRET} characters)"
            break
        fi
        bad "That isn't the node's secret key. Copy the whole Secret key field from the panel and paste it again."
    done
    if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
        note "This server's firewall (ufw) is on, so it has to let the panel in."
        ask NODE_PANEL_IP "Your panel server's IP address" '' check_ip
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────────────────────────

cleanup() {
    if [[ -n $CUR_PID ]]; then
        pkill -P "$CUR_PID" 2>/dev/null
        kill "$CUR_PID" 2>/dev/null
    fi
    [[ -n $TMP ]] && rm -rf "$TMP"
    stty echo <&3 2>/dev/null
    ((FANCY)) && printf '\e[?25h'
}

on_interrupt() {
    printf '\n\n'
    warn "Stopped. Whenever you like, $(again) again: it keeps what it has done so far."
    exit 130
}

preflight() {
    title "This server"
    ((EUID == 0)) || die "The installer needs root." "Type: sudo -i
Then run the same command again."
    [[ $(uname -s) == Linux ]] || die "Umiji runs on Linux servers only."
    local arch os mem disk
    case $(uname -m) in
        x86_64 | amd64) arch=x86-64 ;;
        aarch64 | arm64) arch=ARM64 ;;
        *) die "This server's processor ($(uname -m)) isn't supported." "Umiji runs on x86-64 and 64-bit ARM servers." ;;
    esac
    have curl || die "curl is missing." "Install it (apt install -y curl, or dnf install -y curl), then run the installer again."
    # shellcheck source=/dev/null
    os=$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-${ID:-}}")
    mem=$(awk '/^MemTotal/ {printf "%.1f", $2 / 1048576}' /proc/meminfo)
    disk=$(df -Pk / | awk 'NR == 2 {printf "%d", $4 / 1048576}')
    good "${os:-Linux} $DOT $arch $DOT $mem GB memory $DOT $disk GB free disk"
    ((disk < 3)) && warn "Less than 3 GB of disk is free. The images need about 2 GB."

    NEED_DOCKER=1
    if have docker && docker info >/dev/null 2>&1 && compose_ok; then
        good "$(docker --version | sed 's/,.*//') with Compose $(docker compose version --short 2>/dev/null)"
        NEED_DOCKER=0
    elif have docker; then
        warn "Docker is here but isn't running, or has no Compose. The installer fixes that."
    else
        note "Docker isn't installed yet. The installer adds it."
    fi
}

# Only installing and updating need the internet.
check_network() {
    local code
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://ghcr.io/v2/)
    [[ $code == 000 ]] && die "This server can't reach ghcr.io, where Umiji's images are." \
        "Check its internet and DNS: curl -I https://ghcr.io
If its network blocks it, see Troubleshooting: https://github.com/therewasluna/umiji-backend/blob/main/DEPLOY.md#troubleshooting"
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$RAW/")
    [[ $code == 000 ]] && die "This server can't reach GitHub, where the install files are." \
        "Check its internet and DNS: curl -I https://raw.githubusercontent.com"
    good "GitHub and ghcr.io answer"

    SERVER_IP=${UMIJI_SERVER_IP:-$(public_ip)}
    IP_TEXT=${SERVER_IP:-"this server's IP"}
    if [[ -n $SERVER_IP ]]; then good "Public IP $SERVER_IP"; else warn "Couldn't find this server's public IP, so domains aren't checked."; fi
}

summary_and_plan() {
    local https='your own nginx'
    [[ -n $PANEL_PROFILES ]] && https='built-in HTTPS'
    title "Ready"
    if ((WANT_PANEL)); then
        if ((HAVE[0])); then say "Panel      update, in $PANEL_DIR"; else say "Panel      https://$PANEL_DOMAIN  ${D}$https $DOT $PANEL_DIR$R"; fi
    fi
    if ((WANT_SUB)); then
        if ((HAVE[1])); then say "Sub page   update, in $SUB_DIR"; else say "Sub page   https://$SUB_DOMAIN  ${D}$SUB_DIR$R"; fi
    fi
    if ((WANT_NODE)); then
        if ((HAVE[2])); then
            say "Node       update, in $NODE_DIR"
        elif ((NODE_AUTO)); then
            say "Node       port $NODE_PORT, added to the panel  ${D}$NODE_DIR$R"
        else
            say "Node       port $NODE_PORT  ${D}$NODE_DIR$R"
        fi
    fi

    plan "Adding the umiji command" "Type umiji to manage this server" s_command
    ((NEED_DOCKER)) && plan "Installing Docker" "Docker is ready" s_docker
    local updating=0
    if ((WANT_PANEL)); then
        if ((HAVE[0])); then
            updating=1
            plan "Backing up the database" "Database backed up" s_panel_backup
            plan "Downloading the newest panel" "Newest panel downloaded" s_panel_pull
            plan "Restarting the panel" "Panel restarted" s_panel_start
            plan "Waiting for the panel" "Panel is running" s_panel_wait
        else
            plan "Downloading the panel's files" "Panel files are in $PANEL_DIR" s_panel_files
            plan "Downloading the panel, a few hundred MB" "Panel downloaded" s_panel_pull
            plan "Starting the panel" "Panel started" s_panel_start
            plan "Waiting for the panel to be ready" "Panel is running" s_panel_wait
        fi
    fi
    if ((MAKE_OWNER)); then
        if ((OWNER_QUIET)); then
            plan "Checking the admin account" "Admin account is in place" s_panel_owner
        else
            plan "Creating your admin account" "Admin account $ADMIN_USER created" s_panel_owner
        fi
    fi
    ((WANT_PANEL && !HAVE[0])) && [[ -n $PANEL_PROFILES ]] &&
        plan "Getting the HTTPS certificate" "HTTPS certificate for $PANEL_DOMAIN" s_panel_cert
    if ((WANT_SUB)); then
        if ((HAVE[1])); then
            updating=1
            plan "Downloading the newest sub page" "Newest sub page downloaded" s_sub_pull
            plan "Restarting the sub page" "Sub page restarted" s_sub_start
        else
            plan "Downloading the sub page's files" "Sub page files are in $SUB_DIR" s_sub_files
            ((!SUB_ALONE && HAVE[0])) && [[ $(get_env "$PANEL_DIR/.env" SUB_PAGE_HERE) == no ]] &&
                plan "Telling the panel the sub page is here" "Panel serves the sub page" s_sub_tell_panel
            plan "Downloading the sub page" "Sub page downloaded" s_sub_pull
            plan "Starting the sub page" "Sub page started" s_sub_start
        fi
        plan "Waiting for the sub page to be ready" "Sub page is running" s_sub_wait
    fi
    if ((WANT_NODE)); then
        if ((HAVE[2])); then
            updating=1
            plan "Downloading the newest node" "Newest node downloaded" s_node_pull
            plan "Restarting the node" "Node restarted" s_node_start
        else
            ((NODE_AUTO)) && plan "Getting the node's key from the panel" "Node key received" s_node_key
            plan "Writing the node's settings" "Node settings are in $NODE_DIR" s_node_files
            if ((NODE_AUTO && NODE_UFW)); then
                plan "Letting the panel through the firewall" "Firewall lets the panel reach port $NODE_PORT" s_node_firewall
            elif [[ -n $NODE_PANEL_IP ]]; then
                plan "Letting the panel through the firewall" "Firewall lets $NODE_PANEL_IP reach port $NODE_PORT" s_node_firewall
            fi
            plan "Downloading the node" "Node downloaded" s_node_pull
            plan "Starting the node" "Node started" s_node_start
        fi
        plan "Waiting for the node to listen" "Node is listening" s_node_wait
        ((NODE_AUTO)) && plan "Adding the node to the panel" "Node added to the panel as $NODE_NAME" s_node_add
    fi
    ((updating)) && plan "Removing old images" "Old images removed" s_prune

    printf '\n  %sWhat happens now%s\n' "$B" "$R"
    local i=1 e
    for e in "${PLAN[@]}"; do
        printf '    %s%2d%s  %s\n' "$D" "$i" "$R" "${e%%|*}"
        i=$((i + 1))
    done
    printf '\n'
    if ! confirm "Start?" Y; then
        say "Nothing was changed."
        exit 0
    fi
    printf '\n'
}

# The admin account the installer made, if it made one.
show_login() {
    [[ -f $TMP/owner-made ]] || return 0
    say "Username   ${B}$ADMIN_USER${R}"
    if ((ADMIN_PASS_MADE)); then
        say "Password   ${B}$ADMIN_PASS${R}"
        printf '             %s%s Save the password now. It isn'\''t stored anywhere, and this is the only time it shows.%s\n' "$YELLOW" "$WARN" "$R"
    else
        say "Password   the one you typed"
    fi
}

finish() {
    local n=1
    title "Done"
    if ((WANT_PANEL)); then say "Panel      ${B}https://$PANEL_DOMAIN${R}"; fi
    show_login
    ((WANT_SUB)) && say "Sub page   https://$SUB_DOMAIN  ${D}opens from a user's subscription link${R}"
    if ((WANT_NODE && !HAVE[2])); then
        if [[ -f $TMP/node-added ]]; then say "Node       in the panel as ${B}$NODE_NAME${R}"; else say "Node       listening on port $NODE_PORT"; fi
    fi
    say "Log        ${D}$LOG${R}"
    [[ -x $CMD ]] && say "Manage     ${B}umiji${R}  ${D}updates, backups, the owner's password, uninstalling${R}"

    if ((!(WANT_PANEL && !HAVE[0]) && !(WANT_SUB && !HAVE[1] && SUB_ALONE) && !(WANT_NODE && !HAVE[2]))); then
        printf '\n'
        good "Everything you ticked is up to date."
        printf '\n'
        return
    fi
    printf '\n  %sNext%s\n' "$B" "$R"
    if ((WANT_PANEL && !HAVE[0])); then
        if [[ -z $PANEL_PROFILES ]]; then
            say "$n. Set up nginx for your domains: $WIKI/guide/#https"
            n=$((n + 1))
        fi
        say "$n. Open https://$PANEL_DOMAIN and sign in."
        n=$((n + 1))
        say "$n. Back up now and then: type umiji and pick Back up. Copy the file off this server."
        n=$((n + 1))
        if [[ $SUB_PAGE_HERE == no ]]; then
            say "$n. Install the sub page on its own server ($SUB_PAGE_IP) with this same installer."
            n=$((n + 1))
        elif ((!WANT_SUB)); then
            say "$n. Install the sub page here: type umiji, pick Install / update and tick Sub page."
            n=$((n + 1))
        fi
        if ((!NODE_AUTO)); then
            say "$n. Add a node in the panel: Nodes $ARROW Create node $ARROW Automatic install."
            n=$((n + 1))
        fi
        say "$n. The guide goes on from there: $WIKI/guide/#profile"
        n=$((n + 1))
    fi
    if ((WANT_SUB && !HAVE[1] && SUB_ALONE)); then
        say "$n. On the panel's server, tell the panel where the sub page is. Run these three there:"
        say "     ${B}cd $PANEL_DIR${R}"
        say "     ${B}sed -i 's/^SUB_PAGE_HERE=.*/SUB_PAGE_HERE=no/; s/^SUB_PAGE_IP=.*/SUB_PAGE_IP=${SERVER_IP:-THIS_SERVERS_IP}/' .env${R}"
        say "     ${B}docker compose up -d${R}"
        n=$((n + 1))
        if [[ -z $SUB_PROFILES ]]; then
            say "$n. Point nginx at 127.0.0.1:3010 for $SUB_DOMAIN: $SUB_NGINX_URL"
            n=$((n + 1))
        fi
    fi
    if ((WANT_NODE && !HAVE[2])); then
        if ((!NODE_AUTO)); then
            say "$n. Back in the panel's Create node, press Next and finish adding the node."
            n=$((n + 1))
            say "$n. If your provider has a firewall, open port $NODE_PORT to the panel's IP there, and your"
            say "   inbounds' ports to everyone."
        elif [[ -f $TMP/node-added ]]; then
            say "$n. In the panel, open $NODE_NAME under Nodes and pick your own profile once you've made one."
            n=$((n + 1))
            say "$n. If your provider has a firewall, open your inbounds' ports there."
        else
            say "$n. Add this node in the panel: Nodes $ARROW Create node $ARROW Manual setup, port $NODE_PORT."
        fi
        n=$((n + 1))
    fi
    if ((${#DNS_LATER[@]})); then
        printf '\n'
        local list=${DNS_LATER[*]}
        warn "Check the DNS of ${list// / and }: each needs an A record with the value $IP_TEXT."
    fi
    printf '\n'
}

# ── The menu, for a server that already runs Umiji ────────────────────────────────────────────────

state() {
    if container_running "$1"; then printf '%srunning%s' "$GREEN" "$R"; else printf '%sstopped%s' "$RED" "$R"; fi
}

menu() {
    local acts=(install update) pick
    local opts=("Install / update|add a part, or update the ones you tick"
        "Update all|the newest version of everything here")
    title "On this server"
    ((HAVE[0])) && say "Panel      https://$(get_env "$PANEL_DIR/.env" PANEL_DOMAIN)  $(state umiji)"
    ((HAVE[1])) && say "Sub page   https://$(get_env "$SUB_DIR/.env" SUB_DOMAIN)  $(state umiji-subscription-page)"
    ((HAVE[2])) && say "Node       $NODE_DIR  $(state umiji-node)"
    if ((HAVE[0])); then
        acts+=(password backup restore)
        opts+=("Owner password|set a new one, if you forgot it"
            "Back up|save the panel's whole database in one file"
            "Restore|put a backup back, in place of the database")
    fi
    acts+=(uninstall exit)
    opts+=("Uninstall|remove a part from this server" "Exit|")
    printf '\n'
    choose pick "What do you want to do?" 1 "${opts[@]}"
    ACTION=${acts[pick - 1]}
}

need_panel_db() {
    container_running umiji-db && return 0
    die "The panel's database isn't running." "Start the panel: cd $PANEL_DIR && docker compose up -d
Then type umiji again."
}

do_password() {
    local owner=''
    title "Owner password"
    container_running umiji || die "The panel isn't running." "Start it: cd $PANEL_DIR && docker compose up -d
Then type umiji again."
    case $(owner_state) in
        none)
            note "The panel has no admin account yet. Make one now; the first account owns the panel."
            ask_admin
            plan "Creating your admin account" "Admin account $ADMIN_USER created" s_panel_owner
            ;;
        unknown)
            die "The panel isn't answering on 127.0.0.1:3000." "Wait a minute, or see its log: cd $PANEL_DIR && docker compose logs umiji
Then type umiji again."
            ;;
        *)
            owner=$(db_sql <<<"SELECT username FROM admin WHERE role = 'ADMIN' LIMIT 1")
            say "The owner's username is ${B}$owner${R}. Its new password:"
            ask_password
            ADMIN_USER=$owner
            plan "Changing the password" "Password changed" s_owner_password
            ;;
    esac
    printf '\n'
    run_plan
    title "Done"
    if [[ -n $owner ]]; then
        touch "$TMP/owner-made"
        note "Password login is on again, in case it was off."
    fi
    show_login
    printf '\n'
}

do_backup() {
    local file ip
    title "Back up"
    need_panel_db
    plan "Backing up the database" "Database backed up" s_panel_backup
    run_plan
    file=$(cat "$TMP/backup-file")
    ip=${UMIJI_SERVER_IP:-$(public_ip)}
    title "Done"
    say "Backup     ${B}$file${R}  ${D}$(du -h "$file" | cut -f 1)${R}"
    note "It holds the whole database and the secret that unlocks it, so keep it private."
    note "Copy it to your computer: run this there."
    say "  ${B}scp root@${ip:-YOUR_SERVER_IP}:$file .${R}"
    note "To put it back, here or on a new server: copy it into $PANEL_DIR/backups, type umiji, pick Restore."
    printf '\n'
}

do_restore() {
    local f newest='' n=0
    title "Restore a backup"
    need_panel_db
    # shellcheck disable=SC2045 # our own file names, newest first
    for f in $(ls -t "$PANEL_DIR"/backups/*.tar "$PANEL_DIR"/backups/*.sql.gz 2>/dev/null); do
        ((n == 0)) && note "Backups here, newest first:" && newest=$f
        ((n < 5)) && note "  $f  $(date -r "$f" '+%F %R')  $(du -h "$f" | cut -f 1)"
        n=$((n + 1))
    done
    ((n)) || note "There are no backups in $PANEL_DIR/backups. Copy yours to this server first."
    ask RESTORE_FILE "Backup file" "$newest" check_backup
    printf '\n'
    warn "${B}This deletes the panel's whole database${R}: users, nodes, brokers, settings and the admin"
    warn "account. The backup's take their place, and the backup's admin account signs in."
    note "    The database as it is now is backed up first, so you can go back to it."
    note "    Only restore a backup you made: it runs inside the database as its admin."
    if ! confirm "Replace the database with this backup?" N; then
        say "Nothing was changed."
        exit 0
    fi
    printf '\n'
    plan "Backing up the database as it is now" "Database as it was is backed up" s_panel_backup
    plan "Stopping the panel" "Panel stopped" s_restore_stop
    plan "Restoring the backup" "Backup restored" s_restore_db
    plan "Starting the panel" "Panel started" s_panel_start
    plan "Waiting for the panel" "Panel is running" s_panel_wait
    ((HAVE[1])) && sub_next_to_panel && plan "Restarting the sub page" "Sub page is running" s_restore_sub
    run_plan
    title "Done"
    say "Restored   $RESTORE_FILE"
    say "Before     ${D}$(cat "$TMP/backup-file" 2>/dev/null), the database as it was${R}"
    note "Sign in with the backup's admin account. Forgot its password? Type umiji, pick Owner password."
    if ! is_bundle "$RESTORE_FILE"; then
        warn "This file has the database only, not the secret that unlocks passwords and bot tokens."
        note "    From another server? Copy its secrets/app_secret to $PANEL_DIR/secrets/, then:"
        note "    cd $PANEL_DIR && docker compose restart umiji"
    fi
    if [[ -f $TMP/sub-token-bad ]]; then
        warn "The sub page needs a new API token, because this backup doesn't have its current one."
        note "    In the panel: Umiji Settings $ARROW API Tokens $ARROW Create API token, with the Subpage preset."
        note "    Put it in $SUB_DIR/.env as UMIJI_API_TOKEN=, then: cd $SUB_DIR && docker compose up -d"
    fi
    [[ $(get_env "$PANEL_DIR/.env" SUB_PAGE_HERE) == no ]] &&
        note "The sub page on its own server: restart it there, so it reads the restored settings."
    printf '\n'
}

do_uninstall() {
    local names=(Panel 'Sub page' Node) dirs=("$PANEL_DIR" "$SUB_DIR" "$NODE_DIR") opts=() parts=() i pick
    title "Uninstall"
    for i in 0 1 2; do
        ((HAVE[i])) || continue
        opts+=("${names[i]}|${dirs[i]}")
        parts+=("$i")
    done
    ((${#parts[@]} > 1)) && opts+=("Everything|all of the above")
    choose pick "What should go?" 1 "${opts[@]}"
    local gone=(0 0 0)
    if ((pick > ${#parts[@]})); then gone=("${HAVE[@]}"); else gone[parts[pick - 1]]=1; fi
    if ((gone[0] && HAVE[1] && !gone[1])) && sub_next_to_panel; then
        note "The sub page here works through the panel, so it goes too."
        gone[1]=1
    fi

    KEEP_DATA=1
    printf '\n'
    if ((gone[0])); then
        note "Its database stays unless you say so. Installing the panel again then brings it all back."
        if confirm "Delete the panel's database, secrets and settings too? Its backups stay." N; then
            KEEP_DATA=0
            warn "Users, nodes, brokers and settings will be gone for good."
            confirm "Back up the database first?" Y && container_running umiji-db &&
                plan "Backing up the database" "Database backed up" s_panel_backup
        fi
    fi
    # Kept with the panel's data, the sub page's API token still works when both come back.
    SUB_KEEP=$((gone[0] && KEEP_DATA))
    printf '\n'
    say "To remove:"
    for i in 0 1 2; do ((gone[i])) && say "  $(printf '%-9s' "${names[i]}") ${D}${dirs[i]}${R}"; done
    if ! confirm "Remove from this server?" N; then
        say "Nothing was changed."
        exit 0
    fi
    printf '\n'
    ((gone[0])) && plan "Removing the panel" "Panel removed" s_rm_panel
    ((gone[1])) && plan "Removing the sub page" "Sub page removed" s_rm_sub
    ((gone[2])) && plan "Removing the node" "Node removed" s_rm_node
    local left=0
    for i in 0 1 2; do ((HAVE[i] && !gone[i])) && left=1; done
    ((left)) || plan "Removing the umiji command" "umiji command removed" s_rm_command
    run_plan

    title "Done"
    for i in 0 1 2; do ((gone[i])) && good "${names[i]} removed"; done
    [[ -f $TMP/backup-file ]] && say "Backup     $(cat "$TMP/backup-file")"
    if ((gone[0])); then
        if ((KEEP_DATA)); then
            note "Its database and settings stay. To bring it back, install it again with this installer."
        else
            [[ -d $PANEL_DIR/backups ]] && note "Its backups stay in $PANEL_DIR/backups."
        fi
    fi
    ((gone[2])) && note "Delete the node in the panel too: Nodes, then the node, then Delete."
    if ((!left)); then
        note "Docker stays installed. To install Umiji again:"
        say "  ${B}bash <(curl -fsSL $SCRIPT_URL)${R}"
    fi
    printf '\n'
}

# Install or update: the tick list, unless the parts are already picked.
do_install() {
    check_network
    if [[ -z ${WANT_PANEL:-} ]]; then
        title "What should this server run?"
        pick_parts
    fi
    ((WANT_PANEL)) && questions_panel
    ((WANT_SUB)) && questions_sub
    ((WANT_NODE)) && questions_node
    summary_and_plan

    ((FANCY)) && printf '\e[?25l'
    run_plan
    ((FANCY)) && printf '\e[?25h'
    finish
}

main() {
    setup_term
    if ! { exec 3</dev/tty; } 2>/dev/null; then
        echo "The installer asks questions, so run it in a terminal:" >&2
        echo "  bash <(curl -fsSL $SCRIPT_URL)" >&2
        exit 1
    fi
    trap cleanup EXIT
    trap on_interrupt INT TERM
    TMP=$(mktemp -d) && chmod 700 "$TMP"

    PANEL_DOMAIN='' SUB_DOMAIN='' PANEL_PROFILES='' SUB_PAGE_HERE=yes SUB_PAGE_IP=''
    SUB_ALONE=0 SUB_PROFILES='' SUB_PANEL_URL='' SUB_TOKEN=''
    NODE_PORT='' NODE_SECRET='' NODE_PANEL_IP='' NODE_AUTO=0 NODE_UFW=0 SERVER_IP='' NEED_DOCKER=1
    ADMIN_USER='' ADMIN_PASS='' ADMIN_PASS_MADE=0 MAKE_OWNER=0 OWNER_QUIET=0 MAKE_TOKEN=0
    DNS_LATER=() ACTION='' RESTORE_FILE='' KEEP_DATA=1 SUB_KEEP=0

    banner
    preflight
    mkdir -p "$(dirname "$LOG")" && touch "$LOG" && chmod 600 "$LOG"
    printf '\n=== Umiji installer, %s\n' "$(date -u '+%F %T UTC')" >>"$LOG"

    HAVE=(0 0 0)
    [[ -f $PANEL_DIR/docker-compose.yml ]] && HAVE[0]=1
    [[ -f $SUB_DIR/docker-compose.yml ]] && HAVE[1]=1
    [[ -f $NODE_DIR/docker-compose.yml ]] && HAVE[2]=1
    case ${1:-} in
        panel) PICK=(1 0 0) ;;
        sub) PICK=(0 1 0) ;;
        node) PICK=(0 0 1) ;;
        *)
            if ((!HAVE[0] && !HAVE[1] && !HAVE[2])); then
                PICK=(1 1 0)
                do_install
                return
            fi
            # Running it again on an older install adds the command too.
            if [[ ! -x $CMD ]]; then
                s_command >>"$LOG" 2>&1 && [[ -x $CMD ]] &&
                    good "Added the umiji command: type umiji to come back to this menu."
            fi
            menu
            [[ $ACTION == exit ]] && exit 0
            if [[ $ACTION != install && $ACTION != update ]] && ((NEED_DOCKER)); then
                die "Docker isn't running." "Start it: systemctl enable --now docker
Then type umiji again."
            fi
            case $ACTION in
                install) PICK=(0 0 0) ;;
                update) WANT_PANEL=${HAVE[0]} WANT_SUB=${HAVE[1]} WANT_NODE=${HAVE[2]} ;;
                password) do_password ;;
                backup) do_backup ;;
                restore) do_restore ;;
                uninstall) do_uninstall ;;
            esac
            [[ $ACTION == install || $ACTION == update ]] || return 0
            ;;
    esac
    do_install
}

main "$@"
