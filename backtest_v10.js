/* =========================================================
   競馬シミュレーター Ver.10.0
   過去36レース 一括バックテスト
   最終単勝人気をベンチマークとして評価
   ========================================================= */

(function () {
  "use strict";

  const HISTORY_URL = "./data/jra_history.json?ts=" + Date.now();

  function pct(n, d) {
    if (!d) return "0.0%";
    return (n / d * 100).toFixed(1) + "%";
  }

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function popularityOf(h) {
    const n = Number(
      h.popularity ??
      h.odds_rank ??
      h.rank ??
      h.popular ??
      999
    );

    return Number.isFinite(n) ? n : 999;
  }

  function horseNoOf(h) {
    return Number(
      h.number ??
      h.horse_no ??
      h.horseNumber ??
      0
    );
  }

  function horseNameOf(h) {
    return (
      h.name ??
      h.horse_name ??
      h.horseName ??
      "不明"
    );
  }

  function finishOf(h) {
    return Number(
      h.finish ??
      h.result ??
      h.place ??
      h.rank_finish ??
      999
    );
  }

  function venueOf(race) {
    return (
      race.venue ??
      race.place ??
      race.track ??
      "不明"
    );
  }

  function raceNameOf(race) {
    return (
      race.name ??
      race.race_name ??
      race.title ??
      ""
    );
  }

  function raceNoOf(race) {
    return Number(
      race.race_no ??
      race.raceNumber ??
      race.number ??
      0
    );
  }

  function dateOf(race) {
    return race.date ?? "";
  }

  function createCard() {
    if (document.getElementById("bulkBacktestCard")) return;

    const card = document.createElement("section");
    card.id = "bulkBacktestCard";
    card.className = "card";

    card.innerHTML = `
      <h2>④ 過去レース一括バックテスト</h2>

      <div class="note" style="margin-bottom:10px">
        JRA公式結果に記録された「最終単勝人気」を、
        現時点でのベンチマークとして36レース一括評価します。
      </div>

      <button id="runBulkBacktest">
        36レースを一括評価
      </button>

      <div id="bulkBacktestResult" style="margin-top:12px"></div>
    `;

    const loadCard =
      document.querySelector("#loadBtn")?.closest(".card");

    if (loadCard) {
      loadCard.insertAdjacentElement("afterend", card);
    } else {
      document.querySelector("main")?.appendChild(card);
    }

    document
      .getElementById("runBulkBacktest")
      ?.addEventListener("click", runBulkBacktest);
  }

  async function loadHistory() {
    const response = await fetch(HISTORY_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "jra_history.json の読み込みに失敗しました。HTTP " +
        response.status
      );
    }

    return await response.json();
  }

  function normalizeRaces(data) {
    let races = [];

    if (Array.isArray(data)) {
      races = data;
    } else if (Array.isArray(data.races)) {
      races = data.races;
    } else if (Array.isArray(data.results)) {
      races = data.results;
    }

    return races.filter(race => {
      const horses =
        race.horses ||
        race.entries ||
        race.runners ||
        [];

      return Array.isArray(horses) && horses.length > 0;
    });
  }

  function getHorses(race) {
    return (
      race.horses ||
      race.entries ||
      race.runners ||
      []
    );
  }

  function findWinner(horses) {
    return horses.find(h => finishOf(h) === 1);
  }

  function evaluateRace(race) {
    const horses = getHorses(race);

    if (!horses.length) return null;

    const winner = findWinner(horses);

    if (!winner) return null;

    const ranked = horses
      .map(h => ({
        horse: h,
        popularity: popularityOf(h),
        number: horseNoOf(h),
        name: horseNameOf(h)
      }))
      .filter(x => x.popularity < 999)
      .sort((a, b) => {
        if (a.popularity !== b.popularity) {
          return a.popularity - b.popularity;
        }

        return a.number - b.number;
      });

    if (!ranked.length) return null;

    const winnerPopularity = popularityOf(winner);

    const top1 = ranked[0]?.horse === winner;

    const top3 = ranked
      .slice(0, 3)
      .some(x => x.horse === winner);

    const top5 = ranked
      .slice(0, 5)
      .some(x => x.horse === winner);

    const top10 = ranked
      .slice(0, 10)
      .some(x => x.horse === winner);

    return {
      race,
      horses,
      winner,
      winnerPopularity,
      top1,
      top3,
      top5,
      top10,
      ranked
    };
  }

  function venueStats(results) {
    const map = {};

    results.forEach(x => {
      const venue = venueOf(x.race);

      if (!map[venue]) {
        map[venue] = {
          total: 0,
          top1: 0,
          top3: 0,
          top5: 0
        };
      }

      map[venue].total++;

      if (x.top1) map[venue].top1++;
      if (x.top3) map[venue].top3++;
      if (x.top5) map[venue].top5++;
    });

    return map;
  }

  function longshotResults(results) {
    return results
      .filter(x => x.winnerPopularity >= 10)
      .sort(
        (a, b) =>
          b.winnerPopularity - a.winnerPopularity
      );
  }

  function renderResults(results) {
    const el = document.getElementById(
      "bulkBacktestResult"
    );

    if (!el) return;

    const total = results.length;

    const top1 = results.filter(x => x.top1).length;
    const top3 = results.filter(x => x.top3).length;
    const top5 = results.filter(x => x.top5).length;
    const top10 = results.filter(x => x.top10).length;

    const avgPopularity =
      results.reduce(
        (sum, x) => sum + x.winnerPopularity,
        0
      ) / Math.max(total, 1);

    const longshots = longshotResults(results);
    const venues = venueStats(results);

    let html = "";

    html += `
      <div style="
        padding:12px;
        background:#f4f6f8;
        border-radius:12px;
        margin-bottom:10px;
      ">
        <b>ベンチマーク結果</b>

        <table style="margin-top:8px">
          <tr>
            <th>評価項目</th>
            <th>結果</th>
          </tr>

          <tr>
            <td>評価レース数</td>
            <td>${total}</td>
          </tr>

          <tr>
            <td>1番人気が勝利</td>
            <td>${top1} / ${total}（${pct(top1, total)}）</td>
          </tr>

          <tr>
            <td>3番人気以内が勝利</td>
            <td>${top3} / ${total}（${pct(top3, total)}）</td>
          </tr>

          <tr>
            <td>5番人気以内が勝利</td>
            <td>${top5} / ${total}（${pct(top5, total)}）</td>
          </tr>

          <tr>
            <td>10番人気以内が勝利</td>
            <td>${top10} / ${total}（${pct(top10, total)}）</td>
          </tr>

          <tr>
            <td>勝ち馬の平均人気</td>
            <td>${avgPopularity.toFixed(2)}番人気</td>
          </tr>

          <tr>
            <td>10番人気以下の勝利</td>
            <td>${longshots.length} / ${total}
              （${pct(longshots.length, total)}）</td>
          </tr>
        </table>
      </div>
    `;

    html += `
      <h3>開催場別</h3>
      <table>
        <tr>
          <th>開催場</th>
          <th>レース</th>
          <th>1番人気</th>
          <th>3番人気内</th>
          <th>5番人気内</th>
        </tr>
    `;

    Object.keys(venues)
      .sort()
      .forEach(venue => {
        const s = venues[venue];

        html += `
          <tr>
            <td>${esc(venue)}</td>
            <td>${s.total}</td>
            <td>${pct(s.top1, s.total)}</td>
            <td>${pct(s.top3, s.total)}</td>
            <td>${pct(s.top5, s.total)}</td>
          </tr>
        `;
      });

    html += `</table>`;

    if (longshots.length) {
      html += `
        <h3>高人気薄の勝利</h3>
        <table>
          <tr>
            <th>開催</th>
            <th>R</th>
            <th>馬番</th>
            <th>馬名</th>
            <th>人気</th>
          </tr>
      `;

      longshots
        .slice(0, 10)
        .forEach(x => {
          html += `
            <tr>
              <td>${esc(venueOf(x.race))}</td>
              <td>${raceNoOf(x.race)}R</td>
              <td>${x.number}</td>
              <td>${esc(horseNameOf(x.winner))}</td>
              <td>${x.winnerPopularity}</td>
            </tr>
          `;
        });

      html += `</table>`;
    }

    html += `
      <div class="note" style="margin-top:10px">
        ※これは「最終単勝人気」を使った市場ベンチマークです。
        実際の事前予測モデルの精度とは別物です。
        次の段階では、脚質・展開・枠順・斤量・近走・コース適性・
        馬場などを使ったシミュレーション結果と比較できます。
      </div>
    `;

    el.innerHTML = html;
  }

  async function runBulkBacktest() {
    const btn = document.getElementById(
      "runBulkBacktest"
    );

    const result = document.getElementById(
      "bulkBacktestResult"
    );

    if (!btn || !result) return;

    btn.disabled = true;
    btn.innerHTML =
      '<span class="spinner"></span> 集計中…';

    result.innerHTML =
      '<div class="note">JRA履歴データを読み込んでいます。</div>';

    try {
      const data = await loadHistory();

      const races = normalizeRaces(data);

      const results = races
        .map(evaluateRace)
        .filter(Boolean);

      if (!results.length) {
        throw new Error(
          "評価できるレースが見つかりませんでした。"
        );
      }

      renderResults(results);

    } catch (e) {
      result.innerHTML = `
        <div class="err">
          バックテストに失敗しました。<br>
          ${esc(e.message)}
        </div>
      `;

      console.error(e);

    } finally {
      btn.disabled = false;
      btn.textContent = "36レースを一括評価";
    }
  }

  function init() {
    createCard();
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
