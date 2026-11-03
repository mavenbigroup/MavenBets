// Anolik Sports Book → king23 placement job.
// STAGE 1 (TEST MODE ONLY): this script does NOT contact king23 at all. It has no network code and
// is given no king23 password. It checks the bet against the latest king23 lines in computer.json
// and records what it WOULD place in placements.json, so the app can show the whole flow working.
// Live placement gets built in Stage 2, after mapping king23's bet slip together.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'placements.json';
const read = f => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
const toks = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && w.length > 1 && !['at', 'vs'].includes(w));
const overlap = (a, b) => toks(a).some(w => toks(b).includes(w));
const am = n => (n > 0 ? '+' : '') + n;
const sgn = n => (+n === 0 ? 'PK' : (n > 0 ? '+' : '') + n);
function oddsNum(s) { // "11/10" -> -110, "-110" -> -110, "+105" -> 105
  s = String(s || '').trim(); let m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) { const r = +m[1], w = +m[2]; return r >= w ? -Math.round(r / w * 100) : Math.round(w / r * 100); }
  m = s.match(/^([+-]?)(\d{3,4})$/); if (m) return m[1] === '-' ? -m[2] : +m[2];
  return null;
}

function main() {
  const bet = JSON.parse(process.env.BET || '{}'), mode = process.env.MODE || 'test';
  const prev = read(OUT) || { results: [] }, comp = read('computer.json') || {};
  const result = { id: bet.id, at: new Date().toISOString(), mode, by: bet.by || null, bet: { who: bet.who, lg: bet.lg, matchup: bet.matchup, pick: bet.pick, spread: bet.spread, odds: bet.odds, risk: bet.amount, win: bet.payout } };
  const done = (status, msg, extra = {}) => { Object.assign(result, { status, msg }, extra); console.log(status.toUpperCase() + ': ' + msg);
    prev.results = [result, ...(prev.results || [])].slice(0, 500); writeFileSync(OUT, JSON.stringify(prev, null, 1)); };

  // ---- safeguards ----
  if (!bet.id || !bet.pick || !(bet.amount > 0) || !(bet.payout > 0)) return done('refused', 'Bet is missing a pick or amounts.');
  if (bet.book !== 'Computer') return done('refused', 'Only Computer-book bets go to king23.');
  if ((prev.results || []).some(r => r.id === bet.id && r.status === 'placed')) return done('refused', 'Already placed on king23 — not sending twice.');
  if (mode !== 'test') return done('refused', 'Live placement isn’t built yet (Stage 2). Nothing was sent to king23.');

  // ---- line check against the latest king23 board ----
  const [a, h] = String(bet.matchup || '').split('@').map(s => s.trim());
  const games = (comp.lines || []).filter(g => g.lg === bet.lg);
  const g = games.find(g => (a && h && overlap(g.away, a) && overlap(g.home, h)) || (overlap(g.away, bet.pick) || overlap(g.home, bet.pick)) && (!a || overlap(g.away, a) || overlap(g.home, a)));
  let now = null, moved = false;
  if (g) {
    const ou = /^(over|under)$/i.test(bet.pick), side = ou ? null : overlap(g.away, bet.pick) ? 'away' : overlap(g.home, bet.pick) ? 'home' : null;
    if (ou) { const o = /^over/i.test(bet.pick) ? g.overOdds : g.underOdds; now = `${bet.pick} ${g.total} (${am(o)})`; moved = +bet.spread !== g.total || oddsNum(bet.odds) !== o; }
    else if (side && bet.spread !== '' && bet.spread != null) { const sp = g[side + 'Spread'], o = g[side + 'SpreadOdds']; now = `${bet.pick} ${sgn(sp)} (${am(o)})`; moved = (parseFloat(bet.spread) || 0) !== sp || oddsNum(bet.odds) !== o; }
    else if (side) { const o = g[side + 'ML']; now = `${bet.pick} ${am(o)} moneyline`; moved = oddsNum(bet.odds) !== o; }
  }
  const asked = `${bet.pick} ${bet.spread || ''} (${bet.odds}) — risk $${bet.amount} to win $${bet.payout} · ${bet.matchup}`.replace(/\s+/g, ' ');
  if (!g) return done('test', `Would place: ${asked}. ⚠ Game not on king23’s board (started, or not posted) — live mode would refuse this.`, { lineNow: null });
  done('test', `Would place: ${asked}. king23 line now: ${now}${moved ? ' ⚠ moved — live mode would stop and ask.' : ' ✓ same.'}`, { lineNow: now, moved });
}
main();
