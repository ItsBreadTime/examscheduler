#!/usr/bin/env bash
# ============================================================================
# สร้างคู่มือการใช้งานระบบจัดตารางสอบ Exam Scheduler (docs/usage-report.pdf)
# ใช้ LuaLaTeX + latexmk โดยไม่แตะต้อง docs/build.sh หรือ docs/.build/
# ============================================================================
set -euo pipefail

# --- ค้นหารากของ repo (โฟลเดอร์ที่มี .git) -----------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

MAIN="docs/usage-report.tex"
PDF="docs/usage-report.pdf"
BUILD_DIR="${USAGE_BUILD_DIR:-docs/.build-usage}"
TYPESET_SOURCE="${BUILD_DIR}/typeset-source"
LOG="${BUILD_DIR}/latexmk.log"
TEXLOG="${BUILD_DIR}/usage-report.log"

# --- ตรวจสอบไฟล์ที่จำเป็น ----------------------------------------------------
required_files=(
  "${MAIN}"
  "docs/usage-report/style.tex"
  "docs/usage-report/chapters/ch01-start.tex"
  "docs/usage-report/chapters/ch02-prepare.tex"
  "docs/usage-report/chapters/ch03-import.tex"
  "docs/usage-report/chapters/ch04-read.tex"
  "docs/usage-report/chapters/ch05-edit.tex"
  "docs/usage-report/chapters/ch06-check.tex"
  "docs/usage-report/chapters/ch07-export.tex"
  "docs/usage-report/chapters/ch08-cloud.tex"
  "docs/usage-report/chapters/ch09-troubleshoot.tex"
  "docs/usage-report/chapters/appendix-a-fields.tex"
  "docs/usage-report/chapters/appendix-b-samples.tex"
  "docs/usage-report/chapters/appendix-c-glossary.tex"
  "docs/usage-report/chapters/appendix-d-quickref.tex"
  "docs/usage-report/branding/fitm-logo.png"
  "docs/usage-report/branding/kmutnb-logo.png"
  "docs/fonts/Sarabun-Regular.ttf"
  "docs/fonts/Sarabun-Bold.ttf"
  "docs/fonts/Sarabun-Italic.ttf"
  "docs/fonts/Sarabun-BoldItalic.ttf"
  "docs/fonts/CommitMono-400-Regular.otf"
  "docs/fonts/CommitMono-700-Regular.otf"
  "docs/fonts/CommitMono-400-Italic.otf"
  "docs/fonts/CommitMono-700-Italic.otf"
)

missing=0
for f in "${required_files[@]}"; do
  if [[ ! -f "${f}" ]]; then
    echo "ERROR: missing required file: ${f}" >&2
    missing=1
  fi
done

if [[ "${missing}" -eq 1 ]]; then
  echo "Cannot build: required files are missing." >&2
  exit 1
fi

# --- ตรวจสอบเครื่องมือ --------------------------------------------------------
for tool in lualatex latexmk; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "ERROR: required tool not found: ${tool}" >&2
    exit 1
  fi
done

# --- สร้างไดเรกทอรีชั่วคราว --------------------------------------------------
mkdir -p "${BUILD_DIR}"

# Keep the reported Thai words intact and forbid character-level code wrapping.
python3 "docs/usage-report/test-thai-typesetting.py"

# --- สร้างสำเนา TeX สำหรับตัดบรรทัดภาษาไทยตามพจนานุกรม ----------------------
# ต้นฉบับไม่ถูกแก้ไข: สคริปต์เพิ่มจุดตัดบรรทัดเฉพาะระหว่างคำภาษาไทย
rm -rf "${TYPESET_SOURCE}"
python3 "docs/usage-report/prepare-thai-typesetting.py" "${TYPESET_SOURCE}"

# --- ล้างผลลัพธ์เก่า (เฉพาะไดเรกทอรีชั่วคราว) ---------------------------------
rm -f "${BUILD_DIR}"/*.aux "${BUILD_DIR}"/*.log "${BUILD_DIR}"/*.out \
      "${BUILD_DIR}"/*.toc "${BUILD_DIR}"/*.lof "${BUILD_DIR}"/*.lot \
      "${BUILD_DIR}"/*.fls "${BUILD_DIR}"/*.fdb_latexmk

# --- รัน latexmk ด้วย LuaLaTeX (ในไดเรกทอรีชั่วคราว) --------------------------
# ใช้ -output-directory เพื่อให้ไฟล์กลางทั้งหมดอยู่ใน docs/.build-usage/
# และ -jobname เพื่อให้ชื่อไฟล์กลางตรงกับชื่อหลัก
echo "==> Running latexmk (LuaLaTeX) ..."
latexmk -pdf -lualatex \
  -interaction=nonstopmode \
  -halt-on-error \
  -output-directory="${BUILD_DIR}" \
  -jobname=usage-report \
  "${TYPESET_SOURCE}/docs/usage-report.tex" > "${LOG}" 2>&1 || {
    echo "ERROR: latexmk failed. See ${LOG} and ${TEXLOG}" >&2
    tail -n 40 "${LOG}" >&2
    exit 1
  }

# --- ตรวจสอบว่า PDF ถูกสร้างจริง ---------------------------------------------
BUILT_PDF="${BUILD_DIR}/usage-report.pdf"
if [[ ! -f "${BUILT_PDF}" ]]; then
  echo "ERROR: build did not produce ${BUILT_PDF}" >&2
  exit 1
fi

# --- คัดลอก PDF ไปยัง docs/usage-report.pdf ----------------------------------
if grep -Eq 'Overfull \\[hv]box|Missing character:|There were undefined references' "${TEXLOG}"; then
  echo "ERROR: typesetting quality checks failed. See ${TEXLOG}" >&2
  exit 1
fi
cp "${BUILT_PDF}" "${PDF}"

echo "==> Build succeeded."
echo "    PDF: ${PDF}"
echo "    Build log: ${LOG}"
echo "    TeX log: ${TEXLOG}"

# --- ตรวจสอบจำนวนหน้า --------------------------------------------------------
if command -v pdfinfo >/dev/null 2>&1; then
  pages=$(pdfinfo "${PDF}" 2>/dev/null | awk '/^Pages:/{print $2}')
  echo "    Pages: ${pages}"
fi
