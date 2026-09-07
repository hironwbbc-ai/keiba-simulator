
const $=id=>document.getElementById(id);
const state={races:[],horses:[],selected:null,history:null};
function today(){
  return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date()).replace(/\//g,"-");
}
$("date").value=today();

const VENUES={
  "中山":{code:"06",meet:"4回中山1日"},
  "阪神":{code:"09",meet:"4回阪神1日"},
  "札幌":{code:"01",meet:"2回札幌5日"}
};

/* Current 2026-09-05 official JRA entry-page URLs.
   These are internal fallback anchors so the user never has to type a URL.
   For other dates/races, the app uses the official calendar but may need
   a future adapter because JRA's accessD link contains a changing checksum. */
const KNOWN={
 "2026-09-05":{
   "中山":{2:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010220260905/F7",4:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010420260905/61",6:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010620260905/CB",7:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010720260905/80",9:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010920260905/EA",10:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604011020260905/DF",11:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604011120260905/94"},
   "阪神":{2:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0109202604010220260905/D5",3:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0109202604010320260905/8A",4:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0109202604010420260905/3F",9:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0109202604010920260905/C8",11:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0109202604011120260905/72"},
   "札幌":{3:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0101202602050320260905/A4",5:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0101202602050520260905/0E",7:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0101202602050720260905/78",10:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0101202602051020260905/D7",11:"https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0101202602051120260905/8C"}
 }
};

async function jina(url){
 const candidates=[
   "https://r.jina.ai/"+url,
   "https://r.jina.ai/http://"+url.replace(/^https?:\/\//,"")
 ];
 let last="";
 for(const u of candidates){
   for(let n=0;n<2;n++){
     try{
       const r=await fetch(u,{headers:{Accept:"text/plain"},cache:"no-store"});
       if(!r.ok){last="取得サーバーHTTP "+r.status;continue}
       const t=await r.text();
       if(t && t.length>500)return t;
       last="取得内容が空でした";
     }catch(e){last=e.message||String(e)}
     await new Promise(res=>setTimeout(res,350));
   }
 }
 throw new Error(last||"取得できませんでした");
}
function extractAccessLinks(text){
 const urls=[];
 const re=/(https?:\/\/www\.jra\.go\.jp\/JRADB\/accessD\.html\?CNAME=[^\s)\]"<>]+)/g;
 let m;while((m=re.exec(text))){
   const u=m[1].replace(/&amp;/g,"&").replace(/[.,]+$/g,"");
   if(!urls.includes(u))urls.push(u);
 }
 return urls;
}
function identifyRaceFromUrl(u){
 const m=u.match(/pw01dde(\d{2})(\d{4})(\d{2})(\d{2})(\d{8})\/[0-9A-F]{2}$/i);
 return m?{venueCode:m[1],meetCode:m[2],no:+m[3],date:`${m[5].slice(0,4)}-${m[5].slice(4,6)}-${m[5].slice(6,8)}`}:null;
}

function msg(t,c=""){ $("status").innerHTML=t;$("status").className="status "+c; }

function parseCalendar(text,date){
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const races=[]; let venue="";
 const names=["中山","阪神","札幌","東京","京都","中京","新潟","福島","小倉","函館"];
 for(let i=0;i<lines.length;i++){
   const vm=lines[i].match(/^\d+回(.+?)\d+日$/);
   if(vm && names.includes(vm[1])){venue=vm[1];continue}
   const rm=lines[i].match(/^(\d{1,2})レース\s*\|?\s*(.*)$/);
   if(rm && venue){
     let info=rm[2].replace(/\s*\|\s*/g," ").trim();
     if(!info && lines[i+1]) info=lines[i+1].replace(/\s*\|\s*/g," ").trim();
     const next=lines[i+1]||"";
     const tm=(next.match(/(\d{1,2})時(\d{2})分/)||lines[i].match(/(\d{1,2})時(\d{2})分/));
     races.push({date,venue,no:+rm[1],name:info||"レース",time:tm?`${tm[1].padStart(2,"0")}:${tm[2]}`:""});
   }
 }
 return races;
}

function parseMeta(text){
 const m={};
 const dm=text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
 if(dm)m.date=`${dm[1]}-${String(dm[2]).padStart(2,"0")}-${String(dm[3]).padStart(2,"0")}`;
 const meet=text.match(/\d+回(.+?)\d+日/);if(meet)m.venue=meet[1];
 const rn=text.match(/(\d{1,2})レース/);if(rn)m.no=+rn[1];
 const tm=text.match(/発走時刻：(\d{1,2})時(\d{2})分/);if(tm)m.time=`${tm[1].padStart(2,"0")}:${tm[2]}`;
 const nm=text.match(/##\s*(?:第\d+回)?(.+?)(?:\n|$)/);if(nm)m.name=nm[1].trim();
 const d=text.match(/([\d,]+)メートル（(芝|ダート)・([^）]+)）/);
 if(d){m.distance=parseInt(d[1].replace(/,/g,""));m.surface=d[2];m.course=d[3]}
 const g=text.match(/(?:芝|ダート)(?:・[^ \n]+)?\s*(良|稍重|重|不良)/);if(g)m.going=g[1];
 return m;
}
function inferStyle(past){
 const p=[];
 for(const s of past){
   const nums=(s.match(/\b\d{1,2}\b/g)||[]).map(Number).filter(n=>n>=1&&n<=18);
   if(nums.length>=4)p.push(nums[0]);
 }
 if(!p.length)return"不明";
 const a=p.reduce((x,y)=>x+y,0)/p.length;
 return a<=3?"逃げ・先行":a<=7?"先行・好位":a<=11?"差し":"追込";
}
function parseHorses(text){
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),out=[];
 for(let i=0;i<lines.length;i++){
   let a=lines[i].match(/(?:\|\s*)?(\d{1,2})\s*\|\s*(?:[^\|]+\|\s*)?([^|]+?)\s+([\d.]+)\s*\((\d+)番人気\)/);
   if(!a)a=lines[i].match(/^(\d{1,2})\s*\|?\s+([^|]+?)\s+([\d.]+)\s*\((\d+)番人気\)/);
   if(!a)a=lines[i].match(/^(\d{1,2})\s+([^\s]+)\s+([\d.]+)\((\d+)番人気\)/);
   if(!a)continue;
   const no=+a[1],name=a[2].trim(),odds=parseFloat(a[3]);
   if(no<1||no>18||!name||!isFinite(odds))continue;
   let weight=null,jockey="",past=[];
   for(let j=i+1;j<Math.min(i+10,lines.length);j++){
     if(/(?:Image: 枠|\|\s*\d+\s*\|)/.test(lines[j]))break;
     const w=lines[j].match(/(\d+(?:\.\d+)?)\s*kg/);if(w&&!weight)weight=parseFloat(w[1]);
     const parts=lines[j].split("|").map(s=>s.trim()).filter(Boolean);
     if(parts.length&&/kg/.test(lines[j])){const z=parts.find(s=>/kg/.test(s));if(z)jockey=z.replace(/^.*?kg\s*/,"").trim()}
     if(/\d{4}年/.test(lines[j]))past.push(lines[j]);
   }
   out.push({no,name,odds,weight,jockey,style:inferStyle(past)});
 }
 const seen=new Set();return out.filter(h=>{if(seen.has(h.no))return false;seen.add(h.no);return true}).sort((a,b)=>a.no-b.no);
}

function renderRaces(){
 const box=$("races");box.innerHTML="";
 const venue=$("venue").value;
 const list=state.races.filter(r=>!venue||r.venue===venue);
 if(!list.length){box.innerHTML='<div class="note">該当するレースがありません。</div>';return}
 list.forEach(r=>{
   const d=document.createElement("div");d.className="race";
   const historical=!!r.historical;
   d.innerHTML=`<b>${r.venue} ${r.no}R ${r.name||"レース"}</b><br><span class="small">${r.time||""}${historical?"・結果済み":""}</span>`;
   const b=document.createElement("button");b.textContent=historical?"結果・バックテスト":"このレースを選択";b.onclick=()=>historical?renderHistoricalRace(r):selectRace(r);d.appendChild(b);
   box.appendChild(d);
 });
}
function selectRace(r){
 state.selected=r;$("entryCard").classList.remove("hidden");
 $("raceInfo").innerHTML=`<b>${r.venue} ${r.no}R ${r.name}</b><br><span class="small">${r.date} ${r.time||""}</span>`;
 $("horses").innerHTML='<div class="status"><span class="spinner"></span> 出馬表を取得中…</div>';
 $("resultCard").classList.add("hidden");
 loadEntry(r);
}

let DAILY=null;
async function getDaily(){
  if(DAILY)return DAILY;
  const r=await fetch("./data/jra_daily.json?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("同期データがまだありません");
  DAILY=await r.json();
  return DAILY;
}

let HISTORY=null;
async function getHistory(){
  if(HISTORY)return HISTORY;
  const r=await fetch("./data/jra_history.json?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("過去レースの同期データがまだありません。GitHub Actionsで指定日を実行してください。");
  HISTORY=await r.json();
  return HISTORY;
}

function renderHistoricalRace(r){
  state.selected=r;
  $("entryCard").classList.remove("hidden");
  $("resultCard").classList.add("hidden");
  $("raceInfo").innerHTML=`<b>${r.venue} ${r.no}R ${r.name||"レース"}</b><br><span class="small">${r.date} ${r.time||""}・${r.surface||""} ${r.distance?r.distance+"m":""}・結果データ</span>`;
  state.horses=r.horses||[];
  renderHistoricalHorses();
}
function renderHistoricalHorses(){
  const hs=state.horses.slice().sort((a,b)=>(a.finish||99)-(b.finish||99));
  $("horses").innerHTML=`<div class="small" style="margin-bottom:6px">${hs.length}頭・JRA公式レース結果</div><div style="overflow-x:auto"><table><thead><tr><th>着順</th><th>馬番</th><th>馬名</th><th>人気</th><th>騎手</th><th>馬体重</th></tr></thead><tbody>${hs.map(h=>`<tr><td><b>${h.finish??"-"}</b></td><td>${h.no}</td><td><b>${h.name}</b></td><td>${h.popularity??"-"}</td><td>${h.jockey||"-"}</td><td>${h.bodyWeight??"-"}${h.bodyWeightDiff!=null?` (${h.bodyWeightDiff>0?"+":""}${h.bodyWeightDiff})`:""}</td></tr>`).join("")}</tbody></table></div><div class="note" style="margin-top:8px">過去レースは確定後データです。バックテストでは最終人気を市場ベースの指標として使用します。</div>`;
}
function runHistoricalBacktest(){
  if(!state.selected||!state.horses.length)return;
  const hs=state.horses.map(h=>({...h,p:h.popularity?1/Number(h.popularity):0})).filter(h=>h.p>0);
  hs.sort((a,b)=>b.p-a.p);
  const top=hs.slice(0,5);
  const actual=hs.find(h=>Number(h.finish)===1);
  const hit=top.some(h=>Number(h.finish)===1);
  const exact=top[0]&&Number(top[0].finish)===1;
  $("resultCard").classList.remove("hidden");
  $("result").innerHTML=`<div class="note">過去レースバックテスト：最終人気を市場評価として、人気順ベースで予測しています。これは予想モデルの性能確認用で、最終オッズを事前予測データとして扱うものではありません。</div><div class="pill">本命1着：${exact?"的中":"不的中"}</div><div class="pill">上位5頭に勝ち馬：${hit?"的中":"不的中"}</div><div style="margin-top:8px">実際の1着：<b>${actual?actual.no+" "+actual.name:"不明"}</b></div><table style="margin-top:8px"><thead><tr><th>予測</th><th>馬</th><th>人気</th><th>実着順</th></tr></thead><tbody>${top.map((h,i)=>`<tr><td>${i+1}</td><td><b>${h.no} ${h.name}</b></td><td>${h.popularity}</td><td>${h.finish??"-"}</td></tr>`).join("")}</tbody></table>`;
  $("resultCard").scrollIntoView({behavior:"smooth"});
}

async function loadEntry(r){
 try{
   const d=await getDaily();
   const rr=(d.races||[]).find(x=>x.date===r.date&&x.venue===r.venue&&Number(x.no)===Number(r.no));
   if(!rr)throw new Error("このレースのJRA公式同期データがありません。次回同期を待つか再実行してください。");

   if(Array.isArray(rr.horses)&&rr.horses.length){
     state.horses=rr.horses;
     $("raceInfo").innerHTML=`<b>${rr.venue} ${rr.no}R ${rr.name||r.name}</b><br><span class="small">${rr.date} ${rr.time||r.time||""}・${rr.surface||""} ${rr.distance?rr.distance+"m":""}・馬場 ${rr.going||"不明"}</span>`;
     renderHorses();
     return;
   }

   // サーバー側で馬データを解析できなかった場合のみ、公式URLを
   // 既存の外部取得経路で再試行する。
   if(!rr.url)throw new Error("JRA公式出馬表URLがありません");
   const text=await jina(rr.url);
   const meta=parseMeta(text),hs=parseHorses(text);
   if(!hs.length)throw new Error("JRAページは取得できましたが、馬データを解析できませんでした");
   state.horses=hs;
   $("raceInfo").innerHTML=`<b>${meta.venue||r.venue} ${meta.no||r.no}R ${meta.name||r.name}</b><br><span class="small">${meta.date||r.date} ${meta.time||r.time||""}・${meta.surface||""} ${meta.distance?meta.distance+"m":""}・馬場 ${meta.going||"不明"}</span>`;
   renderHorses();
 }catch(e){
   $("horses").innerHTML=`<div class="status err">出馬表を取得できませんでした：${e.message}<br><span class="small">GitHub ActionsでJRA公式データを同期してから、もう一度レースを選択してください。</span></div>`;
 }
}

function normalizeHorse(h){
  return {
    no:Number(h.no ?? h.number), name:h.name||"", odds:Number(h.odds ?? 0),
    popularity:h.popularity ?? null,
    bodyWeight:h.bodyWeight ?? h.body_weight ?? null,
    bodyWeightDiff:h.bodyWeightDiff ?? h.body_weight_diff ?? null,
    sexAge:h.sexAge ?? h.sex_age ?? "",
    carriedWeight:h.carriedWeight ?? h.carried_weight ?? null,
    jockey:h.jockey||"", style:h.style||"不明"
  };
}
function renderHorses(){
 const hs=state.horses.map(normalizeHorse).sort((a,b)=>a.no-b.no);
 $("horses").innerHTML=`<div class="small" style="margin-bottom:6px">${hs.length}頭・JRA公式同期データ</div><div style="overflow-x:auto"><table><thead><tr><th>馬番</th><th>馬名</th><th>性齢</th><th>騎手</th><th>斤量</th><th>馬体重</th><th>単勝</th><th>人気</th></tr></thead><tbody>${
 hs.map(h=>`<tr><td><b>${h.no}</b></td><td><b>${h.name}</b></td><td>${h.sexAge||"-"}</td><td>${h.jockey||"-"}</td><td>${h.carriedWeight??"-"}kg</td><td>${h.bodyWeight??"-"}${h.bodyWeightDiff!=null?` (${h.bodyWeightDiff>0?"+":""}${h.bodyWeightDiff})`:""}</td><td>${h.odds>0?h.odds:"-"}</td><td>${h.popularity??"-"}</td></tr>`).join("")}
 </tbody></table></div>`;
}
function simulate(){
 if(!state.horses.length)return;
 const hs=state.horses.map(normalizeHorse).filter(h=>h.odds>0).map(h=>{
   const p=1/Math.max(h.odds,.1);
   const styleBonus=h.style.includes("逃げ")?1.06:h.style.includes("先行")?1.04:h.style.includes("差し")?1.02:.98;
   return {...h,score:p*styleBonus};
 });
 const sum=hs.reduce((a,h)=>a+h.score,0);
 hs.forEach(h=>h.win=h.score/sum);
 hs.sort((a,b)=>b.win-a.win);
 $("resultCard").classList.remove("hidden");
 $("result").innerHTML='<div class="note">現段階はVer.8.3の基礎モデルです。JRA単勝オッズを基準にした参考シミュレーションで、過去走・展開・馬場・騎手などをまだ本格的には評価していません。</div><table><thead><tr><th>順位</th><th>馬</th><th>勝率目安</th><th>単勝</th><th>期待値目安</th></tr></thead><tbody>'+hs.slice(0,10).map((h,i)=>`<tr><td>${i+1}</td><td><b>${h.no} ${h.name}</b></td><td>${(h.win*100).toFixed(1)}%</td><td>${h.odds}</td><td>${(h.win*h.odds).toFixed(2)}</td></tr>`).join('')+'</tbody></table>';
 $("resultCard").scrollIntoView({behavior:"smooth"});
}
$("venue").onchange=renderRaces;
$("backBtn").onclick=()=>{$("entryCard").classList.add("hidden");$("resultCard").classList.add("hidden");};
$("simulateBtn").onclick=()=>state.selected?.historical?runHistoricalBacktest():simulate();

$("loadBtn").onclick=async()=>{
 $("loadBtn").disabled=true;msg('<span class="spinner"></span> JRA公式同期データを読み込み中…');
 try{
   const d=$("date").value||today();
   const todayIso=today();

   // 過去日はJRA公式レース結果データへ切り替える。
   if(d < todayIso){
     const h=await getHistory();
     if(h.date!==d)throw new Error(`過去データは${h.date}が同期されています。GitHub Actionsで${d.replaceAll("-","")}を指定して実行してください。`);
     state.races=(h.races||[]).map(r=>({...r,date:r.date||d,historical:true}));
     const venues=[...new Set(state.races.map(r=>r.venue))];
     $("venue").innerHTML=venues.map(v=>`<option value="${v}">${v}</option>`).join("");
     renderRaces();
     msg(`${d}：JRA公式の過去レース結果。${venues.join("・")}・${state.races.length}レース` ,"ok");
     return;
   }

   const daily=await getDaily();

   if(Array.isArray(daily.races) && daily.races.length && d===daily.date){
     state.races=daily.races.map(r=>({...r,date:r.date||d}));
     const venues=[...new Set(state.races.map(r=>r.venue))];
     $("venue").innerHTML=venues.map(v=>`<option value="${v}">${v}</option>`).join("");
     renderRaces();
     msg(`${d}：JRA公式同期済み。${venues.join("・")}・${state.races.length}レース`,"ok");
     return;
   }

   // 過去日・将来日の選択時は従来の開催日程取得へフォールバック。
   const [y,m,day]=d.split("-");
   const url=`https://www.jra.go.jp/keiba/calendar${y}/${y}/${parseInt(m)}/${m}${day}.html`;
   const text=await jina(url);
   const races=parseCalendar(text,d);
   if(!races.length)throw new Error("開催情報を解析できませんでした");
   state.races=races;
   const venues=[...new Set(races.map(r=>r.venue))];
   $("venue").innerHTML=venues.map(v=>`<option value="${v}">${v}</option>`).join("");
   renderRaces();
   msg(`${d}：開催日程を取得しました。出馬表は当日同期後に利用できます。`,"ok");
 }catch(e){
   msg(`開催情報を取得できませんでした：${e.message}`,"err");
 }finally{$("loadBtn").disabled=false}
};

