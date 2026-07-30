#!/usr/bin/env python3
"""Regenerate the flat (non-glass) icon so it stays locked to the glass icon.

Everything is derived from the current sources — nothing is hard-coded — so an
Icon Composer re-tune (scale, position, background, opacity, translucency) or a
mark-geometry edit flows straight through:

  * mark geometry  <- the three layer SVGs in AppIcon.icon/Assets
  * layer order + layer*group opacities + per-group translucency  <- icon.json
  * scale + position  <- measured from the exported glass PNG's dark-node bbox
  * background  <- the intended solid fill from the background layer (the glass's
                   auto-gradient depth effect is dropped); sampled from the glass
                   only as a fallback, and for measuring translucency backdrops
  * translucency  <- for each translucency-ENABLED group, the layer's effective
                     opacity is measured directly off the glass export (the glass
                     material makes it far more see-through than its raw opacity),
                     over the ACTUAL backdrop behind it (layers behind it, measured
                     back-to-front), not the bare gradient

Writes packaging/icon-flat/appicon-flat.svg + appicon-flat-1024.png.
Requires: rsvg-convert, magick (both already used by build_icons.sh's toolchain).

A third mode, `build_flat_icon.py ico`, packages the already-built LIGHT flat master into a
multi-resolution Windows .ico (see build_ico() below). It regenerates nothing else — run it after
the light/dark passes, or on its own when only the Windows icon needs rebuilding.
"""
import json, os, re, shutil, struct, subprocess, sys, tempfile

HERE   = os.path.dirname(os.path.abspath(__file__))
ICON   = os.path.join(HERE, "AppIcon.icon")
ASSETS = os.path.join(ICON, "Assets")
APP = (sys.argv[1] if len(sys.argv) > 1 else "light").lower()   # "light", "dark", or "ico"
_SFX = "-dark" if APP == "dark" else ""
GLASS  = os.path.join(HERE, "icon-flat", f"appicon{_SFX}-1024.png")
OUT_SVG = os.path.join(HERE, "icon-flat", f"appicon-flat{_SFX}.svg")
OUT_PNG = os.path.join(HERE, "icon-flat", f"appicon-flat{_SFX}-1024.png")

def sh(*a): return subprocess.check_output(a, text=True).strip()

# ── Windows .ico ────────────────────────────────────────────────────────────────
# Built from the LIGHT flat master only. Windows has no light/dark app-icon switching for a Win32
# .ico (the shell reads one icon and tints nothing), so a dark variant would have no consumer.
#
# NOT built with Pillow. Pillow is NOT a dependency of this project — it is absent from
# requirements-core.txt and requirements.txt, and `pip show pillow` in the dev venv reports
# "Required-by:" empty; the only mentions anywhere in the dependency graph are optional extras
# (transformers[vision], networkx[doc]) that pip never installs. It happens to be present in one
# developer's venv, which is exactly the kind of accident a build script must not depend on.
# ImageMagick is used instead: build_icons.sh already hard-requires `magick`, so this adds no
# prerequisite at all.
#
# SIZES. The Windows shell's canonical bases are 16 (title bar, tree views, small icons), 32
# (taskbar, Alt-Tab), 48 (Explorer "large icons", the default desktop size) and 256 (the "extra
# large"/jumbo view and what Start scales from). The rest are those bases at the display scale
# factors Windows 10/11 actually use — 125 % (16→20, 32→40), 150 % (16→24, 32→48), 200 % (32→64,
# 48→96) — plus 128 for the half-scale jumbo. Shipping them means the shell never has to resample:
# an icon Windows scales itself is the difference between crisp and mushy at 125 %, which is the
# most common non-100 % setting on laptops.
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
ICO_PNG_FROM = 256      # entries at or above this size are stored PNG-compressed, below it as DIB
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

def _ico_entries(blob):
    """Parse an .ico into [(width, height, bitcount, payload)] — also the self-check on our output."""
    if len(blob) < 6 or struct.unpack("<HH", blob[0:4]) != (0, 1):
        raise SystemExit("not an .ico (bad ICONDIR)")
    n = struct.unpack("<H", blob[4:6])[0]
    out = []
    for i in range(n):
        w, h, _cc, _rv, _pl, bc, size, off = struct.unpack("<BBBBHHII", blob[6 + 16 * i: 22 + 16 * i])
        if off + size > len(blob):
            raise SystemExit(f"ico entry {i} runs past end of file")
        out.append((w or 256, h or 256, bc, blob[off:off + size]))
    return out

def _ico_pack(entries):
    """(width, height, bitcount, payload) … → an .ico container. Offsets are computed here, so the
    caller cannot get them wrong; every payload is stored verbatim."""
    head = struct.pack("<HHH", 0, 1, len(entries))
    off = len(head) + 16 * len(entries)
    dirblob, data = b"", b""
    for w, h, bc, payload in entries:
        dirblob += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, bc, len(payload), off)
        off += len(payload)                                  # 0 in the width/height byte means 256
        data += payload
    return head + dirblob + data

def build_ico():
    src = os.path.join(HERE, "icon-flat", "appicon-flat-1024.png")
    out = os.path.join(HERE, "icon-flat", "appicon-flat.ico")
    if not os.path.exists(src):
        sys.exit(f"missing flat master: {src} (run this script with no arguments first)")

    small = [s for s in ICO_SIZES if s < ICO_PNG_FROM]
    big   = [s for s in ICO_SIZES if s >= ICO_PNG_FROM]
    tmpdir = tempfile.mkdtemp()
    try:
        # (a) the sub-256 sizes through ImageMagick's own ICO encoder, which writes them as 32-bit
        #     BGRA DIBs with the AND mask Windows expects. Lanczos because the mark is thin-lined
        #     and IM's default box-ish reduction turns the 16 px rendering to porridge.
        tmp_ico = os.path.join(tmpdir, "small.ico")
        sh("magick", src, "-filter", "Lanczos",
           "-define", "icon:auto-resize=" + ",".join(str(s) for s in sorted(small, reverse=True)),
           tmp_ico)
        entries = _ico_entries(open(tmp_ico, "rb").read())

        # (b) 256 as PNG rather than DIB. A 256×256 32-bit DIB is 256 KB of raw pixels; the same
        #     image as PNG is around a tenth of that, and Vista and later read PNG-compressed
        #     entries natively. Storing the LARGE entry as PNG and the small ones as DIB is what
        #     Windows' own icons do — the small sizes stay DIB because that is the shape every
        #     shell component, however old, has always understood.
        for s in big:
            png = os.path.join(tmpdir, f"{s}.png")
            sh("magick", src, "-filter", "Lanczos", "-resize", f"{s}x{s}", "png32:" + png)
            entries.append((s, s, 32, open(png, "rb").read()))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    entries.sort(key=lambda e: -e[0])                        # largest first, the usual convention
    blob = _ico_pack(entries)
    with open(out, "wb") as f:
        f.write(blob)

    # Verify what we just wrote by re-parsing it: every offset/length in bounds, every payload's
    # magic matching the kind its directory entry implies. Cheap, and the only check available on a
    # machine that cannot open the file in Explorer.
    got = _ico_entries(open(out, "rb").read())
    if [e[0] for e in got] != sorted(ICO_SIZES, reverse=True):
        sys.exit(f"ico: wrote sizes {[e[0] for e in got]}, expected {sorted(ICO_SIZES, reverse=True)}")
    for w, h, bc, payload in got:
        is_png = payload[:8] == PNG_MAGIC
        if is_png != (w >= ICO_PNG_FROM):
            sys.exit(f"ico: {w}px entry is {'PNG' if is_png else 'DIB'} but should not be")
        if not is_png and struct.unpack("<I", payload[:4])[0] != 40:
            sys.exit(f"ico: {w}px DIB entry has no BITMAPINFOHEADER")
    print(f"wrote {out}")
    for w, h, bc, payload in got:
        kind = "PNG" if payload[:8] == PNG_MAGIC else "DIB"
        print(f"  {w:>3}×{h:<3} {bc}bpp  {kind}  {len(payload):>7} B")
    print(f"  total {len(blob) / 1024:.1f} kB")

if APP == "ico":
    build_ico()
    sys.exit(0)

if not os.path.exists(GLASS):
    sys.exit(f"missing glass export: {GLASS} (run the Icon Composer export first)")

# --- 1. layers (top->bottom): opacity + whether the group's translucency is on --
icon = json.load(open(os.path.join(ICON, "icon.json")))

def pick(specs, app=None):                          # entry matching `app` (else the default = no-appearance entry)
    app = app or APP
    default = None
    for s in specs or []:
        if s.get("appearance") == app: return s.get("value")
        if "appearance" not in s: default = s.get("value")
    return default                                  # a dark layer without its own variant falls back to the default

def layer_name(l):                                  # Icon Composer stores per-appearance images as image-name-
    if l.get("image-name"): return l["image-name"]  # specializations; the flat tracks the current APP appearance
    return pick(l.get("image-name-specializations"))

def group_opacity(g):                               # plain opacity, else the per-appearance opacity-specialization
    return g.get("opacity", pick(g.get("opacity-specializations")) or 1)

def fill_solid(icon):                               # the canvas auto-gradient colour for THIS appearance = the flat bg
    val = pick(icon.get("fill-specializations")) or icon.get("fill")
    ag = (val or {}).get("automatic-gradient", "") if isinstance(val, dict) else ""
    m = re.match(r"srgb:([\d.]+),([\d.]+),([\d.]+)", ag)
    return "#%02X%02X%02X" % tuple(round(float(v) * 255) for v in m.groups()) if m else None

layers = []
for g in icon["groups"]:
    gop = group_opacity(g)                          # GROUP opacity multiplies the layer's
    tr_on = bool(g.get("translucency", {}).get("enabled"))
    blend = g.get("blend-mode")                     # e.g. "darken" — a compositing hint we must honour
    for l in g["layers"]:
        if l.get("hidden"): continue
        nm = layer_name(l)
        if nm: layers.append((nm, l.get("opacity", 1) * gop, tr_on, blend))

# --- 2. pull mark geometry (symbols, gradient, <use> placement) from sources ----
def read(name): return open(os.path.join(ASSETS, name), encoding="utf-8").read()
def symbol(svg): return re.search(r"<symbol\b.*?</symbol>", svg, re.S).group(0)
def use_attr(svg, a): return re.search(r'<use\b[^>]*\b%s="([\d.\-]+)"' % a, svg).group(1)
def use_id(svg): return re.search(r'<use\b[^>]*href="#([^"]+)"', svg).group(1)
def dom_color(sym):  # the layer's dominant flat colour (first solid hex; skips url(#..) fills)
    m = re.search(r'(?:fill|stroke)="(#[0-9A-Fa-f]{6})"', sym)
    return (m.group(1) if m else "#FFFFFF").upper()

def blend_hex(base, top, alpha):    # `top` composited OVER `base` at `alpha` (0..1), per sRGB channel
    b = tuple(int(base[k:k+2], 16) for k in (1, 3, 5))
    t = tuple(int(top[k:k+2], 16) for k in (1, 3, 5))
    return "#%02X%02X%02X" % tuple(round(b[i] * (1 - alpha) + t[i] * alpha) for i in range(3))

tentgrad = re.search(r'<linearGradient id="tentGrad".*?</linearGradient>',
                     read("edges.svg"), re.S).group(0)

comp = []  # bottom->top
bg_solid = fill_solid(icon)     # from the canvas fill; a background LAYER (if any) overrides it below
for name, op, tr_on, blend in reversed(layers):
    svg = read(name)
    m = re.search(r"<symbol\b.*?</symbol>", svg, re.S)
    if not m:                       # a plain background layer (no mark): COMPOSITE its fill onto the
        fm = re.search(r'fill="(#[0-9A-Fa-f]{6})"', svg)   # running background at its group×layer opacity.
        if fm:                                             # A low-opacity accent wash (SVG kept fully opaque
            bg_solid = blend_hex(bg_solid or "#FFFFFF", fm.group(1).upper(), op)  # so the layer opacity is the
        continue                                           # knob) must TINT the canvas fill, not replace it.
    sym = m.group(0)
    comp.append(dict(sym=sym, sid=use_id(svg), op=op, tr=tr_on, blend=blend, color=dom_color(sym),
                     x=use_attr(svg, "x"), y=use_attr(svg, "y"),
                     w=use_attr(svg, "width"), h=use_attr(svg, "height")))

# The white halo casing rides a "darken" group: in the glass its fill overpaints nothing
# (darken keeps the darker layer, so white contributes only via the glass shadow/specular
# casing), and Icon Composer places it at the FRONT of the stack. A plain over-compositor
# would instead bury the marks under opaque white. So sink any darken layer to the BACK of
# the flat stack — which is exactly where the flat has always drawn the white casing, behind
# the marks. Stable, so relative order among non-darken (and among darken) layers is kept.
comp.sort(key=lambda L: L["blend"] != "darken")

# --- 3. measure the glass export: dark-node bbox + background gradient -----------
def dark_bbox(png):
    s = sh("magick", png, "-background", "#808080", "-flatten",
           "-colorspace", "Gray", "-threshold", "30%", "-negate", "-format", "%@", "info:")
    w, h, x, y = map(int, re.match(r"(\d+)x(\d+)\+(\d+)\+(\d+)", s).groups())
    return x, y, w, h

def sample(png, x, y):
    s = sh("magick", png, "-format", "%%[pixel:p{%d,%d}]" % (x, y), "info:")
    r, g, b = re.search(r"srgba?\(([\d.]+)%,([\d.]+)%,([\d.]+)%", s).groups()
    return tuple(round(float(v) * 255 / 100) for v in (r, g, b))

gx, gy, gw, gh = dark_bbox(GLASS)
bg_top = sample(GLASS, 512, max(20, gy // 2))                 # clear above the mark
bg_bot = sample(GLASS, 512, min(1004, (gy + gh + 1024) // 2)) # clear below the mark
hexc = lambda t: "#%02X%02X%02X" % t

def ppm(png, size=256):
    with tempfile.NamedTemporaryFile(suffix=".ppm", delete=False) as f: tmp = f.name
    try:
        sh("magick", png, "-background", "#808080", "-flatten", "-resize", "%dx%d!" % (size, size), "-depth", "8", tmp)
        d = open(tmp, "rb").read()
    finally: os.unlink(tmp)
    i, vals = 2, []                       # header: P6 W H maxval
    while len(vals) < 3:
        while d[i] in b" \t\n\r": i += 1
        j = i
        while d[j] not in b" \t\n\r": j += 1
        vals.append(int(d[i:j])); i = j
    W, H, _ = vals
    return W, H, d[i + 1:]

def measure_over(mask_png, backdrop_png, layer_color):
    """Effective opacity of a translucent layer over its ACTUAL backdrop: at the
    pixels where the layer shows (painted magenta in mask_png, so an equal-coloured
    layer in front can't contaminate the mask), read how much of the layer's colour
    survives in the glass over the backdrop that is actually behind it."""
    tr = tuple(int(layer_color[k:k+2], 16) for k in (1, 3, 5))
    W, H, M = ppm(mask_png); _, _, B = ppm(backdrop_png); _, _, G = ppm(GLASS)
    alphas = []
    for i in range(W * H):
        o = i * 3
        if not (M[o] > 180 and M[o+1] < 80 and M[o+2] > 180): continue   # magenta marker
        b = (B[o], B[o+1], B[o+2]); g = (G[o], G[o+1], G[o+2])
        a = [(g[k] - b[k]) / (tr[k] - b[k]) for k in range(3) if abs(tr[k] - b[k]) > 8]
        if a:
            av = sum(a) / len(a)
            if 0 < av < 1.3: alphas.append(av)
    alphas.sort()
    return round(alphas[len(alphas) // 2], 3) if alphas else 1.0

# --- 4. compose + fit transform (base identity render measures scale) -----------
def compose(matrix):
    defs, seen = [
        f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{hexc(bg_top)}"/><stop offset="1" stop-color="{hexc(bg_bot)}"/></linearGradient>',
        tentgrad], set()
    for L in comp:
        if L["sid"] not in seen:
            defs.append(L["sym"]); seen.add(L["sid"])
    uses = "\n".join(
        f'<use href="#{L["sid"]}" x="{L["x"]}" y="{L["y"]}" width="{L["w"]}" height="{L["h"]}" opacity="{L["op"]}"/>'
        for L in comp)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">\n'
            f'<defs>\n' + "\n".join(defs) + "\n</defs>\n"
            f'<rect x="0" y="0" width="100" height="100" fill="url(#bg)"/>\n'
            f'<g transform="{matrix}">\n{uses}\n</g>\n</svg>\n')

def render(svg_text, png):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg_text); tmp = f.name
    try: sh("rsvg-convert", "-w", "1024", "-h", "1024", tmp, "-o", png)
    finally: os.unlink(tmp)

META = os.path.join(HERE, "icon-flat", ".flat-meta.json")
if APP == "dark":
    # Light & dark share identical mark geometry AND translucency VALUES, so the dark flat reuses
    # the light run's fitted transform + measured opacities. Re-measuring against a dark wash is
    # unreliable (a dark-pixel landmark grabs the whole dark canvas); the dark glass export is only
    # needed for the padded Dock PNG, not here.
    if not os.path.exists(META): sys.exit("build the LIGHT flat first — the dark flat reuses its .flat-meta.json")
    _meta = json.load(open(META)); matrix = _meta["matrix"]; s = _meta["scale"]
else:
    # The base render is a GEOMETRIC landmark only (to measure the mark's scale/position), so force
    # every layer opaque: the marks ride translucent layers and at their real ~0.5 opacity they wash
    # out to grey and no longer clear dark_bbox's threshold.
    _saved = [L["op"] for L in comp]
    for L in comp: L["op"] = 1
    render(compose("matrix(1 0 0 1 0 0)"), OUT_PNG)          # base placement
    for L, o in zip(comp, _saved): L["op"] = o
    bx, by, bw, bh = dark_bbox(OUT_PNG)
    s = ((gw / bw) + (gh / bh)) / 2                           # uniform scale, base -> glass
    bcx, bcy = (bx + bw / 2) / 10.24, (by + bh / 2) / 10.24
    gcx, gcy = (gx + gw / 2) / 10.24, (gy + gh / 2) / 10.24
    matrix = f"matrix({s:.5f} 0 0 {s:.5f} {gcx - s*bcx:.5f} {gcy - s*bcy:.5f})"

# --- 5. translucency: the glass darkens/tints translucent layers. Measure each
#        one's effective opacity over its ACTUAL backdrop — the layers behind it,
#        not the bare gradient. The white halo casing sits behind the projections
#        and lightens their true backdrop, so a gradient-only reference under-darkens
#        them. Go back-to-front (comp[0] is backmost) so each layer's backdrop
#        already carries the measured opacities of the layers behind it. --------
tr_notes = []
if APP == "dark":
    for L in comp: L["op"] = _meta["ops"].get(L["sid"], L["op"])   # symbol ids are shared across appearances
    tr_notes = [f"{k}: {v} (reused)" for k, v in _meta["ops"].items()]
else:
    MARKER = "#FF00FF"                                        # isolates the measured layer
    BD, MK = OUT_PNG + ".bd.png", OUT_PNG + ".mk.png"
    for i, L in enumerate(comp):
        if not L["tr"]: continue
        saved = [c["op"] for c in comp]; sym0 = L["sym"]
        # (a) backdrop: layers behind L at their current opacities; L and all in front hidden
        for j, c in enumerate(comp):
            if j >= i: c["op"] = 0
        render(compose(matrix), BD)
        # (b) mask: L painted magenta (opaque); front layers kept opaque so they cleanly occlude it
        for j, c in enumerate(comp): c["op"] = saved[j]
        L["sym"] = re.sub(re.escape(L["color"]), MARKER, sym0, flags=re.I); L["op"] = 1
        for j, c in enumerate(comp):
            if j > i: c["op"] = 1
        render(compose(matrix), MK)
        L["sym"] = sym0
        for j, c in enumerate(comp): c["op"] = saved[j]
        # (c) measure over the real backdrop, apply
        eff = measure_over(MK, BD, L["color"])
        tr_notes.append(f"{L['sid']}: {saved[i]}->{eff}")
        L["op"] = eff
    for f in (BD, MK):
        if os.path.exists(f): os.unlink(f)
    json.dump({"matrix": matrix, "scale": s, "ops": {L["sid"]: L["op"] for L in comp}}, open(META, "w"))

# The flat background is the intended solid colour from the background layer, NOT the
# glass-sampled gradient (the glass adds an auto-gradient depth effect we deliberately
# drop for the flat). Translucency was still measured above against the glass's real
# (gradient) backdrop, so the layers carry their true opacities and composite correctly
# over the solid fill. Fall back to the sampled gradient if there's no background layer.
if bg_solid:
    bg_top = bg_bot = tuple(int(bg_solid[k:k+2], 16) for k in (1, 3, 5))

final = compose(matrix)
open(OUT_SVG, "w").write(final)
render(final, OUT_PNG)

print(f"wrote {OUT_SVG}")
print(f"wrote {OUT_PNG}")
print(f"  appearance={APP}  scale={s:.4f}  bg {hexc(bg_top)} -> {hexc(bg_bot)}")
if tr_notes: print(f"  effective opacity: {', '.join(tr_notes)}")
if APP == "dark":
    print("  transform + opacities reused from the light run")
else:
    # fit sanity: the finished flat's marks are translucent, so dark_bbox on OUT_PNG would find
    # nothing — render an opaque landmark just to confirm the fitted mark lands on the glass bbox.
    _saved = [L["op"] for L in comp]
    for L in comp: L["op"] = 1
    render(compose(matrix), OUT_PNG + ".fit.png")
    for L, o in zip(comp, _saved): L["op"] = o
    fx, fy, fw, fh = dark_bbox(OUT_PNG + ".fit.png")
    os.unlink(OUT_PNG + ".fit.png")
    print(f"  fit: flat dark-bbox {fw}x{fh}+{fx}+{fy}  vs glass {gw}x{gh}+{gx}+{gy}")
