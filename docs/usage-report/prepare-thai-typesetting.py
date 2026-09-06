#!/usr/bin/env python3
"""Create a build-only TeX copy with dictionary-safe Thai line breaks.

LuaLaTeX's default Southeast-Asian fallback can split Thai at character-level
boundaries.  libthai supplies real word boundaries; this script adds zero-width
stretchable TeX break opportunities only at those boundaries, leaving manuscript sources
untouched.
"""

from __future__ import annotations

import ctypes
import re
import sys
from pathlib import Path


THAI_RUN = re.compile(r"[\u0e00-\u0e7f]+")
LIBTHAI = "/opt/homebrew/opt/libthai/lib/libthai.dylib"
BREAK = r"\thaiwordbreak{}"


def load_breaker() -> ctypes.CDLL:
    library = ctypes.CDLL(LIBTHAI)
    library.th_brk_find_breaks.argtypes = [
        ctypes.c_void_p,
        ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_int),
        ctypes.c_size_t,
    ]
    library.th_brk_find_breaks.restype = ctypes.c_int
    library.th_brk_new.argtypes = [ctypes.c_char_p]
    library.th_brk_new.restype = ctypes.c_void_p
    return library


def word_breaker(library: ctypes.CDLL):
    breaker = library.th_brk_new(None)
    if not breaker:
        raise RuntimeError("libthai could not load its Thai dictionary")

    def add_breaks(match: re.Match[str]) -> str:
        text = match.group(0)
        encoded = text.encode("tis-620")
        positions = (ctypes.c_int * (len(encoded) + 1))()
        count = library.th_brk_find_breaks(breaker, encoded, positions, len(positions))
        if count <= 0:
            return text
        stops = {positions[index] for index in range(count) if 0 < positions[index] < len(encoded)}
        return "".join(
            bytes([byte]).decode("tis-620") + (BREAK if index + 1 in stops else "")
            for index, byte in enumerate(encoded)
        )

    return lambda text: THAI_RUN.sub(add_breaks, text)


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: prepare-thai-typesetting.py [--technical-report] <build-source-directory>")

    technical_report = len(sys.argv) == 3 and sys.argv[1] == "--technical-report"
    if len(sys.argv) == 3 and not technical_report:
        raise SystemExit(f"unknown option: {sys.argv[1]}")
    destination = Path(sys.argv[-1])
    source_root = Path("docs")
    source_usage = source_root / "usage-report"
    add_breaks = word_breaker(load_breaker())

    sources = (
        [source_root / "report.tex", source_root / "benchmark-summary.tex"]
        if technical_report
        else [source_root / "usage-report.tex", source_usage / "style.tex", *sorted((source_usage / "chapters").glob("*.tex"))]
    )
    for source in sources:
        relative = source.relative_to(source_root)
        target = destination / "docs" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        rendered = add_breaks(source.read_text(encoding="utf-8"))
        if source.name == "usage-report.tex":
            rendered = rendered.replace(
                r"\input{docs/usage-report/",
                rf"\input{{{destination.as_posix()}/docs/usage-report/",
            )
        elif source.name == "report.tex":
            rendered = rendered.replace(
                r"\input{docs/benchmark-summary.tex}",
                rf"\input{{{destination.as_posix()}/docs/benchmark-summary.tex}}",
            )
            rendered = rendered.replace(
                r"\input{docs/.build/reproducibility.tex}",
                rf"\input{{{destination.parent.as_posix()}/reproducibility.tex}}",
            )
        target.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
