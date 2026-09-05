競馬シミュレーター Ver.8.0

Ver.7.1の出馬表取得を強化。
- URL入力不要
- JRA公式URLの再試行
- 既知URLから同開催のaccessDリンクを抽出して学習
- JRA出馬表の現行テキスト構造に合わせた解析

GitHub Pagesでは静的配信のため、JRA取得は外部取得経路（r.jina.ai）を利用しています。取得経路の仕様変更や一時的な制限で失敗する場合があります。


Ver.8.2: GitHub Actions側でJRA公式accessDの出馬表ルートを巡回し、当日レースと馬データをdata/jra_daily.jsonへ同期。Pages側は同期JSONを利用。
