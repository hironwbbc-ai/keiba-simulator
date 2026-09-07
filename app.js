// ============================================================
// 競馬シミュレーター Ver.10.1
// JRA公式同期JSON対応版
// ============================================================

const $ = id => document.getElementById(id);

const state = {
  races: [],
  horses: [],
  selected: null,
  daily: null,
  history: null
};

// ------------------------------------------------------------
// 基本設定
// ------------------------------------------------------------

const VENUES = {
  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉"
};

function todayJST() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(new Date())
    .replace(/\//g, "-");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(text, type = "") {
  const el = $("status");

  if (!el) return;

  el.innerHTML = text;
  el.className = "status " + type;
}

// ------------------------------------------------------------
// 開催場判定
// ------------------------------------------------------------

function venueFromToken(token) {
  if (!token) return "";

  const str = String(token);

  /*
   * JRA同期データのtokenから開催場コードを取得
   *
   * 例：
   * pw01dde100620260...
   *
   * 06 → 中山
   */

  let m = str.match(/pw01(?:dde|sde)10(\d{2})/i);

  if (!m) {
    m = str.match(/pw01(?:dde|sde)(\d{2})/i);
  }

  if (!m) return "";

  return VENUES[m[1]] || "";
}

// ------------------------------------------------------------
// データ形式統一
// ------------------------------------------------------------

function normalizeRace(r, date, historical = false) {

  const token = r.token || "";

  let venue = r.venue || venueFromToken(token);

  /*
   * venueが数字で入っている場合にも対応
   */
  if (/^\d+$/.test(String(venue))) {
    venue = VENUES[String(venue).padStart(2, "0")] || "";
  }

  return {
    ...r,

    date: r.date || date,

    venue,

    no: Number(
      r.no ??
      r.race_number ??
      r.raceNumber ??
      r.number ??
      0
    ),

    name:
      r.name ||
      r.title ||
      "レース",

    time:
      r.time ||
      "",

    surface:
      r.surface ||
      "",

    distance:
      r.distance ??
      null,

    going:
      r.going ||
      "",

    horses:
      Array.isArray(r.horses)
        ? r.horses
        : [],

    historical
  };
}

// ------------------------------------------------------------
// JSON取得
// ------------------------------------------------------------

let DAILY = null;
let HISTORY = null;

async function getDaily() {

  if (DAILY) {
    return DAILY;
  }

  const url =
    "./data/jra_daily.json?ts=" +
    Date.now();

  const response = await fetch(
    url,
    {
      cache: "no-store"
    }
  );

  if (!response.ok) {

    throw new Error(
      "jra_daily.jsonを読み込めませんでした。" +
      " HTTP " +
      response.status
    );
  }

  DAILY = await response.json();

  return DAILY;
}

async function getHistory() {

  if (HISTORY) {
    return HISTORY;
  }

  const url =
    "./data/jra_history.json?ts=" +
    Date.now();

  const response = await fetch(
    url,
    {
      cache: "no-store"
    }
  );

  if (!response.ok) {

    throw new Error(
      "jra_history.jsonを読み込めませんでした。" +
      " HTTP " +
      response.status
    );
  }

  HISTORY = await response.json();

  return HISTORY;
}

// ------------------------------------------------------------
// 開催場セレクト
// ------------------------------------------------------------

function setVenues(races) {

  const select = $("venue");

  if (!select) return;

  const venues = [
    ...new Set(
      races
        .map(r => r.venue)
        .filter(Boolean)
    )
  ];

  select.innerHTML =
    '<option value="">すべて</option>' +

    venues
      .map(
        v =>
          `<option value="${esc(v)}">${esc(v)}</option>`
      )
      .join("");
}

// ------------------------------------------------------------
// レース一覧表示
// ------------------------------------------------------------

function renderRaces() {

  const box = $("races");

  if (!box) return;

  const selectedVenue =
    $("venue")?.value || "";

  const list =
    state.races.filter(
      race =>
        !selectedVenue ||
        race.venue === selectedVenue
    );

  box.innerHTML = "";

  if (!list.length) {

    box.innerHTML =
      '<div class="note">' +
      "該当するレースがありません。" +
      "</div>";

    return;
  }

  list.forEach(race => {

    const div =
      document.createElement("div");

    div.className = "race";

    div.innerHTML =
      `<b>${esc(race.venue)} ${race.no}R ` +
      `${esc(race.name)}</b><br>` +

      `<span class="small">` +
      `${esc(race.time)}` +
      `${race.historical ? "・結果済み" : ""}` +
      `</span>`;

    const button =
      document.createElement("button");

    button.textContent =
      race.historical
        ? "結果・バックテスト"
        : "このレースを選択";

    button.onclick = () => {

      if (race.historical) {

        renderHistoricalRace(race);

      } else {

        selectRace(race);

      }

    };

    div.appendChild(button);

    box.appendChild(div);
  });
}

// ------------------------------------------------------------
// レース選択
// ------------------------------------------------------------

function selectRace(race) {

  state.selected = race;

  $("entryCard")?.classList.remove(
    "hidden"
  );

  $("resultCard")?.classList.add(
    "hidden"
  );

  if ($("raceInfo")) {

    $("raceInfo").innerHTML =
      `<b>${esc(race.venue)} ` +
      `${race.no}R ` +
      `${esc(race.name)}</b><br>` +

      `<span class="small">` +
      `${esc(race.date)} ` +
      `${esc(race.time)}` +
      `</span>`;
  }

  if ($("horses")) {

    $("horses").innerHTML =
      '<div class="status">' +
      '<span class="spinner"></span> ' +
      "出馬表を読み込み中…" +
      "</div>";
  }

  loadEntry(race);
}

// ------------------------------------------------------------
// 過去レース表示
// ------------------------------------------------------------

function renderHistoricalRace(race) {

  state.selected = race;

  state.horses =
    race.horses || [];

  $("entryCard")?.classList.remove(
    "hidden"
  );

  $("resultCard")?.classList.add(
    "hidden"
  );

  if ($("raceInfo")) {

    $("raceInfo").innerHTML =
      `<b>${esc(race.venue)} ` +
      `${race.no}R ` +
      `${esc(race.name)}</b><br>` +

      `<span class="small">` +
      `${esc(race.date)} ` +
      `${esc(race.time)}` +
      "・結果データ" +
      `</span>`;
  }

  renderHistoricalHorses();
}

// ------------------------------------------------------------
// 過去レース馬表示
// ------------------------------------------------------------

function renderHistoricalHorses() {

  const horses =
    state.horses
      .slice()
      .sort(
        (a, b) =>
          (Number(a.finish) || 99) -
          (Number(b.finish) || 99)
      );

  if (!$("horses")) return;

  $("horses").innerHTML =

    `<div class="small">` +
    `${horses.length}頭・JRA公式レース結果` +
    `</div>` +

    `<div style="overflow-x:auto">` +

    `<table>` +

    `<thead>` +

    `<tr>` +
    `<th>着順</th>` +
    `<th>馬番</th>` +
    `<th>馬名</th>` +
    `<th>人気</th>` +
    `<th>騎手</th>` +
    `<th>馬体重</th>` +
    `</tr>` +

    `</thead>` +

    `<tbody>` +

    horses
      .map(
        h =>

          `<tr>` +

          `<td><b>${h.finish ?? "-"}</b></td>` +

          `<td>${h.no ?? "-"}</td>` +

          `<td><b>${esc(h.name)}</b></td>` +

          `<td>${h.popularity ?? "-"}</td>` +

          `<td>${esc(h.jockey || "-")}</td>` +

          `<td>${h.bodyWeight ?? "-"}</td>` +

          `</tr>`
      )
      .join("") +

    `</tbody>` +

    `</table>` +

    `</div>`;
}

// ------------------------------------------------------------
// 馬データ統一
// ------------------------------------------------------------

function normalizeHorse(h) {

  return {

    no:
      Number(
        h.no ??
        h.number ??
        0
      ),

    name:
      h.name ||
      "",

    odds:
      Number(
        h.odds ??
        0
      ),

    popularity:
      h.popularity ??
      null,

    bodyWeight:
      h.bodyWeight ??
      h.body_weight ??
      null,

    bodyWeightDiff:
      h.bodyWeightDiff ??
      h.body_weight_diff ??
      null,

    sexAge:
      h.sexAge ??
      h.sex_age ??
      "",

    carriedWeight:
      h.carriedWeight ??
      h.carried_weight ??
      null,

    jockey:
      h.jockey ||
      "",

    style:
      h.style ||
      "不明"
  };
}

// ------------------------------------------------------------
// 出馬表表示
// ------------------------------------------------------------

function renderHorses() {

  const horses =
    state.horses
      .map(normalizeHorse)
      .sort(
        (a, b) =>
          a.no - b.no
      );

  if (!$("horses")) return;

  $("horses").innerHTML =

    `<div class="small">` +
    `${horses.length}頭・JRA公式同期データ` +
    `</div>` +

    `<div style="overflow-x:auto">` +

    `<table>` +

    `<thead>` +

    `<tr>` +
    `<th>馬番</th>` +
    `<th>馬名</th>` +
    `<th>性齢</th>` +
    `<th>騎手</th>` +
    `<th>斤量</th>` +
    `<th>馬体重</th>` +
    `<th>単勝</th>` +
    `<th>人気</th>` +
    `</tr>` +

    `</thead>` +

    `<tbody>` +

    horses
      .map(
        h =>

          `<tr>` +

          `<td><b>${h.no}</b></td>` +

          `<td><b>${esc(h.name)}</b></td>` +

          `<td>${esc(h.sexAge || "-")}</td>` +

          `<td>${esc(h.jockey || "-")}</td>` +

          `<td>${h.carriedWeight ?? "-"}kg</td>` +

          `<td>${h.bodyWeight ?? "-"}</td>` +

          `<td>${h.odds > 0 ? h.odds : "-"}</td>` +

          `<td>${h.popularity ?? "-"}</td>` +

          `</tr>`
      )
      .join("") +

    `</tbody>` +

    `</table>` +

    `</div>`;
}

// ------------------------------------------------------------
// 選択レースの出馬表
// ------------------------------------------------------------

async function loadEntry(race) {

  try {

    const daily =
      await getDaily();

    const races =
      (daily.races || [])
        .map(
          r =>
            normalizeRace(
              r,
              daily.date,
              false
            )
        );

    const target =
      races.find(
        r =>
          r.date === race.date &&
          r.venue === race.venue &&
          r.no === race.no
      );

    if (!target) {

      throw new Error(
        "このレースのJRA公式同期データがありません。"
      );
    }

    if (
      !Array.isArray(target.horses) ||
      !target.horses.length
    ) {

      throw new Error(
        "このレースの馬データが同期されていません。"
      );
    }

    state.horses =
      target.horses;

    if ($("raceInfo")) {

      $("raceInfo").innerHTML =

        `<b>${esc(target.venue)} ` +
        `${target.no}R ` +
        `${esc(target.name)}</b><br>` +

        `<span class="small">` +
        `${esc(target.date)} ` +
        `${esc(target.time)}・` +
        `${esc(target.surface)} ` +
        `${target.distance ? target.distance + "m" : ""}` +
        `・馬場 ${esc(target.going || "不明")}` +
        `</span>`;
    }

    renderHorses();

  } catch (error) {

    console.error(error);

    if ($("horses")) {

      $("horses").innerHTML =

        `<div class="status err">` +

        `出馬表を取得できませんでした：` +

        `${esc(error.message)}` +

        `</div>`;
    }
  }
}

// ------------------------------------------------------------
// 現在レースの簡易シミュレーション
// ------------------------------------------------------------

function simulate() {

  if (!state.horses.length) {

    alert("先にレースを選択してください。");

    return;
  }

  const horses =
    state.horses
      .map(normalizeHorse)
      .filter(
        h =>
          h.odds > 0
      )
      .map(h => {

        const base =
          1 /
          Math.max(
            h.odds,
            0.1
          );

        const styleBonus =
          h.style.includes("逃げ")
            ? 1.06
            : h.style.includes("先行")
              ? 1.04
              : h.style.includes("差し")
                ? 1.02
                : 0.98;

        return {

          ...h,

          score:
            base *
            styleBonus
        };
      });

  const total =
    horses.reduce(
      (sum, h) =>
        sum + h.score,
      0
    );

  horses.forEach(
    h => {

      h.win =
        total
          ? h.score / total
          : 0;
    }
  );

  horses.sort(
    (a, b) =>
      b.win - a.win
  );

  $("resultCard")
    ?.classList.remove(
      "hidden"
    );

  if ($("result")) {

    $("result").innerHTML =

      `<div class="note">` +

      "単勝オッズ＋簡易脚質補正による基礎モデルです。" +

      `</div>` +

      `<div style="overflow-x:auto">` +

      `<table>` +

      `<thead>` +

      `<tr>` +
      `<th>順位</th>` +
      `<th>馬</th>` +
      `<th>勝率目安</th>` +
      `<th>単勝</th>` +
      `<th>期待値</th>` +
      `</tr>` +

      `</thead>` +

      `<tbody>` +

      horses
        .slice(0, 10)
        .map(
          (h, i) =>

            `<tr>` +

            `<td>${i + 1}</td>` +

            `<td><b>${h.no} ${esc(h.name)}</b></td>` +

            `<td>${(h.win * 100).toFixed(1)}%</td>` +

            `<td>${h.odds}</td>` +

            `<td>${(h.win * h.odds).toFixed(2)}</td>` +

            `</tr>`
        )
        .join("") +

      `</tbody>` +

      `</table>` +

      `</div>`;
  }
}

// ------------------------------------------------------------
// 過去レースバックテスト
// ------------------------------------------------------------

function runHistoricalBacktest() {

  if (!state.horses.length) return;

  const horses =
    state.horses
      .map(h => ({

        ...h,

        probability:
          h.popularity
            ? 1 /
              Number(
                h.popularity
              )
            : 0
      }))
      .filter(
        h =>
          h.probability > 0
      )
      .sort(
        (a, b) =>
          b.probability -
          a.probability
      );

  const top5 =
    horses.slice(0, 5);

  const winner =
    horses.find(
      h =>
        Number(
          h.finish
        ) === 1
    );

  const favorite =
    horses[0];

  const favoriteHit =
    favorite &&
    Number(
      favorite.finish
    ) === 1;

  const top5Hit =
    top5.some(
      h =>
        Number(
          h.finish
        ) === 1
    );

  $("resultCard")
    ?.classList.remove(
      "hidden"
    );

  if (!$("result")) return;

  $("result").innerHTML =

    `<div class="note">` +

    "過去レースでは最終人気を市場評価として使用しています。" +

    `</div>` +

    `<div class="pill">` +
    `1番人気1着：` +
    `${favoriteHit ? "的中" : "不的中"}` +
    `</div>` +

    `<div class="pill">` +
    `上位5頭に勝ち馬：` +
    `${top5Hit ? "的中" : "不的中"}` +
    `</div>` +

    `<div style="margin-top:10px">` +

    "実際の1着：" +

    `<b>` +

    `${
      winner
        ? winner.no +
          " " +
          esc(winner.name)
        : "不明"
    }` +

    `</b>` +

    `</div>` +

    `<div style="overflow-x:auto;margin-top:10px">` +

    `<table>` +

    `<thead>` +

    `<tr>` +
    `<th>予測順位</th>` +
    `<th>馬番</th>` +
    `<th>馬名</th>` +
    `<th>人気</th>` +
    `<th>着順</th>` +
    `</tr>` +

    `</thead>` +

    `<tbody>` +

    top5
      .map(
        (h, i) =>

          `<tr>` +

          `<td>${i + 1}</td>` +

          `<td>${h.no ?? "-"}</td>` +

          `<td>${esc(h.name)}</td>` +

          `<td>${h.popularity ?? "-"}</td>` +

          `<td>${h.finish ?? "-"}</td>` +

          `</tr>`
      )
      .join("") +

    `</tbody>` +

    `</table>` +

    `</div>`;
}

// ============================================================
// ★★★ 今回の重要修正 ★★★
// 指定日の開催を取得
//
// 優先順位
//
// ① jra_daily.json
// ② jra_history.json
//
// 「今日より前の日だからhistoryを見る」
// という旧仕様を廃止。
// dailyに指定日が存在すれば、過去日でもdailyを使う。
// ============================================================

async function loadSelectedDate() {

  const date =
    $("date")?.value ||
    todayJST();

  const button =
    $("loadBtn");

  if (button) {
    button.disabled = true;
  }

  setStatus(
    '<span class="spinner"></span> ' +
    "指定日のJRA公式同期データを確認中…"
  );

  try {

    // --------------------------------------------------------
    // ① jra_daily.jsonを最優先
    // --------------------------------------------------------

    const daily =
      await getDaily();

    if (
      daily &&
      daily.date === date &&
      Array.isArray(
        daily.races
      ) &&
      daily.races.length
    ) {

      state.daily =
        daily;

      state.races =
        daily.races
          .map(
            r =>
              normalizeRace(
                r,
                date,
                false
              )
          )
          .filter(
            r =>
              r.no > 0
          );

      if (!state.races.length) {

        throw new Error(
          "指定日の同期データはありますが、レース情報を解析できませんでした。"
        );
      }

      setVenues(
        state.races
      );

      renderRaces();

      const venues =
        [
          ...new Set(
            state.races
              .map(
                r =>
                  r.venue
              )
              .filter(Boolean)
          )
        ];

      setStatus(

        `${date}：JRA公式同期済み。` +

        `${
          venues.length
            ? venues.join("・")
            : "開催場不明"
        }・` +

        `${state.races.length}レース`,

        "ok"
      );

      console.log(
        "daily data used:",
        date,
        state.races.length,
        venues
      );

      return;
    }

    // --------------------------------------------------------
    // ② jra_history.json
    // --------------------------------------------------------

    const history =
      await getHistory();

    if (
      history &&
      history.date === date &&
      Array.isArray(
        history.races
      ) &&
      history.races.length
    ) {

      state.history =
        history;

      state.races =
        history.races
          .map(
            r =>
              normalizeRace(
                r,
                date,
                true
              )
          )
          .filter(
            r =>
              r.no > 0
          );

      setVenues(
        state.races
      );

      renderRaces();

      const venues =
        [
          ...new Set(
            state.races
              .map(
                r =>
                  r.venue
              )
              .filter(Boolean)
          )
        ];

      setStatus(

        `${date}：JRA公式の過去レース結果。` +

        `${
          venues.length
            ? venues.join("・")
            : "開催場不明"
        }・` +

        `${state.races.length}レース`,

        "ok"
      );

      return;
    }

    // --------------------------------------------------------
    // ③ データが無い場合
    // --------------------------------------------------------

    throw new Error(

      `${date} の同期データがありません。` +

      " JRA公式データを同期してください。"
    );

  } catch (error) {

    console.error(
      "loadSelectedDate:",
      error
    );

    setStatus(

      "指定日の開催を取得できませんでした：" +

      `<br>${esc(error.message)}`,

      "err"
    );

  } finally {

    if (button) {
      button.disabled = false;
    }
  }
}

// ------------------------------------------------------------
// 初期設定
// ------------------------------------------------------------

if ($("date")) {

  $("date").value =
    todayJST();
}

if ($("venue")) {

  $("venue").addEventListener(
    "change",
    renderRaces
  );
}

if ($("loadBtn")) {

  $("loadBtn").addEventListener(
    "click",
    loadSelectedDate
  );
}

if ($("simulateBtn")) {

  $("simulateBtn").addEventListener(
    "click",
    () => {

      if (
        state.selected &&
        state.selected.historical
      ) {

        runHistoricalBacktest();

      } else {

        simulate();

      }
    }
  );
}

if ($("backBtn")) {

  $("backBtn").addEventListener(
    "click",
    () => {

      $("entryCard")
        ?.classList.add(
          "hidden"
        );

      $("resultCard")
        ?.classList.add(
          "hidden"
        );
    }
  );
}

// ------------------------------------------------------------
// 外部から確認できるように公開
// ------------------------------------------------------------

window.keibaSimulator = {

  state,

  loadSelectedDate,

  getDaily,

  getHistory

};

console.log(
  "競馬シミュレーター Ver.10.1 loaded"
);
