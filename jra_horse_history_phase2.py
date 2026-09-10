#!/usr/bin/env python3
# JRA horse history Phase 2
# Target: collect horse-specific pre-race history from JRA official horse pages.
# IMPORTANT: all historical features are filtered to races strictly BEFORE target date.
from __future__ import annotations
import argparse, datetime as dt, html as htmlmod, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

BASE = "https://www.jra.go.jp"
UA = "keiba-simulator/15.0 (+https://github.com/hironwbbc-ai/keiba-simulator)"
VENUES = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"}

def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    for enc in ("cp932", "shift_jis", "utf-8"):
        try:
            s = raw.decode(enc)
            if "<html" in s.lower() or "JRADB" in s:
                return s
        except UnicodeDecodeError:
            pass
    return raw.decode("cp932", "replace")

def strip_tags(s):
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s, flags=re.S)
    return re.sub(r"[ \t\r\f\v]+", " ", htmlmod.unescape(s)).strip()

def norm_name(s):
    s = strip_tags(s)
    s = re.sub(r"（[^）]*）", "", s)
    s = re.sub(r"\s+", "", s)
    s = s.replace("ブリンカー着用", "").replace("カクガイ", "")
    s = re.sub(r"Image:.*$", "", s)
    return s

def absolute(href):
    return urllib.parse.urljoin(BASE + "/", htmlmod.unescape(href))

def horse_token_from_url(url):
    m = re.search(r"pw01dud([^/?]+)", urllib.parse.unquote(url), re.I)
    return m.group(1) if m else ""

def result_token_from_url(url):
    s = urllib.parse.unquote(url)
    m = re.search(r"(pw01sde[^/?\"']+/[0-9A-Fa-f]{2})", s, re.I)
    return m.group(1) if m else ""

def extract_horse_links(race_html):
    # Restrict to horse-row-ish <tr> blocks and collect accessU links.
    out = {}
    for tr in re.findall(r"<tr\b[^>]*>.*?</tr>", race_html, re.I | re.S):
        if not re.search(r"accessU\.html", tr, re.I):
            continue
        links = re.findall(r'href\s*=\s*["\']([^"\']*accessU\.html\?CNAME=[^"\']+)["\']', tr, re.I)
        if not links:
            continue
        href = absolute(links[0])
        name_match = re.search(r'accessU\.html\?CNAME=[^"\']+', tr, re.I)
        text = strip_tags(tr)
        # Prefer anchor text attached to the accessU link.
        nm = ""
        a = re.search(r'<a[^>]*href\s*=\s*["\'][^"\']*accessU\.html\?CNAME=[^"\']+["\'][^>]*>(.*?)</a>', tr, re.I | re.S)
        if a:
            nm = norm_name(a.group(1))
        if not nm:
            nm = norm_name(text)
        tok = urllib.parse.unquote(href).split("CNAME=",1)[-1]
        out[tok] = {"horse_url": href, "horse_name": nm}
    return list(out.values())

def parse_horse_page(horse_html, before_date):
    # Find the "出走レース" table.
    tables = re.findall(r"<table\b[^>]*>.*?</table>", horse_html, re.I | re.S)
    target = None
    for t in tables:
        if "出走レース" in strip_tags(t) and "年月日" in strip_tags(t):
            target = t
            break
    if target is None:
        raise RuntimeError("出走レーステーブルを発見できませんでした")
    rows = []
    for tr in re.findall(r"<tr\b[^>]*>.*?</tr>", target, re.I | re.S):
        cells = re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, re.I | re.S)
        vals = [strip_tags(c) for c in cells]
        if len(vals) < 8:
            continue
        date_m = re.search(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日", vals[0])
        if not date_m:
            continue
        race_date = dt.date(int(date_m.group(1)), int(date_m.group(2)), int(date_m.group(3)))
        if race_date >= before_date:
            continue
        # Locate the race-result link in this row.
        links = re.findall(r'href\s*=\s*["\']([^"\']*accessS\.html\?CNAME=[^"\']+)["\']', tr, re.I)
        result_url = absolute(links[0]) if links else ""
        race_name = vals[2] if len(vals) > 2 else ""
        distance = vals[3] if len(vals) > 3 else ""
        going = vals[4] if len(vals) > 4 else ""
        try: field_size = int(re.search(r"\d+", vals[5]).group()) if len(vals)>5 else None
        except: field_size = None
        try: popularity = int(re.search(r"\d+", vals[6]).group()) if len(vals)>6 else None
        except: popularity = None
        try: finish = int(re.search(r"\d+", vals[7]).group()) if len(vals)>7 else None
        except: finish = None
        rows.append({
            "date": race_date.isoformat(),
            "venue": vals[1] if len(vals)>1 else "",
            "race_name": race_name,
            "distance_raw": distance,
            "going": going,
            "field_size": field_size,
            "popularity": popularity,
            "finish": finish,
            "jockey": vals[8] if len(vals)>8 else "",
            "carried_weight": vals[9] if len(vals)>9 else "",
            "body_weight": vals[10] if len(vals)>10 else "",
            "time": vals[11] if len(vals)>11 else "",
            "rating": vals[12] if len(vals)>12 else "",
            "winner": vals[13] if len(vals)>13 else "",
            "result_url": result_url,
        })
    return rows

def find_result_row(result_html, horse_token):
    # Match the horse's accessU link token, then use its surrounding row.
    needle = re.escape(urllib.parse.unquote(horse_token))
    for tr in re.findall(r"<tr\b[^>]*>.*?</tr>", result_html, re.I | re.S):
        if re.search(r"accessU\.html\?CNAME=.*" + needle, tr, re.I):
            return tr
    # Fallback: token may be encoded.
    compact = re.sub(r"%2f", "/", horse_token, flags=re.I)
    for tr in re.findall(r"<tr\b[^>]*>.*?</tr>", result_html, re.I | re.S):
        if compact.lower() in urllib.parse.unquote(tr).lower():
            return tr
    return None

def parse_corners_from_row(tr):
    text = strip_tags(tr)
    # JRA result rows contain two corner numbers for short races and usually 3/4
    # for longer races. Capture all compact numeric blocks near the end is unsafe,
    # so use explicit "コーナー" labels when available; fallback to row numeric sequence.
    # Most robust fallback: search for the two/three/four standalone position values
    # after jockey/time fields is not stable. Instead parse the full result page's
    # corner section and map horse numbers separately.
    return None

def parse_result_context(result_html, horse_name):
    text = strip_tags(result_html)
    # Race-level corner lines are stable in JRA results.
    m3 = re.search(r"3コーナー\s+(.*?)(?:\n4コーナー\s+|\n払戻金|\Z)", text, re.S)
    m4 = re.search(r"4コーナー\s+(.*?)(?:\n払戻金|\Z)", text, re.S)
    if not m3 and not m4:
        return {}
    # Build position maps from strings such as "9,3(2,7)8..."
    def parse_corner_line(raw):
        raw = raw.replace(" ", "").replace("　","")
        # Expand groups and separators while retaining horse numbers.
        nums = [int(x) for x in re.findall(r"\d{1,2}", raw)]
        return nums
    c3 = parse_corner_line(m3.group(1)) if m3 else []
    c4 = parse_corner_line(m4.group(1)) if m4 else []
    # We need horse number, not rank in sequence. Result row contains the horse number.
    return {"corner3_sequence": c3, "corner4_sequence": c4}

def parse_horse_result_row(tr):
    # Extract horse number from the result row and basic fields.
    vals = [strip_tags(c) for c in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, re.I | re.S)]
    if not vals:
        return {}
    # Number is first numeric cell; avoid finish number by using first two numeric cells.
    nums = [int(x) for x in re.findall(r"(?<!\d)(\d{1,2})(?!\d)", vals[0] if vals else "")]
    return {"text": strip_tags(tr), "cells": vals}

def corner_position_for_horse(sequence_text, horse_no):
    # Parse JRA compact corner passage notation into a mapping from horse number to
    # ordinal position. The notation lists horse numbers in running order.
    s = sequence_text.replace(" ", "").replace("　","")
    groups = re.findall(r"\(([^)]*)\)|([^=]+?)(?:-|=|$)", s)
    # Easier: remove parentheses but preserve all horse numbers in order.
    nums = [int(x) for x in re.findall(r"\d{1,2}", s)]
    if horse_no in nums:
        return nums.index(horse_no) + 1
    return None

def enrich_corners(result_html, horse_number):
    text = strip_tags(result_html)
    out = {}
    for label, key in (("3コーナー","corner3"),("4コーナー","corner4")):
        m = re.search(re.escape(label) + r"\s+(.*?)(?:\n(?:4コーナー|払戻金)|\Z)", text, re.S) if label=="3コーナー" else re.search(r"4コーナー\s+(.*?)(?:\n払戻金|\Z)", text, re.S)
        if m:
            seq = m.group(1).strip().splitlines()[0]
            out[key] = corner_position_for_horse(seq, horse_number)
            out[key + "Raw"] = seq
    return out

def extract_horse_number(result_html, horse_token):
    tr = find_result_row(result_html, horse_token)
    if not tr:
        return None
    # Prefer the explicit horse-number cell if present.
    m = re.search(r'<td[^>]*class=["\'][^"\']*\bnum\b[^"\']*["\'][^>]*>\s*(\d{1,2})\s*</td>', tr, re.I | re.S)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 18:
            return n
    vals = [strip_tags(c) for c in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, re.I | re.S)]
    # Fallback: result rows normally begin finish, frame, horse number.
    nums = []
    for v in vals[:5]:
        m = re.search(r"(?<!\d)(\d{1,2})(?!\d)", v)
        if m:
            nums.append(int(m.group(1)))
    return nums[2] if len(nums) >= 3 else (nums[-1] if nums else None)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="target race date YYYYMMDD")
    ap.add_argument("--input", default="", help="history JSON; defaults to data/history/YYYYMMDD.json")
    ap.add_argument("--max-runs", type=int, default=12)
    ap.add_argument("--sleep", type=float, default=0.25)
    args = ap.parse_args()
    target = dt.datetime.strptime(args.date, "%Y%m%d").date()
    src = Path(args.input or f"data/history/{args.date}.json")
    data = json.loads(src.read_text(encoding="utf-8"))
    races = data["races"]

    # Phase 2 starts from the actual race-result pages so horse URLs are official JRA IDs.
    horses = {}
    for r in races:
        url = r.get("url")
        if not url:
            continue
        try:
            html = fetch(url)
            for h in extract_horse_links(html):
                tok = urllib.parse.unquote(h["horse_url"].split("CNAME=",1)[-1])
                horses.setdefault(tok, {"horse_url": h["horse_url"], "horse_name": h["horse_name"]})
        except Exception as e:
            print("WARN race page:", r.get("venue"), r.get("no"), repr(e))
        time.sleep(args.sleep)

    print("TARGET HORSES:", len(horses))
    out_horses = []
    failures = []

    for i, (horse_token, info) in enumerate(sorted(horses.items()), 1):
        try:
            hh = fetch(info["horse_url"])
            profile_name = ""
            pm = re.search(r"競走馬情報\s*([^<\n]+?)(?:（|Flicker|\s*$)", strip_tags(hh))
            runs = parse_horse_page(hh, target)
            # Keep strictly pre-target runs and cap recent history.
            runs = sorted(runs, key=lambda x: x["date"], reverse=True)[:args.max_runs]
            for run in runs:
                ru = run.get("result_url")
                if not ru:
                    continue
                try:
                    rh = fetch(ru)
                    # Identify horse number from the horse link token.
                    hn = extract_horse_number(rh, horse_token)
                    if hn:
                        run["horse_number"] = hn
                        run.update(enrich_corners(rh, hn))
                except Exception as e:
                    run["corner_error"] = repr(e)
                time.sleep(args.sleep)

            out_horses.append({
                "horse_token": horse_token,
                "horse_url": info["horse_url"],
                "name": info["horse_name"],
                "target_date": target.isoformat(),
                "history_before_target": runs,
                "history_count": len(runs),
            })
        except Exception as e:
            failures.append({"horse_token": horse_token, "horse_url": info["horse_url"], "error": repr(e)})
        print(f"HORSE {i:03d}/{len(horses):03d}: {info['horse_name']} runs={len(out_horses[-1]['history_before_target']) if out_horses and out_horses[-1]['horse_token']==horse_token else 0}")
        time.sleep(args.sleep)

    # Integrity checks: no target-day leakage, unique horse token, all dates valid.
    seen = set()
    for h in out_horses:
        if h["horse_token"] in seen:
            raise RuntimeError("horse token duplicate")
        seen.add(h["horse_token"])
        for run in h["history_before_target"]:
            if run["date"] >= target.isoformat():
                raise RuntimeError(f"LEAKAGE: {h['name']} {run['date']} >= {target.isoformat()}")

    output = {
        "schema_version": "2.0-phase2",
        "parser_version": "15.0",
        "target_ymd": args.date,
        "target_date": target.isoformat(),
        "source": "JRA公式 accessU 競走馬情報 + accessS レース結果",
        "race_source": str(src),
        "horse_count": len(out_horses),
        "failure_count": len(failures),
        "failures": failures,
        "horses": out_horses,
    }
    out = Path(f"data/horse_history/{args.date}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE:", out)
    print("HORSES:", len(out_horses), "FAILURES:", len(failures))

if __name__ == "__main__":
    main()
