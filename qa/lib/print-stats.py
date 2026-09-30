#!/usr/bin/env python3
"""Raster stats for print tests. usage: print-stats.py <dir-with-pngs> <dpi>
Per page (sorted by filename): size, fraction of white / dark pixels, ink (non-white) pixel counts in the
right / left margin strips (x > 7.9in / x < 0.6in on a Letter page), red / blue pixel counts, total ink."""
import sys, glob, json
from PIL import Image
d, dpi = sys.argv[1], float(sys.argv[2])
out = []
for f in sorted(glob.glob(d + '/*.png')):
    im = Image.open(f).convert('RGB'); w, h = im.size
    data = list(im.getdata()); n = len(data)
    white = dark = ink = red = blue = ir = il = 0
    xr, xl = 7.9 * dpi, 0.6 * dpi
    for i, (r, g, b) in enumerate(data):
        mn = min(r, g, b)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if mn >= 235: white += 1
        if lum < 64: dark += 1
        if mn < 200:
            ink += 1
            x = i % w
            if x >= xr: ir += 1
            if x < xl: il += 1
        if r > 180 and g < 90 and b < 90: red += 1
        if b > 180 and r < 90 and g < 90: blue += 1
    out.append({'file': f.split('/')[-1], 'w': w, 'h': h, 'white': white / n, 'dark': dark / n, 'ink': ink, 'inkRight': ir, 'inkLeft': il, 'red': red, 'blue': blue})
print(json.dumps(out))
