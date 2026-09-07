# Dove logo assets

The original animal is retained byte-for-byte. This Refined pass adds the pressed petals background, fine grain, and shallow contact shadows. No image model was called. The transparent foreground keeps its original pose, colors, anatomy, and native canvas.

## Asset roles

| Surface | Asset | Treatment |
| --- | --- | --- |
| README header | `assets/brand/icon-rounded.png` | Selected presentation at 128 px |
| Expanded / collapsed sidebar | `src/client/public/logo-24.png` | Transparent original; both sidebar states |
| App foreground / public original | `src/client/public/logo-80.png; src/client/public/logo.png` | Transparent derivatives and exact copy of canonical root logo.png |
| Browser icons | `src/client/public/favicon.png; favicon.ico` | Transparent 32 px PNG and decoded 16/32 px ICO, linked by the Vite document |
| Apple touch / Open Graph | `src/client/public/apple-touch-icon.png; opengraph-image.png` | Square 180 px touch icon; rounded presentation on the existing 1200 × 630 dark canvas |

Root `logo.png` remains the canonical 2048 × 2048 transparent master. `icon.png` and `icon-rounded.png` in this directory are separate square and rounded presentations at the same native dimensions. Small UI marks use the foreground with no external glow, added background, or circular crop. Localized and package READMEs were checked for additional logo headers.

## Reproduce and verify

```sh
uv run --with pillow python scripts/resize-logos.py
```

The exact source, sampled palette, independent background layers, every export size, and frozen finishing recipe are archived in `nocoo/hexly.ai` under `artwork/logo-family/dove/2026-09-07-03/finishing/01`. [source.json](source.json) records provenance and all master SHA-256 values. The separate UI theme palette is unchanged.

- [Individual logo review](https://hexly.ai/logos/dove)
- [Local static review](https://index.dev.hexly.ai/artwork/logo-family/dove/2026-09-07-03/review.html)
- [Shared logo usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)

Before/after deliberately shares the same original foreground. Verify small marks at their actual displayed sizes on both themes, decode every ICO resolution, and keep any platform-specific mask separate from the transparent source.
