#!/usr/bin/env python3
"""
기본 펫 'Mochi(모찌)' 스프라이트시트 생성기.

Codex 펫 v1 규격을 그대로 따릅니다.
  - 8열 x 9행, 셀 192 x 208 px  ->  1536 x 1872 px
  - 행 순서: idle, running-right, running-left, waving, jumping,
             failed, waiting, running, review
  - 행별 프레임 수: 6, 8, 8, 4, 5, 8, 6, 6, 6

48 x 52 논리 픽셀로 그린 뒤 4배 확대(nearest)해서 픽셀아트 느낌을 유지합니다.
사용법:  python3 tools/make_mochi.py [출력폴더]   (기본: pets/mochi)
필요: Pillow (pip install pillow)
"""
import json
import math
import os
import sys

from PIL import Image

W, H = 48, 52          # 논리 셀 크기
SCALE = 4              # 192 x 208
COLS = 8

ROWS = [
    ("idle", 6),
    ("running-right", 8),
    ("running-left", 8),
    ("waving", 4),
    ("jumping", 5),
    ("failed", 8),
    ("waiting", 6),
    ("running", 6),
    ("review", 6),
]

# ---- 팔레트 -------------------------------------------------------------
OUT = (59, 42, 38, 255)          # 외곽선
BODY = (253, 240, 220, 255)      # 몸통 크림색
SHADE = (240, 214, 182, 255)     # 아래쪽 그늘
HI = (255, 255, 255, 255)        # 하이라이트
CHEEK = (246, 160, 150, 255)
EYE = (42, 29, 26, 255)
LEAF = (217, 119, 87, 255)       # 새싹(테라코타)
LEAF_D = (178, 88, 62, 255)
STEM = (120, 86, 60, 255)
SHADOW = (0, 0, 0, 60)
METAL = (138, 143, 152, 255)
METAL_D = (92, 97, 106, 255)
KEY = (210, 214, 220, 255)
GOLD = (214, 170, 92, 255)
GOLD_D = (160, 120, 60, 255)
LENS = (190, 230, 255, 200)
SWEAT = (130, 200, 255, 255)
SMOKE = (120, 120, 128, 200)
GREEN = (88, 186, 110, 255)
WHITE = (255, 255, 255, 255)
DUST = (200, 190, 175, 180)


class Canvas:
    def __init__(self):
        self.img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.px = self.img.load()

    def put(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H:
            if c[3] < 255:
                # 알파 합성 (그림자/연기용)
                r, g, b, a = self.px[x, y]
                na = c[3] / 255
                if a == 0:
                    self.px[x, y] = c
                else:
                    self.px[x, y] = (
                        int(c[0] * na + r * (1 - na)),
                        int(c[1] * na + g * (1 - na)),
                        int(c[2] * na + b * (1 - na)),
                        max(a, c[3]),
                    )
            else:
                self.px[x, y] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.put(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(H):
            for x in range(W):
                if inside(x, y, cx, cy, rx, ry):
                    self.put(x, y, c)

    def blob(self, cx, cy, rx, ry, fill, outline=OUT, shade=None, hi=None):
        for y in range(H):
            for x in range(W):
                if inside(x, y, cx, cy, rx + 1, ry + 1) and not inside(x, y, cx, cy, rx, ry):
                    self.put(x, y, outline)
        for y in range(H):
            for x in range(W):
                if inside(x, y, cx, cy, rx, ry):
                    col = fill
                    if shade and (y + 0.5 - cy) > ry * 0.42:
                        col = shade
                    self.put(x, y, col)
        if hi:
            self.ellipse(cx - rx * 0.45, cy - ry * 0.5, max(1.2, rx * 0.18), max(1.0, ry * 0.12), hi)

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / max(1, n)
            self.put(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def pattern(self, x0, y0, rows, c):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch == "#":
                    self.put(x0 + i, y0 + j, c)


def inside(x, y, cx, cy, rx, ry):
    if rx <= 0 or ry <= 0:
        return False
    dx = (x + 0.5 - cx) / rx
    dy = (y + 0.5 - cy) / ry
    return dx * dx + dy * dy <= 1.0


# ---- 부위별 그리기 -------------------------------------------------------
SPROUT = [
    "..OO.....OO..",
    ".ODDO...OLLO.",
    "ODDDDO.OLLLLO",
    ".ODDDOSOLLLO.",
    "..OOO.S.OOO..",
    "......S......",
    "......S......",
]
SPROUT_WILT = [
    "......S......",
    "....OOSOO....",
    "...ODDOLLO...",
    "..ODDO.OLLO..",
    "..ODO...OLO..",
    "...O.....O...",
]
SPROUT_COLORS = {"O": OUT, "D": LEAF_D, "L": LEAF, "S": STEM}
QMARK = [" ## ", "#  #", "  # ", " #  ", "    ", " #  "]
CHECK = ["     #", "    ##", "#  ## ", "## ## ", " ###  ", "  #   "]
EXCL = ["#", "#", "#", " ", "#"]


def draw_pet(cv, *, dx=0, dy=0, squash=0, eyes="open", look=(0, 0), mouth="smile",
             arm_l=None, arm_r=None, feet=(0, 0), sprout_tilt=0, wilt=False,
             shadow_scale=1.0, blush=True):
    """squash>0: 납작, squash<0: 길쭉. look: 눈동자 이동 (x,y)."""
    cx, cy = 24 + dx, 32 + dy
    rx, ry = 15 + squash, 13 - squash

    # 그림자 (바닥에 고정)
    cv.ellipse(24 + dx * 0.3, 48.5, 10 * shadow_scale, 1.6 * max(0.5, shadow_scale), SHADOW)

    # 발
    fy = cy + ry - 1
    lf_off, rf_off = feet
    cv.blob(cx - 7 + lf_off, fy + (0 if lf_off == 0 else -1 if lf_off > 0 else 0), 3, 2, BODY, shade=SHADE)
    cv.blob(cx + 7 + rf_off, fy + (0 if rf_off == 0 else -1 if rf_off < 0 else 0), 3, 2, BODY, shade=SHADE)

    # 몸통
    cv.blob(cx, cy, rx, ry, BODY, shade=SHADE, hi=HI)

    # 팔 (작은 동그라미), arm=(x, y) 상대 좌표
    if arm_l is None:
        arm_l = (-rx - 0.5, 2)
    if arm_r is None:
        arm_r = (rx + 0.5, 2)
    if arm_l is not False:
        cv.blob(cx + arm_l[0], cy + arm_l[1], 2.2, 2.2, BODY, shade=None)
    if arm_r is not False:
        cv.blob(cx + arm_r[0], cy + arm_r[1], 2.2, 2.2, BODY, shade=None)

    # 새싹
    top = int(round(cy - ry))
    pat = SPROUT_WILT if wilt else SPROUT
    ph = len(pat)
    for j, row in enumerate(pat):
        # 아래쪽 줄기는 고정, 위쪽 잎은 tilt 만큼 기울어짐
        shift = int(round(sprout_tilt * (ph - 1 - j) / (ph - 1)))
        for i, ch in enumerate(row):
            col = SPROUT_COLORS.get(ch)
            if col:
                cv.put(int(round(cx)) - 6 + i + shift, top - ph + j, col)

    # 얼굴
    ex1, ex2, ey = cx - 5, cx + 5, cy - 2
    lx, ly = look
    if eyes == "open":
        for ex in (ex1, ex2):
            cv.rect(ex - 1 + lx, ey - 1 + ly, ex + lx, ey + 1 + ly, EYE)
            cv.put(ex - 1 + lx, ey - 1 + ly, HI)
    elif eyes == "blink":
        for ex in (ex1, ex2):
            cv.rect(ex - 1, ey + 1, ex + 1, ey + 1, EYE)
    elif eyes == "happy":
        for ex in (ex1, ex2):
            cv.put(ex - 1, ey + 1, EYE)
            cv.put(ex, ey, EYE)
            cv.put(ex + 1, ey + 1, EYE)
    elif eyes == "x":
        for ex in (ex1, ex2):
            cv.put(ex - 1, ey - 1, EYE); cv.put(ex + 1, ey - 1, EYE)
            cv.put(ex, ey, EYE)
            cv.put(ex - 1, ey + 1, EYE); cv.put(ex + 1, ey + 1, EYE)
    elif eyes == "tight":   # 꽉 감은 눈 > <
        cv.put(ex1 - 1, ey - 1, EYE); cv.put(ex1, ey, EYE); cv.put(ex1 - 1, ey + 1, EYE)
        cv.put(ex2 + 1, ey - 1, EYE); cv.put(ex2, ey, EYE); cv.put(ex2 + 1, ey + 1, EYE)
    elif eyes == "down":
        for ex in (ex1, ex2):
            cv.rect(ex - 1, ey + 1, ex, ey + 1, EYE)
            cv.put(ex - 1, ey, EYE); cv.put(ex, ey, EYE)

    if blush:
        cv.rect(ex1 - 3, ey + 3, ex1 - 2, ey + 3, CHEEK)
        cv.rect(ex2 + 2, ey + 3, ex2 + 3, ey + 3, CHEEK)

    mx, my = cx + lx, ey + 4
    if mouth == "smile":
        cv.put(mx - 1, my, EYE); cv.put(mx, my + 1, EYE); cv.put(mx + 1, my, EYE)
    elif mouth == "open":
        cv.rect(mx - 1, my, mx + 1, my + 1, EYE)
    elif mouth == "o":
        cv.put(mx, my, EYE); cv.put(mx - 1, my + 1, EYE); cv.put(mx + 1, my + 1, EYE); cv.put(mx, my + 2, EYE)
    elif mouth == "flat":
        cv.rect(mx - 1, my + 1, mx + 1, my + 1, EYE)
    elif mouth == "wobble":
        cv.put(mx - 2, my + 1, EYE); cv.put(mx - 1, my, EYE); cv.put(mx, my + 1, EYE); cv.put(mx + 1, my, EYE); cv.put(mx + 2, my + 1, EYE)
    return cx, cy, rx, ry


def bubble(cv, x, y, w, h, glyph=None, dots=0):
    cv.rect(x + 1, y, x + w - 2, y, OUT)
    cv.rect(x + 1, y + h - 1, x + w - 2, y + h - 1, OUT)
    cv.rect(x, y + 1, x, y + h - 2, OUT)
    cv.rect(x + w - 1, y + 1, x + w - 1, y + h - 2, OUT)
    cv.rect(x + 1, y + 1, x + w - 2, y + h - 2, WHITE)
    # 꼬리
    cv.put(x + 2, y + h, OUT); cv.put(x + 1, y + h + 1, OUT); cv.put(x + 2, y + h - 1, WHITE)
    if glyph:
        cv.pattern(x + 2, y + 2, glyph, OUT)
    for i in range(dots):
        cv.put(x + 2 + i * 2, y + h // 2, OUT)


def gear(cv, gx, gy, phase):
    """톱니바퀴: phase 짝/홀로 톱니 위치가 45도씩 돌아감"""
    if phase % 2 == 0:
        teeth = [(0, -4), (4, 0), (0, 4), (-4, 0)]
    else:
        teeth = [(3, -3), (3, 3), (-3, 3), (-3, -3)]
    for tx, ty in teeth:
        cv.rect(gx + tx - 1, gy + ty - 1, gx + tx, gy + ty, METAL_D)
    cv.blob(gx - 0.5, gy - 0.5, 3, 3, METAL, outline=METAL_D)
    cv.rect(gx - 1, gy - 1, gx, gy, METAL_D)


def sweat(cv, x, y):
    cv.put(x, y, SWEAT); cv.put(x, y + 1, SWEAT); cv.put(x - 1, y + 2, SWEAT); cv.put(x + 1, y + 2, SWEAT); cv.put(x, y + 2, SWEAT)


def sparkle(cv, x, y, c=WHITE):
    cv.put(x, y, c); cv.put(x - 1, y, c); cv.put(x + 1, y, c); cv.put(x, y - 1, c); cv.put(x, y + 1, c)


# ---- 상태별 프레임 -------------------------------------------------------
def frames_idle():
    out = []
    specs = [
        dict(),
        dict(squash=1, dy=1),
        dict(),
        dict(eyes="blink"),
        dict(look=(-1, 0)),
        dict(look=(1, 0)),
    ]
    for s in specs:
        cv = Canvas(); draw_pet(cv, **s); out.append(cv.img)
    return out


def frames_run_right():
    out = []
    bob = [0, -1, -2, -1, 0, -1, -2, -1]
    feet = [(-2, 2), (-1, 1), (1, -1), (2, -2), (2, -2), (1, -1), (-1, 1), (-2, 2)]
    for i in range(8):
        cv = Canvas()
        swing = 2 if i < 4 else -2
        draw_pet(cv, dy=bob[i], look=(1, 0), feet=feet[i], sprout_tilt=-2,
                 arm_l=(-14.5, 2 + swing * 0.5), arm_r=(14.5, 2 - swing * 0.5), mouth="open" if i % 4 == 2 else "smile")
        if i in (0, 4):
            cv.ellipse(7, 46, 2, 1.2, DUST); cv.ellipse(4, 44, 1.2, 1, DUST)
        out.append(cv.img)
    return out


def frames_waving():
    out = []
    arms = [(14, -6), (12, -10), (14, -6), (12, -10)]
    for i, a in enumerate(arms):
        cv = Canvas()
        draw_pet(cv, eyes="happy", mouth="open", arm_r=a, dy=0 if i % 2 == 0 else -1)
        ax, ay = 24 + a[0], 33 + a[1] + (0 if i % 2 == 0 else -1)
        if i % 2 == 1:
            cv.line(ax + 4, ay - 3, ax + 5, ay - 1, OUT)
            cv.line(ax + 3, ay - 5, ax + 4, ay - 4, OUT)
        out.append(cv.img)
    return out


def frames_jumping():
    specs = [
        dict(squash=2, dy=2, eyes="tight", mouth="flat", shadow_scale=1.1, arm_l=(-15, 4), arm_r=(15, 4)),
        dict(squash=-2, dy=-5, eyes="open", mouth="open", shadow_scale=0.8, arm_l=(-13, -4), arm_r=(13, -4)),
        dict(squash=-1, dy=-10, eyes="happy", mouth="open", shadow_scale=0.6, arm_l=(-13, -8), arm_r=(13, -8), sprout_tilt=0),
        dict(squash=0, dy=-5, eyes="open", mouth="o", shadow_scale=0.8, arm_l=(-14, -2), arm_r=(14, -2)),
        dict(squash=2, dy=1, eyes="happy", mouth="smile", shadow_scale=1.1, arm_l=(-15, 3), arm_r=(15, 3)),
    ]
    out = []
    for i, s in enumerate(specs):
        cv = Canvas(); draw_pet(cv, **s)
        if i == 2:
            sparkle(cv, 8, 12, GOLD); sparkle(cv, 40, 10, GOLD)
        out.append(cv.img)
    return out


def frames_failed():
    out = []
    shake = [1, -1, 1, -1, 0, 0, 0, 0]
    for i in range(8):
        cv = Canvas()
        droop = min(i, 4) // 2
        draw_pet(cv, dx=shake[i], dy=droop, squash=1 if i >= 4 else 0, eyes="x", mouth="wobble",
                 wilt=i >= 2, arm_l=(-14.5, 5), arm_r=(14.5, 5), blush=False)
        sweat(cv, 38 + shake[i], 22 + (i % 4))
        # 연기
        puff_y = 14 - (i % 4) * 2
        if i < 6:
            cv.ellipse(24 + (i % 3) - 1, puff_y, 2.5, 1.8, SMOKE)
            cv.ellipse(27 + (i % 2), puff_y - 3, 1.8, 1.4, SMOKE)
        out.append(cv.img)
    return out


def frames_waiting():
    out = []
    for i in range(6):
        cv = Canvas()
        tap = (0, -1) if i % 2 == 1 else (0, 0)
        draw_pet(cv, look=(1, -1), feet=(0, -1 if i % 2 else 0), mouth="flat",
                 arm_r=(14.5, 1), dy=0)
        by = 4 + (1 if i in (1, 4) else 0)
        if i < 3:
            bubble(cv, 33, by, 8, 9, glyph=QMARK)
        else:
            bubble(cv, 33, by, 10, 7, dots=min(3, i - 2))
        out.append(cv.img)
    return out


def frames_working():
    out = []
    for i in range(6):
        cv = Canvas()
        left_down = i % 2 == 0
        draw_pet(cv, eyes="down", mouth="flat" if i % 3 else "smile", dy=0 if i % 2 else 1, squash=0,
                 arm_l=(-9, 8 if left_down else 6), arm_r=(9, 6 if left_down else 8))
        # 키보드
        cv.rect(12, 43, 36, 46, METAL_D)
        cv.rect(13, 43, 35, 45, METAL)
        for k in range(14, 35, 3):
            cv.put(k, 44, KEY)
        cv.put(14 + (i * 5) % 20, 44, WHITE)
        # 기어
        gear(cv, 39, 14, i)
        if i in (2, 5):
            sweat(cv, 10, 22)
        # 코드 반짝
        cv.put(6 + (i % 3) * 2, 14 - i % 2, LEAF)
        out.append(cv.img)
    return out


def frames_review():
    out = []
    lens_pos = [(-6, 0), (-3, -1), (0, 0), (3, -1), (5, 0), (5, 0)]
    for i in range(6):
        cv = Canvas()
        lxo, lyo = lens_pos[i]
        look = (-1, 0) if lxo < 0 else (1, 0)
        draw_pet(cv, look=look if i < 4 else (0, 0), eyes="open" if i < 4 else "happy",
                 mouth="o" if i < 4 else "open", arm_r=(9 + lxo * 0.3, 5))
        gx, gy = 24 + lxo, 30 + lyo
        cv.line(gx + 3, gy + 3, gx + 7, gy + 8, GOLD_D)
        for y in range(H):
            for x in range(W):
                if inside(x, y, gx, gy, 4.5, 4.5) and not inside(x, y, gx, gy, 3.5, 3.5):
                    cv.put(x, y, GOLD)
                elif inside(x, y, gx, gy, 3.5, 3.5):
                    cv.put(x, y, LENS)
        cv.put(gx - 1, gy - 2, WHITE)
        if i >= 4:
            cv.pattern(36, 8, CHECK, GREEN)
            sparkle(cv, 34, 6 if i == 4 else 5, GOLD)
            sparkle(cv, 44, 16, GOLD)
        out.append(cv.img)
    return out


def build(out_dir):
    rows = {
        "idle": frames_idle(),
        "running-right": frames_run_right(),
        "waving": frames_waving(),
        "jumping": frames_jumping(),
        "failed": frames_failed(),
        "waiting": frames_waiting(),
        "running": frames_working(),
        "review": frames_review(),
    }
    rows["running-left"] = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in rows["running-right"]]

    sheet = Image.new("RGBA", (W * SCALE * COLS, H * SCALE * len(ROWS)), (0, 0, 0, 0))
    for r, (name, count) in enumerate(ROWS):
        frames = rows[name]
        assert len(frames) == count, (name, len(frames), count)
        for c, f in enumerate(frames):
            big = f.resize((W * SCALE, H * SCALE), Image.NEAREST)
            sheet.paste(big, (c * W * SCALE, r * H * SCALE), big)

    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, "spritesheet.webp"), "WEBP", lossless=True, quality=100)
    manifest = {
        "id": "mochi",
        "displayName": "Mochi",
        "description": "말랑한 크림색 모찌에 테라코타 새싹이 돋은 오리지널 픽셀 펫. Claude Code 작업 상태에 반응합니다.",
        "spritesheetPath": "spritesheet.webp",
        "spriteVersionNumber": 1,
    }
    with open(os.path.join(out_dir, "pet.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    return sheet, rows


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "pets", "mochi")
    sheet, rows = build(target)
    # 아이콘
    icon_src = rows["idle"][0].crop((6, 8, 42, 50))  # 36x42
    icon = Image.new("RGBA", (42, 42), (0, 0, 0, 0)); icon.paste(icon_src, (3, 0), icon_src)
    assets = os.path.join(here, "..", "assets")
    os.makedirs(assets, exist_ok=True)
    icon.resize((256, 256), Image.NEAREST).save(os.path.join(assets, "icon.png"))
    icon.resize((32, 32), Image.NEAREST).save(os.path.join(assets, "tray.png"))
    icon.resize((64, 64), Image.NEAREST).save(os.path.join(assets, "tray@2x.png"))
    print("saved", os.path.abspath(target), sheet.size)
