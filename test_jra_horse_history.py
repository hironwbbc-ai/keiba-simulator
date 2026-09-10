#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JRA馬ページ→過去レース詳細のPhase 1検証用。既存アプリは変更しない。"""
from __future__ import annotations
import argparse, datetime as dt, html, json, re, time, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path
BASE='https://www.jra.go.jp'
UA='Mozilla/5.0 (compatible; keiba-simulator/phase1-horse-history-test)'

def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Language':'ja,en;q=0.8'})
    with urllib.request.urlopen(req,timeout=20) as r: return r.read().decode('utf-8',errors='replace')

def clean(s): return re.sub(r'\\s+',' ',html.unescape(s or '')).strip()
def normalize_url(href,base): return urllib.parse.urljoin(base,html.unescape(href))
class TableParser(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True); self.rows=[]; self.row=None; self.cell=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='tr': self.row=[]
        elif self.row is not None and tag in ('td','th'): self.cell={'text':[],'links':[]}
        elif self.cell is not None and tag=='a' and a.get('href'): self.cell['links'].append(a['href'])
    def handle_data(self,data):
        if self.cell is not None: self.cell['text'].append(data)
    def handle_endtag(self,tag):
        if tag in ('td','th') and self.row is not None and self.cell is not None:
            self.row.append({'text':clean(''.join(self.cell['text'])),'links':self.cell['links']}); self.cell=None
        elif tag=='tr' and self.row is not None:
            if self.row: self.rows.append(self.row)
            self.row=None; self.cell=None

def parse_jra_date(s):
    m=re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日',s or '')
    return dt.date(*map(int,m.groups())) if m else None

def extract_horse_name(raw):
    s=html.unescape(raw)
    m=re.search(r'競走馬情報\s*([^<\n]+?)\s*[A-Za-z][A-Za-z .\-\']*（JPN）',s,re.S)
    if m: return clean(m.group(1))
    return ''

def normalize_name(s): return re.sub(r'ブリンカー着用$','',clean(s))

def parse_horse_page(url,target_date,limit):
    raw=fetch(url); p=TableParser(); p.feed(raw); horse=extract_horse_name(raw); races=[]
    for row in p.rows:
        texts=[c['text'] for c in row]
        date_idx=next((i for i,t in enumerate(texts) if re.search(r'\d{4}年\d{1,2}月\d{1,2}日',t)),None)
        if date_idx is None: continue
        d=parse_jra_date(texts[date_idx])
        if d is None or d>=target_date: continue
        link=None
        for c in row:
            for href in c['links']:
                u=normalize_url(href,url)
                if '/JRADB/accessS.html' in u and 'CNAME=' in u: link=u; break
            if link: break
        if not link: continue
        race_name=texts[date_idx+1] if date_idx+1<len(texts) else ''
        races.append({'date':d.isoformat(),'name':race_name,'url':link})
    races.sort(key=lambda x:x['date'],reverse=True); races=races[:limit]
    out=[]
    for i,r in enumerate(races,1):
        print(f'[{i}/{len(races)}] {r["date"]} {r["name"]}')
        try: r.update(parse_race_result(r['url'],horse))
        except Exception as e: r['error']=repr(e); print('  ERROR:',repr(e))
        out.append(r); time.sleep(.35)
    return {'horse':horse,'horse_url':url,'as_of':target_date.isoformat(),'leakage_rule':'date < as_of','races':out}

def parse_race_result(url,horse_name):
    raw=fetch(url); p=TableParser(); p.feed(raw); text=clean(re.sub(r'<[^>]+>',' ',raw))
    m=re.search(r'コース\s*[:：]\s*([0-9,]+)\s*メートル\s*（([^）]+)）',text)
    distance=int(m.group(1).replace(',','')) if m else None
    parts=m.group(2) if m else ''
    surface='芝' if '芝' in parts else ('ダート' if 'ダ' in parts else None)
    course='右' if '右' in parts else ('左' if '左' in parts else ('直' if '直' in parts else None))
    gm=re.search(r'(?:芝|ダート)(良|稍重|重|不良)',text); going=gm.group(1) if gm else None
    horse_row=None; horse_no=None
    for row in p.rows:
        texts=[c['text'] for c in row]
        if normalize_name(horse_name) not in normalize_name(' '.join(texts)): continue
        horse_row=texts
        nums=[int(t) for t in texts[:5] if re.fullmatch(r'\d{1,2}',t.strip())]
        if len(nums)>=3: horse_no=nums[2]
        elif nums: horse_no=nums[-1]
        break
    if horse_row is None: raise RuntimeError(f'対象馬の結果行を発見できません: {horse_name}')
    corners=extract_corner_text(text)
    return {'result_url':url,'race_date':(parse_jra_date(text).isoformat() if parse_jra_date(text) else None),'distance':distance,'surface':surface,'course':course,'going':going,'horse_no':horse_no,'finish':first_int(horse_row[0]),'time':find_time(horse_row),'body_weight':find_body_weight(horse_row),'corner3':position_from_corner_text(corners.get('3'),horse_no),'corner4':position_from_corner_text(corners.get('4'),horse_no),'corner_raw':corners}

def first_int(s):
    m=re.search(r'\d+',str(s)); return int(m.group()) if m else None
def find_time(cells):
    for s in cells:
        if re.fullmatch(r'\d{1,2}:\d{2}\.\d',s.strip()): return s.strip()
    return None
def find_body_weight(cells):
    for s in cells:
        m=re.fullmatch(r'(\d{3})\(([+-]?\d+)\)',s.strip())
        if m: return {'weight':int(m.group(1)),'diff':int(m.group(2))}
    return None
def extract_corner_text(text):
    return {str(n):m.group(1) for n in (1,2,3,4) if (m:=re.search(rf'{n}コーナー\s+([0-9,\-()=]+)',text))}
def position_from_corner_text(s,horse_no):
    if not s or horse_no is None: return None
    nums=[int(x) for x in re.findall(r'\d+',s)]
    return next((i for i,n in enumerate(nums,1) if n==horse_no),None)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--horse-url',required=True); ap.add_argument('--before',required=True); ap.add_argument('--limit',type=int,default=5); ap.add_argument('--output',default='horse_history_test.json'); a=ap.parse_args()
    result=parse_horse_page(a.horse_url,dt.date.fromisoformat(a.before),max(1,a.limit))
    Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8'); print('WROTE:',a.output)
if __name__=='__main__': main()
