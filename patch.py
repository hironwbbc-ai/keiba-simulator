from pathlib import Path
p=Path('/mnt/data/work/pwa/app.js')
s=p.read_text()
s=s.replace('const today=()=>new Date().toISOString().slice(0,10);', '''function today(){
  return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date()).replace(/\\//g,"-");
}''')
start=s.index('function renderHorses(){')
end=s.index('function simulate(){', start)
render='''function normalizeHorse(h){
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
'''
s=s[:start]+render+s[end:]
start=s.index('function simulate(){')
end=s.index('$('+'"venue"'+').onchange=renderRaces;', start)
sim='''function simulate(){
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
'''
s=s[:start]+sim+s[end:]
# replace load button logic block to prioritize synced daily and show all races
old='''   if(d===daily.date && Array.isArray(daily.races) && daily.races.length){
     state.races=daily.races.map(r=>({...r,date:r.date||d}));'''
new='''   if(Array.isArray(daily.races) && daily.races.length && d===daily.date){
     state.races=daily.races.map(r=>({...r,date:r.date||d}));'''
s=s.replace(old,new)
p.write_text(s)

h=Path('/mnt/data/work/pwa/index.html')
t=h.read_text()
t=t.replace('Ver.8.2','Ver.8.3')
t=t.replace('URL入力なし・JRA公式同期 → レース選択 → 出馬表自動取得','JRA公式同期JSON → 36レース自動表示 → 出馬表 → シミュレーション')
t=t.replace('JRA公式の開催日程を取得します。','GitHub Actionsで同期したJRA公式データを優先して読み込みます。')
t=t.replace('Ver.8.2のポイント','Ver.8.3のポイント')
t=t.replace('URL入力はありません。GitHub ActionsがJRA公式の出馬表ルートを自動巡回し、当日の各競馬場・各レースの出馬表と単勝オッズを同期します。iPhone側は同期済みJSONを読むため、ブラウザからJRAへ直接アクセスする必要がありません。','URL入力はありません。GitHub ActionsがJRA公式の出馬表を同期し、iPhone側は data/jra_daily.json を読み込みます。36レースが同期済みなら、札幌・中山・阪神など開催場と全レースを自動表示します。')
h.write_text(t)

sw=Path('/mnt/data/work/pwa/sw.js')
sw.write_text('''const CACHE="keiba-v83";\nself.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));\nself.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));\nself.addEventListener("fetch",e=>{\n  if(new URL(e.request.url).pathname.endsWith("/data/jra_daily.json")) return;\n  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));\n});\n''')

m=Path('/mnt/data/work/pwa/manifest.webmanifest')
mt=m.read_text().replace('Ver.8.0','Ver.8.3')
m.write_text(mt)
