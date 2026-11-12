#!/usr/bin/env python3
"""Tests for sync_related_cards.py's page-frame tiles (Orisod 2.0).

Runs the script's comparison on small pages built here, against a made-up /tools catalogue: a page
without the frame keeps its cards and is byte for byte unchanged when in sync; on a frame page
(<body class="o-frame">) every card becomes a tile with the /tools icon and name and no description,
CRLF kept, after which it's in sync; a tile whose name or icon drifted is reported and fixed; and a
frame page without exactly four Related tools is reported. Run after changing the script:

  python scripts/test_sync_related_cards.py   (CI: check-styles)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_related_cards import card_diffs, frame_problems  # noqa: E402

NL = chr(10)
CR = chr(13)
ICON = '<div class="icon-box cat-pdf"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></div>'
CATALOG = {f"/t{i}/": {"icon": ICON.replace("M1 1", f"M{i} {i}"), "title": f"Tool {i}", "desc": f"Does thing {i}."} for i in range(1, 6)}


def card(i, title=None):
    c = CATALOG[f"/t{i}/"]
    return (f'  <a class="related-card" href="/t{i}/">' + NL + f'    {c["icon"]}' + NL + '    <div class="body">' + NL
            + f'      <div class="title">{title or c["title"]}</div>' + NL + f'      <div class="desc">{c["desc"]}</div>' + NL
            + '    </div>' + NL + '    <div class="arrow">→</div>' + NL + '  </a>')


def page(cards, frame):
    body = '<body class="o-frame">' if frame else "<body>"
    return "<!doctype html><html>" + NL + body + NL + '<div class="grid">' + NL + NL.join(cards) + NL + "</div>" + NL + "</body></html>" + NL


def apply(text):
    edits = [(s, e, want) for _, diffs in card_diffs(text, CATALOG) for s, e, _, want in (diffs or {}).values()]
    for s, e, want in sorted(edits, reverse=True):
        text = text[:s] + want + text[e:]
    return text


def main():
    results = []

    def case(name, ok, detail=""):
        results.append(ok)
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": " + str(detail)[:600]))

    plain = page([card(i) for i in range(1, 4)], frame=False)
    case("a page without the frame and in sync has nothing to change", all(d == {} for _, d in card_diffs(plain, CATALOG)) and apply(plain) == plain)
    case("a page without the frame may have three cards", frame_problems(plain) == [])
    drift = page([card(1, "Old name")] + [card(i) for i in (2, 3)], frame=False)
    case("a page without the frame still has its card titles synced (cards stay cards)", apply(drift) == plain, apply(drift))

    framed = page([card(i) for i in range(1, 5)], frame=True).replace(NL, CR + NL)
    diffs = card_diffs(framed, CATALOG)
    case("on a frame page every card is to become a tile", len(diffs) == 4 and all(list(d) == ["markup"] for _, d in diffs), diffs)
    tiles = apply(framed)
    case("the cards become four tiles with the /tools icon and name, no description",
         tiles.count('<a class="o-tile"') == 4 and "related-card" not in tiles and "desc" not in tiles and "→" not in tiles
         and all(CATALOG[f"/t{i}/"]["icon"] in tiles and f'<div class="o-tile-name">Tool {i}</div>' in tiles for i in range(1, 5)), tiles)
    case("the tiles keep the page's CRLF line endings", NL not in tiles.replace(CR + NL, ""), repr(tiles[:200]))
    case("the tiles are then in sync", all(d == {} for _, d in card_diffs(tiles, CATALOG)) and apply(tiles) == tiles and frame_problems(tiles) == [])
    renamed = tiles.replace("Tool 2</div>", "Tool two</div>").replace("M3 3", "M9 9")
    fixed = card_diffs(renamed, CATALOG)
    case("a tile whose name or icon drifted is reported", sorted(f for _, d in fixed for f in d) == ["icon", "title"], fixed)
    case("and written back", apply(renamed) == tiles)
    three = page([card(i) for i in range(1, 4)], frame=True)
    five = page([card(i) for i in range(1, 6)], frame=True)
    case("a frame page with three Related tools is reported", "has 3 Related tools" in "".join(frame_problems(three)), frame_problems(three))
    case("a frame page with five Related tools is reported", "has 5 Related tools" in "".join(frame_problems(five)), frame_problems(five))
    case("the marker needs the o-frame class itself", frame_problems(three.replace('class="o-frame"', 'class="o-frame-like"')) == [])

    print(f"{sum(results)} of {len(results)} sync_related_cards tests passed.")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
