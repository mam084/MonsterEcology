import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

plt.style.use("ggplot")

# ---------- Helper: parse CR like "1/4" -> 0.25 ----------

def parse_cr(value):
    if pd.isna(value):
        return np.nan
    if isinstance(value, (int, float)):
        return float(value)

    s = str(value).strip()
    if "/" in s:
        try:
            num, den = s.split("/")
            return float(num) / float(den)
        except ValueError:
            return np.nan

    try:
        return float(s)
    except ValueError:
        return np.nan


def main():
    # ---------- 1. LOAD & CLEAN DATA ----------

    df = pd.read_csv("monsters_ecology.csv")

    # Ensure environment exists as string; some rows may be NaN
    df["environment"] = df["environment"].fillna("")

    # Split comma-separated environments into list
    df["env_list"] = df["environment"].apply(
        lambda s: [e.strip() for e in s.split(",") if e.strip()] if isinstance(s, str) else []
    )
    print("CSV Columns:")
    print(df.columns.tolist())

    print("\nSample rows:")
    print(df.head(5).to_string())

    # Explode env_list, drop original environment to avoid duplicate column names
    df_env = (
        df.drop(columns=["environment"])
          .explode("env_list")
          .rename(columns={"env_list": "environment"})
    )

    # Drop rows with empty environment
    df_env = df_env[df_env["environment"].notna() & (df_env["environment"] != "")]

    print("Rows after exploding environments:", len(df_env))
    print("Top environments:", df_env["environment"].value_counts().head(10).index.tolist())

    # ---------- 2. NUMERIC CLEANUP ----------

    df_env["cr_num"] = df_env["cr"].apply(parse_cr)

    numeric_cols = [
        "cr_num",
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
        "resist_count",
        "immune_count",
        "vuln_count",
        "senses_count",
    ]

    for col in numeric_cols:
        if col in df_env.columns:
            df_env[col] = pd.to_numeric(df_env[col], errors="coerce")

    # For convenience: counts per environment
    env_counts = df_env["environment"].value_counts().sort_values(ascending=False)

    # ---------- FIGURE 1: Monster Counts by Environment ----------

    plt.figure(figsize=(12, 6))
    env_counts.plot(kind="bar")
    plt.ylabel("Number of Monsters")
    plt.xlabel("Environment")
    plt.title("Monster Counts by Environment")
    plt.tight_layout()
    plt.savefig("fig1_monster_counts_by_environment.png", dpi=150)
    plt.close()
    print("Saved fig1_monster_counts_by_environment.png")

    # ---------- FIGURE 2: Average CR by Environment ----------

    env_cr = (
        df_env.groupby("environment")["cr_num"]
        .mean()
        .sort_values(ascending=False)
    )

    plt.figure(figsize=(12, 6))
    env_cr.plot(kind="bar")
    plt.ylabel("Average Challenge Rating")
    plt.xlabel("Environment")
    plt.title("Average Monster Challenge Rating by Environment")
    plt.tight_layout()
    plt.savefig("fig2_avg_cr_by_environment.png", dpi=150)
    plt.close()
    print("Saved fig2_avg_cr_by_environment.png")

        # ---------- FIGURE 3: Movement Adaptations (Grouped Bar) ----------
    # % of monsters in each environment that can Fly / Swim / Burrow / Climb
    # Uses numeric speed_* columns only.

    speed_cols = ["speed_walk", "speed_fly", "speed_swim", "speed_burrow", "speed_climb"]
    missing_speed_cols = [c for c in speed_cols if c not in df_env.columns]
    if missing_speed_cols:
        print("Skipping movement figure; missing columns:", missing_speed_cols)
    else:
        # Presence flags
        df_env["has_walk"] = (df_env["speed_walk"] > 0).astype(int)
        df_env["has_fly"] = (df_env["speed_fly"] > 0).astype(int)
        df_env["has_swim"] = (df_env["speed_swim"] > 0).astype(int)
        df_env["has_burrow"] = (df_env["speed_burrow"] > 0).astype(int)
        df_env["has_climb"] = (df_env["speed_climb"] > 0).astype(int)

        move_flags = ["has_fly", "has_swim", "has_burrow", "has_climb"]
        move_labels = ["Fly", "Swim", "Burrow", "Climb"]

        # Top 8 environments for readability
        top_envs_for_move = env_counts.head(8).index
        df_move = df_env[df_env["environment"].isin(top_envs_for_move)]

        env_move_pct = (
            df_move.groupby("environment")[move_flags]
            .mean()
            .loc[top_envs_for_move] * 100.0
        )

        print("Movement % by environment:\n", env_move_pct.round(1))

        import numpy as np
        plt.figure(figsize=(12, 6))
        x = np.arange(len(env_move_pct.index))
        width = 0.18

        for i, (flag, label) in enumerate(zip(move_flags, move_labels)):
            plt.bar(
                x + (i - 1.5) * width,
                env_move_pct[flag],
                width,
                label=label
            )

        plt.xticks(x, env_move_pct.index, rotation=45, ha="right")
        plt.ylabel("% of Monsters")
        plt.xlabel("Environment")
        plt.title("Movement Adaptations by Environment")
        plt.legend(title="Movement Type")
        plt.tight_layout()
        plt.savefig("fig3_movement_adaptations_grouped_bar.png", dpi=150)
        plt.close()
        print("Saved fig3_movement_adaptations_grouped_bar.png")




        # ---------- FIGURE 4: Damage-Type Adaptation Heatmap ----------
    # % of monsters per environment that are resistant OR immune to each damage type

    res_col = "damage_resistances"
    imm_col = "damage_immunities"

    if res_col not in df_env.columns or imm_col not in df_env.columns:
        print("Skipping damage-type heatmap; missing columns:", res_col, imm_col)
    else:
        dmg_types = [
            "fire", "cold", "poison", "acid", "lightning",
            "necrotic", "radiant", "psychic", "thunder", "force"
        ]

        # For each damage type, flag if the monster is resistant OR immune
        for dt in dmg_types:
            col_name = f"adapt_{dt}"
            def has_dmg_type(row, dt=dt):
                texts = []
                if isinstance(row.get(res_col), str):
                    texts.append(row[res_col].lower())
                if isinstance(row.get(imm_col), str):
                    texts.append(row[imm_col].lower())
                combined = " ".join(texts)
                return int(dt in combined)
            df_env[col_name] = df_env.apply(has_dmg_type, axis=1)

        adapt_cols = [f"adapt_{dt}" for dt in dmg_types]

        # Top 10 environments for readability
        top_envs_dmg = env_counts.head(10).index
        df_dmg = df_env[df_env["environment"].isin(top_envs_dmg)]

        env_dmg_pct = (
            df_dmg.groupby("environment")[adapt_cols]
            .mean()
            .loc[top_envs_dmg] * 100.0
        )

        print("Damage-type adaptation % (sample):\n", env_dmg_pct.round(1).iloc[:3, :5])

        plt.figure(figsize=(10, 6))
        im = plt.imshow(env_dmg_pct.values, aspect="auto")
        plt.colorbar(im, label="% of Monsters (Resistant or Immune)")

        plt.xticks(
            range(len(dmg_types)),
            [dt.capitalize() for dt in dmg_types],
            rotation=45,
            ha="right"
        )
        plt.yticks(range(len(env_dmg_pct.index)), env_dmg_pct.index)
        plt.title("Elemental / Damage-Type Adaptations by Environment")
        plt.tight_layout()
        plt.savefig("fig4_damage_type_adaptations_heatmap.png", dpi=150)
        plt.close()
        print("Saved fig4_damage_type_adaptations_heatmap.png")


    # ---------- FIGURE 5: Stat vs CR Dot Plots (HP, STR, DEX, INT) + Regression + Correlation ----------

    stats = ["hp", "str", "dex", "int"]
    labels = ["Hit Points", "Strength", "Dexterity", "Intelligence"]

    fig, axes = plt.subplots(2, 2, figsize=(10, 8), sharex=True)
    axes = axes.flatten()

    for ax, col, label in zip(axes, stats, labels):
        if col in df_env.columns:
            sub = df_env[["cr_num", col]].dropna()

            # Scatter
            ax.scatter(sub["cr_num"], sub[col], alpha=0.4, s=10)

            # Line of best fit
            if len(sub) > 1:
                coeffs = np.polyfit(sub["cr_num"], sub[col], 1)
                poly = np.poly1d(coeffs)
                x_vals = np.linspace(sub["cr_num"].min(), sub["cr_num"].max(), 200)
                ax.plot(x_vals, poly(x_vals), color="red", linewidth=1)

                # Correlation
                corr = sub["cr_num"].corr(sub[col])
                ax.text(
                    0.05, 0.92,
                    f"r = {corr:.2f}",
                    transform=ax.transAxes,
                    fontsize=10,
                    verticalalignment="top"
                )

            ax.set_title(f"{label} vs CR")
            ax.set_xlabel("CR")
            ax.set_ylabel(label)
        else:
            ax.text(0.5, 0.5, f"{col} missing", ha="center", va="center")
            ax.set_axis_off()

    fig.suptitle("Monster Stats vs Challenge Rating (with Trendlines)")
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    plt.savefig("fig5_stats_vs_cr_dotplots_with_trend.png", dpi=150)
    plt.close()
    print("Saved fig5_stats_vs_cr_dotplots_with_trend.png")





        # ---------- FIGURE 6: Monster Type Composition Heatmap (Percent) ----------

    df_env["type"] = df_env["type"].fillna("Unknown")

    type_env_counts = (
        df_env.groupby(["type", "environment"])["name"]
        .nunique()
        .reset_index(name="count")
    )

    # Limit to top 8 types and top 10 environments
    top_types = (
        type_env_counts.groupby("type")["count"]
        .sum()
        .sort_values(ascending=False)
        .head(8)
        .index
    )
    top_envs_for_type = env_counts.head(10).index

    te_filtered = type_env_counts[
        type_env_counts["type"].isin(top_types)
        & type_env_counts["environment"].isin(top_envs_for_type)
    ]

    pivot_counts = (
        te_filtered.pivot(index="type", columns="environment", values="count")
        .fillna(0)
        .loc[top_types, top_envs_for_type]
    )

    col_sums = pivot_counts.sum(axis=0).replace(0, np.nan)
    pivot_pct = (pivot_counts / col_sums) * 100.0

    print("Type composition % (sample):\n", pivot_pct.round(1).iloc[:3, :3])

    plt.figure(figsize=(10, 6))
    im = plt.imshow(pivot_pct.values, aspect="auto")
    plt.colorbar(im, label="% of Monsters in Environment")

    plt.xticks(range(len(pivot_pct.columns)), pivot_pct.columns, rotation=45, ha="right")
    plt.yticks(range(len(pivot_pct.index)), pivot_pct.index)
    plt.title("Monster Type Composition by Environment (Percent)")
    plt.tight_layout()
    plt.savefig("fig6_type_composition_heatmap.png", dpi=150)
    plt.close()
    print("Saved fig6_type_composition_heatmap.png")



if __name__ == "__main__":
    main()
