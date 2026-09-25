/* 予想モデル: 過去走(位置取り・上がり・ペース・馬場・距離)から脚質と適性を出し、
   ペースを毎回サンプリングしながらモンテカルロで着順を再現する。DOM非依存。 */
(function (root) {
  "use strict";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const HEAVY = ["稍重", "重", "不良"];
  const CATS = ["ハイ", "平均", "スロー"];
  const PRIOR = { // 脚質ごとのペース適性の事前値（ロジット単位）
    逃げ: { ハイ: -.35, 平均: 0, スロー: .35 }, 先行: { ハイ: -.15, 平均: 0, スロー: .2 },
    差し: { ハイ: .2, 平均: 0, スロー: -.15 }, 追込: { ハイ: .35, 平均: 0, スロー: -.3 },
    不明: { ハイ: 0, 平均: 0, スロー: 0 } };
  const K = 2; // 少数サンプルを平均へ引き戻す強さ

  function paceCat(bias) { return bias == null ? null : bias >= 1 ? "ハイ" : bias <= -1 ? "スロー" : "平均"; }

  const CLASS_RANK = [[/G ?1|GI(?!I)/, 7], [/G ?2|GII(?!I)/, 6], [/G ?3|GIII/, 5],
    [/オープン|OP\b/, 4], [/3勝クラス|1000万/, 3], [/2勝クラス|500万/, 2], [/1勝クラス/, 1], [/未勝利|新馬/, 0]];
  function classLevel(name) {
    const s = String(name || "");
    for (const [re, lv] of CLASS_RANK) if (re.test(s)) return lv;
    // 条件戦の言い回しが無い固有名のレース（重賞・OP特別など）はオープン級以上とみなす
    if (/[ぁ-んァ-ヶー一-龥]{3,}/.test(s) && !/未勝利|新馬|勝クラス|万下/.test(s)) return 4;
    return null;
  }

  function normRun(r) {
    const raw = String(r.distance_raw || "");
    const dist = r.distance || Number((raw.match(/\d{3,4}/) || [])[0]) || null;
    const surf = r.surface || (raw.startsWith("ダ") ? "ダート" : raw.startsWith("芝") ? "芝" : "");
    let cs = (r.corners && r.corners.length ? r.corners : [r.corner3, r.corner4]).filter(Number.isFinite);
    const fs = Number(r.field_size) || null;
    const bias = r.front3 && r.last3 ? r.last3 - r.front3 : null; // +なら前傾＝ハイペース
    return { date: r.date, dist, surf, going: r.going || "", fs, raceName: r.race_name || r.raceName || null,
      early: cs.length && fs > 1 ? (cs[0] - 1) / (fs - 1) : null,
      score: Number(r.finish) && fs > 1 ? 1 - (Number(r.finish) - 1) / (fs - 1) : null,
      pace: paceCat(bias), kick: r.last3 && r.agari ? r.last3 - r.agari : null };
  }

  function analyze(rawRuns, race) {
    const runs = (rawRuns || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map(normRun);
    const w = runs.map((_, i) => Math.pow(.85, i));
    let clw = 0, clv = 0;
    runs.forEach((r, i) => { const lv = classLevel(r.raceName); if (lv != null) { clw += w[i]; clv += w[i] * lv; } });
    const avgClass = clw ? clv / clw : null, raceClass = classLevel(race.name);
    const classPenalty = (avgClass != null && raceClass != null) ? clamp(raceClass - avgClass, 0, 4) * .45 : 0;
    const wmean = (f, pred, prior) => {
      let sw = 0, sv = 0;
      runs.forEach((r, i) => { const v = f(r); if (v != null && (!pred || pred(r))) { sw += w[i]; sv += w[i] * v; } });
      return { n: sw, mean: sw ? sv / sw : null, shrunk: (sv + K * prior) / (sw + K) };
    };
    const ability = wmean(r => r.score, null, .5).shrunk;
    const delta = pred => wmean(r => r.score, pred, ability).shrunk - ability;
    const em = wmean(r => r.early);
    const style = em.mean == null ? "不明" : em.mean < .2 ? "逃げ" : em.mean < .42 ? "先行" : em.mean < .7 ? "差し" : "追込";
    const kick = (() => { let sw = 0, sv = 0; runs.forEach((r, i) => { if (r.kick != null) { sw += w[i]; sv += w[i] * r.kick; } }); return sv / (sw + 1); })();
    const heavy = HEAVY.includes(race.going);
    const dDist = race.distance ? delta(r => r.dist && r.surf === race.surface && Math.abs(r.dist - race.distance) <= 200) : 0;
    const dGoing = race.going ? delta(r => r.surf === race.surface && r.going && HEAVY.includes(r.going) === heavy) : 0;
    const dSurf = delta(r => r.surf === race.surface);
    const paceDelta = {}; CATS.forEach(c => { paceDelta[c] = delta(r => r.pace === c); });
    const base = 3 * (ability - .5) + 1.4 * dDist + dGoing + dSurf + .6 * clamp(kick, -1.5, 1.5) - classPenalty;
    return { style, earlyMean: em.mean, ability, dDist, dGoing, dSurf, kick, paceDelta, avgClass, raceClass, classPenalty, base, runs: runs.length };
  }

  function predictPace(hs) {
    const N = hs.length || 1;
    const E = hs.filter(h => h.style === "逃げ").length, F = hs.filter(h => h.style === "先行").length;
    const share = (E + .5 * F) / N, delta = share - .25; // .25 ＝ 先行争いに絡む馬の標準的な割合
    let pH = clamp(.15 + .9 * delta, .06, .55), pS = clamp(.45 - .9 * delta, .08, .6);
    let pM = 1 - pH - pS;
    if (pM < .1) { const s = pH + pS; pH = pH / s * .9; pS = pS / s * .9; pM = .1; }
    return { ハイ: pH, 平均: pM, スロー: pS, E, F };
  }

  function randn() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  function simulate(hs, opt) {
    const { n = 10000, sigma = .9, fixedPace = null } = opt || {};
    const pp = predictPace(hs), N = hs.length;
    const adj = hs.map(h => { const o = {}; CATS.forEach(c => {
      o[c] = PRIOR[h.style][c] + 1.5 * h.paceDelta[c] + (h.style === "逃げ" && pp.E === 1 && c !== "ハイ" ? .25 : 0); }); return o; });
    const win = Array(N).fill(0), top2 = Array(N).fill(0), top3 = Array(N).fill(0);
    const paceCount = { ハイ: 0, 平均: 0, スロー: 0 };
    for (let s = 0; s < n; s++) {
      const r = Math.random();
      const cat = fixedPace || (r < pp.ハイ ? "ハイ" : r < pp.ハイ + pp.平均 ? "平均" : "スロー");
      paceCount[cat]++;
      const order = hs.map((h, i) => [h.base + adj[i][cat] + sigma * randn(), i]).sort((a, b) => b[0] - a[0]);
      win[order[0][1]]++;
      for (let k = 0; k < Math.min(3, N); k++) { if (k < 2) top2[order[k][1]]++; top3[order[k][1]]++; }
    }
    return { pace: pp, win: win.map(x => x / n), top2: top2.map(x => x / n), top3: top3.map(x => x / n) };
  }

  const api = { analyze, simulate, predictPace, normRun, paceCat };
  if (typeof module !== "undefined") module.exports = api; else root.KeibaModel = api;
})(this);
