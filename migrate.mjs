#!/usr/bin/env node
// Umiji migrate: moves users from another panel into Umiji, with their inbounds, squads and hosts where the
// old panel's API has them. It only talks to APIs: it reads the old panel and never changes it, and on
// Umiji it only creates. Whatever is already there (same username, profile, squad or host) is skipped, so
// running it twice is safe.
//
// The installer runs it for you: type umiji and pick "Migrate". By hand, with Node 20+:
//
//   SRC_TYPE=marzban SRC_URL=https://old.example.com:8000 SRC_USER=admin SRC_PASS=… \
//   UMIJI_URL=https://panel.example.com UMIJI_TOKEN=<API token> node migrate.mjs plan
//
// Then the same with "run" instead of "plan". SRC_TYPE: remnawave, pasarguard, marzban, marzneshin, 3x-ui,
// hiddify. Remnawave takes SRC_TOKEN (an API token) instead of a user and password; 3x-ui and PasarGuard
// take either. Hiddify takes SRC_URL = the admin link it gave you (https://domain/<path>/<admin uuid>/).
// SRC_SECRET: Marzban's or PasarGuard's subscription secret (SELECT secret_key FROM jwt), so old links keep
// working. SRC_INSECURE=1 trusts a self-signed certificate on the old panel.
//
// Lines starting with @ are for the installer: @env KEY=VALUE for the sub page, @domain for old links.
// Exit codes: 2 the old panel refused the login, 5 its certificate isn't trusted, 6 it can't be reached,
// 7 some users weren't moved, 8 the Umiji panel can't take used traffic yet (update it first).

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

const E = process.env;
const NEVER = '2099-12-31T00:00:00.000Z';
const GB = 1024 ** 3;
const DAY = 86400000;

// ── Output ───────────────────────────────────────────────────────────────────────────────────────────

const say = (s = '') => process.stdout.write(s + '\n');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
class Stop extends Error {
    constructor(message, code = 1) {
        super(message);
        this.code = code;
    }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────

const TLS_CODES = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
]);

async function http(url, { method = 'GET', headers = {}, body, form, jar, timeout = 60000 } = {}) {
    const h = { accept: 'application/json', ...headers };
    if (form) {
        h['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(form).toString();
    } else if (body !== undefined && typeof body !== 'string') {
        h['content-type'] = 'application/json';
        body = JSON.stringify(body);
    }
    if (jar?.cookie) h.cookie = jar.cookie;
    for (let attempt = 1; ; attempt++) {
        let r;
        try {
            r = await fetch(url, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
        } catch (err) {
            const code = err.cause?.code || err.code || '';
            if (TLS_CODES.has(code)) throw new Stop(`The certificate of ${new URL(url).host} isn't trusted (${code}).`, 5);
            // Network blips on a long import: try a few times before giving up.
            if (attempt < 3 && method === 'GET') {
                await new Promise((res) => setTimeout(res, 1000 * attempt));
                continue;
            }
            throw new Stop(`Can't reach ${new URL(url).host}: ${err.cause?.message || err.message}`, 6);
        }
        if (jar) {
            const set = r.headers.getSetCookie?.() || [];
            const old = Object.fromEntries((jar.cookie || '').split('; ').filter(Boolean).map((p) => p.split(/=(.*)/s)));
            for (const c of set) {
                const [kv] = c.split(';');
                const [k, v] = kv.split(/=(.*)/s);
                old[k.trim()] = v;
            }
            jar.cookie = Object.entries(old).map(([k, v]) => `${k}=${v}`).join('; ');
        }
        const text = await r.text();
        let json;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = undefined;
        }
        return { status: r.status, ok: r.ok, json, text, headers: r.headers };
    }
}

function must(res, what) {
    if (res.ok && res.json !== undefined) return res.json;
    const detail = res.json?.detail || res.json?.message || res.json?.msg || res.text?.slice(0, 200) || '';
    throw new Stop(`${what}: HTTP ${res.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.trim());
}

const trimUrl = (u) => u.replace(/\/+$/, '');

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);
const pw = (s) => (typeof s === 'string' && s.length >= 8 && s.length <= 32 ? s : undefined);
const iso = (v) => {
    if (v === null || v === undefined || v === '') return undefined;
    // Python APIs send naive UTC times without a zone.
    const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z');
    return isNaN(d) ? undefined : d.toISOString();
};
const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : 0);
const NAME_RE = /^[A-Za-z0-9_\s-]+$/;
// Profile and squad names: 2-30 of letters, digits, _ - and spaces.
function groupName(s, fallback) {
    let n = String(s || '').replace(/[^A-Za-z0-9_\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
    if (n.length < 2) n = fallback;
    return n;
}
// The next free-looking name: "3x-ui" → "3x-ui 2" → "3x-ui 3".
const bump = (name) => {
    const m = /^(.*) (\d+)$/.exec(name);
    return groupName(m ? `${m[1].slice(0, 25)} ${+m[2] + 1}` : `${name.slice(0, 27)} 2`, name);
};
// Same rules as the sub page's sanitizeUsername, so an old Marzban link finds the user.
function sanitizeUsername(name) {
    let r = [...name].map((ch) => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_')).join('');
    if (r.length < 6) r += '_'.repeat(6 - r.length);
    return r;
}
// Umiji usernames: 3-36 of letters, digits, _ and -. Valid names stay as they are.
const umijiName = (name) => (/^[A-Za-z0-9_-]{3,36}$/.test(name) ? name : sanitizeUsername(name).slice(0, 36));
const RESET = { no_reset: 'NO_RESET', day: 'DAY', daily: 'DAY', week: 'WEEK', weekly: 'WEEK', month: 'MONTH', monthly: 'MONTH' };
const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Old PasarGuard links carry the user's id; the sub page turns it into this Short UUID with the same secret.
export const pasarguardShortUuid = (secret, id) =>
    b64url(crypto.createHmac('sha256', secret).update(`umiji-legacy:pasarguard:${id}`).digest()).slice(0, 24);

// XXH3-128, only the 17-128 byte path: Marzneshin derives every user's UUID and password from a 32-character
// key with it. Checked against Python's xxhash for every length from 17 to 128.
const M64 = (1n << 64n) - 1n;
const P1 = 0x9e3779b185ebca87n, P2 = 0xc2b2ae3d27d4eb4fn, P4 = 0x85ebca77c2b2ae63n;
const XXH_SECRET = Buffer.from(
    'b8fe6c3923a44bbe7c01812cf721ad1cded46de9839097db7240a4a4b7b3671fcb79e64eccc0e578825ad07dccff7221b8084674f743248ee03590e6813a264c3c2852bb91c300cb88d0658b1b532ea371644897a20df94e3819ef46a9deacd8a8fa763fe39c343ff9dcbbc7c70b4f1d8a51e04bcdb45931c89f7ec9d9787364eac5ac8334d3ebc3c581a0fffa1363eb170ddd51b7f0da49d316552629d4689e2b16be587d47a1fc8ff8b8d17ad031ce45cb3a8f95160428afd7fbcabb4b407e',
    'hex',
);
const rd64 = (b, o) => b.readBigUInt64LE(o);
const avalanche = (h) => {
    h ^= h >> 37n;
    h = (h * 0x165667919e3779f9n) & M64;
    return h ^ (h >> 32n);
};
const mix16 = (b, o, so) => {
    const p = (rd64(b, o) ^ rd64(XXH_SECRET, so)) * (rd64(b, o + 8) ^ rd64(XXH_SECRET, so + 8));
    return (p & M64) ^ (p >> 64n);
};
export function xxh128(str) {
    const b = Buffer.from(str), len = b.length;
    if (len < 17 || len > 128) return null;
    let lo = (BigInt(len) * P1) & M64, hi = 0n;
    const mix32 = (i1, i2, so) => {
        lo = (lo + mix16(b, i1, so)) & M64;
        lo ^= (rd64(b, i2) + rd64(b, i2 + 8)) & M64;
        hi = (hi + mix16(b, i2, so + 16)) & M64;
        hi ^= (rd64(b, i1) + rd64(b, i1 + 8)) & M64;
    };
    if (len > 32) {
        if (len > 64) {
            if (len > 96) mix32(48, len - 64, 96);
            mix32(32, len - 48, 64);
        }
        mix32(16, len - 32, 32);
    }
    mix32(0, len - 16, 0);
    const outLo = avalanche((lo + hi) & M64);
    const outHi = (0n - avalanche((lo * P1 + hi * P4 + BigInt(len) * P2) & M64)) & M64;
    return outHi.toString(16).padStart(16, '0') + outLo.toString(16).padStart(16, '0');
}
const hexUuid = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

// ── Xray configs ─────────────────────────────────────────────────────────────────────────────────────

const ALLOWED = new Set(['dokodemo-door', 'http', 'hysteria', 'mixed', 'mtproto', 'shadowsocks', 'trojan', 'tun', 'tunnel', 'vless', 'wireguard']);
const PER_USER = new Set(['vless', 'trojan', 'shadowsocks']);
const PROTO_NAMES = { vmess: 'VMess', socks: 'SOCKS', wireguard: 'WireGuard', amneziawg: 'AmneziaWG', hysteria: 'Hysteria', hysteria2: 'Hysteria 2', tuic: 'TUIC', masque: 'MASQUE', naive: 'NaïveProxy' };
const protoName = (p) => PROTO_NAMES[p] || p;
const SS_METHODS = new Set(['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'chacha20-poly1305']);

// Turns an old panel's Xray config into a config profile: drops what the node manages (api, stats, the
// api inbound and its routing rule) and inbounds Umiji can't serve, and empties the client lists.
function cleanConfig(cfg, notes, label, ssMethods = {}, dropped = {}) {
    const c = structuredClone(cfg || {});
    const apiTag = c.api?.tag;
    delete c.api;
    delete c.stats;
    delete c.metrics;
    const kept = [];
    for (const ib of c.inbounds || []) {
        if (!ib?.tag || ib.tag === apiTag || ib.tag === 'api' || (ib.protocol === 'dokodemo-door' && ib.listen === '127.0.0.1' && ib.settings?.address === '127.0.0.1')) continue;
        if (!ALLOWED.has(ib.protocol)) {
            notes.push(`${label}: inbound "${ib.tag}" is ${ib.protocol}, which Umiji doesn't run. It isn't copied; its users keep their other inbounds.`);
            dropped[ib.tag] = protoName(ib.protocol);
            continue;
        }
        ib.tag = ib.tag.replace(/,/g, ' ');
        if (ib.settings && PER_USER.has(ib.protocol)) ib.settings.clients = [];
        if (ib.protocol === 'shadowsocks') {
            ib.settings ??= {};
            const m = ib.settings.method || ssMethods[ib.tag];
            if (m && !SS_METHODS.has(m) && !m.startsWith('2022-')) {
                notes.push(`${label}: Shadowsocks "${ib.tag}" uses ${m}; set to chacha20-ietf-poly1305.`);
                ib.settings.method = 'chacha20-ietf-poly1305';
            } else if (m) ib.settings.method = m === 'chacha20-poly1305' ? 'chacha20-ietf-poly1305' : m;
            if (ib.settings.method?.startsWith('2022-')) {
                notes.push(`${label}: Shadowsocks "${ib.tag}" is ${ib.settings.method}. Its users get new keys, so their old Shadowsocks configs stop; their sub link brings the new ones.`);
            }
        }
        if (ib.streamSettings) delete ib.streamSettings.externalProxy;
        kept.push(ib);
    }
    c.inbounds = kept;
    const tags = new Set(kept.map((i) => i.tag));
    if (c.routing?.rules) {
        c.routing.rules = c.routing.rules.filter((r) => r.outboundTag !== apiTag && r.outboundTag !== 'api' && !(r.inboundTag || []).includes('api'));
        for (const r of c.routing.rules) if (r.inboundTag) r.inboundTag = r.inboundTag.filter((t) => tags.has(t) || !t);
        c.routing.rules = c.routing.rules.filter((r) => !r.inboundTag || r.inboundTag.length);
    }
    if (!c.outbounds?.length) c.outbounds = [{ protocol: 'freedom', tag: 'DIRECT' }, { protocol: 'blackhole', tag: 'BLOCK' }];
    return c;
}

// Umiji sets VLESS's flow per inbound (vision on TCP with REALITY or TLS, unless settings.flow says
// otherwise); old panels set it per user. The inbound takes what most of its users had. The rest have
// old configs Xray now refuses, until their app refreshes the subscription.
const countFlow = (flows, tag, flow) => {
    const f = (flows[tag] ??= { vision: 0, none: 0 });
    if (flow === 'xtls-rprx-vision') f.vision++;
    else f.none++;
};
function applyFlows(config, flows, notes, label) {
    for (const ib of config.inbounds) {
        const f = flows[ib.tag];
        if (!f || ib.protocol !== 'vless' || ib.settings?.flow !== undefined) continue;
        const st = ib.streamSettings || {};
        if (!['reality', 'tls'].includes(st.security) || !['raw', 'tcp', undefined].includes(st.network)) continue;
        if (f.none > f.vision) ib.settings.flow = '';
        const off = Math.min(f.vision, f.none);
        if (off) notes.push(`${label}: on "${ib.tag}", ${plural(off, 'user')} had ${f.none > f.vision ? 'Vision' : 'no flow'}, unlike the rest. Their old configs stop working until their app refreshes the subscription, which brings the right one.`);
    }
}

const ALPN = new Set(['h3', 'h2', 'http/1.1', 'h2,http/1.1', 'h3,h2,http/1.1', 'h3,h2']);
// Marzban-style {VARIABLE} remarks to Umiji's {{VARIABLE}}.
const VARS = { USERNAME: 'USERNAME', DATA_USAGE: 'TRAFFIC_USED', DATA_LEFT: 'TRAFFIC_LEFT', DATA_LIMIT: 'TOTAL_TRAFFIC', DAYS_LEFT: 'DAYS_LEFT', STATUS_EMOJI: '' };
function remark(s, notes) {
    return String(s || 'Host')
        .replace(/\{([A-Z_]+)\}/g, (all, v) => {
            if (v in VARS) return VARS[v] ? `{{${VARS[v]}}}` : '';
            notes.add(`Host remarks: {${v}} has no match in Umiji and was dropped.`);
            return '';
        })
        .trim()
        .slice(0, 100) || 'Host';
}
const firstOf = (v) => (Array.isArray(v) ? v[0] : typeof v === 'string' ? v.split(',')[0].trim() : v) || null;
const security = (s) => ({ tls: 'TLS', none: 'NONE' })[s] || 'DEFAULT';

// ── Sources ──────────────────────────────────────────────────────────────────────────────────────────
// Each read() returns { panel, profiles[{name, config}], squads[{key, name, tags[]}], hosts[], users[],
// nodes[], admins[], notes[], links{} }. Users already use Umiji's field names.

function marzbanUser(u, notes, extra = {}) {
    const now = Date.now();
    let status = { active: 'ACTIVE', disabled: 'DISABLED', limited: 'LIMITED', expired: 'EXPIRED', on_hold: 'ACTIVE' }[u.status] || 'ACTIVE';
    let expireAt = iso(u.expire) || NEVER;
    const user = {
        source: u.username,
        status,
        trafficLimitBytes: num(u.data_limit),
        trafficLimitStrategy: RESET[u.data_limit_reset_strategy] || 'NO_RESET',
        usedTrafficBytes: num(u.used_traffic),
        lifetimeUsedTrafficBytes: Math.max(num(u.lifetime_used_traffic), num(u.used_traffic)),
        createdAt: iso(u.created_at),
        description: u.note || undefined,
        vlessUuid: isUuid(u.proxies?.vless?.id ?? u.proxy_settings?.vless?.id) ? (u.proxies?.vless?.id ?? u.proxy_settings?.vless?.id) : undefined,
        trojanPassword: pw(u.proxies?.trojan?.password ?? u.proxy_settings?.trojan?.password),
        ssPassword: pw(u.proxies?.shadowsocks?.password ?? u.proxy_settings?.shadowsocks?.password),
        hwidDeviceLimit: Number.isInteger(u.hwid_limit) && u.hwid_limit >= 0 ? u.hwid_limit : undefined,
        owner: u.admin?.username,
        ...extra,
    };
    if (u.status === 'on_hold') {
        // On hold starts the clock on first use; Umiji has no such state, so it starts now.
        user.expireAt = new Date(now + num(u.on_hold_expire_duration) * 1000).toISOString();
        user.onHold = true;
    } else user.expireAt = expireAt;
    if (u.data_limit_reset_strategy === 'year') user.yearly = true;
    return user;
}

// Panels that give each user their own inbounds: one squad per distinct set. The set with every inbound
// is named after the panel, the others get a number, largest first.
function setSquads(squads, panel, tags) {
    const all = [...tags].sort().join('\n');
    return [...squads]
        .sort(([a, x], [b, y]) => (a === all ? -1 : b === all ? 1 : y.length - x.length))
        .map(([key, set], i) => ({ key, name: i ? `${panel} ${i + 1}` : panel, tags: set }));
}

const SOURCES = {
    // Marzban 0.8: users, the core config, hosts per inbound tag.
    marzban: {
        async read(src) {
            const base = trimUrl(src.url);
            const tok = must(await http(base + '/api/admin/token', { method: 'POST', form: { username: src.user, password: src.pass } }), 'Login');
            if (!tok?.access_token) throw new Stop('Login: the old panel refused this username and password.', 2);
            const auth = { authorization: `Bearer ${tok.access_token}` };
            const get = async (p, what) => must(await http(base + p, { headers: auth }), what);
            const out = { panel: 'Marzban', notes: [], links: {} };
            const users = [];
            for (let offset = 0; ; offset += 500) {
                const page = await get(`/api/users?offset=${offset}&limit=500`, 'Reading users');
                users.push(...page.users);
                if (!page.users.length || users.length >= page.total) break;
            }
            const core = await get('/api/core/config', 'Reading the core config');
            const ssMethods = {}, dropped = {};
            for (const u of users) for (const t of u.inbounds?.shadowsocks || []) if (u.proxies?.shadowsocks?.method) ssMethods[t] ??= u.proxies.shadowsocks.method;
            out.profiles = [{ name: 'Marzban', config: cleanConfig(core, out.notes, 'Marzban', ssMethods, dropped) }];
            const flows = {};
            for (const u of users) for (const t of u.inbounds?.vless || []) countFlow(flows, t, u.proxies?.vless?.flow);
            applyFlows(out.profiles[0].config, flows, out.notes, 'Marzban');
            const tags = new Set(out.profiles[0].config.inbounds.map((i) => i.tag));
            const squads = new Map();
            out.users = users.map((u) => {
                const set = Object.entries(u.inbounds || {})
                    .flatMap(([p, ts]) => ts.filter((t) => !(u.excluded_inbounds?.[p] || []).includes(t)))
                    .filter((t) => tags.has(t))
                    .sort();
                const key = set.join('\n');
                if (set.length && !squads.has(key)) squads.set(key, set);
                const lost = Object.values(u.inbounds || {}).flat().map((t) => dropped[t]).filter(Boolean);
                return marzbanUser(u, out.notes, { squadKeys: set.length ? [key] : [], lost: [...new Set(lost)] });
            });
            out.squads = setSquads(squads, 'Marzban', tags);
            const hosts = await get('/api/hosts', 'Reading hosts');
            out.hosts = Object.entries(hosts).flatMap(([tag, list]) => list.map((h) => ({ ...h, tag, profile: 'Marzban' })));
            out.nodes = (await get('/api/nodes', 'Reading nodes').catch(() => [])).map((n) => ({ name: n.name, address: n.address }));
            out.admins = (await get('/api/admins', 'Reading admins').catch(() => [])).map((a) => a.username);
            out.links = { kind: 'marzban', sample: users[0]?.subscription_url };
            return out;
        },
    },

    // PasarGuard: users, groups, cores (Xray configs), hosts.
    pasarguard: {
        async read(src) {
            const base = trimUrl(src.url);
            let auth;
            if (src.token) auth = { authorization: `Bearer ${src.token}` };
            else {
                const tok = must(await http(base + '/api/admin/token', { method: 'POST', form: { username: src.user, password: src.pass } }), 'Login');
                if (!tok?.access_token) throw new Stop('Login: the old panel refused this username and password.', 2);
                auth = { authorization: `Bearer ${tok.access_token}` };
            }
            const get = async (p, what) => must(await http(base + p, { headers: auth }), what);
            const out = { panel: 'PasarGuard', notes: [], links: {} };
            const users = [];
            for (let offset = 0; ; offset += 500) {
                const page = await get(`/api/users?offset=${offset}&limit=500`, 'Reading users');
                users.push(...page.users);
                if (!page.users.length || users.length >= page.total) break;
            }
            let cores = (await get('/api/cores?limit=1000', 'Reading cores')).cores || [];
            const nodeList = await get('/api/nodes?limit=1000', 'Reading nodes').catch(() => []);
            const nodes = Array.isArray(nodeList) ? nodeList : nodeList.nodes || [];
            // Only the cores a node runs, so PasarGuard's unused default core doesn't come along.
            const used = new Set(nodes.map((n) => n.core_config_id).filter((id) => id != null));
            if (used.size) cores = cores.filter((c) => used.has(c.id));
            // Shadowsocks's method is per user in PasarGuard and per inbound in Umiji: the most common wins.
            const methods = {};
            for (const u of users) {
                const m = u.proxy_settings?.shadowsocks?.method;
                if (m) methods[m] = (methods[m] || 0) + 1;
            }
            const method = Object.entries(methods).sort((a, b) => b[1] - a[1])[0]?.[0];
            const ssOther = method ? users.filter((u) => (u.proxy_settings?.shadowsocks?.method || method) !== method).length : 0;
            out.profiles = [];
            const tagProfile = {}, dropped = {};
            for (const core of cores) {
                if (core.type && core.type !== 'xray') {
                    out.notes.push(`Core "${core.name}" is ${core.type}, which Umiji doesn't run. It isn't copied.`);
                    continue;
                }
                const name = groupName(core.name, `PasarGuard ${core.id}`);
                const ssMethods = Object.fromEntries((core.config?.inbounds || []).filter((i) => i.protocol === 'shadowsocks').map((i) => [i.tag, method]));
                const config = cleanConfig(core.config, out.notes, `Core "${core.name}"`, ssMethods, dropped);
                for (const ex of core.exclude_inbound_tags || []) config.inbounds = config.inbounds.filter((i) => i.tag !== ex);
                for (const ib of config.inbounds) tagProfile[ib.tag] ??= name;
                out.profiles.push({ name, config });
            }
            if (ssOther) out.notes.push(`${plural(ssOther, 'user')} used a Shadowsocks method other than ${method}; their Shadowsocks configs change, and their sub link brings the new ones.`);
            const groups = (await get('/api/groups?limit=1000', 'Reading groups')).groups || [];
            const groupLost = Object.fromEntries(groups.map((g) => [g.id, (g.inbound_tags || []).map((t) => dropped[t]).filter(Boolean)]));
            const groupTags = Object.fromEntries(groups.map((g) => [g.id, g.inbound_tags || []]));
            const flows = {};
            for (const u of users) for (const t of new Set((u.group_ids || []).flatMap((g) => groupTags[g] || []))) countFlow(flows, t, u.proxy_settings?.vless?.flow);
            for (const pr of out.profiles) applyFlows(pr.config, flows, out.notes, `Profile "${pr.name}"`);
            out.squads = groups.map((g) => ({ key: String(g.id), name: groupName(g.name, `Group ${g.id}`), tags: (g.inbound_tags || []).filter((t) => tagProfile[t]) }));
            for (const g of groups) if (g.is_disabled) out.notes.push(`Group "${g.name}" is disabled in PasarGuard; its squad here is active.`);
            const secret = src.secret;
            out.users = users.map((u) =>
                marzbanUser(u, out.notes, {
                    squadKeys: (u.group_ids || []).map(String),
                    shortUuid: secret ? pasarguardShortUuid(secret, u.id) : undefined,
                    lost: [...new Set((u.group_ids || []).flatMap((g) => groupLost[g] || []))],
                }),
            );
            const hosts = await get('/api/hosts?limit=1000', 'Reading hosts');
            out.hosts = (Array.isArray(hosts) ? hosts : hosts.hosts || []).filter((h) => h.inbound_tag && tagProfile[h.inbound_tag]).map((h) => ({ ...h, tag: h.inbound_tag, profile: tagProfile[h.inbound_tag] }));
            out.nodes = nodes.map((n) => ({ name: n.name, address: n.address }));
            const admins = await get('/api/admins?limit=1000', 'Reading admins').catch(() => []);
            out.admins = (Array.isArray(admins) ? admins : admins.admins || []).map((a) => a.username);
            out.links = { kind: 'pasarguard', sample: users[0]?.subscription_url };
            return out;
        },
    },

    // Marzneshin: users, services, the Xray config of each node, hosts.
    marzneshin: {
        async read(src) {
            const base = trimUrl(src.url);
            const tok = must(await http(base + '/api/admins/token', { method: 'POST', form: { username: src.user, password: src.pass } }), 'Login');
            if (!tok?.access_token) throw new Stop('Login: the old panel refused this username and password.', 2);
            const auth = { authorization: `Bearer ${tok.access_token}` };
            const get = async (p, what) => must(await http(base + p, { headers: auth }), what);
            const all = async (p, what) => {
                const items = [];
                for (let page = 1; ; page++) {
                    const r = await get(`${p}${p.includes('?') ? '&' : '?'}page=${page}&size=100`, what);
                    items.push(...r.items);
                    if (page >= (r.pages || 1) || !r.items.length) break;
                }
                return items;
            };
            const out = { panel: 'Marzneshin', notes: [], links: {} };
            const users = await all('/api/users', 'Reading users');
            const nodes = await all('/api/nodes', 'Reading nodes');
            const inbounds = await all('/api/inbounds', 'Reading inbounds');
            // One profile per distinct node config; an inbound is (node, tag).
            out.profiles = [];
            const seen = new Map();
            const nodeProfile = {}, dropped = {};
            for (const n of nodes) {
                const r = await http(`${base}/api/nodes/${n.id}/xray/config`, { headers: auth });
                if (!r.ok) {
                    out.notes.push(`Node "${n.name}": its Xray config couldn't be read (HTTP ${r.status}), so its inbounds aren't copied.`);
                    continue;
                }
                const raw = typeof r.json?.config === 'string' ? JSON.parse(r.json.config) : r.json?.config || r.json;
                const config = cleanConfig(raw, out.notes, `Node "${n.name}"`, {}, dropped);
                const sig = JSON.stringify(config);
                if (!seen.has(sig)) {
                    const pr = { name: groupName(`Marzneshin ${n.name}`, `Marzneshin ${n.id}`), config };
                    seen.set(sig, pr);
                    out.profiles.push(pr);
                }
                nodeProfile[n.id] = seen.get(sig);
            }
            if (out.profiles.length === 1) out.profiles[0].name = 'Marzneshin';
            const nodeAddress = Object.fromEntries(nodes.map((n) => [n.id, n.address]));
            const inboundRef = {}, inboundLost = {};
            for (const ib of inbounds) {
                const nid = ib.node?.id ?? ib.node_id;
                const pr = nodeProfile[nid];
                if (pr?.config.inbounds.some((i) => i.tag === ib.tag)) inboundRef[ib.id] = { profile: pr.name, tag: ib.tag, serverIp: nodeAddress[nid] };
                else if (dropped[ib.tag]) inboundLost[ib.id] = dropped[ib.tag];
            }
            const services = await all('/api/services', 'Reading services');
            out.squads = services.map((s) => ({ key: String(s.id), name: groupName(s.name, `Service ${s.id}`), refs: (s.inbound_ids || []).map((i) => inboundRef[i]).filter(Boolean) }));
            const serviceLost = Object.fromEntries(services.map((s) => [s.id, (s.inbound_ids || []).map((i) => inboundLost[i]).filter(Boolean)]));
            // AUTH_GENERATION_ALGORITHM is plain or xxh128 (the default); a user's own sub tells which.
            let plain = false;
            for (const u of users.slice(0, 20)) {
                const r = await http(`${base}/sub/${encodeURIComponent(u.username)}/${u.key}/links`, { headers: { 'user-agent': 'v2rayN/7' } });
                const text = r.ok ? r.text : '';
                const m = text.match(/vless:\/\/([0-9a-f-]{36})@/i) || (() => {
                    try {
                        return Buffer.from(text, 'base64').toString().match(/vless:\/\/([0-9a-f-]{36})@/i);
                    } catch {
                        return null;
                    }
                })();
                if (m) {
                    plain = m[1].replace(/-/g, '') === u.key;
                    break;
                }
            }
            const now = Date.now();
            out.users = users.map((u) => {
                const h = plain ? u.key : xxh128(u.key);
                if (!h) out.notes.push(`User ${u.username}: its key isn't 17-128 characters, so its passwords are new.`);
                let status = !u.enabled ? 'DISABLED' : u.expired ? 'EXPIRED' : u.data_limit_reached ? 'LIMITED' : 'ACTIVE';
                let expireAt = iso(u.expire_date) || NEVER;
                const user = {
                    source: u.username,
                    status,
                    trafficLimitBytes: num(u.data_limit),
                    trafficLimitStrategy: RESET[u.data_limit_reset_strategy] || 'NO_RESET',
                    usedTrafficBytes: num(u.used_traffic),
                    lifetimeUsedTrafficBytes: Math.max(num(u.lifetime_used_traffic), num(u.used_traffic)),
                    createdAt: iso(u.created_at),
                    description: u.note || undefined,
                    vlessUuid: h && h.length === 32 ? hexUuid(h) : undefined,
                    trojanPassword: h ? pw(h) : undefined,
                    ssPassword: h ? pw(h) : undefined,
                    shortUuid: u.key,
                    owner: u.owner_username,
                    squadKeys: (u.service_ids || []).map(String),
                    lost: [...new Set((u.service_ids || []).flatMap((id) => serviceLost[id] || []))],
                };
                // Marzneshin switches a user to fixed_date on first use, so this one hasn't started yet.
                if (u.expire_strategy === 'start_on_first_use') {
                    user.expireAt = new Date(now + num(u.usage_duration) * 1000).toISOString();
                    user.onHold = true;
                } else user.expireAt = u.expire_strategy === 'never' ? NEVER : expireAt;
                if (u.data_limit_reset_strategy === 'year') user.yearly = true;
                return user;
            });
            const hosts = await all('/api/inbounds/hosts', 'Reading hosts');
            out.hosts = hosts.filter((h) => inboundRef[h.inbound_id]).map((h) => ({ ...h, ...inboundRef[h.inbound_id] }));
            const skipped = hosts.length - out.hosts.length;
            if (skipped) out.notes.push(`${plural(skipped, 'host')} on an inbound that isn't copied (or universal) ${skipped === 1 ? "isn't" : "aren't"} copied either.`);
            out.nodes = nodes.map((n) => ({ name: n.name, address: n.address }));
            out.admins = (await all('/api/admins', 'Reading admins').catch(() => [])).map((a) => a.username);
            out.links = { kind: 'marzneshin', sample: users[0]?.subscription_url };
            return out;
        },
    },

    // 3x-ui 2.x and 3.x: clients live inside inbounds; clients sharing a subId are one person.
    '3x-ui': {
        async read(src) {
            const base = trimUrl(src.url);
            const jar = {};
            const headers = {};
            if (src.token) headers.authorization = `Bearer ${src.token}`;
            else {
                // 3.x wants the CSRF token from the login page; 2.x ignores it.
                const page = await http(base + '/', { jar, headers: { accept: 'text/html' } });
                const csrf = page.text?.match(/name="csrf-token" content="([^"]+)"/)?.[1];
                const r = await http(base + '/login', { method: 'POST', jar, form: { username: src.user, password: src.pass }, headers: csrf ? { 'x-csrf-token': csrf } : {} });
                if (r.status === 404) throw new Stop('Login: 3x-ui answered 404. Use the panel address with its secret path, the one you open in the browser.', 2);
                if (!r.json?.success) throw new Stop(`Login: ${r.json?.msg || 'the old panel refused this username and password'}`, 2);
                if (csrf) headers['x-csrf-token'] = csrf;
            }
            const api = async (method, p, what) => {
                const r = await http(base + p, { method, headers: { ...headers, 'x-requested-with': 'XMLHttpRequest' }, jar });
                const j = must(r, what);
                // 2.x answers an unknown /panel/api route with an empty 200.
                if (j === null) throw new Stop(`${what}: empty answer`);
                if (j?.success === false) throw new Stop(`${what}: ${j.msg}`);
                return j?.obj ?? j;
            };
            const out = { panel: '3x-ui', notes: [], links: {} };
            const inbounds = await api('GET', '/panel/api/inbounds/list', 'Reading inbounds');
            const parse = (s) => (typeof s === 'string' ? (s ? JSON.parse(s) : {}) : s || {});
            // 3.x serves these under /panel/api, 2.x under /panel.
            const either = async (path, what) => {
                try {
                    return await api('POST', `/panel/api${path}`, what);
                } catch {
                    return await api('POST', `/panel${path}`, what);
                }
            };
            // Outbounds, routing and DNS come from the panel's Xray template.
            let template = {};
            try {
                const x = await either('/xray/', 'Reading the Xray template');
                template = parse(parse(x).xraySetting ?? x);
            } catch {
                out.notes.push('The Xray template (outbounds, routing) couldn\'t be read; the profile gets plain outbounds.');
            }
            let settings = {};
            try {
                settings = await either('/setting/all', 'Reading settings');
            } catch {}
            // 3.x keeps hosts (link overrides) apart from inbounds.
            const hostList = await api('GET', '/panel/api/hosts/list', 'Reading hosts').catch(() => []);
            const host = new URL(base).hostname;
            const config = { ...template, inbounds: [] };
            const groups = new Map();
            for (const ib of inbounds) {
                const s = parse(ib.settings), stream = parse(ib.streamSettings), sniff = parse(ib.sniffing);
                const tag = (ib.tag || `inbound-${ib.port}`).replace(/,/g, ' ');
                const clients = s.clients || [];
                const xi = { tag, listen: ib.listen || undefined, port: ib.port, protocol: ib.protocol, settings: { ...s }, streamSettings: stream, sniffing: sniff };
                if (!ib.enable) out.notes.push(`Inbound "${ib.remark || tag}" is off in 3x-ui; it's copied and on here.`);
                config.inbounds.push(xi);
                const stats = Object.fromEntries((ib.clientStats || []).map((c) => [c.email, c]));
                for (const cl of clients) {
                    const key = cl.subId || cl.email;
                    const g = groups.get(key) || { key, clients: [], tags: new Set() };
                    g.clients.push({ ...cl, protocol: ib.protocol, stat: stats[cl.email], method: s.method, ibReset: ib.trafficReset });
                    g.tags.add(tag);
                    groups.set(key, g);
                }
                out.hosts ??= [];
                // 3.x host groups: several inbounds × several "address[:port]" entries.
                const own = (hostList || []).filter((h) => (h.inboundIds || [h.inboundId]).includes(ib.id));
                if (own.length) {
                    for (const h of own)
                        for (const a of h.hosts?.length ? h.hosts : [h.address || settings.subDomain || host]) {
                            const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(a.includes(':') && !a.includes('[') && a.split(':').length > 2 ? `[${a}]` : a);
                            out.hosts.push({ profile: '3x-ui', tag, remark: h.remark || ib.remark || tag, address: m?.[1] || a, port: +m?.[2] || h.port || ib.port, sni: h.sni || h.snis?.[0], host: h.hostHeader, path: h.path, alpn: h.alpn?.join(','), fingerprint: h.fingerprint, is_disabled: h.isDisabled, security: h.security === 'same' ? 'inbound_default' : h.security });
                        }
                } else {
                    const proxies = stream.externalProxy?.length ? stream.externalProxy : [{ dest: settings.subDomain || host, port: ib.port }];
                    for (const p of proxies) out.hosts.push({ profile: '3x-ui', tag, remark: ib.remark || tag, address: p.dest, port: p.port, security: p.forceTls === 'tls' ? 'tls' : p.forceTls === 'none' ? 'none' : 'inbound_default' });
                }
            }
            out.hosts ??= [];
            const ssMethods = Object.fromEntries(config.inbounds.filter((i) => i.protocol === 'shadowsocks').map((i) => [i.tag, i.settings.method]));
            out.profiles = [{ name: '3x-ui', config: cleanConfig(config, out.notes, '3x-ui', ssMethods) }];
            const flows = {};
            for (const ib of config.inbounds) if (ib.protocol === 'vless') for (const cl of ib.settings.clients || []) countFlow(flows, ib.tag, cl.flow);
            applyFlows(out.profiles[0].config, flows, out.notes, '3x-ui');
            const tags = new Set(out.profiles[0].config.inbounds.map((i) => i.tag));
            const squads = new Map();
            const now = Date.now();
            out.users = [...groups.values()].map((g) => {
                const c0 = g.clients[0];
                const pick = (p) => g.clients.find((c) => c.protocol === p);
                // 3.x shows one client on several inbounds with the same email and traffic: count it once.
                const byEmail = new Map(g.clients.map((c) => [c.email, c.stat]));
                const used = [...byEmail.values()].reduce((s, st) => s + num(st?.up) + num(st?.down), 0);
                const limit = Math.max(...g.clients.map((c) => num(c.totalGB)));
                const exps = g.clients.map((c) => +c.expiryTime || 0);
                const enabled = g.clients.some((c) => c.enable !== false);
                let expireAt = NEVER, onHold = false;
                if (exps.some((e) => e < 0)) {
                    // A negative expiry is "this many days after first use".
                    expireAt = new Date(now - Math.min(...exps)).toISOString();
                    onHold = true;
                } else if (exps.some((e) => e > 0)) expireAt = new Date(Math.max(...exps)).toISOString();
                // 3x-ui switches clients off when they run out, so out-of-time and out-of-traffic come first.
                const status = !onHold && expireAt !== NEVER && Date.parse(expireAt) < now ? 'EXPIRED' : limit && used >= limit ? 'LIMITED' : !enabled ? 'DISABLED' : 'ACTIVE';
                // reset is auto-renew (days added on expiry); trafficReset (3.x, client or inbound) is the period.
                const renew = +c0.reset || 0;
                const period = [c0.trafficReset, c0.ibReset].find((r) => r && r !== 'never');
                const set = [...g.tags].filter((t) => tags.has(t)).sort();
                const key = set.join('\n');
                if (set.length && !squads.has(key)) squads.set(key, set);
                const ip = +c0.limitIp;
                const lost = [...new Set(g.clients.filter((c) => !PER_USER.has(c.protocol)).map((c) => c.protocol))];
                const ss = pick('shadowsocks');
                return {
                    source: c0.email || g.key,
                    status,
                    trafficLimitBytes: limit,
                    trafficLimitStrategy: RESET[period] || 'NO_RESET',
                    hourly: period === 'hourly' || undefined,
                    renew: renew || undefined,
                    usedTrafficBytes: used,
                    lifetimeUsedTrafficBytes: used,
                    expireAt,
                    onHold,
                    createdAt: iso(c0.created_at) || undefined,
                    description: c0.comment || undefined,
                    telegramId: Number.isSafeInteger(+c0.tgId) && +c0.tgId > 0 ? +c0.tgId : undefined,
                    ipLimit: ip >= 1 && ip <= 100 ? ip : undefined,
                    vlessUuid: isUuid(pick('vless')?.id) ? pick('vless').id : isUuid(pick('vmess')?.id) ? pick('vmess').id : undefined,
                    trojanPassword: pw(pick('trojan')?.password),
                    ssPassword: ss && !String(ss.method || '').startsWith('2022-') ? pw(ss.password) : undefined,
                    shortUuid: c0.subId || undefined,
                    squadKeys: set.length ? [key] : [],
                    lost: lost.map(protoName),
                };
            });
            out.squads = setSquads(squads, '3x-ui', tags);
            out.nodes = [{ name: '3x-ui server', address: host }];
            out.admins = [];
            out.links = { kind: '3x-ui', subPath: settings.subPath, subJsonPath: settings.subJsonPath, subClashPath: settings.subClashPath, subTls: !!settings.subCertFile, subPort: settings.subPort, subDomain: settings.subDomain, subURI: settings.subURI };
            return out;
        },
    },

    // Remnawave: the panel Umiji grew from, so almost everything maps one to one.
    remnawave: {
        async read(src) {
            const base = trimUrl(src.url);
            const headers = { authorization: `Bearer ${src.token}` };
            // Remnawave wants the same proxy headers as Umiji when it's reached on plain HTTP.
            if (base.startsWith('http://')) Object.assign(headers, { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' });
            const get = async (p, what) => {
                const r = await http(base + p, { headers });
                if (r.status === 401 || r.status === 403) throw new Stop('Login: Remnawave refused the API token.', 2);
                return must(r, what).response;
            };
            const out = { panel: 'Remnawave', notes: [], links: {} };
            const users = [];
            for (let start = 0; ; start += 1000) {
                const page = await get(`/api/users?start=${start}&size=1000`, 'Reading users');
                users.push(...page.users);
                if (!page.users.length || users.length >= page.total) break;
            }
            const profiles = (await get('/api/config-profiles', 'Reading config profiles')).configProfiles;
            const inbound = {};
            out.profiles = profiles.map((p) => {
                for (const ib of p.inbounds) inbound[ib.uuid] = { profile: p.name, tag: ib.tag };
                return { name: groupName(p.name, 'Remnawave'), config: cleanConfig(p.config, out.notes, `Profile "${p.name}"`) };
            });
            for (const ref of Object.values(inbound)) ref.profile = groupName(ref.profile, 'Remnawave');
            const squads = (await get('/api/internal-squads', 'Reading internal squads')).internalSquads;
            out.squads = squads.map((s) => ({ key: s.uuid, name: groupName(s.name, 'Squad'), refs: s.inbounds.map((i) => inbound[i.uuid]).filter(Boolean) }));
            out.users = users.map((u) => ({
                source: u.username,
                status: u.status,
                trafficLimitBytes: num(u.trafficLimitBytes),
                trafficLimitStrategy: u.trafficLimitStrategy,
                usedTrafficBytes: num(u.userTraffic?.usedTrafficBytes ?? u.usedTrafficBytes),
                lifetimeUsedTrafficBytes: num(u.userTraffic?.lifetimeUsedTrafficBytes ?? u.lifetimeUsedTrafficBytes),
                expireAt: iso(u.expireAt) || NEVER,
                createdAt: iso(u.createdAt),
                lastTrafficResetAt: iso(u.lastTrafficResetAt),
                description: u.description || undefined,
                tag: u.tag || undefined,
                telegramId: u.telegramId ?? undefined,
                email: u.email || undefined,
                hwidDeviceLimit: u.hwidDeviceLimit ?? undefined,
                vlessUuid: u.vlessUuid,
                trojanPassword: pw(u.trojanPassword),
                ssPassword: pw(u.ssPassword),
                shortUuid: u.shortUuid,
                squadKeys: (u.activeInternalSquads || []).map((s) => s.uuid),
                externalSquad: !!u.externalSquadUuid,
            }));
            if (out.users.some((u) => u.externalSquad)) out.notes.push('External squads aren\'t copied; users in one keep the default subscription settings.');
            const hosts = await get('/api/hosts', 'Reading hosts');
            out.hosts = hosts.filter((h) => inbound[h.inbound?.configProfileInboundUuid]).map((h) => ({ ...h, ...inbound[h.inbound.configProfileInboundUuid], umiji: true }));
            out.nodes = (await get('/api/nodes', 'Reading nodes').catch(() => [])).map((n) => ({ name: n.name, address: n.address }));
            out.admins = [];
            out.links = { kind: 'remnawave', sample: users[0]?.subscriptionUrl };
            return out;
        },
    },

    // Hiddify Manager: users only. Its inbounds come from its own templates, which its API doesn't export.
    hiddify: {
        async read(src) {
            // The admin link is https://domain/<proxy path>/<admin uuid>/…; the uuid is the API key.
            const u = new URL(src.url);
            const parts = u.pathname.split('/').filter(Boolean);
            const key = src.token || parts.find(isUuid);
            const path = parts[0] && !isUuid(parts[0]) ? parts[0] : '';
            if (!key || !path) throw new Stop('Use the admin link Hiddify gave you: https://domain/<path>/<admin uuid>/', 2);
            const base = `${u.origin}/${path}/api/v2/admin`;
            const headers = { 'hiddify-api-key': key };
            const get = async (p, what) => {
                const r = await http(base + p, { headers });
                if (r.status === 401 || r.status === 403) throw new Stop('Login: Hiddify refused the admin key in this link.', 2);
                if (r.status === 404 && p === '/user/') return [];
                return must(r, what);
            };
            const out = { panel: 'Hiddify', notes: [], links: {} };
            const users = await get('/user/', 'Reading users');
            const admins = await get('/admin_user/', 'Reading admins').catch(() => []);
            const adminName = Object.fromEntries(admins.map((a) => [a.uuid, a.name]));
            const now = Date.now();
            out.users = users.map((h) => {
                const limit = Math.round((+h.usage_limit_GB || 0) * GB);
                const used = Math.round((+h.current_usage_GB || 0) * GB);
                const start = h.start_date ? Date.parse(h.start_date + 'T00:00:00Z') : null;
                const days = +h.package_days || 0;
                const expireAt = new Date((start ?? now) + days * DAY).toISOString();
                const status = h.enable === false ? 'DISABLED' : start && start + days * DAY < now ? 'EXPIRED' : limit && used >= limit ? 'LIMITED' : 'ACTIVE';
                return {
                    source: h.name,
                    status,
                    trafficLimitBytes: limit,
                    trafficLimitStrategy: RESET[h.mode] || 'NO_RESET',
                    usedTrafficBytes: used,
                    lifetimeUsedTrafficBytes: used,
                    expireAt,
                    onHold: !start,
                    description: h.comment || undefined,
                    telegramId: Number.isSafeInteger(h.telegram_id) && h.telegram_id > 0 ? h.telegram_id : undefined,
                    vlessUuid: isUuid(h.uuid) ? h.uuid : undefined,
                    shortUuid: h.uuid,
                    // Users of the admin whose link this is are the owner's own.
                    owner: h.added_by_uuid === key ? undefined : adminName[h.added_by_uuid],
                    squadKeys: [],
                };
            });
            out.profiles = [];
            out.squads = [];
            out.hosts = [];
            out.nodes = [{ name: 'Hiddify server', address: u.hostname }];
            out.admins = admins.map((a) => a.name);
            out.notes.push('Hiddify\'s API doesn\'t export its inbounds. Make a config profile and a squad here first and name the squad when you run this (TARGET_SQUAD), or add users to it later from the squad\'s Add users.');
            out.notes.push('Hiddify uses the whole UUID as the Trojan and Shadowsocks password, longer than Umiji allows, so those get new passwords. VLESS keeps the old UUID.');
            out.links = { kind: 'hiddify', clientPath: null };
            return out;
        },
    },
};

// ── Umiji ────────────────────────────────────────────────────────────────────────────────────────────

function umijiClient() {
    const base = trimUrl(E.UMIJI_URL || 'http://127.0.0.1:3000');
    let token = E.UMIJI_TOKEN;
    if (!token) {
        // Inside the panel's container: sign a short owner login the way the panel does (auth.service.ts).
        if (!E.APP_SECRET || !E.OWNER_NAME || !E.OWNER_UUID) throw new Stop('Set UMIJI_URL and UMIJI_TOKEN (an API token from Umiji Settings → API Tokens).');
        const now = Math.floor(Date.now() / 1000);
        const enc = (o) => b64url(JSON.stringify(o));
        const head = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ username: E.OWNER_NAME, uuid: E.OWNER_UUID, role: 'ADMIN', iat: now, exp: now + 6 * 3600 });
        token = head + '.' + b64url(crypto.createHmac('sha256', E.APP_SECRET).update(head).digest());
    }
    const headers = { authorization: `Bearer ${token}` };
    if (token.split('.').length === 3) headers['x-umiji-client-type'] = 'browser';
    if (base.startsWith('http://')) Object.assign(headers, { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' });
    return async (method, path, body) => {
        const r = await http(`${base}/api/${path}`, { method, headers, body });
        if (r.status === 401 || r.status === 403) throw new Stop(`Umiji refused the login (HTTP ${r.status}) on /api/${path}.`);
        return r;
    };
}

async function umijiState(api) {
    const ok = async (p) => must(await api('GET', p), `Umiji /api/${p}`).response;
    const users = new Map();
    let cursor;
    do {
        const page = await ok(`users/stream?size=1000${cursor ? `&cursor=${cursor}` : ''}`);
        for (const u of page.users) users.set(u.username.toLowerCase(), u);
        cursor = page.hasMore ? page.nextCursor : null;
    } while (cursor);
    const profiles = (await ok('config-profiles')).configProfiles;
    const squads = (await ok('internal-squads')).internalSquads;
    const hosts = await ok('hosts');
    return { users, shortUuids: new Set([...users.values()].map((u) => u.shortUuid)), profiles, squads, hosts };
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────────

function plan(data, state) {
    const p = { profiles: [], squads: [], hosts: [], users: [], skipped: [], renamed: [], notes: [...data.notes], hostNotes: new Set() };
    const profileByName = new Map(state.profiles.map((x) => [x.name.toLowerCase(), x]));
    // Umiji wants every inbound tag unique across profiles. A taken tag becomes "<tag> - <profile>", which a
    // rerun finds again; clients never see tags.
    const taken = new Set(state.profiles.flatMap((x) => x.inbounds.map((i) => i.tag)));
    p.tag = (profile, tag) => {
        const pr = p.profiles.find((x) => x.name === profile);
        if (!pr) return tag;
        if (pr.existing) return pr.existing.inbounds.find((i) => i.tag === tag || i.tag.startsWith(`${tag} - ${profile}`))?.tag ?? tag;
        return pr.renamed[tag] ?? tag;
    };
    for (const pr of data.profiles) {
        if (!pr.config.inbounds.length) {
            p.notes.push(`Profile "${pr.name}" has no inbound Umiji can run, so it isn't made.`);
            continue;
        }
        // A profile of the same name is used only when it has these inbounds: this panel, moved before.
        // Another panel's (a second 3x-ui server, say) gets "<name> 2".
        const fits = (x) => pr.config.inbounds.every((ib) => x.inbounds.some((i) => i.tag === ib.tag || i.tag.startsWith(`${ib.tag} - `)));
        let have = profileByName.get(pr.name.toLowerCase());
        const old = pr.name;
        while (have && !fits(have)) {
            pr.name = bump(pr.name);
            have = profileByName.get(pr.name.toLowerCase());
        }
        if (pr.name !== old) {
            for (const r of data.squads.flatMap((x) => x.refs || [])) if (r.profile === old) r.profile = pr.name;
            for (const h of data.hosts) if (h.profile === old) h.profile = pr.name;
        }
        const renamed = {};
        if (!have) {
            for (const ib of pr.config.inbounds) {
                let t = ib.tag;
                for (let n = 2; taken.has(t); n++) t = `${ib.tag} - ${pr.name}${n > 2 ? ` ${n}` : ''}`;
                if (t !== ib.tag) renamed[ib.tag] = t;
                taken.add(t);
            }
            for (const ib of pr.config.inbounds) ib.tag = renamed[ib.tag] ?? ib.tag;
            for (const r of pr.config.routing?.rules || []) if (r.inboundTag) r.inboundTag = r.inboundTag.map((t) => renamed[t] ?? t);
            const n = Object.keys(renamed).length;
            if (n) p.notes.push(`Profile "${pr.name}": ${plural(n, 'inbound tag')} already used here got " - ${pr.name}" added, since tags must be unique.`);
        }
        Object.assign(pr, { existing: have || null, renamed });
        p.profiles.push(pr);
        if (have) p.notes.push(`Profile "${pr.name}" is already here, so it's kept as it is and used.`);
    }
    const squadByName = new Map(state.squads.map((x) => [x.name.toLowerCase(), x]));
    const madeNames = new Set();
    for (const sq of data.squads) {
        // A tag in several profiles (PasarGuard cores) means all of them: a node runs one.
        const refs = (sq.refs || sq.tags.flatMap((tag) => data.profiles.filter((x) => x.config.inbounds.some((i) => i.tag === (x.renamed?.[tag] ?? tag))).map((x) => ({ profile: x.name, tag })))).filter(
            (r) => p.profiles.some((x) => x.name === r.profile),
        );
        if (!refs.length) {
            p.notes.push(`Group "${sq.name}" has no inbound Umiji can run, so no squad is made for it.`);
            continue;
        }
        // Same rule as profiles: a squad of the same name is used only with the same inbounds.
        const want = new Set(refs.map((r) => p.tag(r.profile, r.tag)));
        const same = (x) => x.inbounds.length === want.size && x.inbounds.every((i) => want.has(i.tag));
        let name = sq.name;
        while (madeNames.has(name.toLowerCase()) || (squadByName.has(name.toLowerCase()) && !same(squadByName.get(name.toLowerCase())))) name = bump(name);
        madeNames.add(name.toLowerCase());
        p.squads.push({ ...sq, name, refs, existing: squadByName.get(name.toLowerCase()) || null });
    }
    // Users with no squad of their own (Hiddify's always) can join an existing squad.
    if (E.TARGET_SQUAD) {
        p.target = state.squads.find((x) => x.name.toLowerCase() === E.TARGET_SQUAD.toLowerCase());
        if (!p.target) throw new Stop(`There's no squad named "${E.TARGET_SQUAD}" here. Make it first, or leave TARGET_SQUAD empty.`);
    }
    const names = new Map();
    const shortUuids = new Set(state.shortUuids);
    for (const u of data.users) {
        const username = umijiName(u.source);
        const lower = username.toLowerCase();
        if (state.users.has(lower)) {
            p.skipped.push(`${u.source}: already here`);
            continue;
        }
        if (names.has(lower)) {
            p.skipped.push(`${u.source}: its Umiji name ${username} is taken by ${names.get(lower)}`);
            continue;
        }
        names.set(lower, u.source);
        if (username !== u.source) p.renamed.push(`${u.source} → ${username}`);
        const user = { ...u, username };
        if (user.shortUuid && shortUuids.has(user.shortUuid)) {
            p.notes.push(`${u.source}: its old link id is already used here, so it gets a new link.`);
            delete user.shortUuid;
        }
        if (user.shortUuid) shortUuids.add(user.shortUuid);
        p.users.push(user);
    }
    // Only hosts on an inbound that comes over, so the plan's count is what gets made.
    for (const h of data.hosts) if (p.profiles.some((x) => x.name === h.profile && x.config.inbounds.some((i) => i.tag === h.tag || i.tag === p.tag(h.profile, h.tag)))) p.hosts.push(h);
    return p;
}

function report(data, p, src) {
    say(`${data.panel} at ${new URL(src.url).host}`);
    const by = (k) => p.users.filter(k).length;
    say(`  Users        ${p.users.length} to move${p.skipped.length ? `, ${p.skipped.length} skipped` : ''}`);
    const counts = ['ACTIVE', 'DISABLED', 'LIMITED', 'EXPIRED'].map((s) => [s, by((u) => u.status === s)]).filter(([, n]) => n);
    if (counts.length) say(`               ${counts.map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ')}`);
    say(`  Profiles     ${p.profiles.length ? p.profiles.map((x) => `${x.name} (${plural(x.config.inbounds.length, 'inbound')})${x.existing ? ' already here' : ''}`).join(', ') : 'none'}`);
    say(`  Squads       ${p.squads.length ? p.squads.map((x) => x.name + (x.existing ? ' (already here)' : '')).join(', ') : 'none'}`);
    if (p.squads.length > 1) for (const x of p.squads) say(`               ${x.name}: ${[...new Set(x.refs.map((r) => r.tag))].join(', ') || 'no inbounds'}`);
    say(`  Hosts        ${p.hosts.length}`);
    if (p.target) say(`  Squad for users without one: ${p.target.name}`);
    if (data.nodes.length) say(`  Nodes        ${data.nodes.map((n) => n.name).join(', ')}  (not moved: install Umiji's node on each)`);
    const lines = [];
    const onHold = by((u) => u.onHold);
    if (onHold) lines.push(`Waiting for first use: ${plural(onHold, 'user')}. Umiji has no such state, so their days start counting today.`);
    const yearly = by((u) => u.yearly);
    if (yearly) lines.push(`Yearly traffic reset: ${plural(yearly, 'user')}. Umiji has no yearly reset, so they get none.`);
    const hourly = by((u) => u.hourly);
    if (hourly) lines.push(`Hourly traffic reset: ${plural(hourly, 'user')}. Umiji's shortest reset is daily, so they get none.`);
    const renew = by((u) => u.renew);
    if (renew) lines.push(`Auto-renew: ${plural(renew, 'user')}. Umiji has none, so they stop on their current expiry date.`);
    const owners = [...new Set(p.users.map((u) => u.owner).filter(Boolean))];
    if (owners.length) lines.push(`Users of ${owners.join(', ')} are kept together with "Owner: <name>" in their description. Brokers aren't made for them.`);
    const lost = {};
    for (const u of p.users) for (const l of u.lost || []) lost[l] = (lost[l] || 0) + 1;
    for (const [l, n] of Object.entries(lost)) lines.push(`${l}: ${plural(n, 'user')} had it too. Umiji doesn't run ${l}, so only their other protocols move.`);
    if (p.renamed.length) lines.push(`Renamed to fit Umiji: ${p.renamed.slice(0, 5).join(', ')}${p.renamed.length > 5 ? ` and ${p.renamed.length - 5} more` : ''}.`);
    // Users already here are counted on the Users line; only other skips are worth a line each.
    const odd = p.skipped.filter((x) => !x.endsWith(': already here'));
    for (const x of odd.slice(0, 5)) lines.push(`Skipped ${x}.`);
    if (odd.length > 5) lines.push(`… and ${odd.length - 5} more skipped.`);
    lines.push(...p.notes);
    if (lines.length) {
        say('');
        say('Worth knowing');
        for (const l of [...new Set(lines)]) say(`  - ${l}`);
    }
    links(data, src, p);
}

// What old subscription links need, for the report and the installer.
function links(data, src, p) {
    const L = data.links;
    const lines = [];
    const sample = (s) => (s ? s.replace(/^\/+/, '') : '');
    let from = new URL(src.url).origin;
    switch (L.kind) {
        case 'marzban':
        case 'pasarguard': {
            const m = /^(https?:\/\/[^/]+)?\/?(.*)\/[^/]+$/.exec(L.sample || '');
            if (m?.[1]) from = m[1];
            const path = m?.[2] || 'sub';
            if (src.secret) {
                say(`@env MARZBAN_LEGACY_LINK_ENABLED=true`);
                say(`@env MARZBAN_LEGACY_SECRET_KEY=${src.secret}`);
                lines.push(`Old links keep working once ${from} points at the sub page.`);
            } else lines.push(`Old links need the old panel's secret: without it, send users their new link.`);
            if (path !== 'sub') say(`@env LEGACY_SUB_PATHS=${path}`);
            break;
        }
        case 'marzneshin':
            if (/^https?:/.test(L.sample || '')) from = new URL(L.sample).origin;
            lines.push(`Old links keep working once ${from} points at the sub page.`);
            break;
        case '3x-ui': {
            if (L.subURI && /^https?:/.test(L.subURI)) from = new URL(L.subURI).origin;
            else from = `${L.subTls ? 'https' : 'http'}://${L.subDomain || new URL(src.url).hostname}${L.subPort && +L.subPort !== (L.subTls ? 443 : 80) ? `:${L.subPort}` : ''}`;
            // 3.x picks random paths per install; the sub page needs them and the format each serves.
            const trim = (x) => sample(x).replace(/\/+$/, '');
            const extra = [
                [trim(L.subPath), '', 'sub'],
                [trim(L.subJsonPath), ':json', 'json'],
                [trim(L.subClashPath), ':mihomo', 'clash'],
            ].filter(([path, , def]) => path && path !== def);
            if (extra.length) say(`@env LEGACY_SUB_PATHS=${extra.map(([path, type]) => path + type).join(',')}`);
            lines.push(`Old links keep working once ${from} points at the sub page.`);
            break;
        }
        case 'remnawave':
            if (/^https?:/.test(L.sample || '')) from = new URL(L.sample).origin;
            lines.push(`Links keep their Short UUID: they work once ${from} points at the sub page.`);
            break;
        case 'hiddify':
            lines.push(`Old links keep working once ${from} points at the sub page.`);
            break;
    }
    say(`@domain ${from}`);
    say('');
    say('Old links');
    for (const l of lines) say(`  - ${l}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────────

async function apply(api, data, p, src) {
    const err = (r) => r.json?.message || r.json?.errors?.[0]?.message || r.text?.slice(0, 200);
    const inboundUuid = {};
    const profileUuid = {};
    for (const pr of p.profiles) {
        let prof = pr.existing;
        if (!prof) {
            const r = await api('POST', 'config-profiles', { name: pr.name, config: pr.config });
            if (!r.ok) throw new Stop(`Profile ${pr.name} wasn't made: ${err(r)}\nNo users were moved. Fix it in the old panel or here, then run this again.`);
            prof = r.json.response;
            say(`  Profile ${pr.name} made, ${plural(prof.inbounds.length, 'inbound')}`);
        }
        profileUuid[pr.name] = prof.uuid;
        for (const ib of prof.inbounds) inboundUuid[`${pr.name}\n${ib.tag}`] = ib.uuid;
    }
    const squadUuid = {};
    for (const sq of p.squads) {
        if (sq.existing) {
            squadUuid[sq.key] = sq.existing.uuid;
            continue;
        }
        const inbounds = [...new Set(sq.refs.map((r) => inboundUuid[`${r.profile}\n${p.tag(r.profile, r.tag)}`]).filter(Boolean))];
        if (sq.refs.length && !inbounds.length) throw new Stop(`Squad ${sq.name}: none of its inbounds were found here. No users were moved.`);
        const r = await api('POST', 'internal-squads', { name: sq.name, inbounds });
        if (!r.ok) throw new Stop(`Squad ${sq.name} wasn't made: ${err(r)}\nNo users were moved. Run this again once it's fixed.`);
        squadUuid[sq.key] = r.json.response.uuid;
        say(`  Squad ${sq.name} made, ${plural(inbounds.length, 'inbound')}`);
    }
    // Hosts: skip one that's already on the same inbound with the same address and port.
    const state = await umijiState(api);
    const haveHost = new Set(state.hosts.map((h) => `${h.inbound.configProfileInboundUuid}\n${h.address}\n${h.port}`));
    let hosts = 0;
    let serverIp;
    for (const h of p.hosts) {
        const tag = p.tag(h.profile, h.tag);
        const ib = inboundUuid[`${h.profile}\n${tag}`];
        if (!ib) continue;
        const inbound = p.profiles.find((x) => x.name === h.profile)?.config.inbounds.find((i) => i.tag === tag);
        let address = firstOf(h.address);
        const guessed = !address || /\{SERVER_IP(V6)?\}/.test(address);
        if (guessed && h.serverIp) address = h.serverIp;
        else if (guessed) {
            // {SERVER_IP} was the old server; with the node there, it's that server's address.
            serverIp ??= await dns.lookup(new URL(src.url).hostname).then((r) => r.address).catch(() => new URL(src.url).hostname);
            address = serverIp;
        }
        const port = +h.port || inbound?.port;
        if (!port || haveHost.has(`${ib}\n${address}\n${port}`)) continue;
        const body = h.umiji
            ? Object.fromEntries(Object.entries({ ...h, inbound: undefined, uuid: undefined, viewPosition: undefined, nodes: undefined, profile: undefined, tag: undefined, umiji: undefined, excludedInternalSquads: undefined, internalSquads: undefined, xrayJsonTemplateUuid: undefined, mapper: undefined }).filter(([, v]) => v !== undefined))
            : {
                  remark: remark(h.remark, p.hostNotes),
                  port,
                  path: h.path || null,
                  sni: firstOf(h.sni),
                  host: firstOf(h.host),
                  alpn: ALPN.has(firstOf(h.alpn) && (Array.isArray(h.alpn) ? h.alpn.join(',') : h.alpn)) ? (Array.isArray(h.alpn) ? h.alpn.join(',') : h.alpn) : null,
                  fingerprint: h.fingerprint && h.fingerprint !== 'none' ? h.fingerprint : null,
                  isDisabled: !!h.is_disabled,
                  securityLayer: security(h.security),
              };
        body.address = address;
        body.port = port;
        body.inbound = { configProfileUuid: profileUuid[h.profile], configProfileInboundUuid: ib };
        if (h.sni && Array.isArray(h.sni) ? h.sni.length > 1 : String(h.sni || '').includes(',')) p.hostNotes.add('Hosts with several SNIs keep the first one.');
        if (Array.isArray(h.address) && h.address.length > 1) p.hostNotes.add('Hosts with several addresses keep the first one.');
        const r = await api('POST', 'hosts', body);
        if (!r.ok) say(`  ! Host ${body.remark} (${address}:${port}) wasn't made: ${err(r)}`);
        else {
            hosts++;
            haveHost.add(`${ib}\n${address}\n${port}`);
            if (guessed) p.hostNotes.add(h.serverIp ? 'Hosts with {SERVER_IP} got their node\'s address.' : `Hosts with {SERVER_IP} got ${serverIp}, the old panel's address. Change it if the node runs elsewhere.`);
        }
    }
    if (p.hosts.length) say(`  ${plural(hosts, 'host')} made`);
    for (const n of p.hostNotes) say(`  - ${n}`);

    let made = 0, failed = 0, lastSay = Date.now();
    const queue = [...p.users];
    const total = queue.length;
    const one = async (u) => {
        const body = {
            username: u.username,
            status: u.status,
            shortUuid: u.shortUuid,
            vlessUuid: u.vlessUuid,
            trojanPassword: u.trojanPassword,
            ssPassword: u.ssPassword,
            trafficLimitBytes: u.trafficLimitBytes,
            trafficLimitStrategy: u.trafficLimitStrategy,
            usedTrafficBytes: u.usedTrafficBytes,
            lifetimeUsedTrafficBytes: u.lifetimeUsedTrafficBytes,
            expireAt: u.expireAt,
            createdAt: u.createdAt,
            lastTrafficResetAt: u.lastTrafficResetAt,
            description: [u.description, u.owner && `Owner: ${u.owner}`].filter(Boolean).join('\n') || undefined,
            tag: u.tag,
            telegramId: u.telegramId,
            email: u.email,
            hwidDeviceLimit: u.hwidDeviceLimit,
            ipLimit: u.ipLimit,
            activeInternalSquads: u.squadKeys?.length ? u.squadKeys.map((k) => squadUuid[k]).filter(Boolean) : p.target ? [p.target.uuid] : [],
        };
        let r = await api('POST', 'users', body);
        if (!r.ok && /email/i.test(err(r)) && body.email) {
            delete body.email;
            r = await api('POST', 'users', body);
        }
        if (!r.ok) {
            failed++;
            say(`  ! ${u.source}: ${err(r)}`);
            return;
        }
        made++;
        return r.json.response;
    };
    // An older panel drops usedTrafficBytes without a word. One user with traffic goes first, alone; if
    // it came back at zero, it's deleted again and nothing else is made.
    const probe = queue.findIndex((u) => u.usedTrafficBytes > 0);
    if (probe !== -1) {
        const [u] = queue.splice(probe, 1);
        const got = await one(u);
        if (got && +(got.userTraffic?.usedTrafficBytes ?? got.usedTrafficBytes) !== u.usedTrafficBytes) {
            const del = await api('DELETE', `users/${got.id ?? got.uuid}`);
            throw new Stop(`This panel is too old to take used traffic, so no users were moved.${del.ok ? '' : ` Delete ${got.username}, the one test user, by hand.`} Update the panel first (umiji → Update all), then run this again.`, 8);
        }
    }
    const workers = Array.from({ length: 6 }, async () => {
        while (queue.length) {
            await one(queue.shift());
            if (Date.now() - lastSay > 5000) {
                lastSay = Date.now();
                say(`  Users ${made + failed} of ${total}`);
            }
        }
    });
    await Promise.all(workers);
    say(`  ${plural(made, 'user')} moved${failed ? `, ${failed} failed (see above)` : ''}`);
    return failed ? 7 : 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
    const act = process.argv[2] || E.MIGRATE_ACT || 'plan';
    const type = (E.SRC_TYPE || '').toLowerCase().replace(/^3xui$/, '3x-ui');
    if (!SOURCES[type]) throw new Stop(`SRC_TYPE must be one of: ${Object.keys(SOURCES).join(', ')}`);
    if (!E.SRC_URL) throw new Stop('SRC_URL is the old panel\'s address.');
    if (E.SRC_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const src = { url: E.SRC_URL, user: E.SRC_USER, pass: E.SRC_PASS, token: E.SRC_TOKEN, secret: E.SRC_SECRET || '' };
    const data = await SOURCES[type].read(src);
    // Users of the account we signed in with are the owner's own; only other admins' users get a label.
    for (const u of data.users) if (u.owner && u.owner === src.user) delete u.owner;
    if (act === 'check') return say(`${data.panel}: ${plural(data.users.length, 'user')}`);
    const api = umijiClient();
    const state = await umijiState(api);
    const p = plan(data, state);
    if (act === 'plan') return report(data, p, src);
    if (act !== 'run') throw new Stop('Say plan, check or run.');
    process.exitCode = await apply(api, data, p, src);
}

export const SOURCES_FOR_TEST = { SOURCES, umijiName, sanitizeUsername };

// Run as a script (a file, or "node -" from stdin); imported by the tests.
if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
    // The only warning here is the one about SRC_INSECURE, which the user asked for.
    process.removeAllListeners('warning');
    main().catch((err) => {
        say(err instanceof Stop ? err.message : `Something went wrong: ${err.stack || err.message}`);
        process.exit(err.code || 1);
    });
}
