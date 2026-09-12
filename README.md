# 🏇 競馬シミュレーター Ver.15.13.2

JRA公式同期JSON → 出馬表 → Monte Carlo → 個別バックテスト → 市場ベンチマーク比較

## v15.13.2 の重要ルール
- 過去日バックテストは **1レース単位**。
- 一覧表示は軽量な `data/history/YYYYMMDD/index.json` / `meta.json` を使用。
- 詳細結果は `data/history/YYYYMMDD/開催コード_R.json` の対象レースだけを使用。
- バックテストの予測入力から **最終人気・結果オッズ・実着順・4角位置を除外**。
- 最終人気は予測後の市場ベンチマーク比較だけに使用。
- バックテスト学習は `keiba_simulator_learning_v15_13_2_pre_race` に分離。
- 旧一括バックテスト等は `legacy/` に退避し、現行フローから切り離す。
