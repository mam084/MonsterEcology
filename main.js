// ------- Helper: parse CR like "1/4" -> 0.25, "10" -> 10 -------
function parseCR(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  const s = String(value).trim();

  if (s.includes("/")) {
    const [n, d] = s.split("/");
    const num = parseFloat(n);
    const den = parseFloat(d);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }

  const cleaned = s.replace("+", ""); // e.g. "20+" -> "20"
  const num = parseFloat(cleaned);
  return isNaN(num) ? NaN : num;
}

// ------- Global state -------

let monsters = [];
let globalCRMin = 0;
let globalCRMax = 30;

let selectedDimension = "environment";
let selectedMetric = "count";
let selectedGroupKey = null; // value of the current bar selection, or null
let selectedStatKey = "hp";

const metricLabels = {
  count: "NUMBER OF MONSTERS",
  avgCR: "AVERAGE CR",
  avgHP: "AVERAGE HP",
  avgAC: "AVERAGE AC",
  pctFly: "% THAT CAN FLY",
  pctSwim: "% THAT CAN SWIM",
};

const dimensionLabels = {
  environment: "ENVIRONMENT",
  type: "MONSTER TYPE",
  size: "SIZE",
};

const statConfig = {
  hp: { field: "hp", label: "Hit Points" },
  str: { field: "str", label: "Strength" },
  dex: { field: "dex", label: "Dexterity" },
  int: { field: "int", label: "Intelligence" },
};

// ------- DOM references -------

const dimensionSelect = document.getElementById("dimension-select");
const metricSelect = document.getElementById("metric-select");
const crMinInput = document.getElementById("cr-min");
const crMaxInput = document.getElementById("cr-max");
const crRangeNote = document.getElementById("cr-range-note");
const flyFilterCheckbox = document.getElementById("fly-filter");
const swimFilterCheckbox = document.getElementById("swim-filter");

const explorerCaption = document.getElementById("explorer-caption");
const explorerSummary = document.getElementById("explorer-summary");

const statSelect = document.getElementById("stat-select");
const statsGroupLabel = document.getElementById("stats-group-label");
const statsCaption = document.getElementById("stats-caption");

// Tooltip div (already in HTML)
const tooltip = d3.select("#tooltip");

// ------- SVG setup for explorer (bar chart) -------

const explorerMargin = { top: 30, right: 20, bottom: 70, left: 70 };
const statsMargin = { top: 30, right: 20, bottom: 60, left: 70 };

let explorerWidth, explorerHeight, explorerInnerWidth, explorerInnerHeight;
let statsWidth, statsHeight, statsInnerWidth, statsInnerHeight;

let explorerSvg, explorerG, explorerXAxisG, explorerYAxisG;
let explorerBarsG, explorerXAxisLabel, explorerYAxisLabel;

let statsSvg, statsG, statsXAxisG, statsYAxisG;
let statsPointsG, statsXAxisLabel, statsYAxisLabel, statsCorrelationLabel, statsTrendLine;

// Scales
let explorerXScale, explorerYScale;
let statsXScale, statsYScale;

// ------- Data loading and bootstrapping -------

d3.csv("monsters_ecology.csv").then((raw) => {
  monsters = raw
    .map((d) => {
      const cr = parseCR(d.cr);
      const hp = +d.hp;
      const ac = +d.ac;
      const str = +d.str;
      const dex = +d.dex;
      const con = +d.con;
      const intScore = +d.int;
      const wis = +d.wis;
      const cha = +d.cha;

      const speedWalk = +d.speed_walk || 0;
      const speedFly = +d.speed_fly || 0;
      const speedSwim = +d.speed_swim || 0;

      return {
        ...d,
        cr,
        hp,
        ac,
        str,
        dex,
        con,
        int: intScore,
        wis,
        cha,
        speed_walk: speedWalk,
        speed_fly: speedFly,
        speed_swim: speedSwim,
        canFly: speedFly > 0,
        canSwim: speedSwim > 0,
      };
    })
    .filter((d) => !isNaN(d.cr));

  globalCRMin = d3.min(monsters, (d) => d.cr);
  globalCRMax = d3.max(monsters, (d) => d.cr);

  crMinInput.value = globalCRMin;
  crMaxInput.value = globalCRMax;
  crRangeNote.textContent = `Available CR: ${globalCRMin} to ${globalCRMax}`;

  initExplorerChart();
  initStatsChart();
  updateAll();
});

// ------- Utility: filters & grouped data -------

function getCurrentCRRange() {
  let min = parseFloat(crMinInput.value);
  let max = parseFloat(crMaxInput.value);

  if (isNaN(min)) min = globalCRMin;
  if (isNaN(max)) max = globalCRMax;

  if (min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  return [min, max];
}

function getFilteredMonstersBase() {
  const [minCR, maxCR] = getCurrentCRRange();
  const onlyFly = flyFilterCheckbox.checked;
  const onlySwim = swimFilterCheckbox.checked;

  return monsters.filter((d) => {
    if (d.cr < minCR || d.cr > maxCR) return false;
    if (onlyFly && !d.canFly) return false;
    if (onlySwim && !d.canSwim) return false;
    return true;
  });
}

function getGroupedData() {
  const base = getFilteredMonstersBase();

  // If grouping by environment, drop empty labels
  const filtered =
    selectedDimension === "environment"
      ? base.filter((d) => d.environment && d.environment.trim() !== "")
      : base;

  const rollups = d3.rollups(
    filtered,
    (v) => {
      const count = v.length;
      const avgCR = d3.mean(v, (d) => d.cr);
      const avgHP = d3.mean(v, (d) => d.hp);
      const avgAC = d3.mean(v, (d) => d.ac);
      const pctFly = 100 * d3.mean(v, (d) => (d.canFly ? 1 : 0));
      const pctSwim = 100 * d3.mean(v, (d) => (d.canSwim ? 1 : 0));
      return { count, avgCR, avgHP, avgAC, pctFly, pctSwim };
    },
    (d) => d[selectedDimension] || "Unknown"
  );

  const metricKey = selectedMetric;

  const groups = rollups
    .map(([key, stats]) => ({
      key,
      ...stats,
      value: stats[metricKey],
    }))
    .filter((d) => !isNaN(d.value));

  // Sort descending by value and keep top N for readability
  const topN = 18;
  groups.sort((a, b) => d3.descending(a.value, b.value));
  return groups.slice(0, topN);
}

// ------- Explorer chart (bar) setup & update -------

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
    )
    .text("ENVIRONMENT");

  explorerYAxisLabel = explorerG
    .append("text")
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${-48}, ${explorerInnerHeight / 2}) rotate(-90)`
    )
    .text("NUMBER OF MONSTERS");

  explorerBarsG = explorerG.append("g").attr("class", "bars");
}

function updateExplorerChart() {
  const groups = getGroupedData();
  const metricKey = selectedMetric;

  explorerXScale = d3
    .scaleBand()
    .domain(groups.map((d) => d.key))
    .range([0, explorerInnerWidth])
    .padding(0.12);

  const maxY = d3.max(groups, (d) => d[metricKey]) || 1;

  explorerYScale = d3
    .scaleLinear()
    .domain([0, maxY])
    .nice()
    .range([explorerInnerHeight, 0]);

  // Axes
  const xAxis = d3.axisBottom(explorerXScale);
  const yAxis = d3.axisLeft(explorerYScale).ticks(6);

  explorerXAxisG.call(xAxis);
  explorerYAxisG.call(yAxis);

  explorerXAxisLabel.text(dimensionLabels[selectedDimension]);
  explorerYAxisLabel.text(metricLabels[selectedMetric]);

  // Bars
  const bars = explorerBarsG
    .selectAll("rect")
    .data(groups, (d) => d.key);

  bars
    .enter()
    .append("rect")
    .attr("x", (d) => explorerXScale(d.key))
    .attr("width", explorerXScale.bandwidth())
    .attr("y", explorerInnerHeight)
    .attr("height", 0)
    .attr("rx", 4)
    .attr("ry", 4)
    .style("cursor", "pointer")
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("opacity", 0.85);

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.key}</strong><br>${metricLabels[selectedMetric]
            .toLowerCase()
            .replace("%", "percent")}: ${d[metricKey].toFixed(1)}`
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
      // Toggle selection
      selectedGroupKey = selectedGroupKey === d.key ? null : d.key;
      updateExplorerChart(); // recolor bars
      updateStatsChart(); // re-filter scatter
    })
    .merge(bars)
    .transition()
    .duration(500)
    .attr("x", (d) => explorerXScale(d.key))
    .attr("width", explorerXScale.bandwidth())
    .attr("y", (d) => explorerYScale(d[metricKey]))
    .attr("height", (d) => explorerInnerHeight - explorerYScale(d[metricKey]))
    .attr("fill", (d) =>
      d.key === selectedGroupKey ? "#f97316" : "#6366f1"
    );

  bars.exit().remove();

  // Summary text
  const totalMonsters = getFilteredMonstersBase().length;
  explorerSummary.textContent = `Showing ${groups.length} ${
    dimensionLabels[selectedDimension].toLowerCase()
  } groups (${totalMonsters} monsters after filters).`;
}

// ------- Stats scatterplot setup & update -------

function initStatsChart() {
  const container = document.getElementById("stats-chart");
  statsWidth = container.clientWidth || 900;
  statsHeight = 420;

  statsInnerWidth = statsWidth - statsMargin.left - statsMargin.right;
  statsInnerHeight = statsHeight - statsMargin.top - statsMargin.bottom;

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
      `translate(${statsInnerWidth / 2}, ${statsInnerHeight + 46})`
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
    .attr("y", 14)
    .text("");

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

  const numerator = n * sumXY - sumX * sumY;
  const denom = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );
  if (denom === 0) return NaN;
  return numerator / denom;
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

  const slope =
    (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  const intercept = sumY / n - slope * (sumX / n);
  return { slope, intercept, valid: true };
}

function updateStatsChart() {
  const base = getFilteredMonstersBase();

  // If a bar is selected, limit to that group
  let data = base;
  if (selectedGroupKey != null) {
    data = base.filter((d) => {
      const key = d[selectedDimension] || "Unknown";
      return key === selectedGroupKey;
    });
  }

  const stat = statConfig[selectedStatKey];
  const statField = stat.field;

  data = data.filter(
    (d) => !isNaN(d.cr) && !isNaN(d[statField])
  );

  const groupLabel =
    selectedGroupKey == null
      ? "All monsters (filtered)"
      : `${selectedGroupKey} (${dimensionLabels[
          selectedDimension
        ].toLowerCase()})`;

  statsGroupLabel.textContent = groupLabel;

  if (data.length === 0) {
    statsPointsG.selectAll("circle").remove();
    statsTrendLine.attr("opacity", 0);
    statsCorrelationLabel.text("No monsters in this selection.");
    statsYAxisLabel.text(stat.label.toUpperCase());
    statsCaption.textContent =
      "No data after filters and selection. Try expanding the CR range or clearing the bar selection.";
    return;
  }

  const maxCR = d3.max(data, (d) => d.cr);
  const maxStat = d3.max(data, (d) => d[statField]);

  statsXScale = d3
    .scaleLinear()
    .domain([0, Math.max(globalCRMax, maxCR)])
    .nice()
    .range([0, statsInnerWidth]);

  statsYScale = d3
    .scaleLinear()
    .domain([0, maxStat])
    .nice()
    .range([statsInnerHeight, 0]);

  const xAxis = d3.axisBottom(statsXScale).ticks(8);
  const yAxis = d3.axisLeft(statsYScale).ticks(6);

  statsXAxisG.call(xAxis);
  statsYAxisG.call(yAxis);

  statsYAxisLabel.text(stat.label.toUpperCase());

  // Points
  const points = statsPointsG
    .selectAll("circle")
    .data(data, (d) => d.name + "-" + d.cr + "-" + d[statField]);

  points
    .enter()
    .append("circle")
    .attr("cx", (d) => statsXScale(d.cr))
    .attr("cy", (d) => statsYScale(d[statField]))
    .attr("r", 3)
    .attr("fill", "#f97316")
    .attr("opacity", 0.7)
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("opacity", 1).attr("r", 4);

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.name}</strong><br>CR: ${d.cr}<br>${stat.label}: ${
            d[statField]
          }`
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
    .merge(points)
    .transition()
    .duration(400)
    .attr("cx", (d) => statsXScale(d.cr))
    .attr("cy", (d) => statsYScale(d[statField]));

  points.exit().remove();

  // Trend line + correlation
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
    const x0 = 0;
    const x1 = Math.max(globalCRMax, maxCR);
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

  statsCaption.textContent = `Each point is a monster in ${
    groupLabel[0].toLowerCase() === "a" ? "the" : ""
  } ${groupLabel}. The line shows a simple linear fit of ${
    stat.label
  } vs CR (${rText}).`;
}

// ------- Update both views together -------

function updateAll() {
  updateExplorerChart();
  updateStatsChart();
}

// ------- Event listeners -------

dimensionSelect.addEventListener("change", () => {
  selectedDimension = dimensionSelect.value;
  selectedGroupKey = null; // clear selection when changing dimension
  updateAll();
});

metricSelect.addEventListener("change", () => {
  selectedMetric = metricSelect.value;
  updateExplorerChart();
  // stats chart doesn't depend on metric directly
});

crMinInput.addEventListener("change", () => {
  updateAll();
});
crMaxInput.addEventListener("change", () => {
  updateAll();
});

flyFilterCheckbox.addEventListener("change", () => {
  updateAll();
});
swimFilterCheckbox.addEventListener("change", () => {
  updateAll();
});

statSelect.addEventListener("change", () => {
  selectedStatKey = statSelect.value;
  updateStatsChart();
});
