#!/usr/bin/env python3
"""
Generate transparent UI marks and separate touch/social presentation assets.

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
    square = Image.open(ROOT / "assets/brand/icon.png").convert("RGBA")
    rounded = Image.open(ROOT / "assets/brand/icon-rounded.png").convert("RGBA")
    print(f"Source: {SOURCE} ({img.width}x{img.height})")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    # --- public/ assets ---
    for size, name in [(24, "logo-24.png"), (80, "logo-80.png"), (32, "favicon.png")]:
        out = PUBLIC / name
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(out, "PNG")
        print(f"  ✓ {out.relative_to(ROOT)} ({size}x{size})")

    # favicon.ico: 16 + 32 multi-size
    img.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
    square.resize((180, 180), Image.LANCZOS).convert("RGB").save(PUBLIC / "apple-touch-icon.png")
    (PUBLIC / "logo.png").write_bytes(SOURCE.read_bytes())

    # OG image: 1200x630, logo centered on brand background
    og = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), OG_BG)
    logo_h = int(OG_HEIGHT * 0.4)
    logo_resized = rounded.resize((logo_h, logo_h), Image.LANCZOS)
    paste_x = (OG_WIDTH - logo_h) // 2
    paste_y = (OG_HEIGHT - logo_h) // 2
    og.paste(logo_resized, (paste_x, paste_y), logo_resized)
    og_path = PUBLIC / "opengraph-image.png"
    og.save(og_path, "PNG")
    print(f"  ✓ {og_path.relative_to(ROOT)} ({OG_WIDTH}x{OG_HEIGHT})")

    print(f"\nDone. Transparent app marks and touch/social presentations generated.")


if __name__ == "__main__":
    main()
