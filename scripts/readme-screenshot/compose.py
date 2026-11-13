"""Frames the two captures (board behind, open session in front) into docs/screenshot.png's source page."""
import base64, sys

S = sys.argv[1]


def uri(p):
    return "data:image/png;base64," + base64.b64encode(open(p, "rb").read()).decode()


board, focus = uri(f"{S}/out/desk/board.png"), uri(f"{S}/out/desk/focus.png")
grid_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><path d="M0 15 L30 0 L60 15 L30 30 Z" fill="none" stroke="#18181a" stroke-width="1"/></svg>'
grid = "data:image/svg+xml," + grid_svg.replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace('"', "'")


def window(src, w, cls):
    # A quiet window frame: thin title bar with the address, hairline border, deep soft shadow.
    h = w * 900 / 1440
    return f"""<div class="win {cls}" style="width:{w}px">
  <div class="bar"><span></span><span></span><span></span><div class="url">127.0.0.1:8787</div></div>
  <img src="{src}" style="width:{w}px;height:{h:.0f}px">
</div>"""


html = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500&display=swap" rel="stylesheet">
<style>
html,body{{margin:0;background:#0b0b0c}}
.c{{position:relative;width:1600px;height:1000px;overflow:hidden;font-family:Inter,system-ui,sans-serif;
  background:radial-gradient(900px 520px at 78% 88%,rgba(242,120,92,.10),transparent 70%),radial-gradient(1100px 700px at 18% 0%,rgba(255,255,255,.035),transparent 70%),#0b0b0c}}
.grid{{position:absolute;inset:0;background:url("{grid}");opacity:.9;
  -webkit-mask-image:radial-gradient(1200px 800px at 50% 40%,#000 30%,transparent 80%);mask-image:radial-gradient(1200px 800px at 50% 40%,#000 30%,transparent 80%)}}
.win{{position:absolute;border-radius:14px;overflow:hidden;background:#0d0d0e;
  box-shadow:0 0 0 1px rgba(255,255,255,.09),0 30px 80px -10px rgba(0,0,0,.75),0 12px 24px -8px rgba(0,0,0,.6)}}
.win img{{display:block}}
.bar{{height:34px;display:flex;align-items:center;gap:7px;padding:0 14px;background:#141415;border-bottom:1px solid rgba(255,255,255,.06);position:relative}}
.bar span{{width:10px;height:10px;border-radius:50%;background:#2e2e31}}
.url{{position:absolute;left:50%;transform:translateX(-50%);height:20px;padding:0 12px;border-radius:6px;background:#1b1b1d;color:#6e6d6a;font-size:11px;line-height:20px;letter-spacing:.01em}}
.back{{left:72px;top:64px}}
.front{{left:600px;top:356px}}
</style></head><body><div class="c"><div class="grid"></div>
{window(board, 1120, "back")}
{window(focus, 920, "front")}
</div></body></html>"""
open(f"{S}/compose.html", "w").write(html)
