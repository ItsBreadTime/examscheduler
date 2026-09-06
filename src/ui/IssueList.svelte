<script lang="ts">
  import { onMount } from 'svelte';
  import type { Project, ValidationIssue } from '../lib/types.ts';
  import { candidateReasonLabel, issueMessage, issueTitle, severityLabel, sourceLabel, originLabel } from './format.ts';
  import { t } from './i18n.svelte.ts';
  import Icon from './Icon.svelte';
  let { issues, project, oncourse, compact = false }: { issues: ValidationIssue[]; project: Project; oncourse?: (code: string) => void; compact?: boolean } = $props();
  type IssueGroup = { key: string; issues: ValidationIssue[] };
  let severity = $state('all');
  let origin = $state('all');
  let query = $state('');
  const pageSize = 30;
  let limit = $state(pageSize);
  let loadSentinel = $state<HTMLDivElement | null>(null);
  let infiniteObserver: IntersectionObserver | null = null;
  let canObserve = $state(true);
  const severityRank = (value: ValidationIssue['severity']) => value === 'error' ? 0 : value === 'warning' ? 1 : 2;
  let filtered = $derived.by(() => {
    const search = query.trim().toLowerCase();
    return issues
      .filter(i => (severity === 'all' || i.severity === severity) && (origin === 'all' || i.origin === origin) && `${issueTitle(i)} ${issueMessage(i)} ${i.message} ${i.courseCodes.join(' ')} ${i.studentGroups.join(' ')}`.toLowerCase().includes(search))
      .map((issue, index) => ({ issue, index }))
      .sort((a, b) => severityRank(a.issue.severity) - severityRank(b.issue.severity) || a.index - b.index)
      .map(({ issue }) => issue);
  });
  let groups = $derived.by(() => {
    const grouped = new Map<string, IssueGroup>();
    for (const issue of filtered) {
      // Errors with one exact validator topic are one actionable finding; warnings and
      // informational rows keep their individual evidence and remain separate.
      const key = issue.severity === 'error' ? `error:${issue.type}` : `issue:${issue.id}`;
      const existing = grouped.get(key);
      if (existing) existing.issues.push(issue);
      else grouped.set(key, { key, issues: [issue] });
    }
    return [...grouped.values()];
  });
  let visibleGroups = $derived(groups.slice(0, compact ? 6 : limit));
  let hasMore = $derived(!compact && groups.length > limit);
  function loadMore() {
    if (hasMore) limit = Math.min(limit + pageSize, groups.length);
  }
  function resetLimit() { limit = pageSize; }
  $effect(() => {
    void visibleGroups.length;
    if (compact || !loadSentinel || !infiniteObserver || !hasMore) return;
    infiniteObserver.unobserve(loadSentinel);
    infiniteObserver.observe(loadSentinel);
  });
  onMount(() => {
    if (compact) return;
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
  const unique = (values: string[]) => [...new Set(values)];
  const groupCourses = (group: IssueGroup) => unique(group.issues.flatMap(issue => issue.courseCodes));
  const groupSummary = (group: IssueGroup) => {
    const courses = groupCourses(group);
    return courses.length ? courses.join(' · ') : unique(group.issues.map(issueMessage)).join(' · ');
  };
  const sourceEvidence = (refs: ValidationIssue['sourceRefs']) => [...new Map(refs.map(ref => [`${ref.artifactId}:${ref.sheet ?? ''}:${ref.row ?? ''}:${ref.column ?? ''}`, ref])).values()];
  const actionFor = (issue: ValidationIssue) => issue.type === 'PROCTOR_INELIGIBLE' || issue.type === 'PROCTOR_SOURCE_TERM_MISMATCH' || issue.type === 'PROCTOR_MATRIX_QUARANTINED'
    ? t('Re-import a current-term proctor file before assigning again.', 'กรุณานำเข้าไฟล์ผู้คุมของภาคการศึกษาปัจจุบันก่อนจัดผู้คุมอีกครั้ง')
    : issue.type === 'PROCTOR_DEMAND_UNKNOWN'
      ? t('Enter a positive proctor count in the room source, then import it again.', 'ระบุจำนวนผู้คุมที่เป็นจำนวนบวกในไฟล์ห้องสอบแล้วนำเข้าอีกครั้ง')
      : issue.type === 'PROCTOR_REQUIREMENT_UNSATISFIED'
        ? t('Review candidate diagnostics and the eligible roster before changing timings.', 'ตรวจสอบรายละเอียดผู้สมัครและรายชื่อที่มีสิทธิ์ก่อนเปลี่ยนเวลาสอบ')
        : issue.type === 'PROCTOR_ASSIGNMENT_SEARCH_EXHAUSTED'
          ? t('Review candidate diagnostics or widen the available sessions; the remaining shortage is not proven unavoidable.', 'ตรวจสอบรายละเอียดผู้สมัครหรือเพิ่มช่วงเวลาที่ใช้ได้ ปัญหาที่เหลือยังไม่ได้พิสูจน์ว่าเลี่ยงไม่ได้')
          : issue.type === 'HOLIDAYS_NOT_CONFIGURED'
            ? t('Add holiday dates in the exam calendar settings.', 'เพิ่มวันหยุดในส่วนปฏิทินการสอบ')
            : issue.origin === 'source' ? t('Correct the original data and import it again.', 'แก้ไขไฟล์ต้นทางแล้วนำเข้าอีกครั้ง') : t('Review the affected exam timings.', 'ตรวจสอบเวลาสอบของวิชาที่เกี่ยวข้อง');
</script>
{#if !compact}
  <div class="filter-bar mobile-filter-bar">
    <label class="search-field"><Icon name="search" /><span class="visually-hidden">{t('Search issues', 'ค้นหาข้อควรตรวจสอบ')}</span><input type="search" placeholder={t('Search courses or issues', 'ค้นหาวิชาหรือปัญหา')} bind:value={query} oninput={resetLimit} /></label>
    <div class="filter-controls">
      <label><span class="visually-hidden">{t('Severity', 'ระดับปัญหา')}</span><select bind:value={severity} onchange={resetLimit}><option value="all">{t('All severities', 'ทุกระดับ')}</option><option value="error">{t('Errors', 'ข้อผิดพลาด')}</option><option value="warning">{t('Warnings', 'คำเตือน')}</option><option value="info">{t('Information', 'ข้อมูล')}</option></select></label>
      <label><span class="visually-hidden">{t('Issue origin', 'ที่มาของปัญหา')}</span><select bind:value={origin} onchange={resetLimit}><option value="all">{t('All origins', 'ทุกที่มา')}</option><option value="source">{t('Source', 'ต้นทาง')}</option><option value="generated">{t('Generated', 'ผลการจัด')}</option><option value="manual">{t('Manual', 'แก้ไขเอง')}</option><option value="resource">{t('Resource', 'ทรัพยากร')}</option></select></label>
    </div>
  </div>
{/if}
<div class="issue-list">
  {#each visibleGroups as group (group.key)}
    {@const issue = group.issues[0]}
    <details class="issue-row">
      <summary><span class:error-tone={issue.severity === 'error'} class:warning-tone={issue.severity === 'warning'}><Icon name={issue.severity === 'error' ? 'alert' : 'info'} size={19} /></span><span class="issue-copy"><strong>{issueTitle(issue)}{#if group.issues.length > 1}<span class="issue-count">{group.issues.length} {t('findings', 'รายการ')}</span>{/if}</strong><small>{groupSummary(group)}</small></span><span class="issue-origin">{originLabel(issue.origin)}</span><span class="status" class:error-status={issue.severity === 'error'} class:warning-status={issue.severity === 'warning'}>{severityLabel(issue.severity)}</span><span class="issue-chevron" aria-hidden="true"><Icon name="arrow" size={15} /></span></summary>
      <div class="issue-evidence">
        {#each group.issues as issue (issue.id)}
          <div class:issue-group-member={group.issues.length > 1}>
            {#if group.issues.length > 1}<p class="issue-member-label"><strong>{issue.courseCodes.join(' · ') || t('Finding details', 'รายละเอียดข้อค้นพบ')}</strong></p>{/if}
            <p>{issueMessage(issue)}</p>
            {#if issue.studentGroups.length}<p><strong>{t('Shared groups', 'กลุ่มนักศึกษาที่ใช้ร่วมกัน')}:</strong> {issue.studentGroups.join(', ')}</p>{/if}
            {#if issue.blockedCandidates?.length}
              <h3>{t('Candidate diagnostics', 'รายละเอียดผู้สมัคร')}</h3>
              <ul class="evidence-list candidate-diagnostics">
                {#each issue.blockedCandidates as candidate (candidate.proctorId)}
                  {@const proctor = project.proctors.find(p => p.id === candidate.proctorId)}
                  {@const refs = sourceEvidence(candidate.sourceRefs)}
                  <li>
                    <strong>{proctor?.displayName ?? candidate.proctorId}</strong>
                    <p>{candidate.reasons.map(candidateReasonLabel).join(' · ')}</p>
                    {#if candidate.eventIds.length}<p class="muted">{t('Overlapping duties', 'หน้าที่ที่ซ้อนเวลา')}: {candidate.eventIds.join(', ')}</p>{/if}
                    {#if refs.length}<p class="muted">{t('Source', 'แหล่งที่มา')}: {refs.map(ref => `${sourceLabel(project, ref.artifactId)}${ref.sheet ? ` · ${ref.sheet}` : ''}${ref.row ? ` · ${t('Row', 'แถว')} ${ref.row}` : ''}${ref.column ? ` · ${t('Column', 'คอลัมน์')} ${ref.column}` : ''}`).join(' / ')}</p>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if oncourse && issue.courseCodes.length}<div class="inline-actions">{#each unique(issue.courseCodes) as code}<button class="text-button" onclick={() => oncourse?.(code)}>{t(`View ${code}`, `ดูวิชา ${code}`)} <Icon name="arrow" size={14} /></button>{/each}</div>{/if}
            {#if issue.sourceRefs.length}
              <h3>{t('Source evidence', 'หลักฐานจากไฟล์ต้นทาง')}</h3>
              <ul class="evidence-list">{#each issue.sourceRefs as ref}{@const section = project.sections.find(s => s.sourceRef?.artifactId === ref.artifactId && s.sourceRef?.sheet === ref.sheet && s.sourceRef?.row === ref.row)}<li><strong>{sourceLabel(project, ref.artifactId)}</strong>{#if ref.sheet} · {ref.sheet}{/if}{#if ref.row} · {t(`Row`, 'แถว')} {ref.row}{/if}{#if ref.column} · {t('Column', 'คอลัมน์')} {ref.column}{/if}{#if section}<p>{section.courseCode}{section.courseName ? ` · ${section.courseName}` : ''}{section.sectionNumber !== undefined ? ` · ${t('Section', 'ตอน')} ${section.sectionNumber}` : ''}</p>{#if section.studentGroups?.length}<p>{t('Groups', 'กลุ่ม')}: {section.studentGroups.join(', ')}</p>{/if}{/if}</li>{/each}</ul>
            {/if}
            <p class="muted">{actionFor(issue)}</p>
          </div>
        {/each}
      </div>
    </details>
  {:else}<div class="empty-state small"><Icon name="check" size={28} /><h3>{t('No issues found', 'ไม่พบข้อควรตรวจสอบ')}</h3><p>{issues.length ? t('Try another filter.', 'ลองเปลี่ยนตัวกรอง') : t('No issues were reported by these checks.', 'ไม่พบปัญหาจากรายการตรวจสอบนี้')}</p></div>{/each}
</div>
{#if !compact}
  <div class="infinite-scroll-sentinel" bind:this={loadSentinel} aria-hidden="true"></div>
  {#if !canObserve && hasMore}<button class="button secondary load-more" onclick={loadMore}>{t('Load more', 'โหลดเพิ่ม')} ({groups.length - limit})</button>{/if}
{/if}
{#if !compact}<p class="table-footnote">{filtered.length} {t('issues', 'รายการ')}</p>{/if}
{#if !compact}<span class="visually-hidden" aria-live="polite">{hasMore ? t('More issues load automatically as you scroll.', 'เลื่อนลงเพื่อโหลดข้อควรตรวจสอบเพิ่มเติมโดยอัตโนมัติ') : t('Everything matching the current filter is shown.', 'แสดงข้อควรตรวจสอบตามตัวกรองครบแล้ว')}</span>{/if}
