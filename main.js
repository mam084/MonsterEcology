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
  const f = parseFloat(cleaned);
  return isNaN(f) ? NaN : f;
}

// ------- Global state & DOM refs -------

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

const chartWidth = 880;
const chartHeight = 420;
const margin = { top: 20, right: 10, bottom: 100, left: 70 };

let monsters = []; // full monster list (one row per monster)
let crMinData = 0;
let crMaxData = 0;

const metricLabels = {
  count: "Number of monsters",
  avgCR: "Average challenge rating",
  avgHP: "Average hit points",
  avgAC: "Average armor class",
  pctFly: "Percent of monsters that can fly",
  pctSwim: "Percent of monsters that can swim",
};

const dimensionLabels = {
  environment: "environment",
  type: "monster type",
  size: "size",
};

// ------- SVG setup -------

const svg = d3
  .select("#explorer-chart")
  .append("svg")
  .attr("viewBox", [0, 0, chartWidth, chartHeight]);

const innerWidth = chartWidth - margin.left - margin.right;
const innerHeight = chartHeight - margin.top - margin.bottom;

const g = svg
  .append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const xAxisG = g.append("g").attr("transform", `translate(0,${innerHeight})`);
const yAxisG = g.append("g");

const xLabel = g
  .append("text")
  .attr("x", innerWidth / 2)
  .attr("y", innerHeight + 70)
  .attr("text-anchor", "middle");

const yLabel = g
  .append("text")
  .attr("x", -innerHeight / 2)
  .attr("y", -50)
  .attr("transform", "rotate(-90)")
  .attr("text-anchor", "middle");

// ------- Load data -------

d3.csv("monsters_ecology.csv").then((data) => {
  monsters = data.map((d) => {
    // Use 'environment' or fall back to 'env_list' if that's what you have
    const envField = d.environment || d.env_list || "";
    const env = envField.split(",")[0].trim(); // take first env for grouping

    const crNum = parseCR(d.cr);
    const hpNum = d.hp ? +d.hp : NaN;
    const acNum = d.ac ? +d.ac : NaN;
    const flySpeed = d.speed_fly ? +d.speed_fly : 0;
    const swimSpeed = d.speed_swim ? +d.speed_swim : 0;

    return {
      name: d.name,
      type: d.type || "Unknown",
      size: d.size || "Unknown",
      environment: env || "Unknown",
      cr_raw: d.cr,
      cr_num: crNum,
      hp: hpNum,
      ac: acNum,
      hasFly: flySpeed > 0,
      hasSwim: swimSpeed > 0,
    };
  });

  const crValues = monsters
    .map((d) => d.cr_num)
    .filter((x) => !isNaN(x))
    .sort((a, b) => a - b);

  crMinData = crValues[0] ?? 0;
  crMaxData = crValues[crValues.length - 1] ?? 30;

  // Set default CR range in inputs
  crMinInput.value = crMinData;
  crMaxInput.value = crMaxData;
  crRangeNote.textContent = `Data CR range: ${crMinData} to ${crMaxData}`;

  updateCaption();
  updateChart();

  summaryEl.textContent =
    "Tip: try narrowing the CR range to low-level monsters, " +
    "then switch the metric between count, average CR, and % that can fly " +
    "to see how each grouping changes.";
});

// ------- Core update pipeline -------

function getFilteredData() {
  const crMin = parseFloat(crMinInput.value);
  const crMax = parseFloat(crMaxInput.value);
  const onlyFly = flyFilterCheckbox.checked;
  const onlySwim = swimFilterCheckbox.checked;

  return monsters.filter((d) => {
    if (isNaN(d.cr_num)) return false;
    if (!isNaN(crMin) && d.cr_num < crMin) return false;
    if (!isNaN(crMax) && d.cr_num > crMax) return false;
    if (onlyFly && !d.hasFly) return false;
    if (onlySwim && !d.hasSwim) return false;
    return true;
  });
}

function computeGroups(filtered, dimension, metric) {
  const keyFn = (d) => d[dimension] || "Unknown";

  const roll = d3.rollup(
    filtered,
    (v) => {
      if (v.length === 0) return NaN;

      switch (metric) {
        case "count":
          return v.length;
        case "avgCR":
          return d3.mean(v, (d) => d.cr_num);
        case "avgHP":
          return d3.mean(v, (d) => (isNaN(d.hp) ? null : d.hp));
        case "avgAC":
          return d3.mean(v, (d) => (isNaN(d.ac) ? null : d.ac));
        case "pctFly":
          return (
            (d3.mean(v, (d) => (d.hasFly ? 1 : 0)) || 0) * 100
          );
        case "pctSwim":
          return (
            (d3.mean(v, (d) => (d.hasSwim ? 1 : 0)) || 0) * 100
          );
        default:
          return NaN;
      }
    },
    keyFn
  );

  const result = Array.from(roll, ([key, value]) => ({
    key,
    value,
  })).filter((d) => d.value != null && !isNaN(d.value));

  // Sort by value (desc), but keep key for display
  result.sort((a, b) => d3.descending(a.value, b.value));

  return result;
}

function updateCaption() {
  const dim = dimensionSelect.value;
  const metric = metricSelect.value;

  const dimLabel = dimensionLabels[dim] || "group";
  const metricLabel = metricLabels[metric] || "value";

  captionEl.innerHTML =
    `Each bar shows the <strong>${metricLabel.toLowerCase()}</strong> ` +
    `for each <strong>${dimLabel}</strong>, ` +
    `after applying the CR range and movement filters above. ` +
    `Change the dropdowns to pivot between different groupings and metrics.`;
}

function updateChart() {
  const dimension = dimensionSelect.value;
  const metric = metricSelect.value;

  const filtered = getFilteredData();
  const groups = computeGroups(filtered, dimension, metric);

  if (filtered.length === 0 || groups.length === 0) {
    summaryEl.textContent =
      "No monsters match the current filters. Widen the CR range or turn off one of the movement filters.";
  } else {
    const totalMonsters = filtered.length;
    const topGroup = groups[0];
    const metricLabel = metricLabels[metric];

    summaryEl.textContent =
      `Showing ${groups.length} ${dimensionLabels[dimension]} groups ` +
      `(${totalMonsters} monsters after filters). ` +
      `${topGroup ? `Top group: ${topGroup.key} (${metricLabel}: ${formatMetricValue(metric, topGroup.value)}).` : ""}`;
  }

  // Scales
  const x = d3
    .scaleBand()
    .domain(groups.map((d) => d.key))
    .range([0, innerWidth])
    .padding(0.15);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(groups, (d) => d.value) || 1])
    .nice()
    .range([innerHeight, 0]);

  // Axes
  const xAxis = d3
    .axisBottom(x)
    .tickSizeOuter(0)
    .tickPadding(4);

  xAxisG
    .transition()
    .duration(400)
    .call(xAxis)
    .selectAll("text")
    .attr("transform", "rotate(-45)")
    .style("text-anchor", "end");

  const yAxis = d3
    .axisLeft(y)
    .ticks(6);

  yAxisG.transition().duration(400).call(yAxis);

  xLabel.text(
    dimensionLabels[dimension]
      ? capitalizeFirst(dimensionLabels[dimension])
      : "Group"
  );

  yLabel.text(metricLabels[metric] || "Value");

  // Bars
  const bars = g.selectAll("rect.bar").data(groups, (d) => d.key);

  bars
    .join(
      (enter) =>
        enter
          .append("rect")
          .attr("class", "bar")
          .attr("x", (d) => x(d.key))
          .attr("y", innerHeight)
          .attr("width", x.bandwidth())
          .attr("height", 0)
          .attr("rx", 3)
          .attr("ry", 3)
          .attr("fill", "#4f46e5")
          .on("mouseover", function (event, d) {
            d3.select(this).attr("fill", "#7f5af0");
            tooltip
              .style("opacity", 1)
              .html(
                `<strong>${d.key}</strong><br/>` +
                  `${metricLabels[metric]}: ${formatMetricValue(
                    metric,
                    d.value
                  )}`
              );
          })
          .on("mousemove", function (event) {
            tooltip
              .style("left", event.pageX + 12 + "px")
              .style("top", event.pageY - 24 + "px");
          })
          .on("mouseout", function () {
            d3.select(this).attr("fill", "#4f46e5");
            tooltip.style("opacity", 0);
          })
          .call((enter) =>
            enter
              .transition()
              .duration(500)
              .attr("y", (d) => y(d.value))
              .attr("height", (d) => innerHeight - y(d.value))
          ),
      (update) =>
        update
          .transition()
          .duration(500)
          .attr("x", (d) => x(d.key))
          .attr("width", x.bandwidth())
          .attr("y", (d) => y(d.value))
          .attr("height", (d) => innerHeight - y(d.value)),
      (exit) =>
        exit
          .transition()
          .duration(400)
          .attr("y", innerHeight)
          .attr("height", 0)
          .remove()
    );
}

// ------- Helpers -------

function formatMetricValue(metric, value) {
  if (metric === "count") {
    return d3.format(",")(value);
  }
  if (metric === "pctFly" || metric === "pctSwim") {
    return d3.format(".1f")(value) + "%";
  }
  if (metric === "avgCR") {
    return d3.format(".2f")(value);
  }
  if (metric === "avgHP" || metric === "avgAC") {
    return d3.format(".1f")(value);
  }
  return d3.format(".2f")(value);
}

function capitalizeFirst(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ------- Event wiring -------

dimensionSelect.addEventListener("change", () => {
  updateCaption();
  updateChart();
});

metricSelect.addEventListener("change", () => {
  updateCaption();
  updateChart();
});

crMinInput.addEventListener("change", () => {
  updateChart();
});

crMaxInput.addEventListener("change", () => {
  updateChart();
});

flyFilterCheckbox.addEventListener("change", () => {
  updateChart();
});

swimFilterCheckbox.addEventListener("change", () => {
  updateChart();
});
