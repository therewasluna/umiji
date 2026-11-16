# Migration lab

The six panels `migrate.mjs` moves users from, in Docker on this machine, seeded through their own APIs, plus
scripts that move them into a test Umiji and check every user field by field. Lab use only: every password and
secret in here is public.

| Panel                | Version         | Address                                     |
| -------------------- | --------------- | ------------------------------------------- |
| Marzban              | latest          | https://127.0.0.1:18001 (self-signed)       |
| PasarGuard           | latest          | https://127.0.0.1:18002 (self-signed)       |
| Marzneshin + marznode | latest         | https://127.0.0.1:18003 (self-signed)       |
| 3x-ui                | latest (3.11)   | http://127.0.0.1:18004                      |
| 3x-ui                | 2.6.2           | http://127.0.0.1:18007                      |
| Remnawave            | latest          | http://127.0.0.1:18005                      |
| Hiddify Manager      | latest (14.2)   | http://127.0.0.1:18006 (panel app only)     |

Admin logins: `admin` / `AdminPass123` (PasarGuard: `AdminPass123!`), Remnawave `rwadmin` /
`RwAdminPass123LabOnlyXyz9`.

## Set up

1. A self-signed certificate for the three Python panels, and Marzban's Xray config:

    ```sh
    for d in marzban pasarguard marzneshin; do mkdir -p $d && openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
        -subj /CN=lab -keyout $d/cert.key -out $d/cert.pem; done
    cp xray-inbounds.json marzban/xray_config.json
    docker compose up -d
    ```

2. Marzneshin's node certificate, so the marznode accepts it:

    ```sh
    . ./lib.sh; T=$(c -X POST https://127.0.0.1:18003/api/admins/token -d 'username=admin&password=AdminPass123' | jq -r .access_token)
    c https://127.0.0.1:18003/api/nodes/settings -H "authorization: Bearer $T" | jq -r .certificate > marznode/client.pem
    docker compose restart marznode
    ```

3. 3x-ui: set the login with `docker compose exec xui /app/x-ui setting -username admin -password AdminPass123`
   (and the same for `xui2`), then restart them. Remnawave: register `rwadmin` once, make an API token
   (`POST /api/tokens` with `x-remnawave-client-type: browser`) and save it as `rw.token`. Hiddify: the admin link is
   `/<proxy_path_admin>/<admin uuid>/`, from its database. Put it in `tests/env-sources.sh`.

    ```sh
    docker compose exec -T hd-db mariadb -uhiddifypanel -phdpass123 hiddifypanel -e \
        "select uuid from admin_user; select value from str_config where \`key\` = 'proxy_path_admin'"
    ```

4. Seed each panel: `seed/<panel>.sh`. Neither 3x-ui nor Remnawave lets the API set used traffic, so to test traffic,
   set it in their databases with the panel stopped.

## Run

The test Umiji is a dev backend on a throwaway database (`UMIJI_URL`, default `http://127.0.0.1:3003`), with an owner
login in `umiji.jwt` or `UMIJI_TOKEN`.

```sh
LAB=$PWD; . ./env.sh; . tests/env-sources.sh
src marzban; export SRC_SECRET=<Marzban's jwt secret>
node $M plan        # what it would do
node $M run         # do it
node tests/verify.mjs   # every user, field by field
tests/cleanup.sh '.' '^(?!Default-)'   # empty the test panel again
```

Paging: `sed -e 's/limit=500/limit=7/g; …' ../../migrate.mjs` into a copy reads every panel in pages of 7; the counts
must match the normal run. `tests/pg-tokens.mjs <secret> <id> <username>` prints every PasarGuard link format, to open
through the sub page with `MARZBAN_LEGACY_LINK_ENABLED=true` and both secrets in `MARZBAN_LEGACY_SECRET_KEY`.

## Last full run, 2026-11-16

- **All seven panels, into an empty Umiji:** Marzban 127 users, PasarGuard 64, Marzneshin 44, 3x-ui 3.11 55, 3x-ui 2.6 14,
  Remnawave 34, Hiddify 47. There were 0 differences, and a second run moved nothing.
- **Old links:** every format opened through the sub page, also with `CUSTOM_SUB_PREFIX=sub`, and a forged PasarGuard
  token was refused.
- **The `umiji` menu:** Migrate ran on a Docker-in-Docker server for 3x-ui 2.6, Marzban and PasarGuard, both through the
  menu and as `install.sh migrate`.
  - Self-signed certificates were accepted after asking.
  - Both secrets were appended to the sub page's settings and kept out of the install log.
  - The installer wrote a plain-http old-domain Caddy site, and the old links opened through it. It tells the sub page
    the request was HTTPS, on purpose: apps keep fetching http links, and Android won't follow a redirect to https.
  - Not run: the https:443 old-domain site (no certificate possible here).
- **Real connections:** moved users connected through an Umiji node.
  - 3x-ui users with REALITY + Vision and with Trojan WS.
  - A Marzban user on an inbound with no flow (`settings.flow=""`). A client forcing Vision was refused, as the plan
    warns.
  - REALITY ran with the target switched to github.com. `www.microsoft.com` fails on this machine's network even on
    stock Xray with fresh keys.
