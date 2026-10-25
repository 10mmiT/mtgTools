# Textures, vendored

Pictures the stylesheets paint surfaces with. Self-hosted for the reason
[`../fonts/`](../fonts/) and [`../vendor/`](../vendor/) give: MTG Tools runs
on someone's own server, often with no route out, and a picture fetched from
a third party is a missing surface offline and a note to a stranger online.

| File | What it paints | Source | Licence |
|---|---|---|---|
| `table-wood-dark.webp` | Table mode's board on the dark themes (dark, dusk) | [polyhaven.com/a/dark_wood](https://polyhaven.com/a/dark_wood) | CC0 (Poly Haven, [polyhaven.com/license](https://polyhaven.com/license)), no attribution required |
| `table-wood-light.webp` | Table mode's board on the light themes (light, sepia) | [polyhaven.com/a/oak_veneer_01](https://polyhaven.com/a/oak_veneer_01) | CC0 (Poly Haven, [polyhaven.com/license](https://polyhaven.com/license)), no attribution required |

Each is the diffuse (colour) map only, 1024×1024, re-encoded as WebP to keep
the pair under 300KB. The high-contrast theme paints no texture.

They are named by `--table-wood-img` in each palette of
[`../css/tokens.css`](../css/tokens.css) and tiled across the board by
`.table-plane` in [`../css/table.css`](../css/table.css). Both files are
served by the app's ordinary static mount, behind the sign-in — only table
mode, which is behind it too, ever asks for them. `test/offline.test.js`
fails if a stylesheet names a file that is not here.
