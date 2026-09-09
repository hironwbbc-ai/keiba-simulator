/* =========================================================
   競馬シミュレーター Ver.12.5
   JRA公式同期JSON → 出馬表 → 予測 → Monte Carlo
   → 個別バックテスト → 36レース比較
   ---------------------------------------------------------
   方針：
   ・存在しないデータは推測しない
   ・確定後データを発走前予測に混ぜない
   ・バックテストでは「発走前に確定している情報」を優先
   ・学習済みAIではなく、ルールベースの検証モデル
   ========================================================= */

"use strict";

const $ = id => document.getElementById(id);

const MODEL_VERSION = "12.5";
const SIMULATIONS = 10000;

const VENUES = {
  "札幌":"01","函館":"02","福島":"03","新潟":"04","東京":"05",
  "中山":"06","中京":"07","京都":"08","阪神":"09","小倉":"10"
};

const state = {
  daily:null,
  history:null,
  races:[],
  horses:[],
  selected:null,
  analysis:null
};

/* -------------------- utility -------------------- */

function esc(v){
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}


function horseLabel(name,no=null){
  const raw=String(name ?? "");
  const blinker=/ブリンカー着用\s*$/.test(raw);
  const clean=raw.replace(/ブリンカー着用\s*$/,"").trim();
  const badge=blinker
    ? ' <span style="display:inline-flex;align-items:center;justify-content:center;width:1.35em;height:1.35em;border:1px solid currentColor;border-radius:50%;font-size:.78em;font-weight:700;line-height:1;vertical-align:middle;margin-left:.25em" title="ブリンカー着用">B</span>'
    : "";
  return `${no==null?"":esc(no)+" "}${esc(clean)}${badge}`;
}

function num(v){
  if(v===null || v===undefined || v==="") return null;
  const n = Number(String(v).replace(/[^\d.+-]/g,""));
  return Number.isFinite(n) ? n : null;
}

function today(){
  return new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date()).replace(/\//g,"-");
}

function msg(text, cls=""){
  if($("status")){
    $("status").innerHTML=text;
    $("status").className="status "+cls;
  }
}

async function getJSON(path){
  const r=await fetch(path+"?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error(path+" を取得できませんでした");
  return r.json();
}

async function getDaily(){
  if(!state.daily) state.daily=await getJSON("./data/jra_daily.json");
  return state.daily;
}

async function getHistory(){
  if(!state.history) state.history=await getJSON("./data/jra_history.json");
  return state.history;
}

/* -------------------- data normalization -------------------- */

function normalizeHorse(h, extra={}){
  return {
    no:Number(h.no ?? h.number ?? h.horse_no ?? 0),
    name:h.name ?? h.horse_name ?? h.horseName ?? "",
    odds:num(h.odds),
    popularity:num(h.popularity ?? h.odds_rank ?? h.rank),
    bodyWeight:num(h.bodyWeight ?? h.body_weight ?? h.weight),
    bodyWeightDiff:num(h.bodyWeightDiff ?? h.body_weight_diff),
    sexAge:h.sexAge ?? h.sex_age ?? "",
    carriedWeight:num(h.carriedWeight ?? h.carried_weight ?? h.weight_carried),
    jockey:h.jockey ?? "",
    frame:num(h.frame ?? h.frame_no ?? h.waku ?? extra.frame),
    style:h.style ?? "不明",
    finish:num(h.finish ?? h.result ?? h.place ?? extra.finish),
    recent:h.recent ?? h.lastRuns ?? [],
    courseStats:h.courseStats ?? h.course_stats ?? null,
    jockeyStats:h.jockeyStats ?? h.jockey_stats ?? null,
    corner4:num(h.corner4 ?? h.corner_4),
    ...extra
  };
}

/* -------------------- calendar -------------------- */

function buildRaceList(daily, history){
  const out=[];
  const histMap=new Map();

  for(const r of (history?.races||[])){
    histMap.set(`${r.venue}-${r.no}`,r);
  }

  for(const r of (daily?.races||[])){
    const venue=r.venue || codeToVenue(r.venue_code);
    const no=Number(r.no ?? r.race_number);
    const h=histMap.get(`${venue}-${no}`);
    out.push({
      ...r,
      venue,no,
      date:r.date || daily.date,
      name:(r.name && r.name!=="本文へ移動する") ? r.name : (h?.name || `第${no}レース`),
      time:r.time || h?.time || "",
      surface:r.surface || h?.surface || "",
      distance:r.distance || h?.distance || null,
      course:r.course || h?.course || "",
      historical:!!h,
      history:h || null
    });
  }

  // historyにしか存在しないレースも表示
  for(const r of (history?.races||[])){
    const key=`${r.venue}-${r.no}`;
    if(!out.some(x=>`${x.venue}-${x.no}`===key)){
      out.push({...r,historical:true});
    }
  }

  return out.sort((a,b)=>{
    const va=VENUES[a.venue]||"99", vb=VENUES[b.venue]||"99";
    return va.localeCompare(vb) || Number(a.no)-Number(b.no);
  });
}

function codeToVenue(code){
  return Object.keys(VENUES).find(k=>VENUES[k]===String(code)) || "";
}

/* -------------------- render races -------------------- */

function renderRaces(){
  const box=$("races");
  if(!box) return;

  const venue=$("venue")?.value || "";
  const list=state.races.filter(r=>!venue || r.venue===venue);

  if(!list.length){
    box.innerHTML='<div class="note">該当するレースがありません。</div>';
    return;
  }

  box.innerHTML=list.map(r=>`
    <div class="race-row">
      <div>
        <b>${esc(r.venue)} ${r.no}R</b>
        <span>${esc(r.name||"レース")}</span>
        <div class="small">${esc(r.time||"")} ${r.historical?"・結果済み":""}</div>
      </div>
      <button data-race="${esc(r.venue)}|${r.no}">
        ${r.historical?"結果・バックテスト":"出馬表"}
      </button>
    </div>
  `).join("");

  box.querySelectorAll("button[data-race]").forEach(b=>{
    b.onclick=()=>{
      const [venue,no]=b.dataset.race.split("|");
      const r=state.races.find(x=>x.venue===venue && Number(x.no)===Number(no));
      if(r) selectRace(r);
    };
  });
}

/* -------------------- entry -------------------- */

async function selectRace(r){
  state.selected=r;
  state.horses=[];
  $("entryCard")?.classList.remove("hidden");
  $("resultCard")?.classList.add("hidden");
  $("raceInfo").innerHTML=`<b>${esc(r.venue)} ${r.no}R ${esc(r.name||"")}</b>
    <br><span class="small">${esc(r.date||"")} ${esc(r.time||"")}
    ・${esc(r.surface||"")} ${r.distance?esc(r.distance)+"m":""}
    ${r.course?"・"+esc(r.course):""}</span>`;
  $("horses").innerHTML='<div class="status"><span class="spinner"></span> データを読み込み中…</div>';

  const daily=await getDaily();
  const history=await getHistory();

  const dr=(daily.races||[]).find(x=>
    (x.venue||codeToVenue(x.venue_code))===r.venue &&
    Number(x.no ?? x.race_number)===Number(r.no)
  );
  const hr=(history.races||[]).find(x=>
    x.venue===r.venue && Number(x.no)===Number(r.no)
  );

  const hmap=new Map((hr?.horses||[]).map(h=>[Number(h.no),h]));
  const source=(dr?.horses?.length ? dr.horses : hr?.horses||[]);

  state.horses=source.map(h=>{
    const no=Number(h.no ?? h.number);
    const old=hmap.get(no)||{};
    return normalizeHorse(h,{
      frame:num(h.frame ?? old.frame),
      finish:num(old.finish),
      // 過去確定値は「結果表示・バックテスト」用にのみ保持
      historicalFinish:num(old.finish)
    });
  });

  state.selected={...r,...dr,...hr};
  renderHorses();
}

function renderHorses(){
  const hs=state.horses.slice().sort((a,b)=>a.no-b.no);
  $("horses").innerHTML=`
    <div class="small">${hs.length}頭・JRA公式同期データ</div>
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th>枠</th><th>馬番</th><th>馬名</th><th>人気</th><th>オッズ</th>
        <th>斤量</th><th>馬体重</th><th>増減</th><th>騎手</th>
      </tr></thead>
      <tbody>
      ${hs.map(h=>`<tr>
        <td>${h.frame??"—"}</td>
        <td><b>${h.no}</b></td>
        <td>${horseLabel(h.name)}</td>
        <td>${h.popularity??"—"}</td>
        <td>${h.odds??"—"}</td>
        <td>${h.carriedWeight??"—"}</td>
        <td>${h.bodyWeight??"—"}</td>
        <td>${h.bodyWeightDiff==null?"—":(h.bodyWeightDiff>0?"+":"")+h.bodyWeightDiff}</td>
        <td>${esc(h.jockey)}</td>
      </tr>`).join("")}
      </tbody>
    </table></div>`;
}

/* -------------------- model -------------------- */

function parseAge(sexAge){
  const m=String(sexAge||"").match(/(\d+)/);
  return m?Number(m[1]):null;
}

function recentFormFactor(recent){
  if(!Array.isArray(recent) || !recent.length) return {factor:1, count:0};

  const finishes=recent.map(x=>{
    if(typeof x === "number") return x;
    if(typeof x === "string" && x.trim()!=="") return num(x);
    if(x && typeof x === "object") return num(
      x.finish ?? x.result ?? x.place ?? x.rank ?? x着順
    );
    return null;
  }).filter(x=>Number.isFinite(x) && x>0);

  if(!finishes.length) return {factor:1, count:0};

  // 直近5走まで。過去結果そのものではなく、発走前に取得済みの近走情報だけを利用。
  const last=finishes.slice(-5);
  const avg=last.reduce((a,x)=>a+x,0)/last.length;
  const score=Math.max(0,Math.min(1,(10-avg)/9));
  // 近走補正は弱く設定し、市場オッズを大きく上書きしない。
  const factor=0.97 + score*0.06;
  return {factor,count:last.length};
}

function styleFactor(style, pace){
  if(!style || style==="不明") return 1;
  const s=String(style);
  if(pace==="ハイ"){
    if(s.includes("追込")||s.includes("差し")) return 1.06;
    if(s.includes("逃げ")) return .96;
    return 1.00;
  }
  if(pace==="スロー"){
    if(s.includes("逃げ")||s.includes("先行")) return 1.05;
    if(s.includes("追込")) return .97;
  }
  return 1;
}

function inferPace(horses){
  const styles=horses.map(h=>h.style).filter(x=>x && x!=="不明");
  const escapers=styles.filter(x=>String(x).includes("逃げ")).length;
  const front=styles.filter(x=>String(x).includes("先行")).length;
  if(escapers>=4) return {label:"ハイ",escapers,front};
  if(escapers>=3) return {label:"ややハイ",escapers,front};
  if(escapers<=1 && front<=3) return {label:"スロー",escapers,front};
  return {label:"標準",escapers,front};
}

function rankScore(v, reverse=false){
  const vals=v.filter(x=>Number.isFinite(x));
  if(!vals.length) return new Map();
  const sorted=[...vals].sort((a,b)=>reverse?b-a:a-b);
  const m=new Map();
  for(let i=0;i<sorted.length;i++){
    const x=sorted[i];
    if(!m.has(x)) m.set(x,1-i/(Math.max(1,sorted.length-1)));
  }
  return m;
}

function buildModel(rawHorses){
  const horses=rawHorses.map(normalizeHorse);
  const pace=inferPace(horses);

  const odds=horses.map(h=>h.odds).filter(x=>x>0);
  const minOdds=Math.min(...odds);
  const maxOdds=Math.max(...odds);
  const popVals=horses.map(h=>h.popularity).filter(x=>x>0);
  const medWeight=median(horses.map(h=>h.carriedWeight).filter(x=>x!=null));
  const medBody=median(horses.map(h=>h.bodyWeight).filter(x=>x!=null));

  const rows=horses.map(h=>{
    // 市場：オッズがある場合は逆数。バックテストでも「最終オッズ」である点を明示。
    const marketRaw=h.odds>0 ? 1/h.odds : 0;
    const market=marketRaw;

    const pop=h.popularity>0 ? 1/Math.sqrt(h.popularity) : 0;
    const style=styleFactor(h.style,pace.label);
    const recentForm=recentFormFactor(h.recent);
    const recentFactor=recentForm.factor;

    let weightFactor=1;
    if(h.carriedWeight!=null && medWeight!=null){
      weightFactor=1 + Math.max(-0.04,Math.min(0.04,(medWeight-h.carriedWeight)*0.012));
    }

    let bodyFactor=1;
    if(h.bodyWeight!=null && medBody!=null){
      const d=Math.abs(h.bodyWeight-medBody);
      bodyFactor=1-Math.min(.025,d/10000);
    }

    const age=parseAge(h.sexAge);
    let ageFactor=1;
    if(age!=null){
      if(age===3) ageFactor=1.015;
      else if(age===4) ageFactor=1.01;
      else if(age>=7) ageFactor=.985;
    }

    const frameFactor=h.frame==null?1:1+((4-h.frame)/100);
    const popularityFactor=pop>0 ? Math.pow(pop,.12) : 1;

    // 独立補正は弱く、オッズへの過剰依存を避ける
    const independent=
      Math.pow(style,.22)*
      Math.pow(recentFactor,.14)*
      Math.pow(weightFactor,.16)*
      Math.pow(bodyFactor,.10)*
      Math.pow(ageFactor,.08)*
      Math.pow(frameFactor,.08)*
      Math.pow(popularityFactor,.08);

    const raw=Math.pow(Math.max(market,1e-9),.72)*independent;
    return {
      ...h,
      score:raw,
      marketScore:market,
      independentScore:independent,
      components:{
        market:market,
        style,
        recent:recentFactor,
        recentCount:recentForm.count,
        carriedWeight:weightFactor,
        bodyWeight:bodyFactor,
        sexAge:ageFactor,
        frame:frameFactor,
        popularity:popularityFactor
      }
    };
  });

  const sum=rows.reduce((a,h)=>a+h.score,0)||1;
  rows.forEach(h=>h.prob=h.score/sum);

  return {
    horses:rows.sort((a,b)=>b.prob-a.prob),
    pace,
    dataCoverage:coverage(rows)
  };
}

function median(a){
  if(!a.length) return null;
  const x=[...a].sort((a,b)=>a-b);
  const m=Math.floor(x.length/2);
  return x.length%2?x[m]:(x[m-1]+x[m])/2;
}

function coverage(horses){
  const fields=["odds","popularity","bodyWeight","bodyWeightDiff","sexAge","carriedWeight","jockey"];
  let have=0,total=horses.length*fields.length;
  for(const h of horses) for(const f of fields){
    if(h[f]!==null && h[f]!==undefined && h[f]!=="") have++;
  }
  return total?have/total:0;
}

/* -------------------- Monte Carlo -------------------- */

function weightedPick(pool){
  const total=pool.reduce((s,h)=>s+Math.max(h.prob,1e-12),0);
  let x=Math.random()*total;
  for(let i=0;i<pool.length;i++){
    x-=Math.max(pool[i].prob,1e-12);
    if(x<=0) return i;
  }
  return pool.length-1;
}

function runMonteCarlo(horses,n=SIMULATIONS){
  const one=new Map(),two=new Map(),three=new Map(),top3=new Map();
  const trio=new Map(),trifecta=new Map();

  for(const h of horses){
    one.set(h.no,0);two.set(h.no,0);three.set(h.no,0);top3.set(h.no,0);
  }

  for(let s=0;s<n;s++){
    const pool=horses.slice();
    const order=[];
    while(pool.length){
      const i=weightedPick(pool);
      order.push(pool[i]);
      pool.splice(i,1);
      if(order.length===3) break;
    }

    if(!order[0]) continue;
    one.set(order[0].no,(one.get(order[0].no)||0)+1);
    if(order[1]) two.set(order[1].no,(two.get(order[1].no)||0)+1);
    if(order[2]) three.set(order[2].no,(three.get(order[2].no)||0)+1);

    const ns=order.slice(0,3).map(h=>h.no).sort((a,b)=>a-b);
    ns.forEach(no=>top3.set(no,(top3.get(no)||0)+1));

    if(ns.length===3){
      const tk=ns.join("-");
      trio.set(tk,(trio.get(tk)||0)+1);
      const fk=order.slice(0,3).map(h=>h.no).join("-");
      trifecta.set(fk,(trifecta.get(fk)||0)+1);
    }
  }

  return {one,two,three,top3,trio,trifecta,n};
}

/* -------------------- simulation render -------------------- */

function simulate(){
  if(!state.horses.length) return;

  const model=buildModel(state.horses);
  const mc=runMonteCarlo(model.horses,SIMULATIONS);

  const rows=model.horses.map(h=>{
    const p1=(mc.one.get(h.no)||0)/mc.n;
    const p2=(mc.two.get(h.no)||0)/mc.n;
    const p3=(mc.three.get(h.no)||0)/mc.n;
    const pTop3=(mc.top3.get(h.no)||0)/mc.n;
    const ev=h.odds ? p1*h.odds : null;
    return {...h,p1,p2,p3,pTop3,ev};
  }).sort((a,b)=>b.p1-a.p1);

  state.analysis={model,mc,rows};

  const trio=[...mc.trio.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  const trif=[...mc.trifecta.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);

  $("resultCard")?.classList.remove("hidden");
  $("result").innerHTML=`
    <div class="result-head">
      <b>📊 Ver.${MODEL_VERSION} 本格シミュレーション</b>
      <span>Monte Carlo ${mc.n.toLocaleString()}回</span>
    </div>

    <div class="stats">
      <div><b>想定ペース</b><strong>${esc(model.pace.label)}</strong></div>
      <div><b>逃げ候補</b><strong>${model.pace.escapers}頭</strong></div>
      <div><b>データ充足率</b><strong>${(model.dataCoverage*100).toFixed(1)}%</strong></div>
    </div>

    <div class="note warning">
      現在のJRA同期JSONでは近走・コース適性・騎手成績・4角位置等が
      十分に取得できないため、それらを勝手に補完していません。
      そのため現行モデルは市場情報を中心とした検証版です。
    </div>

    <h3>予測順位</h3>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>順位</th><th>馬</th><th>1着</th><th>2着</th><th>3着</th>
        <th>3着内</th><th>単勝</th><th>EV</th>
      </tr></thead>
      <tbody>${rows.map((h,i)=>`
        <tr>
          <td>${i+1}</td>
          <td><b>${horseLabel(h.name,h.no)}</b></td>
          <td>${pct(h.p1)}</td><td>${pct(h.p2)}</td><td>${pct(h.p3)}</td>
          <td>${pct(h.pTop3)}</td>
          <td>${h.odds??"—"}</td>
          <td>${h.ev==null?"—":h.ev.toFixed(2)}</td>
        </tr>`).join("")}</tbody>
    </table></div>

    <h3>単勝EV 1.00以上</h3>
    <div>${rows.filter(h=>h.ev!=null && h.ev>=1)
      .sort((a,b)=>b.ev-a.ev).slice(0,8)
      .map(h=>`<div class="pick">${horseLabel(h.name,h.no)}：EV ${h.ev.toFixed(2)}・1着 ${pct(h.p1)}</div>`)
      .join("") || '<div class="small">該当馬なし</div>'}</div>

    <h3>3連複候補</h3>
    <div>${trio.map(([k,v],i)=>`
      <div class="pick">${i+1}. ${k.split("-").map(no=>horseName(no,rows)).join(" - ")}
      <b>${pct(v/mc.n)}</b></div>`).join("") || '<div class="small">候補なし</div>'}</div>

    <h3>3連単候補</h3>
    <div>${trif.map(([k,v],i)=>`
      <div class="pick">${i+1}. ${k.split("-").map(no=>horseName(no,rows)).join(" → ")}
      <b>${pct(v/mc.n)}</b></div>`).join("") || '<div class="small">候補なし</div>'}</div>

    <h3>モデル構成</h3>
    <div class="small">
      市場情報を中心に、脚質・ペース・斤量・馬体重・性齢・枠順を
      利用可能な範囲で補正しています。存在しない近走・適性データは推測していません。
    </div>
  `;
}

function pct(x){ return (x*100).toFixed(1)+"%"; }

function horseName(no,rows){
  const h=rows.find(x=>x.no===Number(no));
  return h?horseLabel(h.name,h.no):String(no);
}

/* -------------------- historical backtest -------------------- */

function makeBacktestRace(histRace){
  // バックテストはJRA公式の過去レース結果を母集団とする。
  // 着順・4角位置は評価専用として保持し、モデル入力には渡さない。
  const source=histRace?.horses||[];
  return source.map(h=>{
    return normalizeHorse(h,{
      frame:num(h.frame), // 枠順は発走前に確定するため利用可能
      finish:null,
      corner4:null,
      historicalFinish:num(h.finish)
    });
  });
}

function backtestOne(histRace){
  const horses=makeBacktestRace(histRace);
  if(horses.length<2) return null;
  const model=buildModel(horses);
  const ranking=model.horses;
  const winner=horses.find(h=>Number(h.historicalFinish)===1);
  if(!winner) return null;

  const pos=ranking.findIndex(h=>h.no===winner.no)+1;
  return {
    winner,
    ranking,
    winnerRank:pos,
    top1:ranking[0]?.no===winner.no,
    top3:ranking.slice(0,3).some(h=>h.no===winner.no),
    top5:ranking.slice(0,5).some(h=>h.no===winner.no),
    favorite1:(horses.slice().sort((a,b)=>(a.popularity||999)-(b.popularity||999))[0]?.no===winner.no),
    favorite3:(horses.slice().sort((a,b)=>(a.popularity||999)-(b.popularity||999)).slice(0,3).some(h=>h.no===winner.no)),
    favorite5:(horses.slice().sort((a,b)=>(a.popularity||999)-(b.popularity||999)).slice(0,5).some(h=>h.no===winner.no))
  };
}

async function runBulkBacktest(){
  const out=$("bulkBacktestResult");
  if(!out) return;
  out.innerHTML='<div class="status"><span class="spinner"></span> 履歴レースを評価中…</div>';

  try{
    const history=await getHistory();
    const targetDate=$("date")?.value || history.date || "";
    const historyDate=history.date || "";

    if(historyDate && targetDate && historyDate!==targetDate){
      throw new Error(`バックテスト対象日と履歴データの日付が一致しません。対象=${targetDate} / 履歴=${historyDate}`);
    }

    // 一括バックテストはdailyではなくhistory.racesを直接評価する。
    // dailyは「当日の公開済みレース一覧」であり、過去レース36Rの母集団ではない。
    const sourceRaces=(history.races||[])
      .filter(r=>!targetDate || String(r.date||historyDate)===targetDate);

    const results=[];
    for(const hr of sourceRaces){
      const venue=hr.venue || codeToVenue(hr.venue_code);
      const no=Number(hr.no ?? hr.race_number);
      if(!venue || !Number.isFinite(no)) continue;
      const r=backtestOne(hr);
      if(r) results.push({...r,venue,no,date:hr.date||historyDate});
    }

    if(!results.length){
      throw new Error(`${targetDate||"指定日"}のバックテスト対象レースがhistoryにありません。`);
    }

    const n=results.length||1;
    const mTop1=results.filter(r=>r.top1).length;
    const mTop3=results.filter(r=>r.top3).length;
    const mTop5=results.filter(r=>r.top5).length;
    const fTop1=results.filter(r=>r.favorite1).length;
    const fTop3=results.filter(r=>r.favorite3).length;
    const fTop5=results.filter(r=>r.favorite5).length;

    const avgRank=results.reduce((s,r)=>s+r.winnerRank,0)/n;
    const recentApplied=results.reduce((s,r)=>s+r.ranking.filter(h=>Number(h.components?.recentCount)>0).length,0);
    const recentPossible=results.reduce((s,r)=>s+r.ranking.length,0);

    const venueRows={};
    for(const r of results){
      if(!venueRows[r.venue]) venueRows[r.venue]={n:0,top1:0,top3:0,top5:0};
      venueRows[r.venue].n++;
      venueRows[r.venue].top1+=r.top1?1:0;
      venueRows[r.venue].top3+=r.top3?1:0;
      venueRows[r.venue].top5+=r.top5?1:0;
    }

    // 「人気以上に評価」は、人気順位よりモデル順位が上であることを厳密に判定。
    // 同順位やモデルの方が低評価の馬は除外する。
    const longshots=results.filter(r=>{
      const pop=Number(r.winner.popularity);
      const rank=Number(r.winnerRank);
      return Number.isFinite(pop) && Number.isFinite(rank) && pop>=6 && rank<pop;
    }).sort((a,b)=>{
      const da=Number(a.winner.popularity)-Number(a.winnerRank);
      const db=Number(b.winner.popularity)-Number(b.winnerRank);
      return db-da || Number(b.winner.popularity)-Number(a.winner.popularity);
    });

    out.innerHTML=`
      <div class="result-head">
        <b>📊 Ver.${MODEL_VERSION} 一括バックテスト</b>
        <span>${results.length}レース</span>
      </div>

      <div class="note warning">
        このバックテストは、JRA公式のhistoryデータに保存された対象日の過去レースを評価します。
        dailyの公開済みレース数には依存しません。
        直近5走はhistoryに実データが存在する馬だけに適用し、存在しない場合は補正しません。
        今回のデータで近走補正が適用された馬：${recentApplied}/${recentPossible}頭。
        単勝オッズは同期JSONに保存された値であり、現状は最終オッズを利用しています。
        よって「完全な発走前時系列バックテスト」ではありません。
        着順・4角位置などの結果情報は評価専用で、モデル入力には使用していません。
      </div>

      <div class="compare-grid">
        <div class="metric-card"><b>本命1着</b><strong>${pct(mTop1/n)}</strong><small>モデル ${mTop1}/${n}</small></div>
        <div class="metric-card"><b>上位3頭</b><strong>${pct(mTop3/n)}</strong><small>モデル ${mTop3}/${n}</small></div>
        <div class="metric-card"><b>上位5頭</b><strong>${pct(mTop5/n)}</strong><small>モデル ${mTop5}/${n}</small></div>
        <div class="metric-card"><b>勝ち馬平均順位</b><strong>${avgRank.toFixed(2)}位</strong><small>モデル順位</small></div>
      </div>

      <h3>最終人気 vs Ver.${MODEL_VERSION}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>評価</th><th>最終人気</th><th>Ver.${MODEL_VERSION}</th><th>差</th></tr></thead>
        <tbody>
          <tr><td>本命1着率</td><td>${pct(fTop1/n)}</td><td>${pct(mTop1/n)}</td><td>${pct(mTop1/n-fTop1/n)}</td></tr>
          <tr><td>上位3頭</td><td>${pct(fTop3/n)}</td><td>${pct(mTop3/n)}</td><td>${pct(mTop3/n-fTop3/n)}</td></tr>
          <tr><td>上位5頭</td><td>${pct(fTop5/n)}</td><td>${pct(mTop5/n)}</td><td>${pct(mTop5/n-fTop5/n)}</td></tr>
        </tbody>
      </table></div>

      <h3>開催場別</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>開催</th><th>レース</th><th>本命1着</th><th>上位3</th><th>上位5</th></tr></thead>
        <tbody>${Object.entries(venueRows).map(([v,x])=>`
          <tr><td>${esc(v)}</td><td>${x.n}</td><td>${pct(x.top1/x.n)}</td><td>${pct(x.top3/x.n)}</td><td>${pct(x.top5/x.n)}</td></tr>
        `).join("")}</tbody>
      </table></div>

      <h3>🎯 モデルが人気以上に評価した勝ち馬</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>開催</th><th>R</th><th>馬</th><th>人気</th><th>モデル順位</th></tr></thead>
        <tbody>${longshots.slice(0,20).map(r=>`
          <tr><td>${esc(r.venue)}</td><td>${r.no}R</td><td>${horseLabel(r.winner.name,r.winner.no)}</td>
          <td>${r.winner.popularity??"—"}</td><td>${r.winnerRank}位</td></tr>
        `).join("") || '<tr><td colspan="5">該当なし</td></tr>'}</tbody>
      </table></div>

      <h3>レース別結果</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>開催</th><th>R</th><th>勝ち馬</th><th>人気</th><th>モデル順位</th><th>本命</th><th>上位3</th><th>上位5</th></tr></thead>
        <tbody>${results.map(r=>`
          <tr>
            <td>${esc(r.venue)}</td><td>${r.no}R</td>
            <td>${horseLabel(r.winner.name,r.winner.no)}</td>
            <td>${r.winner.popularity??"—"}</td><td>${r.winnerRank}</td>
            <td>${r.top1?"○":"—"}</td><td>${r.top3?"○":"—"}</td><td>${r.top5?"○":"—"}</td>
          </tr>`).join("")}</tbody>
      </table></div>
    `;

  }catch(e){
    out.innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}

/* -------------------- init -------------------- */

async function loadRaces(){
  const date=$("date")?.value || today();
  msg("JRA公式同期JSONを読み込み中…");

  try{
    const daily=await getDaily();
    const history=await getHistory();
    if(daily.date && daily.date!==date){
      msg(`同期データは ${esc(daily.date)} です。指定日は ${esc(date)} です。`,"warn");
    }
    state.races=buildRaceList(daily,history);
    renderRaces();

    const venues=[...new Set(state.races.map(r=>r.venue).filter(Boolean))];
    const sel=$("venue");
    if(sel){
      sel.innerHTML='<option value="">全開催</option>'+venues.map(v=>`<option>${esc(v)}</option>`).join("");
    }

    $("officialProgramStatus").innerHTML=
      `同期日時：${esc(daily.updated_at||"不明")}<br>
       公式レースリンク：${daily.official_race_links?.length||0}件<br>
       データパーサー：${esc(daily.parser_version||"不明")}`;

    msg(`${date}：JRA公式同期データ。${venues.join("・")}・${state.races.length}レース`,"ok");
  }catch(e){
    msg(esc(e.message),"err");
  }
}

if($("date")) $("date").value=today();

$("loadBtn")?.addEventListener("click",loadRaces);
$("venue")?.addEventListener("change",renderRaces);
$("simulateBtn")?.addEventListener("click",simulate);
$("backBtn")?.addEventListener("click",()=>{
  $("entryCard")?.classList.add("hidden");
  $("resultCard")?.classList.add("hidden");
});
$("runBulkBacktest")?.addEventListener("click",runBulkBacktest);

window.KeibaSimulator={
  version:MODEL_VERSION,
  state,
  buildModel,
  runMonteCarlo,
  backtestOne,
  runBulkBacktest,
  simulate
};

loadRaces();
