# 競馬予想シミュレーター v16

過去走の位置取り・ペース・馬場・距離・上がりから脚質と適性を出し、ペースを毎回変えながらモンテカルロで着順を再現します。

## 使い方
1. Actions で `JRA Sync - Historical`（当日同期）または `JRA Sync - Historical Selected Race`（過去レース）を実行
2. Actions で `JRA Sync - Horse History` を実行（開催日・開催場・レース番号を入力）
3. アプリで日付を選び、レースを選んでシミュレーション

## ファイル
- `model.js` 予想モデル（DOM非依存）／`app.js` 画面／`style.css` 見た目
- `jra_horse_history_phase2.py` 選択レースの出走馬の過去走を取得
- `test_model.js`・`test_phase2.py` 簡易テスト
