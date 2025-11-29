// ---------- Helpers ----------

// parse CR like "1/4" -> 0.25, "10" -> 10
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

// ---------- Global state ----------

let monsters = [];
let crMinData = 0;
let crMaxData = 30;

let selectedDimension = "environment"; // environment | type | size
let selectedMetric = "count";          // count, avgCR, avgHP, avgAC, pctFly, pctSwim
let selectedGroupKey = null;           // current bar selection, or null
let selectedStatKey = "hp";            // hp | str | dex | int

const dimensionLabels = {
  environment: "ENVIRONMENT",
  type: "MONSTER TYPE",
  size: "SIZE",
};

const metricLabels = {
  count: "NUMBER OF MONSTERS",
  avgCR: "AVERAGE CR",
  avgHP: "AVERAGE HP",
  avgAC: "AVERAGE AC",
  pctFly: "% THAT CAN FLY",
  pctSwim: "% THAT CAN SWIM",
};

const statConfig = {
  hp:  { field: "hp",       label: "Hit Points"   },
  str: { field: "str",      label: "Strength"     },
  dex: { field: "dex",      label: "Dexterity"    },
  int: { field: "intScore", label: "Intelligence" }
};

// map dimension -> precomputed field name on each monster
const dimField = {
  environment: "envGroup",
  type: "typeGroup",
  size: "sizeGroup"
};

// ---------- DOM references ----------

const tooltip         = d3.select("#tooltip");
const dimensionSelect = document.getElementById("dimension-select");
const metricSelect    = document.getElementById("metric-select");
const crMinInput      = document.getElementById("cr-min");
const crMaxInput      = document.getElementById("cr-max");
const crRangeNote     = document.getElementById("cr-range-note");
const flyFilter       = document.getElementById("fly-filter");
const swimFilter      = document.getElementById("swim-filter");
const explorerCaption = document.getElementById("explorer-caption");
const explorerSummary = document.getElementById("explorer-summary");

const statSelect      = document.getElementById("stat-select");
const statsGroupLabel = document.getElementById("stats-group-label");
const statsCaption    = document.getElementById("stats-caption");

// ---------- SVG set-up ----------

const explorerMargin = { top: 30, right: 20, bottom: 70, left: 70 };
const statsMargin    = { top: 30, right: 20, bottom: 60, left: 70 };

let explorerWidth, explorerHeight, explorerInnerWidth, explorerInnerHeight;
let statsWidth,   statsHeight,   statsInnerWidth,   statsInnerHeight;

let explorerSvg, explorerG, explorerXAxisG, explorerYAxisG;
let explorerBarsG, explorerXAxisLabel, explorerYAxisLabel;

let statsSvg, statsG, statsXAxisG, statsYAxisG;
let statsPointsG, statsXAxisLabel, statsYAxisLabel, statsCorrelationLabel, statsTrendLine;

let explorerXScale, explorerYScale;
let statsXScale, statsYScale;

// ---------- Data load ----------

d3.csv("monsters_ecology.csv").then(raw => {
  monsters = raw
    .map(row => {
      // --- environment mapping (same spirit as original) ---
      let env = (row.environment || row.env_list || "").toString().trim();
      if (env.includes(",")) env = env.split(",")[0].trim();
      env = env === "" ? null : capFirst(env);

      // --- size & type mapping ---
      let size = capFirst(row.size || "Unknown");
      let type = capFirst(row.type || "Unknown");

      const cr  = parseCR(row.cr);
      const hp  = row.hp  ? +row.hp  : NaN;
      const ac  = row.ac  ? +row.ac  : NaN;
      const str = row.str ? +row.str : NaN;
      const dex = row.dex ? +row.dex : NaN;
      const con = row.con ? +row.con : NaN;
      const intScore = row.int ? +row.int : NaN;
      const wis = row.wis ? +row.wis : NaN;
      const cha = row.cha ? +row.cha : NaN;

      const flySpeed  = row.speed_fly  ? +row.speed_fly  : 0;
      const swimSpeed = row.speed_swim ? +row.speed_swim : 0;

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
        // pre-normalized buckets
        envGroup:  env,
        typeGroup: type,
        sizeGroup: size,
        hasFly:  flySpeed  > 0,
        hasSwim: swimSpeed > 0
      };
    })
    .filter(d => !isNaN(d.cr));

  const crVals = monsters.map(d => d.cr).sort((a, b) => a - b);
  crMinData = crVals[0] ?? 0;
  crMaxData = crVals[crVals.length - 1] ?? 30;

  crMinInput.value = crMinData;
  crMaxInput.value = crMaxData;
  crRangeNote.textContent = `Data CR range: ${crMinData} to ${crMaxData}`;

  if (statSelect) selectedStatKey = statSelect.value;

  initExplorerChart();
  initStatsChart();
  updateExplorerCaption();
  updateAll();
});

// ---------- Filtering & grouping ----------

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
  const onlyFly  = flyFilter.checked;
  const onlySwim = swimFilter.checked;

  return monsters.filter(d => {
    if (isNaN(d.cr) || d.cr < minCR || d.cr > maxCR) return false;
    if (onlyFly  && !d.hasFly)  return false;
    if (onlySwim && !d.hasSwim) return false;
    return true;
  });
}

function getGroupedData() {
  const base = getFilteredMonstersBase();
  const field = dimField[selectedDimension];
  const metric = selectedMetric;

  // for environment grouping, drop truly missing envs
  const filtered =
    selectedDimension === "environment"
      ? base.filter(d => d.envGroup !== null)
      : base;

  const rollups = d3.rollups(
    filtered,
    v => {
      if (!v.length) return null;
      switch (metric) {
        case "count":
          return v.length;
        case "avgCR":
          return d3.mean(v, d => d.cr);
        case "avgHP":
          return d3.mean(v, d => d.hp);
        case "avgAC":
          return d3.mean(v, d => d.ac);
        case "pctFly":
          return (d3.mean(v, d => (d.hasFly ? 1 : 0)) || 0) * 100;
        case "pctSwim":
          return (d3.mean(v, d => (d.hasSwim ? 1 : 0)) || 0) * 100;
        default:
          return null;
      }
    },
    d => d[field]
  );

  let groups = rollups
    .map(([key, value]) => ({ key, value }))
    .filter(d => d.key != null && d.value != null && !isNaN(d.value));

  // drop Unknown env if we somehow have it
  if (selectedDimension === "environment") {
    groups = groups.filter(d => d.key !== "Unknown");
  }

  groups.sort((a, b) => d3.descending(a.value, b.value));
  const topN = selectedDimension === "size" ? groups.length : 18;
  return groups.slice(0, topN);
}

// ---------- Explorer (bar chart) ----------

function initExplorerChart() {
  const container = document.getElementById("explorer-chart");
  explorerWidth  = container.clientWidth || 900;
  explorerHeight = 420;

  explorerInnerWidth  = explorerWidth  - explorerMargin.left - explorerMargin.right;
  explorerInnerHeight = explorerHeight - explorerMargin.top  - explorerMargin.bottom;

  explorerSvg = d3
    .select("#explorer-chart")
    .append("svg")
    .attr("viewBox", [0, 0, explorerWidth, explorerHeight]);

  explorerG = explorerSvg
    .append("g")
    .attr("transform", `translate(${explorerMargin.left},${explorerMargin.top})`);

  explorerXAxisG = explorerG
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${explorerInnerHeight})`);

  explorerYAxisG = explorerG.append("g").attr("class", "y-axis");

  explorerXAxisLabel = explorerG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr("transform", `translate(${explorerInnerWidth / 2}, ${explorerInnerHeight + 48})`);

  explorerYAxisLabel = explorerG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr("transform", `translate(${-48}, ${explorerInnerHeight / 2}) rotate(-90)`);

  explorerBarsG = explorerG.append("g").attr("class", "bars");
}

function updateExplorerChart() {
  const groups = getGroupedData();
  const metric = selectedMetric;

  explorerXScale = d3
    .scaleBand()
    .domain(groups.map(d => d.key))
    .range([0, explorerInnerWidth])
    .padding(0.12);

  const maxY = d3.max(groups, d => d.value) || 1;

  explorerYScale = d3
    .scaleLinear()
    .domain([0, maxY])
    .nice()
    .range([explorerInnerHeight, 0]);

  explorerXAxisG.call(d3.axisBottom(explorerXScale));
  explorerYAxisG.call(d3.axisLeft(explorerYScale).ticks(6));

  explorerXAxisLabel.text(dimensionLabels[selectedDimension]);
  explorerYAxisLabel.text(metricLabels[metric]);

  const bars = explorerBarsG
    .selectAll("rect")
    .data(groups, (d) => d.key);

  const barsEnter = bars
    .enter()
    .append("rect")
    .attr("x", (d) => explorerXScale(d.key))
    .attr("width", explorerXScale.bandwidth())
    .attr("y", explorerInnerHeight)
    .attr("height", 0)
    .attr("rx", 4)
    .attr("ry", 4)
    .style("cursor", "pointer");

  const barsAll = barsEnter.merge(bars);

  // IMPORTANT: (re)attach hover + click handlers on the MERGED selection
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
      // toggle selection & sync both charts
      selectedGroupKey = selectedGroupKey === d.key ? null : d.key;
      updateExplorerChart();
      updateStatsChart();
    })
    .transition()
    .duration(500)
    .attr("x", (d) => explorerXScale(d.key))
    .attr("width", explorerXScale.bandwidth())
    .attr("y", (d) => explorerYScale(d.value))
    .attr("height", (d) => explorerInnerHeight - explorerYScale(d.value))
    .attr("fill", (d) =>
      d.key === selectedGroupKey ? "#f97316" : "#6366f1"
    );

  bars.exit().remove();


  const total = getFilteredMonstersBase().length;
  explorerSummary.textContent = `Showing ${groups.length} ${
    dimensionLabels[selectedDimension].toLowerCase()
  } groups (${total} monsters after filters).`;
}

// ---------- Stats scatterplot ----------

function initStatsChart() {
  const container = document.getElementById("stats-chart");
  if (!container) return;

  statsWidth  = container.clientWidth || 900;
  statsHeight = 420;

  statsInnerWidth  = statsWidth  - statsMargin.left - statsMargin.right;
  statsInnerHeight = statsHeight - statsMargin.top  - statsMargin.bottom;

  statsSvg = d3
    .select("#stats-chart")
    .append("svg")
    .attr("viewBox", [0, 0, statsWidth, statsHeight]);

  statsG = statsSvg
    .append("g")
    .attr("transform", `translate(${statsMargin.left},${statsMargin.top})`);

  statsXAxisG = statsG
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${statsInnerHeight})`);

  statsYAxisG = statsG.append("g").attr("class", "y-axis");

  statsXAxisLabel = statsG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr("transform", `translate(${statsInnerWidth / 2}, ${statsInnerHeight + 46})`)
    .text("CHALLENGE RATING (CR)");

  statsYAxisLabel = statsG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr("transform", `translate(${-50}, ${statsInnerHeight / 2}) rotate(-90)`)
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

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
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
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );
  if (den === 0) return NaN;
  return num / den;
}

function linearRegression(data, xAccessor, yAccessor) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, valid: false };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
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

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = sumY / n - slope * (sumX / n);
  return { slope, intercept, valid: true };
}

function updateStatsChart() {
  if (!statsPointsG) return;

  const statCfg   = statConfig[selectedStatKey] || statConfig.hp;
  const statField = statCfg.field;

  const base = getFilteredMonstersBase();
  const field = dimField[selectedDimension];

  let data = base;
  if (selectedGroupKey != null) {
    data = base.filter(d => d[field] === selectedGroupKey);
  }

  data = data.filter(d => !isNaN(d.cr) && !isNaN(d[statField]));

  const groupLabel =
    selectedGroupKey == null
      ? "All monsters (filtered)"
      : `${selectedGroupKey} (${dimensionLabels[selectedDimension].toLowerCase()})`;

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
  const maxStat = d3.max(data, d => d[statField]);

  // CR axis matches current window
  statsXScale = d3
    .scaleLinear()
    .domain([minCR, maxCR])
    .nice()
    .range([0, statsInnerWidth]);

  statsYScale = d3
    .scaleLinear()
    .domain([0, maxStat])
    .nice()
    .range([statsInnerHeight, 0]);

  statsXAxisG.call(d3.axisBottom(statsXScale).ticks(8));
  statsYAxisG.call(d3.axisLeft(statsYScale).ticks(6));

  statsYAxisLabel.text(statCfg.label.toUpperCase());

  // NO key function: always rebind fully so we don't get stale HP tooltips
    const points = statsPointsG.selectAll("circle").data(data);

  const pointsEnter = points
    .enter()
    .append("circle")
    .attr("r", 3)
    .attr("fill", "#f97316")
    .attr("opacity", 0.7);

  const pointsAll = pointsEnter.merge(points);

  // IMPORTANT: (re)attach hover handlers on the MERGED selection
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
    .attr("cx", (d) => statsXScale(d.cr))
    .attr("cy", (d) => statsYScale(d[statField]));

  points.exit().remove();


  // Trend + correlation
  const r = pearsonCorrelation(data, d => d.cr, d => d[statField]);
  const { slope, intercept, valid } = linearRegression(
    data,
    d => d.cr,
    d => d[statField]
  );

  if (valid) {
    const x0 = minCR;
    const x1 = maxCR;
    const y0 = slope * x0 + intercept;
    const y1 = slope * x1 + intercept;

    statsTrendLine
      .attr("x1", statsXScale(x0))
      .attr("y1", statsYScale(y0))
      .attr("x2", statsXScale(x1))
      .attr("y2", statsYScale(y1))
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

// ---------- Caption & update wiring ----------

function updateExplorerCaption() {
  const dim    = selectedDimension;
  const metric = selectedMetric;
  const dimLabel    = dimensionLabels[dim]    || "group";
  const metricLabel = metricLabels[metric]    || "value";

  explorerCaption.innerHTML =
    `Each bar shows the <strong>${metricLabel.toLowerCase()}</strong> ` +
    `for each <strong>${dimLabel}</strong>, after applying the CR range and movement filters above. ` +
    `Change the dropdowns to pivot between different groupings and metrics.`;
}

function updateAll() {
  updateExplorerChart();
  updateStatsChart();
}

// ---------- Event listeners ----------

dimensionSelect.addEventListener("change", () => {
  selectedDimension = dimensionSelect.value;
  selectedGroupKey = null; // reset selection when grouping changes
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
