# 簡易テスト: python test_phase2.py
import jra_horse_history_phase2 as p
tok="pw01dud102022105185/58"
html='''<html><body><h1>x</h1><p>コース：1,600メートル（芝・左）</p><p>天候晴</p><div>芝良</div>
<table><tr><td>1</td><td>6</td><td class="num">12</td><td><a href="/JRADB/accessU.html?CNAME=pw01dud102022105185/58">エンブロイダリー</a></td><td>牝4</td><td>56.0</td><td>ルメール</td><td>1:30.9</td><td></td><td>6 6</td><td>33.0</td><td>492(-4)</td></tr></table>
<table><tr><th>ハロンタイム</th><td>12.4 - 11.0 - 11.2 - 11.3 - 11.4 - 11.1 - 11.2 - 11.3</td></tr><tr><th>上り</th><td>4F 45.0 - 3F 33.6</td></tr></table>
<table><tr><th>3コーナー</th>
<td>4,16(1,3,18)12,8(6,7,14)-(9,11)17(2,13)(5,15)10</td></tr>

<tr><th>4コーナー</th><td>(*4,16)(1,18)3,12(6,8)14,7,11,9(13,17)(2,15)5,10</td></tr></table></body></html>'''
r=p.parse_result_page(html,tok,12)
print(r)
assert r["laps"][0]==12.4 and r["front3"]==34.6 and r["last3"]==33.6
assert r["corners"]==[6,6] and r["agari"]==33.0 and r["distance"]==1600 and r["going"]=="良"
print(p.dist_surface("ダ1000"),p.dist_surface("芝2000"))
print("OK")
