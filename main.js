// ------- Helper: parse CR like "1/4" -> 0.25, "10" -> 10 -------
function parseCR(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  const s = String(value).trim();

  if (s.includes("/")) {
    const parts = s.split("/");
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }

  const cleaned = s.replace("+", ""); // e.g., "20+" -> "20"
  const f = parseFloat(cleaned);
  return isNaN(f) ? NaN : f;
}

// ------- Tooltip -------
const tooltip = d3.select("#tooltip");

// ------- Shared chart config -------
const chartWidth = 800;
const chartHeight = 360;
const margin = { top: 20, right: 10, bottom: 80, left: 60 };

let selectedEnvironment = null;

// Text update when environment is clicked
function updateSelectionText() {
  const el = document.getElementById("env-selection-text");
  if (!selectedEnvironment) {
    el.textContent = "No environment selected yet.";
  } else {
    el.textContent = `Selected environment: ${selectedEnvironment}`;
  }
}

// ------- Main load -------
d3.csv("monsters_ecology.csv").then((raw) => {
  // Explode comma-separated environments into one row per (monster, environment)
  const exploded = [];

  raw.forEach((d) => {
    const crNum = parseCR(d.cr);
    const envStr = (d.environment || "").trim();

    if (!envStr) return;

    envStr.split(",").forEach((e) => {
      const env = e.trim();
      if (!env) return;
      exploded.push({
        environment: env,
        cr_num: crNum,
      });
    });
  });

  // Rollups
  const envCounts = Array.from(
    d3.rollup(
      exploded,
      (v) => v.length,
      (d) => d.environment
    ),
    ([environment, count]) => ({ environment, count })
  ).sort((a, b) => d3.descending(a.count, b.count));

  const envAvgCR = Array.from(
    d3.rollup(
      exploded,
      (v) => d3.mean(v, (d) => d.cr_num),
      (d) => d.environment
    ),
    ([environment, avgCR]) => ({ environment, avgCR })
  ).sort((a, b) => d3.descending(a.avgCR, b.avgCR));

  // Use the same order of environments for both charts
  const envOrder = envCounts.map((d) => d.environment);

  buildEnvCountsChart(envCounts, envOrder);
  buildEnvCRChart(envAvgCR, envOrder);
  updateSelectionText();
});

// ------- Chart 1: Monster counts by environment -------
function buildEnvCountsChart(data, envOrder) {
  const svg = d3
    .select("#env-counts-chart")
    .append("svg")
    .attr("viewBox", [0, 0, chartWidth, chartHeight]);

  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;

  const x = d3
    .scaleBand()
    .domain(envOrder)
    .range([0, innerWidth])
    .padding(0.12);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.count)])
    .nice()
    .range([innerHeight, 0]);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .tickSizeOuter(0)
        .tickPadding(4)
    )
    .selectAll("text")
    .attr("transform", "rotate(-45)")
    .style("text-anchor", "end");

  g.append("g").call(d3.axisLeft(y));

  g.append("text")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + 60)
    .attr("text-anchor", "middle")
    .text("Environment");

  g.append("text")
    .attr("x", -innerHeight / 2)
    .attr("y", -40)
    .attr("text-anchor", "middle")
    .attr("transform", "rotate(-90)")
    .text("Number of monsters");

  // Bars
  g.selectAll("rect.bar")
    .data(data)
    .join("rect")
    .attr("class", "bar")
    .attr("x", (d) => x(d.environment))
    .attr("y", (d) => y(d.count))
    .attr("width", x.bandwidth())
    .attr("height", (d) => innerHeight - y(d.count))
    .attr("fill", (d) =>
      d.environment === selectedEnvironment ? "#7f5af0" : "#4f46e5"
    )
    .on("mouseover", function (event, d) {
      d3.select(this).attr("fill", "#9f7aea");

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.environment}</strong><br/>Monsters: ${d.count}`
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 20 + "px");
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 20 + "px");
    })
    .on("mouseout", function (event, d) {
      tooltip.style("opacity", 0);

      d3.select(this).attr(
        "fill",
        d.environment === selectedEnvironment ? "#7f5af0" : "#4f46e5"
      );
    })
    .on("click", function (event, d) {
      selectedEnvironment =
        selectedEnvironment === d.environment ? null : d.environment;
      updateSelectionText();

      // Re-color all bars based on the new selection
      d3.select("#env-counts-chart")
        .selectAll("rect.bar")
        .attr("fill", (b) =>
          b.environment === selectedEnvironment ? "#7f5af0" : "#4f46e5"
        );

      // Highlight corresponding bar in the CR chart
      d3.select("#env-cr-chart")
        .selectAll("rect.bar-cr")
        .attr("fill", (b) =>
          b.environment === selectedEnvironment ? "#f97316" : "#38bdf8"
        );
    });
}

// ------- Chart 2: Average CR by environment -------
function buildEnvCRChart(data, envOrder) {
  const svg = d3
    .select("#env-cr-chart")
    .append("svg")
    .attr("viewBox", [0, 0, chartWidth, chartHeight]);

  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;

  const x = d3
    .scaleBand()
    .domain(envOrder)
    .range([0, innerWidth])
    .padding(0.12);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.avgCR || 0)])
    .nice()
    .range([innerHeight, 0]);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .tickSizeOuter(0)
        .tickPadding(4)
    )
    .selectAll("text")
    .attr("transform", "rotate(-45)")
    .style("text-anchor", "end");

  g.append("g").call(d3.axisLeft(y));

  g.append("text")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + 60)
    .attr("text-anchor", "middle")
    .text("Environment");

  g.append("text")
    .attr("x", -innerHeight / 2)
    .attr("y", -40)
    .attr("text-anchor", "middle")
    .attr("transform", "rotate(-90)")
    .text("Average CR");

  g.selectAll("rect.bar-cr")
    .data(data)
    .join("rect")
    .attr("class", "bar-cr")
    .attr("x", (d) => x(d.environment))
    .attr("y", (d) => y(d.avgCR || 0))
    .attr("width", x.bandwidth())
    .attr("height", (d) => innerHeight - y(d.avgCR || 0))
    .attr("fill", (d) =>
      d.environment === selectedEnvironment ? "#f97316" : "#38bdf8"
    )
    .on("mouseover", function (event, d) {
      d3.select(this).attr("fill", "#fb923c");

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.environment}</strong><br/>Average CR: ${d.avgCR.toFixed(
            2
          )}`
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 20 + "px");
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY - 20 + "px");
    })
    .on("mouseout", function (event, d) {
      tooltip.style("opacity", 0);

      d3.select(this).attr(
        "fill",
        d.environment === selectedEnvironment ? "#f97316" : "#38bdf8"
      );
    })
    .on("click", function (event, d) {
      // Allow clicking in either chart to change the selection
      selectedEnvironment =
        selectedEnvironment === d.environment ? null : d.environment;
      updateSelectionText();

      d3.select("#env-counts-chart")
        .selectAll("rect.bar")
        .attr("fill", (b) =>
          b.environment === selectedEnvironment ? "#7f5af0" : "#4f46e5"
        );

      d3.select("#env-cr-chart")
        .selectAll("rect.bar-cr")
        .attr("fill", (b) =>
          b.environment === selectedEnvironment ? "#f97316" : "#38bdf8"
        );
    });
}
