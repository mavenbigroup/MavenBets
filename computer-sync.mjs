// Pulls the "Computer" book (king23.ag) into computer.json for the Anolik Sports Book.
// Runs from the GitHub workflow in .github/workflows/computer-sync.yml with the
// account in repo secrets K23_USER / K23_PASS. Nothing here places or changes bets:
// it only reads the lines, history, open bets and account figures pages.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = process.env.K23_BASE || 'https://king23.ag';
const OUT = process.env.K23_OUT || 'computer.json';
const LEAGUES = { NFL: 'lg_1', NCAAF: 'lg_2', NBA: 'lg_3', NCAAB: 'lg_4', NHL: 'lg_7' };

/* ---------- parsing (plain string work so it runs anywhere) ---------- */
// @@PARSE-START
const K23 = (() => {
  const ent = s => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&frac12;/gi, '½');
  const txt = s => ent(String(s || '').replace(/\s+/g, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rows = html => [...String(html).matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map(m => ({ attrs: m[1], inner: m[2], cells: [...m[2].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1]) }));
  const num = s => { s = String(s).replace('½', '.5').replace(/^\+/, ''); if (/^pk$/i.test(s)) return 0; const n = parseFloat(s); return isNaN(n) ? null : n; };
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const pad = n => String(n).padStart(2, '0');
  // "Nov 08" (+ a reference date for the year) -> "2026-11-08"
  function isoDay(md, ref) {
    const m = String(md).match(/([A-Z][a-z]{2})\s+(\d{1,2})/); if (!m) return null;
    const r = ref ? new Date(ref) : new Date(); let y = r.getFullYear(); const mo = MON[m[1]];
    if (mo - r.getMonth() > 6) y--; else if (r.getMonth() - mo > 6) y++;
    return `${y}-${pad(mo + 1)}-${pad(+m[2])}`;
  }
  const SPORT = { NFL: 'NFL', CFB: 'NCAAF', NCAAF: 'NCAAF', NBA: 'NBA', CBB: 'NCAAB', NCAAB: 'NCAAB', MLB: 'MLB', NHL: 'NHL' };

  // Lines page: every price carries a checkbox value "type_gameId_points_odds"
  // type 0/1 = away/home spread, 2/3 = over/under, 4/5 = away/home moneyline
  function lines(html, lg, today) {
    const games = new Map();
    for (const r of rows(html)) {
      if (!/TrGame/.test(r.attrs)) continue;
      const vals = [...r.inner.matchAll(/value="(\d)_(\d+)_(-?[\d.]+)_(-?\d+)"/gi)].map(m => ({ t: +m[1], gid: m[2], pts: +m[3], odds: +m[4] }));
      if (!vals.length) continue;                       // off the board
      const away = vals.some(v => v.t % 2 === 0), gid = vals[0].gid;
      const span = r.inner.match(/class="Sport[VH]"[^>]*>([\s\S]*?)<\/span>/i);
      const name = span ? txt(span[1])[0] : (txt(r.cells[3] || '')[0] || '');
      const rot = +(txt(r.cells[2] || '')[0] || 0) || null, when = (txt(r.cells[1] || '')[0] || '');
      const g = games.get(gid) || { lg, gid }; games.set(gid, g);
      if (away) { g.away = name; g.awayRot = rot; if (/[A-Z][a-z]{2}\s+\d/.test(when)) g.date = isoDay(when, today); }
      else { g.home = name; g.homeRot = rot; if (/\d:\d\d/.test(when)) g.time = when.match(/\d{1,2}:\d{2}\s*[AP]M/i)[0]; else if (!g.date && /[A-Z][a-z]{2}\s+\d/.test(when)) g.date = isoDay(when, today); }
      for (const v of vals) {
        if (v.t === 0) { g.awaySpread = v.pts; g.awaySpreadOdds = v.odds; }
        if (v.t === 1) { g.homeSpread = v.pts; g.homeSpreadOdds = v.odds; }
        if (v.t === 2) { g.total = Math.abs(v.pts); g.overOdds = v.odds; }
        if (v.t === 3) { g.total = Math.abs(v.pts); g.underOdds = v.odds; }
        if (v.t === 4) g.awayML = v.odds;
        if (v.t === 5) g.homeML = v.odds;
      }
    }
    return [...games.values()].filter(g => g.away && g.home);
  }

  // One wager description -> what was bet
  function wager(lines_) {
    const all = lines_.join(' ');
    const score = (all.match(/\(Score:\s*(\d+)\s*-\s*(\d+)\)/) || []);
    const m = all.match(/\[(\d+)\]\s*(.*)$/);
    const w = { type: (lines_[0] || '').replace(/\s+BET$/i, '').toLowerCase() || 'straight', rot: m ? +m[1] : null, score: score[1] ? `${score[1]}-${score[2]}` : null };
    let body = (m ? m[2] : all).replace(/\(Score:[^)]*\)/, '').trim();
    let t;
    if ((t = body.match(/^TOTAL\s+([ou])\s*(\d+½?|\d+\.\d+)\s*([-+]\d+)\s*(?:\((.+?)\s+vrs\s+(.+?)\))?/i))) {
      Object.assign(w, { kind: 'total', pick: t[1].toLowerCase() === 'o' ? 'Over' : 'Under', spread: String(num(t[2])), odds: t[3], away: t[4] || null, home: t[5] || null });
    } else if ((t = body.match(/^(.+?)\s+([-+]\d+½?|[-+]?\d+\.\d|PK)\s*([-+]\d{3,})/i))) {
      const sp = num(t[2]); Object.assign(w, { kind: 'side', team: t[1].trim(), pick: t[1].trim(), spread: sp === 0 ? 'PK' : (sp > 0 ? '+' : '') + sp, odds: t[3] });
    } else if ((t = body.match(/^(.+?)\s*([-+]\d{3,})\s*\(\s*ACTION/i))) {
      Object.assign(w, { kind: 'ml', team: t[1].trim(), pick: t[1].trim(), spread: '', odds: t[2] });
    } else { w.kind = 'other'; w.pick = body; }
    w.desc = lines_.slice(1).join(' · ').replace(/\s*\(Score:[^)]*\)/, '');
    return w;
  }

  function history(html) {
    const tickets = [], adj = [];
    for (const r of rows(html)) {
      if (!/TrGame/.test(r.attrs) || r.cells.length < 8) continue;
      const c = r.cells.map(txt), placed = (c[7][0] || '');
      const pm = placed.match(/(\d{2})\/(\d{2})\/(\d{4})/), placedISO = pm ? `${pm[3]}-${pm[1]}-${pm[2]}` : null;
      const sport = (c[2][0] || '').toUpperCase();
      if (sport === 'ADJ' || !/Ticket/i.test(c[1].join(' '))) { adj.push({ date: placedISO, what: c[3].join(' '), amount: num(c[5][0]) }); continue; }
      const tkt = (c[1].join(' ').match(/Ticket\s*#:\s*(\d+)/) || [])[1];
      const rw = (c[4][0] || '').match(/(-?\d+)\s*\/\s*(-?\d+)/) || [];
      const res = (c[6][0] || '').toUpperCase();
      tickets.push({ tkt, lg: SPORT[sport] || sport, sport, date: isoDay(c[1][1] || '', placedISO ? placedISO + 'T12:00:00' : null), time: ((c[1][1] || '').match(/\d{1,2}:\d{2}\s*[AP]M/) || [null])[0], placed: placedISO,
        risk: +rw[1] || 0, win: +rw[2] || 0, net: num(c[5][0]), result: res.startsWith('WIN') ? 'W' : res.startsWith('LOS') ? 'L' : res.startsWith('PUSH') ? 'P' : res ? 'X' : null, ...wager(c[3]) });
    }
    return { tickets, adj };
  }

  function openBets(html, today) {
    const out = [];
    for (const r of rows(html)) {
      if (!/TrGame/.test(r.attrs) || r.cells.length < 6) continue;
      const c = r.cells.map(txt), tkt = (c[0].join(' ').match(/Ticket\s*#:\s*(\d+)/) || [])[1]; if (!tkt) continue;
      const rw = (c[5][0] || '').match(/(-?\d+)\s*\/\s*(-?\d+)/) || [], sport = (c[3][0] || '').toUpperCase();
      out.push({ tkt, lg: SPORT[sport] || sport, sport, date: isoDay(c[0][1] || '', today), time: ((c[0][1] || '').match(/\d{1,2}:\d{2}\s*[AP]M/) || [null])[0], risk: +rw[1] || 0, win: +rw[2] || 0, result: null, ...wager(c[4]) });
    }
    return out;
  }

  function figures(html) {
    const t = txt(html).join(' '), f = k => { const m = t.match(new RegExp(k + '\\s*:?\\s*(-?[\\d,]+(?:\\.\\d+)?)\\s*USD', 'i')); return m ? +m[1].replace(/,/g, '') : null; };
    return { balance: f('Current Balance'), available: f('Available Balance'), atRisk: f('Amount at Risk'), lastWeek: f("Last Week.s Win/Loss Figure"), thisWeek: f("This Week.s Win/Loss Figure") };
  }
  return { lines, history, openBets, figures, wager, isoDay };
})();
// @@PARSE-END

/* ---------- fetching with a cookie jar ---------- */
const jar = new Map();
function keep(res) { for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
// READ-ONLY GUARD. This script must never place, change or cancel a bet on king23.
// Only these pages may be requested; anything else (bet slips, confirm pages, etc.) is refused.
const READ_PAGES = [/^\/$/, /^\/dgs\/login\.aspx$/i, /^\/dgs\/wager\/(welcome|history|openbets)\.aspx$/i, /^\/dgs\/wager\/createsports\.aspx$/i];
function guard(url, opts) {
  const u = new URL(url), path = u.pathname;
  if (u.origin !== new URL(BASE).origin) throw new Error('Blocked: off-site request ' + u.origin);
  if (!READ_PAGES.some(re => re.test(path))) throw new Error('Blocked: not a read-only page ' + path);
  const method = (opts.method || 'GET').toUpperCase();
  if (method === 'GET') return;
  if (method !== 'POST') throw new Error('Blocked: ' + method);
  const body = new URLSearchParams(String(opts.body || ''));
  if (/login\.aspx$/i.test(path)) { if ([...body.keys()].some(k => !['Account', 'Password'].includes(k))) throw new Error('Blocked: unexpected login fields'); return; }
  // The only other POST allowed is picking which leagues' lines to VIEW (the "Continue" on the league list).
  // It may carry only page state, league boxes and that Continue button: no line selections ("text_"),
  // no amounts, no wager or confirm buttons.
  for (const k of body.keys()) {
    if (/^__(VIEWSTATE|VIEWSTATEGENERATOR|EVENTVALIDATION|EVENTTARGET|EVENTARGUMENT)$/.test(k) || /^lg_\d+$/.test(k) || k === 'ctl00$WagerContent$btn_Continue_top') continue;
    throw new Error('Blocked: form field not allowed on a read-only sync: ' + k);
  }
  if (!/^\/dgs\/wager\/createsports\.aspx$/i.test(path) || !/^WT=0$/i.test(u.search.slice(1))) throw new Error('Blocked: post to ' + path + u.search);
}
async function req(path, opts = {}) {
  let url = new URL(path, BASE + '/DGS/wager/').href;
  for (let hop = 0; hop < 8; hop++) {
    guard(url, opts);
    const res = await fetch(url, { ...opts, redirect: 'manual', headers: { 'User-Agent': UA, Cookie: cookie(), ...(opts.headers || {}) } });
    keep(res);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).href; opts = { method: 'GET' }; continue; }
    return { url, status: res.status, text: await res.text() };
  }
  throw new Error('Too many redirects at ' + url);
}
const hidden = html => Object.fromEntries([...html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)].map(m => [(m[0].match(/name="([^"]+)"/i) || [])[1], (m[0].match(/value="([^"]*)"/i) || [, ''])[1].replace(/&amp;/g, '&').replace(/&#43;/g, '+').replace(/&#47;/g, '/').replace(/&#61;/g, '=')]).filter(([k]) => k));

async function login(user, pass) {
  await req(BASE + '/');
  const body = new URLSearchParams({ Account: user, Password: pass });
  await req(BASE + '/dgs/login.aspx', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + '/' }, body });
  const w = await req('Welcome.aspx');
  if (!/Logout/i.test(w.text)) throw new Error(`Login failed (status ${w.status} at ${w.url}). Check K23_USER / K23_PASS, or the site may be blocking this server.`);
  return w.text;
}
async function leagueLines(lgField, lg) {
  const page = await req('CreateSports.aspx?WT=0');
  if (!new RegExp(`name="${lgField}"`, 'i').test(page.text)) return [];
  const body = new URLSearchParams({ ...hidden(page.text), [lgField]: lgField.slice(3), 'ctl00$WagerContent$btn_Continue_top': 'Continue' });
  const res = await req('CreateSports.aspx?WT=0', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return K23.lines(res.text, lg);
}

async function main() {
  const user = process.env.K23_USER, pass = process.env.K23_PASS;
  if (!user || !pass) throw new Error('Set K23_USER and K23_PASS (repo secrets).');
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const welcome = await login(user, pass);
  const figures = K23.figures(welcome);

  let lines = [];
  for (const [lg, f] of Object.entries(LEAGUES)) { try { lines.push(...await leagueLines(f, lg)); } catch (e) { console.warn('lines', lg, e.message); } }

  const tickets = new Map((prev.tickets || []).map(t => [t.tkt, t])), adj = new Map((prev.adj || []).map(a => [a.date + '|' + a.amount + '|' + a.what, a]));
  for (let mode = 0; mode <= 5; mode++) {
    const h = K23.history((await req('History.aspx?Mode=' + mode)).text);
    for (const t of h.tickets) tickets.set(t.tkt, t);
    for (const a of h.adj) adj.set(a.date + '|' + a.amount + '|' + a.what, a);
  }
  const open = K23.openBets((await req('OpenBets.aspx')).text);
  for (const t of open) tickets.delete(t.tkt);

  const data = {
    updated: new Date().toISOString(), book: 'Computer', site: 'king23.ag', figures,
    lines: lines.filter(l => l.date && l.home),
    open,
    tickets: [...tickets.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.tkt).localeCompare(String(a.tkt))),
    adj: [...adj.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  };
  // Only rewrite the file when something besides the timestamp changed (keeps the commit history quiet)
  const same = prev.updated && JSON.stringify({ ...prev, updated: 0 }) === JSON.stringify({ ...data, updated: 0 });
  // a pull asked for from the app's Refresh always saves, so the app can see it finished
  if (same && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') { console.log('No changes.'); return; }
  writeFileSync(OUT, JSON.stringify(data, null, 1));
  console.log(`Saved ${data.lines.length} lines, ${data.tickets.length} graded tickets, ${open.length} open.`);
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
