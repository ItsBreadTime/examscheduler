<script lang="ts">
  import type { ExamType, Project } from '../lib/types.ts';
  import { courseName, dateLabel, timingLabel } from './format.ts';
  import { t } from './i18n.svelte.ts';
  import { SHOW_PROCTORS } from './flags.ts';
  import Icon from './Icon.svelte';
  let { project, examType, onselect }: { project: Project; examType: ExamType; onselect: (id: string) => void } = $props();
  let mode = $state<'room' | 'time'>('room');
  let query = $state('');
  let rooms = $derived(project.rooms.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase())));
  let timed = $derived(project.events.filter(e => e.examType === examType && e.timing));
  let unassigned = $derived(timed.filter(e => e.ownership === 'managed' && !e.roomAssignments.length));
  const roomName = (id: string) => project.rooms.find(r => r.id === id)?.name ?? id;
  const demand = (id: string) => project.rooms.find(r => r.id === id)?.proctorsRequired;
</script>
<div class="filter-bar rooms-toolbar">
  <div class="type-switch" role="group" aria-label={t('Room view', 'มุมมองห้องสอบ')}>
    <button class:active={mode === 'room'} aria-pressed={mode === 'room'} onclick={() => { mode = 'room'; }}>{t('By room', 'ตามห้อง')}</button>
    <button class:active={mode === 'time'} aria-pressed={mode === 'time'} onclick={() => { mode = 'time'; }}>{t('By time', 'ตามเวลา')}</button>
  </div>
  <label class="search-field"><Icon name="search" /><span class="visually-hidden">{t('Search rooms', 'ค้นหาห้อง')}</span><input type="search" placeholder={t('Room name', 'ชื่อห้อง')} bind:value={query} /></label>
</div>
{#if !project.rooms.length}
  <div class="empty-state"><Icon name="calendar" size={34} /><h3>{t('No room data', 'ไม่มีข้อมูลห้องสอบ')}</h3><p>{t('Import a room file to assign rooms to timed examinations.', 'นำเข้าไฟล์ห้องสอบเพื่อจัดห้องให้รายการที่มีเวลาแล้ว')}</p></div>
{:else}
  {#if unassigned.length}<div class="app-notice warning" role="status"><Icon name="info" size={17} /><p>{unassigned.length} {t('managed examinations still need a room. They are listed, never hidden.', 'รายการที่จัดอัตโนมัติยังไม่มีห้อง แสดงไว้ด้านล่างเสมอ')}</p></div>{/if}
  {#if mode === 'room'}
    <div class="register-grid room-register-grid">
      {#each rooms as room (room.id)}{@const duties = timed.filter(e => e.roomAssignments.includes(room.id)).sort((a, b) => (a.timing!.date < b.timing!.date ? -1 : 1) || a.timing!.startMinutes - b.timing!.startMinutes)}
        <section class="panel register">
          <h2>{room.name}</h2>
          {#if SHOW_PROCTORS || room.zones.length || room.tags.includes('computer')}
          <p class="muted">{SHOW_PROCTORS
            ? `${room.zones.length ? `${t('Zones', 'โซน')}: ${room.zones.join(' ')} · ` : ''}${room.tags.includes('computer') ? `${t('Computer', 'คอมพิวเตอร์')} · ` : ''}${demand(room.id) !== undefined ? `${demand(room.id)} ${t('proctors required', 'จำนวนผู้คุมสอบที่ต้องการ')}` : t('No proctor demand recorded', 'ไม่ระบุจำนวนผู้คุมสอบ')}`
            : `${room.zones.length ? `${t('Zones', 'โซน')}: ${room.zones.join(' ')}${room.tags.includes('computer') ? ' · ' : ''}` : ''}${room.tags.includes('computer') ? t('Computer', 'คอมพิวเตอร์') : ''}`}</p>
          {/if}
          {#if duties.length}
            <ul class="register-list">{#each duties as event}<li><button class="calendar-event" onclick={() => onselect(event.id)}><span class="calendar-time">{dateLabel(event.timing!.date)} · {timingLabel(event)}</span><strong>{event.courseCode}</strong><span class="calendar-course-name">{courseName(project, event.courseCode)}{#if SHOW_PROCTORS} · {event.proctorAssignments.length}{demand(room.id) !== undefined ? `/${demand(room.id)}` : ''} {t('proctors', 'ผู้คุมสอบ')}{/if}</span></button></li>{/each}</ul>
          {:else}<p class="empty-help">{t('No examinations assigned to this room.', 'ยังไม่มีวิชาที่ใช้ห้องนี้')}</p>{/if}
        </section>
      {/each}
    </div>
  {:else}
    <div class="table-scroll" role="region" aria-label={t('Rooms by time', 'ห้องสอบตามเวลา')}>
      <table class="exam-table"><thead><tr><th scope="col">{t('Date', 'วันที่')}</th><th scope="col">{t('Time', 'เวลา')}</th><th scope="col">{t('Course', 'วิชา')}</th><th scope="col">{t('Room', 'ห้อง')}</th>{#if SHOW_PROCTORS}<th scope="col">{t('Proctors', 'ผู้คุมสอบ')}</th>{/if}</tr></thead><tbody>
        {#each timed.filter(e => e.roomAssignments.length).sort((a, b) => (a.timing!.date < b.timing!.date ? -1 : 1) || a.timing!.startMinutes - b.timing!.startMinutes) as event (event.id)}
          {@const need = demand(event.roomAssignments[0])}
          <tr><td class="cell-primary" data-label={t('Date', 'วันที่')}>{dateLabel(event.timing!.date)}</td><td class="time-cell" data-label={t('Time', 'เวลา')}>{timingLabel(event)}</td><td data-label={t('Course', 'วิชา')}><button class="course-link" onclick={() => onselect(event.id)}>{event.courseCode}</button></td><td data-label={t('Room', 'ห้อง')}>{roomName(event.roomAssignments[0])}</td>{#if SHOW_PROCTORS}<td class:error-status={need !== undefined && event.proctorAssignments.length < need} data-label={t('Proctors', 'ผู้คุมสอบ')}>{event.proctorAssignments.length}{need !== undefined ? `/${need}` : ''}</td>{/if}</tr>
        {/each}
      </tbody></table>
    </div>
    {#if unassigned.length}
      <section class="panel"><h2>{t('Without a room', 'ยังไม่มีห้อง')}</h2><div class="inline-actions">{#each unassigned as event}<button class="button secondary compact" onclick={() => onselect(event.id)}>{event.courseCode} · {dateLabel(event.timing!.date)}</button>{/each}</div></section>
    {/if}
  {/if}
{/if}
