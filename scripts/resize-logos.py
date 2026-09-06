#!/usr/bin/env python3
"""Generate Dove application assets from the adopted family masters.

Run with: uv run --with pillow python scripts/resize-logos.py
The transparent source, square tile and rounded tile share one composition.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/client/public/logo.png"
BRAND = ROOT / "assets" / "brand"


def save_png(image: Image.Image, relative: str, size: int) -> None:
    destination = ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(destination, "PNG")
    print(f"  {relative}: {size}x{size}")


def main() -> None:
    foreground = Image.open(SOURCE).convert("RGBA")
    square = Image.open(BRAND / "icon.png").convert("RGBA")
    rounded = Image.open(BRAND / "icon-rounded.png").convert("RGBA")
    if foreground.size != (2048, 2048) or square.size != foreground.size or rounded.size != foreground.size:
        raise ValueError("All approved brand masters must share their 2048-square framing")
    if square.getchannel("A").getextrema() != (255, 255) or rounded.getpixel((0, 0))[3] != 0:
        raise ValueError("Square and rounded master roles are inconsistent")
    save_png(rounded, "src/client/public/logo-24.png", 24)
    save_png(rounded, "src/client/public/logo-80.png", 80)

    ico_path = ROOT / "src/client/public/favicon.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    square.save(ico_path, format="ICO", sizes=ico_sizes)
    with Image.open(ico_path) as icon:
        if icon.ico.sizes() != set(ico_sizes):
            raise ValueError("Favicon is missing an expected embedded resolution")
    print(f"  {ico_path.relative_to(ROOT)}: 16+32+48 ICO, verified")

    og = Image.new("RGB", (1200, 630), (15, 15, 15))
    logo_size = round(630 * 0.4)
    mark = rounded.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    og.paste(mark, ((1200 - logo_size) // 2, (630 - logo_size) // 2), mark)
    og_path = ROOT / "src/client/public/opengraph-image.png"
    og_path.parent.mkdir(parents=True, exist_ok=True)
    og.save(og_path, "PNG")
    print(f"  {og_path.relative_to(ROOT)}: 1200x630")


if __name__ == "__main__":
    main()
