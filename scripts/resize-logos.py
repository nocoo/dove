#!/usr/bin/env python3
"""
Generate all derived logo assets from the single-source logo.png.

Usage:
    python3 scripts/resize-logos.py

Requires: Pillow (pip install Pillow)
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
PUBLIC = ROOT / "public"
APP = ROOT / "src" / "app"

# Brand background color for OG image canvas (dark)
OG_BG = (15, 15, 15)
OG_WIDTH, OG_HEIGHT = 1200, 630


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source logo not found: {SOURCE}")

    img = Image.open(SOURCE).convert("RGBA")
    print(f"Source: {SOURCE} ({img.width}x{img.height})")

    PUBLIC.mkdir(exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)

    # --- public/ assets (component <img> references) ---
    for size, name in [(24, "logo-24.png"), (80, "logo-80.png")]:
        out = PUBLIC / name
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(out, "PNG")
        print(f"  ✓ {out.relative_to(ROOT)} ({size}x{size})")

    # --- src/app/ metadata assets (Next.js file-based conventions) ---

    # favicon: icon.png 32x32
    icon = img.resize((32, 32), Image.LANCZOS)
    icon_path = APP / "icon.png"
    icon.save(icon_path, "PNG")
    print(f"  ✓ {icon_path.relative_to(ROOT)} (32x32)")

    # Apple touch icon: 180x180
    apple = img.resize((180, 180), Image.LANCZOS)
    apple_path = APP / "apple-icon.png"
    apple.save(apple_path, "PNG")
    print(f"  ✓ {apple_path.relative_to(ROOT)} (180x180)")

    # favicon.ico: 16 + 32 multi-size
    ico_16 = img.resize((16, 16), Image.LANCZOS)
    ico_32 = img.resize((32, 32), Image.LANCZOS)
    ico_path = APP / "favicon.ico"
    ico_16.save(ico_path, format="ICO", append_images=[ico_32], sizes=[(16, 16), (32, 32)])
    print(f"  ✓ {ico_path.relative_to(ROOT)} (16+32 multi-size)")

    # OG image: 1200x630, logo centered on brand background
    og = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), OG_BG)
    logo_h = int(OG_HEIGHT * 0.4)  # ~40% of canvas height
    logo_resized = img.resize((logo_h, logo_h), Image.LANCZOS)
    # Convert RGBA to RGB for paste with alpha composite
    paste_x = (OG_WIDTH - logo_h) // 2
    paste_y = (OG_HEIGHT - logo_h) // 2
    og.paste(logo_resized, (paste_x, paste_y), logo_resized)  # use alpha as mask
    og_path = APP / "opengraph-image.png"
    og.save(og_path, "PNG")
    print(f"  ✓ {og_path.relative_to(ROOT)} ({OG_WIDTH}x{OG_HEIGHT})")

    print(f"\nDone. {5} assets generated from {SOURCE.name}.")


if __name__ == "__main__":
    main()
