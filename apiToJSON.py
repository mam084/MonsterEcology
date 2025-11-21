import requests
import json
import re

BASE_URL = "https://api.open5e.com/monsters/"

import re

def parse_speed(speed_data):
    """
    Handles both dict and string speed formats and is tolerant of weird input.
    Returns numeric speeds for walk, fly, swim, burrow, climb.
    """
    speeds = {
        "walk": 0,
        "fly": 0,
        "swim": 0,
        "burrow": 0,
        "climb": 0
    }

    if not speed_data:
        return speeds

    # Case 1: speed is a dict, e.g.
    # {"walk": "30 ft.", "fly": "60 ft.", "swim": "40 ft."}
    if isinstance(speed_data, dict):
        for mode, value in speed_data.items():
            # value might be "30 ft." or just 30; we handle both
            nums = re.findall(r"\d+", str(value))
            if nums and mode in speeds:
                speeds[mode] = int(nums[0])
        return speeds

    # Case 2: speed is a string, e.g. "30 ft., fly 60 ft., swim 40 ft."
    s = str(speed_data).lower().replace(" ft.", "").replace(" ft", "")
    parts = [p.strip() for p in s.split(",")]

    for part in parts:
        # Look for an optional mode and a number
        m = re.search(r"(walk|fly|swim|burrow|climb)?\s*(\d+)", part)
        if m:
            mode = m.group(1)
            value = int(m.group(2))
            if mode is None:
                # If no explicit mode, treat as walk speed
                speeds["walk"] = value
            else:
                if mode in speeds:
                    speeds[mode] = value

    return speeds


def count_list_like(text):
    """
    Count how many items are in a semi-structured list-like string.
    Used for resistances/immunities/vulnerabilities/senses.
    """
    if not text:
        return 0
    t = str(text).lower()
    parts = re.split(r"[;,]| and ", t)
    return sum(1 for p in parts if p.strip())

def has_keyword(text, keyword):
    if not text:
        return 0
    return int(keyword in str(text).lower())

all_rows = []

url = BASE_URL
print("Fetching monsters from Open5e...")
while url:
    print("Requesting:", url)
    resp = requests.get(url)
    resp.raise_for_status()
    data = resp.json()

    for m in data["results"]:
        name = m.get("name")
        ctype = m.get("type")
        size = m.get("size")

        # Environments: list or string
        env = m.get("environments")
        if env is None:
            environment = []
        elif isinstance(env, list):
            environment = env
        else:
            environment = [e.strip() for e in str(env).split(",") if e.strip()]

        cr = m.get("challenge_rating")
        hp = m.get("hit_points")
        ac = m.get("armor_class")

        strength = m.get("strength")
        dexterity = m.get("dexterity")
        constitution = m.get("constitution")
        intelligence = m.get("intelligence")
        wisdom = m.get("wisdom")
        charisma = m.get("charisma")

        # Speeds (dict or string)
        speed_data = m.get("speed", {})
        speeds = parse_speed(speed_data)

        # Raw defenses
        raw_resist = m.get("damage_resistances") or ""
        raw_immune = m.get("damage_immunities") or ""
        raw_vuln = m.get("damage_vulnerabilities") or ""

        # Make sure they are strings (flatten lists if needed)
        if isinstance(raw_resist, list):
            raw_resist = ", ".join(raw_resist)
        if isinstance(raw_immune, list):
            raw_immune = ", ".join(raw_immune)
        if isinstance(raw_vuln, list):
            raw_vuln = ", ".join(raw_vuln)

        resist_count = count_list_like(raw_resist)
        immune_count = count_list_like(raw_immune)
        vuln_count = count_list_like(raw_vuln)

        senses = m.get("senses") or ""
        if isinstance(senses, dict):
            # Some Open5e entries may encode senses as dict; flatten
            senses_str = ", ".join(f"{k} {v}" for k, v in senses.items())
        else:
            senses_str = str(senses)

        senses_count = count_list_like(senses_str)
        blindsight = has_keyword(senses_str, "blindsight")
        darkvision = has_keyword(senses_str, "darkvision")
        tremorsense = has_keyword(senses_str, "tremorsense")

        row = {
            "name": name,
            "type": ctype,
            "size": size,
            "environment": environment,  # list of strings
            "cr": cr,
            "hp": hp,
            "ac": ac,
            "str": strength,
            "dex": dexterity,
            "con": constitution,
            "int": intelligence,
            "wis": wisdom,
            "cha": charisma,
            "speed_walk": speeds["walk"],
            "speed_fly": speeds["fly"],
            "speed_swim": speeds["swim"],
            "speed_burrow": speeds["burrow"],
            "speed_climb": speeds["climb"],
            # NEW: keep raw defense strings for damage-type heatmaps
            "damage_resistances": raw_resist,
            "damage_immunities": raw_immune,
            "damage_vulnerabilities": raw_vuln,
            # Derived counts
            "resist_count": resist_count,
            "immune_count": immune_count,
            "vuln_count": vuln_count,
            "senses_count": senses_count,
            "blindsight": blindsight,
            "darkvision": darkvision,
            "tremorsense": tremorsense,
        }

        all_rows.append(row)

    url = data.get("next")  # pagination

print(f"Fetched {len(all_rows)} monsters.")

output_file = "monsters_ecology.json"
with open(output_file, "w", encoding="utf-8") as f:
    json.dump(all_rows, f, indent=2, ensure_ascii=False)

print(f"Saved dataset to {output_file}")
