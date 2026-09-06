<script lang="ts">
  import type { ProjectInput } from '../lib/project.ts';
  import type { SourceRole } from '../lib/types.ts';
  import { parseShareRef } from '../lib/api.ts';
  import { contentHash, draftSignature } from './draft.ts';
  import { defaultSettings } from '../lib/model.ts';
  import { dates, validDate, weekend } from '../lib/time.ts';
  import { t } from './i18n.svelte.ts';
  import { SHOW_PROCTORS, SHOW_ROOMS } from './flags.ts';
  import { friendlyError, localized, localizedText, type LocalizedText } from './errors.ts';
  import Icon from './Icon.svelte';
  import fitmLogo from '../assets/fitm-logo.png';
  import kmutnbLogo from '../assets/kmutnb-logo.svg';

  let { busy, onimport, ondraft, onopenlink }: { busy: boolean; onimport: (input: ProjectInput) => void; ondraft: (signature: string) => void; onopenlink: (text: string) => void } = $props();
  let sources = $state<{ id: string; file: File; role: SourceRole }[]>([]);
  let rules = $state<File | null>(null);
  let rooms = $state<File | null>(null);
  let proctors = $state<File | null>(null);
  let computerRule = $state(false);
  let settings = $state(defaultSettings({ start: '', end: '' }, { start: '', end: '' }));
  let holidayDate = $state('');
  let error = $state<LocalizedText | null>(null);
  let demo = $state(false);
  let loadingExample = $state(false);
  let linkText = $state('');
  let linkProblem = $state('');
  let courseInput: HTMLInputElement;
  let rulesInput: HTMLInputElement;
  let roomsInput = $state<HTMLInputElement | null>(null);
  let proctorsInput = $state<HTMLInputElement | null>(null);
  const accept = '.xlsx,.xls,.csv,.tsv,.xlsm,.xlsb,.ods,.fods';
  const policies = [{ value: 'only_if_necessary', en: 'Only if necessary', th: 'ใช้เมื่อจำเป็น' }, { value: 'never', en: 'Never', th: 'ไม่ใช้วันเหล่านี้' }, { value: 'normal', en: 'Normal', th: 'ใช้ได้ตามปกติ' }];
  const timeOrderProblem = (interval: { startMinutes: number; endMinutes: number }) => interval.endMinutes > interval.startMinutes ? '' : t('End time must be after the start time.', 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
  let periodProblems = $derived.by(() => {
    const problems: Record<string, string> = {};
    for (const [type, p] of Object.entries(settings.periods)) {
      if (validDate(p.start) && validDate(p.end) && p.start > p.end) problems[type] = t('The end date is before the start date.', 'วันสิ้นสุดอยู่ก่อนวันเริ่ม');
    }
    return problems;
  });
  let sessionProblems = $derived(settings.sessions.map(session => timeOrderProblem(session)));
  let fullDayProblem = $derived(timeOrderProblem(settings.fullDay));
  let complete = $derived(
    sources.some(s => s.role === 'managed') &&
    Object.values(settings.periods).every(p => validDate(p.start) && validDate(p.end) && p.start <= p.end) &&
    settings.sessions.length > 0 && sessionProblems.every(problem => !problem) &&
    !fullDayProblem &&
    Number.isInteger(settings.searchBudget) && settings.searchBudget >= 1 && settings.searchBudget <= 1000000,
  );
  let formHint = $derived.by(() => {
    if (sources.length && !sources.some(s => s.role === 'managed')) return t('Choose at least one managed source.', 'เลือกไฟล์ที่จะให้จัดอัตโนมัติอย่างน้อยหนึ่งไฟล์');
    if (Object.values(settings.periods).some(p => !validDate(p.start) || !validDate(p.end))) return t('Choose a start and end date for both exam periods.', 'เลือกวันเริ่มและวันสิ้นสุดของช่วงสอบทั้งสองช่วง');
    if (Object.keys(periodProblems).length) return t('Fix the highlighted date problems before importing.', 'แก้ไขปัญหาวันที่ที่แสดงก่อนนำเข้า');
    if (sessionProblems.some(Boolean)) return t('Fix the highlighted session times before importing.', 'แก้ไขช่วงเวลาสอบที่แสดงก่อนนำเข้า');
    if (fullDayProblem) return t('Fix the highlighted full-day interval before importing.', 'แก้ไขช่วงเวลาสอบเต็มวันที่แสดงก่อนนำเข้า');
    if (!Number.isInteger(settings.searchBudget) || settings.searchBudget < 1 || settings.searchBudget > 1000000) return t('Set solver effort to a whole number from 1 to 1,000,000 before importing.', 'ตั้งค่าระดับความพยายามเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000 ก่อนนำเข้า');
    return t('Next: review parsed records and source conflicts.', 'ถัดไป: ตรวจสอบข้อมูลและข้อขัดแย้ง');
  });
  let calendarNotices = $derived.by(() => {
    const result: string[] = [];
    for (const [type, p] of Object.entries(settings.periods)) {
      if (!validDate(p.start) || !validDate(p.end) || p.start > p.end) continue;
      try { const all = dates(p.start, p.end); result.push(`${t(type === 'midterm' ? 'Midterm' : 'Final', type === 'midterm' ? 'กลางภาค' : 'ปลายภาค')}: ${all.filter(weekend).length} ${t('weekend days', 'วันเสาร์–อาทิตย์')} · ${all.filter(d => settings.holidays.includes(d)).length} ${t('holidays', 'วันหยุด')}`); } catch { result.push(t('Period exceeds 366 days', 'ช่วงสอบเกิน 366 วัน')); }
    }
    return result;
  });
  const fileHashes = new WeakMap<File, Promise<string>>();
  let changeToken = 0;
  function hashFile(file: File) {
    const cached = fileHashes.get(file);
    if (cached) return cached;
    const hash = file.arrayBuffer().then(bytes => contentHash(new Uint8Array(bytes)));
    fileHashes.set(file, hash);
    return hash;
  }
  async function changed() {
    const token = ++changeToken;
    error = null;
    const currentSources = sources.map(source => ({ file: source.file, role: source.role }));
    const currentRules = rules;
    const currentRooms = rooms;
    const currentProctors = proctors;
    const currentSettings = $state.snapshot({ ...settings, computerProctorRule: computerRule || undefined });
    try {
      const sourceDescriptors = await Promise.all(currentSources.map(async source => ({ name: source.file.name, size: source.file.size, hash: await hashFile(source.file), role: source.role })));
      const rulesDescriptor = currentRules ? { name: currentRules.name, size: currentRules.size, hash: await hashFile(currentRules) } : undefined;
      const references = await Promise.all([
        ...(currentRooms ? [{ file: currentRooms, kind: 'rooms' as const }] : []),
        ...(currentProctors ? [{ file: currentProctors, kind: 'proctors' as const }] : []),
      ].map(async reference => ({ name: reference.file.name, size: reference.file.size, hash: await hashFile(reference.file), kind: reference.kind })));
      if (token === changeToken) ondraft(draftSignature(sourceDescriptors, rulesDescriptor, currentSettings, references));
    } catch (e) {
      if (token === changeToken) error = friendlyError(e);
    }
  }
  function addFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) sources.push({ id: crypto.randomUUID(), file, role: 'managed' });
    input.value = ''; demo = false; void changed();
  }
  function addHoliday() {
    if (!validDate(holidayDate)) { error = localized('Choose a valid holiday date.', 'เลือกวันที่วันหยุดให้ถูกต้อง'); return; }
    settings.holidays = [...new Set([...settings.holidays, holidayDate])].sort(); holidayDate = ''; void changed();
  }
  async function loadExample() {
    loadingExample = true; error = null;
    try {
      // Synthetic fixtures (regenerate with scripts/make-example-fixtures.ts); the real
      // registrar data in tests/fixtures is never served as the website example.
      const specs = [
        ['04.xlsx', new URL('../../tests/fixtures/synthetic/04.xlsx', import.meta.url).href, 'context'],
        ['05.xlsx', new URL('../../tests/fixtures/synthetic/05.xlsx', import.meta.url).href, 'context'],
        ['06.xlsx', new URL('../../tests/fixtures/synthetic/06.xlsx', import.meta.url).href, 'managed'],
        ['08.xlsx', new URL('../../tests/fixtures/synthetic/08.xlsx', import.meta.url).href, 'context'],
      ] as const;
      const loaded = await Promise.all(specs.map(async ([name, url, role]) => { const response = await fetch(url); if (!response.ok) throw new Error(t(`Cannot load ${name}.`, `ไม่สามารถโหลด ${name} ได้`)); return { id: crypto.randomUUID(), file: new File([await response.arrayBuffer()], name), role }; }));
      const response = await fetch(new URL('../../tests/fixtures/synthetic/rules.csv', import.meta.url)); if (!response.ok) throw new Error(t('Cannot load rules.csv.', 'ไม่สามารถโหลด rules.csv ได้'));
      rules = new File([await response.arrayBuffer()], 'rules.csv'); sources = loaded;
      const roomResponse = await fetch(new URL('../../tests/fixtures/synthetic/roominfo.csv', import.meta.url));
      if (roomResponse.ok) rooms = new File([await roomResponse.arrayBuffer()], 'roominfo.csv');
      if (SHOW_PROCTORS) {
        const proctorResponse = await fetch(new URL('../../tests/fixtures/synthetic/proctors.csv', import.meta.url));
        if (proctorResponse.ok) proctors = new File([await proctorResponse.arrayBuffer()], 'proctors.csv');
      }
      settings = defaultSettings({ start: '2026-08-17', end: '2026-08-28' }, { start: '2026-10-14', end: '2026-10-30' });
      demo = true; await changed();
    } catch (e) { error = friendlyError(e); } finally { loadingExample = false; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (!complete || busy) return;
    try {
      const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());
      const files = await Promise.all(sources.map(async s => ({ name: s.file.name, bytes: await bytesOf(s.file), role: s.role })));
      const references: ProjectInput['references'] = [];
      if (rooms) references.push({ name: rooms.name, bytes: await bytesOf(rooms), kind: 'rooms' });
      if (proctors) references.push({ name: proctors.name, bytes: await bytesOf(proctors), kind: 'proctors' });
      const withResources = { ...$state.snapshot(settings), computerProctorRule: computerRule || undefined };
      onimport({ courseSources: files, rules: rules ? { name: rules.name, bytes: await bytesOf(rules) } : undefined, references: references.length ? references : undefined, settings: withResources });
    } catch (e) { error = friendlyError(e); }
  }
</script>

<form onsubmit={submit}>
  <header class="institution-masthead" aria-label={t('Faculty of Industrial Technology and Management', 'คณะเทคโนโลยีอุตสาหกรรมและการจัดการ')}>
    <img class="mast-logo" src={fitmLogo} alt="FITM" />
    <img class="mast-logo kmutnb" src={kmutnbLogo} alt="KMUTNB" />
    <p class="mast-caption">{t('Faculty of Industrial Technology and Management · King Mongkut’s University of Technology North Bangkok', 'คณะเทคโนโลยีอุตสาหกรรมและการจัดการ · มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ')}</p>
  </header>
  <div class="heading-row">
    <div><h1>{t('Start with your source files.', 'เริ่มต้นด้วยไฟล์ข้อมูลของคุณ')}</h1><p class="lede">{t('Bring your course lists together, then check them before scheduling.', 'รวมข้อมูลรายวิชาและตรวจสอบก่อนจัดตารางสอบ')}</p></div>
    <button class="button secondary" type="button" onclick={loadExample} disabled={busy || loadingExample}><Icon name="file" />{loadingExample ? t('Loading…', 'กำลังโหลด') : t('Use example files', 'ใช้ไฟล์ตัวอย่าง')}</button>
  </div>
  {#if demo}<div class="notice"><Icon name="info" /><p>{t('Synthetic example files loaded. Course codes, groups, rooms and names are invented; the date ranges are for demonstration, so check your actual calendar.', 'โหลดไฟล์ตัวอย่าง (ข้อมูลสมมติ) แล้ว รหัสวิชา กลุ่ม ห้อง และชื่อเป็นข้อมูลสมมติ ช่วงวันที่เป็นเพียงตัวอย่าง กรุณาตรวจสอบปฏิทินจริง')}</p></div>{/if}
  {#if error}<div class="notice danger" role="alert"><Icon name="alert" /><p>{localizedText(error)}</p></div>{/if}
  <fieldset disabled={busy || loadingExample} class="source-layout">
    <div class="source-main">
      <section class="panel">
        <div class="section-heading"><h2>{t('Course sources', 'ไฟล์รายวิชา')}</h2><span class="count-label">{sources.length} {t('files', 'ไฟล์')}</span></div>
        <p class="muted">{t('Managed courses are scheduled here. Context courses keep their existing times.', 'วิชาในไฟล์ที่เลือกจะถูกจัดเวลาสอบอัตโนมัติ ส่วนไฟล์ที่จัดเวลาไว้แล้วจะคงเวลาสอบเดิม')}</p>
        <input bind:this={courseInput} class="visually-hidden" type="file" accept={accept} multiple onchange={addFiles} aria-label={t('Add course files', 'เพิ่มไฟล์รายวิชา')} />
        <button class="upload-area" type="button" onclick={() => courseInput.click()}><span class="upload-symbol"><Icon name="upload" size={27} /></span><span><strong>{t('Add course files', 'เพิ่มไฟล์รายวิชา')}</strong><small>XLSX, XLS, CSV, TSV, XLSM, XLSB, ODS, FODS</small></span><Icon name="arrow" /></button>
        {#if sources.length}
          <div class="source-list">
            {#each sources as source (source.id)}
              <div class="source-row"><Icon name="file" /><div class="file-name"><strong>{source.file.name}</strong><small>{(source.file.size / 1024).toFixed(1)} KB</small></div><label class="role-select"><span class="visually-hidden">{t(`Data role for ${source.file.name}`, `ประเภทของไฟล์ ${source.file.name}`)}</span><select bind:value={source.role} onchange={changed}><option value="managed">{t('Managed', 'จัดอัตโนมัติ')}</option><option value="context">{t('Context', 'จัดไปแล้ว')}</option></select></label><button class="icon-button" type="button" aria-label={t(`Remove ${source.file.name}`, `ลบไฟล์ ${source.file.name}`)} onclick={() => { sources = sources.filter(s => s.id !== source.id); changed(); }}><Icon name="close" size={17} /></button></div>
            {/each}
          </div>
        {:else}<p class="empty-help">{t('Add one or more files. Choose which files this project manages.', 'เพิ่มไฟล์อย่างน้อยหนึ่งไฟล์ แล้วเลือกไฟล์ที่จะให้จัดอัตโนมัติ')}</p>{/if}
      </section>
      <section class="panel">
        <div class="section-heading"><h2>{t('Scheduling rules', 'เงื่อนไขการสอบ')}</h2><span class="count-label">{t('Optional', 'ไม่บังคับ')}</span></div>
        <p class="muted">{t('Include no-exam, full-day and same-time course rules.', 'ระบุวิชาที่ไม่มีสอบ สอบเต็มวัน และสอบพร้อมกัน')}</p>
        <input bind:this={rulesInput} class="visually-hidden" type="file" accept={accept} aria-label={t('Choose rules file', 'เลือกไฟล์เงื่อนไข')} onchange={(e) => { rules = e.currentTarget.files?.[0] ?? null; e.currentTarget.value = ''; changed(); }} />
        <div class="rules-row"><Icon name="file" /><span>{rules?.name ?? t('No rules file selected', 'ยังไม่ได้เลือกไฟล์')}</span><button type="button" class="button secondary compact" onclick={() => rulesInput.click()}>{rules ? t('Replace', 'เปลี่ยน') : t('Choose file', 'เลือกไฟล์')}</button>{#if rules}<button type="button" class="icon-button" aria-label={t('Remove rules file', 'ลบไฟล์เงื่อนไข')} onclick={() => { rules = null; changed(); }}><Icon name="close" /></button>{/if}</div>
      </section>
      {#if SHOW_PROCTORS || SHOW_ROOMS}
      <section class="panel">
        <div class="section-heading"><h2>{SHOW_PROCTORS ? t('Rooms & proctors', 'ห้องสอบและผู้คุมสอบ') : t('Rooms', 'ห้องสอบ')}</h2><span class="count-label">{t('Optional', 'ไม่บังคับ')}</span></div>
        <p class="muted">{SHOW_PROCTORS ? t('Room files list rooms and proctor demand; proctor files carry the roster and availability.', 'ไฟล์ห้องสอบระบุห้องและความต้องการผู้คุม ไฟล์ผู้คุมสอบมีรายชื่อและเวลาว่าง') : t('Room files list the rooms examinations can be held in.', 'ไฟล์ห้องสอบระบุห้องที่ใช้จัดการสอบได้')}</p>
        {#if SHOW_ROOMS}
        <input bind:this={roomsInput} class="visually-hidden" type="file" accept={accept} aria-label={t('Choose rooms file', 'เลือกไฟล์ห้องสอบ')} onchange={(e) => { rooms = e.currentTarget.files?.[0] ?? null; e.currentTarget.value = ''; changed(); }} />
        <div class="rules-row"><Icon name="file" /><span>{rooms?.name ?? t('No rooms file selected', 'ยังไม่ได้เลือกไฟล์ห้องสอบ')}</span><button type="button" class="button secondary compact" onclick={() => roomsInput?.click()}>{rooms ? t('Replace', 'เปลี่ยน') : t('Choose file', 'เลือกไฟล์')}</button>{#if rooms}<button type="button" class="icon-button" aria-label={t('Remove rooms file', 'ลบไฟล์ห้องสอบ')} onclick={() => { rooms = null; changed(); }}><Icon name="close" /></button>{/if}</div>
        {/if}
        {#if SHOW_PROCTORS}
        <input bind:this={proctorsInput} class="visually-hidden" type="file" accept={accept} aria-label={t('Choose proctors file', 'เลือกไฟล์ผู้คุมสอบ')} onchange={(e) => { proctors = e.currentTarget.files?.[0] ?? null; e.currentTarget.value = ''; changed(); }} />
        <div class="rules-row"><Icon name="file" /><span>{proctors?.name ?? t('No proctors file selected', 'ยังไม่ได้เลือกไฟล์ผู้คุมสอบ')}</span><button type="button" class="button secondary compact" onclick={() => proctorsInput?.click()}>{proctors ? t('Replace', 'เปลี่ยน') : t('Choose file', 'เลือกไฟล์')}</button>{#if proctors}<button type="button" class="icon-button" aria-label={t('Remove proctors file', 'ลบไฟล์ผู้คุมสอบ')} onclick={() => { proctors = null; changed(); }}><Icon name="close" /></button>{/if}</div>
        <label class="check-row"><input type="checkbox" bind:checked={computerRule} onchange={changed} /><span>{t('Computer rooms require a computer-tagged proctor', 'ห้องคอมต้องมีผู้คุมที่มีทักษะคอม')}<small class="muted">{t('Opt-in capability rule; off until its meaning is confirmed.', 'เงื่อนไขเพิ่มเติม ปิดไว้จนกว่าจะยืนยันความหมาย')}</small></span></label>
        {/if}
      </section>
      {/if}
      <div class="quiet-note"><Icon name="lock" /><p>{t('Files are processed in this browser. This workspace is not saved yet.', 'ประมวลผลไฟล์ในเบราว์เซอร์ พื้นที่ทำงานนี้ยังไม่ได้บันทึก')}</p></div>
      <section class="panel">
        <div class="section-heading"><h2>{t('Open a saved project', 'เปิดโครงการที่บันทึกไว้')}</h2><span class="count-label">{t('Cloud', 'คลาวด์')}</span></div>
        <p class="muted">{t('Paste a project or share link from this app to reopen it on this device — including from another browser or computer.', 'วางลิงก์โครงการหรือลิงก์แชร์ของแอปนี้เพื่อเปิดในอุปกรณ์นี้ รวมถึงจากเบราว์เซอร์หรือเครื่องอื่น')}</p>
        <div class="open-link-row">
          <label class="search-field"><Icon name="link" /><span class="visually-hidden">{t('Project or share link', 'ลิงก์โครงการหรือลิงก์แชร์')}</span><input type="url" bind:value={linkText} oninput={() => { linkProblem = ''; }} placeholder="https://…​/#/share/shr_…/…" spellcheck="false" /></label>
          <button class="button secondary compact" type="button" disabled={busy || loadingExample || !linkText.trim()} onclick={() => {
            if (parseShareRef(linkText)) { onopenlink(linkText); linkProblem = ''; }
            else linkProblem = t('Paste a link copied from “Save & share”, or a share link someone sent you.', 'วางลิงก์ที่คัดลอกจากหน้าบันทึกและแชร์ หรือลิงก์แชร์ที่ได้รับมา');
          }}>{t('Open', 'เปิด')}</button>
        </div>
        {#if linkProblem}<p class="field-error" role="alert">{linkProblem}</p>{/if}
      </section>
    </div>
    <section class="panel calendar-settings">
      <h2>{t('Exam calendar', 'ปฏิทินการสอบ')}</h2>
      {#each ['midterm', 'final'] as type}
        <fieldset class="period-fieldset"><legend>{type === 'midterm' ? t('Midterm', 'กลางภาค') : t('Final', 'ปลายภาค')}</legend><div class="date-pair"><label>{t('Start', 'เริ่ม')}<input type="date" required bind:value={settings.periods[type as 'midterm' | 'final'].start} onchange={changed} aria-label={t(`${type} start`, `วันเริ่มสอบ${type === 'midterm' ? 'กลางภาค' : 'ปลายภาค'}`)} /></label><label>{t('End', 'สิ้นสุด')}<input type="date" required bind:value={settings.periods[type as 'midterm' | 'final'].end} onchange={changed} aria-label={t(`${type} end`, `วันสิ้นสุดสอบ${type === 'midterm' ? 'กลางภาค' : 'ปลายภาค'}`)} /></label></div>{#if periodProblems[type]}<p class="field-error" role="alert">{periodProblems[type]}</p>{/if}</fieldset>
      {/each}
      <label>{t('Weekends', 'วันเสาร์–อาทิตย์')}<select bind:value={settings.weekendPolicy} onchange={changed}>{#each policies as p}<option value={p.value}>{t(p.en, p.th)}</option>{/each}</select></label>
      <label>{t('Holidays', 'วันหยุด')}<select bind:value={settings.holidayPolicy} onchange={changed}>{#each policies as p}<option value={p.value}>{t(p.en, p.th)}</option>{/each}</select></label>
      <div class="holiday-add"><label>{t('Add a holiday', 'เพิ่มวันหยุด')}<input type="date" bind:value={holidayDate} /></label><button class="button secondary compact" type="button" onclick={addHoliday} disabled={!holidayDate}>{t('Add', 'เพิ่ม')}</button></div>
      {#if settings.holidays.length}<ul class="holiday-list">{#each settings.holidays as holiday}<li><time>{holiday}</time><button type="button" class="icon-button" aria-label={t(`Remove holiday ${holiday}`, `ลบวันหยุด ${holiday}`)} onclick={() => { settings.holidays = settings.holidays.filter(d => d !== holiday); changed(); }}><Icon name="close" size={15} /></button></li>{/each}</ul>{:else}<p class="calendar-hint">{t('No holidays added. Include public and university closures.', 'ยังไม่มีวันหยุด กรุณาเพิ่มวันหยุดราชการและมหาวิทยาลัย')}</p>{/if}
      {#if calendarNotices.length}<div class="calendar-notices">{#each calendarNotices as notice}<p>{notice}</p>{/each}</div>{/if}
      <details class="advanced"><summary>{t('Sessions & search', 'ช่วงเวลาและการค้นหา')}</summary><p class="muted">{t('24-hour times', 'เวลาแบบ 24 ชั่วโมง')}</p>{#each settings.sessions as session, i}<div><div class="date-pair"><label>{t(`Session ${i + 1} start`, `เริ่มช่วงที่ ${i + 1}`)}<input type="time" value={`${String(Math.floor(session.startMinutes / 60)).padStart(2, '0')}:${String(session.startMinutes % 60).padStart(2, '0')}`} onchange={e => { const [h, m] = e.currentTarget.value.split(':').map(Number); session.startMinutes = h * 60 + m; void changed(); }} required aria-invalid={!!sessionProblems[i]} /></label><label>{t('End', 'สิ้นสุด')}<input type="time" value={`${String(Math.floor(session.endMinutes / 60)).padStart(2, '0')}:${String(session.endMinutes % 60).padStart(2, '0')}`} onchange={e => { const [h, m] = e.currentTarget.value.split(':').map(Number); session.endMinutes = h * 60 + m; void changed(); }} required aria-invalid={!!sessionProblems[i]} /></label></div>{#if sessionProblems[i]}<p class="field-error" role="alert">{sessionProblems[i]}</p>{/if}</div>{/each}<label>{t('Solver effort', 'ระดับความพยายามในการจัดตาราง')}<input type="number" min="1" max="1000000" bind:value={settings.searchBudget} onchange={changed} required /></label><p class="field-hint">{t('How many scheduling attempts the generator may try before reporting a course as unscheduled.', 'จำนวนครั้งที่ตัวจัดตารางลองจัดก่อนรายงานว่าวิชานั้นจัดไม่ได้')}</p><p class="muted">{t('Full-day exam hours', 'ช่วงเวลาสอบเต็มวัน')}</p><div><div class="date-pair"><label>{t('Full-day start', 'เริ่มเต็มวัน')}<input type="time" value={`${String(Math.floor(settings.fullDay.startMinutes / 60)).padStart(2, '0')}:${String(settings.fullDay.startMinutes % 60).padStart(2, '0')}`} onchange={e => { const [h, m] = e.currentTarget.value.split(':').map(Number); settings.fullDay.startMinutes = h * 60 + m; void changed(); }} required aria-invalid={!!fullDayProblem} /></label><label>{t('Full-day end', 'สิ้นสุดเต็มวัน')}<input type="time" value={`${String(Math.floor(settings.fullDay.endMinutes / 60)).padStart(2, '0')}:${String(settings.fullDay.endMinutes % 60).padStart(2, '0')}`} onchange={e => { const [h, m] = e.currentTarget.value.split(':').map(Number); settings.fullDay.endMinutes = h * 60 + m; void changed(); }} required aria-invalid={!!fullDayProblem} /></label></div>{#if fullDayProblem}<p class="field-error" role="alert">{fullDayProblem}</p>{/if}</div></details>
    </section>
  </fieldset>
  <div class="form-footer"><p>{formHint}</p><button class="button primary" type="submit" disabled={!complete || busy || loadingExample}>{t('Import & check', 'นำเข้าและตรวจสอบ')} <Icon name="arrow" /></button></div>
</form>
