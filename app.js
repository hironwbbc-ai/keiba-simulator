/* =========================================================
   競馬シミュレーター Ver.15.11
   JRA公式同期JSON → 出馬表 → 予測 → Monte Carlo
   → 個別バックテスト → 学習反映
   ---------------------------------------------------------
   方針：
   ・存在しないデータは推測しない
   ・確定後データを発走前予測に混ぜない
   ・バックテストでは「発走前に確定している情報」を優先
   ・バックテスト結果を次回以降のモデル係数へ学習反映
   ・学習は予測後にのみ実行し、同一レースの重複学習を防止
   ========================================================= */

"use strict";

const $ = id => document.getElementById(id);

const MODEL_VERSION = "15.12";
const SIMULATIONS = 10000;

const VENUES = {
  "札幌":"01","函館":"02","福島":"03","新潟":"04","東京":"05",
  "中山":"06","中京":"07","京都":"08","阪神":"09","小倉":"10"
};

const state = {
  daily:null,
  history:null,
  historyIndex:null,
  races:[],
  horses:[],
  selected:null,
  analysis:null,
};

/* -------------------- utility -------------------- */

function esc(v){
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

/* -------------------- horse display -------------------- */
// JRAの元データは変更せず、表示時だけ「ブリンカー着用」をBバッジに変換する。
function horseLabel(name, no=null){
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

function historyDateKey(date){
  const s=String(date||"");
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : s.replace(/[^0-9]/g, "");
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

async function getHistoryIndex(date){
  try{
    return await getJSON(`./data/history/${historyDateKey(date)}/index.json`);
  }catch(_e){
    const key=historyDateKey(date);
    const h=await getJSON(`./data/history/${key}.json`);
    return {
      date:h.date||date,
      updated_at:h.updated_at||"",
      source:h.source||"JRA公式",
      races:(h.races||[]).map(r=>({
        venue:r.venue||codeToVenue(r.venue_code),
        venue_code:r.venue_code||"",
        no:Number(r.no),
        name:r.name||"",
        time:r.time||"",
        distance:r.distance??null,
        surface:r.surface||"",
        course:r.course||"",
        going:r.going||""
      }))
    };
  }
}

async function getHistoryRace(date,venue,no){
  const code=VENUES[venue]||String(venue||"");
  const key=historyDateKey(date);
  const padded=String(no).padStart(2,"0");
  for(const path of [
    `./data/history/${key}/${code}_${padded}.json`,
    `./data/history/${key}/${venue}_${padded}.json`
  ]){
    try{return await getJSON(path);}catch(_e){}
  }
  const h=await getJSON(`./data/history/${historyDateKey(date)}.json`);
  const r=(h.races||[]).find(x=>
    (x.venue||codeToVenue(x.venue_code))===venue &&
    Number(x.no??x.race_number)===Number(no)
  );
  if(!r) throw new Error(`${date} ${venue} ${no}R の過去レースデータがありません。`);
  return r;
}

/* -------------------- data normalization -------------------- */

function normalizeHorse(h, extra={}){
  return {
    no:Number(h.no ?? h.number ?? h.horse_no ?? 0),
    name:h.name ?? h.horse_name ?? h.horseName ?? "",
    odds:num(h.odds ?? h.winOdds ?? h.tanshoOdds ?? h.singleOdds),
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
  const venue=$("venue")?.value||"";
  const list=state.races.filter(r=>!venue||r.venue===venue);
  if(!list.length){
    box.innerHTML='<div class="note">該当するレースがありません。</div>';
    return;
  }
  const historical=list.some(r=>r.historical);
  if(historical){
    box.innerHTML=`
      <div class="note">過去日バックテストは<strong>1レースずつ</strong>実行します。レース一覧の「バックテスト」を押すと、そのレースの詳細データだけを取得して評価します。</div>
    `+list.map(r=>{
      const title=r.name&&!['レース','本文へ移動する','検索ウィンドウ'].includes(r.name)?esc(r.name):'（レース名は公式データ取得後に表示）';
      const key=`${r.venue}|${r.no}`;
      return `<div class="race-row">
        <div><b>${esc(r.venue)} ${r.no}R</b><span>${title}</span><div class="small">${esc(r.time||'')}</div></div>
        <div class="actions">
          <button data-race="${esc(key)}">出馬表</button>
          <button class="secondary" data-individual-backtest="${esc(key)}">バックテスト</button>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('button[data-race]').forEach(b=>{
      b.onclick=()=>{
        const [v,n]=b.dataset.race.split('|');
        const r=state.races.find(x=>x.venue===v&&Number(x.no)===Number(n));
        if(r)selectRace(r);
      };
    });
    box.querySelectorAll('button[data-individual-backtest]').forEach(b=>{
      b.onclick=()=>{
        const [v,n]=b.dataset.individualBacktest.split('|');
        const r=state.races.find(x=>x.venue===v&&Number(x.no)===Number(n));
        if(r)runIndividualBacktest(r);
      };
    });
    return;
  }
  box.innerHTML=list.map(r=>`
    <div class="race-row"><div><b>${esc(r.venue)} ${r.no}R</b><span>${esc(r.name||'レース')}</span><div class="small">${esc(r.time||'')}</div></div>
    <button data-race="${esc(r.venue)}|${r.no}">出馬表</button></div>`).join('');
  box.querySelectorAll('button[data-race]').forEach(b=>{
    b.onclick=()=>{
      const [v,n]=b.dataset.race.split('|');
      const r=state.races.find(x=>x.venue===v&&Number(x.no)===Number(n));
      if(r)selectRace(r);
    };
  });
}
/* -------------------- entry -------------------- */

async function selectRace(r){
  state.selected=r; state.horses=[];
  $("entryCard")?.classList.remove("hidden");
  $("resultCard")?.classList.add("hidden");
  $("raceInfo").innerHTML=`<b>${esc(r.venue)} ${r.no}R ${esc(r.name||"")}</b><br><span class="small">${esc(r.date||"")} ${esc(r.time||"")}</span>`;
  $("horses").innerHTML='<div class="status"><span class="spinner"></span> 選択レースのJRA公式データを読み込み中…</div>';
  try{
    const date=r.date||$("date")?.value||today();
    let dr=null,hr=null;
    if(r.historical) hr=await getHistoryRace(date,r.venue,Number(r.no));
    else{
      const daily=await getDaily();
      dr=(daily.races||[]).find(x=>(x.venue||codeToVenue(x.venue_code))===r.venue&&Number(x.no??x.race_number)===Number(r.no));
    }
    const source=dr?.horses?.length?dr.horses:(hr?.horses||[]);
    const hmap=new Map((hr?.horses||[]).map(h=>[Number(h.no),h]));
    state.horses=source.map(h=>{
      const no=Number(h.no??h.number),old=hmap.get(no)||{};
      return normalizeHorse(h,{frame:num(h.frame??old.frame),finish:r.historical?null:num(old.finish),historicalFinish:r.historical?num(old.finish):null});
    });
    state.selected={...r,...(dr||{}),...(hr||{})};
    $("raceInfo").innerHTML=`<b>${esc(state.selected.venue)} ${state.selected.no}R ${esc(state.selected.name||"")}</b><br><span class="small">${esc(state.selected.date||date)} ${esc(state.selected.time||"")} ・${esc(state.selected.surface||"")} ${state.selected.distance?esc(state.selected.distance)+"m":""}${state.selected.course?"・"+esc(state.selected.course):""}${state.selected.going?"・馬場 "+esc(state.selected.going):""}</span>`;
    renderHorses();
  }catch(e){ $("horses").innerHTML=`<div class="status err">${esc(e.message)}</div>`; }
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
  const styles=horses.map(h=>String(h.style||"")).filter(x=>x && x!=="不明");
  const escapers=styles.filter(x=>x.includes("逃げ")).length;
  const front=styles.filter(x=>x.includes("先行")).length;
  if(!styles.length) return {label:"判定不能",escapers:0,front:0,known:0,total:horses.length};
  if(escapers>=4) return {label:"ハイ",escapers,front,known:styles.length,total:horses.length};
  if(escapers>=3) return {label:"ややハイ",escapers,front,known:styles.length,total:horses.length};
  if(escapers<=1 && front<=3) return {label:"スロー",escapers,front,known:styles.length,total:horses.length};
  return {label:"標準",escapers,front,known:styles.length,total:horses.length};
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

const LEARNING_STORAGE_KEY = "keiba_simulator_learning_v15_9"; // 15.9系の学習データを継続利用
const LEARNING_FEATURES = ["market","style","carriedWeight","bodyWeight","sexAge","frame","popularity"];
const BASE_COEFFICIENTS = {
  market: null, style:.22, carriedWeight:.16, bodyWeight:.10,
  sexAge:.08, frame:.08, popularity:.08
};

function defaultLearning(){
  return {
    schema:1,
    trainedRaces:0,
    trainedKeys:[],
    delta:Object.fromEntries(LEARNING_FEATURES.map(k=>[k,0])),
    records:[],
    lastUpdated:""
  };
}

function getLearning(){
  try{
    const raw=localStorage.getItem(LEARNING_STORAGE_KEY);
    if(!raw) return defaultLearning();
    const x=JSON.parse(raw);
    const d=defaultLearning();
    return {
      ...d,...x,
      delta:{...d.delta,...(x.delta||{})},
      trainedKeys:Array.isArray(x.trainedKeys)?x.trainedKeys:[],
      records:Array.isArray(x.records)?x.records:[]
    };
  }catch(_e){ return defaultLearning(); }
}

function saveLearning(x){
  try{localStorage.setItem(LEARNING_STORAGE_KEY,JSON.stringify(x));}catch(_e){}
}

function learningKey(histRace){
  const d=historyDateKey(histRace?.date||"");
  const v=histRace?.venue||codeToVenue(histRace?.venue_code)||"";
  const n=Number(histRace?.no??histRace?.race_number);
  return `${d}|${v}|${n}`;
}

function learningCoefficient(feature,hasOdds,learning){
  const base=feature==="market" ? (hasOdds?.72:1.0) : BASE_COEFFICIENTS[feature];
  const delta=Number(learning?.delta?.[feature]||0);
  return Math.max(.01,Math.min(2.0,base+delta));
}

function trainFromBacktest(histRace,result){
  if(!result?.winner) return {trained:false,reason:"no_result"};
  const key=learningKey(histRace);
  const learning=getLearning();
  if(learning.trainedKeys.includes(key)) return {trained:false,reason:"already_trained",learning};

  const rows=result.ranking||[];
  const winner=rows.find(h=>h.no===result.winner.no);
  if(!winner) return {trained:false,reason:"winner_not_found",learning};

  // Softmaxの正解（実着順1着）に対する勾配。予測完成後にだけ実行する。
  const lr=.035;
  const reg=.002;
  for(const feature of LEARNING_FEATURES){
    const wf=Number(winner.learningFeatures?.[feature]||0);
    let expected=0;
    for(const h of rows){
      expected += (Number(h.prob)||0)*Number(h.learningFeatures?.[feature]||0);
    }
    const grad=wf-expected-reg*Number(learning.delta?.[feature]||0);
    learning.delta[feature]=Math.max(-.75,Math.min(.75,Number(learning.delta?.[feature]||0)+lr*grad));
  }
  learning.trainedRaces++;
  learning.trainedKeys.push(key);
  if(learning.trainedKeys.length>5000) learning.trainedKeys=learning.trainedKeys.slice(-5000);
  learning.records.push({
    key,
    date:historyDateKey(histRace?.date||""),
    venue:histRace?.venue||codeToVenue(histRace?.venue_code)||"",
    no:Number(histRace?.no??histRace?.race_number),
    winnerRank:Number(result.winnerRank)||null,
    top1:!!result.top1,
    top3:!!result.top3,
    top5:!!result.top5,
    trainedAt:new Date().toISOString()
  });
  if(learning.records.length>5000) learning.records=learning.records.slice(-5000);
  learning.lastUpdated=new Date().toISOString();
  saveLearning(learning);
  return {trained:true,learning};
}

function learningSummary(learning=getLearning()){
  const records=Array.isArray(learning.records)?learning.records:[];
  const n=records.length;
  const avgRank=n?records.reduce((s,r)=>s+(Number(r.winnerRank)||0),0)/n:null;
  return {
    races:Number(learning.trainedRaces)||n,
    top1:n?records.filter(r=>r.top1).length/n:null,
    top3:n?records.filter(r=>r.top3).length/n:null,
    top5:n?records.filter(r=>r.top5).length/n:null,
    avgRank,
    delta:{...learning.delta}
  };
}

function buildModel(rawHorses){
  const horses=rawHorses.map(normalizeHorse);
  const pace=inferPace(horses);

  const odds=horses.map(h=>h.odds).filter(x=>x>0);
  const medWeight=median(horses.map(h=>h.carriedWeight).filter(x=>x!=null));
  const medBody=median(horses.map(h=>h.bodyWeight).filter(x=>x!=null));
  const hasOdds=odds.length>0;
  const oddsMarketMean=hasOdds ? odds.reduce((a,x)=>a+(1/x),0)/odds.length : null;
  const popRawVals=horses.map(h=>h.popularity>0 ? 1/Math.sqrt(h.popularity) : null).filter(x=>x!=null);
  const popRawMean=popRawVals.length ? popRawVals.reduce((a,x)=>a+x,0)/popRawVals.length : null;
  // オッズが一部だけ欠けている場合も、欠損馬を0点にしない。
  // 混在時は人気代理値をオッズ逆数の平均スケールへ合わせる。
  const popularityScale=(hasOdds && oddsMarketMean!=null && popRawMean!=null) ? oddsMarketMean/popRawMean : 1;

  const rows=horses.map(h=>{
    const oddsRaw=h.odds>0 ? 1/h.odds : 0;
    const popularityRaw=h.popularity>0 ? 1/Math.sqrt(h.popularity) : 0;
    const marketBase=h.odds>0 ? oddsRaw : (hasOdds ? popularityRaw*popularityScale : popularityRaw);
    const style=styleFactor(h.style,pace.label);

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
    const popularityFactor=popularityRaw>0 ? Math.pow(popularityRaw,.12) : 1;
    const learning=getLearning();
    const coeff={
      market:learningCoefficient("market",hasOdds,learning),
      style:learningCoefficient("style",hasOdds,learning),
      carriedWeight:learningCoefficient("carriedWeight",hasOdds,learning),
      bodyWeight:learningCoefficient("bodyWeight",hasOdds,learning),
      sexAge:learningCoefficient("sexAge",hasOdds,learning),
      frame:learningCoefficient("frame",hasOdds,learning),
      popularity:learningCoefficient("popularity",hasOdds,learning)
    };
    const features={
      market:Math.log(Math.max(marketBase,1e-12)),
      style:Math.log(Math.max(style,1e-12)),
      carriedWeight:Math.log(Math.max(weightFactor,1e-12)),
      bodyWeight:Math.log(Math.max(bodyFactor,1e-12)),
      sexAge:Math.log(Math.max(ageFactor,1e-12)),
      frame:Math.log(Math.max(frameFactor,1e-12)),
      popularity:Math.log(Math.max(popularityFactor,1e-12))
    };
    const raw=Math.exp(
      coeff.market*features.market +
      coeff.style*features.style +
      coeff.carriedWeight*features.carriedWeight +
      coeff.bodyWeight*features.bodyWeight +
      coeff.sexAge*features.sexAge +
      coeff.frame*features.frame +
      coeff.popularity*features.popularity
    );
    const marketSource=h.odds>0 ? "odds" : (h.popularity>0 ? "popularity_proxy" : "none");
    return {...h,score:raw,marketScore:marketBase,marketSource,independentScore:raw/Math.pow(Math.max(marketBase,1e-12),coeff.market),learningFeatures:features,learningCoefficients:coeff,components:{market:marketBase,style,carriedWeight:weightFactor,bodyWeight:bodyFactor,sexAge:ageFactor,frame:frameFactor,popularity:popularityFactor}};
  });
  const sum=rows.reduce((a,h)=>a+h.score,0)||1;
  rows.forEach(h=>h.prob=h.score/sum);
  const learning=getLearning();
  return {horses:rows.sort((a,b)=>b.prob-a.prob),pace,dataCoverage:coverage(rows),hasOdds,learning,learningSummary:learningSummary(learning)};
}
function median(a){
  if(!a.length) return null;
  const x=[...a].sort((a,b)=>a-b);
  const m=Math.floor(x.length/2);
  return x.length%2?x[m]:(x[m-1]+x[m])/2;
}

function coverage(horses){
  const fields=["odds","popularity","bodyWeight","bodyWeightDiff","sexAge","carriedWeight","jockey","style"];
  let have=0,total=horses.length*fields.length;
  for(const h of horses) for(const f of fields){
    if(h[f]!==null && h[f]!==undefined && h[f]!=="" && h[f]!=="不明") have++;
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
    const ev=h.odds>0 ? p1*h.odds : null;
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
      <div><b>逃げ候補</b><strong>${model.pace.known===0?"判定不能":model.pace.escapers+"頭"}</strong></div>
      <div><b>データ充足率</b><strong>${(model.dataCoverage*100).toFixed(1)}%</strong></div>
    </div>

    <div class="note warning">
      単勝オッズが取得できる場合はオッズを市場評価に使用します。
      オッズ未取得の場合は最終人気を市場評価の代理として使用します。
      近走・コース適性・騎手成績・4角位置など存在しないデータは推測・補完していません。
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
      単勝オッズがあれば市場評価として使用し、未取得なら人気順位を代理指標として使用します。
      さらに脚質・ペース・斤量・馬体重・性齢・枠順を利用可能な範囲で補正します。
      存在しない近走・適性・騎手成績・4角位置等は推測していません。
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

async function runIndividualBacktest(race){
  const out=$("individualBacktestResult"); if(!out)return;
  const date=$("date")?.value||today();
  const venue=race?.venue||"";
  const no=Number(race?.no);
  if(!venue||!Number.isFinite(no)){
    out.innerHTML='<div class="status err">バックテスト対象のレース情報が不正です。</div>';
    return;
  }
  out.innerHTML=`<div class="status"><span class="spinner"></span> ${esc(venue)} ${no}R のバックテストを実行中…</div>`;
  try{
    const hr=await getHistoryRace(date,venue,no);
    const result=backtestOne(hr);
    if(!result)throw new Error("指定したレースのバックテストデータを評価できませんでした。");
    const learningResult=trainFromBacktest(hr,result);
    const modelRank=result.winnerRank;
    const winner=result.winner;
    out.innerHTML=`
      <div class="result-head"><b>📊 Ver.${MODEL_VERSION} 個別バックテスト</b><span>${esc(venue)} ${no}R</span></div>
      <div class="note">対象日：<b>${esc(hr.date||date)}</b>。この1レースだけを評価しています。まず発走前データだけで予測を確定し、その後に実着順を使って学習します。着順・4角位置などの結果情報は予測には使用していません。</div>
      <div class="note ${learningResult.trained?'':'warning'}">${learningResult.trained?'このバックテスト結果を学習し、次回以降の予測係数に反映しました。':'このレースは既に学習済みのため、重複学習はしていません。'}<br>学習済みレース数：<b>${learningResult.learning?.trainedRaces??getLearning().trainedRaces}</b></div>
      ${(()=>{const ls=learningSummary(learningResult.learning||getLearning()); const pct=x=>x==null?'—':`${(x*100).toFixed(1)}%`; return `<div class="note"><b>学習状況</b>：本命1着率 ${pct(ls.top1)} ／ 上位3頭率 ${pct(ls.top3)} ／ 上位5頭率 ${pct(ls.top5)} ／ 勝ち馬平均順位 ${ls.avgRank==null?'—':ls.avgRank.toFixed(2)}位</div>`;})()}
      ${(()=>{const l=learningResult.learning||getLearning(); const hasOdds=result.ranking.some(h=>Number(h.odds)>0); const rows=LEARNING_FEATURES.map(f=>{const base=f==='market'?(hasOdds?.72:1):BASE_COEFFICIENTS[f]; const delta=Number(l.delta?.[f]||0); const cur=learningCoefficient(f,hasOdds,l); return `<tr><td>${esc(f)}</td><td>${Number(base).toFixed(3)}</td><td>${delta>=0?'+':''}${delta.toFixed(3)}</td><td>${cur.toFixed(3)}</td></tr>`;}).join(''); return `<h3>学習係数</h3><div class="small">基準係数にバックテスト学習の差分を加えています。差分は${esc(LEARNING_STORAGE_KEY)}に保存されます。</div><div class="table-wrap"><table><thead><tr><th>特徴量</th><th>基準</th><th>学習差分</th><th>現在値</th></tr></thead><tbody>${rows}</tbody></table></div>`;})()}
      <div class="compare-grid">
        <div class="metric-card"><b>本命1着</b><strong>${result.top1?'○':'—'}</strong><small>モデル1位</small></div>
        <div class="metric-card"><b>上位3頭</b><strong>${result.top3?'○':'—'}</strong><small>モデル3位以内</small></div>
        <div class="metric-card"><b>上位5頭</b><strong>${result.top5?'○':'—'}</strong><small>モデル5位以内</small></div>
        <div class="metric-card"><b>勝ち馬順位</b><strong>${modelRank}位</strong><small>モデル順位</small></div>
      </div>
      <h3>最終人気との比較</h3>
      <div class="table-wrap"><table><thead><tr><th>評価</th><th>最終人気</th><th>モデル</th><th>判定</th></tr></thead><tbody>
        <tr><td>本命1着</td><td>${result.favorite1?'○':'—'}</td><td>${result.top1?'○':'—'}</td><td>${result.top1===result.favorite1?'一致':'差あり'}</td></tr>
        <tr><td>上位3頭</td><td>${result.favorite3?'○':'—'}</td><td>${result.top3?'○':'—'}</td><td>${result.top3===result.favorite3?'一致':'差あり'}</td></tr>
        <tr><td>上位5頭</td><td>${result.favorite5?'○':'—'}</td><td>${result.top5?'○':'—'}</td><td>${result.top5===result.favorite5?'一致':'差あり'}</td></tr>
      </tbody></table></div>
      <h3>結果</h3>
      <div class="table-wrap"><table><thead><tr><th>開催</th><th>R</th><th>レース名</th><th>勝ち馬</th><th>人気</th><th>モデル順位</th><th>本命</th><th>上位3</th><th>上位5</th></tr></thead><tbody>
        <tr><td>${esc(venue)}</td><td>${no}R</td><td>${esc(hr.name||race.name||'')}</td><td>${horseLabel(winner.name,winner.no)}</td><td>${winner.popularity??'—'}</td><td>${modelRank}</td><td>${result.top1?'○':'—'}</td><td>${result.top3?'○':'—'}</td><td>${result.top5?'○':'—'}</td></tr>
      </tbody></table></div>
      ${(()=>{
        const all=result.ranking.slice().sort((a,b)=>Number(a.historicalFinish??999)-Number(b.historicalFinish??999));
        const popSorted=all.filter(h=>Number(h.popularity)>0).slice().sort((a,b)=>Number(a.popularity)-Number(b.popularity));
        const popRank=new Map(popSorted.map((h,i)=>[h.no,i+1]));
        const modelRankMap=new Map(result.ranking.map((h,i)=>[h.no,i+1]));
        const evalMark=(finish,mr)=>{
          if(!Number.isFinite(finish)||!Number.isFinite(mr)) return '—';
          if(finish<=5 && mr<=5) return '★★★★★';
          if(finish<=5 && mr<=10) return '★★★★';
          if(finish<=5 && mr<=15) return '★★★';
          if(finish<=5) return '★★';
          if(mr<=5) return '★';
          return '—';
        };
        const rows=all.map(h=>{
          const finish=Number(h.historicalFinish);
          const mr=Number(modelRankMap.get(h.no));
          const pr=Number(popRank.get(h.no));
          const gap=Number.isFinite(finish)&&Number.isFinite(mr)?mr-finish:null;
          const marketGap=Number.isFinite(pr)&&Number.isFinite(mr)?pr-mr:null;
          const cls=Number.isFinite(finish)&&finish<=5?' class="top5-row"':'';
          return `<tr${cls}><td>${Number.isFinite(finish)?finish+'着':'—'}</td><td>${horseLabel(h.name,h.no)}</td><td>${Number.isFinite(pr)?pr+'番人気':(h.popularity??'—')}</td><td><b>${Number.isFinite(mr)?mr+'位':'—'}</b></td><td>${Number(h.prob)>0?(Number(h.prob)*100).toFixed(1)+'%':'—'}</td><td>${gap==null?'—':(gap>0?'+':'')+gap}</td><td>${marketGap==null?'—':(marketGap>0?'+':'')+marketGap}</td><td>${evalMark(finish,mr)}</td></tr>`;
        }).join('');
        return `<h3>全頭：実着順 × モデル順位</h3><div class="small">実着順1〜5着を重点表示。モデル順位は発走前データだけで算出した順位です。「人気差」は最終人気順位−モデル順位で、プラスほどモデルが人気以上に評価しています。</div><div class="table-wrap"><table><thead><tr><th>実着順</th><th>馬</th><th>最終人気</th><th>モデル順位</th><th>1着確率</th><th>実着順との差</th><th>人気差</th><th>評価</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      })()}
    `;
  }catch(e){out.innerHTML=`<div class="status err">${esc(e.message)}</div>`;}
}


/* -------------------- init -------------------- */

async function loadRaces(){
  const date=$("date")?.value||today(); msg("JRA公式データを読み込み中…");
  try{
    if(date<today()){
      const idx=await getHistoryIndex(date);
      state.historyIndex=idx;
      state.races=(idx.races||[]).map(r=>({...r,date:r.date||date,venue:r.venue||codeToVenue(r.venue_code),no:Number(r.no),historical:true})).filter(r=>r.venue&&Number.isFinite(r.no));
      const venues=[...new Set(state.races.map(r=>r.venue))];
      const sel=$("venue"); if(sel)sel.innerHTML='<option value="">全開催</option>'+venues.map(v=>`<option>${esc(v)}</option>`).join("");
      $("officialProgramStatus").innerHTML=`過去レース索引：${esc(idx.updated_at||"取得済み")}<br>レース一覧：${state.races.length}件<br><span class="small">指定したレースだけ詳細データを取得します。</span>`;
      msg(`${date}：過去レース一覧 ${state.races.length}件。レース一覧から「バックテスト」を押してください。`,"ok");
      renderRaces();
      return;
    }
    const daily=await getDaily();
    state.races=buildRaceList(daily,null);
    const venues=[...new Set(state.races.map(r=>r.venue).filter(Boolean))];
    const sel=$("venue"); if(sel)sel.innerHTML='<option value="">全開催</option>'+venues.map(v=>`<option>${esc(v)}</option>`).join("");
    $("officialProgramStatus").innerHTML=`同期日時：${esc(daily.updated_at||"不明")}<br>公式レースリンク：${daily.official_race_links?.length||0}件<br>データパーサー：${esc(daily.parser_version||"不明")}`;
    msg(`${date}：JRA公式同期データ。${venues.join("・")}・${state.races.length}レース`,"ok");
    renderRaces();
  }catch(e){msg(esc(e.message),"err");$("races").innerHTML=`<div class="status err">${esc(e.message)}</div>`;}
}
if($("date")) $("date").value=today();

$("loadBtn")?.addEventListener("click",loadRaces);
$("venue")?.addEventListener("change",renderRaces);
$("simulateBtn")?.addEventListener("click",simulate);
$("backBtn")?.addEventListener("click",()=>{
  $("entryCard")?.classList.add("hidden");
  $("resultCard")?.classList.add("hidden");
});

window.KeibaSimulator={
  version:MODEL_VERSION,
  state,
  buildModel,
  runMonteCarlo,
  backtestOne,
  runIndividualBacktest,
  simulate
};

loadRaces();
