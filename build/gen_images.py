#!/usr/bin/env python3
"""Render the GitHub/README image set from the final benchmark data."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager as fm
from matplotlib.ticker import FuncFormatter
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
OUT.mkdir(parents=True, exist_ok=True)

A = json.loads((ROOT / "results" / "analysis-final.json").read_text(encoding="utf-8"))
BASE = {r["id"]: r for r in json.loads((ROOT / "results" / "final-base.json").read_text(encoding="utf-8"))["records"]}
OPT = {r["id"]: r for r in json.loads((ROOT / "results" / "final-opt.json").read_text(encoding="utf-8"))["records"]}

PAPER = "#FBF6EC"
INK = "#221D18"
MUTED = "#7A6E62"
RULE = "#DED3C2"
TERRA = "#B8512C"
AMBER = "#C98A2E"
SAGE = "#6E7B5B"

for f in ["georgia.ttf", "georgiab.ttf", "arial.ttf", "arialbd.ttf"]:
    try:
        fm.fontManager.addfont(str(Path("C:/Windows/Fonts") / f))
    except Exception:
        pass

plt.rcParams.update({
    "font.family": "Arial",
    "text.color": INK,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "axes.edgecolor": RULE,
    "figure.facecolor": PAPER,
    "axes.facecolor": PAPER,
    "savefig.facecolor": PAPER,
})


def save(fig, name, dpi=200):
    fig.savefig(OUT / name, dpi=dpi, bbox_inches="tight", pad_inches=0.28)
    plt.close(fig)
    print("wrote", OUT / name)


# ---------------------------------------------------------------- speedup bars
def speedup_chart():
    order = ["64", "128", "256", "512"]
    rows = []
    for k in order:
        s = next(x for x in A["sizeTable"] if x["label"] == k)
        rows.append((f"{k} × {k}", s["n"], s["median"], s["baseMs"] / s["optMs"]))
    _all = sorted(r["speedup"] for r in A["rows"])
    med = _all[len(_all) // 2] if len(_all) % 2 else (_all[len(_all) // 2 - 1] + _all[len(_all) // 2]) / 2
    rows.append(("all", A["total"]["scenarios"], med, A["total"]["speedup"]))

    fig, ax = plt.subplots(figsize=(8.6, 3.9))
    y = np.arange(len(rows))[::-1]
    h = 0.30
    med_v = [r[2] for r in rows]
    agg_v = [r[3] for r in rows]
    ax.barh(y + h / 2 + 0.02, med_v, height=h, color=TERRA, zorder=3, label="median")
    ax.barh(y - h / 2 - 0.02, agg_v, height=h, color=AMBER, zorder=3, alpha=.92, label="aggregate")
    for yy, v in zip(y + h / 2 + 0.02, med_v):
        ax.text(v + .035, yy, f"{v:.2f}×", va="center", fontsize=10, color=TERRA, fontweight="bold")
    for yy, v in zip(y - h / 2 - 0.02, agg_v):
        ax.text(v + .035, yy, f"{v:.2f}×", va="center", fontsize=9, color="#9A6A1F")
    ax.set_yticks(y)
    ax.set_yticklabels([f"{r[0]}" + f"   n={r[1]}" for r in rows], fontsize=10.5)
    ax.set_xlim(0, 1.85)
    ax.set_xticks([0, .25, .5, .75, 1.0, 1.25, 1.5, 1.75])
    ax.set_xlabel("speedup vs 0.4.1 baseline (higher is better)", fontsize=10)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: (f"{x:.2f}".rstrip("0").rstrip(".") + "×")))
    ax.grid(axis="x", color=RULE, linewidth=.8, alpha=.7, zorder=0)
    for s in ["top", "right", "left"]:
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(RULE)
    ax.tick_params(axis="y", length=0)
    ax.legend(loc="upper center", frameon=False, fontsize=9.5, ncol=2, bbox_to_anchor=(.5, -.19))
    ax.set_title("Paired A/B benchmark · 104 scenarios · median vs time-weighted aggregate",
                 loc="left", fontsize=11, color=MUTED, pad=12)
    save(fig, "speedup-by-size.png")


# ------------------------------------------------------------------- scatter
def scatter_chart():
    fig, ax = plt.subplots(figsize=(7.4, 5.4))
    for r in A["rows"]:
        c = AMBER if r["diagonal"] else TERRA
        ax.scatter(max(r["baseMs"], 0.012), max(r["optMs"], 0.012), s=18,
                   c=c, alpha=.72, edgecolors=PAPER, linewidths=.45, zorder=3)
    lim = (0.012, 70)
    ax.plot(lim, lim, ls=(0, (4, 4)), color=SAGE, lw=1.3, zorder=2, label="y = x (no gain)")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(*lim)
    ax.set_ylim(*lim)
    plain = FuncFormatter(lambda v, _: f"{v:g}")
    ax.xaxis.set_major_formatter(plain)
    ax.yaxis.set_major_formatter(plain)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("baseline single search (ms, log)", fontsize=10)
    ax.set_ylabel("optimized single search (ms, log)", fontsize=10)
    ax.grid(True, which="major", color=RULE, linewidth=.8, alpha=.65, zorder=0)
    ax.grid(True, which="minor", color=RULE, linewidth=.5, alpha=.28, zorder=0)
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)
    ax.scatter([], [], s=18, c=TERRA, label="4-dir")
    ax.scatter([], [], s=18, c=AMBER, label="8-dir")
    ax.legend(loc="lower right", frameon=False, fontsize=9.5)
    ax.set_title("104 scenarios, one point each · 86 fall below the line", loc="left",
                 fontsize=11, color=MUTED, pad=12)
    save(fig, "scatter.png")


# --------------------------------------------------------------------- stage
def stage_chart():
    sb = A["stage"]["big"]
    vals = [1.0, sb["s1Sum"], sb["s2Sum"]]
    labels = ["0.4.1 baseline", "S1: heap index", "S1 + S2"]
    colors = [MUTED, AMBER, TERRA]
    fig, ax = plt.subplots(figsize=(6.8, 3.8))
    bars = ax.bar(range(3), vals, width=.52, color=colors, zorder=3)
    bars[0].set_alpha(.45)
    for i, (b, v) in enumerate(zip(bars, vals)):
        ax.text(b.get_x() + b.get_width() / 2, v + .02, f"{v:.2f}×", ha="center",
                fontsize=15, fontfamily="Georgia", color=INK if i == 0 else colors[i])
        if i:
            ax.text(b.get_x() + b.get_width() / 2, .07, f"+{(v-1)*100:.0f}%", ha="center",
                    fontsize=10, color=PAPER, fontweight="bold")
    ax.set_xticks(range(3))
    ax.set_xticklabels(labels, fontsize=10.5)
    ax.set_ylim(0, 1.48)
    ax.set_yticks([0, .5, 1.0, 1.5])
    ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{x:.1f}×"))
    ax.grid(axis="y", color=RULE, linewidth=.8, alpha=.7, zorder=0)
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)
    ax.tick_params(axis="x", length=0)
    ax.set_title("512×512 core group (18 scenarios) · aggregate speedup", loc="left",
                 fontsize=11, color=MUTED, pad=12)
    save(fig, "stage-attribution.png")


# ------------------------------------------------------------------- profile
def profile_chart():
    parts = [("search (inlined indexOf)", 45.5, TERRA), ("GC", 11.1, "#9C8A76"),
             ("cleanNode", 7.4, AMBER), ("heap.pop", 6.9, SAGE),
             ("program", 5.4, "#B9AB98"), ("markDirty", 4.0, "#D2A24C"),
             ("cleanDirty", 2.5, "#C9BCA8"), ("heap.push", 0.9, "#8C7F6D"),
             ("neighbors", 0.8, "#A99C89"), ("other", 15.4, "#E4D8C6")]
    fig, ax = plt.subplots(figsize=(9.4, 1.55))
    left = 0
    for name, p, color in parts:
        ax.barh([0], [p], left=left, height=.42, color=color, zorder=3)
        if p >= 6:
            ax.text(left + p / 2, 0, f"{p:.1f}%", ha="center", va="center",
                    fontsize=9, color=PAPER if color in (TERRA, "#9C8A76", AMBER, SAGE, "#B9AB98") else INK,
                    fontweight="bold")
        left += p
    ax.set_xlim(0, 100)
    ax.set_ylim(-.55, .55)
    ax.axis("off")
    # legend in two rows
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for _, _, c in parts]
    ax.legend(handles, [n for n, _, _ in parts], loc="upper center", bbox_to_anchor=(.5, -.12),
              ncol=5, frameon=False, fontsize=8, handlelength=.9, columnspacing=1.2)
    save(fig, "profile.png")


# --------------------------------------------------------------------- cover
def cover():
    W, H = 1200, 630
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    base = np.zeros((H, W, 3), dtype=float)
    top = np.array([23, 19, 15], dtype=float)
    bot = np.array([46, 34, 24], dtype=float)
    base[:] = top * (1 - y[..., None]) + bot * y[..., None]
    glow = np.exp(-(((x - .10) ** 2) / .09 + ((y - .05) ** 2) / .12))
    base += glow[..., None] * np.array([38, 14, 5])
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")
    d = ImageDraw.Draw(img)

    georgia = "C:/Windows/Fonts/georgia.ttf"
    georgia_b = "C:/Windows/Fonts/georgiab.ttf"
    arial = "C:/Windows/Fonts/arial.ttf"
    arial_b = "C:/Windows/Fonts/arialbd.ttf"
    F = lambda p, s: ImageFont.truetype(p, s)


    def spaced(text, font, tracking=4):
        widths = [d.textlength(ch, font=font) for ch in text]
        total = sum(widths) + tracking * (len(text) - 1)
        return widths, total

    kick = "JAVASCRIPT-ASTAR  ·  PERFORMANCE FORK"
    kw, total = spaced(kick, F(arial_b, 15), 4)
    kx, ky = 64, 58
    for ch, w in zip(kick, kw):
        d.text((kx, ky), ch, font=F(arial_b, 15), fill=(201, 138, 46))
        kx += w + 4

    d.text((58, 98), "O(n)", font=F(georgia_b, 92), fill=(251, 246, 236))
    # drawn arrow (Georgia has no U+2192 glyph, and PIL has no font fallback)
    ax_x = 88
    d.line([(ax_x, 206), (ax_x, 252)], fill=(191, 82, 45), width=6)
    d.polygon([(ax_x - 15, 248), (ax_x + 15, 248), (ax_x, 272)], fill=(191, 82, 45))
    d.text((58, 258), "O(log n)", font=F(georgia_b, 92), fill=(191, 82, 45))
    d.text((62, 382), "Same paths. Less time.", font=F(georgia, 33), fill=(251, 246, 236))

    d.text((64, 438), "A* pathfinding, same cost and expansion count,", font=F(arial, 18), fill=(196, 184, 167))
    d.text((64, 463), "with the heap's O(n) rescan removed.", font=F(arial, 18), fill=(196, 184, 167))

    metrics = [("1.22×", "median"), ("1.43×", "512×512"), ("0 / 104", "mismatches"), ("−68%", "heap churn")]
    mx = 64
    for i, (big, small) in enumerate(metrics):
        f1, f2 = F(georgia_b, 27), F(arial, 12)
        w = max(d.textlength(big, font=f1), d.textlength(small, font=f2))
        d.text((mx, 506), big, font=f1, fill=(201, 138, 46) if i < 2 else (251, 246, 236))
        d.text((mx, 543), small, font=f2, fill=(160, 148, 132))
        mx += w + 52
        if i < 3:
            d.line([(mx - 26, 510), (mx - 26, 552)], fill=(80, 66, 52), width=1)

    d.line([(64, 590), (W - 64, 590)], fill=(80, 66, 52), width=1)
    d.text((64, 600), "bgrins/javascript-astar  ·  ef5ec96  ·  MIT", font=F(arial, 12), fill=(160, 148, 132))
    d.text((W - 64 - d.textlength("github.com/linluozi/astar-opt", font=F(arial_b, 12)), 600),
           "github.com/linluozi/astar-opt", font=F(arial_b, 12), fill=(201, 138, 46))

    # inset scatter, right side, low contrast
    ins = Image.new("RGBA", (460, 460), (0, 0, 0, 0))
    dd = ImageDraw.Draw(ins)
    dd.line([(24, 436), (436, 24)], fill=(110, 123, 91, 130), width=2)
    import math
    for r in A["rows"]:
        px = 24 + (math.log10(max(r["baseMs"], .012)) + 1.9) / 3.75 * 412
        py = 436 - (math.log10(max(r["optMs"], .012)) + 1.9) / 3.75 * 412
        col = (201, 138, 46, 190) if r["diagonal"] else (191, 82, 45, 200)
        dd.ellipse([px - 3, py - 3, px + 3, py + 3], fill=col)
    img.paste(ins, (700, 100), ins)

    img.save(OUT / "cover.png")
    print("wrote", OUT / "cover.png")


if __name__ == "__main__":
    speedup_chart()
    scatter_chart()
    stage_chart()
    profile_chart()
    cover()
