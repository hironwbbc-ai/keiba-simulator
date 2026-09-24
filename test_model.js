// 簡易テスト: node test_model.js
const M = require("./model.js"), fs = require("fs");
const race = { distance: 1600, surface: "芝", going: "良" };
const mk = (early, fin, agari) => ({ date: "2026-05-01", distance: 1600, surface: "芝", going: "良", field_size: 16,
  corners: [early, early], finish: fin, last3: 34, front3: 34.5, agari });
const runs = { A: [mk(1, 3, 34.5), mk(2, 4, 34.6), mk(1, 2, 34.4)], B: [mk(14, 1, 33.0), mk(13, 2, 33.2), mk(15, 1, 32.9)], C: [] };
const hs = Object.entries(runs).map(([n, r]) => ({ n, ...M.analyze(r, race) }));
console.log(hs.map(h => `${h.n}:${h.style} base=${h.base.toFixed(2)}`).join("  "));
const res = M.simulate(hs, { n: 5000 });
const sum = a => a.reduce((x, y) => x + y, 0);
console.log("pace", res.pace, "win", res.win.map(x => x.toFixed(2)));
if (Math.abs(sum(res.win) - 1) > 1e-9 || Math.abs(sum(res.top3) - 3) > 1e-9) throw new Error("確率の合計が不正");
if (hs[1].base <= hs[0].base) throw new Error("好走・鋭い上がりの馬が高評価にならない");
// 既存の旧形式データ（上がり・ラップなし）でも動くこと
const old = JSON.parse(fs.readFileSync("data/horse_history/20260906.json", "utf8")).horses.slice(0, 16);
const hs2 = old.map(h => ({ n: h.name, ...M.analyze(h.history_before_target, { distance: 1800, surface: "芝", going: "良" }) }));
const r2 = M.simulate(hs2, { n: 2000 });
console.log("legacy ok", hs2.map(h => h.style).join(","), r2.win.slice(0, 3).map(x => x.toFixed(3)));
console.log("OK");
