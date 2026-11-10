#!/usr/bin/env python3
"""Builds index.html, the landing page, from its sources. Standard library only.

    python3 build.py              # photos and crests, as the app shows them
    python3 build.py --initials   # initials in place of every player photo and club crest

Sources: src/head.html (the <head>), src/style.css, src/body.html, src/app.js and data/landing.json
(the real data the page's scenes draw, baked from The Prism). Edit those, then run this; never edit
index.html by hand. CSS, data and script are put inline, so the page is one request plus its fonts
and images.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read()


def build(initials=False):
    data = json.loads(read("data/landing.json"))
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    cls = ' class="no-faces"' if initials else ""
    page = ("<!doctype html>\n"
            f'<html lang="en"{cls}>\n'
            "<!-- Built by build.py from src/ and data/landing.json. Edit those, then run python3 build.py. -->\n"
            "<head>\n" + read("src/head.html") +
            "<style>\n" + read("src/style.css") + "</style>\n</head>\n<body>\n" + read("src/body.html") +
            "\n<script>window.LAND = " + blob + ";</script>\n<script>\n" + read("src/app.js") +
            "</script>\n</body>\n</html>\n")
    for bad in ("—", "–"):
        assert bad not in page, "no em or en dashes on the page"
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    return len(page.encode("utf-8"))


if __name__ == "__main__":
    n = build(initials="--initials" in sys.argv)
    print(f"index.html: {n // 1024} KB")
