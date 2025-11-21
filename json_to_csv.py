import json
import csv

INPUT_JSON = "monsters_ecology.json"
OUTPUT_CSV = "monsters_ecology.csv"

def main():
    with open(INPUT_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not data:
        print("No data found in JSON.")
        return

    fieldnames = [
        "name",
        "type",
        "size",
        "environment",          # joined string
        "cr",
        "hp",
        "ac",
        "str",
        "dex",
        "con",
        "int",
        "wis",
        "cha",
        "speed_walk",
        "speed_fly",
        "speed_swim",
        "speed_burrow",
        "speed_climb",
        # NEW: raw defenses for heatmaps
        "damage_resistances",
        "damage_immunities",
        "damage_vulnerabilities",
        # Derived metrics
        "resist_count",
        "immune_count",
        "vuln_count",
        "senses_count",
        "blindsight",
        "darkvision",
        "tremorsense",
    ]

    with open(OUTPUT_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for row in data:
            r = dict(row)

            # environment is a list; join into a string
            env = r.get("environment", [])
            if isinstance(env, list):
                r["environment"] = ", ".join(env)
            else:
                r["environment"] = str(env) if env is not None else ""

            cleaned = {}
            for key in fieldnames:
                val = r.get(key, "")
                if val is None:
                    val = ""
                cleaned[key] = val

            writer.writerow(cleaned)

    print(f"Wrote {len(data)} rows to {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
