#!/usr/bin/env python3
# 生成 MiNVR 图标（纯标准库，无第三方依赖）
import zlib, struct, os


def write_png(path, w, h, rgba):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        raw.extend(rgba[y * w * 4:(y + 1) * w * 4])
    comp = zlib.compress(bytes(raw), 9)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def make_icon(size):
    w = h = size
    px = bytearray(w * h * 4)

    def setp(x, y, r, g, b, a=255):
        if 0 <= x < w and 0 <= y < h:
            i = (y * w + x) * 4
            px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a

    # 背景：蓝绿渐变
    for y in range(h):
        t = y / (h - 1)
        r = int(30 + (34 - 30) * t)
        g = int(58 + (197 - 58) * t)
        b = int(138 + (94 - 138) * t)
        for x in range(w):
            setp(x, y, r, g, b)

    # 摄像头机身（圆角矩形）
    bw = int(w * 0.60); bh = int(h * 0.40)
    bx = (w - bw) // 2; by = (h - bh) // 2 + int(h * 0.02)
    rad = int(min(bw, bh) * 0.20)
    for y in range(by, by + bh):
        for x in range(bx, bx + bw):
            cx = min(x - bx, bx + bw - 1 - x)
            cy = min(y - by, by + bh - 1 - y)
            if cx < rad and cy < rad:
                d = ((rad - cx) ** 2 + (rad - cy) ** 2) ** 0.5
                if d > rad:
                    continue
            setp(x, y, 245, 248, 253)

    # 镜头
    lr = int(min(bw, bh) * 0.27)
    lx = w // 2; ly = by + bh // 2
    ring = int(size * 0.035)
    for y in range(h):
        for x in range(w):
            d = ((x - lx) ** 2 + (y - ly) ** 2) ** 0.5
            if d <= lr:
                setp(x, y, 59, 130, 246)
            elif d <= lr + ring:
                setp(x, y, 255, 255, 255)
    return px


here = os.path.dirname(os.path.abspath(__file__))
for s, name in [(256, "icon-256.png"), (64, "icon-64.png")]:
    write_png(os.path.join(here, "..", "ui", "images", name), s, s, make_icon(s))
print("icons generated -> ui/images/icon-256.png, icon-64.png")
