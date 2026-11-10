# Community Liberation Sans override

The community package replaces only Excalidraw's legacy `Liberation/LiberationSans-Regular.woff2` with Liberation Sans Regular 2.1.5. The existing font identifier and runtime path remain unchanged. Other fonts are copied from the locked Excalidraw package as before.

Source: official liberationfonts/liberation-fonts tag `2.1.5`, commit `4b0192046158094654e865245832c66d2104219e`. `upstream.json` records exact source URLs and SHA256. `source/src/LiberationSans-Regular.sfd` is the corresponding editable source for this one generated font. The original license, authors, README, Makefile and conversion script are retained; the upstream Makefile describes the full font family and is provided as reference, while this directory includes only the Regular face source actually used.

License: the unmodified `source/LICENSE` (SIL Open Font License 1.1), including its copyright and reserved font name notices. This license applies to this third-party font; it does not choose the application license. The font license is also emitted beside the runtime WOFF2 and included in the offline cache.

Rebuild from the public repository root:

```sh
# Requires FontForge 20230101 (Ubuntu package 1:20230101~dfsg-1.1build1)
python3 -m venv /tmp/noteflow-font-build
/tmp/noteflow-font-build/bin/pip install fonttools==4.66.1 brotli==1.2.0
/tmp/noteflow-font-build/bin/python scripts/rebuild-community-liberation.py
```

`FONTFORGE` may select the fontforge executable. The script does not download sources or edit node_modules. It verifies checked-in source digests, uses the upstream conversion flags, sets `head.modified` to the original creation timestamp to remove build-clock variation, and checks generated output hashes against `build.json`. Different FontForge builds can produce different binaries; those outputs must be reviewed and intentionally updated rather than silently accepted.

The checked-in TTF is the direct generated intermediate; WOFF2 is its web encoding. Normal application builds consume the checked-in WOFF2 and require no font build tools or network fetch. Existing project/source files remain unchanged. Two consecutive builds with the recorded toolchain produced the same output SHA256.
