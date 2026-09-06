#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
BUILD_DIR="${REPORT_BUILD_DIR:-docs/.build}"
TYPESET_SOURCE="${BUILD_DIR}/typeset-source"
export REPORT_BUILD_DIR="${BUILD_DIR}"
mkdir -p "${BUILD_DIR}" /tmp/realexamscheduler-tex-cache
export TEXMFVAR=/tmp/realexamscheduler-tex-cache
node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const r=JSON.parse(readFileSync('docs/reproducibility.json','utf8'));
const a=r.application;
// sha256 of the empty string: the recorded delta hash when the tree is clean at HEAD.
const emptyDelta='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const delta=a.git.diffAgainstHeadHash===emptyDelta ? 'clean (tracked application files)' : `\\path{${a.git.diffAgainstHeadHash}}`;
writeFileSync(`${process.env.REPORT_BUILD_DIR ?? 'docs/.build'}/reproducibility.tex`,String.raw`\begin{longtable}{L{3.2cm}L{10cm}}
\caption{สถานะซอฟต์แวร์ที่ใช้อ้างอิง}\label{tab:identity}\\
\toprule รายการ & ค่าที่บันทึก \\\midrule
Git revision & \path{${a.git.head}} \\
Snapshot (UTC) & ${a.capturedAt} \\
Working tree delta & ${delta} \\
Evidence files & ${Object.keys(r.evidence?.files??{}).length} \\\bottomrule
\end{longtable}
`);
JS
python3 docs/usage-report/test-thai-typesetting.py
python3 docs/usage-report/prepare-thai-typesetting.py --technical-report "${TYPESET_SOURCE}"
latexmk -g -lualatex -interaction=nonstopmode -halt-on-error -outdir="${BUILD_DIR}" "${TYPESET_SOURCE}/docs/report.tex" > docs/build-output.log 2>&1
if grep -Eq 'Overfull \\hbox|Missing character:|There were undefined references' "${BUILD_DIR}/report.log"; then
  echo "ERROR: typesetting quality checks failed. See ${BUILD_DIR}/report.log" >&2
  exit 1
fi
if pdftotext "${BUILD_DIR}/report.pdf" - 2>/dev/null | grep -Fq '\-'; then
  echo "ERROR: literal backslash-hyphen sequences found in the rendered PDF" >&2
  exit 1
fi
cp "${BUILD_DIR}/report.pdf" docs/report.pdf
cp "${BUILD_DIR}/report.log" docs/tex-validation.log
