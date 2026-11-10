"""Rebuild the audited Liberation 2.1.5 override; no network or node_modules writes.
Requires fontforge 20230101, fonttools==4.66.1 and brotli==1.2.0.
"""
from pathlib import Path
import hashlib, json, os, subprocess, tempfile
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[2]
vendor = root / 'apps/desktop/public/vendor/fonts/liberation-2.1.5'
upstream = json.loads((vendor / 'upstream.json').read_text())
for record in upstream['files']:
    if hashlib.sha256((vendor / record['path']).read_bytes()).hexdigest() != record['sha256']:
        raise RuntimeError('Upstream source digest mismatch: ' + record['path'])
with tempfile.TemporaryDirectory(prefix='noteflow-liberation-') as temporary:
    source = Path(temporary) / 'LiberationSans-Regular.sfd'
    source.write_bytes((vendor / 'source/src/LiberationSans-Regular.sfd').read_bytes())
    subprocess.run([os.environ.get('FONTFORGE', 'fontforge'), '-script',
                    str(vendor / 'source/scripts/sfd2ttf.pe'), str(source)], check=True)
    font = TTFont(source.with_suffix('.ttf'), recalcTimestamp=False)
    # FontForge stamps the build time. Keep the upstream creation timestamp for
    # both fields so rebuilding the same source/toolchain does not vary by date.
    font['head'].modified = font['head'].created
    font.save(vendor / 'LiberationSans-Regular.ttf')
    font.flavor = 'woff2'
    font.save(vendor / 'LiberationSans-Regular.woff2')
expected = json.loads((vendor / 'build.json').read_text())
for record in expected['outputs']:
    actual = hashlib.sha256((vendor / record['file']).read_bytes()).hexdigest()
    if actual != record['sha256']:
        raise RuntimeError('Output differs from locked toolchain: ' + record['file'])
print('Liberation 2.1.5 source and output digests verified')
