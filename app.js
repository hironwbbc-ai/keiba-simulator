"use strict";
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nn = s => String(s || "").replace(/[\s　]/g, "").replace(/ブリンカー.*$/, "");
const pct = x => (x * 100).toFixed(x < .1 ? 1 : 0) + "%";
const WAKU = [["#fff", "#111"], ["#111", "#fff"], ["#d32f2f", "#fff"], ["#1e5bb8", "#fff"], ["#f2c400", "#111"], ["#1f8a3b", "#fff"], ["#f28a00", "#111"], ["#e77fa8", "#111"]];
let races = [], cur = null;

async function getJSON(p) {
  const r = await fetch("./" + p + "?ts=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(p + " " + r.status);
  return r.json();
}
const tryJSON = p => getJSON(p).catch(() => null);
const ymdOf = () => $("date").value.replace(/-/g, "");
function status(msg, err) { const s = $("status"); s.innerHTML = msg || ""; s.className = "status" + (err ? " err" : ""); }
function actionsUrl() {
  const u = location.hostname.split(".")[0], repo = location.pathname.split("/")[1];
  return location.hostname.endsWith("github.io") && repo ? `https://github.com/${u}/${repo}/actions` : "https://github.com/";
}
function guide(title, steps) {
  return `<div class="guide"><b>${title}</b><ol>${steps.map(s => `<li>${s}</li>`).join("")}</ol><p><a href="${actionsUrl()}" target="_blank" rel="noopener">GitHub Actions を開く</a></p></div>`;
}

async function loadDay() {
  const ymd = ymdOf();
  if (!ymd) return status("開催日を選んでください。", true);
  status("読み込み中…"); $("cond").hidden = $("out").hidden = true; cur = null;
  let [daily, hidx] = await Promise.all([tryJSON(`data/daily/${ymd}.json`), tryJSON(`data/history/${ymd}/index.json`)]);
  if (!daily) { const d = await tryJSON("data/jra_daily.json"); if (d && String(d.date || "").replace(/-/g, "") === ymd) daily = d; }
  const map = new Map();
  (hidx?.races || []).forEach(r => map.set(r.venue_code + "-" + r.no, { ...r }));
  (daily?.races || []).forEach(r => { const k = r.venue_code + "-" + r.no; map.set(k, { ...(map.get(k) || {}), ...r }); });
  races = [...map.values()].sort((a, b) => String(a.venue_code).localeCompare(b.venue_code) || a.no - b.no);
  if (!races.length) {
    $("races").innerHTML = guide("この日のレース一覧がありません", [
      "開催日が近い場合：『JRA Sync - Historical』または当日同期のワークフローを実行",
      `過去のレースの場合：『JRA Sync - Historical Selected Race』で ${ymd} の開催場とレース番号を指定して実行`,
      "完了後、もう一度「読み込む」を押す"]);
    return status("");
  }
  const byVenue = {};
  races.forEach(r => (byVenue[r.venue || r.venue_code] ||= []).push(r));
  $("races").innerHTML = Object.entries(byVenue).map(([v, rs]) => `<h3>${esc(v)}</h3><div class="rgrid">` +
    rs.map(r => `<button class="rbtn" data-k="${r.venue_code}-${r.no}"><b>${r.no}R</b><small>${esc(r.name || "")}</small></button>`).join("") + "</div>").join("");
  status(`${races.length}レースが見つかりました。`);
}

async function pickRace(k) {
  const r = races.find(x => x.venue_code + "-" + x.no === k); if (!r) return;
  document.querySelectorAll(".rbtn").forEach(b => b.classList.toggle("on", b.dataset.k === k));
  const ymd = ymdOf(); status("出走馬とデータを読み込み中…"); $("out").hidden = true;
  const detail = await tryJSON(`data/history/${ymd}/${r.venue_code}_${pad(r.no)}.json`);
  let entries = [];
  if (r.horses) entries = r.horses.map(h => ({ no: h.number, name: h.name, odds: h.odds, pop: h.popularity, jockey: h.jockey }));
  else if (detail?.horses) entries = detail.horses.map(h => ({ no: h.number ?? h.no, name: h.name, pop: h.popularity, jockey: h.jockey }));
  if (detail?.horses) { const fin = new Map(detail.horses.map(h => [h.number ?? h.no, h.finish])); entries.forEach(e => { e.finish = fin.get(e.no); }); }
  let hh = await tryJSON(`data/horse_history/${ymd}_${r.venue_code}_${pad(r.no)}.json`), legacy = false;
  if (!hh) { hh = await tryJSON(`data/horse_history/${ymd}.json`); legacy = !!hh; }
  const byNo = new Map(), byName = new Map();
  (hh?.horses || []).forEach(h => { const runs = h.history_before_target || []; if (h.number != null && !legacy) byNo.set(h.number, runs); byName.set(nn(h.name), runs); });
  const race = { ymd, code: r.venue_code, no: r.no, venue: r.venue, name: r.name || detail?.name || "",
    distance: r.distance || detail?.distance, surface: r.surface || detail?.surface, going: r.going || detail?.going || "" };
  cur = { race, entries, byNo, byName, legacy, hasHistory: !!hh };
  $("raceTitle").textContent = `${race.venue || ""}${race.no}R ${race.name}　${race.surface || ""}${race.distance || ""}m`;
  $("going").value = race.going || "良"; $("cond").hidden = false;
  if (!entries.length) return status(guide("出走馬データがありません", ["開催日の同期、または過去レース取得ワークフローを実行してください"]), true);
  if (!hh) return status(guide("このレースの過去走データがまだありません", [
    "GitHub の Actions で『JRA Sync - Horse History』を選ぶ",
    `Run workflow に 開催日 ${ymd}／開催場 ${esc(race.venue || race.code)}／レース ${race.no} を入力して実行（数分かかります）`,
    "完了後、このページを再読み込みして同じレースを選ぶ"]), true);
  status(legacy ? "旧形式の過去走データを使用中です（上がり・ペース情報がないため精度は下がります）。" : "");
}

function run() {
  if (!cur?.hasHistory) return;
  const { race, entries, byNo, byName } = cur, M = KeibaModel;
  const cond = { distance: race.distance, surface: race.surface, going: $("going").value, name: race.name, venue: race.venue };
  const hs = entries.map(e => ({ ...e, ...M.analyze(byNo.get(e.no) || byName.get(nn(e.name)) || [], cond) }));
  const fixed = $("pace").value || null;
  const res = M.simulate(hs, { n: 10000, fixedPace: fixed });
  const rows = hs.map((h, i) => ({ ...h, win: res.win[i], top2: res.top2[i], top3: res.top3[i] })).sort((a, b) => b.win - a.win);
  const p = res.pace;
  $("pacebox").innerHTML = `<p>${fixed ? `ペースを「${fixed}」に固定して計算` : `逃げ ${p.E}頭・先行 ${p.F}頭 から予測したペース`}</p>` +
    ["ハイ", "平均", "スロー"].map(c => { const v = fixed ? (c === fixed ? 1 : 0) : p[c];
      return `<div class="pbar"><span>${c}</span><span><i class="${c === "ハイ" ? "hot" : ""}" style="width:${v * 100}%"></i></span><span>${Math.round(v * 100)}%</span></div>`; }).join("");
  const top = rows[0], actual = rows.filter(r => r.finish);
  $("verdict").innerHTML = actual.length ? (() => {
    const w = rows.find(r => r.finish === 1), rank = w ? rows.indexOf(w) + 1 : "-";
    return `検証：モデル1位は <strong>${esc(top.name)}</strong>（実際 ${top.finish || "-"}着）／実際の勝ち馬 <strong>${esc(w?.name || "-")}</strong> はモデル${rank}位`;
  })() : `本命馬：<strong>${esc(top.name)}</strong>（勝率 ${pct(top.win)}）`;
  const maxW = rows[0].win || 1;
  $("results").innerHTML = rows.map(h => {
    const [bg, fg] = WAKU[Math.min(8, Math.ceil(h.no / 2)) - 1] || WAKU[0], ev = h.odds ? h.win * h.odds : null;
    return `<article class="row"><span class="waku" style="background:${bg};color:${fg}">${h.no}</span>
      <div class="nm"><b>${esc(h.name)}</b><small>${esc(h.jockey || "")}${h.pop ? ` ・${h.pop}人気` : ""}</small></div>
      <div class="pct"><strong>${pct(h.win)}</strong><small>3着内 ${pct(h.top3)}</small></div>
      <div class="bar"><i style="width:${h.win / maxW * 100}%"></i></div>
      <div class="tags"><span class="tag">${h.style}</span>${ev ? `<span class="tag ${ev >= 1 ? "hot" : ""}">オッズ${h.odds} 期待値${ev.toFixed(2)}</span>` : ""}${h.finish ? `<span class="tag">実際${h.finish}着</span>` : ""}</div>
      <details><summary>根拠</summary><p>過去走 ${h.runs}走／平均の序盤位置 ${h.earlyMean == null ? "不明" : (h.earlyMean * 100).toFixed(0) + "%（0=先頭）"}／能力 ${(h.ability * 100).toFixed(0)}<br>
      距離適性 ${sg(h.dDist)}・馬場適性 ${sg(h.dGoing)}・上がり ${h.kick >= 0 ? "+" : ""}${h.kick.toFixed(2)}秒${h.dDefy ? `・展開に逆らった好走 +${sg(h.dDefy)}` : ""}<br>
      ペース別 ハイ${sg(h.paceDelta.ハイ)} 平均${sg(h.paceDelta.平均)} スロー${sg(h.paceDelta.スロー)}
      ${h.classPenalty ? `<br>格上挑戦の割引 −${h.classPenalty.toFixed(2)}（過去の主戦クラス目安 ${h.avgClass?.toFixed(1)} → 今回 ${h.raceClass}）` : ""}</p></details></article>`;
  }).join("");
  $("out").hidden = false; $("out").scrollIntoView({ behavior: "smooth" });
}
const sg = x => (x >= 0 ? "+" : "") + (x * 100).toFixed(0);

$("load").onclick = loadDay;
$("run").onclick = run;
$("races").onclick = e => { const b = e.target.closest(".rbtn"); if (b) pickRace(b.dataset.k); };
$("date").value = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
