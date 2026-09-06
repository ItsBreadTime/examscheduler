<script lang="ts">
  import type { AvailabilityConstraint, Project } from '../lib/types.ts';
  import { proctorEligible } from '../lib/resource-model.ts';
  import { clockTime, courseName, dateLabel, timingLabel } from './format.ts';
  import { t } from './i18n.svelte.ts';
  import Icon from './Icon.svelte';
  let { project, onavailability }: { project: Project; onavailability: (proctorId: string, availability: AvailabilityConstraint[]) => void } = $props();
  let tab = $state<'roster' | 'workload' | 'availability'>('roster');
  let query = $state('');
  let noteDay = $state<Record<string, string>>({});
  let matches = $derived(project.proctors.filter(p => p.displayName.toLowerCase().includes(query.trim().toLowerCase())));
  const dutiesOf = (id: string) => project.events.filter(e => e.proctorAssignments.includes(id) && e.timing).sort((a, b) => (a.timing!.date < b.timing!.date ? -1 : 1) || a.timing!.startMinutes - b.timing!.startMinutes);
  const dayName = (day: number) => t(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day], ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][day]);
  const intervalOf = (a: AvailabilityConstraint) => a.interval ? ` ${clockTime(a.interval.startMinutes)}–${clockTime(a.interval.endMinutes)}` : '';
  const describe = (a: AvailabilityConstraint) => a.date ? `${t('Unavailable', 'ไม่ว่าง')} ${a.date}${intervalOf(a)}` : a.dayOfWeek !== undefined ? `${t('Every', 'ทุก')} ${dayName(a.dayOfWeek)}${intervalOf(a)}` : t('Unavailable interval', 'ช่วงเวลาที่ไม่ว่าง');
  const sourceRefsOf = (proctor: Project['proctors'][number]) => [...new Map((proctor.sourceRefs ?? [proctor.sourceRef]).map(ref => [`${ref.artifactId}:${ref.sheet ?? ''}:${ref.row ?? ''}:${ref.column ?? ''}`, ref])).values()];
  const sourceOf = (proctor: Project['proctors'][number]) => sourceRefsOf(proctor).map(ref => {
    const artifact = project.artifacts.find(a => a.id === ref.artifactId);
    return `${artifact?.originalName ?? ref.artifactId}${ref.sheet ? ` · ${ref.sheet}` : ''}${ref.row ? ` · ${t('Row', 'แถว')} ${ref.row}` : ''}`;
  }).join(' / ');
  const sourceTermOf = (proctor: Project['proctors'][number]) => {
    const explicit = proctor.assignmentEligibility?.sourceTerm;
    if (explicit) return explicit;
    return project.artifacts.find(a => a.term && sourceRefsOf(proctor).some(ref => ref.artifactId === a.id))?.term;
  };
  const termOf = (proctor: Project['proctors'][number]) => {
    const term = sourceTermOf(proctor);
    return term ? `${term.campus ? `${term.campus} · ` : ''}${t(`Semester ${term.semester}/${term.academicYearBE}`, `ภาคการศึกษา ${term.semester}/${term.academicYearBE}`)}` : t('Term unknown', 'ไม่ทราบ');
  };
  const eligibleOf = (proctor: Project['proctors'][number]) => proctorEligible(project, proctor);
  const eligibilityReasonOf = (proctor: Project['proctors'][number]) => {
    const reason = proctor.assignmentEligibility?.reason;
    if (reason && !/term|ภาคเรียน/i.test(reason)) return t('This proctor is not eligible for the current assignment.', 'ผู้คุมสอบคนนี้ไม่มีสิทธิ์สำหรับการจัดปัจจุบัน');
    return t('The roster term does not match the course term. Re-import a current-term roster.', 'ภาคการศึกษาของรายชื่อไม่ตรงกับข้อมูลวิชา กรุณานำเข้าไฟล์ของภาคการศึกษาปัจจุบัน');
  };
  const statusOf = (proctor: Project['proctors'][number]) => eligibleOf(proctor) ? t('Eligible', 'มีสิทธิ์') : t('Quarantined', 'กักกัน');
  function convertNote(id: string) {
    // Structured availability is explicit user input; free-text notes are shown but never parsed.
    const day = Number(noteDay[id]);
    if (!Number.isInteger(day) || day < 0 || day > 6) return;
    const current = project.proctors.find(p => p.id === id)?.availability ?? [];
    onavailability(id, [...current, { available: false, dayOfWeek: day }]);
  }
  function removeConstraint(id: string, index: number) {
    const current = project.proctors.find(p => p.id === id)?.availability ?? [];
    onavailability(id, current.filter((_, i) => i !== index));
  }
</script>
<div class="filter-bar">
  <div class="type-switch" role="group" aria-label={t('Proctor view', 'มุมมองผู้คุมสอบ')}>
    <button class:active={tab === 'roster'} aria-pressed={tab === 'roster'} onclick={() => { tab = 'roster'; }}>{t('Roster', 'รายชื่อ')}</button>
    <button class:active={tab === 'workload'} aria-pressed={tab === 'workload'} onclick={() => { tab = 'workload'; }}>{t('Workload', 'ภาระงาน')}</button>
    <button class:active={tab === 'availability'} aria-pressed={tab === 'availability'} onclick={() => { tab = 'availability'; }}>{t('Availability', 'เวลาว่าง')}</button>
  </div>
  <label class="search-field"><Icon name="search" /><span class="visually-hidden">{t('Search proctors', 'ค้นหาผู้คุมสอบ')}</span><input type="search" placeholder={t('Proctor name', 'ชื่อผู้คุมสอบ')} bind:value={query} /></label>
</div>
{#if !project.proctors.length}
  <div class="empty-state"><Icon name="groups" size={34} /><h3>{t('No proctor data', 'ไม่มีข้อมูลผู้คุมสอบ')}</h3><p>{t('Import a proctor file to assign invigilators.', 'นำเข้าไฟล์ผู้คุมสอบเพื่อจัดผู้คุม')}</p></div>
{:else if tab === 'roster'}
  <div class="table-scroll" role="region" aria-label={t('Proctor roster', 'รายชื่อผู้คุมสอบ')}>
    <table class="exam-table"><thead><tr><th scope="col">{t('Proctor', 'ผู้คุมสอบ')}</th><th scope="col">{t('Role', 'ตำแหน่ง')}</th><th scope="col">{t('Tags', 'คุณสมบัติ')}</th><th scope="col">{t('Duties', 'หน้าที่')}</th><th scope="col">{t('Assignment status', 'สถานะการจัด')}</th><th scope="col">{t('Source / term', 'แหล่งที่มา / ภาคการศึกษา')}</th><th scope="col">{t('Notes', 'หมายเหตุ')}</th></tr></thead><tbody>
      {#each matches as proctor (proctor.id)}{@const duties = dutiesOf(proctor.id)}
        <tr><td class="cell-primary" data-label={t('Proctor', 'ผู้คุมสอบ')}><strong>{proctor.displayName}</strong></td><td data-label={t('Role', 'ตำแหน่ง')}>{proctor.role ?? '—'}</td><td data-label={t('Tags', 'คุณสมบัติ')}>{proctor.tags.includes('computer') ? t('Computer', 'คอมพิวเตอร์') : '—'}</td><td class="count-cell" data-label={t('Duties', 'หน้าที่')}>{duties.length}</td><td data-label={t('Assignment status', 'สถานะการจัด')}><span class="status" class:warning-status={!eligibleOf(proctor)} class:success-status={eligibleOf(proctor)}>{statusOf(proctor)}</span><small class="muted">{eligibilityReasonOf(proctor)}</small></td><td data-label={t('Source / term', 'แหล่งที่มา / ภาคการศึกษา')}><span class="proctor-source"><small>{termOf(proctor)}</small><small class="muted">{sourceOf(proctor)}</small></span></td><td data-label={t('Notes', 'หมายเหตุ')}>{#if proctor.notes.length}<small class="muted">{proctor.notes.join(' · ')}</small>{:else}—{/if}</td></tr>
      {/each}
    </tbody></table>
  </div>
  <p class="table-footnote">{t('Quarantined candidates remain visible for review but are excluded from new assignments. Re-import a current-term proctor file to make them eligible.', 'ผู้คุมที่ถูกกักกันยังแสดงเพื่อการตรวจสอบ แต่จะไม่ถูกจัดใหม่ กรุณานำเข้าไฟล์ผู้คุมของภาคการศึกษาปัจจุบันเพื่อให้มีสิทธิ์')}</p>
{:else if tab === 'workload'}
  <div class="table-scroll" role="region" aria-label={t('Proctor workload', 'ภาระงานผู้คุมสอบ')}>
    <table class="exam-table"><thead><tr><th scope="col">{t('Proctor', 'ผู้คุมสอบ')}</th><th scope="col">{t('Total', 'รวม')}</th><th scope="col">{t('Morning', 'เช้า')}</th><th scope="col">{t('Afternoon', 'บ่าย')}</th><th scope="col">{t('Assignment status', 'สถานะการจัด')}</th><th scope="col">{t('Source / term', 'แหล่งที่มา / ภาคการศึกษา')}</th><th scope="col">{t('Assignments', 'งานที่ได้รับ')}</th></tr></thead><tbody>
      {#each [...matches].sort((a, b) => dutiesOf(b.id).length - dutiesOf(a.id).length || (a.displayName < b.displayName ? -1 : 1)) as proctor (proctor.id)}{@const duties = dutiesOf(proctor.id)}
        <tr><td class="cell-primary" data-label={t('Proctor', 'ผู้คุมสอบ')}><strong>{proctor.displayName}</strong></td><td class="count-cell" data-label={t('Total', 'รวม')}>{duties.length}</td><td class="count-cell" data-label={t('Morning', 'เช้า')}>{duties.filter(e => e.timing!.startMinutes < 720).length}</td><td class="count-cell" data-label={t('Afternoon', 'บ่าย')}>{duties.filter(e => e.timing!.startMinutes >= 720).length}</td><td data-label={t('Assignment status', 'สถานะการจัด')}><span class="status" class:warning-status={!eligibleOf(proctor)} class:success-status={eligibleOf(proctor)}>{statusOf(proctor)}</span></td><td data-label={t('Source / term', 'แหล่งที่มา / ภาคการศึกษา')}><span class="proctor-source"><small>{termOf(proctor)}</small><small class="muted">{sourceOf(proctor)}</small></span></td><td data-label={t('Assignments', 'งานที่ได้รับ')}>{#if duties.length}<small class="muted">{duties.slice(0, 3).map(e => `${e.courseCode} ${dateLabel(e.timing!.date)}`).join(' · ')}{duties.length > 3 ? ` +${duties.length - 3}` : ''}</small>{:else}—{/if}</td></tr>
      {/each}
    </tbody></table>
  </div>
  <p class="table-footnote">{t('Workload includes assignments already present in the snapshot. New allocation uses eligible candidates only.', 'ภาระงานรวมการจัดที่มีอยู่ในข้อมูล การจัดใหม่ใช้เฉพาะผู้สมัครที่มีสิทธิ์')}</p>
{:else}
  <div class="register-grid">
    {#each matches as proctor (proctor.id)}
      <section class="panel register">
        <h2>{proctor.displayName}</h2>
        <p class="proctor-source muted"><strong>{t('Source term', 'ภาคการศึกษาต้นทาง')}:</strong> {termOf(proctor)}<span aria-hidden="true"> · </span><strong>{t('Source', 'แหล่งที่มา')}:</strong> {sourceOf(proctor)}</p>
        {#if !eligibleOf(proctor)}<div class="app-notice warning register-notice" role="status"><Icon name="info" size={17} /><p>{t('This candidate is quarantined because the roster term does not match the course term.', 'ผู้สมัครรายนี้ถูกกักกันเพราะภาคการศึกษาของรายชื่อไม่ตรงกับข้อมูลวิชา')} {eligibilityReasonOf(proctor)} {t('Re-import a current-term proctor file before assigning.', 'กรุณานำเข้าไฟล์ผู้คุมของภาคการศึกษาปัจจุบันก่อนจัดผู้คุม')}</p></div>{/if}
        {#if proctor.notes.length}<p class="muted">{t('Source note (not interpreted)', 'หมายเหตุจากไฟล์ (ไม่ได้ตีความ)')}: {proctor.notes.join(' · ')}</p>{/if}
        {#if proctor.availability.length}
          <ul class="register-list">{#each proctor.availability as constraint, i}<li><span>{describe(constraint)}</span><button class="icon-button" aria-label={t(`Remove unavailability for ${proctor.displayName}`, `ลบช่วงไม่ว่างของ ${proctor.displayName}`)} onclick={() => removeConstraint(proctor.id, i)}><Icon name="close" size={15} /></button></li>{/each}</ul>
        {:else if !eligibleOf(proctor)}<p class="empty-help">{t('No active availability constraints were imported because this roster is quarantined.', 'ไม่มีข้อจำกัดเวลาที่ใช้งาน เพราะรายชื่อนี้ถูกกักกัน')}</p>
        {:else}<p class="empty-help">{t('Available for every session until you add an exception.', 'ว่างทุกช่วงจนกว่าจะเพิ่มข้อยกเว้น')}</p>{/if}
        <div class="holiday-add"><label>{t('Unavailable weekday', 'วันที่ไม่ว่างประจำสัปดาห์')}<select bind:value={noteDay[proctor.id]}><option value="">{t('Choose a day', 'เลือกวัน')}</option>{#each [0, 1, 2, 3, 4, 5, 6] as day}<option value={String(day)}>{dayName(day)}</option>{/each}</select></label><button class="button secondary compact" disabled={noteDay[proctor.id] === undefined || noteDay[proctor.id] === ''} onclick={() => convertNote(proctor.id)}>{t('Add', 'เพิ่ม')}</button></div>
        {#if dutiesOf(proctor.id).length}<p class="muted">{dutiesOf(proctor.id).length} {t('duties', 'หน้าที่')}: {dutiesOf(proctor.id).slice(0, 4).map(e => `${e.courseCode} ${dateLabel(e.timing!.date)} ${timingLabel(e)}`).join(' · ')}{dutiesOf(proctor.id).length > 4 ? ` +${dutiesOf(proctor.id).length - 4}` : ''}</p>{/if}
      </section>
    {/each}
  </div>
{/if}
