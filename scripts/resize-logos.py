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
PUBLIC = ROOT / "src" / "client" / "public"

# Brand background color for OG image canvas (dark)
OG_BG = (15, 15, 15)
OG_WIDTH, OG_HEIGHT = 1200, 630


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source logo not found: {SOURCE}")

    img = Image.open(SOURCE).convert("RGBA")
    print(f"Source: {SOURCE} ({img.width}x{img.height})")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    # --- public/ assets ---
    for size, name in [(24, "logo-24.png"), (80, "logo-80.png")]:
        out = PUBLIC / name
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(out, "PNG")
        print(f"  ✓ {out.relative_to(ROOT)} ({size}x{size})")

    # favicon.ico: 16 + 32 multi-size
    ico_16 = img.resize((16, 16), Image.LANCZOS)
    ico_32 = img.resize((32, 32), Image.LANCZOS)
    ico_path = PUBLIC / "favicon.ico"
    ico_16.save(ico_path, format="ICO", append_images=[ico_32], sizes=[(16, 16), (32, 32)])
    print(f"  ✓ {ico_path.relative_to(ROOT)} (16+32 multi-size)")

    # OG image: 1200x630, logo centered on brand background
    og = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), OG_BG)
    logo_h = int(OG_HEIGHT * 0.4)
    logo_resized = img.resize((logo_h, logo_h), Image.LANCZOS)
    paste_x = (OG_WIDTH - logo_h) // 2
    paste_y = (OG_HEIGHT - logo_h) // 2
    og.paste(logo_resized, (paste_x, paste_y), logo_resized)
    og_path = PUBLIC / "opengraph-image.png"
    og.save(og_path, "PNG")
    print(f"  ✓ {og_path.relative_to(ROOT)} ({OG_WIDTH}x{OG_HEIGHT})")

    print(f"\nDone. 4 assets generated from {SOURCE.name}.")


if __name__ == "__main__":
    main()
