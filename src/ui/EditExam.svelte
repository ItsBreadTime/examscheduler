<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Project } from '../lib/types.ts';
  import { runJob } from './jobs.ts';
  import { friendlyError, localizedText, type LocalizedText } from './errors.ts';
  import type { EditPreview } from './jobs.ts';
  import { courseName, clockTime, examLabel, sourceLabel } from './format.ts';
  import { t } from './i18n.svelte.ts';
  import IssueList from './IssueList.svelte';
  import Icon from './Icon.svelte';
  let { project, eventId, onclose, onsave }: { project: Project; eventId: string; onclose: () => void; onsave: (preview: EditPreview) => void } = $props();
  const event = untrack(() => project.events.find(e => e.id === eventId))!;
  const settings = untrack(() => $state.snapshot(project.settings));
  const fixed = event.ownership === 'context' || event.timingOrigin === 'imported';
  let dialog: HTMLDialogElement;
  let date = $state(event.timing?.date ?? settings.periods[event.examType].start);
  let start = $state(clockTime(event.timing?.startMinutes ?? settings.sessions[0].startMinutes));
  let end = $state(clockTime(event.timing?.endMinutes ?? (event.fullDay ? settings.fullDay.endMinutes : settings.sessions[0].endMinutes)));
  let preview = $state.raw<EditPreview | null>(null);
  let busy = $state(false);
  let error = $state<LocalizedText | null>(null);
  let task: ReturnType<typeof runJob> | undefined;
  onMount(() => { dialog.showModal(); return () => task?.cancel(); });
  function changed() { preview = null; error = null; }
  async function check(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = null; preview = null;
    const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    try { task = runJob({ type: 'edit', project, eventId, timing: { date, startMinutes: minutes(start), endMinutes: minutes(end) } }); const result = await task.promise; if (result.type === 'edit') preview = result.preview; } catch (e) { error = friendlyError(e); } finally { task = undefined; busy = false; }
  }
</script>
<dialog bind:this={dialog} class="exam-dialog" onclose={onclose} aria-labelledby="edit-title">
  <div class="dialog-heading"><div><h2 id="edit-title">{event.courseCode}</h2><p>{courseName(project, event.courseCode)}</p><span class="muted">{examLabel(event.examType)} · {event.sectionIds.length} {t('sections', 'ตอน')}</span></div><button class="icon-button" aria-label={t('Close details', 'ปิดรายละเอียด')} onclick={() => dialog.close()}><Icon name="close" /></button></div>
  <div class="dialog-body">
    {#if fixed}<div class="notice"><Icon name="lock" /><p>{t('This is an imported examination. Its timing is fixed.', 'เวลาสอบนี้มาจากไฟล์ต้นทางและไม่สามารถย้ายได้')}</p></div>{/if}
    {#if event.blocked}<div class="notice danger"><Icon name="alert" /><p>{t('Resolve this course’s source issues before assigning a time.', 'แก้ไขปัญหาข้อมูลของวิชานี้ก่อนกำหนดเวลาสอบ')}</p></div>{/if}
    <form onsubmit={check}><fieldset disabled={fixed || busy || event.blocked}><div class="edit-fields"><label>{t('Date', 'วันที่')}<input type="date" bind:value={date} onchange={changed} required /></label><label>{t('Start', 'เริ่ม')}<input type="time" bind:value={start} onchange={changed} required /></label><label>{t('End', 'สิ้นสุด')}<input type="time" bind:value={end} onchange={changed} required /></label></div>{#if !fixed}<p class="muted">{t('Same-time courses are updated together. New conflicts prevent saving.', 'วิชาที่ต้องสอบพร้อมกันจะเปลี่ยนเวลาไปด้วยกัน บันทึกไม่ได้หากเกิดข้อขัดแย้งใหม่')}</p><button type="submit" class="button secondary" disabled={event.blocked}>{busy ? t('Checking…', 'กำลังตรวจสอบ') : t('Preview change', 'ตรวจสอบการเปลี่ยนแปลง')}</button>{/if}</fieldset></form>
    {#if error}<p class="form-error" role="alert">{localizedText(error)}</p>{/if}
    {#if preview}<div class="edit-preview" aria-live="polite">{#if preview.accepted}<div class="notice success"><Icon name="check" /><p>{t(`No blocking conflicts. ${preview.affectedIds.length} exam(s) will be locked.`, `ไม่พบข้อขัดแย้งที่ขัดขวางการแก้ไข จะล็อกเวลา ${preview.affectedIds.length} วิชา`)}</p></div>{:else}<div class="notice danger"><Icon name="alert" /><p>{t('This change cannot be saved.', 'ไม่สามารถบันทึกการเปลี่ยนแปลงนี้')}</p></div><IssueList issues={preview.blockingIssues} project={preview.project} compact />{/if}</div>{/if}
    <h3>{t('Student groups', 'กลุ่มนักศึกษา')}</h3>
    <p class="group-values">{event.studentGroups.join(' · ') || t('Missing', 'ไม่ระบุ')}</p>
    <details class="source-details"><summary>{t('Source rows', 'แถวข้อมูลต้นทาง')} ({event.sourceRefs.length})</summary><ul class="evidence-list">{#each event.sourceRefs as ref}<li>{sourceLabel(project, ref.artifactId)} · {ref.sheet} · {t('Row', 'แถว')} {ref.row}</li>{/each}</ul></details>
  </div>
  <div class="dialog-footer"><button class="button secondary" onclick={() => dialog.close()}>{t('Close', 'ปิด')}</button>{#if !fixed}<button class="button primary" disabled={!preview?.accepted || busy} onclick={() => { if (preview?.accepted) onsave(preview); }}>{t('Save & lock timing', 'บันทึกและล็อกเวลา')} <Icon name="lock" size={16} /></button>{/if}</div>
</dialog>
