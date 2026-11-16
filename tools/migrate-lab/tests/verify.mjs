// Compares every source user with what Umiji now holds. Usage: same env as migrate.mjs; node verify.mjs
import { SOURCES_FOR_TEST } from '../../../migrate.mjs';
const { SOURCES, umijiName } = SOURCES_FOR_TEST;
const E = process.env;
if (E.SRC_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const data = await SOURCES[E.SRC_TYPE].read({ url: E.SRC_URL, user: E.SRC_USER, pass: E.SRC_PASS, token: E.SRC_TOKEN, secret: E.SRC_SECRET || '' });
const h = { authorization: `Bearer ${E.UMIJI_TOKEN}`, 'x-umiji-client-type': 'browser', 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' };
const all = []; let cursor;
do { const r = await (await fetch(`${E.UMIJI_URL}/api/users/stream?size=1000${cursor ? '&cursor=' + cursor : ''}`, { headers: h })).json(); all.push(...r.response.users); cursor = r.response.hasMore ? r.response.nextCursor : null; } while (cursor);
const by = new Map(all.map((u) => [u.username, u]));
let bad = 0, checked = 0;
const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) < 120000;
for (const s of data.users) {
  const u = by.get(umijiName(s.source));
  if (!u) { console.log('MISSING', s.source); bad++; continue; }
  checked++;
  const diffs = [];
  const eq = (k, a, b) => { if (a !== b) diffs.push(`${k}: want ${a} got ${b}`); };
  eq('status', s.status, u.status);
  eq('limit', s.trafficLimitBytes, u.trafficLimitBytes);
  eq('strategy', s.trafficLimitStrategy, u.trafficLimitStrategy);
  eq('used', s.usedTrafficBytes, +(u.userTraffic?.usedTrafficBytes ?? u.usedTrafficBytes));
  eq('lifetime', s.lifetimeUsedTrafficBytes, +(u.userTraffic?.lifetimeUsedTrafficBytes ?? u.lifetimeUsedTrafficBytes));
  if (!near(s.expireAt, u.expireAt)) diffs.push(`expire: want ${s.expireAt} got ${u.expireAt}`);
  if (s.createdAt && !near(s.createdAt, u.createdAt)) diffs.push(`created: want ${s.createdAt} got ${u.createdAt}`);
  if (s.vlessUuid) eq('vless', s.vlessUuid, u.vlessUuid);
  if (s.trojanPassword) eq('trojan', s.trojanPassword, u.trojanPassword);
  if (s.ssPassword) eq('ss', s.ssPassword, u.ssPassword);
  if (s.shortUuid) eq('shortUuid', s.shortUuid, u.shortUuid);
  if (s.telegramId) eq('tg', s.telegramId, u.telegramId);
  if (s.ipLimit) eq('ipLimit', s.ipLimit, u.ipLimit);
  if (s.owner === E.SRC_USER) delete s.owner;
  const desc = [s.description, s.owner && `Owner: ${s.owner}`].filter(Boolean).join('\n') || null;
  eq('description', desc, u.description);
  eq('squads', (s.squadKeys || []).length || (E.TARGET_SQUAD ? 1 : 0), (u.activeInternalSquads || []).length);
  if (diffs.length) { bad++; console.log('DIFF', s.source, diffs.join('; ')); }
}
console.log(`checked ${checked} of ${data.users.length}, ${bad} with differences`);
process.exit(bad ? 1 : 0);
