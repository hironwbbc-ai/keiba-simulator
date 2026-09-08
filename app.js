/* =========================================================
   競馬シミュレーター Ver.12.0
   ---------------------------------------------------------
   JRA公式同期JSON
   → 出馬表
   → 発走前情報だけを使うルールベースモデル
   → 展開・脚質
   → Monte Carlo 10,000回
   → 1着/2着/3着/3着内率
   → 単勝EV
   → 3連複/3連単候補
   → 個別バックテスト
   → 人気ベンチマーク vs モデル一括比較

   重要：
   確定後の「着順」は予測スコアには絶対に使用しない。
   歴史バックテストでは finish を評価専用にする。
   ========================================================= */

"use strict";

const $ = id => document.getElementById(id);
const MODEL_VERSION = "12.0";
const SIMULATIONS = 10000;

const VENUES = {
  "札幌":"01","函館":"02","福島":"03","新潟":"04","東京":"05",
  "中山":"06","中京":"07","京都":"08","阪神":"09","小倉":"10"
};

const VENUE_NAMES = {
  "01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京",
  "06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"
};

const state = {
  daily:null,
  history:null,
  races:[],
  horses:[],
  selected:null,
  result:null
};

const WEIGHTS = {
  market:0.32,
  style:0.14,
  pace:0.14,
  frame:0.06,
  carriedWeight:0.10,
  bodyWeight:0.07,
  bodyWeightDiff:0.05,
  sexAge:0.04,
  jockey:0.03,
  coverage:0.05
};

function esc(v){
  return String(v ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

function num(v){
  if(v===null || v===undefined || v==="") return null;
  const n = Number(String(v).replace(/[^\d.+-]/g,""));
  return Number.isFinite(n) ? n : null;
}

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

function avg(xs){
  const a = xs.filter(Number.isFinite);
  return a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
}

function pct(v){
  return `${(Number(v||0)*100).toFixed(1)}%`;
}

function today(){
  return new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date()).replace(/\//g,"-");
}

function msg(text,cls=""){
  if(!$("status")) return;
  $("status").innerHTML=text;
  $("status").className="status "+cls;
}

async function getDaily(){
  if(state.daily) return state.daily;
  const r=await fetch("./data/jra_daily.json?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error("jra_daily.jsonを取得できません。");
  state.daily=await r.json();
  return state.daily;
}

async function getHistory(){
  if(state.history) return state.history;
  const r=await fetch("./data/jra_history.json?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error("jra_history.jsonを取得できません。");
  state.history=await r.json();
  return state.history;
}

function normalizeHorse(h){
  return {
    no:num(h.no ?? h.number ?? h.horse_no) ?? 0,
    name:h.name ?? h.horse_name ?? h.horseName ?? "不明",
    odds:num(h.odds),
    popularity:num(h.popularity ?? h.odds_rank ?? h.rank),
    frame:num(h.frame ?? h.frame_no ?? h.waku),
    bodyWeight:num(h.bodyWeight ?? h.body_weight),
    bodyWeightDiff:num(h.bodyWeightDiff ?? h.body_weight_diff),
    sexAge:h.sexAge ?? h.sex_age ?? "",
    carriedWeight:num(h.carriedWeight ?? h.carried_weight ?? h.weight_carried),
    jockey:h.jockey ?? "",
    style:h.style ?? "不明",
    recent:h.recent ?? h.lastRuns ?? h.pastRuns ?? [],
    courseStats:h.courseStats ?? h.course_stats ?? null,
    jockeyStats:h.jockeyStats ?? h.jockey_stats ?? null,
    corner4:num(h.corner4 ?? h.corner_4),
    finish:num(h.finish ?? h.result ?? h.place),
    win:null,second:null,third:null,top3:null,ev:null,rawScore:null,
    components:{}
  };
}

/* ---------- 脚質・展開 ---------- */

function styleClass(h){
  const s=String(h.style||"");
  if(/逃げ/.test(s)) return "逃げ";
  if(/先行|好位/.test(s)) return "先行";
  if(/差し/.test(s)) return "差し";
  if(/追込/.test(s)) return "追込";
  return "不明";
}

function inferStyleFromData(h){
  if(h.style && h.style!=="不明") return h.style;
  const recent = Array.isArray(h.recent) ? h.recent : [];
  const positions=[];
  for(const x of recent){
    if(typeof x==="number") positions.push(x);
    else{
      const m=String(x).match(/(?:4角|通過|位置)[^\d]*(\d+)/);
      if(m) positions.push(Number(m[1]));
    }
  }
  const a=avg(positions);
  if(a===null) return "不明";
  if(a<=3) return "逃げ";
  if(a<=6) return "先行";
  if(a<=10) return "差し";
  return "追込";
}

function paceAnalysis(horses){
  const classes=horses.map(inferStyleFromData);
  const escape=classes.filter(x=>x==="逃げ").length;
  const front=classes.filter(x=>x==="先行").length;
  let pace="標準";
  if(escape>=4) pace="ハイ";
  else if(escape>=3) pace="ややハイ";
  else if(escape<=1 && front<=2) pace="スロー";
  return {pace,escape,front,classes};
}

function styleFactor(style,pace){
  const s=styleClass({style});
  if(s==="逃げ"){
    if(pace==="ハイ") return 0.94;
    if(pace==="ややハイ") return 0.98;
    if(pace==="スロー") return 1.07;
    return 1.03;
  }
  if(s==="先行"){
    if(pace==="ハイ") return 1.00;
    if(pace==="スロー") return 1.04;
    return 1.02;
  }
  if(s==="差し"){
    if(pace==="ハイ") return 1.06;
    if(pace==="スロー") return 0.97;
    return 1.01;
  }
  if(s==="追込"){
    if(pace==="ハイ") return 1.08;
    if(pace==="スロー") return 0.92;
    return 1.00;
  }
  return 1.00;
}

/* ---------- 発走前に利用できる特徴量 ---------- */

function marketFactor(h,horses){
  if(h.odds>0){
    const inv=1/h.odds;
    const xs=horses.map(x=>x.odds>0?1/x.odds:0);
    const mx=Math.max(...xs,0);
    return mx ? clamp(0.72+0.28*(inv/mx),0.72,1.00) : 0.85;
  }
  if(h.popularity>0){
    return clamp(1.03-0.035*(h.popularity-1),0.62,1.03);
  }
  return 0.85;
}

function popularityFactor(h){
  if(!h.popularity) return 1;
  return clamp(1.015-0.012*(h.popularity-1),0.88,1.015);
}

function frameFactor(h,n){
  if(!h.frame || !n) return 1;
  const center=(n+1)/2;
  const d=Math.abs(h.frame-center);
  return clamp(1.01-0.008*d,0.95,1.01);
}

function carriedFactor(h,horses){
  const a=avg(horses.map(x=>x.carriedWeight));
  if(h.carriedWeight==null || a==null) return 1;
  return clamp(1-(h.carriedWeight-a)*0.007,0.95,1.05);
}

function bodyFactor(h,horses){
  const a=avg(horses.map(x=>x.bodyWeight));
  if(h.bodyWeight==null || a==null) return 1;
  const d=Math.abs(h.bodyWeight-a);
  return d>90 ? 0.985 : 1;
}

function bodyDiffFactor(h){
  if(h.bodyWeightDiff==null) return 1;
  const d=Math.abs(h.bodyWeightDiff);
  if(d>=14) return 0.96;
  if(d>=10) return 0.98;
  return 1;
}

function ageFactor(h){
  const m=String(h.sexAge||"").match(/(\d+)/);
  if(!m) return 1;
  const age=Number(m[1]);
  if(age===3) return 1.01;
  if(age===4 || age===5) return 1;
  if(age===6) return 0.99;
  if(age>=7) return 0.97;
  return 1;
}

function jockeyFactor(h){
  /* 騎手名だけでは実績を捏造しない。統計データが存在する時だけ使う。 */
  const s=h.jockeyStats;
  if(!s || typeof s!=="object") return 1;
  const winRate=num(s.winRate ?? s.win_rate);
  if(winRate==null) return 1;
  return clamp(0.94 + Math.min(winRate,0.30)*0.5,0.94,1.09);
}

function coverage(h){
  const fields=[
    h.popularity,h.odds,h.frame,h.bodyWeight,h.bodyWeightDiff,
    h.sexAge,h.carriedWeight,h.jockey
  ];
  return fields.filter(v=>v!==null && v!==undefined && v!=="").length/fields.length;
}

function buildModel(rawHorses, race={}){
  const horses=rawHorses.map(normalizeHorse);
  const pace=paceAnalysis(horses);

  const scored=horses.map(h=>{
    const market=marketFactor(h,horses);
    const style=styleFactor(inferStyleFromData(h),pace.pace);
    const pFactor=style;
    const frame=frameFactor(h,horses.length);
    const carried=carriedFactor(h,horses);
    const body=bodyFactor(h,horses);
    const diff=bodyDiffFactor(h);
    const age=ageFactor(h);
    const jockey=jockeyFactor(h);
    const cov=coverage(h);

    /*
      市場を土台にしつつ、発走前に存在する特徴量を弱めに加える。
      未来情報（finish等）はここでは一切使用しない。
    */
    const independent =
      Math.pow(style,0.22) *
      Math.pow(pFactor,0.20) *
      Math.pow(frame,0.10) *
      Math.pow(carried,0.16) *
      Math.pow(body,0.08) *
      Math.pow(diff,0.08) *
      Math.pow(age,0.05) *
      Math.pow(jockey,0.05);

    const raw =
      Math.pow(Math.max(market,0.01),WEIGHTS.market) *
      Math.pow(Math.max(independent,0.01),1-WEIGHTS.market) *
      (0.96 + WEIGHTS.coverage*cov) *
      (1 + (popularityFactor(h)-1)*WEIGHTS.market);

    return {
      ...h,
      style:inferStyleFromData(h),
      pace:pace.pace,
      rawScore:raw,
      components:{market,style,pFactor,frame,carried,body,diff,age,jockey,coverage:cov}
    };
  });

  const sum=scored.reduce((s,h)=>s+h.rawScore,0)||1;
  scored.forEach(h=>h.win=h.rawScore/sum);

  return {
    horses:scored.sort((a,b)=>b.win-a.win),
    pace
  };
}

/* ---------- Monte Carlo ---------- */

function weightedPick(pool){
  const total=pool.reduce((s,x)=>s+x.weight,0);
  if(total<=0) return 0;
  let r=Math.random()*total;
  for(let i=0;i<pool.length;i++){
    r-=pool[i].weight;
    if(r<=0) return i;
  }
  return pool.length-1;
}

function monteCarlo(modelHorses){
  const n=modelHorses.length;
  const first=new Array(n).fill(0);
  const second=new Array(n).fill(0);
  const third=new Array(n).fill(0);
  const trio=new Map();
  const trifecta=new Map();

  for(let k=0;k<SIMULATIONS;k++){
    const pool=modelHorses.map((h,i)=>({i,weight:Math.max(h.rawScore,1e-9)}));
    const order=[];
    while(pool.length && order.length<3){
      const p=weightedPick(pool);
      order.push(pool[p].i);
      pool.splice(p,1);
    }
    if(order.length<3) continue;

    first[order[0]]++;
    second[order[1]]++;
    third[order[2]]++;

    const trioKey=[...order].sort((a,b)=>a-b).join("-");
    trio.set(trioKey,(trio.get(trioKey)||0)+1);

    const triKey=order.join("-");
    trifecta.set(triKey,(trifecta.get(triKey)||0)+1);
  }

  const out=modelHorses.map((h,i)=>({
    ...h,
    win:first[i]/SIMULATIONS,
    second:second[i]/SIMULATIONS,
    third:third[i]/SIMULATIONS,
    top3:(first[i]+second[i]+third[i])/SIMULATIONS,
    ev:h.odds>0 ? (first[i]/SIMULATIONS)*h.odds : null
  }));

  return {
    horses:out.sort((a,b)=>b.win-a.win),
    trio:topCombos(trio,modelHorses,5),
    trifecta:topCombos(trifecta,modelHorses,5)
  };
}

function topCombos(map,horses,limit){
  return [...map.entries()]
    .map(([key,count])=>({
      key,
      probability:count/SIMULATIONS,
      horses:key.split("-").map(x=>horses[Number(x)])
    }))
    .sort((a,b)=>b.probability-a.probability)
    .slice(0,limit);
}

/* ---------- 画面 ---------- */

function renderRaces(){
  const box=$("races");
  if(!box) return;
  const venue=$("venue")?.value||"";
  const list=state.races.filter(r=>!venue||r.venue===venue);
  if(!list.length){
    box.innerHTML='<div class="note">該当するレースがありません。</div>';
    return;
  }

  box.innerHTML=list.map((r,i)=>`
    <div class="race">
      <div>
        <b>${esc(r.venue)} ${r.no}R ${esc(r.name||"レース")}</b>
        <div class="small">${esc(r.time||"")} ${r.historical?"・結果済み":""}</div>
      </div>
      <button data-race-index="${i}">${r.historical?"結果・分析":"このレースを選択"}</button>
    </div>
  `).join("");

  [...box.querySelectorAll("[data-race-index]")].forEach(btn=>{
    btn.onclick=()=>{
      const visible=list[Number(btn.dataset.raceIndex)];
      selectRace(visible);
    };
  });
}

function selectRace(r){
  state.selected=r;
  $("entryCard")?.classList.remove("hidden");
  $("resultCard")?.classList.add("hidden");
  $("raceInfo").innerHTML=`
    <b>${esc(r.venue)} ${r.no}R ${esc(r.name||"")}</b>
    <div class="small">${esc(r.date||"")} ${esc(r.time||"")}</div>
  `;
  $("horses").innerHTML='<div class="status">出馬表を読み込み中…</div>';
  loadEntry(r);
}

async function loadEntry(r){
  try{
    const source=r.sourceRace||r;
    const horses=(source.horses||[]).map(normalizeHorse);
    if(!horses.length) throw new Error("馬データがありません。");
    state.horses=horses;
    state.selected={...r,...source};
    renderHorses();

    if(r.historical){
      renderHistoricalBacktest(source);
    }
  }catch(e){
    $("horses").innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}

function renderHorses(){
  const hs=state.horses.map(normalizeHorse).sort((a,b)=>a.no-b.no);
  $("horses").innerHTML=`
    <div class="small">${hs.length}頭・発走前に利用可能な情報のみ表示</div>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>枠</th><th>馬番</th><th>馬名</th><th>性齢</th>
        <th>騎手</th><th>斤量</th><th>馬体重</th><th>単勝</th><th>人気</th>
      </tr></thead>
      <tbody>
      ${hs.map(h=>`
        <tr>
          <td>${h.frame??"-"}</td>
          <td><b>${h.no}</b></td>
          <td><b>${esc(h.name)}</b></td>
          <td>${esc(h.sexAge||"-")}</td>
          <td>${esc(h.jockey||"-")}</td>
          <td>${h.carriedWeight!=null?h.carriedWeight+"kg":"-"}</td>
          <td>${h.bodyWeight!=null?h.bodyWeight+` (${h.bodyWeightDiff>0?"+":""}${h.bodyWeightDiff??0})`:"-"}</td>
          <td>${h.odds>0?h.odds:"-"}</td>
          <td>${h.popularity??"-"}</td>
        </tr>
      `).join("")}
      </tbody>
    </table></div>
  `;
}

function runSimulation(){
  if(!state.horses.length) return;
  const model=buildModel(state.horses,state.selected||{});
  const mc=monteCarlo(model.horses);
  state.result={...mc,pace:model.pace,modelHorses:model.horses};

  $("resultCard")?.classList.remove("hidden");
  $("result").innerHTML=renderSimulation(state.result);
  $("resultCard").scrollIntoView({behavior:"smooth",block:"start"});
}

function renderSimulation(result){
  const hs=result.horses;
  const values=hs.filter(h=>h.ev!=null&&h.ev>=1.05).sort((a,b)=>b.ev-a.ev).slice(0,8);
  const topModel=hs.slice(0,5);

  return `
    <div class="summary">
      <b>Ver.${MODEL_VERSION} 本格シミュレーション</b><br>
      Monte Carlo ${SIMULATIONS.toLocaleString()}回<br>
      展開：<b>${result.pace.pace}</b>
      ／逃げ${result.pace.escape}頭・先行${result.pace.front}頭
    </div>

    <div class="note">
      <b>発走前情報のみで計算</b><br>
      着順・確定結果は予測スコアに使用していません。
      データが存在しない近走・コース適性・騎手実績などは推測せず、
      利用可能な項目だけを使用しています。
    </div>

    <h3>📊 1着・2着・3着確率</h3>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>順位</th><th>馬</th><th>1着</th><th>2着</th><th>3着</th>
        <th>3着内</th><th>単勝</th><th>EV</th>
      </tr></thead>
      <tbody>
      ${hs.map((h,i)=>`
        <tr>
          <td><b>${i+1}</b></td>
          <td><b>${h.no} ${esc(h.name)}</b></td>
          <td>${pct(h.win)}</td>
          <td>${pct(h.second)}</td>
          <td>${pct(h.third)}</td>
          <td>${pct(h.top3)}</td>
          <td>${h.odds>0?h.odds:"-"}</td>
          <td>${h.ev!=null?h.ev.toFixed(2):"-"}</td>
        </tr>
      `).join("")}
      </tbody>
    </table></div>

    <h3>💰 単勝EV 1.05以上</h3>
    ${values.length?`<div class="recommend">
      ${values.map(h=>`<div><b>${h.no} ${esc(h.name)}</b>：EV ${h.ev.toFixed(2)} ／1着率 ${pct(h.win)}</div>`).join("")}
    </div>`:"<div class=\"note\">EV 1.05以上はありません。</div>"}

    <h3>🎯 3連複候補</h3>
    <div class="combo-list">
      ${result.trio.map((x,i)=>`
        <div><b>${i+1}.</b>
        ${x.horses.map(h=>`${h.no} ${esc(h.name)}`).join(" - ")}
        ／ ${pct(x.probability)}</div>
      `).join("")}
    </div>

    <h3>🏇 3連単候補</h3>
    <div class="combo-list">
      ${result.trifecta.map((x,i)=>`
        <div><b>${i+1}.</b>
        ${x.horses.map(h=>`${h.no} ${esc(h.name)}`).join(" → ")}
        ／ ${pct(x.probability)}</div>
      `).join("")}
    </div>

    <h3>🔎 モデル上位5頭の要因</h3>
    <div class="table-scroll">
    <table>
      <thead><tr><th>馬</th><th>市場</th><th>脚質</th><th>枠</th><th>斤量</th><th>馬体重</th><th>充足率</th></tr></thead>
      <tbody>
      ${topModel.map(h=>`
        <tr>
          <td>${h.no} ${esc(h.name)}</td>
          <td>${h.components.market.toFixed(3)}</td>
          <td>${h.components.style.toFixed(3)}</td>
          <td>${h.components.frame.toFixed(3)}</td>
          <td>${h.components.carried.toFixed(3)}</td>
          <td>${h.components.body.toFixed(3)}</td>
          <td>${pct(h.components.coverage)}</td>
        </tr>
      `).join("")}
      </tbody>
    </table></div>
  `;
}

/* ---------- 個別バックテスト ---------- */

function renderHistoricalBacktest(race){
  const horses=(race.horses||[]).map(normalizeHorse);
  if(!horses.length) return;
  const model=buildModel(horses,race);
  const ranked=model.horses;
  const winner=horses.find(h=>h.finish===1);
  if(!winner) return;

  const pos=ranked.findIndex(h=>h.no===winner.no)+1;
  const top3=ranked.slice(0,3).some(h=>h.no===winner.no);
  const top5=ranked.slice(0,5).some(h=>h.no===winner.no);

  $("resultCard")?.classList.remove("hidden");
  $("result").innerHTML=`
    <div class="summary">
      <b>Ver.${MODEL_VERSION} 個別バックテスト</b><br>
      実際の1着：${winner.no} ${esc(winner.name)}<br>
      モデル本命：${ranked[0].no} ${esc(ranked[0].name)}
    </div>
    <div class="stats-grid">
      <div>本命1着<br><b>${ranked[0].no===winner.no?"的中":"不的中"}</b></div>
      <div>上位3頭<br><b>${top3?"的中":"不的中"}</b></div>
      <div>上位5頭<br><b>${top5?"的中":"不的中"}</b></div>
      <div>勝ち馬予測順位<br><b>${pos}位</b></div>
    </div>
    <h3>予測順位</h3>
    <div class="table-scroll">
    <table><thead><tr><th>順位</th><th>馬</th><th>モデル1着率</th><th>実着順</th><th>人気</th></tr></thead>
    <tbody>
    ${ranked.map((h,i)=>`
      <tr>
        <td>${i+1}</td><td>${h.no} ${esc(h.name)}</td>
        <td>${pct(h.win)}</td><td>${h.finish??"-"}</td><td>${h.popularity??"-"}</td>
      </tr>
    `).join("")}
    </tbody></table></div>
    <div class="note">
      評価時には finish を予測入力として使用していません。
      finish は的中判定専用です。
    </div>
  `;
}

/* ---------- 一括バックテスト ---------- */

function getFinish(h){ return num(h.finish ?? h.result ?? h.place); }
function getPopularity(h){ return num(h.popularity ?? h.odds_rank ?? h.rank); }

function backtestAll(races){
  const rows=[];
  let modelWin=0, modelTop3=0, modelTop5=0;
  let popWin=0,popTop3=0,popTop5=0;
  let modelRankSum=0,popRankSum=0;
  let longshotCaught=0,longshotTotal=0;
  let modelBetterThanMarket=0;

  for(const race of races){
    const horses=(race.horses||[]).map(normalizeHorse);
    const valid=horses.filter(h=>getFinish(h)!=null);
    if(!valid.length) continue;

    const winner=valid.find(h=>getFinish(h)===1);
    if(!winner) continue;

    const model=buildModel(valid,race).horses;
    const popRank=[...valid].sort((a,b)=>(getPopularity(a)||999)-(getPopularity(b)||999));

    const mr=model.findIndex(h=>h.no===winner.no)+1;
    const pr=popRank.findIndex(h=>h.no===winner.no)+1;

    if(mr===1) modelWin++;
    if(mr<=3) modelTop3++;
    if(mr<=5) modelTop5++;
    if(pr===1) popWin++;
    if(pr<=3) popTop3++;
    if(pr<=5) popTop5++;
    modelRankSum+=mr;
    popRankSum+=pr;

    const wp=getPopularity(winner);
    if(wp>=10){
      longshotTotal++;
      if(mr<=5) longshotCaught++;
    }

    if(mr<pr) modelBetterThanMarket++;

    rows.push({
      venue:race.venue||VENUE_NAMES[race.venue_code]||"不明",
      no:race.no??race.race_number,
      winner,
      mr,pr,
      modelTop:model[0],
      popTop:popRank[0]
    });
  }

  const n=rows.length||1;
  return {
    rows,n,
    modelWin,modelTop3,modelTop5,popWin,popTop3,popTop5,
    modelRankAvg:modelRankSum/n,
    popRankAvg:popRankSum/n,
    modelBetterThanMarket,
    longshotCaught,longshotTotal
  };
}

function renderBulkReport(bt){
  const improvement=(a,b)=>((a-b)*100).toFixed(1)+"pt";
  return `
    <div class="summary">
      <b>Ver.${MODEL_VERSION} 一括バックテスト</b><br>
      評価レース数：${bt.n}
    </div>

    <h3>📊 市場人気 vs Ver.${MODEL_VERSION}</h3>
    <div class="table-scroll">
    <table>
      <thead><tr><th>評価項目</th><th>最終人気</th><th>Ver.${MODEL_VERSION}</th><th>差</th></tr></thead>
      <tbody>
        <tr><td>本命が1着</td><td>${pct(bt.popWin/bt.n)}</td><td>${pct(bt.modelWin/bt.n)}</td><td>${improvement(bt.modelWin/bt.n,bt.popWin/bt.n)}</td></tr>
        <tr><td>上位3頭に勝ち馬</td><td>${pct(bt.popTop3/bt.n)}</td><td>${pct(bt.modelTop3/bt.n)}</td><td>${improvement(bt.modelTop3/bt.n,bt.popTop3/bt.n)}</td></tr>
        <tr><td>上位5頭に勝ち馬</td><td>${pct(bt.popTop5/bt.n)}</td><td>${pct(bt.modelTop5/bt.n)}</td><td>${improvement(bt.modelTop5/bt.n,bt.popTop5/bt.n)}</td></tr>
        <tr><td>勝ち馬の平均予測順位</td><td>${bt.popRankAvg.toFixed(2)}位</td><td>${bt.modelRankAvg.toFixed(2)}位</td><td>${(bt.popRankAvg-bt.modelRankAvg).toFixed(2)}位改善</td></tr>
        <tr><td>人気より上位に評価</td><td>—</td><td>${bt.modelBetterThanMarket}/${bt.n}</td><td>—</td></tr>
        <tr><td>10番人気以上の勝ち馬を上位5頭で捕捉</td><td>—</td><td>${bt.longshotTotal?bt.longshotCaught+"/"+bt.longshotTotal:"対象なし"}</td><td>—</td></tr>
      </tbody>
    </table></div>

    <h3>🎯 レース別結果</h3>
    <div class="table-scroll">
    <table>
      <thead><tr><th>開催</th><th>R</th><th>勝ち馬</th><th>人気</th><th>モデル順位</th><th>人気順位</th><th>モデル本命</th></tr></thead>
      <tbody>
      ${bt.rows.map(x=>`
        <tr>
          <td>${esc(x.venue)}</td>
          <td>${x.no}</td>
          <td>${x.winner.no} ${esc(x.winner.name)}</td>
          <td>${x.winner.popularity??"-"}</td>
          <td>${x.mr}位</td>
          <td>${x.pr}位</td>
          <td>${x.modelTop.no} ${esc(x.modelTop.name)}</td>
        </tr>
      `).join("")}
      </tbody>
    </table></div>

    <div class="note">
      このバックテストでは着順をモデル入力にしていません。
      現在の履歴データで利用できる発走前項目のみを使い、
      finish は評価専用です。なお、近走・コース適性・4角位置などの
      未同期項目は推測していません。
    </div>
  `;
}

async function runBulkBacktest(){
  const box=$("bulkBacktestResult");
  box.innerHTML='<div class="status">36レースを評価中…</div>';
  try{
    const d=await getHistory();
    const races=(d.races||[]).filter(r=>(r.horses||[]).length);
    const bt=backtestAll(races);
    box.innerHTML=renderBulkReport(bt);
  }catch(e){
    box.innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}

/* ---------- 初期化 ---------- */

async function load開催(){
  try{
    const d=await getDaily();
    const target=$("date").value;
    const races=(d.races||[]).map(r=>({
      ...r,
      no:r.no ?? r.race_number,
      venue:r.venue ?? VENUE_NAMES[r.venue_code] ?? "",
      date:r.date ?? target,
      time:r.time ?? "",
      name:(r.name && r.name!=="本文へ移動する") ? r.name : `JRA ${r.race_number??r.no}R`,
      historical:true,
      sourceRace:r
    }));

    state.races=races.filter(r=>!target||r.date===target);
    renderRaces();

    const venues=[...new Set(state.races.map(r=>r.venue))];
    $("syncInfo").innerHTML=
      `同期日：${esc(d.updated_at||"不明")}<br>`+
      `公式レースリンク：${(d.official_race_links||[]).length}件<br>`+
      `取得レース：${state.races.length}件`;
    msg(`${target}：JRA公式同期データ ${state.races.length}レース`, "ok");

    if(venues.length){
      $("venue").innerHTML='<option value="">すべて</option>'+
        venues.map(v=>`<option>${esc(v)}</option>`).join("");
    }
  }catch(e){
    msg(esc(e.message),"err");
  }
}

function bind(){
  $("loadBtn")?.addEventListener("click",load開催);
  $("venue")?.addEventListener("change",renderRaces);
  $("simulateBtn")?.addEventListener("click",runSimulation);
  $("backBtn")?.addEventListener("click",()=>{
    $("entryCard")?.classList.add("hidden");
    $("resultCard")?.classList.add("hidden");
    window.scrollTo({top:0,behavior:"smooth"});
  });
  $("runBulkBacktest")?.addEventListener("click",runBulkBacktest);
}

window.KeibaSimulator={
  version:MODEL_VERSION,
  state,
  buildModel,
  runMonteCarlo,
  backtestAll,
  runBulkBacktest,
  paceAnalysis
};

if($("date")) $("date").value=today();
bind();
load開催();
