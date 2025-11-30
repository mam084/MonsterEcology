// ----------------- Helpers -----------------

function parseCR(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  const s = String(value).trim();

  if (s.includes("/")) {
    const [n, d] = s.split("/");
    const num = parseFloat(n);
    const den = parseFloat(d);
    if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den;
  }

  const cleaned = s.replace("+", "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? NaN : num;
}


function capFirst(str) {
  if (!str) return "";
  const s = String(str).trim();
  if (!s) return "";
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

// canonical damage type parsing for resistances / immunities / vulnerabilities
const CANONICAL_DAMAGE_TYPES = [
  "Acid",
  "Cold",
  "Fire",
  "Lightning",
  "Thunder",
  "Necrotic",
  "Radiant",
  "Poison",
  "Psychic",
  "Force",
  "Bludgeoning",
  "Piercing",
  "Slashing"
];

const DAMAGE_KEYWORDS = {
  acid: "Acid",
  cold: "Cold",
  fire: "Fire",
  lightning: "Lightning",
  thunder: "Thunder",
  necrotic: "Necrotic",
  radiant: "Radiant",
  poison: "Poison",
  psychic: "Psychic",
  force: "Force",
  bludgeoning: "Bludgeoning",
  piercing: "Piercing",
  slashing: "Slashing"
};

function extractDamageTypes(raw) {
  if (!raw) return [];
  const s = raw.toString().toLowerCase();
  const found = new Set();

  for (const key in DAMAGE_KEYWORDS) {
    if (s.includes(key)) {
      found.add(DAMAGE_KEYWORDS[key]);
    }
  }
  return Array.from(found);
}

// ----------------- Global state -----------------

let monsters = [];
let crMinData = 0;
let crMaxData = 30;

let selectedDimension = "environment"; // for bar chart
let selectedMetric = "count";
let selectedGroupKey = null;

let selectedStatKey = "hp"; // for stats scatter

// for heatmap
let defenseKind = "resist"; // "resist" | "immune" | "vuln"
let defenseGroupDimension = "environment"; // environment | type | size
let activeDamageTypes = CANONICAL_DAMAGE_TYPES.slice();

const dimensionLabels = {
  environment: "ENVIRONMENT",
  type: "MONSTER TYPE",
  size: "SIZE"
};

const metricLabels = {
  count: "NUMBER OF MONSTERS",
  avgCR: "AVERAGE CR",
  avgHP: "AVERAGE HP",
  avgAC: "AVERAGE AC",
  pctFly: "% THAT CAN FLY",
  pctSwim: "% THAT CAN SWIM"
};

const statConfig = {
  hp: { field: "hp", label: "Hit Points" },
  ac: { field: "ac", label: "Armor Class" },
  str: { field: "str", label: "Strength" },
  dex: { field: "dex", label: "Dexterity" },
  con: { field: "con", label: "Constitution" },
  int: { field: "intScore", label: "Intelligence" },
  wis: { field: "wis", label: "Wisdom" },
  cha: { field: "cha", label: "Charisma" }
};

const dimField = {
  environment: "envGroup",
  type: "typeGroup",
  size: "sizeGroup"
};

const defenseKindLabels = {
  resist: "resistances",
  immune: "immunities",
  vuln: "vulnerabilities"
};

// ----------------- DOM references -----------------

const tooltip = d3.select("#tooltip");

const dimensionSelect = document.getElementById("dimension-select");
const metricSelect = document.getElementById("metric-select");
const crMinInput = document.getElementById("cr-min");
const crMaxInput = document.getElementById("cr-max");
const crRangeNote = document.getElementById("cr-range-note");
const flyFilter = document.getElementById("fly-filter");
const swimFilter = document.getElementById("swim-filter");
const explorerCaption = document.getElementById("explorer-caption");
const explorerSummary = document.getElementById("explorer-summary");

const statSelect = document.getElementById("stat-select");
const statsGroupLabel = document.getElementById("stats-group-label");
const statsCaption = document.getElementById("stats-caption");

// heatmap controls
const defenseKindSelect = document.getElementById("defense-kind-select");
const defenseGroupSelect = document.getElementById("defense-group-select");
const defenseHeatmapCaption = document.getElementById("defense-heatmap-caption");

// ----------------- SVG layout -----------------

const explorerMargin = { top: 30, right: 20, bottom: 70, left: 70 };
const statsMargin = { top: 30, right: 20, bottom: 60, left: 70 };
const defenseMargin = { top: 30, right: 20, bottom: 80, left: 90 };

let explorerWidth, explorerHeight, explorerInnerWidth, explorerInnerHeight;
let statsWidth, statsHeight, statsInnerWidth, statsInnerHeight;
let defenseWidth, defenseHeight, defenseInnerWidth, defenseInnerHeight;

let explorerSvg, explorerG, explorerXAxisG, explorerYAxisG;
let explorerBarsG, explorerXAxisLabel, explorerYAxisLabel;

let statsSvg, statsG, statsXAxisG, statsYAxisG;
let statsPointsG, statsXAxisLabel, statsYAxisLabel, statsCorrelationLabel, statsTrendLine;

let defenseSvg, defenseG, defenseXAxisG, defenseYAxisG;
let defenseXScale, defenseYScale, defenseColorScale;

// ----------------- Data loading -----------------

d3.csv("monsters_ecology.csv").then((raw) => {
  monsters = raw
    .map((row) => {
      // environment / type / size normalization
      let env = (row.environment || row.env_list || "").toString().trim();
      if (env.includes(",")) env = env.split(",")[0].trim();
      env = env === "" ? null : capFirst(env);

      let size = capFirst(row.size || "Unknown");
      let type = capFirst(row.type || "Unknown");

      const cr = parseCR(row.cr);
      const hp = row.hp ? +row.hp : NaN;
      const ac = row.ac ? +row.ac : NaN;
      const str = row.str ? +row.str : NaN;
      const dex = row.dex ? +row.dex : NaN;
      const con = row.con ? +row.con : NaN;
      const intScore = row.int ? +row.int : NaN;
      const wis = row.wis ? +row.wis : NaN;
      const cha = row.cha ? +row.cha : NaN;

      const walk = row.speed_walk ? +row.speed_walk : 0;
      const fly = row.speed_fly ? +row.speed_fly : 0;
      const swim = row.speed_swim ? +row.speed_swim : 0;
      const burrow = row.speed_burrow ? +row.speed_burrow : 0;
      const climb = row.speed_climb ? +row.speed_climb : 0;

      const resistTypes = extractDamageTypes(row.damage_resistances);
      const immuneTypes = extractDamageTypes(row.damage_immunities);
      const vulnTypes = extractDamageTypes(row.damage_vulnerabilities);

      return {
        name: row.name,
        cr_raw: row.cr,
        cr,
        hp,
        ac,
        str,
        dex,
        con,
        intScore,
        wis,
        cha,
        speed_walk: walk,
        speed_fly: fly,
        speed_swim: swim,
        speed_burrow: burrow,
        speed_climb: climb,
        hasFly: fly > 0,
        hasSwim: swim > 0,
        envGroup: env,
        typeGroup: type,
        sizeGroup: size,
        resistTypes,
        immuneTypes,
        vulnTypes
      };
    })
    .filter((d) => !isNaN(d.cr));

  const crVals = monsters.map((d) => d.cr).sort((a, b) => a - b);
  crMinData = crVals[0] ?? 0;
  crMaxData = crVals[crVals.length - 1] ?? 30;

  crMinInput.value = crMinData;
  crMaxInput.value = crMaxData;
  crRangeNote.textContent = `Data CR range: ${crMinData} to ${crMaxData}`;

  if (statSelect) selectedStatKey = statSelect.value;

  initExplorerChart();
  initStatsChart();
  initDefenseHeatmap();
  updateExplorerCaption();
  updateAll();
});

// ----------------- Filtering -----------------

function getCurrentCRRange() {
  let min = parseFloat(crMinInput.value);
  let max = parseFloat(crMaxInput.value);

  if (isNaN(min)) min = crMinData;
  if (isNaN(max)) max = crMaxData;
  if (min > max) [min, max] = [max, min];

  return [min, max];
}

function getFilteredMonstersBase() {
  const [minCR, maxCR] = getCurrentCRRange();
  const onlyFly = flyFilter.checked;
  const onlySwim = swimFilter.checked;

  return monsters.filter((d) => {
    if (isNaN(d.cr) || d.cr < minCR || d.cr > maxCR) return false;
    if (onlyFly && !d.hasFly) return false;
    if (onlySwim && !d.hasSwim) return false;
    return true;
  });
}

// ----------------- Grouped bar chart -----------------

function getGroupedData() {
  const base = getFilteredMonstersBase();
  const field = dimField[selectedDimension];
  const metric = selectedMetric;

  const filtered =
    selectedDimension === "environment"
      ? base.filter((d) => d.envGroup !== null)
      : base;

  const rollups = d3.rollups(
    filtered,
    (v) => {
      if (!v.length) return null;
      switch (metric) {
        case "count":
          return v.length;
        case "avgCR":
          return d3.mean(v, (d) => d.cr);
        case "avgHP":
          return d3.mean(v, (d) => d.hp);
        case "avgAC":
          return d3.mean(v, (d) => d.ac);
        case "pctFly":
          return (d3.mean(v, (d) => (d.hasFly ? 1 : 0)) || 0) * 100;
        case "pctSwim":
          return (d3.mean(v, (d) => (d.hasSwim ? 1 : 0)) || 0) * 100;
        default:
          return null;
      }
    },
    (d) => d[field]
  );

  let groups = rollups
    .map(([key, value]) => ({ key, value }))
    .filter((d) => d.key != null && d.value != null && !isNaN(d.value));

  if (selectedDimension === "environment") {
    groups = groups.filter((d) => d.key !== "Unknown");
  }

  groups.sort((a, b) => d3.descending(a.value, b.value));
  const topN = selectedDimension === "size" ? groups.length : 18;
  return groups.slice(0, topN);
}

function initExplorerChart() {
  const container = document.getElementById("explorer-chart");
  explorerWidth = container.clientWidth || 900;
  explorerHeight = 420;

  explorerInnerWidth =
    explorerWidth - explorerMargin.left - explorerMargin.right;
  explorerInnerHeight =
    explorerHeight - explorerMargin.top - explorerMargin.bottom;

  explorerSvg = d3
    .select("#explorer-chart")
    .append("svg")
    .attr("viewBox", [0, 0, explorerWidth, explorerHeight]);

  explorerG = explorerSvg
    .append("g")
    .attr(
      "transform",
      `translate(${explorerMargin.left},${explorerMargin.top})`
    );

  explorerXAxisG = explorerG
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${explorerInnerHeight})`);

  explorerYAxisG = explorerG.append("g").attr("class", "y-axis");

  explorerXAxisLabel = explorerG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${explorerInnerWidth / 2}, ${
        explorerInnerHeight + 48
      })`
    );

  explorerYAxisLabel = explorerG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${-48}, ${explorerInnerHeight / 2}) rotate(-90)`
    );

  explorerBarsG = explorerG.append("g").attr("class", "bars");
}

function updateExplorerChart() {
  const groups = getGroupedData();
  const metric = selectedMetric;

  const xScale = d3
    .scaleBand()
    .domain(groups.map((d) => d.key))
    .range([0, explorerInnerWidth])
    .padding(0.12);

  const maxY = d3.max(groups, (d) => d.value) || 1;

  const yScale = d3
    .scaleLinear()
    .domain([0, maxY])
    .nice()
    .range([explorerInnerHeight, 0]);

  explorerXScale = xScale;
  explorerYScale = yScale;

  explorerXAxisG.call(d3.axisBottom(xScale));
  explorerYAxisG.call(d3.axisLeft(yScale).ticks(6));

  explorerXAxisLabel.text(dimensionLabels[selectedDimension]);
  explorerYAxisLabel.text(metricLabels[metric]);

  const bars = explorerBarsG.selectAll("rect").data(groups, (d) => d.key);

  const barsEnter = bars
    .enter()
    .append("rect")
    .attr("x", (d) => xScale(d.key))
    .attr("width", xScale.bandwidth())
    .attr("y", explorerInnerHeight)
    .attr("height", 0)
    .attr("rx", 4)
    .attr("ry", 4)
    .style("cursor", "pointer");

  const barsAll = barsEnter.merge(bars);

  barsAll
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("opacity", 0.85);

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.key}</strong><br>` +
            `${metricLabels[selectedMetric]
              .toLowerCase()
              .replace("%", "percent")}: ${d.value.toFixed(1)}`
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 24 + "px");
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 24 + "px");
    })
    .on("mouseleave", function () {
      d3.select(this).attr("opacity", 1);
      tooltip.style("opacity", 0);
    })
    .on("click", function (event, d) {
      selectedGroupKey = selectedGroupKey === d.key ? null : d.key;
      updateExplorerChart();
      updateStatsChart();
      updateDefenseHeatmap();
    })
    .transition()
    .duration(500)
    .attr("x", (d) => xScale(d.key))
    .attr("width", xScale.bandwidth())
    .attr("y", (d) => yScale(d.value))
    .attr("height", (d) => explorerInnerHeight - yScale(d.value))
    .attr("fill", (d) =>
      d.key === selectedGroupKey ? "#f97316" : "#6366f1"
    );

  bars.exit().remove();

  const total = getFilteredMonstersBase().length;
  explorerSummary.textContent = `Showing ${groups.length} ${
    dimensionLabels[selectedDimension].toLowerCase()
  } groups (${total} monsters after filters).`;
}

// ----------------- Stats vs CR scatterplot -----------------

function initStatsChart() {
  const container = document.getElementById("stats-chart");
  if (!container) return;

  statsWidth = container.clientWidth || 900;
  statsHeight = 420;

  statsInnerWidth =
    statsWidth - statsMargin.left - statsMargin.right;
  statsInnerHeight =
    statsHeight - statsMargin.top - statsMargin.bottom;

  statsSvg = d3
    .select("#stats-chart")
    .append("svg")
    .attr("viewBox", [0, 0, statsWidth, statsHeight]);

  statsG = statsSvg
    .append("g")
    .attr(
      "transform",
      `translate(${statsMargin.left},${statsMargin.top})`
    );

  statsXAxisG = statsG
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${statsInnerHeight})`);

  statsYAxisG = statsG.append("g").attr("class", "y-axis");

  statsXAxisLabel = statsG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${statsInnerWidth / 2}, ${
        statsInnerHeight + 46
      })`
    )
    .text("CHALLENGE RATING (CR)");

  statsYAxisLabel = statsG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${-50}, ${statsInnerHeight / 2}) rotate(-90)`
    )
    .text("HIT POINTS");

  statsCorrelationLabel = statsG
    .append("text")
    .attr("class", "correlation-label")
    .attr("text-anchor", "start")
    .attr("x", 4)
    .attr("y", 14);

  statsTrendLine = statsG
    .append("line")
    .attr("stroke", "#f97316")
    .attr("stroke-width", 2)
    .attr("opacity", 0.9);

  statsPointsG = statsG.append("g").attr("class", "points");
}

function pearsonCorrelation(data, xAccessor, yAccessor) {
  const n = data.length;
  if (n < 2) return NaN;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;

  for (const d of data) {
    const x = xAccessor(d);
    const y = yAccessor(d);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt(
    (n * sumX2 - sumX * sumX) *
      (n * sumY2 - sumY * sumY)
  );
  if (den === 0) return NaN;
  return num / den;
}

function linearRegression(data, xAccessor, yAccessor) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, valid: false };

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;

  for (const d of data) {
    const x = xAccessor(d);
    const y = yAccessor(d);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: 0, valid: false };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = sumY / n - slope * (sumX / n);
  return { slope, intercept, valid: true };
}

function updateStatsChart() {
  if (!statsPointsG) return;

  const statCfg = statConfig[selectedStatKey] || statConfig.hp;
  const statField = statCfg.field;

  const base = getFilteredMonstersBase();
  const field = dimField[selectedDimension];

  let data = base;
  if (selectedGroupKey != null) {
    data = base.filter((d) => d[field] === selectedGroupKey);
  }

  data = data.filter(
    (d) => !isNaN(d.cr) && !isNaN(d[statField])
  );

  const groupLabel =
    selectedGroupKey == null
      ? "All monsters (filtered)"
      : `${selectedGroupKey} (${dimensionLabels[
          selectedDimension
        ].toLowerCase()})`;

  if (statsGroupLabel) statsGroupLabel.textContent = groupLabel;

  if (!data.length) {
    statsPointsG.selectAll("circle").remove();
    statsTrendLine.attr("opacity", 0);
    statsCorrelationLabel.text("No monsters in this selection.");
    statsYAxisLabel.text(statCfg.label.toUpperCase());
    if (statsCaption) {
      statsCaption.textContent =
        "No data after filters and selection. Try expanding the CR range or clearing the bar selection.";
    }
    return;
  }

  const [minCR, maxCR] = getCurrentCRRange();
  const maxStat = d3.max(data, (d) => d[statField]);

  const xScale = d3
    .scaleLinear()
    .domain([minCR, maxCR])
    .nice()
    .range([0, statsInnerWidth]);

  const yScale = d3
    .scaleLinear()
    .domain([0, maxStat])
    .nice()
    .range([statsInnerHeight, 0]);

  statsXScale = xScale;
  statsYScale = yScale;

  statsXAxisG.call(d3.axisBottom(xScale).ticks(8));
  statsYAxisG.call(d3.axisLeft(yScale).ticks(6));

  statsYAxisLabel.text(statCfg.label.toUpperCase());

  const points = statsPointsG.selectAll("circle").data(data);
  const pointsEnter = points
    .enter()
    .append("circle")
    .attr("r", 3)
    .attr("fill", "#f97316")
    .attr("opacity", 0.7);

  const pointsAll = pointsEnter.merge(points);

  pointsAll
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("opacity", 1).attr("r", 4);

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.name}</strong><br>` +
            `CR: ${d.cr}<br>` +
            `${statCfg.label}: ${d[statField]}`
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 24 + "px");
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 24 + "px");
    })
    .on("mouseleave", function () {
      d3.select(this).attr("opacity", 0.7).attr("r", 3);
      tooltip.style("opacity", 0);
    })
    .transition()
    .duration(400)
    .attr("cx", (d) => xScale(d.cr))
    .attr("cy", (d) => yScale(d[statField]));

  points.exit().remove();

  const r = pearsonCorrelation(
    data,
    (d) => d.cr,
    (d) => d[statField]
  );
  const { slope, intercept, valid } = linearRegression(
    data,
    (d) => d.cr,
    (d) => d[statField]
  );

  if (valid) {
    const x0 = minCR;
    const x1 = maxCR;
    const y0 = slope * x0 + intercept;
    const y1 = slope * x1 + intercept;

    statsTrendLine
      .attr("x1", xScale(x0))
      .attr("y1", yScale(y0))
      .attr("x2", xScale(x1))
      .attr("y2", yScale(y1))
      .attr("opacity", 0.9);
  } else {
    statsTrendLine.attr("opacity", 0);
  }

  const rText = isNaN(r) ? "r: n/a" : `r = ${r.toFixed(2)}`;
  statsCorrelationLabel.text(rText);

  if (statsCaption) {
    statsCaption.textContent = `Each point is a monster in ${groupLabel}. The line shows a simple linear fit of ${statCfg.label} vs CR (${rText}).`;
  }
}

// ----------------- Defense heatmap -----------------

function initDefenseHeatmap() {
  const container = document.getElementById("defense-heatmap");
  if (!container) return;

  defenseWidth = container.clientWidth || 900;
  defenseHeight = 420;

  defenseInnerWidth =
    defenseWidth - defenseMargin.left - defenseMargin.right;
  defenseInnerHeight =
    defenseHeight - defenseMargin.top - defenseMargin.bottom;

  defenseSvg = d3
    .select("#defense-heatmap")
    .append("svg")
    .attr("viewBox", [0, 0, defenseWidth, defenseHeight]);

  defenseG = defenseSvg
    .append("g")
    .attr(
      "transform",
      `translate(${defenseMargin.left},${defenseMargin.top})`
    );

  defenseXAxisG = defenseG
    .append("g")
    .attr("class", "x-axis")
    .attr(
      "transform",
      `translate(0,${defenseInnerHeight})`
    );

  defenseYAxisG = defenseG
    .append("g")
    .attr("class", "y-axis");

  defenseG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${defenseInnerWidth / 2}, ${
        defenseInnerHeight + 48
      })`
    )
    .text("DAMAGE TYPE");

  defenseG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${-70}, ${
        defenseInnerHeight / 2
      }) rotate(-90)`
    )
    .text("GROUP");
}

function monsterHasDefenseType(monster, damageType) {
  let arr;
  if (defenseKind === "resist") arr = monster.resistTypes;
  else if (defenseKind === "immune") arr = monster.immuneTypes;
  else arr = monster.vulnTypes;
  return Array.isArray(arr) && arr.includes(damageType);
}

function updateDefenseHeatmap() {
  if (!defenseG) return;

  const base = getFilteredMonstersBase();
  const field = dimField[defenseGroupDimension];

  let data = base.filter((d) => d[field] != null);

  if (!data.length) {
    defenseG.selectAll("rect").remove();
    defenseXAxisG.selectAll("*").remove();
    defenseYAxisG.selectAll("*").remove();
    if (defenseHeatmapCaption) {
      defenseHeatmapCaption.textContent =
        "No monsters after filters; expand the CR range or clear filters.";
    }
    return;
  }

  // active damage types: those that actually appear in this selection
  activeDamageTypes = CANONICAL_DAMAGE_TYPES.filter((dt) =>
    data.some((m) => monsterHasDefenseType(m, dt))
  );

  if (!activeDamageTypes.length) {
    defenseG.selectAll("rect").remove();
    defenseXAxisG.selectAll("*").remove();
    defenseYAxisG.selectAll("*").remove();
    if (defenseHeatmapCaption) {
      defenseHeatmapCaption.textContent =
        "No monsters in this selection have the chosen kind of damage defense.";
    }
    return;
  }

  const groups = d3
    .groups(data, (d) => d[field])
    .sort(([a], [b]) => d3.ascending(a, b));

  const cells = [];
  let maxPercent = 0;

  for (const [groupKey, groupMonsters] of groups) {
    const total = groupMonsters.length;
    for (const dt of activeDamageTypes) {
      const count = groupMonsters.filter((m) =>
        monsterHasDefenseType(m, dt)
      ).length;
      const pct = (count / total) * 100;
      maxPercent = Math.max(maxPercent, pct);
      cells.push({
        group: groupKey,
        damageType: dt,
        percent: pct,
        count,
        total
      });
    }
  }

  const xScale = d3
    .scaleBand()
    .domain(activeDamageTypes)
    .range([0, defenseInnerWidth])
    .padding(0.03);

  const yScale = d3
    .scaleBand()
    .domain(groups.map(([g]) => g))
    .range([0, defenseInnerHeight])
    .padding(0.03);

  defenseXScale = xScale;
  defenseYScale = yScale;

  defenseColorScale = d3
    .scaleSequential(d3.interpolateYlGnBu)
    .domain([0, maxPercent || 1]);

  defenseXAxisG
    .call(d3.axisBottom(xScale))
    .selectAll("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-35)");

  defenseYAxisG.call(d3.axisLeft(yScale));

  const rects = defenseG
    .selectAll("rect.cell")
    .data(cells, (d) => d.group + "|" + d.damageType);

  const rectsEnter = rects
    .enter()
    .append("rect")
    .attr("class", "cell")
    .attr("rx", 2)
    .attr("ry", 2);

  const rectsAll = rectsEnter.merge(rects);

  rectsAll
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("stroke", "#111827").attr("stroke-width", 1);

      const kindLabel = defenseKindLabels[defenseKind] || "defenses";
      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.group}</strong><br>` +
          `${d.percent.toFixed(1)}% of monsters have ${kindLabel} to <strong>${d.damageType}</strong>.`
        )

        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 24 + "px");
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 24 + "px");
    })
    .on("mouseleave", function () {
      d3.select(this).attr("stroke", "none");
      tooltip.style("opacity", 0);
    })
    .transition()
    .duration(400)
    .attr("x", (d) => xScale(d.damageType))
    .attr("y", (d) => yScale(d.group))
    .attr("width", xScale.bandwidth())
    .attr("height", yScale.bandwidth())
    .attr("fill", (d) => defenseColorScale(d.percent));

  rects.exit().remove();

  if (defenseHeatmapCaption) {
    const dimLabel =
      dimensionLabels[defenseGroupDimension].toLowerCase();
    const kindLabel = defenseKindLabels[defenseKind];
    defenseHeatmapCaption.textContent =
      `Each cell shows the percentage of ${dimLabel} whose monsters ` +
      `have ${kindLabel} to a given damage type (after CR and movement filters).`;
  }
}

// ----------------- Caption & updates -----------------

function updateExplorerCaption() {
  const dim = selectedDimension;
  const metric = selectedMetric;
  const dimLabel = dimensionLabels[dim] || "group";
  const metricLabel = metricLabels[metric] || "value";

  explorerCaption.innerHTML =
    `Each bar shows the <strong>${metricLabel.toLowerCase()}</strong> ` +
    `for each <strong>${dimLabel}</strong>, after applying the CR range and movement filters above. ` +
    `Change the dropdowns to pivot between different groupings and metrics.`;
}

function updateAll() {
  updateExplorerChart();
  updateStatsChart();
  updateDefenseHeatmap();
}

// ----------------- Event listeners -----------------

dimensionSelect.addEventListener("change", () => {
  selectedDimension = dimensionSelect.value;
  selectedGroupKey = null;
  updateExplorerCaption();
  updateAll();
});

metricSelect.addEventListener("change", () => {
  selectedMetric = metricSelect.value;
  updateExplorerCaption();
  updateAll();
});

crMinInput.addEventListener("change", updateAll);
crMaxInput.addEventListener("change", updateAll);
flyFilter.addEventListener("change", updateAll);
swimFilter.addEventListener("change", updateAll);

if (statSelect) {
  statSelect.addEventListener("change", () => {
    selectedStatKey = statSelect.value;
    updateStatsChart();
  });
}

if (defenseKindSelect) {
  defenseKindSelect.addEventListener("change", () => {
    defenseKind = defenseKindSelect.value;
    updateDefenseHeatmap();
  });
}

if (defenseGroupSelect) {
  defenseGroupSelect.addEventListener("change", () => {
    defenseGroupDimension = defenseGroupSelect.value;
    updateDefenseHeatmap();
  });
}
