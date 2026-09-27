#!/usr/bin/env python3
# JRA horse history Phase 2
# v16: selected-race mode. Collects past runs (corners, agari, laps) for ONE race's horses.
# IMPORTANT: all historical features are filtered to races strictly BEFORE target date.
from __future__ import annotations
import argparse, datetime as dt, html as htmlmod, http.cookiejar, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

BASE = "https://www.jra.go.jp"
ACCESS_S = BASE + "/JRADB/accessS.html"
UA = "keiba-simulator/15.0 (+https://github.com/hironwbbc-ai/keiba-simulator)"
VENUES = {"01":"札幌","02":"函館","03":"福島","04":"新潟","05":"東京","06":"中山","07":"中京","08":"京都","09":"阪神","10":"小倉"}

_cj = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cj))

def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"})
    with _opener.open(req, timeout=timeout) as r:
        raw = r.read()
    return _decode_jra(raw)

def _decode_jra(raw):
    for enc in ("cp932", "shift_jis", "utf-8"):
        try:
            text = raw.decode(enc)
            if "<html" in text.lower() or "JRADB" in text:
                return text
        except UnicodeDecodeError:
            pass
    return raw.decode("cp932", "replace")

def _request_bytes(url, method="GET", data=None, referer=None):
    headers = {
        "User-Agent": UA, "Accept-Language": "ja,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with _opener.open(req, timeout=25) as r:
        return r.read()

def _post_s(token, referer=None):
    data = urllib.parse.urlencode({"cname": token}).encode("ascii")
    return _decode_jra(_request_bytes(ACCESS_S, "POST", data, referer or BASE))

def _get_s(token, referer=None):
    url = ACCESS_S + "?CNAME=" + urllib.parse.quote(token, safe="")
    return _decode_jra(_request_bytes(url, "GET", None, referer or BASE))

def _clean_token(value):
    value = htmlmod.unescape(value)
    value = urllib.parse.unquote(value)
    return value.strip().rstrip(",;")

_ACTION_TOKEN_RE = re.compile(
    r"doAction\s*\(\s*['\"](?:/JRADB/)?accessS\.html['\"]\s*,\s*['\"]?"
    r"(pw01(?:srl|sde)[^'\")\s<>&]+)['\"]?", re.I)
_GENERIC_TOKEN_RE = re.compile(r"(pw01(?:srl|sde)[^\s'\"<>]+/[0-9A-Fa-f]{2})", re.I)
HIST_TOKEN_RE = re.compile(
    r"^pw01sde(?P<prefix>[0-9A-Za-z]{2})(?P<venue>[0-9]{2})"
    r"(?P<year>[0-9]{4})(?P<meet>[0-9]{2})(?P<day>[0-9]{2})"
    r"(?P<race>[0-9]{2})(?P<date>[0-9]{8})/(?P<hex>[0-9A-Fa-f]{2})$", re.I)

def _extract_objparam(text):
    pairs = re.findall(r'objParam\s*\[\s*["\'](\d{4})["\']\s*\]\s*=\s*["\']([0-9A-Fa-f]{2})["\']', text, re.I)
    return {k.upper(): v.upper() for k, v in pairs}

def _extract_link_attributes(text):
    return [m.group(2) for m in re.finditer(r"(?:href|onclick)\s*=\s*(['\"])(.*?)\1", text, re.I | re.S)]

def _find_tokens(text, prefix):
    text = htmlmod.unescape(text)
    found = set()
    for value in _ACTION_TOKEN_RE.findall(text):
        value = _clean_token(value)
        if value.lower().startswith(prefix.lower()):
            found.add(value)
    for value in _GENERIC_TOKEN_RE.findall(text):
        value = _clean_token(value)
        if value.lower().startswith(prefix.lower()):
            found.add(value)
    if prefix.lower() == "pw01srl":
        for attr in _extract_link_attributes(text):
            attr = urllib.parse.unquote(htmlmod.unescape(attr))
            for m in re.finditer(r"(pw01srl[^'\"<>\s,;)]+)", attr, re.I):
                found.add(_clean_token(m.group(1)))
    return found

_HIST_ENTRY = "pw01skl00999999/B3"
_month_checkdigit_cache = {}   # ym(YYYYMM) -> check digit
_month_sde_cache = {}          # ym(YYYYMM) -> set of pw01sde tokens for the WHOLE month

def _ensure_month_checkdigits():
    if _month_checkdigit_cache:
        return
    selector = _post_s(_HIST_ENTRY, BASE)
    _month_checkdigit_cache.update(_extract_objparam(selector))

def _ensure_month_sde_tokens(ym):
    """Warm up the session by walking JRA's own navigation chain
    (month selector -> day selector -> race results) for this year-month,
    exactly like the proven historical-race fetch flow. A cold, isolated
    request to a specific race's CNAME can otherwise return an unrelated
    (stale/cached) race, since this endpoint appears to depend on having
    arrived via that chain rather than the CNAME alone."""
    if ym in _month_sde_cache:
        return _month_sde_cache[ym]
    _ensure_month_checkdigits()
    check_digit = _month_checkdigit_cache.get(ym[2:].upper()) or _month_checkdigit_cache.get(ym.upper())
    if not check_digit:
        _month_sde_cache[ym] = set()
        return _month_sde_cache[ym]
    rsl_tokens = set()
    for candidate in (f"pw01skl10{ym}/{check_digit}", f"pw01skl00{ym}/{check_digit}"):
        for method in ("POST", "GET"):
            try:
                page = _post_s(candidate, ACCESS_S) if method == "POST" else _get_s(candidate, ACCESS_S)
                found = _find_tokens(page, "pw01srl")
                if found:
                    rsl_tokens = found
                    break
            except Exception:
                pass
        if rsl_tokens:
            break
    sde_tokens = set()
    for token in sorted(rsl_tokens):
        try:
            page = _post_s(token, ACCESS_S)
            sde_tokens.update(_find_tokens(page, "pw01sde"))
        except Exception:
            pass
    _month_sde_cache[ym] = sde_tokens
    return sde_tokens

def fetch_result_page(url, timeout=25):
    """Fetch an accessS.html result page reliably. Warms up the session via
    the same month/day navigation chain used by the proven historical-race
    fetch, then fetches this specific race in that same session."""
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    token = qs.get("CNAME", [None])[0]
    if token:
        token = urllib.parse.unquote(token)
        m = HIST_TOKEN_RE.fullmatch(token)
        if m:
            try:
                _ensure_month_sde_tokens(m.group("date")[:6])
            except Exception:
                pass
        try:
            raw = _post_s(token, ACCESS_S)
            title_match = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
            title = strip_tags(title_match.group(1)) if title_match else ""
            if "パラメータエラー" not in title and title != "エラー":
                return raw
        except Exception:
            pass
    return fetch(url, timeout=timeout)

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

def find_result_row(result_html, horse_token, horse_name=None):
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
    # Fallback: the token format can differ between an entry/odds page and a
    # past result page (same horse, different context), so match by name too.
    # This is intentionally lenient (plain-text containment, tags stripped)
    # since we cannot verify the exact real-world markup from this environment.
    if horse_name:
        target = norm_name(horse_name)
        if target:
            for tr in re.findall(r"<tr\b[^>]*>.*?</tr>", result_html, re.I | re.S):
                row_text = norm_name(strip_tags(tr))
                if target and target in row_text:
                    return tr
    return None

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

def extract_horse_number(result_html, horse_token, horse_name=None):
    tr = find_result_row(result_html, horse_token, horse_name)
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

def to_float(s):
    try: return float(re.search(r"\d+(?:\.\d+)?", s).group())
    except Exception: return None

def parse_result_page(html, horse_token, horse_no, horse_name=None):
    """Extract this horse's corner ranks / agari and the race's lap times from a JRA result page."""
    text = strip_tags(html)
    out = {}
    m = re.search(r"ハロンタイム[^0-9]{0,20}((?:\d{1,2}\.\d\s*[-－−]?\s*)+)", text)
    laps = [float(x) for x in re.findall(r"\d{1,2}\.\d", m.group(1))] if m else []
    if len(laps) >= 5:
        out["laps"] = laps
        out["front3"] = round(sum(laps[:3]), 1)
        out["last3"] = round(sum(laps[-3:]), 1)
    else:
        m3 = re.search(r"3F\s*(\d{2}\.\d)", text)
        if m3: out["last3"] = float(m3.group(1))
    dm = re.search(r"コース[:：]\s*([\d,]+)メートル（(芝|ダート)", text)
    if dm:
        out["distance"] = int(dm.group(1).replace(",", "")); out["surface"] = dm.group(2)
    gm = re.search(r"(?:芝|ダート)\s*(不良|稍重|重|良)(?!\S*メートル)", text)
    if gm: out["going"] = gm.group(1)
    corners = []
    for n in (1, 2, 3, 4):
        cm = re.search(r"(?<!\d)%dコーナー\s*([0-9,()\-=*]+)" % n, text)
        if cm and horse_no:
            pos = corner_position_for_horse(cm.group(1), horse_no)
            if pos: corners.append(pos)
    if corners:
        out["corners"] = corners
        if len(corners) >= 2: out["corner3"], out["corner4"] = corners[-2], corners[-1]
        out["cornerRaw"] = ""
    tr = find_result_row(html, horse_token, horse_name)
    if tr:
        vals = [strip_tags(c) for c in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, re.I | re.S)]
        if len(vals) > 10 and re.fullmatch(r"\d{2}\.\d", vals[10].strip()):
            out["agari"] = float(vals[10])
    return out

def dist_surface(raw):
    m = re.search(r"(\d{3,4})", raw or "")
    s = "ダート" if (raw or "").startswith("ダ") else "芝" if (raw or "").startswith("芝") else ""
    return (int(m.group(1)) if m else None), s

VENUE_CODES = {v: k for k, v in VENUES.items()}

def find_race(ymd, venue, no):
    code = venue if venue in VENUES else VENUE_CODES.get(venue)
    if not code: raise SystemExit("開催場が不明です: " + venue)
    cands = [Path(f"data/history/{ymd}/{code}_{no:02d}.json")]
    for p in cands:
        if p.exists():
            r = json.loads(p.read_text(encoding="utf-8"))
            if r.get("url"): return code, r
    for p in (Path(f"data/daily/{ymd}.json"), Path(f"data/history/{ymd}/meta.json"), Path(f"data/history/{ymd}/index.json")):
        if p.exists():
            for r in json.loads(p.read_text(encoding="utf-8")).get("races", []):
                if r.get("venue_code") == code and int(r.get("no", 0)) == no and r.get("url"):
                    return code, r
    raise SystemExit(f"対象レースのURLが見つかりません: {ymd} {venue} {no}R。先に開催日の同期または過去レース取得を実行してください。")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="YYYYMMDD")
    ap.add_argument("--venue", required=True, help="開催場名または2桁コード")
    ap.add_argument("--race", type=int, required=True)
    ap.add_argument("--max-runs", type=int, default=12)
    ap.add_argument("--sleep", type=float, default=0.25)
    args = ap.parse_args()
    target = dt.datetime.strptime(args.date, "%Y%m%d").date()
    code, race = find_race(args.date, args.venue, args.race)
    print("RACE:", race.get("name"), race["url"])
    race_html = fetch(race["url"])
    links = extract_horse_links(race_html)
    print("HORSES:", len(links))
    cache, out_horses, failures = {}, [], []
    for i, info in enumerate(links, 1):
        tok = urllib.parse.unquote(info["horse_url"].split("CNAME=", 1)[-1])
        try:
            hn = extract_horse_number(race_html, tok, info["horse_name"])
            runs = sorted(parse_horse_page(fetch(info["horse_url"]), target), key=lambda x: x["date"], reverse=True)[:args.max_runs]
            time.sleep(args.sleep)
            for run in runs:
                run["distance"], run["surface"] = dist_surface(run.get("distance_raw"))
                ru = run.get("result_url")
                if not ru: continue
                try:
                    if ru not in cache:
                        cache[ru] = fetch_result_page(ru); time.sleep(args.sleep)
                    rh = cache[ru]
                    rn = extract_horse_number(rh, tok, info["horse_name"])
                    run["horse_number"] = rn
                    extra = parse_result_page(rh, tok, rn, info["horse_name"])
                    if extra.get("distance") is None: extra.pop("distance", None); extra.pop("surface", None)
                    run.update(extra)
                except Exception as e:
                    run["parse_error"] = repr(e)
            out_horses.append({"number": hn, "name": info["horse_name"], "horse_token": tok, "history_count": len(runs), "history_before_target": runs})
            print(f"HORSE {i}/{len(links)} {info['horse_name']} runs={len(runs)}")
        except Exception as e:
            failures.append({"horse_url": info["horse_url"], "name": info["horse_name"], "error": repr(e)})
            print("FAIL", info["horse_name"], repr(e))
        time.sleep(args.sleep)
    for h in out_horses:
        for r in h["history_before_target"]:
            if r["date"] >= target.isoformat(): raise RuntimeError(f"LEAKAGE: {h['name']} {r['date']}")
    if not out_horses: raise SystemExit("馬データを1頭も取得できませんでした")
    out = {"schema_version": "3.0-selected", "target_date": target.isoformat(), "target_ymd": args.date,
           "venue_code": code, "race_no": args.race, "race_name": race.get("name", ""),
           "horse_count": len(out_horses), "failure_count": len(failures), "failures": failures, "horses": out_horses}
    p = Path(f"data/horse_history/{args.date}_{code}_{args.race:02d}.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("WROTE:", p, "HORSES:", len(out_horses), "FAILURES:", len(failures))

if __name__ == "__main__":
    main()
