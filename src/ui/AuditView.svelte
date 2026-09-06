<script lang="ts">
  import type { AuditBundle } from '../lib/audit.ts';
  import type { ValidationReport } from '../lib/types.ts';
  import { coverageChecks } from '../lib/validator.ts';
  import { coverageName } from './format.ts';
  import { SHOW_PROCTORS, SHOW_ROOMS, SHOW_RESOURCES, visibleCoverageEntries } from './flags.ts';
  import { t } from './i18n.svelte.ts';
  import Icon from './Icon.svelte';
  let { audit, validation, busy = false, ondownload, oncopy, onshare }: { audit: AuditBundle | null; validation: ValidationReport | null; busy?: boolean; ondownload: (kind: 'audit' | 'validation') => void; oncopy: () => void; onshare?: () => void } = $props();
</script>
{#if !audit || !validation}
  {#if busy}
    <div class="empty-state"><Icon name="info" size={34} /><h3>{t('Calculating the audit…', 'กำลังคำนวณข้อมูลตรวจสอบ…')}</h3><p class="muted">{t('Hashing the schedule and reading the current coverage and resource evidence.', 'กำลังสร้างแฮชของตารางและอ่านขอบเขตการตรวจสอบกับหลักฐานทรัพยากรปัจจุบัน')}</p></div>
  {:else}
    <div class="empty-state"><Icon name="lock" size={34} /><h3>{t('No audit yet', 'ยังไม่มีข้อมูลตรวจสอบ')}</h3><p>{t('Generate a schedule to produce hashes, coverage and an audit bundle. It is calculated automatically from the current schedule.', 'จัดตารางสอบเพื่อสร้างแฮช ขอบเขตการตรวจสอบ และชุดข้อมูลตรวจสอบ ระบบคำนวณจากตารางปัจจุบันให้อัตโนมัติ')}</p></div>
  {/if}
{:else}
  <div class="source-layout">
    <div class="source-main">
      <section class="panel">
        <h2>{t('Provenance', 'ที่มาของข้อมูล')}</h2>
        <dl class="audit-grid">
          <div><dt>{t('Schedule hash', 'แฮชตารางสอบ')}</dt><dd><code>sha256:{audit.scheduleHash.slice(0, 16)}…</code></dd></div>
          <div><dt>{t('Source hash', 'แฮชข้อมูลต้นทาง')}</dt><dd><code>sha256:{audit.sourceHash.slice(0, 16)}…</code></dd></div>
          <div><dt>{t('Rules hash', 'แฮชเงื่อนไข')}</dt><dd><code>sha256:{audit.rulesHash.slice(0, 16)}…</code></dd></div>
          <div><dt>{t('Generated at', 'สร้างเมื่อ')}</dt><dd>{audit.generatedAt}</dd></div>
          <div><dt>{t('Audit schema', 'รุ่นข้อมูลตรวจสอบ')}</dt><dd>{audit.schemaVersion}</dd></div>
        </dl>
        <dl class="audit-grid">
          <div><dt>{t('Parser', 'ตัวอ่านไฟล์')}</dt><dd>{audit.parserVersion}</dd></div>
          <div><dt>{t('Scheduler', 'ตัวจัดตาราง')}</dt><dd>{audit.schedulerVersion}</dd></div>
          <div><dt>{t('Validator', 'ตัวตรวจสอบ')}</dt><dd>{audit.validatorVersion}</dd></div>
        </dl>
        <div class="inline-actions">
          <button class="button secondary compact" onclick={() => ondownload('audit')}><Icon name="file" size={15} />{t('Download audit.json', 'ดาวน์โหลด audit.json')}</button>
          <button class="button secondary compact" onclick={() => ondownload('validation')}><Icon name="file" size={15} />{t('Download validation.json', 'ดาวน์โหลด validation.json')}</button>
          <button class="button secondary compact" onclick={oncopy}><Icon name="info" size={15} />{t('Copy audit API info', 'คัดลอกข้อมูล API สำหรับการตรวจสอบ')}</button>
          {#if onshare}<button class="button secondary compact" onclick={onshare}><Icon name="link" size={15} />{t('Copy audit share link', 'คัดลอกลิงก์ตรวจสอบ')}</button>{/if}
        </div>
      </section>
      <section class="panel">
        <h2>{t('Checks', 'รายการตรวจสอบ')}</h2>
        <ul class="coverage-list">
          {#each visibleCoverageEntries(validation.coverage) as [key, status] (key)}
            {@const count = (coverageChecks[key] ?? []).length ? validation.issues.filter(i => (coverageChecks[key] ?? []).includes(i.type)).length : 0}
            <li class:coverage-passed={status === 'passed'} class:coverage-failed={status === 'failed'} class:coverage-not-checked={status === 'not_checked'}>
              <span class="status" class:success-status={status === 'passed'} class:error-status={status === 'failed'} class:warning-status={status === 'not_checked'}>{status === 'passed' ? t('Passed', 'ผ่าน') : status === 'failed' ? t('Failed', 'ไม่ผ่าน') : t('Not checked', 'ยังไม่ตรวจ')}</span>
              {coverageName(key)}{#if count}<small class="muted"> · {count} {t('findings', 'ข้อค้นพบ')}</small>{/if}
            </li>
          {/each}
        </ul>
      </section>
      <section class="panel">
        <h2>{t('Schedule quality', 'คุณภาพตารางสอบ')}</h2>
        <dl class="audit-grid">
          <div><dt>{t('Exams scheduled', 'การสอบที่จัดแล้ว')}</dt><dd>{audit.quality.scheduledManagedEvents}</dd></div>
          <div><dt>{t('Same-day exam pairs', 'คู่วิชาที่สอบวันเดียวกัน')}</dt><dd>{audit.quality.sameDayPairs}</dd></div>
          <div><dt>{t('Groups with a same-day double', 'กลุ่มที่สอบวันเดียวกัน 2 วิชา')}</dt><dd>{audit.quality.groupsWithSameDayExams}</dd></div>
          <div><dt>{t('Groups with 3 exams in one day', 'กลุ่มที่สอบ 3 วิชาในวันเดียว')}</dt><dd>{audit.quality.groupsWithThreeSameDayExams}</dd></div>
          <div><dt>{t('Consecutive-day pairs', 'คู่วิชาวันต่อเนื่อง')}</dt><dd>{audit.quality.consecutiveDayPairs}</dd></div>
          <div><dt>{t('Groups with consecutive-day exams', 'กลุ่มที่สอบวันต่อเนื่อง')}</dt><dd>{audit.quality.groupsWithConsecutiveDayExams}</dd></div>
          <div><dt>{t('Peak simultaneous exams', 'จำนวนการสอบพร้อมกันสูงสุด')}</dt><dd>{audit.quality.peakConcurrentExams}</dd></div>
          <div><dt>{t('Weekend exams', 'การสอบวันหยุดสุดสัปดาห์')}</dt><dd>{audit.quality.weekendExams}</dd></div>
          <div><dt>{t('Days used', 'จำนวนวันที่ใช้')}</dt><dd>{t('Midterm', 'กลางภาค')} {audit.quality.daysUsed.midterm ?? 0} · {t('Final', 'ปลายภาค')} {audit.quality.daysUsed.final ?? 0}</dd></div>
        </dl>
        <p class="muted">{t('Quality facts are measurements, not verdicts: same-day pairs count every pair of exams one student group must sit on one calendar day, including already-fixed imported exams.', 'ตัวเลขคุณภาพเป็นการวัด ไม่ใช่คำตัดสิน คู่วิชาวันเดียวกันนับทุกคู่ที่กลุ่มนักศึกษาต้องสอบในวันเดียวกัน รวมการสอบที่นำเข้ามาซึ่งแก้ไม่ได้')}</p>
      </section>
      {#if SHOW_RESOURCES}
      <section class="panel">
        <h2>{SHOW_PROCTORS ? t('Resource evidence', 'หลักฐานทรัพยากร') : t('Room evidence', 'หลักฐานห้องสอบ')}</h2>
        {#if SHOW_PROCTORS}<p class="muted">{t('Known proctor positions are counted only where the assigned room records a positive demand. Unknown demand is kept separate and is never treated as zero or complete.', 'นับตำแหน่งผู้คุมเฉพาะห้องที่ระบุความต้องการเป็นจำนวนบวก ความต้องการที่ไม่ทราบจะแยกไว้และไม่ถือว่าเป็นศูนย์หรือครบถ้วน')}</p>{/if}
        <dl class="audit-grid">
          {#if SHOW_PROCTORS}
          <div><dt>{t('Known positions filled', 'ตำแหน่งที่ทราบและจัดแล้ว')}</dt><dd>{audit.summary.positionsFilled}/{audit.summary.proctorPositions}</dd></div>
          <div><dt>{t('Events with unfilled known positions', 'รายการที่ตำแหน่งที่ทราบยังว่าง')}</dt><dd>{audit.summary.eventsWithUnfilledProctorPositions}</dd></div>
          <div><dt>{t('Events with unknown demand', 'รายการที่ไม่ทราบความต้องการ')}</dt><dd>{audit.summary.eventsWithUnknownProctorDemand}</dd></div>
          <div><dt>{t('Rooms with unknown demand', 'ห้องที่ไม่ทราบความต้องการ')}</dt><dd>{audit.summary.roomsWithUnknownProctorDemand}</dd></div>
          {/if}
          {#if SHOW_ROOMS}
          <div><dt>{t('Rooms assigned', 'ห้องที่จัดแล้ว')}</dt><dd>{audit.summary.roomsAssigned}</dd></div>
          <div><dt>{t('Events without a room', 'รายการที่ยังไม่มีห้อง')}</dt><dd>{audit.summary.roomsUnassigned}</dd></div>
          {/if}
          {#if SHOW_PROCTORS}
          <div><dt>{t('Eligible roster candidates', 'ผู้คุมที่มีสิทธิ์เป็นผู้สมัคร')}</dt><dd>{audit.summary.eligibleProctors}</dd></div>
          <div><dt>{t('Quarantined roster candidates', 'ผู้คุมที่ถูกกักกัน')}</dt><dd>{audit.summary.ineligibleProctors}</dd></div>
          <div><dt>{t('Computer capability rule', 'เงื่อนไขความสามารถคอมพิวเตอร์')}</dt><dd>{audit.summary.computerRuleApplied ? t('Applied', 'ใช้') : t('Off', 'ปิด')}</dd></div>
          {/if}
        </dl>
      </section>
      {/if}
    </div>
    <aside class="panel calendar-settings">
      <h2>{t('Summary', 'สรุป')}</h2>
      <dl class="audit-grid">
        <div><dt>{t('Errors', 'ข้อผิดพลาด')}</dt><dd>{audit.summary.errors}</dd></div>
        <div><dt>{t('Warnings', 'คำเตือน')}</dt><dd>{audit.summary.warnings}</dd></div>
        <div><dt>{t('Unscheduled', 'ยังไม่ได้จัดตาราง')}</dt><dd>{audit.summary.unscheduledEvents}</dd></div>
        {#if SHOW_ROOMS}<div><dt>{t('Rooms assigned', 'ห้องที่จัดแล้ว')}</dt><dd>{audit.summary.roomsAssigned}/{audit.summary.scheduledManagedEvents}</dd></div>{/if}
          {#if SHOW_PROCTORS}
          <div><dt>{t('Known proctor positions', 'ตำแหน่งผู้คุมสอบที่ทราบ')}</dt><dd>{audit.summary.positionsFilled}/{audit.summary.proctorPositions}</dd></div>
        <div><dt>{t('Unknown-demand events', 'รายการที่ไม่ทราบความต้องการ')}</dt><dd>{audit.summary.eventsWithUnknownProctorDemand}</dd></div>
          {/if}
      </dl>
      {#if SHOW_PROCTORS}<p class="muted">{t('Known positions are a partial staffing result when any room or roster demand is unknown. The same validator runs in the browser, the Web Worker and the CLI; identical inputs produce identical hashes.', 'ตำแหน่งที่ทราบเป็นผลการจัดผู้คุมเพียงบางส่วนเมื่อยังมีห้องหรือความต้องการที่ไม่ทราบ ตัวตรวจสอบเดียวกันทำงานในเบราว์เซอร์ เว็บเวิร์กเกอร์ และ CLI ข้อมูลเดียวกันให้แฮชเดียวกัน')}</p>{:else}<p class="muted">{t('The same validator runs in the browser, the Web Worker and the CLI; identical inputs produce identical hashes.', 'ตัวตรวจสอบเดียวกันทำงานในเบราว์เซอร์ เว็บเวิร์กเกอร์ และ CLI ข้อมูลเดียวกันให้แฮชเดียวกัน')}</p>{/if}
    </aside>
  </div>
{/if}
