"""
show_furniture.py — Visualize all allowed furniture items as colored squares.
Saves the result to furniture_legend.png.
"""

import math
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# Color similarity groups (similar colors must not share a room):
#   Blues:   blue, royalblue, deepskyblue, aqua
#   Greens:  seagreen, chartreuse, mediumspringgreen
#   Reds:    red, salmon, deeppink
#   Purples: fuchsia, purple2, plum
#   Warms:   yellow, darkorange, navajowhite
#   Neutral: dimgray, olive
#
# Each room draws from at most one color per group → no confusion within a room.
FURNITURE = [
    # Bedroom            blue=deepskyblue  warm=yellow    purple=fuchsia
    ("Bed",           "#ff00ff"),  # fuchsia   (purple)
    ("Bedside Table", "#00bfff"),  # deepskyblue (blue)
    ("Wardrobe",      "#ffff00"),  # yellow    (warm)
    # Living room        neutral=olive  green=mediumspringgreen  purple=plum
    ("Sofa",          "#808000"),  # olive     (neutral)
    ("Coffee Table",  "#00fa9a"),  # mediumspringgreen (green)
    ("TV Unit",       "#dda0dd"),  # plum      (purple)
    # Kitchen            blue=aqua  green=chartreuse  red=salmon  purple=purple2
    ("Counter",       "#00ffff"),  # aqua      (blue)
    ("Fridge",        "#7fff00"),  # chartreuse (green)
    ("Stove",         "#fa8072"),  # salmon    (red)
    ("Kitchen Sink",  "#7f007f"),  # purple2   (purple)
    # Dining             red=deeppink  warm=navajowhite
    ("Dining Table",  "#ff1493"),  # deeppink  (red)
    ("Dining Chair",  "#ffdead"),  # navajowhite (warm)
    # Bathroom           red=red  blue=royalblue  green=seagreen  warm=darkorange
    ("Toilet",        "#ff0000"),  # red       (red)
    ("Bathroom Sink", "#4169e1"),  # royalblue (blue)
    ("Shower",        "#2e8b57"),  # seagreen  (green)
    ("Bathtub",       "#ff8c00"),  # darkorange (warm)
    # Hallway            neutral=dimgray  blue=blue
    ("Shoe Rack",     "#696969"),  # dimgray   (neutral)
    ("Console",       "#0000ff"),  # blue      (blue)
]

# Use white label text on dark backgrounds for readability
DARK_COLORS = {"#ff00ff", "#7f007f", "#4169e1", "#2e8b57", "#ff0000", "#0000ff", "#808000", "#696969"}

COLS = 6
ROWS = math.ceil(len(FURNITURE) / COLS)
SQ = 1.2        # square size in axis units
PAD = 0.5       # padding between squares
FONT = 7.5

fig_w = COLS * (SQ + PAD) + PAD
fig_h = ROWS * (SQ + PAD * 1.8) + PAD

fig, ax = plt.subplots(figsize=(fig_w, fig_h))
ax.set_xlim(0, fig_w)
ax.set_ylim(0, fig_h)
ax.set_aspect("equal")
ax.axis("off")
fig.patch.set_facecolor("white")
ax.set_facecolor("white")

for idx, (name, color) in enumerate(FURNITURE):
    col = idx % COLS
    row = idx // COLS
    x = PAD + col * (SQ + PAD)
    y = fig_h - PAD - (row + 1) * (SQ + PAD * 0.6)

    rect = mpatches.FancyBboxPatch(
        (x, y), SQ, SQ,
        boxstyle="round,pad=0.04",
        facecolor=color,
        edgecolor="black",
        linewidth=0.8,
    )
    ax.add_patch(rect)

    # item number centered in square
    num = idx + 1
    label_color = "white" if color in DARK_COLORS else "black"
    ax.text(x + SQ / 2, y + SQ / 2, str(num),
            ha="center", va="center",
            fontsize=9, fontweight="bold", color=label_color)

    # name below the square
    ax.text(x + SQ / 2, y - 0.08, name,
            ha="center", va="top",
            fontsize=FONT, color="#222222", wrap=True)

plt.title("Allowed Furniture — color & number reference", fontsize=11, pad=10)
plt.tight_layout()

out = "furniture_legend.png"
plt.savefig(out, dpi=150, bbox_inches="tight", facecolor="white")
print(f"Saved → {out}")
plt.show()
