#!/usr/bin/env python3
"""Turns the backend dump from gen-meta.ts into docs/api/spec.json, which the wiki's API page renders.

Run ./build.sh (next to this file) after any API change. It builds gen-meta.ts with the backend's own
bundler, runs it, then runs this script.
"""
import hashlib
import json
import re
import sys

DATE_RE = '^(?:(?:\\d\\d[2468][048]'
UUID_RE = '^([0-9a-fA-F]{8}-'
KEEP = {
    'type', 'properties', 'required', 'nullable', 'format', 'items', 'description', 'enum', 'const',
    'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'default', 'anyOf', 'oneOf',
    'allOf', 'additionalProperties', '$ref', 'pattern', 'example', 'exclusiveMinimum', 'exclusiveMaximum',
}

# The order of the reference: the panel's own menu, then the panel's internals.
SECTIONS = [
    ('Users', ['Users Controller', 'Users Bulk Actions Controller', 'HWID User Devices Controller',
               '[Protected] Subscriptions Controller', '[Public] Subscription Controller',
               'Subscription Request History Controller']),
    ('Nodes', ['Nodes Controller', 'Node Plugins Controller', 'Bandwidth Stats Controller',
               'Connections Controller', 'Infra Billing Controller']),
    ('Config', ['Config Profiles Controller', 'Snippets Controller', 'Internal Squads Controller',
                'External Squads Controller', 'Keygen Controller']),
    ('Subscription', ['Hosts Controller', 'Hosts Bulk Actions Controller', 'Subscription Template Controller',
                      'Subscription Settings Controller', 'Subscription Page Configs Controller']),
    ('Brokers', ['Brokers Controller', 'Broker Bot Controller']),
    ('Panel', ['System Controller', 'Metadata Controller', 'Umiji Settings Controller', 'Auth Controller',
               'Passkeys Controller', 'API Tokens Controller']),
]
# The two raw subscription routes write the response themselves, so the spec has no summary for them.
FILL = {
    'subscription-get-subscription': (
        "Get the subscription for the app that asks",
        "What a client app downloads. The format (Base64 links, Xray JSON, Mihomo, sing-box…) and the "
        "headers come from the response rules, which read the app's User-Agent and headers.",
    ),
    'subscription-get-subscription-by-client-type': (
        "Get the subscription in a given format",
        "The same subscription, for a format named in the path.",
    ),
}
NAMES = {
    '[Public] Subscription Controller': 'Public subscription',
    '[Protected] Subscriptions Controller': 'Subscriptions',
    'HWID User Devices Controller': 'HWID devices',
    'API Tokens Controller': 'API tokens',
}


def kebab(s):
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', s)
    return re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()


def slim(node):
    """Keeps the parts of a JSON schema a reader needs."""
    if isinstance(node, list):
        return [slim(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {}
    pat = node.get('pattern')
    if isinstance(pat, str) and 'format' not in node:
        if pat.startswith(DATE_RE):
            out['format'] = 'date-time'
        elif pat.startswith(UUID_RE):
            out['format'] = 'uuid'
    if 'examples' in node and 'example' not in node and isinstance(node['examples'], list) and node['examples']:
        node = {**node, 'example': node['examples'][0]}
    for key, value in node.items():
        if key not in KEEP:
            continue
        if key == 'pattern' and ('format' in out or 'format' in node or len(value) > 90):
            continue
        if key == '$ref':
            out['$ref'] = value.rsplit('/', 1)[-1]
        elif key == 'properties':
            out[key] = {k: slim(v) for k, v in value.items()}
        else:
            out[key] = slim(value)
    return out


def main(meta_path, out_path):
    meta = json.load(open(meta_path))
    doc = meta['openapi']
    root = meta['root']

    def full_path(base, path):
        parts = [root.strip('/'), (base or '').strip('/'), (path or '').strip('/')]
        return re.sub(r':(\w+)', r'{\1}', '/' + '/'.join(p for p in parts if p))

    routes = {}
    for r in meta['routes']:
        bases = r['base'] if isinstance(r['base'], list) else [r['base']]
        paths = r['path'] if isinstance(r['path'], list) else [r['path']]
        for b in bases:
            for p in paths:
                routes[(r['method'], full_path(b, p))] = r

    tags = {t['name']: t.get('description', '') for t in doc.get('tags', [])}
    listed = [t for _, ts in SECTIONS for t in ts]
    missing = []  # tags with endpoints but no place in SECTIONS (Node Install/SSH are hidden from the spec)
    groups = {t: [] for t in listed}
    schemas_used = set()

    def refs(node):
        if isinstance(node, dict):
            if '$ref' in node:
                schemas_used.add(node['$ref'].rsplit('/', 1)[-1])
            for v in node.values():
                refs(v)
        elif isinstance(node, list):
            for v in node:
                refs(v)

    unmatched = []
    for path, item in doc['paths'].items():
        for method, op in item.items():
            r = routes.get((method.upper(), path))
            if r is None:
                unmatched.append(f'{method} {path}')
                continue
            tag = op['tags'][0]
            if tag not in groups:
                missing.append(tag)
                continue
            roles = r['roles'] or []
            public = not r['guards']
            ok = next(c for c in op['responses'] if c.startswith('2'))
            resp = op['responses'][ok].get('content', {})
            out_schema = None
            out_type = 'none'
            if 'application/json' in resp:
                out_schema = slim(resp['application/json'].get('schema'))
                out_type = 'json'
            elif resp:
                out_type = next(iter(resp))
            body = op.get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema')
            scope = None
            if 'API' in roles and r['resource'] and r['scope']:
                scope = {'key': f"{r['resource']}:{r['scope']['SCOPE']}", 'kind': r['scope']['SCOPE_KIND'],
                         'res': r['resource']}
            ep = {
                'id': kebab(op['operationId'].replace('Controller_', '-')),
                'm': method.upper(),
                'p': path,
                't': op.get('summary', ''),
                'd': op.get('description', ''),
                'roles': roles,
                'auth': 'none' if public else 'bearer',
                'scope': scope,
                'params': [
                    {'n': p['name'], 'in': p['in'], 'req': bool(p.get('required')),
                     'd': p.get('description', ''), 's': slim(p.get('schema', {}))}
                    for p in op.get('parameters', [])
                ],
                'body': slim(body) if body else None,
                'ok': int(ok),
                'out': out_schema,
                'outType': out_type,
            }
            if ep['id'] in FILL:
                ep['t'], ep['d'] = FILL[ep['id']]
                ep['outType'] = 'text/plain'
            refs(ep['body'])
            refs(ep['out'])
            refs(ep['params'])
            groups[tag].append(ep)

    if unmatched or missing:
        sys.exit(f'Spec and routes disagree. Unmatched: {unmatched}. Tags without a section: {missing}')

    # pull in schemas referenced from other schemas, and from the webhook and stream models
    comps = doc['components']['schemas']
    ext = {k: comps[k] for k in comps if k.startswith('UmijiWebhook') or 'StreamMessage' in k}
    refs(ext)
    todo = list(schemas_used)
    while todo:
        name = todo.pop()
        before = set(schemas_used)
        refs(comps[name])
        todo += list(schemas_used - before)
    schemas = {name: slim(comps[name]) for name in sorted(schemas_used)}

    # Many DTOs repeat the same big sub-schemas (a host, a user). Share each repeat once.
    counts = {}

    def count(node):
        if isinstance(node, dict):
            s = json.dumps(node, sort_keys=True)
            if len(s) > 600:
                counts[s] = counts.get(s, 0) + 1
            for v in node.values():
                count(v)
        elif isinstance(node, list):
            for v in node:
                count(v)

    count(schemas)
    for g in groups.values():
        count(g)
    shared = {}

    VALUES = ('default', 'example', 'enum', 'const')

    def share(node):
        """Replaces a repeated sub-schema with a reference to one shared copy."""
        if isinstance(node, list):
            return [share(v) for v in node]
        if not isinstance(node, dict):
            return node
        s = json.dumps(node, sort_keys=True)
        key = '~' + hashlib.sha1(s.encode()).hexdigest()[:8]
        if counts.get(s, 0) > 1:
            if key not in shared:
                shared[key] = {}
                shared[key] = own(node)
            return {'$ref': key}
        return own(node)

    def own(node):
        out = {}
        for k, v in node.items():
            if k in VALUES:
                out[k] = v
            elif k == 'properties':
                out[k] = {pk: share(pv) for pk, pv in v.items()}
            else:
                out[k] = share(v)
        return out

    schemas = {k: own(v) for k, v in schemas.items()}
    for g in groups.values():
        for ep in g:
            for key in ('body', 'out'):
                if ep[key]:
                    ep[key] = share(ep[key])
    schemas.update(shared)

    sections = []
    for title, ts in SECTIONS:
        sec = {'title': title, 'groups': []}
        for t in ts:
            name = NAMES.get(t, t.replace(' Controller', ''))
            sec['groups'].append({'id': kebab(name), 'name': name, 'about': tags.get(t, ''), 'eps': groups[t]})
        sections.append(sec)

    spec = {
        'version': doc['info']['version'],
        'sections': sections,
        'schemas': schemas,
        'extra': {k: slim(v) for k, v in ext.items()},
        'errors': sorted(([e['code'], e['httpCode'], e['message']] for e in meta['errors'].values()),
                         key=lambda e: int(e[0][1:])),
        'events': {k: list(v.values()) for k, v in meta['events'].items() if isinstance(v, dict)},
    }
    ids = [ep['id'] for s in sections for g in s['groups'] for ep in g['eps']]
    assert len(ids) == len(set(ids)), 'endpoint ids must be unique'
    with open(out_path, 'w') as f:
        json.dump(spec, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{len(ids)} endpoints, {len(schemas)} schemas, {len(spec["errors"])} errors -> {out_path}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
