<script lang="ts">
  import { t } from './i18n.svelte.ts';
  import { SHOW_PROCTORS, SHOW_ROOMS, SHOW_RESOURCES } from './flags.ts';
  import Icon from './Icon.svelte';
  import fitmLogo from '../assets/fitm-logo.png';
  import kmutnbLogo from '../assets/kmutnb-logo.svg';

  type HelpSection = 'guide' | 'format' | 'samples' | 'troubleshoot';
  type SampleId = 'courses' | 'rules' | 'rooms' | 'proctors';

  const sections: { id: HelpSection; icon: string; en: string; th: string }[] = [
    { id: 'guide', icon: 'review', en: 'How it works', th: 'วิธีใช้งาน' },
    { id: 'format', icon: 'file', en: 'Input format', th: 'รูปแบบข้อมูล' },
    { id: 'samples', icon: 'table', en: 'Synthetic samples', th: 'ตัวอย่างข้อมูล' },
    { id: 'troubleshoot', icon: 'alert', en: 'Troubleshooting', th: 'แก้ปัญหา' },
  ];

  const workflow = [
    {
      icon: 'upload',
      en: 'Add sources and choose their roles',
      th: 'เพิ่มไฟล์และเลือกประเภทของไฟล์',
      detailEn: 'Upload one or more course files, then mark each as Managed or Context. Managed courses are candidates for central scheduling; Context courses keep imported timings as evidence.',
      detailTh: 'อัปโหลดไฟล์รายวิชา แล้วเลือกว่าแต่ละไฟล์จะให้ระบบจัดอัตโนมัติ หรือจัดเวลาไว้แล้ว วิชาที่จะจัดอัตโนมัติจะเป็นรายการที่ตัวจัดตารางสอบพิจารณา ส่วนวิชาที่จัดไว้แล้วจะคงเวลาสอบจากไฟล์ต้นทางตามเดิม',
    },
    {
      icon: 'review',
      en: 'Review before generating',
      th: 'ตรวจสอบก่อนจัดตาราง',
      detailEn: 'Read source findings, academic terms, imported timings and calendar restrictions. Contradictions stay visible so a successful run never disguises bad input.',
      detailTh: 'อ่านข้อค้นพบ ภาคการศึกษา เวลาสอบเดิม และข้อจำกัดของปฏิทิน ข้อมูลที่ขัดแย้งจะยังแสดงอยู่เสมอ เพื่อไม่ให้การจัดตารางสำเร็จกลบปัญหาของข้อมูลต้นทาง',
    },
    {
      icon: 'calendar',
      en: 'Generate and resolve the remainder',
      th: 'จัดตารางและตรวจรายการที่เหลือ',
      detailEn: 'Set midterm and final periods, then generate. The solver places legal timings deterministically and names every required exam that could not be placed.',
      detailTh: 'กำหนดช่วงสอบกลางภาคและปลายภาค แล้วจัดตาราง ตัวจัดตารางจะเลือกเวลาที่ถูกต้องแบบทำซ้ำได้ และระบุวิชาที่ต้องจัดแต่ยังจัดไม่ได้ทุกวิชา',
    },
    {
      icon: 'lock',
      en: 'Validate, adjust, and share',
      th: 'ตรวจสอบ แก้ไข และแชร์',
      detailEn: 'Use Overview, Exams, Issues, Rooms and Proctors to verify the result. Managed timings can be edited through the validator; save or share only when the result is understood.',
      detailTh: 'ใช้หน้าภาพรวม รายวิชา ข้อควรตรวจสอบ ห้องสอบ และผู้คุมสอบเพื่อตรวจผล เวลาของวิชาที่จัดอัตโนมัติแก้ไขได้ผ่านตัวตรวจสอบ แล้วจึงบันทึกหรือแชร์เมื่อเข้าใจผลแล้ว',
    },
  ];

  // With resources hidden (flags.ts) the final stage points at the views that remain.
  const workflowShown = workflow.map(step => {
    if (step.icon !== 'lock' || (SHOW_PROCTORS && SHOW_ROOMS)) return step;
    const viewsEn = ['Overview', 'Exams', 'Issues'].concat(SHOW_ROOMS ? ['Rooms'] : []).concat(SHOW_PROCTORS ? ['Proctors'] : []);
    const viewsTh = ['ภาพรวม', 'รายวิชา', 'ข้อควรตรวจสอบ'].concat(SHOW_ROOMS ? ['ห้องสอบ'] : []).concat(SHOW_PROCTORS ? ['ผู้คุมสอบ'] : []);
    return { ...step, detailEn: `Use ${viewsEn.slice(0, -1).join(', ')} and ${viewsEn[viewsEn.length - 1]} to verify the result. Managed timings can be edited through the validator; save or share only when the result is understood.`, detailTh: `ใช้${viewsTh.slice(0, -1).join(' ')} และ${viewsTh[viewsTh.length - 1]}เพื่อตรวจผล เวลาของวิชาที่จัดอัตโนมัติแก้ไขได้ผ่านตัวตรวจสอบ แล้วจึงบันทึกหรือแชร์เมื่อเข้าใจผลแล้ว` };
  });

  const samples: { id: SampleId; icon: string; en: string; th: string; formatEn: string; formatTh: string; fileName: string; content: string }[] = [
    {
      id: 'courses',
      icon: 'table',
      en: 'Course source',
      th: 'ไฟล์รายวิชา',
      formatEn: 'Flat CSV: the same headers also work in XLSX',
      formatTh: 'CSV แบบตารางแบน ใช้หัวคอลัมน์เดียวกันใน XLSX ได้',
      fileName: 'ตัวอย่างข้อมูล.csv',
      content: `courseCode,courseName,sectionNumber,studentGroups,midtermDate,midtermTime,finalDate,finalTime,plannedEnrollment,registeredEnrollment,instructors,teachingDay,teachingTime,teachingRoom
010100001,Calculus I,1,"SCI-01;SCI-02",,,2026-10-15,09:00-12:00,120,118,"Dr. Araya",Mon,09:00-12:00,SCI-101
010100002,Academic Writing,1,ART-01,2026-08-20,09:00-12:00,,,80,78,"Dr. Mali",Tue,13:00-15:00,LIB-204
010100003,Introduction to Design,1,"DES-01;DES-02",,,,,60,59,"Dr. Narin",Wed,09:00-12:00,STU-12`,
    },
    {
      id: 'rules',
      icon: 'alert',
      en: 'Scheduling rules',
      th: 'เงื่อนไขการสอบ',
      formatEn: 'CSV or spreadsheet with the university rule headers',
      formatTh: 'CSV หรือสเปรดชีตที่ใช้หัวคอลัมน์เงื่อนไขของมหาวิทยาลัย',
      fileName: 'ตัวอย่างข้อมูล.csv',
      content: `ไม่มีสอบกลางภาค,ไม่มีสอบปลายภาค,ไม่มีสอบ,สอบสองช่วง,สอบตรงกัน
,,,,010100001,010100002
010100003,,,,`,
    },
    {
      id: 'rooms',
      icon: 'calendar',
      en: 'Rooms reference',
      th: 'ข้อมูลห้องสอบ',
      formatEn: 'CSV or spreadsheet; จำนวนคน is the provisional proctor count',
      formatTh: 'CSV หรือสเปรดชีต โดยจำนวนคนคือจำนวนผู้คุมสอบเบื้องต้น',
      fileName: 'ตัวอย่างข้อมูล.csv',
      content: `ห้อง,แถว,จำนวนคน,คอม
SCI-101,A,2,ไม่ใช่
LAB-201,B,1,ใช่`,
    },
    {
      id: 'proctors',
      icon: 'groups',
      en: 'Proctor roster',
      th: 'รายชื่อผู้คุมสอบ',
      formatEn: 'Roster CSV or workbook; date columns pair with the time row below the header',
      formatTh: 'CSV หรือเวิร์กบุกรายชื่อ โดยคอลัมน์วันที่ใช้คู่กับแถวช่วงเวลาที่อยู่ใต้หัวตาราง',
      fileName: 'ตัวอย่างข้อมูล.csv',
      content: `กรรมการ,เพศ,คอม,สถานะ,จ. 17/08/69,อ. 18/08/69
,,,,9-12,13-16
อ.สมศรี,หญิง,ใช่,ปกติ,ว่าง,ว่าง
อ.สมหญิง,หญิง,ไม่ใช่,ปกติ,ว่าง,ไม่ว่าง`,
    },
  ];

  let activeSection = $state<HelpSection>('guide');
  let selectedSampleId = $state<SampleId>('courses');
  let copied = $state<SampleId | 'error' | ''>('');
  const visibleSamples = samples
    .map(sample => sample.id === 'rooms' && !SHOW_PROCTORS ? { ...sample, formatEn: 'CSV or spreadsheet with the university room headers', formatTh: 'CSV หรือสเปรดชีตที่ใช้หัวคอลัมน์ห้องสอบของมหาวิทยาลัย' } : sample)
    .filter(sample => (SHOW_PROCTORS || sample.id !== 'proctors') && (SHOW_ROOMS || sample.id !== 'rooms'));

  const guardrailSample = (() => {
    const partsEn = ['course codes', 'groups', 'dates'];
    const partsTh = ['รหัสวิชา', 'กลุ่ม', 'วันที่'];
    if (SHOW_ROOMS) { partsEn.push('room names'); partsTh.push('ห้อง'); }
    if (SHOW_PROCTORS) { partsEn.push('staff names'); partsTh.push('ชื่อผู้คุม'); }
    return { en: `The example ${partsEn.join(', ')} are invented. Real source conflicts should remain visible for review.`, th: `${partsTh.join(' ')}ในตัวอย่างเป็นข้อมูลสมมติ ปัญหาที่เกิดจากข้อมูลจริงควรแสดงไว้ให้ตรวจสอบ` };
  })();

  async function copySample(sample: typeof samples[number]) {
    try {
      await navigator.clipboard.writeText(sample.content);
      copied = sample.id;
      window.setTimeout(() => { if (copied === sample.id) copied = ''; }, 1800);
    } catch {
      copied = 'error';
    }
  }

  function downloadSample(sample: typeof samples[number]) {
    const blob = new Blob([sample.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sample.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function parseCsv(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (inQuotes) {
        if (c === '"') {
          if (content[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else { field += c; }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.map(r => r.map(c => c.trim()));
  }

  type TableCell = { text: string; colSpan?: number };
  type TableSpec = { head: TableCell[]; body: TableCell[][] };

  function padRow(row: string[], width: number): string[] {
    const out = row.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  }

  // The sample files are not all plain rectangles: the roster has a time band that
  // belongs in the date column headers, and the rules file groups every code after the
  // "ตรงกัน" column into one same-time cell. Convert the parsed CSV into a clean table.
  function tableSpec(sample: typeof samples[number]): TableSpec {
    const rows = parseCsv(sample.content);
    if (!rows.length || !rows[0].length) return { head: [], body: [] };
    const header = rows[0];
    const width = Math.max(...rows.map(r => r.length));

    // Two-row header (proctor roster): the second row is a time band under the date columns.
    const second = rows[1];
    if (second && second.length === header.length) {
      const leadEmpty = second.findIndex(c => c);
      if (leadEmpty > 0 && second.slice(leadEmpty).some(Boolean)) {
        const head = header.map((text, c) => ({ text: second[c] ? `${text} (${second[c]})` : text }));
        return { head, body: rows.slice(2).map(r => padRow(r, width).map(text => ({ text }))) };
      }
    }

    // Same-time group (rules): every cell at/after the ตรงกัน column is one same-time group.
    const sameIdx = header.findIndex(h => h.includes('ตรงกัน'));
    const isRules = sameIdx >= 0;
    const head = header.map(text => ({ text }));
    const body = rows.slice(1).map(r => {
      if (isRules) {
        const cells: TableCell[] = [];
        for (let c = 0; c < sameIdx; c++) cells.push({ text: r[c] ?? '' });
        cells.push({ text: r.slice(sameIdx).filter(Boolean).join(', '), colSpan: Math.max(1, r.length - sameIdx) });
        return cells;
      }
      return padRow(r, width).map(text => ({ text }));
    });
    return { head, body };
  }
</script>

<section class="view help-view" aria-labelledby="help-title">
  <div class="heading-row help-heading">
    <div>
      <h1 id="help-title">{t('How Exam Scheduler works', 'วิธีทำงานของตัวจัดตารางสอบ')}</h1>
      <p class="lede">{t('A short field guide to the workflow, input contract and fictional files you can use to test a setup.', 'คู่มือสั้น ๆ สำหรับขั้นตอนการทำงาน รูปแบบข้อมูล และไฟล์สมมติสำหรับทดลองตั้งค่า')}</p>
      <div class="help-institution">
        <img class="help-inst-logo" src={fitmLogo} alt="FITM" />
        <img class="help-inst-logo kmutnb" src={kmutnbLogo} alt="KMUTNB" />
        <p>{t('Faculty of Industrial Technology and Management · King Mongkut’s University of Technology North Bangkok', 'คณะเทคโนโลยีอุตสาหกรรมและการจัดการ · มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ')}</p>
      </div>
    </div>
    <span class="count-label"><Icon name="lock" size={13} /> {t('Always available', 'เปิดดูได้เสมอ')}</span>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <nav class="help-tabs" role="tablist" aria-label={t('Help sections', 'หมวดคู่มือ')}>
      {#each sections as section (section.id)}
        <button class="help-tab" id={`help-tab-${section.id}`} class:active={activeSection === section.id} type="button" role="tab" aria-selected={activeSection === section.id} aria-controls={`help-panel-${section.id}`} onclick={() => activeSection = section.id}>
          <Icon name={section.icon} size={16} />{t(section.en, section.th)}
        </button>
      {/each}
  </nav>

    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section class="help-section" id="help-panel-guide" role="tabpanel" tabindex="0" aria-labelledby="help-tab-guide" hidden={activeSection !== 'guide'}>
      <div class="section-heading"><h2 id="guide-section-title">{t('From source files to a trustworthy timetable', 'จากไฟล์ต้นทางสู่ตารางสอบที่ตรวจสอบได้')}</h2><span class="count-label">4 {t('stages', 'ขั้นตอน')}</span></div>
      <p class="muted help-intro">{t('The app keeps the evidence trail intact: imported facts, generated timings and manual locks remain distinguishable in every view.', 'แอปจะเก็บร่องรอยหลักฐานไว้ครบ ข้อมูลนำเข้า เวลาที่จัด และเวลาที่ล็อกเองจะแยกจากกันในทุกหน้า')}</p>
      <ol class="help-flow">
        {#each workflowShown as step, index}
          <li class="help-step">
            <span class="help-step-marker" aria-hidden="true">{index + 1}</span>
            <div class="help-step-copy"><div class="help-step-title"><Icon name={step.icon} size={18} /><h3>{t(step.en, step.th)}</h3></div><p>{t(step.detailEn, step.detailTh)}</p></div>
          </li>
        {/each}
      </ol>
      <div class="help-guardrail"><Icon name="lock" size={18} /><div><strong>{t('Local-first by design', 'ออกแบบให้ประมวลผลในเครื่องเป็นหลัก')}</strong><p>{t('Files are processed in this browser. They do not leave it until you explicitly save or share a project.', 'ไฟล์จะถูกประมวลผลในเบราว์เซอร์นี้ และจะไม่ออกจากเครื่องจนกว่าคุณจะสั่งบันทึกหรือแชร์โครงการ')}</p></div></div>
    </section>
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section class="help-section" id="help-panel-format" role="tabpanel" tabindex="0" aria-labelledby="help-tab-format" hidden={activeSection !== 'format'}>
        <div class="section-heading"><h2 id="format-section-title">{t('Input format', 'รูปแบบข้อมูลนำเข้า')}</h2><span class="count-label">{t('Required + optional', 'จำเป็น + เสริม')}</span></div>
        <p class="muted help-intro">{t('The reader accepts XLSX, XLS, CSV, TSV, XLSM, XLSB, ODS and FODS. A file extension alone does not make an arbitrary layout recognizable.', 'ตัวอ่านรองรับ XLSX, XLS, CSV, TSV, XLSM, XLSB, ODS และ FODS แต่ส่วนขยายไฟล์เพียงอย่างเดียวไม่ได้ทำให้ตารางรูปแบบใด ๆ ใช้งานได้')}</p>
        <div class="help-format-layout">
          <section class="panel help-contract-panel">
            <h3>{t('Course source', 'ไฟล์รายวิชา')}</h3>
            <p class="muted">{t('Use these exact flat-table headers, or the supplied Thai university export.', 'ใช้หัวคอลัมน์ของตารางแบนตามนี้ หรือใช้รูปแบบส่งออกของมหาวิทยาลัย')}</p>
            <dl class="help-definitions">
              <div><dt>{t('Required', 'จำเป็น')}</dt><dd><code>courseCode</code>, <code>courseName</code>, <code>sectionNumber</code>, <code>studentGroups</code></dd></div>
              <div><dt>{t('Exam timing', 'เวลาสอบ')}</dt><dd><code>midtermDate</code> + <code>midtermTime</code>; <code>finalDate</code> + <code>finalTime</code></dd></div>
              <div><dt>{t('Optional teaching data', 'ข้อมูลการสอนเสริม')}</dt><dd><code>plannedEnrollment</code>, <code>registeredEnrollment</code>, <code>instructors</code>, <code>teachingDay</code>, <code>teachingTime</code>, <code>teachingRoom</code></dd></div>
            </dl>
          </section>
          <section class="panel help-contract-panel">
            <h3>{t('Roles and references', 'ประเภทไฟล์และไฟล์เสริม')}</h3>
            <dl class="help-definitions">
              <div><dt>{t('Managed', 'จัดอัตโนมัติ')}</dt><dd>{t('The scheduler may generate a timing for this course. Missing student groups can block conflict checking.', 'ระบบจะจัดเวลาสอบให้วิชาในไฟล์นี้โดยอัตโนมัติ หากไม่มีกลุ่มนักศึกษาอาจตรวจสอบความขัดแย้งไม่ได้')}</dd></div>
              <div><dt>{t('Context', 'จัดไปแล้ว')}</dt><dd>{t('Imported timings are preserved as context and are not new scheduling tasks.', 'คงเวลาสอบที่จัดไว้แล้วตามไฟล์ต้นทาง และไม่สร้างงานจัดตารางใหม่')}</dd></div>
              <div><dt>{([t('Rules', 'เงื่อนไขการสอบ')].concat(SHOW_ROOMS ? [t('Rooms', 'ข้อมูลห้องสอบ')] : []).concat(SHOW_PROCTORS ? [t('Proctor roster', 'รายชื่อผู้คุมสอบ')] : [])).join(' / ')}</dt><dd>{t('Optional files follow the supplied university headers. See the synthetic samples for a concrete shape.', 'ไฟล์เสริมใช้หัวคอลัมน์ตามรูปแบบของมหาวิทยาลัย ดูตัวอย่างข้อมูลเพื่อเห็นรูปแบบจริง')}</dd></div>
            </dl>
          </section>
        </div>
        <section class="panel help-notes-panel">
          <h3>{t('Values the reader can parse', 'ค่าที่ตัวอ่านรองรับ')}</h3>
          <div class="help-note-grid">
            <p><strong>{t('Dates', 'วันที่')}</strong>{t('ISO dates, Thai DD/MM/YY Buddhist dates, full Buddhist or Gregorian years, and Excel date cells.', 'วันที่ ISO วันที่พุทธศักราชแบบ DD/MM/YY ปีพุทธศักราชหรือคริสต์ศักราชเต็ม และเซลล์วันที่ของ Excel')}</p>
            <p><strong>{t('Times', 'เวลา')}</strong>{t('Intervals such as 09:00-12:00 or 9.00-12.00. Start and end are required together for an imported exam timing.', 'ช่วงเวลา เช่น 09:00-12:00 หรือ 9.00-12.00 เวลาสอบที่นำเข้าต้องมีเวลาเริ่มและสิ้นสุดคู่กัน')}</p>
            <p><strong>{t('Course codes', 'รหัสวิชา')}</strong>{t('Exactly nine digits, kept as text. Leading zeroes are reported when a spreadsheet has already removed them.', 'ตัวเลขเก้าหลักพอดีและเก็บเป็นข้อความ ระบบจะแจ้งเมื่อสเปรดชีตลบเลขศูนย์ด้านหน้าไปแล้ว')}</p>
            <p><strong>{t('Student groups', 'กลุ่มนักศึกษา')}</strong>{t('Separate multiple groups with line breaks, commas or semicolons. Duplicates and spacing are normalized.', 'แยกหลายกลุ่มด้วยขึ้นบรรทัดใหม่ จุลภาค หรืออัฒภาค ระบบจะจัดรูปแบบช่องว่างและลบรายการซ้ำ')}</p>
          </div>
        </section>
        <p class="help-next"><button class="text-button" type="button" onclick={() => activeSection = 'samples'}>{t('Open the synthetic samples', 'เปิดดูตัวอย่างข้อมูล')} <Icon name="arrow" size={14} /></button></p>
      </section>
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section class="help-section" id="help-panel-samples" role="tabpanel" tabindex="0" aria-labelledby="help-tab-samples" hidden={activeSection !== 'samples'}>
        <div class="section-heading"><h2 id="samples-section-title">{t('Synthetic input samples', 'ตัวอย่างไฟล์ข้อมูล')}</h2><span class="count-label">{visibleSamples.length} {t('file shapes', 'รูปแบบไฟล์')}</span></div>
        <p class="muted help-intro">{t('Every value below is fictional. Use these small files to understand the shape of an input; replace them with your real sources before trusting a schedule.', 'ค่าทั้งหมดด้านล่างเป็นข้อมูลสมมติ ใช้ไฟล์ขนาดเล็กเหล่านี้เพื่อทำความเข้าใจรูปแบบ แล้วเปลี่ยนเป็นข้อมูลจริงก่อนเชื่อถือผลตารางสอบ')}</p>
        <div class="sample-switcher" role="tablist" aria-label={t('Synthetic sample types', 'ชนิดของไฟล์ตัวอย่าง')}>
          {#each visibleSamples as sample (sample.id)}
            <button class="sample-tab" id={`sample-tab-${sample.id}`} class:active={selectedSampleId === sample.id} type="button" role="tab" aria-selected={selectedSampleId === sample.id} aria-controls={`sample-panel-${sample.id}`} onclick={() => selectedSampleId = sample.id}><Icon name={sample.icon} size={16} />{t(sample.en, sample.th)}</button>
          {/each}
        </div>
        {#each visibleSamples as sample (sample.id)}
          {@const spec = tableSpec(sample)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <article class="sample-panel" id={`sample-panel-${sample.id}`} role="tabpanel" tabindex="0" aria-labelledby={`sample-tab-${sample.id}`} hidden={selectedSampleId !== sample.id}>
            <div class="sample-heading"><div><h3 id={`selected-sample-title-${sample.id}`}>{t(sample.en, sample.th)}</h3><p class="muted">{t(sample.formatEn, sample.formatTh)}</p></div></div>
            <div class="sample-table-wrap"><table class="sample-table">{#if spec.head.length}<thead><tr>{#each spec.head as cell, i (i)}<th scope="col" colspan={cell.colSpan} class:empty={!cell.text}>{cell.text}</th>{/each}</tr></thead><tbody>{#each spec.body as row, r (r)}<tr>{#each row as cell, c (c)}<td colspan={cell.colSpan} class:empty={!cell.text}>{cell.text}</td>{/each}</tr>{/each}</tbody>{/if}</table></div><div class="sample-actions"><button class="button secondary compact" type="button" onclick={() => copySample(sample)}><Icon name={copied === sample.id ? 'check' : 'copy'} size={15} />{copied === sample.id ? t('Copied', 'คัดลอกแล้ว') : t('Copy sample', 'คัดลอกตัวอย่าง')}</button><button class="button secondary compact" type="button" onclick={() => downloadSample(sample)}><Icon name="download" size={15} />{t('Download CSV', 'ดาวน์โหลด CSV')}</button></div>
            {#if copied === 'error' && selectedSampleId === sample.id}<p class="field-error" role="status">{t('Copy was blocked by this browser. Select the sample text manually.', 'เบราว์เซอร์ไม่อนุญาตให้คัดลอก กรุณาเลือกข้อความตัวอย่างด้วยตนเอง')}</p>{/if}
          </article>
        {/each}
        <div class="help-guardrail sample-guardrail"><Icon name="info" size={18} /><div><strong>{t('Samples are a format reference, not a schedule guarantee', 'ตัวอย่างมีไว้ดูรูปแบบ ไม่ใช่การรับรองผลตาราง')}</strong><p>{t(guardrailSample.en, guardrailSample.th)}</p></div></div>
      </section>
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <section class="help-section" id="help-panel-troubleshoot" role="tabpanel" tabindex="0" aria-labelledby="help-tab-troubleshoot" hidden={activeSection !== 'troubleshoot'}>
        <div class="section-heading"><h2 id="troubleshoot-section-title">{t('Troubleshooting', 'แก้ปัญหาที่พบบ่อย')}</h2><span class="count-label">{t('Evidence first', 'เริ่มจากหลักฐาน')}</span></div>
        <div class="help-troubleshoot">
          <details open><summary><Icon name="alert" size={18} /><span><strong>{t('Why is an exam unscheduled?', 'ทำไมวิชายังจัดไม่ได้')}</strong><small>{t('The solver found no legal candidate in the current data and settings.', 'ตัวจัดตารางไม่พบเวลาที่ถูกต้องจากข้อมูลและการตั้งค่าปัจจุบัน')}</small></span></summary><div><p>{t('Open Issues and read the reason attached to the course. Common causes are missing student groups, contradictory same-time rules, imported conflicts, a locked timing, or no remaining legal interval. An unscheduled result is deliberately visible; it is not silently dropped.', 'เปิดข้อควรตรวจสอบแล้วอ่านสาเหตุของวิชา สาเหตุที่พบบ่อยคือไม่มีกลุ่มนักศึกษา เงื่อนไขสอบพร้อมกันขัดแย้ง เวลานำเข้าชนกัน เวลาที่ล็อกไว้ หรือไม่มีช่วงเวลาที่ถูกต้องเหลืออยู่ รายการที่จัดไม่ได้จะแสดงไว้เสมอและไม่ถูกตัดทิ้ง')}</p></div></details>
          <details><summary><Icon name="info" size={18} /><span><strong>{t('Why is a validation check not checked?', 'ทำไมรายการตรวจสอบจึงขึ้นว่ายังไม่ตรวจ')}</strong><small>{t('The source required for that check was not supplied.', 'ยังไม่ได้ให้ไฟล์ต้นทางที่จำเป็นสำหรับรายการนั้น')}</small></span></summary><div><p>{SHOW_RESOURCES
            ? t('Room and proctor coverage checks need matching reference files. Not checked is different from passed: supply the missing source, import again and run the assignment step before relying on that coverage.', 'การตรวจสอบห้องและผู้คุมต้องมีไฟล์อ้างอิงที่ตรงกัน สถานะยังไม่ตรวจไม่เหมือนผ่าน ให้เพิ่มไฟล์ต้นทาง นำเข้าใหม่ และจัดทรัพยากรก่อนใช้ข้อมูลความครอบคลุมนั้น')
            : t('Not checked means the source that check needs was not supplied; it is not the same as passed. Supply the missing source, import again and rely on the check only after it shows a result.', 'สถานะยังไม่ตรวจหมายถึงยังไม่ได้ให้ไฟล์ต้นทางที่รายการตรวจนั้นต้องใช้ ไม่เหมือนกับผ่าน ให้เพิ่มไฟล์ต้นทาง นำเข้าใหม่ แล้วจึงใช้ผลรายการนั้นเมื่อแสดงผลแล้ว')}</p></div></details>
          <details><summary><Icon name="file" size={18} /><span><strong>{t('Why did the import reject my table?', 'ทำไมการนำเข้าจึงไม่รับตาราง')}</strong><small>{t('Supported extensions still need recognizable headers and values.', 'แม้ส่วนขยายจะรองรับ แต่ต้องมีหัวคอลัมน์และค่าที่อ่านได้')}</small></span></summary><div><p>{t('For a flat course table, start with the four required headers shown in Input format. Keep course codes as nine-digit text, pair every exam date with a time, and use the synthetic samples to compare delimiters and column order.', 'สำหรับตารางรายวิชาแบบแบน ให้เริ่มจากหัวคอลัมน์ที่จำเป็นสี่รายการในรูปแบบข้อมูล เก็บรหัสวิชาเก้าหลักเป็นข้อความ ใส่วันที่สอบคู่กับเวลา และใช้ไฟล์ตัวอย่างเทียบตัวคั่นและลำดับคอลัมน์')}</p></div></details>
        </div>
        <div class="help-guardrail"><Icon name="review" size={18} /><div><strong>{t('When in doubt, follow the evidence trail', 'เมื่อไม่แน่ใจ ให้ตามร่องรอยหลักฐาน')}</strong><p>{t('Issues name their origin and affected course. The Review and Audit views preserve source rows, hashes and validation coverage for the next decision.', 'ข้อควรตรวจสอบจะระบุที่มาและวิชาที่ได้รับผลกระทบ หน้าตรวจสอบข้อมูลและการตรวจสอบจะเก็บแถวต้นทาง แฮช และขอบเขตการตรวจสอบไว้สำหรับการตัดสินใจถัดไป')}</p></div></div>
      </section>
</section>
