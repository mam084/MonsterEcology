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
let crMinData = 0;
let crMaxData = 30;

let selectedDimension = "environment";
let selectedMetric = "count";
let selectedGroupKey = null; // clicked bar, or null for "all"
let selectedStatKey = "hp";

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
  hp: { field: "hp", label: "Hit Points" },
  str: { field: "str", label: "Strength" },
  dex: { field: "dex", label: "Dexterity" },
  int: { field: "intScore", label: "Intelligence" },
};

// ------- DOM references -------

const tooltip = d3.select("#tooltip");

const dimensionSelect = document.getElementById("dimension-select");
const metricSelect = document.getElementById("metric-select");
const crMinInput = document.getElementById("cr-min");
const crMaxInput = document.getElementById("cr-max");
const crRangeNote = document.getElementById("cr-range-note");
const flyFilterCheckbox = document.getElementById("fly-filter");
const swimFilterCheckbox = document.getElementById("swim-filter");
const captionEl = document.getElementById("explorer-caption");
const summaryEl = document.getElementById("explorer-summary");

// Stats view controls (second chart)
const statSelect = document.getElementById("stat-select");
const statsGroupLabel = document.getElementById("stats-group-label");
const statsCaption = document.getElementById("stats-caption");

// ------- SVG setup -------

const explorerMargin = { top: 30, right: 20, bottom: 70, left: 70 };
const statsMargin = { top: 30, right: 20, bottom: 60, left: 70 };

let explorerWidth, explorerHeight, explorerInnerWidth, explorerInnerHeight;
let statsWidth, statsHeight, statsInnerWidth, statsInnerHeight;

let explorerSvg, explorerG, explorerXAxisG, explorerYAxisG;
let explorerBarsG, explorerXAxisLabel, explorerYAxisLabel;

let statsSvg, statsG, statsXAxisG, statsYAxisG;
let statsPointsG, statsXAxisLabel, statsYAxisLabel, statsCorrelationLabel, statsTrendLine;

let explorerXScale, explorerYScale;
let statsXScale, statsYScale;

// ------- Data loading -------

d3.csv("monsters_ecology.csv").then((data) => {
  monsters = data
    .map((d) => {
      // 1) ENVIRONMENT CLEANUP – same logic as the original version
      // Prefer environment; fall back to env_list if present
      let envRaw = (d.environment || d.env_list || "").toString().trim();

      // If it's a comma-separated list like "Forest, Hill", take the first one
      if (envRaw.includes(",")) {
        envRaw = envRaw.split(",")[0].trim();
      }

      // Normalize case for environment labels, allow null if missing
      let environment = null;
      if (envRaw !== "") {
        const lower = envRaw.toLowerCase();
        environment = lower.charAt(0).toUpperCase() + lower.slice(1);
      }

      // 2) SIZE CLEANUP – fix Tiny vs tiny, Large vs large, etc.
      let sizeRaw = (d.size || "Unknown").toString().trim();
      if (sizeRaw !== "") {
        const lowerSize = sizeRaw.toLowerCase();
        sizeRaw = lowerSize.charAt(0).toUpperCase() + lowerSize.slice(1);
      } else {
        sizeRaw = "Unknown";
      }

      // 3) TYPE CLEANUP
      let typeRaw = (d.type || "Unknown").toString().trim();
      if (typeRaw !== "") {
        const lowerType = typeRaw.toLowerCase();
        typeRaw = lowerType.charAt(0).toUpperCase() + lowerType.slice(1);
      } else {
        typeRaw = "Unknown";
      }

      const crNum = parseCR(d.cr);
      const hpNum = d.hp ? +d.hp : NaN;
      const acNum = d.ac ? +d.ac : NaN;

      const str = d.str ? +d.str : NaN;
      const dex = d.dex ? +d.dex : NaN;
      const con = d.con ? +d.con : NaN;
      const intScore = d.int ? +d.int : NaN;
      const wis = d.wis ? +d.wis : NaN;
      const cha = d.cha ? +d.cha : NaN;

      const flySpeed = d.speed_fly ? +d.speed_fly : 0;
      const swimSpeed = d.speed_swim ? +d.speed_swim : 0;

      return {
        name: d.name,
        type: typeRaw,
        size: sizeRaw,
        environment: environment, // can be null if missing
        cr_raw: d.cr,
        cr: crNum,
        hp: hpNum,
        ac: acNum,
        str,
        dex,
        con,
        intScore,
        wis,
        cha,
        hasFly: flySpeed > 0,
        hasSwim: swimSpeed > 0,
      };
    })
    .filter((d) => !isNaN(d.cr));

  const crValues = monsters
    .map((d) => d.cr)
    .filter((x) => !isNaN(x))
    .sort((a, b) => a - b);

  crMinData = crValues[0] ?? 0;
  crMaxData = crValues[crValues.length - 1] ?? 30;

  crMinInput.value = crMinData;
  crMaxInput.value = crMaxData;
  crRangeNote.textContent = `Data CR range: ${crMinData} to ${crMaxData}`;

  selectedStatKey = statSelect ? statSelect.value : "hp";

  initExplorerChart();
  initStatsChart();
  updateCaption();
  updateAll();
});

// ------- Filtering & grouping helpers -------

function getCurrentCRRange() {
  let min = parseFloat(crMinInput.value);
  let max = parseFloat(crMaxInput.value);

  if (isNaN(min)) min = crMinData;
  if (isNaN(max)) max = crMaxData;

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
    if (isNaN(d.cr)) return false;
    if (d.cr < minCR || d.cr > maxCR) return false;
    if (onlyFly && !d.hasFly) return false;
    if (onlySwim && !d.hasSwim) return false;
    return true;
  });
}

// group key used for both bar chart and stats selection
function getGroupKeyForMonster(d) {
  if (selectedDimension === "environment") return d.environment;
  if (selectedDimension === "size") return d.size || "Unknown";
  if (selectedDimension === "type") return d.type || "Unknown";
  return "Unknown";
}

function getGroupedData() {
  const base = getFilteredMonstersBase();

  let filtered = base;

  // For environments, drop monsters that truly have no environment
  if (selectedDimension === "environment") {
    filtered = filtered.filter((d) => d.environment && d.environment.trim() !== "");
  }

  const metric = selectedMetric;

  const roll = d3.rollups(
    filtered,
    (v) => {
      if (v.length === 0) return null;

      switch (metric) {
        case "count":
          return v.length;
        case "avgCR":
          return d3.mean(v, (d) => d.cr);
        case "avgHP":
          return d3.mean(v, (d) => (isNaN(d.hp) ? null : d.hp));
        case "avgAC":
          return d3.mean(v, (d) => (isNaN(d.ac) ? null : d.ac));
        case "pctFly":
          return (d3.mean(v, (d) => (d.hasFly ? 1 : 0)) || 0) * 100;
        case "pctSwim":
          return (d3.mean(v, (d) => (d.hasSwim ? 1 : 0)) || 0) * 100;
        default:
          return null;
      }
    },
    (d) => getGroupKeyForMonster(d)
  );

  let groups = Array.from(roll, ([key, value]) => ({
    key,
    value,
  })).filter((d) => d.value != null && !isNaN(d.value));

  // For environments, drop any "Unknown" bucket entirely
  if (selectedDimension === "environment") {
    groups = groups.filter((d) => d.key && d.key !== "Unknown");
  }

  // Sort and trim
  groups.sort((a, b) => d3.descending(a.value, b.value));
  const topN = selectedDimension === "size" ? groups.length : 18;
  return groups.slice(0, topN);
}

// ------- Explorer chart (bar) -------

function initExplorerChart() {
  const container = document.getElementById("explorer-chart");
  explorerWidth = container.clientWidth || 900;
  explorerHeight = 420;

  explorerInnerWidth = explorerWidth - explorerMargin.left - explorerMargin.right;
  explorerInnerHeight = explorerHeight - explorerMargin.top - explorerMargin.bottom;

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
    .attr(
      "transform",
      `translate(${explorerInnerWidth / 2}, ${explorerInnerHeight + 48})`
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

  explorerXScale = d3
    .scaleBand()
    .domain(groups.map((d) => d.key))
    .range([0, explorerInnerWidth])
    .padding(0.12);

  const maxY = d3.max(groups, (d) => d.value) || 1;

  explorerYScale = d3
    .scaleLinear()
    .domain([0, maxY])
    .nice()
    .range([explorerInnerHeight, 0]);

  const xAxis = d3.axisBottom(explorerXScale);
  const yAxis = d3.axisLeft(explorerYScale).ticks(6);

  explorerXAxisG.call(xAxis);
  explorerYAxisG.call(yAxis);

  explorerXAxisLabel.text(dimensionLabels[selectedDimension]);
  explorerYAxisLabel.text(metricLabels[metric]);

  const bars = explorerBarsG.selectAll("rect").data(groups, (d) => d.key);

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
          `<strong>${d.key}</strong><br>${metricLabels[metric]
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
      // Toggle selection
      selectedGroupKey = selectedGroupKey === d.key ? null : d.key;
      updateExplorerChart(); // recolor bars
      updateStatsChart(); // sync scatterplot
    })
    .merge(bars)
    .transition()
    .duration(500)
    .attr("x", (d) => explorerXScale(d.key))
    .attr("width", explorerXScale.bandwidth())
    .attr("y", (d) => explorerYScale(d.value))
    .attr("height", (d) => explorerInnerHeight - explorerYScale(d.value))
    .attr("fill", (d) => (d.key === selectedGroupKey ? "#f97316" : "#6366f1"));

  bars.exit().remove();

  const totalMonsters = getFilteredMonstersBase().length;
  summaryEl.textContent = `Showing ${groups.length} ${
    dimensionLabels[selectedDimension].toLowerCase()
  } groups (${totalMonsters} monsters after filters).`;
}

// ------- Stats scatterplot -------

function initStatsChart() {
  if (!document.getElementById("stats-chart")) return; // safety

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

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: 0, valid: false };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = sumY / n - slope * (sumX / n);
  return { slope, intercept, valid: true };
}

function updateStatsChart() {
  if (!statsPointsG) return; // stats view not on this page

  const statCfg = statConfig[selectedStatKey] || statConfig.hp;
  const statField = statCfg.field;

  const base = getFilteredMonstersBase();
  let data = base;

  if (selectedGroupKey != null) {
    data = base.filter(
      (d) => getGroupKeyForMonster(d) === selectedGroupKey
    );
  }

  // make sure CR + stat field are valid
  data = data.filter((d) => !isNaN(d.cr) && !isNaN(d[statField]));

  const groupLabel =
    selectedGroupKey == null
      ? "All monsters (filtered)"
      : `${selectedGroupKey} (${dimensionLabels[selectedDimension].toLowerCase()})`;

  if (statsGroupLabel) {
    statsGroupLabel.textContent = groupLabel;
  }

  if (data.length === 0) {
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

  // X axis now matches the current CR window
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

  const xAxis = d3.axisBottom(statsXScale).ticks(8);
  const yAxis = d3.axisLeft(statsYScale).ticks(6);

  statsXAxisG.call(xAxis);
  statsYAxisG.call(yAxis);

  statsYAxisLabel.text(statCfg.label.toUpperCase());

  // Points: intentionally NO key function so they fully rebind on stat change
  const points = statsPointsG.selectAll("circle").data(data);

  points
    .enter()
    .append("circle")
    .attr("r", 3)
    .attr("fill", "#f97316")
    .attr("opacity", 0.7)
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("opacity", 1).attr("r", 4);
      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.name}</strong><br>CR: ${d.cr}<br>${statCfg.label}: ${
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

  // Trend + correlation
  const r = pearsonCorrelation(data, (d) => d.cr, (d) => d[statField]);
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
    statsCaption.textContent = `Each point is a monster in ${groupLabel}. The line shows a simple linear fit of ${
      statCfg.label
    } vs CR (${rText}).`;
  }
}

// ------- Caption & global update -------

function updateCaption() {
  const dim = selectedDimension;
  const metric = selectedMetric;

  const dimLabel = dimensionLabels[dim] || "group";
  const metricLabel = metricLabels[metric] || "value";

  captionEl.innerHTML =
    `Each bar shows the <strong>${metricLabel.toLowerCase()}</strong> ` +
    `for each <strong>${dimLabel}</strong>, ` +
    `after applying the CR range and movement filters above. ` +
    `Change the dropdowns to pivot between different groupings and metrics.`;
}

function updateAll() {
  updateExplorerChart();
  updateStatsChart();
}

// ------- Event listeners -------

dimensionSelect.addEventListener("change", () => {
  selectedDimension = dimensionSelect.value;
  selectedGroupKey = null; // changing grouping resets selection
  updateCaption();
  updateAll();
});

metricSelect.addEventListener("change", () => {
  selectedMetric = metricSelect.value;
  updateCaption();
  updateExplorerChart();
  // stats chart uses same filters, not metric
  updateStatsChart();
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

if (statSelect) {
  statSelect.addEventListener("change", () => {
    selectedStatKey = statSelect.value;
    updateStatsChart();
  });
}
