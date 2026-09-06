<script lang="ts">
  import { onMount } from 'svelte';
  import type { ExamEvent, ExamType, Project } from '../lib/types.ts';
  import { courseName, dateLabel, eventStatus, timingLabel } from './format.ts';
  import { t } from './i18n.svelte.ts';
  import Icon from './Icon.svelte';
  let { project, examType, onselect, query = $bindable(''), group = '', date = '' }: { project: Project; examType: ExamType; onselect: (id: string) => void; query?: string; group?: string; date?: string } = $props();
  const pageSize = 40;
  let ownership = $state('all');
  let status = $state('all');
  let sort = $state('course');
  let limit = $state(pageSize);
  let loadSentinel = $state<HTMLDivElement | null>(null);
  let infiniteObserver: IntersectionObserver | null = null;
  let canObserve = $state(true);
  let events = $derived.by(() => {
    const search = query.trim().toLowerCase();
    return project.events.filter(e => e.examType === examType && (!group || e.studentGroups.includes(group)) && (!date || e.timing?.date === date) && (ownership === 'all' || e.ownership === ownership) && (status === 'all' || (status === 'unscheduled' ? e.required && !e.timing : status === 'excluded' ? !e.required && !e.timing : !!e.timing)) && `${e.courseCode} ${courseName(project, e.courseCode)} ${e.studentGroups.join(' ')} ${e.timing?.date ?? ''}`.toLowerCase().includes(search)).sort((a, b) => sort === 'date' ? (a.timing?.date ?? '9999').localeCompare(b.timing?.date ?? '9999') || (a.timing?.startMinutes ?? 0) - (b.timing?.startMinutes ?? 0) || a.courseCode.localeCompare(b.courseCode) : a.courseCode.localeCompare(b.courseCode));
  });
  let visibleEvents = $derived(events.slice(0, limit));
  let hasMore = $derived(events.length > limit);
  function loadMore() {
    if (hasMore) limit = Math.min(limit + pageSize, events.length);
  }
  function reset() { limit = pageSize; }
  $effect(() => {
    void visibleEvents.length;
    if (!loadSentinel || !infiniteObserver || !hasMore) return;
    infiniteObserver.unobserve(loadSentinel);
    infiniteObserver.observe(loadSentinel);
  });
  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') {
      canObserve = false;
      return;
    }
    infiniteObserver = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: '0px 0px 320px 0px' });
    if (loadSentinel) infiniteObserver.observe(loadSentinel);
    return () => {
      infiniteObserver?.disconnect();
      infiniteObserver = null;
    };
  });
</script>
<div class="filter-bar mobile-filter-bar">
  <label class="search-field"><Icon name="search" /><span class="visually-hidden">{t('Search exams', 'ค้นหาวิชา')}</span><input type="search" placeholder={t('Course code, name or group', 'รหัสวิชา ชื่อ หรือกลุ่ม')} bind:value={query} oninput={reset} /></label>
  <div class="filter-controls">
    <label><span class="visually-hidden">{t('Course ownership', 'ประเภทวิชา')}</span><select bind:value={ownership} onchange={reset}><option value="all">{t('All courses', 'ทุกวิชา')}</option><option value="managed">{t('Managed', 'จัดอัตโนมัติ')}</option><option value="context">{t('Context', 'จัดไปแล้ว')}</option></select></label>
    <label><span class="visually-hidden">{t('Exam status', 'สถานะสอบ')}</span><select bind:value={status} onchange={reset}><option value="all">{t('All statuses', 'ทุกสถานะ')}</option><option value="scheduled">{t('Scheduled', 'จัดแล้ว')}</option><option value="unscheduled">{t('Unscheduled', 'ยังไม่ได้จัดตาราง')}</option><option value="excluded">{t('Excluded', 'ไม่จัดส่วนกลาง')}</option></select></label>
    <label><span class="visually-hidden">{t('Sort exams', 'เรียงวิชา')}</span><select bind:value={sort}><option value="course">{t('By course', 'รหัสวิชา')}</option><option value="date">{t('By date', 'วันสอบ')}</option></select></label>
  </div>
</div>
<div class="table-scroll" role="region" aria-label={t('Exam table', 'ตารางรายวิชา')}>
  <table class="exam-table"><thead><tr><th scope="col">{t('Course', 'วิชา')}</th><th scope="col">{t('Date', 'วันที่')}</th><th scope="col">{t('Time', 'เวลา')}</th><th scope="col">{t('Groups', 'กลุ่ม')}</th><th scope="col">{t('Status', 'สถานะ')}</th><th scope="col"><span class="visually-hidden">{t('Open details', 'ดูรายละเอียด')}</span></th></tr></thead><tbody>
    {#each visibleEvents as event (event.id)}<tr class:unresolved={event.required && !event.timing}><td class="cell-primary" data-label={t('Course', 'วิชา')}><button class="course-link" onclick={() => onselect(event.id)}>{event.courseCode}</button><span class="course-name">{courseName(project, event.courseCode)}</span><small class="muted">{event.ownership === 'context' ? t('Context', 'จัดไปแล้ว') : t('Managed', 'จัดอัตโนมัติ')} · {event.sectionIds.length} {t('sections', 'ตอน')}</small></td><td data-label={t('Date', 'วันที่')}>{event.timing ? dateLabel(event.timing.date) : '—'}</td><td class="time-cell" data-label={t('Time', 'เวลา')}>{event.timing ? timingLabel(event) : '—'}</td><td data-label={t('Groups', 'กลุ่ม')}>{#if event.studentGroups.length}<span class="groups-cell" title={event.studentGroups.join(', ')}>{event.studentGroups.slice(0, 2).join(', ')}{event.studentGroups.length > 2 ? ` +${event.studentGroups.length - 2}` : ''}</span>{:else}—{/if}</td><td data-label={t('Status', 'สถานะ')}><span class="status" class:error-status={event.required && !event.timing} class:success-status={!!event.timing && event.timingOrigin === 'generated'}>{#if event.timingOrigin !== 'generated'}<Icon name="lock" size={12} />{/if}{eventStatus(event)}</span></td><td class="cell-actions" data-label={t('Open details', 'ดูรายละเอียด')}><button class="icon-button" aria-label={t(`Open ${event.courseCode}`, `ดูรายละเอียด ${event.courseCode}`)} onclick={() => onselect(event.id)}><Icon name={event.ownership === 'context' || event.timingOrigin === 'imported' ? 'info' : 'edit'} size={17} /></button></td></tr>
    {:else}<tr><td colspan="6"><div class="empty-state small"><Icon name="search" size={26} /><h3>{t('No matching exams', 'ไม่พบวิชา')}</h3><p>{t('Try another course, group or filter.', 'ลองค้นหาวิชาหรือกลุ่มอื่น')}</p></div></td></tr>{/each}
  </tbody></table>
</div>
<div class="infinite-scroll-sentinel" bind:this={loadSentinel} aria-hidden="true"></div>
<div class="table-footer"><span aria-live="polite">{visibleEvents.length} {t('of', 'จาก')} {events.length} {t('exams', 'วิชา')}</span>{#if !canObserve && hasMore}<button class="button secondary compact" onclick={loadMore}>{t('Load more', 'โหลดเพิ่ม')}</button>{/if}<span>{t('All times are local', 'เวลาทั้งหมดเป็นเวลาท้องถิ่น')}</span></div>
<span class="visually-hidden" aria-live="polite">{hasMore ? t('More exams load automatically as you scroll.', 'เลื่อนลงเพื่อโหลดวิชาเพิ่มเติมโดยอัตโนมัติ') : t('All matching exams are shown.', 'แสดงวิชาที่ตรงกันครบแล้ว')}</span>
