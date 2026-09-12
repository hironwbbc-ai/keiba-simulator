# 競馬シミュレーター Ver.15.13.2

JRA公式同期JSON → 出馬表 → Monte Carlo → 個別バックテスト → 学習反映

## 現行構成
- `app.js` : シミュレーター本体
- `index.html` : UI
- `.github/workflows/jra-sync-historical.yml` : 通常開催日の同期・Pagesデプロイ。過去日は36レースの結果詳細を一括取得せず、既存メタデータのみ整備して終了。
- `.github/workflows/jra-sync-historical-selected.yml` : 過去日の指定1レースだけ詳細結果を取得・キャッシュ。
- `.github/workflows/jra-sync-horse-history.yml` : 馬の過去走データ同期
- `data/history/YYYYMMDD/` : レース単位の詳細キャッシュ
- `data/history/YYYYMMDD/index.json` / `meta.json` : 軽量レース一覧メタデータ

## バックテスト方針
過去レースの予測は、最終人気・結果オッズ・実着順・4角位置をモデル入力に使用しません。これらは予測後の評価・市場ベンチマークにのみ使用します。

同一レースの学習は重複実行しません。

## GitHub Actions
GitHub Actionsのworkflowは `.github/workflows/` 配下だけが実行対象です。ルート直下の旧workflowや旧バックアップは含めません。
