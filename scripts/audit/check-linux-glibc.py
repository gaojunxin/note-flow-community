#!/usr/bin/env python3
"""Reject Linux installers requiring a newer glibc than the supported baseline."""
import argparse
import pathlib
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('bundle_root', type=pathlib.Path)
parser.add_argument('--maximum', default='2.35')
args = parser.parse_args()
maximum = tuple(map(int, args.maximum.split('.')))
packages = list(args.bundle_root.glob('*.deb'))
if not packages:
    parser.error(f'No DEB installers in {args.bundle_root}')
for package in packages:
    with tempfile.TemporaryDirectory(prefix='noteflow-glibc-') as directory:
        subprocess.run(['dpkg-deb', '-x', str(package), directory], check=True)
        binaries = list((pathlib.Path(directory) / 'usr/bin').glob('*'))
        checked = 0
        for binary in binaries:
            if not binary.is_file() or binary.read_bytes()[:4] != b'\x7fELF':
                continue
            result = subprocess.run(['readelf', '--version-info', str(binary)], check=True, capture_output=True, text=True)
            versions = [tuple(map(int, v.split('.'))) for v in re.findall(r'GLIBC_(\d+\.\d+(?:\.\d+)?)', result.stdout)]
            if not versions:
                raise SystemExit(f'{binary.name}: no glibc version information; compatibility unverified')
            required = max(versions)
            checked += 1
            print(f'{package.name}: {binary.name} requires GLIBC_{".".join(map(str, required))}; maximum {args.maximum}')
            if required > maximum:
                raise SystemExit('Linux compatibility check failed. Rebuild on Ubuntu 22.04; do not upgrade the user system libc.')
        if not checked:
            raise SystemExit(f'{package.name}: no ELF executable checked')
