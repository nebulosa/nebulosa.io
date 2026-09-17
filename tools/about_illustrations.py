"""Isometric SVG generator for the About illustrations, matching the Services set.

    python3 tools/about_illustrations.py assets/img/illustrations

Coordinates are 3D (x right-down, y left-down, z up) projected at 30 degrees.
Face shading follows the Services images: top lightest, +x face light, +y face
mid. Shapes are painted in call order, so each scene draws back to front.
"""
import math, sys, os

COS, SIN = math.cos(math.radians(30)), math.sin(math.radians(30))
C = dict(  # sampled from assets/img/ot0-ot5.png
    top='#f0fcfc', light='#cce4fc', mid='#a8ccfc', dark='#84a8e4',
    navy='#304890', navy2='#243c78', deep='#002460', steel='#546ca8',
    mint='#6cfce4', mint2='#3ce4c0', mintl='#a8fcf0', ground='#302478',
    blush='#fca8a8',
)


class Scene:
    def __init__(self, cx=600, cy=520, s=1.0):
        self.cx, self.cy, self.s = cx, cy, s
        self.parts, self.defs = [], []
        self.bounds = [1e9, 1e9, -1e9, -1e9]
        self.ids = 0

    def uid(self, prefix):
        self.ids += 1
        return f'{prefix}{self.ids}'

    def extend(self, x, y, r=0):
        b = self.bounds
        b[0], b[1], b[2], b[3] = min(b[0], x - r), min(b[1], y - r), max(b[2], x + r), max(b[3], y + r)

    def p(self, x, y, z):
        return (self.cx + (x - y) * COS * self.s, self.cy + (x + y) * SIN * self.s - z * self.s)

    # --- raw shapes -----------------------------------------------------------
    def poly(self, pts, fill, extra=''):
        proj = [self.p(*q) for q in pts]
        for a, b in proj:
            self.extend(a, b)
        d = ' '.join(f'{a:.1f},{b:.1f}' for a, b in proj)
        self.parts.append(f'<polygon points="{d}" fill="{fill}" {extra}/>')

    def path(self, pts, stroke, width=4, extra='', closed=False):
        proj = [self.p(*q) for q in pts]
        for a, b in proj:
            self.extend(a, b, width)
        d = 'M' + ' L'.join(f'{a:.1f} {b:.1f}' for a, b in proj) + (' Z' if closed else '')
        self.parts.append(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" {extra}/>')

    def line(self, a, b, stroke, width=4, extra=''):
        self.path([a, b], stroke, width, extra)

    def ellipse(self, x, y, z, r, fill, extra=''):
        """A circle lying flat at height z, projected."""
        cx, cy = self.p(x, y, z)
        rx, ry = r * COS * math.sqrt(2) * self.s, r * SIN * math.sqrt(2) * self.s
        self.extend(cx, cy - ry); self.extend(cx - rx, cy); self.extend(cx + rx, cy + ry)
        self.parts.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}" {extra}/>')
        return cx, cy, rx, ry

    # --- solids ---------------------------------------------------------------
    def shadow(self, x, y, w, d, pad=30):
        self.poly([(x - pad, y - pad, 0), (x + w + pad, y - pad, 0), (x + w + pad, y + d + pad, 0), (x - pad, y + d + pad, 0)],
                  C['ground'], 'opacity=".55"')

    def box(self, x, y, z, w, d, h, top=None, xface=None, yface=None, edge=True):
        top, xface, yface = top or C['top'], xface or C['light'], yface or C['mid']
        self.poly([(x + w, y, z), (x + w, y + d, z), (x + w, y + d, z + h), (x + w, y, z + h)], xface)
        self.poly([(x, y + d, z), (x + w, y + d, z), (x + w, y + d, z + h), (x, y + d, z + h)], yface)
        self.poly([(x, y, z + h), (x + w, y, z + h), (x + w, y + d, z + h), (x, y + d, z + h)], top)
        if edge and min(w, d) > 20:  # the bright rim along the two front top edges
            self.path([(x, y + d, z + h), (x + w, y + d, z + h), (x + w, y, z + h)], '#ffffff', 2.5, 'opacity=".75"')

    def cylinder(self, x, y, z, r, h, top=None, side=None, rim=None):
        top, side = top or C['top'], side or C['mid']
        cx, cy = self.p(x, y, z)
        rx, ry = r * COS * math.sqrt(2) * self.s, r * SIN * math.sqrt(2) * self.s
        hh = h * self.s
        self.extend(cx - rx, cy + ry); self.extend(cx + rx, cy - hh - ry)
        self.parts.append(f'<path d="M{cx-rx:.1f} {cy-hh:.1f}v{hh:.1f}a{rx:.1f} {ry:.1f} 0 0 0 {2*rx:.1f} 0v-{hh:.1f}Z" fill="{side}"/>')
        self.parts.append(f'<ellipse cx="{cx:.1f}" cy="{cy-hh:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{top}"/>')
        if rim:
            self.parts.append(f'<ellipse cx="{cx:.1f}" cy="{cy-hh:.1f}" rx="{rx*.78:.1f}" ry="{ry*.78:.1f}" fill="{rim}"/>')

    def platform(self, x, y, w, d, h=26, inner=None, tiers=2):
        """Stepped slab like the Services bases: a wide foot and a raised deck."""
        self.shadow(x, y, w, d)
        self.box(x, y, 0, w, d, h * 0.6)
        if tiers == 2:
            self.box(x + 16, y + 16, h * 0.6, w - 32, d - 32, h * 0.7)
            top, inset = h * 1.3, 38
        else:
            top, inset = h * 0.6, 22
        if inner:
            self.poly([(x + inset, y + inset, top), (x + w - inset, y + inset, top), (x + w - inset, y + d - inset, top), (x + inset, y + d - inset, top)], inner)
        return top

    def chip(self, x, y, z, w, d, h=34):
        """Mint chip with pins on its two visible sides and a circuit grid on top."""
        n = 6
        for i in range(n):
            t = (i + 0.5) / n
            self.box(x + w, y + t * d - 5, z, 16, 10, 8, top=C['light'], xface=C['mid'], yface=C['dark'], edge=False)
            self.box(x + t * w - 5, y + d, z, 10, 16, 8, top=C['light'], xface=C['mid'], yface=C['dark'], edge=False)
        self.box(x, y, z, w, d, h, top=C['mintl'], xface=C['mint'], yface=C['mint2'])
        g = 14
        self.poly([(x + g, y + g, z + h), (x + w - g, y + g, z + h), (x + w - g, y + d - g, z + h), (x + g, y + d - g, z + h)], C['mint'])
        for i in range(1, 4):
            t = i / 4
            self.line((x + g + t * (w - 2 * g), y + g, z + h), (x + g + t * (w - 2 * g), y + d - g, z + h), C['mint2'], 2)
            self.line((x + g, y + g + t * (d - 2 * g), z + h), (x + w - g, y + g + t * (d - 2 * g), z + h), C['mint2'], 2)

    def beam(self, x, y, w, d, z0, h):
        gid = self.uid('beam')
        self.defs.append(f'<linearGradient id="{gid}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="{C["mint"]}" stop-opacity=".5"/><stop offset="1" stop-color="{C["mint"]}" stop-opacity="0"/></linearGradient>')
        self.poly([(x + w, y, z0), (x + w, y + d, z0), (x + w, y + d, z0 + h), (x + w, y, z0 + h)], f'url(#{gid})')
        self.poly([(x, y + d, z0), (x + w, y + d, z0), (x + w, y + d, z0 + h), (x, y + d, z0 + h)], f'url(#{gid})', 'opacity=".7"')

    # --- panels (upright, facing the viewer's left-front: plane y = const) -------
    def panel(self, x, y, z, w, h, depth=10, face=C['navy']):
        self.box(x, y, z, w, depth, h, top=C['steel'], xface=C['navy2'], yface=C['navy2'], edge=False)
        m = 10
        self.poly([(x + m, y + depth, z + m), (x + w - m, y + depth, z + m), (x + w - m, y + depth, z + h - m), (x + m, y + depth, z + h - m)], face)
        return lambda u, v: (x + m + u * (w - 2 * m), y + depth + 0.5, z + m + v * (h - 2 * m))

    def glass(self, x, y, z, w, h):
        """Floating translucent card with a bright outline, as in the Services set."""
        pts = [(x, y, z), (x + w, y, z), (x + w, y, z + h), (x, y, z + h)]
        self.poly(pts, C['mint'], 'opacity=".22"')
        self.path(pts, C['mintl'], 3, 'opacity=".9"', closed=True)
        return lambda u, v: (x + u * w, y + 0.5, z + v * h)

    def text_lines(self, at, rows, color=C['mintl'], width=6, top=0.8, step=0.16, lens=(0.8, 0.55, 0.7, 0.4)):
        for i in range(rows):
            v = top - i * step
            self.line(at(0.08, v), at(0.08 + lens[i % len(lens)] * 0.84, v), color, width)

    def wave(self, at, v0=0.45, amp=0.12, color=C['mint'], width=5, periods=2.5):
        pts = [at(u / 40, v0 + amp * math.sin(u / 40 * math.pi * 2 * periods)) for u in range(41)]
        self.path(pts, color, width)

    def bars(self, at, values, color=C['mint'], width=14):
        n = len(values)
        for i, h in enumerate(values):
            u = 0.12 + i * 0.76 / (n - 1)
            self.line(at(u, 0.1), at(u, 0.1 + h * 0.75), color, width)

    def laptop(self, x, y, z, w=90, d=64, face=C['mint']):
        """Laptop open toward the viewer: keyboard base plus a screen with content."""
        self.box(x, y, z, w, d, 7, top=C['light'], xface=C['mid'], yface=C['dark'], edge=False)
        for r in range(3):
            for k in range(6):
                kx, ky = x + 10 + k * (w - 20) / 6, y + 12 + r * 12
                self.poly([(kx, ky, z + 7), (kx + 9, ky, z + 7), (kx + 9, ky + 8, z + 7), (kx, ky + 8, z + 7)], C['mid'])
        at = self.panel(x, y - 4, z + 7, w, d * 0.9, depth=5, face=C['navy'])
        self.wave(at, 0.5, 0.18, face, 3.5, 1.5)

    def cubes(self, pts):
        for x, y, z, s in pts:
            self.box(x, y, z, s, s, s, top=C['mintl'], xface=C['mint'], yface=C['mint2'], edge=False)

    def particles(self, pts, color=C['mint']):
        for x, y, z, s in pts:
            px, py = self.p(x, y, z)  # not added to bounds: stray specks must not shrink the drawing
            self.parts.append(f'<rect x="{px-s/2:.1f}" y="{py-s/2:.1f}" width="{s:.1f}" height="{s:.1f}" fill="{color}" transform="rotate(45 {px:.1f} {py:.1f})" opacity=".85"/>')

    def svg(self, label):
        # Fit the view to the drawing (4:3, 6% padding) so every illustration fills
        # its box the way the Services images do.
        x0, y0, x1, y1 = self.bounds
        w, h = (x1 - x0) * 1.12, (y1 - y0) * 1.12
        if w / h > 4 / 3:
            h = w * 3 / 4
        else:
            w = h * 4 / 3
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        view = f'{cx - w / 2:.1f} {cy - h / 2:.1f} {w:.1f} {h:.1f}'
        return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + view + '" role="img" aria-label="' + label + '">\n'
                '  <!-- Generated by tools/about_illustrations.py; edit the scene there and regenerate. -->\n'
                '  <defs>' + ''.join(self.defs) + '</defs>\n  ' + '\n  '.join(self.parts) + '\n</svg>\n')


def curiosity():
    sc = Scene(cy=600)
    top = sc.platform(-190, -190, 380, 380)
    sc.chip(-95, -95, top, 190, 190)
    sc.beam(-95, -95, 190, 190, top + 34, 280)
    # Floating glass cards behind the network, with a wave and text.
    at = sc.glass(-260, -220, 260, 190, 150)
    sc.wave(at, 0.55, 0.15, C['mintl'], 4)
    at = sc.glass(-230, -250, 300, 190, 150)
    sc.text_lines(at, 4)
    nodes = [(-30, -30, 330, 46), (130, -140, 420, 40), (-170, 80, 470, 36), (70, 130, 560, 52), (190, 40, 300, 30), (-60, -200, 540, 30)]
    for a, b in [(0, 1), (0, 2), (2, 3), (1, 3), (0, 3), (1, 4), (4, 3), (5, 1), (5, 2)]:
        (x1, y1, z1, s1), (x2, y2, z2, s2) = nodes[a], nodes[b]
        sc.line((x1 + s1 / 2, y1 + s1 / 2, z1 + s1 / 2), (x2 + s2 / 2, y2 + s2 / 2, z2 + s2 / 2), C['navy'], 3)
    sc.cubes(sorted(nodes, key=lambda n: n[0] + n[1]))
    sc.particles([(-230, 120, 380, 10), (220, -200, 480, 8), (240, 170, 250, 9), (-120, -240, 350, 7), (40, 40, 650, 8)])
    return sc.svg('Connected ideas floating above a glowing chip')


def distributed():
    sc = Scene(cy=520, s=0.9)
    desks = [(320, -90), (-90, 320), (280, 280)]
    for dx, dy in desks:  # dashed links first, so the desks sit on top of them
        sc.line((0, 0, 40), (dx + 70, dy + 70, 30), C['mint2'], 5, 'stroke-dasharray="4 14"')
    top = sc.platform(-150, -150, 300, 300)
    sc.cylinder(0, 0, top, 95, 26, top=C['light'], side=C['dark'], rim=C['mint'])
    sc.beam(-60, -60, 120, 120, top + 26, 170)
    # Globe with continents, a meridian and an orbit ring.
    gx, gy = sc.p(0, 0, 360)
    r = 118 * sc.s
    sc.defs.append(f'<radialGradient id="globe" cx=".35" cy=".3"><stop offset="0" stop-color="{C["light"]}"/><stop offset="1" stop-color="{C["dark"]}"/></radialGradient>')
    sc.defs.append(f'<clipPath id="gclip"><circle cx="{gx:.1f}" cy="{gy:.1f}" r="{r:.1f}"/></clipPath>')
    sc.extend(gx, gy, r + 60)
    sc.parts.append(f'<ellipse cx="{gx:.1f}" cy="{gy:.1f}" rx="{r*1.55:.1f}" ry="{r*.42:.1f}" fill="none" stroke="{C["mint"]}" stroke-width="4" opacity=".8" stroke-dasharray="{r*2.4:.0f} {r*3:.0f}" transform="rotate(-16 {gx:.1f} {gy:.1f})"/>')
    sc.parts.append(f'<circle cx="{gx:.1f}" cy="{gy:.1f}" r="{r:.1f}" fill="url(#globe)"/>')
    sc.parts.append(
        f'<g clip-path="url(#gclip)"><g fill="{C["navy"]}" opacity=".85">'
        f'<path d="M{gx-95:.0f} {gy-75:.0f}c25-25 70-20 80 5s-5 30-25 45-10 40-35 35-30-40-45-50 5-20 25-35Z"/>'
        f'<path d="M{gx+5:.0f} {gy-60:.0f}c35-15 90-5 100 30s-20 35-10 60-35 45-55 25-15-45-35-50-20-50 0-65Z"/>'
        f'<path d="M{gx-70:.0f} {gy+40:.0f}c25-5 45 15 40 40s-20 45-40 35-25-40-15-60 5-15 15-15Z"/>'
        f'<path d="M{gx+55:.0f} {gy+60:.0f}c20-5 35 10 30 25s-30 15-35 0 0-20 5-25Z"/></g>'
        f'<ellipse cx="{gx:.1f}" cy="{gy:.1f}" rx="{r*.45:.1f}" ry="{r:.1f}" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>'
        f'<path d="M{gx-r:.1f} {gy:.1f}h{2*r:.1f}" stroke="#fff" stroke-width="2" opacity=".35"/></g>')
    sc.parts.append(f'<path d="M{gx-r*.62:.1f} {gy-r*.55:.1f}a{r*.8:.1f} {r*.8:.1f} 0 0 1 {r*.5:.1f} -{r*.3:.1f}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".7"/>')
    for dx, dy in desks:
        dtop = sc.platform(dx, dy, 150, 150, h=22, tiers=1)
        sc.box(dx + 100, dy + 20, dtop, 34, 34, 36, top=C['light'], xface=C['mid'], yface=C['dark'])  # stool
        sc.laptop(dx + 22, dy + 60, dtop)
        sc.box(dx + 20, dy + 16, dtop, 40, 30, 16, top=C['mintl'], xface=C['mint'], yface=C['mint2'])  # mug-sized block
    sc.cubes([(150, 30, 60, 18), (40, 170, 60, 18), (170, 170, 55, 16)])  # data packets on the links
    sc.particles([(-230, 60, 420, 9), (200, -220, 330, 8), (-120, -240, 250, 8)])
    return sc.svg('A globe above a central platform, linked to three remote desks')


def growing():
    sc = Scene(cy=640)
    top = sc.platform(-260, -170, 520, 340)
    # Glass chart behind the bars.
    at = sc.glass(-230, -150, top + 60, 330, 250)
    sc.path([at(0.08, 0.2), at(0.3, 0.35), at(0.5, 0.3), at(0.72, 0.6), at(0.92, 0.82)], C['mintl'], 5)
    for u, v in [(0.3, 0.35), (0.5, 0.3), (0.72, 0.6), (0.92, 0.82)]:
        px, py = sc.p(*at(u, v))
        sc.parts.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="7" fill="{C["mint"]}"/>')
    sc.text_lines(at, 2, top=0.95, step=0.08, width=4)
    heights = [110, 190, 280, 400]
    for i, h in enumerate(heights):
        x = -200 + i * 110
        last = i == len(heights) - 1
        sc.box(x, -40, top, 76, 110, h, top=C['mintl'] if last else C['top'], xface=C['mint'] if last else C['light'], yface=C['mint2'] if last else C['mid'])
        for k in range(1, int(h // 60)):  # floor lines on the visible faces
            z = top + k * 60
            sc.line((x, -40 + 110, z), (x + 76, -40 + 110, z), C['mint2'] if last else C['dark'], 2)
            sc.line((x + 76, -40, z), (x + 76, 70, z), C['mint'] if last else C['mid'], 2)
    sc.beam(130, -40, 76, 110, top + 400, 170)
    # Coin stacks at the front.
    for i, (cx, cy) in enumerate([(-170, 120), (-90, 130)]):
        for k in range(3 + i * 2):
            sc.cylinder(cx, cy, top + k * 12, 26, 12, top=C['mintl'], side=C['mint2'])
    # A rising arrow, drawn as a thick ribbon with a head.
    a = [sc.p(-220, 70, 260), sc.p(-90, 70, 330), sc.p(20, 70, 400), sc.p(170, 70, 560)]
    d = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in a)
    sc.parts.append(f'<path d="{d}" fill="none" stroke="{C["navy"]}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>')
    sc.parts.append(f'<path d="{d}" fill="none" stroke="{C["mint"]}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
    ex, ey = a[-1]
    sc.extend(ex, ey, 40)
    sc.parts.append(f'<path d="M{ex-40:.1f} {ey+6:.1f} L{ex+14:.1f} {ey-18:.1f} L{ex-8:.1f} {ey+36:.1f}Z" fill="{C["navy"]}"/>')
    sc.particles([(-240, -170, 520, 9), (240, 120, 460, 8), (60, -180, 620, 8)])
    return sc.svg('Bars of increasing height and a rising chart on a platform')


def mentor():
    sc = Scene(cy=620)
    top = sc.platform(-300, -150, 600, 330)
    # Board on a stand, with a dashboard: header, chart bars, text.
    sc.box(-45, -95, top, 26, 26, 60, top=C['steel'], xface=C['navy2'], yface=C['navy'], edge=False)
    sc.box(-90, -120, top, 110, 60, 14, top=C['light'], xface=C['mid'], yface=C['dark'])
    at = sc.panel(-250, -110, top + 60, 420, 270)
    sc.line(at(0.04, 0.9), at(0.96, 0.9), C['steel'], 16)
    for i, u in enumerate([0.07, 0.11, 0.15]):
        px, py = sc.p(*at(u, 0.9))
        sc.parts.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="4" fill="{[C["blush"], C["mintl"], C["mint"]][i]}"/>')
    sc.bars(lambda u, v: at(0.05 + u * 0.45, v * 0.72), [0.35, 0.6, 0.45, 0.85, 0.7], C['mint'], 12)
    sc.text_lines(lambda u, v: at(0.55 + u * 0.43, v), 5, C['mintl'], 5, top=0.72, step=0.13)
    # Floating glass cards travelling from the board to the desk.
    at2 = sc.glass(150, -40, top + 260, 130, 90)
    sc.text_lines(at2, 3, C['mintl'], 4, top=0.75, step=0.25)
    at3 = sc.glass(220, 10, top + 200, 110, 76)
    sc.text_lines(at3, 2, C['mintl'], 4, top=0.7, step=0.3)
    sc.line((170, -100, top + 250), (200, 110, top + 120), C['mint2'], 4, 'stroke-dasharray="4 14"')
    # Desk with a laptop, books and a stool.
    sc.box(80, 50, top, 200, 30, 90, top=C['light'], xface=C['mid'], yface=C['dark'])  # back leg panel
    sc.box(60, 30, top + 90, 250, 150, 16)
    sc.laptop(90, 90, top + 106, 130, 90)
    for k, (w, col) in enumerate([(90, C['mint']), (84, C['mid']), (78, C['mintl'])]):
        sc.box(235, 50 + k * 3, top + 106 + k * 14, w - 30, 62, 14, top=col, xface=C['light'], yface=C['dark'], edge=False)
    sc.box(200, 110, top, 60, 60, 60, top=C['light'], xface=C['mid'], yface=C['dark'])  # stool, on the platform
    sc.particles([(-280, 160, 300, 9), (260, -150, 420, 8), (60, -200, 520, 8)])
    return sc.svg('A dashboard board sharing notes with a laptop on a desk')


def together():
    sc = Scene(cy=640)
    # Stools behind the table.
    for x, y in [(-230, -60), (-40, -250)]:
        sc.cylinder(x, y, 0, 42, 60, top=C['light'], side=C['dark'])
    sc.ellipse(0, 0, 0, 250, C['ground'], 'opacity=".55"')
    sc.cylinder(0, 0, 0, 36, 90, top=C['mid'], side=C['dark'])  # pedestal
    sc.cylinder(0, 0, 90, 205, 20, top=C['top'], side=C['mid'], rim=C['light'])
    # On the table: two laptops, cups and a mint tray.
    sc.cylinder(-20, 30, 110, 70, 8, top=C['mintl'], side=C['mint2'], rim=C['mint'])
    sc.laptop(-150, 40, 110, 80, 56)
    sc.laptop(60, -120, 110, 80, 56)
    for x, y in [(90, 60), (-60, -110)]:
        sc.cylinder(x, y, 110, 18, 26, top=C['navy'], side=C['light'], rim=C['mint2'])
    # Stools in front.
    for x, y in [(230, 60), (40, 250)]:
        sc.cylinder(x, y, 0, 42, 60, top=C['light'], side=C['dark'])
    # Chat bubbles with an avatar and lines of text.
    bubbles = [(-260, -60, 250, 210, C['top'], C['light']), (40, -240, 310, 230, C['mintl'], C['mint']), (-70, 150, 380, 200, C['top'], C['light'])]
    for x, y, z, w, face, side in bubbles:
        sc.box(x, y, z, w, 14, 130, top=C['steel'], xface=side, yface=face, edge=False)
        px, py = sc.p(x + 40, y + 14, z + 88)
        sc.parts.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="17" fill="{C["navy"]}"/><circle cx="{px:.1f}" cy="{py-4:.1f}" r="6" fill="{C["mintl"]}"/>')
        for i in range(3):
            sc.line((x + 76, y + 14, z + 104 - i * 30), (x + w - 28 - i * 34, y + 14, z + 104 - i * 30), C['navy'], 9)
        sc.poly([(x + 40, y + 14, z), (x + 92, y + 14, z), (x + 26, y + 14, z - 54)], face)
    sc.particles([(-280, 200, 380, 9), (240, -120, 560, 8), (160, 180, 300, 8)])
    return sc.svg('Chat bubbles above a round table with laptops and stools')


if __name__ == '__main__':
    out = sys.argv[1]
    for name, fn in [('curiosity', curiosity), ('distributed', distributed), ('growing', growing), ('mentor', mentor), ('together', together)]:
        with open(os.path.join(out, f'about-{name}.svg'), 'w') as f:
            f.write(fn())
        print('wrote', name)
