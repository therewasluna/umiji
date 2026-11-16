// Builds every PasarGuard subscription token format the same way app/utils/jwt.py does.
import crypto from 'node:crypto';
const [secret, id, username] = process.argv.slice(2);
const ts = Math.ceil(Date.now() / 1000) - 3600;
const b64 = (s) => Buffer.from(s).toString('base64url');
const legacy = (data, hex) => {
    const t = b64(data);
    const d = crypto.createHash('sha256').update(t + secret).digest();
    return t + (hex ? d.toString('hex') : d.toString('base64url')).slice(0, 10);
};
const v3 = b64(`v3,${id},${ts}`);
const jwtHead = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), jwtBody = b64(JSON.stringify({ sub: username, access: 'subscription', iat: ts }));
const out = {
    hmac_v3: v3 + '.' + crypto.createHmac('sha256', secret).update(v3).digest('base64url'),
    legacy_v3_b64: legacy(`v3,${id},${ts}`, false),
    legacy_v2_hex: legacy(`v2,${id},${ts}`, true),
    legacy_username: legacy(`${username},${ts}`, false),
    jwt: `${jwtHead}.${jwtBody}.${crypto.createHmac('sha256', secret).update(`${jwtHead}.${jwtBody}`).digest('base64url')}`,
    forged_hmac: v3 + '.' + crypto.createHmac('sha256', 'wrong').update(v3).digest('base64url'),
};
for (const [k, v] of Object.entries(out)) console.log(k, v);
