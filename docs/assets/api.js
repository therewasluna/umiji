// Umiji wiki, API guide: renders the endpoint reference, schema trees, examples and the error-code
// table from api/spec.json (built by tools/api-docs/build.sh), plus the page's tabs, search and panel
// address field. Endpoint text stays English, as the API itself is; labels follow the page language.
;(() => {
    const fa = document.documentElement.lang === 'fa'
    const root = document.getElementById('ref-root')
    if (!root) return

    const L = fa
        ? {
              params: 'پارامترها',
              body: 'بدنه‌ی درخواست',
              response: 'پاسخ',
              noBody: 'بدون بدنه',
              request: 'درخواست',
              example: 'نمونه‌ی پاسخ',
              required: 'لازم',
              fields: (n) => `${n} فیلد`,
              item: 'هر آیتم',
              oneOf: 'یکی از این‌ها',
              option: (n) => `حالت ${n}`,
              token: 'توکن API',
              owner: 'مالک در پنل',
              broker: 'فروشنده در پنل',
              open: 'بدون توکن',
              scope: 'دامنه‌ی دسترسی',
              alsoBy: 'این‌ها هم کافی‌اند:',
              copied: 'کپی شد',
              panelOnly:
                  'این اندپوینت فقط از داخل پنل در مرورگر کار می‌کند و توکن API برایش 403 می‌گیرد. شکل بدنه و پاسخ برای آشنایی با کار پنل آمده است.',
              publicNote: 'بدون توکن. شناسه‌ی کوتاه لینک اشتراک خودش کلید است.',
              text: 'متن خام (فرمت را قوانین پاسخ تعیین می‌کنند)',
              status: { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content' },
              empty: 'پاسخی بدون بدنه.',
              count: (n, all) => (n === all ? `${all} اندپوینت` : `${n} از ${all} اندپوینت`),
              none: 'چیزی پیدا نشد. کلمه‌ی دیگری امتحان کنید، مثل users یا reset.',
              failed: 'مرجع بارگیری نشد. صفحه را تازه کنید.',
              in: { path: 'path', query: 'query', header: 'header' }
          }
        : {
              params: 'Parameters',
              body: 'Request body',
              response: 'Response',
              noBody: 'No body',
              request: 'Request',
              example: 'Example response',
              required: 'required',
              fields: (n) => `${n} field${n === 1 ? '' : 's'}`,
              item: 'each item',
              oneOf: 'One of',
              option: (n) => `Option ${n}`,
              token: 'API token',
              owner: 'Owner in panel',
              broker: 'Broker in panel',
              open: 'No token',
              scope: 'Scope',
              alsoBy: 'Also granted by',
              copied: 'Copied',
              panelOnly:
                  'Works only from inside the panel, in the browser: an API token gets 403 here. The body and response are shown so you know what the panel does.',
              publicNote: 'No token. The short ID in the subscription link is the key.',
              text: 'Raw text (the format comes from the response rules)',
              status: { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content' },
              empty: 'An empty response.',
              count: (n, all) => (n === all ? `${all} endpoints` : `${n} of ${all} endpoints`),
              none: 'Nothing found. Try another word, like users or reset.',
              failed: 'The reference didn’t load. Refresh the page.',
              in: { path: 'path', query: 'query', header: 'header' }
          }

    // Group names and one-line descriptions, in both languages.
    const SECTIONS = {
        Users: 'کاربرها',
        Nodes: 'نودها',
        Config: 'کانفیگ',
        Subscription: 'اشتراک',
        Brokers: 'فروشنده‌ها',
        Panel: 'پنل'
    }
    const GROUPS = {
        users: ['Users', 'کاربرها', 'Create, find, change and remove users, and switch them on or off.', 'ساختن، پیدا کردن، تغییر و حذف کاربرها، و روشن و خاموش کردن آن‌ها.'],
        'users-bulk-actions': ['Users: bulk actions', 'کاربرها: عملیات گروهی', 'The same change for many users at once: by a list of IDs, or for everyone.', 'یک تغییر برای چند کاربر با هم: با فهرستی از شناسه‌ها، یا برای همه.'],
        'hwid-devices': ['HWID devices', 'دستگاه‌های HWID', 'The devices each user’s apps report, for the HWID device limit.', 'دستگاه‌هایی که برنامه‌های هر کاربر گزارش می‌دهند، برای لیمیت دستگاه HWID.'],
        subscriptions: ['Subscriptions', 'اشتراک‌ها', 'A user’s subscription as JSON: links, keys, Telegram proxy links and the subscription page’s settings. Needs a token.', 'اشتراک کاربر به صورت JSON: لینک‌ها، کلیدها، لینک‌های پروکسی تلگرام و تنظیمات صفحه‌ی اشتراک. توکن لازم دارد.'],
        'public-subscription': ['Public subscription', 'اشتراک عمومی', 'What client apps download. No token: the short ID in the link is the key.', 'چیزی که برنامه‌های کلاینت دانلود می‌کنند. بدون توکن: شناسه‌ی کوتاه داخل لینک همان کلید است.'],
        'subscription-request-history': ['Subscription requests', 'درخواست‌های اشتراک', 'Every time an app fetched a subscription: when, from which IP and with which app.', 'هر بار که برنامه‌ای اشتراک را گرفته: کی، از کدام IP و با کدام برنامه.'],
        nodes: ['Nodes', 'نودها', 'Your servers: add, change, enable, disable, restart and reorder them.', 'سرورهای شما: افزودن، تغییر، فعال و غیرفعال کردن، ری‌استارت و مرتب کردن.'],
        'node-plugins': ['Node plugins', 'پلاگین‌های نود', 'Plugins that run on nodes, shared lists, and Torrent Blocker reports.', 'پلاگین‌هایی که روی نودها اجرا می‌شوند، فهرست‌های مشترک و گزارش‌های Torrent Blocker.'],
        'bandwidth-stats': ['Bandwidth stats', 'آمار ترافیک', 'Traffic per node and per user over a date range.', 'ترافیک هر نود و هر کاربر در یک بازه‌ی زمانی.'],
        connections: ['Connections', 'اتصال‌ها', 'Who is connected right now, by user or by node, and dropping connections. Requests start a job: ask again with its ID.', 'چه کسی همین الان وصل است، به تفکیک کاربر یا نود، و قطع کردن اتصال‌ها. درخواست یک کار پس‌زمینه می‌سازد: با شناسه‌اش دوباره بپرسید.'],
        'infra-billing': ['Infra billing', 'صورتحساب‌های تجهیزات', 'What your servers cost: providers, billed nodes and payment history.', 'هزینه‌ی سرورهایتان: ارائه‌دهنده‌ها، نودهای دارای صورتحساب و تاریخچه‌ی پرداخت.'],
        'config-profiles': ['Config profiles', 'پروفایل‌های کانفیگ', 'Xray configurations and the inbounds inside them.', 'کانفیگ‌های Xray و اینباندهای داخل آن‌ها.'],
        snippets: ['Snippets', 'قطعه کدها', 'Reusable pieces of Xray config that profiles can include.', 'تکه‌هایی از کانفیگ Xray که پروفایل‌ها می‌توانند دوباره استفاده کنند.'],
        'internal-squads': ['Internal squads', 'اسکوادهای داخلی', 'Sets of inbounds that decide which servers a user gets.', 'مجموعه‌هایی از اینباندها که مشخص می‌کنند کاربر کدام سرورها را بگیرد.'],
        'external-squads': ['External squads', 'اسکوادهای خارجی', 'Per-group overrides for templates, subscription settings and the subscription page.', 'جایگزین‌های هر گروه برای قالب‌ها، تنظیمات اشتراک و صفحه‌ی اشتراک.'],
        keygen: ['Keygen', 'کلید نود', 'The SECRET_KEY a new node needs to trust this panel.', 'SECRET_KEY که یک نود تازه برای اعتماد به این پنل لازم دارد.'],
        hosts: ['Hosts', 'هاست‌ها', 'The addresses apps connect to: one per inbound and location.', 'آدرس‌هایی که برنامه‌ها به آن‌ها وصل می‌شوند: برای هر اینباند و مکان.'],
        'hosts-bulk-actions': ['Hosts: bulk actions', 'هاست‌ها: عملیات گروهی', 'Enable, disable, change or delete many hosts at once.', 'فعال، غیرفعال، تغییر یا حذف چند هاست با هم.'],
        'subscription-template': ['Templates', 'قالب‌ها', 'Templates for each subscription format: Xray JSON, Mihomo, Stash, sing-box and Clash.', 'قالب هر فرمت اشتراک: Xray JSON، Mihomo، Stash، sing-box و Clash.'],
        'subscription-settings': ['Subscription settings', 'تنظیمات اشتراک', 'Profile title, update interval, response headers and response rules.', 'عنوان پروفایل، فاصله‌ی به‌روزرسانی، هدرهای پاسخ و قوانین پاسخ.'],
        'subscription-page-configs': ['Subscription page configs', 'تنظیمات صفحه‌ی اشتراک', 'What the subscription page shows: apps, texts and branding.', 'آنچه صفحه‌ی اشتراک نشان می‌دهد: برنامه‌ها، متن‌ها و برندینگ.'],
        brokers: ['Brokers', 'فروشنده‌ها', 'Resellers: their accounts, quotas and limits. Owner only, from the panel.', 'نماینده‌ها: حساب، سهمیه و محدودیت‌هایشان. فقط مالک، از داخل پنل.'],
        'broker-bot': ['Broker bot', 'ربات فروشنده', 'A broker’s Telegram store: plans, orders, texts and stats. Brokers only, from the panel; broadcasts are owner only.', 'فروشگاه تلگرامی فروشنده: پلن‌ها، سفارش‌ها، متن‌ها و آمار. فقط فروشنده‌ها، از داخل پنل؛ پیام همگانی فقط برای مالک.'],
        system: ['System', 'سیستم', 'Panel stats, health, recap, X25519 keys and the response-rule tester.', 'آمار و سلامت پنل، خلاصه، کلیدهای X25519 و آزمایش قوانین پاسخ.'],
        metadata: ['Metadata', 'متادیتا', 'Free-form JSON you keep on users and nodes, for your own tools.', 'JSON دلخواهی که برای ابزارهای خودتان روی کاربرها و نودها نگه می‌دارید.'],
        'umiji-settings': ['Umiji settings', 'تنظیمات Umiji', 'Sign-in methods, branding and panel features. Owner only, from the panel.', 'روش‌های ورود، برندینگ و قابلیت‌های پنل. فقط مالک، از داخل پنل.'],
        auth: ['Auth', 'ورود', 'Sign-in for the panel’s own accounts: password, OAuth2, Telegram and passkeys.', 'ورود حساب‌های خود پنل: رمز عبور، OAuth2، تلگرام و passkey.'],
        passkeys: ['Passkeys', 'Passkeyها', 'The owner’s passkeys. Owner only, from the panel.', 'passkeyهای مالک. فقط مالک، از داخل پنل.'],
        'api-tokens': ['API tokens', 'توکن‌های API', 'Create and remove API tokens. Owner only, from the panel: a token can’t manage tokens.', 'ساختن و حذف توکن‌های API. فقط مالک، از داخل پنل: یک توکن نمی‌تواند توکن‌ها را مدیریت کند.']
    }

    const esc = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

    // ---------- syntax colours ----------

    const hlJSON = (text) =>
        esc(text).replace(
            /(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
            (m, str, colon, lit, num) =>
                str ? `<span class="${colon ? 'tk-k' : 'tk-s'}">${str}</span>${colon ?? ''}` : lit ? `<span class="tk-b">${lit}</span>` : `<span class="tk-n">${num}</span>`
        )

    // ---------- the panel address ----------

    const baseInput = document.getElementById('base-url')
    const DEFAULT_BASE = 'https://panel.example.com'
    let base = DEFAULT_BASE
    try {
        base = localStorage.getItem('umiji-api-base') || DEFAULT_BASE
    } catch {}
    const cleanBase = (v) => {
        v = v.trim().replace(/\/+$/, '').replace(/\/api$/, '')
        if (!v) return DEFAULT_BASE
        return /^https?:\/\//.test(v) ? v : 'https://' + v
    }
    const paintBase = () => document.querySelectorAll('.base').forEach((el) => (el.textContent = base))
    if (baseInput) {
        baseInput.value = base === DEFAULT_BASE ? '' : base
        baseInput.addEventListener('input', () => {
            base = cleanBase(baseInput.value)
            try {
                localStorage.setItem('umiji-api-base', base)
            } catch {}
            paintBase()
        })
    }

    // ---------- tabs (static code samples) ----------

    document.querySelectorAll('.tabs').forEach((box, n) => {
        const tabs = [...box.querySelectorAll('[role="tab"]')]
        const panels = [...box.querySelectorAll('[role="tabpanel"]')]
        const show = (i, focus) => {
            tabs.forEach((t, j) => {
                t.setAttribute('aria-selected', i === j)
                t.tabIndex = i === j ? 0 : -1
            })
            panels.forEach((p, j) => (p.hidden = i !== j))
            if (focus) tabs[i].focus()
        }
        tabs.forEach((t, i) => {
            t.id = `tab-${n}-${i}`
            panels[i].id = `panel-${n}-${i}`
            t.setAttribute('aria-controls', panels[i].id)
            panels[i].setAttribute('aria-labelledby', t.id)
            t.addEventListener('click', () => show(i))
            t.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight') show((i + 1) % tabs.length, true)
                if (e.key === 'ArrowLeft') show((i - 1 + tabs.length) % tabs.length, true)
            })
        })
        show(0)
    })

    document.querySelectorAll('pre code.json').forEach((c) => (c.innerHTML = hlJSON(c.textContent)))
    // let long event and stream names break after _ . : instead of mid-word
    document.querySelectorAll('table.data td:first-child code').forEach((c) => (c.innerHTML = c.innerHTML.replace(/(?<=.)([_.:])/g, '$1<wbr>')))

    // ---------- schemas ----------

    let schemas = {}
    const resolve = (s) => {
        for (let i = 0; s && s.$ref && i < 30; i++) s = schemas[s.$ref]
        return s || {}
    }
    const variants = (s) => (s.anyOf || s.oneOf || []).map(resolve)
    const isNull = (s) => s.type === 'null'

    const typeLabel = (raw) => {
        const s = resolve(raw)
        if (s.anyOf || s.oneOf) {
            const vs = variants(s)
            const named = [...new Set(vs.filter((v) => !isNull(v)).map(typeLabel))]
            return named.join(' | ') + (vs.some(isNull) || s.nullable ? ' | null' : '')
        }
        let t = Array.isArray(s.type) ? s.type.join(' | ') : s.type
        if (!t) t = s.properties ? 'object' : s.items ? 'array' : s.enum ? 'string' : 'any'
        if (t === 'array') t = `array of ${typeLabel(s.items || {})}`
        if (s.format) t += ` (${s.format})`
        if (s.nullable) t += ' | null'
        return t
    }

    const children = (raw) => {
        // the object a field opens into: its own, its array items', or a nullable variant's
        const s = resolve(raw)
        if (Object.keys(s.properties || {}).length || s.additionalProperties instanceof Object) return s
        if (s.items) return children(s.items)
        if (s.anyOf || s.oneOf) {
            const vs = variants(s).filter((v) => !isNull(v))
            if (vs.length === 1) return children(vs[0])
            if (vs.some((v) => children(v))) return s
        }
        if (s.allOf) return { properties: Object.assign({}, ...s.allOf.map((p) => resolve(p).properties || {})) }
        return null
    }

    const metaChips = (s) => {
        s = resolve(s)
        const out = []
        if (s.enum) out.push(s.enum.map((v) => JSON.stringify(v)).join(' · '))
        if (s.const !== undefined) out.push(`= ${JSON.stringify(s.const)}`)
        if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`)
        if (s.minLength !== undefined || s.maxLength !== undefined)
            out.push(`length ${s.minLength ?? 0}–${s.maxLength ?? '∞'}`)
        if (s.minimum !== undefined || s.maximum !== undefined)
            out.push(`${s.exclusiveMinimum === true ? '>' : '≥'} ${s.minimum ?? '-∞'}${s.maximum !== undefined ? ` · ≤ ${s.maximum}` : ''}`)
        if (s.minItems !== undefined || s.maxItems !== undefined)
            out.push(`items ${s.minItems ?? 0}–${s.maxItems ?? '∞'}`)
        if (s.pattern) out.push(`/${s.pattern}/`)
        if (s.items && resolve(s.items).enum) out.push(resolve(s.items).enum.map((v) => JSON.stringify(v)).join(' · '))
        return out.length ? `<div class="fmeta">${out.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''
    }

    const fieldRow = (name, raw, required, depth, open) => {
        const s = resolve(raw)
        const desc = s.description || resolve(s.items || {}).description || ''
        const kids = depth < 9 ? children(s) : null
        let nested = ''
        if (kids) {
            const inner = renderSchema(kids, depth + 1)
            const n = Object.keys(kids.properties || {}).length
            const label = kids.anyOf || kids.oneOf ? L.oneOf : n ? L.fields(n) : L.item
            nested = `<details${open ? ' open' : ''}><summary>${label}</summary>${inner}</details>`
        }
        return `<div class="field"><div class="field-head"><code class="fname">${esc(name)}</code><span class="ftype">${esc(typeLabel(s))}</span>${required ? `<span class="freq">${L.required}</span>` : ''}</div>${desc ? `<div class="fdesc" lang="en">${esc(desc)}</div>` : ''}${metaChips(s)}${nested}</div>`
    }

    const renderSchema = (raw, depth = 0) => {
        const s = resolve(raw)
        if (s.anyOf || s.oneOf) {
            const vs = variants(s).filter((v) => !isNull(v))
            return `<div class="schema">${vs.map((v, i) => fieldRow(L.option(i + 1), v, false, depth, false)).join('')}</div>`
        }
        if (s.items && !s.properties) return `<div class="schema">${fieldRow('[ ]', s.items, false, depth, depth === 0)}</div>`
        const props = s.properties || {}
        const req = new Set(s.required || [])
        const names = Object.keys(props)
        let rows = names.map((k) => fieldRow(k, props[k], req.has(k), depth, depth === 0 && names.length === 1)).join('')
        if (s.additionalProperties instanceof Object) rows += fieldRow('{key}', s.additionalProperties, false, depth, false)
        if (!rows) rows = `<div class="field"><div class="field-head"><span class="ftype">${esc(typeLabel(s))}</span></div>${metaChips(s)}</div>`
        return `<div class="schema">${rows}</div>`
    }

    const EXAMPLE_STRING = {
        uuid: '7f3c2a1e-5b4d-4c6e-9f8a-1b2c3d4e5f60',
        'date-time': '2026-11-15T12:00:00.000Z',
        email: 'user@example.com',
        uri: 'https://example.com',
        url: 'https://example.com',
        ipv4: '203.0.113.10'
    }

    const example = (raw, depth = 0, name = '') => {
        const s = resolve(raw)
        if (depth > 9) return null
        if (s.example !== undefined) return s.example
        if (s.const !== undefined) return s.const
        if (s.default !== undefined) return s.default
        if (s.enum) return s.enum[0]
        if (s.anyOf || s.oneOf) {
            const v = variants(s).find((x) => !isNull(x))
            return v ? example(v, depth + 1, name) : null
        }
        if (s.allOf) return Object.assign({}, ...s.allOf.map((p) => example(p, depth + 1)))
        const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type
        if (s.properties || t === 'object') {
            const o = {}
            for (const [k, v] of Object.entries(s.properties || {})) o[k] = example(v, depth + 1, k)
            if (!s.properties && s.additionalProperties instanceof Object) o.key = example(s.additionalProperties, depth + 1)
            return o
        }
        if (s.items || t === 'array') return [example(s.items || {}, depth + 1, name)]
        if (t === 'string') {
            if (EXAMPLE_STRING[s.format]) return EXAMPLE_STRING[s.format]
            if (/uuid$/i.test(name)) return EXAMPLE_STRING.uuid
            if (/(At|Date)$/.test(name)) return EXAMPLE_STRING['date-time']
            if (name === 'username') return 'alice'
            return 'string'
        }
        if (t === 'number' || t === 'integer') {
            if (s.minimum !== undefined) return s.exclusiveMinimum === true ? s.minimum + 1 : s.minimum
            return /id$/i.test(name) ? 1 : 0
        }
        if (t === 'boolean') return true
        return null
    }

    // ---------- endpoint cards ----------

    const chev = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>'
    const routeHTML = (p) => esc(p).replace(/\{(\w+)\}/g, '<b>{$1}</b>')

    const tagsHTML = (ep) => {
        if (ep.auth === 'none') return `<span class="tag open">${L.open}</span>`
        const out = []
        if (ep.roles.includes('API')) out.push(`<span class="tag">${L.token}</span>`)
        else if (ep.roles.includes('ADMIN')) out.push(`<span class="tag panel">${L.owner}</span>`)
        if (ep.roles.includes('BROKER')) out.push(`<span class="tag panel">${L.broker}</span>`)
        return out.join('')
    }

    const curl = (ep) => {
        const pathParams = Object.fromEntries(ep.params.filter((p) => p.in === 'path').map((p) => [p.n, example(p.s, 0, p.n)]))
        const path = ep.p.replace(/\{(\w+)\}/g, (_, n) => encodeURIComponent(pathParams[n] ?? n))
        const q = ep.params.filter((p) => p.in === 'query' && p.req).map((p) => `${p.n}=${encodeURIComponent(example(p.s, 0, p.n))}`)
        const url = `<span class="base">${esc(base)}</span>${esc(path)}${q.length ? esc('?' + q.join('&')) : ''}`
        const lines = [`<span class="tk-f">curl</span>${ep.m === 'GET' ? '' : ` <span class="tk-k">-X</span> ${ep.m}`} <span class="tk-s">"${url}"</span>`]
        if (ep.auth !== 'none') lines.push(`  <span class="tk-k">-H</span> <span class="tk-s">"Authorization: Bearer $UMIJI_TOKEN"</span>`)
        if (ep.body) {
            const json = JSON.stringify(example(ep.body), null, 2).replace(/'/g, "'\\''")
            lines.push(`  <span class="tk-k">-H</span> <span class="tk-s">"Content-Type: application/json"</span>`)
            lines.push(`  <span class="tk-k">-d</span> '${hlJSON(json).replace(/\n/g, '\n  ')}'`)
        }
        return lines.join(' \\\n')
    }

    const paramsHTML = (ep) =>
        `<div class="schema params">${ep.params
            .map((p) => {
                const s = { ...p.s, description: p.d || p.s.description }
                return fieldRow(p.n, s, p.req, 1, false).replace('</code>', `</code><span class="fin">${L.in[p.in] ?? p.in}</span>`)
            })
            .join('')}</div>`

    const bodyHTML = (ep) => {
        const scope = ep.scope
        let access = ''
        if (scope) {
            const also = [`${scope.res}:${scope.kind}`, `${scope.res}:*`, '*']
            access = `<div class="access"><span>${L.scope}</span><button type="button" class="scope-chip" data-copy-text="${esc(scope.key)}">${esc(scope.key)}<em>${scope.kind}</em></button><span>${L.alsoBy}</span>${also.map((a) => `<code>${esc(a)}</code>`).join(' ')}</div>`
        }
        const panelOnly = ep.auth !== 'none' && !ep.roles.includes('API')
        const parts = [
            ep.d ? `<p class="en" lang="en">${esc(ep.d)}</p>` : '',
            access,
            ep.auth === 'none' ? `<div class="note tip panel-only"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg><p>${L.publicNote}</p></div>` : '',
            panelOnly ? `<div class="note panel-only"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg><p>${L.panelOnly}</p></div>` : '',
            ep.params.length ? `<h4>${L.params}</h4>${paramsHTML(ep)}` : '',
            ep.body ? `<h4>${L.body} <small>application/json</small></h4>${renderSchema(ep.body)}` : '',
            `<h4>${L.response} <span class="status-code">${ep.ok} ${L.status[ep.ok] ?? ''}</span>${ep.outType === 'json' ? ' <small>application/json</small>' : ''}</h4>`,
            ep.out ? renderSchema(ep.out) : `<div class="schema"><div class="schema-empty">${ep.outType === 'none' ? L.empty : L.text}</div></div>`
        ]
        const sampleOut = ep.out ? `<div><span class="cap">${L.example}</span><pre data-copy><code>${hlJSON(JSON.stringify(example(ep.out), null, 2))}</code></pre></div>` : ''
        const sampleIn = panelOnly ? '' : `<div><span class="cap">${L.request}</span><pre data-copy><code>${curl(ep)}</code></pre></div>`
        if (sampleIn || sampleOut) parts.push(`<div class="samples">${sampleIn}${sampleOut}</div>`)
        return parts.join('')
    }

    const epHTML = (ep) =>
        `<details class="ep" id="${ep.id}" data-search="${esc(`${ep.m} ${ep.p} ${ep.t} ${ep.scope?.key ?? ''} ${ep.id}`.toLowerCase())}"><summary><span class="verb ${ep.m.toLowerCase()}">${ep.m}</span><span dir="ltr"><code class="ep-route">${routeHTML(ep.p)}</code><span class="ep-title" lang="en">${esc(ep.t)}</span></span><span class="who-tags">${tagsHTML(ep)}</span>${chev}</summary></details>`

    // ---------- page wiring ----------

    const byId = new Map()

    const openBody = (el) => {
        if (el.dataset.ready) return
        el.dataset.ready = '1'
        el.insertAdjacentHTML('beforeend', `<div class="ep-body">${bodyHTML(byId.get(el.id))}</div>`)
        document.dispatchEvent(new Event('wiki:render'))
    }

    const renderReference = (spec) => {
        schemas = spec.schemas
        let total = 0
        const toc = []
        const html = spec.sections
            .map((sec) => {
                const secTitle = fa ? SECTIONS[sec.title] ?? sec.title : sec.title
                toc.push(`<div class="group"><span>${secTitle}</span><ul>`)
                const groups = sec.groups
                    .map((g) => {
                        const [en, faName, enAbout, faAbout] = GROUPS[g.id] ?? [g.name, g.name, g.about, g.about]
                        g.eps.forEach((ep) => byId.set(ep.id, ep))
                        total += g.eps.length
                        toc.push(`<li><a href="#ref-${g.id}">${fa ? faName : en}</a></li>`)
                        return `<section class="group-block ref-group" id="ref-${g.id}"><div class="group-title"><h2>${fa ? faName : en}</h2></div><p>${fa ? faAbout : enAbout} <span class="path" dir="ltr">${g.eps.length} · <code>${esc(commonPrefix(g.eps.map((e) => e.p)))}</code></span></p><div class="eps">${g.eps.map(epHTML).join('')}</div></section>`
                    })
                    .join('')
                toc.push('</ul></div>')
                return groups
            })
            .join('')
        root.innerHTML = html + `<div class="empty">${L.none}</div>`
        document.getElementById('toc-ref')?.insertAdjacentHTML('beforeend', toc.join(''))
        root.addEventListener('toggle', (e) => e.target.matches?.('.ep') && e.target.open && openBody(e.target), true)
        return total
    }

    const commonPrefix = (paths) => {
        const parts = paths.map((p) => p.split('/'))
        const out = []
        for (let i = 0; ; i++) {
            const seg = parts[0][i]
            if (seg === undefined || seg.startsWith('{') || parts.some((p) => p[i] !== seg)) break
            out.push(seg)
        }
        return out.join('/') || '/'
    }

    const renderErrors = (spec) => {
        const body = document.querySelector('#error-table tbody')
        if (!body) return
        body.innerHTML = spec.errors
            .map(([code, http, msg]) => `<tr data-search="${esc(`${code} ${http} ${msg}`.toLowerCase())}"><td><code>${code}</code></td><td>${http}</td><td lang="en" dir="ltr">${esc(msg)}</td></tr>`)
            .join('')
        document.getElementById('error-total')?.replaceChildren(String(spec.errors.length))
    }

    const renderExtras = (spec) => {
        document.querySelectorAll('[data-schema]').forEach((el) => {
            const s = spec.extra[el.dataset.schema]
            if (s) el.innerHTML = renderSchema(s)
        })
    }

    const goToHash = () => {
        const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
        if (!el) return
        if (el.matches('.ep')) el.open = true
        el.scrollIntoView()
    }

    // ---------- search: endpoints and error codes ----------

    const setupSearch = (total) => {
        const input = document.getElementById('api-search')
        const count = document.getElementById('ref-count')
        const eps = [...root.querySelectorAll('.ep')]
        const groups = [...root.querySelectorAll('.ref-group')]
        const errRows = [...document.querySelectorAll('#error-table tbody tr')]
        const errBlock = document.getElementById('error-codes')
        const errFilter = document.getElementById('error-search')
        const empty = root.querySelector('.empty')
        const words = (v) => v.toLowerCase().trim().split(/\s+/).filter(Boolean)
        const match = (el, ws) => ws.every((w) => el.dataset.search.includes(w))
        const filterErrors = (ws) => {
            let n = 0
            errRows.forEach((r) => {
                r.hidden = !match(r, ws)
                if (!r.hidden) n++
            })
            return n
        }
        if (count) count.textContent = L.count(total, total)
        const run = () => {
            const ws = words(input.value)
            document.body.classList.toggle('searching', ws.length > 0)
            let shown = 0
            eps.forEach((el) => {
                el.hidden = !match(el, ws)
                if (!el.hidden) shown++
            })
            groups.forEach((g) => (g.hidden = !g.querySelector('.ep:not([hidden])')))
            const errs = filterErrors(ws)
            if (errBlock) errBlock.hidden = ws.length > 0 && errs === 0
            if (errFilter) errFilter.value = ''
            empty.style.display = shown || errs ? 'none' : 'block'
            if (count) count.textContent = L.count(shown, total)
        }
        input?.addEventListener('input', run)
        errFilter?.addEventListener('input', () => filterErrors(words(errFilter.value)))
        document.addEventListener('keydown', (e) => {
            if (!input) return
            if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
                e.preventDefault()
                input.focus()
            }
            if (e.key === 'Escape' && document.activeElement === input) {
                input.value = ''
                run()
            }
        })
    }

    // copy a scope key with one click
    document.addEventListener('click', async (e) => {
        const chip = e.target.closest('[data-copy-text]')
        if (!chip) return
        try {
            await navigator.clipboard.writeText(chip.dataset.copyText)
            const em = chip.querySelector('em')
            const was = em.textContent
            em.textContent = L.copied
            setTimeout(() => (em.textContent = was), 1400)
        } catch {}
    })

    // a smooth scroll to the #hash gets lost while the reference and fonts grow the page, so the first jump is instant
    const html = document.documentElement
    html.style.scrollBehavior = 'auto'

    fetch(root.dataset.spec)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((spec) => {
            const total = renderReference(spec)
            renderErrors(spec)
            renderExtras(spec)
            setupSearch(total)
            paintBase()
            document.dispatchEvent(new Event('wiki:render'))
            document.fonts.ready.then(() => {
                goToHash()
                html.style.scrollBehavior = ''
            })
        })
        .catch(() => {
            root.innerHTML = `<div class="empty" style="display:block">${L.failed}</div>`
        })
    window.addEventListener('hashchange', goToHash)
})()
