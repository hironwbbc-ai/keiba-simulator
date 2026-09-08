/* =========================================================
   競馬シミュレーター Ver.12.5
   安定版再構築
   ---------------------------------------------------------
   JRA公式同期JSON
   → 開催一覧
   → 出馬表
   → 発走前特徴量モデル
   → Monte Carlo 10,000回
   → 個別分析 / バックテスト
   → 一括バックテスト

   設計原則
   ・確定後の着順/4角位置を予測入力に使わない
   ・存在しないデータを推測しない
   ・最終人気はベンチマーク兼補助特徴量に留める
   ・daily/history は「日付+開催場コード+R」で厳密に対応
   ・UIのイベント登録を app.js に一本化し、二重登録をしない
   ========================================================= */
"use strict";

const $ = id => document.getElementById(id);
const MODEL_VERSION = "12.5";
const SIMULATIONS = 10000;

const VENUES = {
  "札幌":"01","函館":"02","福島":"03","新潟":"04","東京":"05",
  "中山":"06","中京":"07","京都":"08","阪神":"09","小倉":"10"
};
const VENUE_NAMES = Object.fromEntries(Object.entries(VENUES).map(([n,c])=>[c,n]));

const state = {
  daily:null,
  history:null,
  races:[],
  selected:null,
  horses:[],
  analysis:null,
  loading:false
};

/* ---------- utility ---------- */
function esc(v){
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function num(v){
  if(v===null || v===undefined || v==="") return null;
  const n=Number(String(v).replace(/[^\d.+-]/g,""));
  return Number.isFinite(n)?n:null;
}
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function pct(v){ return `${(Number(v||0)*100).toFixed(1)}%`; }
function median(xs){
  const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length) return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function today(){
  return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date()).replace(/\//g,"-");
}
function dateKey(v){
  const s=String(v||"");
  const m=s.match(/(20\d{2})[^0-9]?(\d{2})[^0-9]?(\d{2})/);
  return m?`${m[1]}${m[2]}${m[3]}`:s.replace(/\D/g,"");
}
function cleanText(v){
  return String(v??"").replace(/本文へ移動する/g,"").replace(/\s+/g," ").trim();
}
function setStatus(text,cls=""){
  const e=$("status");
  if(e){ e.innerHTML=text; e.className=`status ${cls}`; }
}
function codeToVenue(code){ return VENUE_NAMES[String(code||"").padStart(2,"0")]||""; }
function normalizeVenue(r){
  const code0=String(r?.venue_code ?? r?.venueCode ?? "").trim();
  const code=code0.match(/^\d{1,2}$/)?code0.padStart(2,"0"):"";
  if(code && VENUE_NAMES[code]) return {code,name:VENUE_NAMES[code]};
  const name=cleanText(r?.venue);
  if(VENUES[name]) return {code:VENUES[name],name};
  return {code:"",name};
}
function raceKey(r){
  const v=normalizeVenue(r);
  const no=num(r?.no ?? r?.race_number ?? r?.raceNo);
  return `${dateKey(r?.date)}|${v.code||v.name}|${no||""}`;
}
function cleanRaceName(name,fallback="レース"){
  const x=cleanText(name);
  return x || fallback;
}

async function getJSON(path){
  const res=await fetch(`${path}?ts=${Date.now()}`,{cache:"no-store"});
  if(!res.ok) throw new Error(`${path} を取得できませんでした（${res.status}）`);
  return await res.json();
}
async function getDaily(force=false){
  if(force) state.daily=null;
  if(!state.daily) state.daily=await getJSON("./data/jra_daily.json");
  return state.daily;
}
async function getHistory(force=false){
  if(force) state.history=null;
  if(!state.history) state.history=await getJSON("./data/jra_history.json");
  return state.history;
}

/* ---------- normalization ---------- */
function normalizeHorse(h,extra={}){
  return {
    no:num(h?.no ?? h?.number ?? h?.horse_no ?? extra.no),
    name:cleanText(h?.name ?? h?.horse_name ?? h?.horseName ?? extra.name),
    odds:num(h?.odds),
    popularity:num(h?.popularity ?? h?.odds_rank ?? h?.rank),
    bodyWeight:num(h?.bodyWeight ?? h?.body_weight ?? h?.weight),
    bodyWeightDiff:num(h?.bodyWeightDiff ?? h?.body_weight_diff),
    sexAge:cleanText(h?.sexAge ?? h?.sex_age ?? ""),
    carriedWeight:num(h?.carriedWeight ?? h?.carried_weight ?? h?.weight_carried),
    jockey:cleanText(h?.jockey ?? ""),
    frame:num(h?.frame ?? h?.frame_no ?? h?.waku ?? extra.frame),
    style:cleanText(h?.style ?? "不明") || "不明",
    recent:Array.isArray(h?.recent)?h.recent:[],
    courseStats:h?.courseStats ?? h?.course_stats ?? null,
    jockeyStats:h?.jockeyStats ?? h?.jockey_stats ?? null,
    corner4:num(h?.corner4 ?? h?.corner_4),
    historicalFinish:num(extra.historicalFinish ?? h?.finish ?? h?.result ?? h?.place),
    ...extra
  };
}

function normalizeRace(r,sourceDate=""){
  const v=normalizeVenue(r);
  const no=num(r?.no ?? r?.race_number ?? r?.raceNo);
  return {
    ...r,
    date:r?.date || sourceDate,
    venue:v.name || cleanText(r?.venue),
    venue_code:v.code,
    no,
    name:cleanRaceName(r?.name,`第${no||""}レース`),
    horses:Array.isArray(r?.horses)?r.horses:[]
  };
}

function buildRaceList(daily,history){
  const out=[];
  const hmap=new Map();
  for(const raw of (history?.races||[])){
    const r=normalizeRace(raw,history?.date||daily?.date||"");
    if(raceKey(r)!=="|||" && r.no) hmap.set(raceKey(r),r);
  }

  for(const raw of (daily?.races||[])){
    const r=normalizeRace(raw,daily?.date||"");
    if(!r.no || !r.venue_code) continue;
    const h=hmap.get(raceKey(r));
    out.push({...r,
      name:cleanRaceName(r.name,h?.name||`第${r.no}レース`),
      time:r.time||h?.time||"",
      distance:r.distance||h?.distance||null,
      surface:r.surface||h?.surface||"",
      course:r.course||h?.course||"",
      historical:!!h,
      history:h||null
    });
  }

  // history-only races are included only when they do not duplicate daily.
  const keys=new Set(out.map(r=>raceKey(r)));
  for(const raw of (history?.races||[])){
    const r=normalizeRace(raw,history?.date||"");
    if(!r.no || !r.venue_code) continue;
    const k=raceKey(r);
    if(!keys.has(k)){
      out.push({...r,historical:true,history:r});
      keys.add(k);
    }
  }
  return out.sort((a,b)=>
    String(a.venue_code).localeCompare(String(b.venue_code)) || Number(a.no)-Number(b.no)
  );
}

/* ---------- UI: race list ---------- */
function renderRaces(){
  const box=$("races");
  if(!box) return;
  const venue=$("venue")?.value||"";
  const list=state.races.filter(r=>!venue||r.venue_code===venue);
  if(!list.length){ box.innerHTML='<div class="note">該当するレースがありません。</div>'; return; }
  box.innerHTML=list.map(r=>`<div class="race-row">
    <div><b>${esc(r.venue)} ${r.no}R</b> <span>${esc(r.name)}</span>
    <div class="small">${esc(r.time||"")} ${r.historical?"・結果データあり":""}</div></div>
    <button type="button" class="race-open" data-key="${esc(raceKey(r))}">${r.historical?"結果・分析":"出馬表"}</button>
  </div>`).join("");
  box.querySelectorAll(".race-open").forEach(btn=>btn.addEventListener("click",()=>{
    const r=state.races.find(x=>raceKey(x)===btn.dataset.key);
    if(r) selectRace(r);
  }));
}

async function loadRaces(){
  if(state.loading) return;
  state.loading=true;
  const loadBtn=$("loadBtn");
  if(loadBtn) loadBtn.disabled=true;
  setStatus('<span class="spinner"></span> JRA公式同期JSONを読み込み中…');
  try{
    const selectedDate=$("date")?.value||today();
    const daily=await getDaily(true);
    let history=null;
    try{ history=await getHistory(true); }catch(e){ history={races:[],date:daily.date}; }
    state.races=buildRaceList(daily,history);
    renderRaces();

    const venues=[...new Set(state.races.map(r=>r.venue_code).filter(Boolean))];
    const sel=$("venue");
    if(sel){
      const old=sel.value;
      sel.innerHTML='<option value="">全開催</option>'+venues.map(c=>`<option value="${c}">${esc(VENUE_NAMES[c]||c)}</option>`).join("");
      if(venues.includes(old)) sel.value=old;
    }
    renderRaces();

    const actualDate=daily.date||selectedDate;
    $("officialProgramStatus").innerHTML=`
      <b>JRA公式同期データ</b><br>
      同期日：${esc(actualDate)}<br>
      同期日時：${esc(daily.updated_at||"不明")}<br>
      公式レースリンク：${Number(daily.official_race_links?.length||0)}件<br>
      データパーサー：${esc(daily.parser_version||"不明")}<br>
      開催：${venues.map(c=>esc(VENUE_NAMES[c]||c)).join("・")||"—"}<br>
      対応レース：${state.races.length}レース
    `;
    if(selectedDate!==actualDate){
      setStatus(`指定日は ${esc(selectedDate)} ですが、同期JSONは ${esc(actualDate)} です。${state.races.length}レースを表示します。`,"warn");
    }else{
      setStatus(`${esc(actualDate)}：JRA公式同期データ。${venues.map(c=>esc(VENUE_NAMES[c]||c)).join("・")}・${state.races.length}レース`,"ok");
    }
  }catch(e){
    state.races=[]; renderRaces(); setStatus(esc(e.message),"err");
  }finally{
    state.loading=false;
    if(loadBtn) loadBtn.disabled=false;
  }
}

/* ---------- entry ---------- */
async function selectRace(r){
  state.selected=r; state.horses=[];
  $("entryCard")?.classList.remove("hidden");
  $("resultCard")?.classList.add("hidden");
  $("raceInfo").innerHTML=`<b>${esc(r.venue)} ${r.no}R ${esc(r.name)}</b><br>
    <span class="small">${esc(r.date||"")} ${esc(r.time||"")} ・${esc(r.surface||"")} ${r.distance?esc(r.distance)+"m":""} ${r.course?"・"+esc(r.course):""}</span>`;
  $("horses").innerHTML='<div class="status"><span class="spinner"></span> 出馬表を準備中…</div>';
  try{
    const daily=await getDaily();
    const history=await getHistory();
    const dr=(daily.races||[]).map(x=>normalizeRace(x,daily.date)).find(x=>raceKey(x)===raceKey(r));
    const hr=(history.races||[]).map(x=>normalizeRace(x,history.date)).find(x=>raceKey(x)===raceKey(r));
    const hmap=new Map((hr?.horses||[]).map(h=>[Number(h.no),h]));
    const source=dr?.horses?.length?dr.horses:(hr?.horses||[]);
    state.horses=source.map(h=>{
      const no=num(h.no??h.number);
      const old=hmap.get(no)||{};
      return normalizeHorse(h,{frame:num(h.frame??old.frame),historicalFinish:num(old.finish)});
    }).filter(h=>h.no && h.name);
    state.selected={...r,dailyRace:dr,historyRace:hr};
    renderHorses();
  }catch(e){ $("horses").innerHTML=`<div class="status err">${esc(e.message)}</div>`; }
}
function renderHorses(){
  const hs=state.horses.slice().sort((a,b)=>a.no-b.no);
  $("horses").innerHTML=`<div class="small">${hs.length}頭・JRA公式同期データ</div>
  <div class="table-wrap"><table><thead><tr><th>枠</th><th>馬番</th><th>馬名</th><th>人気</th><th>オッズ</th><th>斤量</th><th>馬体重</th><th>増減</th><th>騎手</th></tr></thead><tbody>
  ${hs.map(h=>`<tr><td>${h.frame??"—"}</td><td><b>${h.no}</b></td><td>${esc(h.name)}</td><td>${h.popularity??"—"}</td><td>${h.odds??"—"}</td><td>${h.carriedWeight??"—"}</td><td>${h.bodyWeight??"—"}</td><td>${h.bodyWeightDiff==null?"—":(h.bodyWeightDiff>0?"+":"")+h.bodyWeightDiff}</td><td>${esc(h.jockey)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

/* ---------- model ---------- */
function parseAge(sexAge){ const m=String(sexAge||"").match(/(\d+)/); return m?Number(m[1]):null; }
function styleClass(s){
  const x=String(s||"");
  if(/逃げ/.test(x)) return "逃げ";
  if(/先行/.test(x)) return "先行";
  if(/差し/.test(x)) return "差し";
  if(/追込/.test(x)) return "追込";
  return "不明";
}
function inferPace(horses){
  const styles=horses.map(h=>styleClass(h.style));
  const escapers=styles.filter(x=>x==="逃げ").length;
  const front=styles.filter(x=>x==="先行").length;
  if(escapers>=4) return {label:"ハイ",escapers,front};
  if(escapers>=3) return {label:"ややハイ",escapers,front};
  if(escapers<=1 && front<=3) return {label:"スロー",escapers,front};
  return {label:"標準",escapers,front};
}
function percentileScore(value,values,{higher=true}={}){
  const a=values.filter(Number.isFinite);
  if(value==null||!a.length) return .5;
  const less=a.filter(x=>x<value).length;
  const equal=a.filter(x=>x===value).length;
  const rank=less+Math.max(0,equal-1)/2;
  const p=a.length===1?.5:rank/(a.length-1);
  return higher?p:1-p;
}
function dataCoverage(horses){
  const fields=["odds","popularity","bodyWeight","bodyWeightDiff","sexAge","carriedWeight","jockey","frame"];
  let have=0,total=horses.length*fields.length;
  for(const h of horses) for(const f of fields){ if(h[f]!==null&&h[f]!==undefined&&h[f]!=="") have++; }
  return total?have/total:0;
}

function buildModel(rawHorses){
  const horses=rawHorses.map(normalizeHorse);
  const n=horses.length||1;
  const pace=inferPace(horses);
  const medWeight=median(horses.map(h=>h.carriedWeight));
  const medBody=median(horses.map(h=>h.bodyWeight));
  const oddsVals=horses.map(h=>h.odds).filter(x=>x>0);
  const popVals=horses.map(h=>h.popularity).filter(x=>x>0);
  const frameVals=horses.map(h=>h.frame).filter(x=>x>0);

  const rows=horses.map(h=>{
    // 市場は補助。人気だけで順位が固定されないよう15%前後。
    const market=h.popularity>0 ? clamp(1-(h.popularity-1)/Math.max(1,n-1),0,1) :
      (h.odds>0?percentileScore(h.odds,oddsVals,{higher:false}):.5);

    // 脚質×ペース。データが無ければ中立。
    const st=styleClass(h.style);
    let style=.5;
    if(st!=="不明"){
      const bonus=pace.label==="ハイ" ? {逃げ:.36,先行:.50,差し:.72,追込:.78} :
        pace.label==="ややハイ" ? {逃げ:.42,先行:.55,差し:.68,追込:.70} :
        pace.label==="スロー" ? {逃げ:.78,先行:.70,差し:.55,追込:.40} :
        {逃げ:.58,先行:.62,差し:.60,追込:.55};
      style=bonus[st]??.5;
    }

    const frame=h.frame!=null?percentileScore(h.frame,frameVals,{higher:false}):.5;
    let weight=.5;
    if(h.carriedWeight!=null && medWeight!=null) weight=clamp(.5+(medWeight-h.carriedWeight)*.035,.20,.80);

    let body=.5;
    if(h.bodyWeight!=null && medBody!=null){
      const deviation=Math.abs(h.bodyWeight-medBody);
      body=clamp(.76-deviation/220,.28,.76);
      if(h.bodyWeightDiff!=null){
        const d=Math.abs(h.bodyWeightDiff);
        body+=d<=2?.04:d>=14?-.10:d>=10?-.05:0;
        body=clamp(body,.20,.82);
      }
    }

    const age=parseAge(h.sexAge);
    const ageScore=age==null?.5:(age===3?.64:age===4?.62:age===5?.58:age===6?.52:age===7?.45:age>=8?.39:.5);
    const jockey=h.jockey?.length?.56:.5;
    const course=h.courseStats?.length?.62:.5;
    const jockeyStats=h.jockeyStats?.length?.64:jockey;

    // 発走前情報の独立部分を主軸にする。
    const independent=
      .26*style +
      .16*frame +
      .16*weight +
      .14*body +
      .10*ageScore +
      .08*jockeyStats +
      .05*course +
      .05*(h.bodyWeightDiff!=null?body:.5);

    const score=.15*(.35+.65*market)+.85*(.40+.60*independent);
    return {
      ...h,score,marketScore:market,independentScore:independent,
      components:{market,style,frame,carriedWeight:weight,bodyWeight:body,sexAge:ageScore,jockey:jockeyStats,course}
    };
  });

  // 0.000001以下の差は作らない。実データだけで順位を決める。
  const sum=rows.reduce((s,h)=>s+Math.max(h.score,.001),0)||1;
  rows.forEach(h=>h.prob=Math.max(h.score,.001)/sum);
  rows.sort((a,b)=>b.prob-a.prob || (a.no-b.no));
  return {horses:rows,pace,dataCoverage:dataCoverage(rows)};
}

/* ---------- Monte Carlo ---------- */
function weightedPick(pool){
  const total=pool.reduce((s,h)=>s+Math.max(h.prob,1e-12),0);
  let x=Math.random()*total;
  for(let i=0;i<pool.length;i++){ x-=Math.max(pool[i].prob,1e-12); if(x<=0)return i; }
  return pool.length-1;
}
function runMonteCarlo(horses,n=SIMULATIONS){
  const one=new Map(),two=new Map(),three=new Map(),top3=new Map(),trio=new Map(),trifecta=new Map();
  horses.forEach(h=>{one.set(h.no,0);two.set(h.no,0);three.set(h.no,0);top3.set(h.no,0);});
  for(let s=0;s<n;s++){
    const pool=horses.slice(),order=[];
    while(pool.length&&order.length<3){const i=weightedPick(pool);order.push(pool[i]);pool.splice(i,1);}
    if(!order[0])continue;
    one.set(order[0].no,(one.get(order[0].no)||0)+1);
    if(order[1])two.set(order[1].no,(two.get(order[1].no)||0)+1);
    if(order[2])three.set(order[2].no,(three.get(order[2].no)||0)+1);
    const ns=order.map(h=>h.no).sort((a,b)=>a-b);
    ns.forEach(no=>top3.set(no,(top3.get(no)||0)+1));
    if(ns.length===3){trio.set(ns.join("-"),(trio.get(ns.join("-"))||0)+1);}
    if(order.length===3){const k=order.map(h=>h.no).join("-");trifecta.set(k,(trifecta.get(k)||0)+1);}
  }
  return {one,two,three,top3,trio,trifecta,n};
}
function horseName(no,rows){const h=rows.find(x=>x.no===Number(no));return h?`${h.no} ${esc(h.name)}`:String(no);}

/* ---------- simulation ---------- */
function simulate(){
  if(!state.horses.length){ alert("先に出馬表を読み込んでください。"); return; }
  const model=buildModel(state.horses);
  const mc=runMonteCarlo(model.horses);
  const rows=model.horses.map(h=>{
    const p1=(mc.one.get(h.no)||0)/mc.n,p2=(mc.two.get(h.no)||0)/mc.n,p3=(mc.three.get(h.no)||0)/mc.n,pt=(mc.top3.get(h.no)||0)/mc.n;
    return {...h,p1,p2,p3,pTop3:pt,ev:h.odds?p1*h.odds:null};
  }).sort((a,b)=>b.p1-a.p1);
  state.analysis={model,mc,rows};
  const trio=[...mc.trio.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  const trif=[...mc.trifecta.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  $("resultCard")?.classList.remove("hidden");
  $("result").innerHTML=`
    <div class="result-head"><b>📊 Ver.${MODEL_VERSION} シミュレーション</b><span>Monte Carlo ${mc.n.toLocaleString()}回</span></div>
    <div class="stats">
      <div><b>想定ペース</b><strong>${esc(model.pace.label)}</strong></div>
      <div><b>逃げ候補</b><strong>${model.pace.escapers}頭</strong></div>
      <div><b>データ充足率</b><strong>${(model.dataCoverage*100).toFixed(1)}%</strong></div>
      <div><b>市場依存度</b><strong>低め</strong></div>
    </div>
    <div class="note warning">Ver.12.5は最終人気を補助特徴量として扱います。近走・コース適性・騎手成績など、JSONに存在しないデータは推測しません。</div>
    <h3>予測順位</h3><div class="table-wrap"><table><thead><tr><th>順位</th><th>馬</th><th>人気</th><th>1着</th><th>2着</th><th>3着</th><th>3着内</th><th>単勝</th><th>EV</th></tr></thead><tbody>
    ${rows.map((h,i)=>`<tr><td>${i+1}</td><td><b>${h.no} ${esc(h.name)}</b></td><td>${h.popularity??"—"}</td><td>${pct(h.p1)}</td><td>${pct(h.p2)}</td><td>${pct(h.p3)}</td><td>${pct(h.pTop3)}</td><td>${h.odds??"—"}</td><td>${h.ev==null?"—":h.ev.toFixed(2)}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>人気順位 → モデル順位</h3><div class="table-wrap"><table><thead><tr><th>馬</th><th>人気</th><th>モデル</th><th>差</th><th>主な評価</th></tr></thead><tbody>
    ${rows.map((h,i)=>{const d=h.popularity?Number(h.popularity)-(i+1):null;const c=[];if(h.components.style!==.5)c.push("脚質");if(h.frame!=null)c.push("枠");if(h.carriedWeight!=null)c.push("斤量");if(h.bodyWeight!=null)c.push("馬体重");return `<tr><td>${h.no} ${esc(h.name)}</td><td>${h.popularity??"—"}</td><td>${i+1}</td><td>${d==null?"—":(d>0?"+":"")+d}</td><td>${c.join("・")||"中立"}</td></tr>`}).join("")}
    </tbody></table></div>
    <h3>単勝EV 1.00以上</h3><div>${rows.filter(h=>h.ev!=null&&h.ev>=1).sort((a,b)=>b.ev-a.ev).slice(0,8).map(h=>`<div class="pick">${h.no} ${esc(h.name)}：EV ${h.ev.toFixed(2)}・1着 ${pct(h.p1)}</div>`).join("")||'<div class="small">該当馬なし</div>'}</div>
    <h3>3連複候補</h3><div>${trio.map(([k,v],i)=>`<div class="pick">${i+1}. ${k.split("-").map(no=>horseName(no,rows)).join(" - ")} <b>${pct(v/mc.n)}</b></div>`).join("")||'<div class="small">候補なし</div>'}</div>
    <h3>3連単候補</h3><div>${trif.map(([k,v],i)=>`<div class="pick">${i+1}. ${k.split("-").map(no=>horseName(no,rows)).join(" → ")} <b>${pct(v/mc.n)}</b></div>`).join("")||'<div class="small">候補なし</div>'}</div>
  `;
}

/* ---------- backtest ---------- */
function makeBacktestRace(dailyRace,histRace){
  const hmap=new Map((histRace?.horses||[]).map(h=>[Number(h.no),h]));
  return (dailyRace?.horses||[]).map(h=>{
    const no=Number(h.no??h.number), old=hmap.get(no)||{};
    return normalizeHorse(h,{frame:num(h.frame??old.frame),historicalFinish:num(old.finish)});
  }).filter(h=>h.no&&h.name);
}
function backtestOne(dailyRace,histRace){
  const horses=makeBacktestRace(dailyRace,histRace);
  if(horses.length<2)return null;
  const model=buildModel(horses), ranking=model.horses;
  const winner=horses.find(h=>h.historicalFinish===1);
  if(!winner)return null;
  const winnerRank=ranking.findIndex(h=>h.no===winner.no)+1;
  if(winnerRank<1)return null;
  const fav=horses.filter(h=>h.popularity>0).sort((a,b)=>a.popularity-b.popularity);
  const favRank=winner.popularity||null;
  return {winner,ranking,winnerRank,favRank,top1:ranking[0]?.no===winner.no,top3:ranking.slice(0,3).some(h=>h.no===winner.no),top5:ranking.slice(0,5).some(h=>h.no===winner.no),favorite1:fav[0]?.no===winner.no,favorite3:fav.slice(0,3).some(h=>h.no===winner.no),favorite5:fav.slice(0,5).some(h=>h.no===winner.no),improvement:favRank?favRank-winnerRank:0};
}
async function runBulkBacktest(){
  const out=$("bulkBacktestResult"),btn=$("runBulkBacktest"); if(!out)return;
  if(btn)btn.disabled=true; out.innerHTML='<div class="status"><span class="spinner"></span> バックテストを実行中…</div>';
  try{
    const daily=await getDaily(),history=await getHistory();
    const hmap=new Map();
    for(const raw of history.races||[]){const r=normalizeRace(raw,history.date);if(r.no&&r.venue_code)hmap.set(raceKey(r),r);}
    const results=[];
    for(const raw of daily.races||[]){
      const dr=normalizeRace(raw,daily.date),hr=hmap.get(raceKey(dr));
      if(!hr)continue;
      const r=backtestOne(dr,hr);if(r)results.push({...r,venue:dr.venue,no:dr.no,date:dr.date});
    }
    const total=results.length;
    if(!total){
      out.innerHTML=`<div class="status err"><b>バックテスト対象が0レースです。</b><br>daily/historyの対応付けに失敗しています。JRA同期JSONの「日付・開催場コード・R」を確認してください。</div>`;
      return;
    }
    const avg=(fn)=>results.reduce((s,r)=>s+fn(r),0)/total;
    const m1=results.filter(r=>r.top1).length,m3=results.filter(r=>r.top3).length,m5=results.filter(r=>r.top5).length;
    const f1=results.filter(r=>r.favorite1).length,f3=results.filter(r=>r.favorite3).length,f5=results.filter(r=>r.favorite5).length;
    const improved=results.filter(r=>r.improvement>0).sort((a,b)=>b.improvement-a.improvement);
    const changed=results.filter(r=>{ const fav=r.ranking.map(h=>h.no); const marketNo=r.winner && r.winner.popularity===1 ? r.winner.no : null; return marketNo!==null && fav[0]!==marketNo; }).length;
    const venueRows={};
    results.forEach(r=>{const x=venueRows[r.venue]??={n:0,t1:0,t3:0,t5:0};x.n++;x.t1+=r.top1?1:0;x.t3+=r.top3?1:0;x.t5+=r.top5?1:0;});
    out.innerHTML=`
      <div class="result-head"><b>📊 Ver.${MODEL_VERSION} 一括バックテスト</b><span>${total}レース</span></div>
      <div class="note warning">対象日：${esc(daily.date||"不明")}。最終単勝オッズ/人気は市場ベンチマーク兼補助特徴量です。着順・4角位置は評価専用で、予測スコアには使用しません。</div>
      <div class="compare-grid">
        <div class="metric-card"><b>本命1着</b><strong>${pct(m1/total)}</strong><small>モデル ${m1}/${total}</small></div>
        <div class="metric-card"><b>上位3頭</b><strong>${pct(m3/total)}</strong><small>モデル ${m3}/${total}</small></div>
        <div class="metric-card"><b>上位5頭</b><strong>${pct(m5/total)}</strong><small>モデル ${m5}/${total}</small></div>
        <div class="metric-card"><b>勝ち馬平均順位</b><strong>${avg(r=>r.winnerRank).toFixed(2)}位</strong><small>人気平均 ${avg(r=>Number(r.winner.popularity)||0).toFixed(2)}位</small></div>
      </div>
      <h3>最終人気 vs Ver.${MODEL_VERSION}</h3>
      <div class="table-wrap"><table><thead><tr><th>評価</th><th>最終人気</th><th>Ver.${MODEL_VERSION}</th><th>差</th></tr></thead><tbody>
      <tr><td>本命1着率</td><td>${pct(f1/total)}</td><td>${pct(m1/total)}</td><td>${pct((m1-f1)/total)}</td></tr>
      <tr><td>上位3頭</td><td>${pct(f3/total)}</td><td>${pct(m3/total)}</td><td>${pct((m3-f3)/total)}</td></tr>
      <tr><td>上位5頭</td><td>${pct(f5/total)}</td><td>${pct(m5/total)}</td><td>${pct((m5-f5)/total)}</td></tr>
      </tbody></table></div>
      <div class="stats"><div><b>人気より上昇した勝ち馬</b><strong>${improved.length}/${total}</strong></div><div><b>平均順位改善</b><strong>${avg(r=>r.improvement)>=0?"+":""}${avg(r=>r.improvement).toFixed(2)}</strong></div><div><b>モデル本命変更</b><strong>${changed}件</strong></div></div>
      <h3>開催場別</h3><div class="table-wrap"><table><thead><tr><th>開催</th><th>レース</th><th>本命1着</th><th>上位3</th><th>上位5</th></tr></thead><tbody>${Object.entries(venueRows).map(([v,x])=>`<tr><td>${esc(v)}</td><td>${x.n}</td><td>${pct(x.t1/x.n)}</td><td>${pct(x.t3/x.n)}</td><td>${pct(x.t5/x.n)}</td></tr>`).join("")}</tbody></table></div>
      <h3>🎯 人気以上に評価した勝ち馬</h3><div class="table-wrap"><table><thead><tr><th>開催</th><th>R</th><th>馬</th><th>人気</th><th>モデル</th><th>改善</th></tr></thead><tbody>${improved.slice(0,30).map(r=>`<tr><td>${esc(r.venue)}</td><td>${r.no}R</td><td>${r.winner.no} ${esc(r.winner.name)}</td><td>${r.favRank??"—"}</td><td>${r.winnerRank}</td><td>+${r.improvement}</td></tr>`).join("")||'<tr><td colspan="6">該当なし</td></tr>'}</tbody></table></div>
      <h3>レース別結果</h3><div class="table-wrap"><table><thead><tr><th>開催</th><th>R</th><th>勝ち馬</th><th>人気</th><th>モデル順位</th><th>本命</th><th>上位3</th><th>上位5</th></tr></thead><tbody>${results.map(r=>`<tr><td>${esc(r.venue)}</td><td>${r.no}R</td><td>${r.winner.no} ${esc(r.winner.name)}</td><td>${r.winner.popularity??"—"}</td><td>${r.winnerRank}</td><td>${r.top1?"○":"—"}</td><td>${r.top3?"○":"—"}</td><td>${r.top5?"○":"—"}</td></tr>`).join("")}</tbody></table></div>
    `;
  }catch(e){out.innerHTML=`<div class="status err">${esc(e.message)}</div>`;}finally{if(btn)btn.disabled=false;}
}

/* ---------- init: one place only ---------- */
function init(){
  const d=$("date"); if(d)d.value=today();
  $("loadBtn")?.addEventListener("click",loadRaces);
  $("venue")?.addEventListener("change",renderRaces);
  $("simulateBtn")?.addEventListener("click",simulate);
  $("backBtn")?.addEventListener("click",()=>{$("entryCard")?.classList.add("hidden");$("resultCard")?.classList.add("hidden");});
  $("runBulkBacktest")?.addEventListener("click",runBulkBacktest);
  // 自動読み込みはページ起動時に一度だけ。失敗してもボタンは使用可能。
  loadRaces();
}
window.KeibaSimulator={version:MODEL_VERSION,state,buildModel,runMonteCarlo,backtestOne,runBulkBacktest,simulate};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
