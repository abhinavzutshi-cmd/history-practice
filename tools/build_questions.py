#!/usr/bin/env python3
"""Parse the History Bee / History Bowl PDFs into data/questions.js for the moderator app.

Requires: poppler-utils (pdftotext) and pypdf (for the PDF bookmarks).
Usage:   python3 tools/build_questions.py [PDF_DIR]
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

import pypdf

from categorize import categorize, giveaway, CATEGORIES

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
PDF_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(APP)

# (file, competition, level). Duplicate copies of Vol4 in the folder are ignored.
SOURCES = [
    ("National-History-Bee-Elementary-Middle-School-2017-2026.pdf", "bee", "ems"),
    ("National-History-Bee-Varsity-JV-2014-2026.pdf", "bee", "varsity"),
    ("EMS_National_History_Bowl_Questions_2017-2026.pdf", "bowl", "ems"),
    ("NHB_Varsity-JV_Vol1_2025-26_to_2021-22.pdf", "bowl", "varsity"),
    ("NHB_Varsity-JV_Vol2_2020-21_to_2018-19.pdf", "bowl", "varsity"),
    ("NHB_Varsity-JV_Vol3_2017-18_to_2016-17.pdf", "bowl", "varsity"),
    ("NHB_Varsity-JV_Vol4_2015-16_to_2014-15.pdf", "bowl", "varsity"),
]

SECTION_HEADERS = {
    "first quarter": "q1", "second quarter": "q2", "third quarter": "q3", "fourth quarter": "q4",
    "extra question": "extra", "extra questions": "extra", "extra tossups": "extra",
    "tiebreakers": "extra", "tiebreaker": "extra", "replacements": "extra",
    "replacement questions": "extra", "backup questions": "extra",
    "regulation tossups": "main", "regulation questions": "main", "tossups": "main",
}

SKIP_OUTLINE = re.compile(r"^(cover|contents)", re.I)
FOOTER = re.compile(r"^\s*(page\s+)?\d{1,3}\s*$", re.I)
QSTART_PAREN = re.compile(r"^\((\d{1,2})\)\s*(.*)$")
QSTART_DOT = re.compile(r"^(\d{1,2})\.\s+(.*)$")
CREDIT = re.compile(r"^\[[A-Z][^\[\]]{2,40}\]$")  # writer credit line, e.g. [Isaac Hirsch]
ANS = re.compile(r"^ANSWER\s*:\s*(.*)$", re.I)
BONUS = re.compile(r"^BONUS\s*:\s*(.*)$", re.I)
SCORESHEET = re.compile(r"cumulative score|final score|substitutions allowed|bonus points|buzzer malfunctions", re.I)


def outline_leaves(path):
    r = pypdf.PdfReader(path)
    out = []

    def walk(items, trail):
        prev = None
        for it in items:
            if isinstance(it, list):
                walk(it, trail + [prev.title])
                out[:] = [o for o in out if o[1] != trail + [prev.title]]  # parent is not a leaf
            else:
                prev = it
                try:
                    page = r.get_destination_page_number(it)
                except Exception:
                    continue
                out.append((page, trail + [it.title]))

    walk(r.outline, [])
    out.sort(key=lambda o: o[0])
    return out, len(r.pages)


def page_texts(path):
    with tempfile.NamedTemporaryFile(suffix=".txt") as tmp:
        subprocess.run(["pdftotext", "-layout", path, tmp.name], check=True)
        with open(tmp.name, encoding="utf-8", errors="replace", newline="") as f:
            return f.read().split("\f")


def is_header(line):
    """Running page header like '2026 EMS National History Bowl      Round 9'."""
    s = line.strip()
    return bool(re.search(r"(history\s+b(ee|owl)|nhbb|\bbee\b|\bbowl\b)", s, re.I)) and (
        re.search(r"\s{6,}", s) or re.search(r"(19|20)\d\d", s))


def fix_chars(l):
    l = l.replace("-\u00ad\u2010", "-").replace("\u00ad", "").replace("\u2010", "-")
    return re.sub(r"[\t\r\xa0]", " ", l)


def section_key(s):
    key = re.sub(r"\s+", " ", s.lower()).strip().rstrip(":").strip()
    m = re.match(r"^quarter\s*([1-4])$", key)
    if m:
        return "q" + m.group(1)
    return SECTION_HEADERS.get(key)


def clean_pages(pages):
    lines = []
    for p in pages:
        plines = p.split("\n")
        # strip running header (within first few non-empty lines)
        seen = 0
        for i, l in enumerate(plines):
            if l.strip():
                seen += 1
                if is_header(l):
                    plines[i] = ""
                if seen >= 2:
                    break
        for l in plines:
            l = fix_chars(l)
            if FOOTER.match(l):
                l = ""
            # an answer run onto the end of the question line: "...largest in the US ANSWER: Navajo"
            m = re.search(r"\S\s+(ANSWER\s*:.*)$", l)
            if m:
                lines.append(l[:m.start(1)].rstrip())
                l = m.group(1)
            lines.append(l.rstrip())
        lines.append("")
    return lines


def norm_ws(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"(\w)- (\w)", lambda m: m.group(1) + "-" + m.group(2) if m.group(2).isupper() else m.group(0), s)
    return s


def paren_open(s):
    return s.count("(") - s.count(")") > 0 or s.count("[") - s.count("]") > 0


def parse_packet(lines, competition):
    """Return a list of items: tossups (with optional bonus) and q3 category sets."""
    section = "q1" if competition == "bowl" else "main"
    items, cur, state, idle_buf = [], None, "idle", []
    q3cat = None
    paren = sum(1 for l in lines if QSTART_PAREN.match(l.strip()))
    QSTART = QSTART_PAREN if paren >= 5 else QSTART_DOT

    def finish():
        nonlocal cur
        if cur and cur.get("q") and cur.get("a") and (cur["sec"] == "q3" or len(cur["q"]) > 120):
            for k in ("q", "a", "bq", "ba"):
                if k in cur:
                    cur[k] = norm_ws(cur[k])
            items.append(cur)
        cur = None

    for raw in lines:
        s = raw.strip()
        key = section_key(s)
        if key:
            finish()
            state, idle_buf = "idle", []
            section = key
            if competition == "bee" and section.startswith("q"):
                section = "main"
            continue
        if not s:
            if state in ("a", "ba") and not paren_open(cur[state]):
                state = "idle"
            continue
        if SCORESHEET.search(s):
            continue
        if CREDIT.match(s):
            if state in ("a", "ba"):
                state = "idle"
            continue
        m = QSTART.match(s)
        if m:
            finish()
            if section == "q3":
                if idle_buf:
                    q3cat = make_cat(idle_buf, q3cat)
                idle_buf = []
            cur = {"sec": section, "n": int(m.group(1)), "q": m.group(2)}
            if section == "q3" and q3cat:
                cur["cat"] = q3cat
            state = "q"
            continue
        m = ANS.match(s)
        if m and cur:
            if state in ("bq",):
                cur["ba"] = m.group(1)
                state = "ba"
            elif "a" not in cur:
                cur["a"] = m.group(1)
                state = "a"
            continue
        m = BONUS.match(s)
        if m and cur:
            cur["bq"] = m.group(1)
            state = "bq"
            continue
        if state == "q":
            cur["q"] += " " + s
        elif state == "bq":
            cur["bq"] += " " + s
        elif state in ("a", "ba"):
            # Third-quarter answers are one-liners unless a parenthetical is still open.
            if section == "q3" and not paren_open(cur[state]) and not s[:1].islower():
                state = "idle"
                idle_buf.append(s)
            else:
                cur[state] += " " + s
        else:
            idle_buf.append(s)
    finish()
    return items


_cat_counter = [0]


def make_cat(buf, prev):
    lines = [l for l in buf if not re.match(r"^(the categories are|\d+\.\s)", l, re.I)
             and not re.match(r"^history b(ee|owl)\b", l, re.I)]
    if not lines:
        return prev
    lead = [l for l in lines if re.search(r"\.\.\.|…|name the|concerning|^in |^during ", l, re.I)]
    title_lines = [l for l in lines if l not in lead]
    title = norm_ws(title_lines[-1] if title_lines else lines[0])
    _cat_counter[0] += 1
    return {"id": _cat_counter[0], "title": title, "lead": norm_ws(" ".join(lead))}


SEASON = re.compile(r"(20\d\d)[–-](\d\d)")


def packet_meta(trail, competition, level):
    text = " › ".join(trail)
    m = SEASON.search(text)
    season = f"{m.group(1)}–{m.group(2)}" if m else ""
    event = "Nationals" if re.search(r"national", text, re.I) else (
        "Regionals" if re.search(r"regional|set\b", text, re.I) else "")
    tail = trail[-1]
    hard = bool(re.search(r"final|semi|quarter|octo|playoff|championship", tail, re.I))
    # Drop the generic top-level division node from the label
    label_parts = [t for t in trail if not re.search(r"division$|^varsity & j", t, re.I)]
    return {"season": season, "event": event, "label": " › ".join(label_parts), "hard": hard}


def main():
    tossups, bonuses, cats = [], [], []
    seen = set()
    packets = []
    stats = {}
    for fname, comp, level in SOURCES:
        path = os.path.join(PDF_DIR, fname)
        if not os.path.exists(path):
            print("missing", path, file=sys.stderr)
            continue
        print("parsing", fname, file=sys.stderr)
        leaves, npages = outline_leaves(path)
        pages = page_texts(path)
        leaves = [l for l in leaves if not SKIP_OUTLINE.match(l[1][-1])]
        for i, (start, trail) in enumerate(leaves):
            end = leaves[i + 1][0] if i + 1 < len(leaves) else npages
            if end <= start:
                end = start + 1
            meta = packet_meta(trail, comp, level)
            pid = len(packets)
            packets.append({"comp": comp, "level": level, **meta})
            _cat_counter[0] = 0
            items = parse_packet(clean_pages(pages[start:end]), comp)
            catmap = {}
            for it in items:
                h = hashlib.md5((it["q"][:160] + "|" + it["a"][:60]).lower().encode()).hexdigest()[:12]
                if h in seen:
                    continue
                seen.add(h)
                sec = it["sec"]
                if comp == "bee":
                    kind = "bee"
                elif sec == "main":
                    kind = "q1"
                else:
                    kind = sec
                if kind == "q3":
                    cat = it.get("cat") or {"id": 0, "title": "Category", "lead": ""}
                    cs = catmap.setdefault(cat["id"], {"id": f"{pid}-{cat['id']}", "p": pid,
                                                       "title": cat["title"], "lead": cat["lead"], "items": []})
                    cs["items"].append({"q": it["q"], "a": it["a"]})
                    continue
                rec = {"id": h, "p": pid, "k": kind, "q": it["q"], "a": it["a"]}
                if it.get("bq") and it.get("ba"):
                    rec["bq"], rec["ba"] = it["bq"], it["ba"]
                rec["c"] = categorize(rec["q"], rec["a"], giveaway(rec["q"]))
                tossups.append(rec)
                stats[(comp, level, kind)] = stats.get((comp, level, kind), 0) + 1
            for cs in catmap.values():
                if 4 <= len(cs["items"]) <= 12:
                    blob = " ".join(x["q"] + " " + x["a"] for x in cs["items"])
                    cs["c"] = categorize(blob, "", cs["title"] + " " + cs["lead"] + " " + cs["title"])
                    cats.append(cs)
                    stats[(comp, level, "q3")] = stats.get((comp, level, "q3"), 0) + 1

    for k in sorted(stats):
        print(k, stats[k], file=sys.stderr)
    data = {"categories": CATEGORIES, "packets": packets, "tossups": tossups, "q3": cats}
    out = os.path.join(APP, "data", "questions.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.QDATA=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("wrote", out, os.path.getsize(out) // 1024, "KB", file=sys.stderr)


if __name__ == "__main__":
    main()
