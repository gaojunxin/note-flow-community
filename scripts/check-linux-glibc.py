#!/usr/bin/env python3
"""Compatibility entry point."""
from pathlib import Path
import runpy
globals().update(runpy.run_path(str(Path(__file__).resolve().parent / 'audit/check-linux-glibc.py'), run_name=__name__))
