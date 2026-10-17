#!/usr/bin/env python3
"""Concatenate src/ into one self-contained HTML page.
  python3 build.py                 -> dist/  (all groups)
  python3 build.py --only a --out dist-a   -> foundation + group a only
Outputs: <out>/noter-prototype.html (standalone, with doctype) and <out>/artifact.html (claude.ai Artifact body).
Foundation files are those whose name starts with 0 or 9 (00-core.js ... 99-boot.js).
Group files are named NN-<group>-*.js / NN-<group>*.css (10-a, 20-b, 30-c, 40-d, 50-e)."""
import glob, os, sys, re
here = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
only = None; out = "dist"
if "--only" in args: only = set(args[args.index("--only") + 1].split(","))
if "--out" in args: out = args[args.index("--out") + 1]
def keep(path):
    name = os.path.basename(path)
    if name[0] in "09": return True
    if only is None: return True
    m = re.match(r"\d\d-([a-z])", name)
    return bool(m and m.group(1) in only)
css = "\n".join(open(p).read() for p in sorted(glob.glob(os.path.join(here, "src/css/*.css"))) if keep(p))
js = "\n;\n".join(open(p).read() for p in sorted(glob.glob(os.path.join(here, "src/js/*.js"))) if keep(p))
title = "Noter Prototype"
head = f'<title>{title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
body = f'<style>\n{css}\n</style>\n<div id="np-root"></div>\n<script>\n{js}\n</script>\n'
od = os.path.join(here, out); os.makedirs(od, exist_ok=True)
open(os.path.join(od, "artifact.html"), "w").write(head + body)
open(os.path.join(od, "noter-prototype.html"), "w").write(
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head +
  '<style>html,body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + body + '</body>\n</html>\n')
print("built", out, len(head + body) // 1024, "KB")
