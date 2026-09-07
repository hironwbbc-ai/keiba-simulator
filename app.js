/* =========================================================
   競馬シミュレーター Ver.11.0
   ---------------------------------------------------------
   JRA公式同期JSON
   ↓
   出馬表
   ↓
   独立特徴量モデル
   ↓
   展開・脚質補正
   ↓
   Monte Carlo 10,000回
   ↓
   1着 / 2着 / 3着確率
   ↓
   単勝期待値
   ↓
   3連複 / 3連単候補

   注意：
   現段階では「学習済みAI」ではなく、
   ルールベースの検証用モデル。
   データが存在しない特徴量は推測しない。
   ========================================================= */

"use strict";

/* =========================================================
   DOM
   ========================================================= */

const $ = id => document.getElementById(id);


/* =========================================================
   STATE
   ========================================================= */

const state = {
  races: [],
  horses: [],
  selected: null,
  history: null,
  daily: null,
  analysis: null
};


/* =========================================================
   CONFIG
   ========================================================= */

const MODEL_VERSION = "11.0";

const SIMULATIONS = 10000;

const VENUES = {
  "札幌": "01",
  "函館": "02",
  "福島": "03",
  "新潟": "04",
  "東京": "05",
  "中山": "06",
  "中京": "07",
  "京都": "08",
  "阪神": "09",
  "小倉": "10"
};


/*
   モデル構成

   市場情報      30%
   脚質          15%
   展開          15%
   斤量          10%
   馬体重        10%
   性齢           5%
   人気           5%
   データ充足度   10%

   ※近走・コース適性・騎手などは
     データが入った段階で自動的に追加可能。
*/

const WEIGHTS = {
  market: 0.30,
  style: 0.15,
  pace: 0.15,
  carriedWeight: 0.10,
  bodyWeight: 0.10,
  sexAge: 0.05,
  popularity: 0.05,
  coverage: 0.10
};


/* =========================================================
   TODAY
   ========================================================= */

function today(){

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      timeZone:"Asia/Tokyo",
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }
  )
  .format(new Date())
  .replace(/\//g,"-");

}


if($("date")){
  $("date").value = today();
}


/* =========================================================
   MESSAGE
   ========================================================= */

function msg(text, cls=""){

  const el = $("status");

  if(!el) return;

  el.innerHTML = text;
  el.className = "status " + cls;

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function esc(v){

  return String(v ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");

}


/* =========================================================
   JINA
   ========================================================= */

async function jina(url){

  const candidates = [
    "https://r.jina.ai/" + url,
    "https://r.jina.ai/http://" +
      url.replace(/^https?:\/\//,"")
  ];

  let last = "";

  for(const u of candidates){

    for(let n=0;n<2;n++){

      try{

        const r = await fetch(
          u,
          {
            headers:{
              Accept:"text/plain"
            },
            cache:"no-store"
          }
        );

        if(!r.ok){

          last = "取得サーバーHTTP " + r.status;
          continue;

        }

        const t = await r.text();

        if(t && t.length > 500){

          return t;

        }

        last = "取得内容が空でした";

      }catch(e){

        last = e.message || String(e);

      }

      await new Promise(
        resolve => setTimeout(resolve,350)
      );

    }

  }

  throw new Error(
    last || "取得できませんでした"
  );

}


/* =========================================================
   CALENDAR PARSER
   ========================================================= */

function parseCalendar(text,date){

  const lines = text
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  const races = [];

  let venue = "";

  const names = [
    "中山",
    "阪神",
    "札幌",
    "東京",
    "京都",
    "中京",
    "新潟",
    "福島",
    "小倉",
    "函館"
  ];

  for(let i=0;i<lines.length;i++){

    const vm =
      lines[i].match(
        /^\d+回(.+?)\d+日$/
      );

    if(
      vm &&
      names.includes(vm[1])
    ){

      venue = vm[1];
      continue;

    }

    const rm =
      lines[i].match(
        /^(\d{1,2})レース\s*\|?\s*(.*)$/
      );

    if(rm && venue){

      let info =
        rm[2]
          .replace(/\s*\|\s*/g," ")
          .trim();

      if(
        !info &&
        lines[i+1]
      ){

        info =
          lines[i+1]
            .replace(/\s*\|\s*/g," ")
            .trim();

      }

      const next =
        lines[i+1] || "";

      const tm =
        (
          next.match(
            /(\d{1,2})時(\d{2})分/
          )
          ||
          lines[i].match(
            /(\d{1,2})時(\d{2})分/
          )
        );

      races.push({
        date,
        venue,
        no:Number(rm[1]),
        name:info || "レース",
        time:tm
          ? `${tm[1].padStart(2,"0")}:${tm[2]}`
          : ""
      });

    }

  }

  return races;

}


/* =========================================================
   META PARSER
   ========================================================= */

function parseMeta(text){

  const m = {};

  const dm =
    text.match(
      /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/
    );

  if(dm){

    m.date =
      `${dm[1]}-${String(dm[2]).padStart(2,"0")}-${String(dm[3]).padStart(2,"0")}`;

  }

  const meet =
    text.match(
      /\d+回(.+?)\d+日/
    );

  if(meet){

    m.venue = meet[1];

  }

  const rn =
    text.match(
      /(\d{1,2})レース/
    );

  if(rn){

    m.no = Number(rn[1]);

  }

  const tm =
    text.match(
      /発走時刻：(\d{1,2})時(\d{2})分/
    );

  if(tm){

    m.time =
      `${tm[1].padStart(2,"0")}:${tm[2]}`;

  }

  const nm =
    text.match(
      /##\s*(?:第\d+回)?(.+?)(?:\n|$)/
    );

  if(nm){

    m.name = nm[1].trim();

  }

  const d =
    text.match(
      /([\d,]+)メートル（(芝|ダート)・([^）]+)）/
    );

  if(d){

    m.distance =
      parseInt(
        d[1].replace(/,/g,"")
      );

    m.surface = d[2];
    m.course = d[3];

  }

  const g =
    text.match(
      /(?:芝|ダート)(?:・[^ \n]+)?\s*(良|稍重|重|不良)/
    );

  if(g){

    m.going = g[1];

  }

  return m;

}


/* =========================================================
   STYLE
   ========================================================= */

function inferStyle(past){

  const positions = [];

  for(const s of past){

    const nums =
      (s.match(/\b\d{1,2}\b/g) || [])
        .map(Number)
        .filter(
          n => n>=1 && n<=18
        );

    if(nums.length >= 4){

      positions.push(nums[0]);

    }

  }

  if(!positions.length){

    return "不明";

  }

  const avg =
    positions.reduce(
      (a,b) => a+b,
      0
    ) / positions.length;

  if(avg <= 3){

    return "逃げ・先行";

  }

  if(avg <= 7){

    return "先行・好位";

  }

  if(avg <= 11){

    return "差し";

  }

  return "追込";

}


/* =========================================================
   HORSE PARSER
   ========================================================= */

function parseHorses(text){

  const lines =
    text
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(Boolean);

  const out = [];

  for(let i=0;i<lines.length;i++){

    let a =
      lines[i].match(
        /(?:\|\s*)?(\d{1,2})\s*\|\s*(?:[^\|]+\|\s*)?([^|]+?)\s+([\d.]+)\s*\((\d+)番人気\)/
      );

    if(!a){

      a =
        lines[i].match(
          /^(\d{1,2})\s*\|?\s+([^|]+?)\s+([\d.]+)\s*\((\d+)番人気\)/
        );

    }

    if(!a){

      a =
        lines[i].match(
          /^(\d{1,2})\s+([^\s]+)\s+([\d.]+)\((\d+)番人気\)/
        );

    }

    if(!a) continue;

    const no =
      Number(a[1]);

    const name =
      a[2].trim();

    const odds =
      parseFloat(a[3]);

    const popularity =
      Number(a[4]);

    if(
      no < 1 ||
      no > 18 ||
      !name ||
      !isFinite(odds)
    ){

      continue;

    }

    let weight = null;
    let jockey = "";
    let past = [];

    for(
      let j=i+1;
      j<Math.min(i+10,lines.length);
      j++
    ){

      if(
        /(?:Image: 枠|\|\s*\d+\s*\|)/
          .test(lines[j])
      ){

        break;

      }

      const w =
        lines[j].match(
          /(\d+(?:\.\d+)?)\s*kg/
        );

      if(
        w &&
        weight === null
      ){

        weight =
          parseFloat(w[1]);

      }

      const parts =
        lines[j]
          .split("|")
          .map(s => s.trim())
          .filter(Boolean);

      if(
        parts.length &&
        /kg/.test(lines[j])
      ){

        const z =
          parts.find(
            s => /kg/.test(s)
          );

        if(z){

          jockey =
            z
              .replace(/^.*?kg\s*/,"")
              .trim();

        }

      }

      if(
        /\d{4}年/.test(lines[j])
      ){

        past.push(lines[j]);

      }

    }

    out.push({
      no,
      name,
      odds,
      popularity,
      weight,
      jockey,
      style:inferStyle(past)
    });

  }

  const seen = new Set();

  return out
    .filter(h => {

      if(seen.has(h.no)){
        return false;
      }

      seen.add(h.no);

      return true;

    })
    .sort(
      (a,b) => a.no-b.no
    );

}


/* =========================================================
   DATA
   ========================================================= */

async function getDaily(){

  if(state.daily){

    return state.daily;

  }

  const r =
    await fetch(
      "./data/jra_daily.json?ts="+Date.now(),
      {
        cache:"no-store"
      }
    );

  if(!r.ok){

    throw new Error(
      "同期データがまだありません"
    );

  }

  state.daily =
    await r.json();

  return state.daily;

}


async function getHistory(){

  if(state.history){

    return state.history;

  }

  const r =
    await fetch(
      "./data/jra_history.json?ts="+Date.now(),
      {
        cache:"no-store"
      }
    );

  if(!r.ok){

    throw new Error(
      "過去レースの同期データがありません。"
    );

  }

  state.history =
    await r.json();

  return state.history;

}


/* =========================================================
   RACE LIST
   ========================================================= */

function renderRaces(){

  const box =
    $("races");

  if(!box) return;

  box.innerHTML = "";

  const venue =
    $("venue").value;

  const list =
    state.races.filter(
      r => !venue || r.venue === venue
    );

  if(!list.length){

    box.innerHTML =
      '<div class="note">該当するレースがありません。</div>';

    return;

  }

  list.forEach(r => {

    const d =
      document.createElement("div");

    d.className = "race";

    const historical =
      !!r.historical;

    d.innerHTML =
      `<b>${esc(r.venue)} ${r.no}R ${esc(r.name || "レース")}</b>
       <br>
       <span class="small">
       ${esc(r.time || "")}
       ${historical ? "・結果済み" : ""}
       </span>`;

    const b =
      document.createElement("button");

    b.textContent =
      historical
        ? "結果・バックテスト"
        : "このレースを選択";

    b.onclick =
      () => historical
        ? renderHistoricalRace(r)
        : selectRace(r);

    d.appendChild(b);

    box.appendChild(d);

  });

}


/* =========================================================
   SELECT RACE
   ========================================================= */

function selectRace(r){

  state.selected = r;

  $("entryCard")
    ?.classList.remove("hidden");

  $("raceInfo").innerHTML =
    `<b>${esc(r.venue)} ${r.no}R ${esc(r.name || "")}</b>
     <br>
     <span class="small">
     ${esc(r.date)} ${esc(r.time || "")}
     </span>`;

  $("horses").innerHTML =
    '<div class="status"><span class="spinner"></span> 出馬表を取得中…</div>';

  $("resultCard")
    ?.classList.add("hidden");

  loadEntry(r);

}


/* =========================================================
   ENTRY
   ========================================================= */

async function loadEntry(r){

  try{

    const d =
      await getDaily();

    const rr =
      (d.races || []).find(
        x =>
          x.date === r.date &&
          x.venue === r.venue &&
          Number(x.no) === Number(r.no)
      );

    if(!rr){

      throw new Error(
        "このレースのJRA公式同期データがありません。"
      );

    }

    if(
      Array.isArray(rr.horses) &&
      rr.horses.length
    ){

      state.horses =
        rr.horses;

      state.selected =
        {
          ...r,
          ...rr
        };

      $("raceInfo").innerHTML =
        `<b>${esc(rr.venue)} ${rr.no}R ${esc(rr.name || r.name || "")}</b>
         <br>
         <span class="small">
         ${esc(rr.date)}
         ${esc(rr.time || r.time || "")}
         ・${esc(rr.surface || "")}
         ${rr.distance ? esc(rr.distance)+"m" : ""}
         ・馬場 ${esc(rr.going || "不明")}
         </span>`;

      renderHorses();

      return;

    }

    if(!rr.url){

      throw new Error(
        "JRA公式出馬表URLがありません"
      );

    }

    const text =
      await jina(rr.url);

    const meta =
      parseMeta(text);

    const hs =
      parseHorses(text);

    if(!hs.length){

      throw new Error(
        "JRAページは取得できましたが、馬データを解析できませんでした"
      );

    }

    state.horses = hs;

    state.selected =
      {
        ...r,
        ...meta
      };

    $("raceInfo").innerHTML =
      `<b>${esc(meta.venue || r.venue)} ${meta.no || r.no}R ${esc(meta.name || r.name || "")}</b>
       <br>
       <span class="small">
       ${esc(meta.date || r.date)}
       ${esc(meta.time || r.time || "")}
       ・${esc(meta.surface || "")}
       ${meta.distance ? esc(meta.distance)+"m" : ""}
       ・馬場 ${esc(meta.going || "不明")}
       </span>`;

    renderHorses();

  }catch(e){

    $("horses").innerHTML =
      `<div class="status err">
       出馬表を取得できませんでした：
       ${esc(e.message)}
       <br>
       <span class="small">
       GitHub ActionsでJRA公式データを同期してから、
       もう一度レースを選択してください。
       </span>
       </div>`;

  }

}


/* =========================================================
   NORMALIZE HORSE
   ========================================================= */

function normalizeHorse(h){

  return {

    no:Number(
      h.no ??
      h.number ??
      h.horse_no ??
      0
    ),

    name:
      h.name ??
      h.horse_name ??
      h.horseName ??
      "",

    odds:Number(
      h.odds ?? 0
    ),

    popularity:
      h.popularity ??
      h.odds_rank ??
      h.rank ??
      null,

    bodyWeight:
      toNumberOrNull(
        h.bodyWeight ??
        h.body_weight ??
        h.weight
      ),

    bodyWeightDiff:
      toNumberOrNull(
        h.bodyWeightDiff ??
        h.body_weight_diff
      ),

    sexAge:
      h.sexAge ??
      h.sex_age ??
      "",

    carriedWeight:
      toNumberOrNull(
        h.carriedWeight ??
        h.carried_weight ??
        h.weight_carried
      ),

    jockey:
      h.jockey ||
      "",

    style:
      h.style ||
      "不明",

    frame:
      toNumberOrNull(
        h.frame ??
        h.frame_no ??
        h.waku
      ),

    recent:
      h.recent ||
      h.lastRuns ||
      h.pastRuns ||
      [],

    courseStats:
      h.courseStats ||
      h.course_stats ||
      null,

    jockeyStats:
      h.jockeyStats ||
      h.jockey_stats ||
      null,

    corner4:
      toNumberOrNull(
        h.corner4 ??
        h.corner_4
      ),

    finish:
      toNumberOrNull(
        h.finish ??
        h.result ??
        h.place
      )

  };

}


function toNumberOrNull(v){

  if(
    v === null ||
    v === undefined ||
    v === ""
  ){

    return null;

  }

  const n =
    Number(
      String(v)
        .replace(/[^\d.+-]/g,"")
    );

  return Number.isFinite(n)
    ? n
    : null;

}


/* =========================================================
   HORSE TABLE
   ========================================================= */

function renderHorses(){

  const hs =
    state.horses
      .map(normalizeHorse)
      .sort(
        (a,b) => a.no-b.no
      );

  $("horses").innerHTML =
    `
    <div class="small" style="margin-bottom:6px">
      ${hs.length}頭・JRA公式同期データ
    </div>

    <div style="overflow-x:auto">

    <table>

    <thead>
    <tr>
      <th>馬番</th>
      <th>馬名</th>
      <th>性齢</th>
      <th>騎手</th>
      <th>斤量</th>
      <th>馬体重</th>
      <th>単勝</th>
      <th>人気</th>
      <th>脚質</th>
    </tr>
    </thead>

    <tbody>

    ${
      hs.map(h => `
      <tr>

        <td><b>${h.no}</b></td>

        <td><b>${esc(h.name)}</b></td>

        <td>${esc(h.sexAge || "-")}</td>

        <td>${esc(h.jockey || "-")}</td>

        <td>
          ${h.carriedWeight != null
            ? h.carriedWeight+"kg"
            : "-"}
        </td>

        <td>
          ${h.bodyWeight != null
            ? h.bodyWeight
            : "-"}
          ${
            h.bodyWeightDiff != null
              ? ` (${h.bodyWeightDiff > 0 ? "+" : ""}${h.bodyWeightDiff})`
              : ""
          }
        </td>

        <td>
          ${h.odds > 0 ? h.odds : "-"}
        </td>

        <td>
          ${h.popularity ?? "-"}
        </td>

        <td>
          ${esc(h.style)}
        </td>

      </tr>
      `).join("")
    }

    </tbody>
    </table>

    </div>
    `;

}


/* =========================================================
   HISTORICAL RACE
   ========================================================= */

function renderHistoricalRace(r){

  state.selected = r;

  $("entryCard")
    ?.classList.remove("hidden");

  $("resultCard")
    ?.classList.add("hidden");

  $("raceInfo").innerHTML =
    `<b>${esc(r.venue)} ${r.no}R ${esc(r.name || "レース")}</b>
     <br>
     <span class="small">
     ${esc(r.date)}
     ${esc(r.time || "")}
     ・${esc(r.surface || "")}
     ${r.distance ? r.distance+"m" : ""}
     ・結果データ
     </span>`;

  state.horses =
    r.horses || [];

  renderHistoricalHorses();

}


function renderHistoricalHorses(){

  const hs =
    state.horses
      .slice()
      .sort(
        (a,b) =>
          (a.finish || 99) -
          (b.finish || 99)
      );

  $("horses").innerHTML =
    `
    <div class="small" style="margin-bottom:6px">
      ${hs.length}頭・JRA公式レース結果
    </div>

    <div style="overflow-x:auto">

    <table>

    <thead>
    <tr>
      <th>着順</th>
      <th>馬番</th>
      <th>馬名</th>
      <th>人気</th>
      <th>騎手</th>
      <th>馬体重</th>
    </tr>
    </thead>

    <tbody>

    ${
      hs.map(h => `
      <tr>
        <td><b>${h.finish ?? "-"}</b></td>
        <td>${h.no}</td>
        <td><b>${esc(h.name)}</b></td>
        <td>${h.popularity ?? "-"}</td>
        <td>${esc(h.jockey || "-")}</td>
        <td>
          ${h.bodyWeight ?? "-"}
          ${
            h.bodyWeightDiff != null
              ? ` (${h.bodyWeightDiff > 0 ? "+" : ""}${h.bodyWeightDiff})`
              : ""
          }
        </td>
      </tr>
      `).join("")
    }

    </tbody>

    </table>

    </div>

    <div class="note" style="margin-top:8px">
      過去レースは確定後データです。
      発走前予測モデルとは分離して評価します。
    </div>
    `;

}


/* =========================================================
   MODEL HELPERS
   ========================================================= */

function clamp(v,min,max){

  return Math.max(
    min,
    Math.min(max,v)
  );

}


function average(values){

  const a =
    values.filter(
      Number.isFinite
    );

  if(!a.length){

    return null;

  }

  return (
    a.reduce(
      (x,y)=>x+y,
      0
    ) / a.length
  );

}


/* =========================================================
   MARKET SCORE
   ========================================================= */

function marketScore(h, horses){

  if(h.odds > 0){

    return 1 / h.odds;

  }

  if(
    h.popularity != null &&
    Number(h.popularity) > 0
  ){

    return 1 / Number(h.popularity);

  }

  return 1 / Math.max(
    horses.length,
    1
  );

}


/* =========================================================
   STYLE SCORE
   ========================================================= */

function styleScore(h){

  const s =
    String(h.style || "");

  if(s.includes("逃げ")){

    return 1.06;

  }

  if(s.includes("先行")){

    return 1.04;

  }

  if(s.includes("好位")){

    return 1.03;

  }

  if(s.includes("差し")){

    return 1.01;

  }

  if(s.includes("追込")){

    return 0.98;

  }

  return 1.00;

}


/* =========================================================
   PACE ANALYSIS
   ========================================================= */

function analyzePace(horses){

  let escape = 0;
  let front = 0;
  let closer = 0;

  horses.forEach(h => {

    const s =
      String(h.style || "");

    if(s.includes("逃げ")){

      escape++;

    }else if(
      s.includes("先行") ||
      s.includes("好位")
    ){

      front++;

    }else if(
      s.includes("差し") ||
      s.includes("追込")
    ){

      closer++;

    }

  });

  let scenario = "標準";

  if(escape >= 4){

    scenario = "ハイペース想定";

  }else if(escape >= 3){

    scenario = "ややハイペース";

  }else if(escape <= 1){

    scenario = "スローペース想定";

  }

  return {
    escape,
    front,
    closer,
    scenario
  };

}


/* =========================================================
   PACE SCORE
   ========================================================= */

function paceScore(h, pace){

  const s =
    String(h.style || "");

  if(
    pace.scenario ===
    "ハイペース想定"
  ){

    if(s.includes("差し")) return 1.06;
    if(s.includes("追込")) return 1.05;
    if(s.includes("先行")) return 0.99;
    if(s.includes("逃げ")) return 0.94;

  }

  if(
    pace.scenario ===
    "ややハイペース"
  ){

    if(s.includes("差し")) return 1.04;
    if(s.includes("追込")) return 1.02;
    if(s.includes("先行")) return 1.00;
    if(s.includes("逃げ")) return 0.97;

  }

  if(
    pace.scenario ===
    "スローペース想定"
  ){

    if(s.includes("逃げ")) return 1.06;
    if(s.includes("先行")) return 1.04;
    if(s.includes("好位")) return 1.02;
    if(s.includes("差し")) return 0.98;
    if(s.includes("追込")) return 0.94;

  }

  return styleScore(h);

}


/* =========================================================
   CARRIED WEIGHT
   ========================================================= */

function carriedWeightScore(h,horses){

  const values =
    horses
      .map(x=>x.carriedWeight)
      .filter(
        Number.isFinite
      );

  if(
    h.carriedWeight == null ||
    !values.length
  ){

    return 1.00;

  }

  const avg =
    average(values);

  if(avg == null){

    return 1.00;

  }

  const diff =
    h.carriedWeight - avg;

  /*
     斤量が軽いほど少しプラス。
     ただし過大評価しない。
  */

  return clamp(
    1 - diff * 0.008,
    0.94,
    1.06
  );

}


/* =========================================================
   BODY WEIGHT
   ========================================================= */

function bodyWeightScore(h,horses){

  const values =
    horses
      .map(x=>x.bodyWeight)
      .filter(
        Number.isFinite
      );

  if(
    h.bodyWeight == null ||
    values.length < 3
  ){

    return 1.00;

  }

  const avg =
    average(values);

  const diff =
    h.bodyWeight - avg;

  let score = 1.00;

  /*
     極端な増減は軽くマイナス。
     ±10kg程度はほぼニュートラル。
  */

  if(
    h.bodyWeightDiff != null
  ){

    const d =
      Math.abs(
        h.bodyWeightDiff
      );

    if(d >= 14){

      score -= 0.04;

    }else if(d >= 10){

      score -= 0.02;

    }

  }

  /*
     極端な馬体重そのものは
     原則として強く評価しない。
  */

  if(
    Math.abs(diff) > 80
  ){

    score -= 0.01;

  }

  return clamp(
    score,
    0.94,
    1.04
  );

}


/* =========================================================
   SEX / AGE
   ========================================================= */

function sexAgeScore(h){

  const s =
    String(h.sexAge || "");

  /*
     現段階では年齢だけで
     大きな補正をかけない。

     3〜5歳をニュートラル、
     極端な年齢のみ弱く補正。
  */

  const m =
    s.match(/(\d+)/);

  if(!m){

    return 1.00;

  }

  const age =
    Number(m[1]);

  if(age === 3){

    return 1.01;

  }

  if(age === 4 || age === 5){

    return 1.00;

  }

  if(age === 6){

    return 0.99;

  }

  if(age >= 7){

    return 0.97;

  }

  return 1.00;

}


/* =========================================================
   POPULARITY SCORE
   ========================================================= */

function popularityScore(h,horses){

  if(
    h.popularity == null
  ){

    return 1.00;

  }

  const p =
    Number(h.popularity);

  if(!Number.isFinite(p)){

    return 1.00;

  }

  /*
     人気は市場オッズと重複するため
     ごく弱く利用。
  */

  return clamp(
    1.04 -
    (p-1)*0.008,
    0.90,
    1.04
  );

}


/* =========================================================
   DATA COVERAGE
   ========================================================= */

function featureCoverage(h){

  const checks = [

    h.odds > 0,

    h.style !== "不明",

    h.carriedWeight != null,

    h.bodyWeight != null,

    !!h.sexAge,

    h.popularity != null,

    h.recent &&
      (
        Array.isArray(h.recent)
          ? h.recent.length > 0
          : true
      ),

    h.corner4 != null,

    h.courseStats != null,

    h.jockeyStats != null

  ];

  return (
    checks.filter(Boolean).length /
    checks.length
  );

}


/* =========================================================
   INDEPENDENT MODEL
   ========================================================= */

function buildModel(horses,race){

  const pace =
    analyzePace(horses);

  const marketRaw =
    horses.map(
      h => marketScore(h,horses)
    );

  const marketSum =
    marketRaw.reduce(
      (a,b)=>a+b,
      0
    );

  return horses.map(
    (h,i) => {

      const market =
        marketRaw[i] /
        Math.max(
          marketSum,
          0.000001
        );

      const style =
        styleScore(h);

      const paceFactor =
        paceScore(
          h,
          pace
        );

      const weight =
        carriedWeightScore(
          h,
          horses
        );

      const body =
        bodyWeightScore(
          h,
          horses
        );

      const age =
        sexAgeScore(h);

      const pop =
        popularityScore(
          h,
          horses
        );

      const coverage =
        featureCoverage(h);

      /*
         市場確率は30%程度。
         残りは特徴量ベース。

         まず各補正を
         「1.00 = 平均」
         として掛け合わせる。
      */

      const independent =
        style *
        paceFactor *
        weight *
        body *
        age *
        pop;

      /*
         市場だけで決めず、
         独立モデルを混ぜる。

         market : independent
         = 30 : 70
      */

      const raw =
        Math.pow(
          Math.max(market,0.000001),
          WEIGHTS.market
        )
        *
        Math.pow(
          Math.max(independent,0.000001),
          1-WEIGHTS.market
        );

      return {

        ...h,

        marketProbability:
          market,

        styleFactor:
          style,

        paceFactor,

        weightFactor:
          weight,

        bodyFactor:
          body,

        ageFactor:
          age,

        popularityFactor:
          pop,

        coverage,

        rawScore:
          raw,

        paceScenario:
          pace.scenario

      };

    }
  );

}


/* =========================================================
   NORMALIZE PROBABILITY
   ========================================================= */

function normalizeProbability(horses){

  const sum =
    horses.reduce(
      (a,h)=>a+h.rawScore,
      0
    );

  if(!sum){

    const p =
      1 / Math.max(
        horses.length,
        1
      );

    return horses.map(
      h => ({
        ...h,
        win:p
      })
    );

  }

  return horses.map(
    h => ({
      ...h,
      win:
        h.rawScore / sum
    })
  );

}


/* =========================================================
   MONTE CARLO
   ========================================================= */

/*
   Plackett-Luce方式の
   重み付き順位抽選。

   各馬のmodel scoreを
   そのまま勝率形成に使用。
*/

function weightedPickIndex(items){

  let total =
    items.reduce(
      (a,x)=>a+x.weight,
      0
    );

  if(total <= 0){

    return 0;

  }

  let r =
    Math.random() * total;

  for(let i=0;i<items.length;i++){

    r -= items[i].weight;

    if(r <= 0){

      return i;

    }

  }

  return items.length-1;

}


function simulateOne(horses){

  const pool =
    horses.map(
      (h,index) => ({
        index,
        weight:
          Math.max(
            h.rawScore,
            0.000001
          )
      })
    );

  const order = [];

  while(
    pool.length &&
    order.length < 3
  ){

    const i =
      weightedPickIndex(pool);

    const picked =
      pool.splice(i,1)[0];

    order.push(
      picked.index
    );

  }

  return order;

}


/* =========================================================
   MONTE CARLO
   ========================================================= */

function runMonteCarlo(horses){

  const n =
    horses.length;

  const first =
    new Array(n).fill(0);

  const second =
    new Array(n).fill(0);

  const third =
    new Array(n).fill(0);

  const trio =
    new Map();

  const exacta =
    new Map();

  for(
    let i=0;
    i<SIMULATIONS;
    i++
  ){

    const order =
      simulateOne(horses);

    if(order.length < 3){

      continue;

    }

    first[order[0]]++;

    second[order[1]]++;

    third[order[2]]++;

    /*
       3連複
    */

    const trioKey =
      [
        order[0],
        order[1],
        order[2]
      ]
      .sort(
        (a,b)=>a-b
      )
      .join("-");

    trio.set(
      trioKey,
      (trio.get(trioKey) || 0) + 1
    );

    /*
       3連単
    */

    const exactaKey =
      order.join("-");

    exacta.set(
      exactaKey,
      (exacta.get(exactaKey) || 0) + 1
    );

  }

  return {

    first,

    second,

    third,

    trio,

    exacta,

    simulations:
      SIMULATIONS

  };

}


/* =========================================================
   COMBINATION HELPERS
   ========================================================= */

function horseLabel(h){

  return `${h.no} ${h.name}`;

}


function combinationLabel(key,horses){

  return key
    .split("-")
    .map(
      i => horseLabel(
        horses[Number(i)]
      )
    )
    .join(" → ");

}


function trioLabel(key,horses){

  return key
    .split("-")
    .map(
      i => horseLabel(
        horses[Number(i)]
      )
    )
    .join(" - ");

}


/* =========================================================
   FORMAT PERCENT
   ========================================================= */

function pct(v){

  return (
    Number(v) * 100
  ).toFixed(1) + "%";

}


/* =========================================================
   RESULT RENDER
   ========================================================= */

function renderSimulation(model,mc,race){

  const horses =
    model
      .map(
        (h,i) => ({
          ...h,

          win:
            h.win,

          second:
            mc.second[i] /
            mc.simulations,

          third:
            mc.third[i] /
            mc.simulations,

          top3:
            (
              mc.first[i] +
              mc.second[i] +
              mc.third[i]
            ) /
            mc.simulations
        })
      )
      .sort(
        (a,b)=>b.win-a.win
      );

  /*
     単勝EV
  */

  horses.forEach(h => {

    if(h.odds > 0){

      h.ev =
        h.win *
        h.odds;

    }else{

      h.ev = null;

    }

  });


  /*
     3連複
  */

  const trioList =
    [...mc.trio.entries()]
      .map(
        ([key,count]) => ({
          key,
          probability:
            count /
            mc.simulations,
          count
        })
      )
      .sort(
        (a,b)=>
          b.probability -
          a.probability
      )
      .slice(0,10);


  /*
     3連単
  */

  const exactaList =
    [...mc.exacta.entries()]
      .map(
        ([key,count]) => ({
          key,
          probability:
            count /
            mc.simulations,
          count
        })
      )
      .sort(
        (a,b)=>
          b.probability -
          a.probability
      )
      .slice(0,10);


  const pace =
    analyzePace(
      model
    );


  const averageCoverage =
    average(
      model.map(
        h=>h.coverage
      )
    ) || 0;


  /*
     モデル信頼度

     これは「的中率」ではなく
     入力データがどれだけ揃っているか。
  */

  const confidence =
    clamp(
      0.45 +
      averageCoverage * 0.55,
      0,
      1
    );


  $("resultCard")
    .classList.remove("hidden");


  let html = "";


  /* =====================================================
     MODEL SUMMARY
     ===================================================== */

  html += `
    <div class="summary">

      <b>🤖 Ver.${MODEL_VERSION} 本格シミュレーション</b>

      <div style="margin-top:7px">

        <span class="pill">
          Monte Carlo ${SIMULATIONS.toLocaleString()}回
        </span>

        <span class="pill">
          ${esc(pace.scenario)}
        </span>

        <span class="pill">
          逃げ ${pace.escape}頭
        </span>

        <span class="pill">
          データ充足率 ${pct(averageCoverage)}
        </span>

      </div>

      <div class="note" style="margin-top:8px">

        現在は学習済みAIではなく、
        JRA同期データから独立特徴量を評価する
        ルールベース検証モデルです。

        <br>

        市場オッズへの依存を抑え、
        脚質・展開・斤量・馬体重・性齢などを
        組み合わせています。

      </div>

    </div>
  `;


  /* =====================================================
     PACE
     ===================================================== */

  html += `
    <h3>🏇 展開予測</h3>

    <div class="summary">

      <b>${esc(pace.scenario)}</b>

      <br>

      逃げ：
      ${pace.escape}頭

      ・

      先行・好位：
      ${pace.front}頭

      ・

      差し・追込：
      ${pace.closer}頭

      <div class="note" style="margin-top:7px">

        ※現段階では出馬表に存在する脚質情報を
        使用した簡易隊列モデルです。
        4角位置・過去走ラップが追加されれば
        さらに精密化できます。

      </div>

    </div>
  `;


  /* =====================================================
     MAIN TABLE
     ===================================================== */

  html += `
    <h3>📊 1着・2着・3着確率</h3>

    <div style="overflow-x:auto">

    <table>

      <thead>

        <tr>
          <th>順位</th>
          <th>馬</th>
          <th>1着</th>
          <th>2着</th>
          <th>3着</th>
          <th>3着内</th>
          <th>単勝</th>
          <th>EV</th>
        </tr>

      </thead>

      <tbody>

        ${
          horses
            .slice(0,12)
            .map(
              (h,i) => `

              <tr>

                <td>
                  <b>${i+1}</b>
                </td>

                <td>
                  <b>${horseLabel(h)}</b>
                </td>

                <td>
                  ${pct(h.win)}
                </td>

                <td>
                  ${pct(h.second)}
                </td>

                <td>
                  ${pct(h.third)}
                </td>

                <td>
                  ${pct(h.top3)}
                </td>

                <td>
                  ${h.odds > 0 ? h.odds : "-"}
                </td>

                <td>
                  ${
                    h.ev != null
                      ? h.ev.toFixed(2)
                      : "-"
                  }
                </td>

              </tr>

              `
            )
            .join("")
        }

      </tbody>

    </table>

    </div>
  `;


  /* =====================================================
     VALUE
     ===================================================== */

  const valueHorses =
    horses
      .filter(
        h =>
          h.ev != null &&
          h.ev >= 1.05
      )
      .sort(
        (a,b)=>
          b.ev-a.ev
      );


  html += `
    <h3>💰 単勝期待値</h3>
  `;


  if(valueHorses.length){

    html += `
      <div class="summary">

        ${
          valueHorses
            .slice(0,5)
            .map(
              h => `
                <span class="pill">
                  ${horseLabel(h)}
                  EV ${h.ev.toFixed(2)}
                </span>
              `
            )
            .join("")
        }

        <div class="note" style="margin-top:8px">

          EVが1.00を超える馬は、
          モデル上ではオッズに対して割安と判断。

          ただし現段階ではモデル自体が
          検証段階なので、
          「買うべき」という意味ではありません。

        </div>

      </div>
    `;

  }else{

    html += `
      <div class="note">

        現時点でモデルEV 1.05以上の馬は
        ありません。

      </div>
    `;

  }


  /* =====================================================
     TRIO
     ===================================================== */

  html += `
    <h3>🎯 3連複候補</h3>

    <div style="overflow-x:auto">

    <table>

      <thead>
        <tr>
          <th>順位</th>
          <th>組み合わせ</th>
          <th>確率</th>
        </tr>
      </thead>

      <tbody>

        ${
          trioList
            .slice(0,5)
            .map(
              (x,i) => `
                <tr>

                  <td>
                    ${i+1}
                  </td>

                  <td>
                    <b>
                      ${trioLabel(
                        x.key,
                        model
                      )}
                    </b>
                  </td>

                  <td>
                    ${pct(x.probability)}
                  </td>

                </tr>
              `
            )
            .join("")
        }

      </tbody>

    </table>

    </div>
  `;


  /* =====================================================
     TRIFECTA
     ===================================================== */

  html += `
    <h3>🎯 3連単候補</h3>

    <div style="overflow-x:auto">

    <table>

      <thead>
        <tr>
          <th>順位</th>
          <th>1着 → 2着 → 3着</th>
          <th>確率</th>
        </tr>
      </thead>

      <tbody>

        ${
          exactaList
            .slice(0,5)
            .map(
              (x,i) => `
                <tr>

                  <td>
                    ${i+1}
                  </td>

                  <td>
                    <b>
                      ${combinationLabel(
                        x.key,
                        model
                      )}
                    </b>
                  </td>

                  <td>
                    ${pct(x.probability)}
                  </td>

                </tr>
              `
            )
            .join("")
        }

      </tbody>

    </table>

    </div>
  `;


  /* =====================================================
     MODEL DETAILS
     ===================================================== */

  const top =
    horses[0];


  if(top){

    html += `
      <h3>🔎 本命馬のモデル内訳</h3>

      <div class="summary">

        <b>
          ${horseLabel(top)}
        </b>

        <table style="margin-top:7px">

          <tr>
            <td>市場評価</td>
            <td>${pct(top.marketProbability)}</td>
          </tr>

          <tr>
            <td>脚質補正</td>
            <td>${top.styleFactor.toFixed(3)}</td>
          </tr>

          <tr>
            <td>展開補正</td>
            <td>${top.paceFactor.toFixed(3)}</td>
          </tr>

          <tr>
            <td>斤量補正</td>
            <td>${top.weightFactor.toFixed(3)}</td>
          </tr>

          <tr>
            <td>馬体重補正</td>
            <td>${top.bodyFactor.toFixed(3)}</td>
          </tr>

          <tr>
            <td>性齢補正</td>
            <td>${top.ageFactor.toFixed(3)}</td>
          </tr>

          <tr>
            <td>人気補正</td>
            <td>${top.popularityFactor.toFixed(3)}</td>
          </tr>

        </table>

      </div>
    `;

  }


  /* =====================================================
     IMPORTANT NOTE
     ===================================================== */

  html += `
    <div class="note" style="margin-top:10px">

      <b>モデルについて</b>

      <br><br>

      ・市場オッズだけではなく独立特徴量を評価

      <br>

      ・脚質から逃げ争いとペースを推定

      <br>

      ・Monte Carlo ${SIMULATIONS.toLocaleString()}回で
      着順分布を推定

      <br>

      ・3連複は順不同、
      3連単は着順通りで集計

      <br>

      ・3連複/3連単の期待値は
      現在オッズデータがないため未計算

      <br><br>

      <b>
      信頼度 ${pct(confidence)}
      </b>

      <br>

      ※これは予想的中率ではなく、
      利用可能な入力データの充足度を表します。

    </div>
  `;


  $("result").innerHTML =
    html;


  $("resultCard")
    .scrollIntoView({
      behavior:"smooth"
    });


  return {
    horses,
    trioList,
    exactaList,
    pace,
    confidence
  };

}


/* =========================================================
   MAIN SIMULATION
   ========================================================= */

function simulate(){

  if(
    !state.horses.length
  ){

    return;

  }

  const horses =
    state.horses
      .map(normalizeHorse)
      .filter(
        h =>
          h.no > 0 &&
          h.name
      );

  if(horses.length < 3){

    $("resultCard")
      .classList.remove("hidden");

    $("result").innerHTML =
      `
      <div class="status err">
        シミュレーションには
        3頭以上の馬データが必要です。
      </div>
      `;

    return;

  }

  const model =
    buildModel(
      horses,
      state.selected || {}
    );

  const normalized =
    normalizeProbability(
      model
    );

  const mc =
    runMonteCarlo(
      normalized
    );

  state.analysis =
    renderSimulation(
      normalized,
      mc,
      state.selected
    );

}


/* =========================================================
   HISTORICAL BACKTEST
   ========================================================= */

function runHistoricalBacktest(){

  if(
    !state.selected ||
    !state.horses.length
  ){

    return;

  }

  const raw =
    state.horses
      .map(normalizeHorse)
      .filter(
        h =>
          h.finish != null
      );

  if(raw.length < 3){

    return;

  }

  const model =
    normalizeProbability(
      buildModel(
        raw,
        state.selected
      )
    );

  const predicted =
    model
      .slice()
      .sort(
        (a,b)=>b.win-a.win
      );

  const winner =
    raw.find(
      h =>
        Number(h.finish) === 1
    );

  if(!winner){

    return;

  }

  const p1 =
    predicted[0];

  const top3 =
    predicted
      .slice(0,3)
      .some(
        h=>h.no===winner.no
      );

  const top5 =
    predicted
      .slice(0,5)
      .some(
        h=>h.no===winner.no
      );

  $("resultCard")
    .classList.remove("hidden");

  $("result").innerHTML =
    `
    <div class="summary">

      <b>📊 Ver.${MODEL_VERSION} 個別バックテスト</b>

      <br><br>

      実際の1着：
      <b>
        ${winner.no}
        ${esc(winner.name)}
      </b>

      <br>

      モデル本命：
      <b>
        ${p1.no}
        ${esc(p1.name)}
      </b>

      <br><br>

      <span class="pill">
        本命1着：
        ${
          p1.no === winner.no
            ? "的中"
            : "不的中"
        }
      </span>

      <span class="pill">
        上位3頭：
        ${top3 ? "的中" : "不的中"}
      </span>

      <span class="pill">
        上位5頭：
        ${top5 ? "的中" : "不的中"}
      </span>

    </div>

    <h3>予測順位</h3>

    <div style="overflow-x:auto">

    <table>

      <thead>
        <tr>
          <th>順位</th>
          <th>馬</th>
          <th>モデル1着率</th>
          <th>実着順</th>
          <th>人気</th>
        </tr>
      </thead>

      <tbody>

        ${
          predicted
            .slice(0,10)
            .map(
              (h,i)=>`
              <tr>

                <td>${i+1}</td>

                <td>
                  <b>
                    ${h.no}
                    ${esc(h.name)}
                  </b>
                </td>

                <td>
                  ${pct(h.win)}
                </td>

                <td>
                  ${h.finish ?? "-"}
                </td>

                <td>
                  ${h.popularity ?? "-"}
                </td>

              </tr>
              `
            )
            .join("")
        }

      </tbody>

    </table>

    </div>

    <div class="note" style="margin-top:10px">

      このバックテストは
      「現在利用可能なデータだけ」で
      Ver.${MODEL_VERSION}モデルを再現したものです。

      <br>

      将来的には、
      過去走・コース適性・騎手・馬場・
      4角位置などを追加した
      本格的な時系列バックテストへ移行します。

    </div>
    `;

  $("resultCard")
    .scrollIntoView({
      behavior:"smooth"
    });

}


/* =========================================================
   LOAD SELECTED DATE
   ========================================================= */

async function loadSelectedDate(){

  const btn =
    $("loadBtn");

  if(btn){

    btn.disabled = true;

  }

  msg(
    '<span class="spinner"></span> JRA公式同期データを読み込み中…'
  );

  try{

    const d =
      $("date").value ||
      today();

    const todayIso =
      today();


    /* -----------------------------------------
       過去日
       ----------------------------------------- */

    if(d < todayIso){

      const h =
        await getHistory();

      if(
        h.date &&
        h.date !== d
      ){

        throw new Error(
          `過去データは${h.date}が同期されています。GitHub Actionsで${d.replaceAll("-","")}を指定して実行してください。`
        );

      }

      state.races =
        (h.races || [])
          .map(
            r => ({
              ...r,
              date:r.date || d,
              historical:true
            })
          );

      const venues =
        [
          ...new Set(
            state.races.map(
              r=>r.venue
            )
          )
        ];

      $("venue").innerHTML =
        venues
          .map(
            v =>
              `<option value="${esc(v)}">${esc(v)}</option>`
          )
          .join("");

      renderRaces();

      msg(
        `${d}：JRA公式の過去レース結果。${venues.join("・")}・${state.races.length}レース`,
        "ok"
      );

      return;

    }


    /* -----------------------------------------
       当日同期JSON
       ----------------------------------------- */

    const daily =
      await getDaily();

    if(
      Array.isArray(daily.races) &&
      daily.races.length &&
      d === daily.date
    ){

      state.races =
        daily.races.map(
          r => ({
            ...r,
            date:r.date || d
          })
        );

      const venues =
        [
          ...new Set(
            state.races.map(
              r=>r.venue
            )
          )
        ];

      $("venue").innerHTML =
        venues
          .map(
            v =>
              `<option value="${esc(v)}">${esc(v)}</option>`
          )
          .join("");

      renderRaces();

      msg(
        `${d}：JRA公式同期済み。${venues.join("・")}・${state.races.length}レース`,
        "ok"
      );

      return;

    }


    /* -----------------------------------------
       JRA calendar fallback
       ----------------------------------------- */

    const [y,m,day] =
      d.split("-");

    const url =
      `https://www.jra.go.jp/keiba/calendar${y}/${y}/${parseInt(m)}/${m}${day}.html`;

    const text =
      await jina(url);

    const races =
      parseCalendar(
        text,
        d
      );

    if(!races.length){

      throw new Error(
        "開催情報を解析できませんでした"
      );

    }

    state.races =
      races;

    const venues =
      [
        ...new Set(
          races.map(
            r=>r.venue
          )
        )
      ];

    $("venue").innerHTML =
      venues
        .map(
          v =>
            `<option value="${esc(v)}">${esc(v)}</option>`
        )
        .join("");

    renderRaces();

    msg(
      `${d}：開催日程を取得しました。出馬表は当日同期後に利用できます。`,
      "ok"
    );

  }catch(e){

    console.error(e);

    msg(
      `開催情報を取得できませんでした：${esc(e.message)}`,
      "err"
    );

  }finally{

    if(btn){

      btn.disabled = false;

    }

  }

}


/* =========================================================
   EVENT
   ========================================================= */

if($("venue")){

  $("venue").onchange =
    renderRaces;

}


if($("backBtn")){

  $("backBtn").onclick =
    () => {

      $("entryCard")
        ?.classList.add("hidden");

      $("resultCard")
        ?.classList.add("hidden");

    };

}


if($("simulateBtn")){

  $("simulateBtn").onclick =
    () => {

      if(
        state.selected?.historical
      ){

        runHistoricalBacktest();

      }else{

        simulate();

      }

    };

}


if($("loadBtn")){

  $("loadBtn").onclick =
    loadSelectedDate;

}


/* =========================================================
   DEBUG
   ========================================================= */

window.KeibaSimulator = {

  version:MODEL_VERSION,

  state,

  simulate,

  runHistoricalBacktest,

  analyzePace,

  buildModel,

  runMonteCarlo

};


/* =========================================================
   INITIAL MESSAGE
   ========================================================= */

msg(
  `Ver.${MODEL_VERSION}：JRA公式同期データを利用します。`
);


/* =========================================================
   END
   ========================================================= */
