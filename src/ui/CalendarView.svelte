<script lang="ts">
  import type { ExamType, Project } from '../lib/types.ts';
  import { dates, weekend, weekDay } from '../lib/time.ts';
  import { courseName, examLabel, shortDate, timingLabel } from './format.ts';
  import { t } from './i18n.svelte.ts';
  import Icon from './Icon.svelte';
  let { project, examType, onselect }: { project: Project; examType: ExamType; onselect: (id: string) => void } = $props();
  let expandedDate = $state('');
  let days = $derived(dates(project.settings.periods[examType].start, project.settings.periods[examType].end));
  let weeks = $derived.by(() => {
    const rows: (string | null)[][] = [];
    let row: (string | null)[] = [];
    for (const day of days) {
      if (row.length === 0) row = Array<string | null>(weekDay(day)).fill(null);
      row.push(day);
      if (row.length === 7) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    return rows;
  });
  let events = $derived(project.events.filter(e => e.examType === examType && e.timing).sort((a, b) => a.timing!.startMinutes - b.timing!.startMinutes || a.courseCode.localeCompare(b.courseCode)));
  let unscheduled = $derived(project.events.filter(e => e.examType === examType && e.required && !e.timing));
</script>
<div class="calendar-toolbar"><div><h2>{shortDate(days[0])} – {shortDate(days[days.length - 1])}</h2><p class="muted">{examLabel(examType)} · {events.length} {t('scheduled', 'จัดแล้ว')}</p></div></div>
<div class="calendar-weeks">
{#each weeks as weekDays}
  {@const realDays = weekDays.filter((day): day is string => day !== null)}
  <div class="calendar-week-block">
    <p class="calendar-week-label">{t('Week', 'สัปดาห์')} {shortDate(realDays[0])} – {shortDate(realDays[realDays.length - 1])}</p>
    <div class="calendar-grid">
      {#each weekDays as day}{#if day}{@const exams = events.filter(e => e.timing!.date === day)}{@const isHoliday = project.settings.holidays.includes(day)}
        <section class="calendar-day" class:avoided-day={weekend(day) || isHoliday}><header><h3>{shortDate(day)}</h3><span>{exams.length} {t('exams', 'วิชา')}</span>{#if isHoliday}<small>{t('Holiday', 'วันหยุด')}</small>{:else if weekend(day)}<small>{t('Weekend', 'เสาร์–อาทิตย์')}</small>{/if}</header><div class="day-events">{#each (expandedDate === day ? exams : exams.slice(0, 5)) as event}<button class="calendar-event" class:context-event={event.ownership === 'context'} onclick={() => onselect(event.id)}><span class="calendar-time">{timingLabel(event)}</span><strong>{event.courseCode}</strong><span class="calendar-course-name">{courseName(project, event.courseCode)}</span>{#if event.timingOrigin !== 'generated'}<small><Icon name="lock" size={11} /> {event.timingOrigin === 'imported' ? t('Fixed', 'กำหนดแล้ว') : t('Locked', 'ล็อกเวลา')}</small>{/if}</button>{:else}<p class="day-empty">{t('No exams', 'ไม่มีสอบ')}</p>{/each}{#if exams.length > 5}<button class="text-button day-more" onclick={() => expandedDate = expandedDate === day ? '' : day}>{expandedDate === day ? t('Show fewer', 'ย่อ') : `+${exams.length - 5} ${t('more', 'เพิ่มเติม')}`}</button>{/if}</div></section>{:else}<div class="calendar-day-spacer" aria-hidden="true"></div>{/if}
      {/each}
    </div>
  </div>
{/each}
</div>
{#if unscheduled.length}<section class="unscheduled-strip"><h3>{t('Not on the calendar', 'ยังไม่มีวันสอบ')} <span class="status error-status">{unscheduled.length}</span></h3><div class="inline-actions">{#each unscheduled as event}<button class="button secondary compact" onclick={() => onselect(event.id)}>{event.courseCode}</button>{/each}</div></section>{/if}
