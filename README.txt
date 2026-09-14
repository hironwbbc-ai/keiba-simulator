競馬シミュレーター Ver.15.13.3 安全修正

現在GitHubのVer.15.13.2 app.jsを壊さず、必要箇所だけ修正するパッチです。

変更:
- MODEL_VERSION 15.13.3
- buildModel が任意の learning state を受け取れるよう変更
- 個別バックテストは localStorage の過去学習係数を予測に使わず、基準係数で独立評価
- 予測確定後の trainFromBacktest は従来どおり実行
- 脚質0頭時の表示を「判定材料不足」に統一
- leakage guard 情報を結果へ追加

index.html / style.css は変更不要です。

適用:
python apply_patch.py app.js

確認:
node --check app.js
node verify_v15_13_3.js
