<script lang="ts">
  import type { ExamType, Project, ValidationReport } from './lib/types.ts';
  import type { ProjectInput } from './lib/project.ts';
  import { inspectImport } from './lib/project.ts';
  import { runJob, CancelledError } from './ui/jobs.ts';
  import { friendlyError, localized, localizedText, type LocalizedText } from './ui/errors.ts';
  import { coverageChecks } from './lib/validator.ts';
  import { validateProject } from './lib/validator.ts';
  import { scheduleQuality } from './lib/quality.ts';
  import { summarizeAssignedResources } from './lib/resources.ts';
  import type { ResourceSummary } from './lib/resources.ts';
  import type { AuditBundle } from './lib/audit.ts';
  import { buildAuditBundle } from './lib/audit.ts';
  import { createZip } from './lib/zip.ts';
  import { cacheProject, loadCachedProject } from './ui/cache.ts';
  import type { CloudConnection, ShareLinkInfo } from './ui/cache.ts';
  import { createCloudProject, createCloudShare, fetchShareAudit, fetchShareSnapshot, fetchShareSource, fetchShareValidation, parseShareRef, revokeCloudShare, saveCloudRevision, RevisionConflictError } from './lib/api.ts';
  import type { SharePermission } from './lib/api.ts';
  import type { EditPreview, Inspection, ScheduleResult } from './ui/jobs.ts';
  import { dateLabel, examLabel, originLabel, coverageName } from './ui/format.ts';
  import { i18n, t } from './ui/i18n.svelte.ts';
  import { describeDraftFile, draftSignature } from './ui/draft.ts';
  import { SHOW_PROCTORS, SHOW_ROOMS, SHOW_RESOURCES, visibleIssues, visibleCoverageEntries, visibleValidation } from './ui/flags.ts';
  import SourceImport from './ui/SourceImport.svelte';
  import IssueList from './ui/IssueList.svelte';
  import ExamTable from './ui/ExamTable.svelte';
  import CalendarView from './ui/CalendarView.svelte';
  import RoomView from './ui/RoomView.svelte';
  import ProctorView from './ui/ProctorView.svelte';
  import AuditView from './ui/AuditView.svelte';
  import CloudView from './ui/CloudView.svelte';
  import HelpView from './ui/HelpView.svelte';
  import EditExam from './ui/EditExam.svelte';
  import Icon from './ui/Icon.svelte';
  import fitmLogo from './assets/fitm-logo.png';
  import { onMount } from 'svelte';

  type View = 'sources' | 'review' | 'overview' | 'exams' | 'calendar' | 'groups' | 'rooms' | 'proctors' | 'issues' | 'cloud' | 'audit' | 'help';
  const navItems: { id: View; icon: string; en: string; th: string }[] = [
    { id: 'sources', icon: 'upload', en: 'Sources & setup', th: 'ข้อมูลและการตั้งค่า' },
    { id: 'review', icon: 'review', en: 'Review data', th: 'ตรวจสอบข้อมูล' },
    { id: 'overview', icon: 'overview', en: 'Overview', th: 'ภาพรวม' },
    { id: 'exams', icon: 'table', en: 'Exams', th: 'รายวิชา' },
    { id: 'calendar', icon: 'calendar', en: 'Calendar', th: 'ปฏิทิน' },
    { id: 'groups', icon: 'groups', en: 'Student groups', th: 'กลุ่มนักศึกษา' },
    { id: 'rooms', icon: 'calendar', en: 'Rooms', th: 'ห้องสอบ' },
    { id: 'proctors', icon: 'groups', en: 'Proctors', th: 'ผู้คุมสอบ' },
    { id: 'issues', icon: 'alert', en: 'Issues', th: 'ข้อควรตรวจสอบ' },
    { id: 'cloud', icon: 'cloud', en: 'Save & share', th: 'บันทึกและแชร์' },
    { id: 'audit', icon: 'lock', en: 'Audit', th: 'ตรวจสอบ' },
  ];
  const navItemsShown = navItems.filter(item => (SHOW_PROCTORS || item.id !== 'proctors') && (SHOW_ROOMS || item.id !== 'rooms'));
  // Phone navigation (≤880px): five thumb-reach tabs plus a More sheet; the desktop rail is untouched above 880px.
  const tabIds: View[] = ['sources', 'overview', 'exams', 'calendar', 'issues'];
  const tabShort: Partial<Record<View, { en: string; th: string }>> = {
    sources: { en: 'Sources', th: 'ข้อมูล' },
    issues: { en: 'Issues', th: 'ปัญหา' },
  };
  const tabItems = navItemsShown.filter(item => tabIds.includes(item.id));
  const moreItems = navItemsShown.filter(item => !tabIds.includes(item.id));
  const tabLabel = (item: (typeof navItems)[number]) => {
    const short = tabShort[item.id];
    return short ? t(short.en, short.th) : t(item.en, item.th);
  };
  const coverageLabel = coverageName;
  const viewTitles: Record<View, { en: string; th: string; lead: string; leadTh: string }> = {
    review: { en: 'Review the imported data', th: 'ตรวจสอบข้อมูลที่นำเข้า', lead: 'Check sources, terms and source conflicts before generating a schedule.', leadTh: 'ตรวจสอบไฟล์ ภาคการศึกษา และข้อขัดแย้งก่อนจัดตารางสอบ' },
    overview: { en: 'Schedule overview', th: 'ภาพรวมตารางสอบ', lead: 'What is scheduled, what remains unresolved, and which checks actually ran.', leadTh: 'สรุปว่าจัดแล้วเท่าไร เหลืออะไร และตรวจสอบอะไรไปแล้ว' },
    exams: { en: 'Examinations', th: 'รายการสอบ', lead: 'Search every examination, open details and adjust managed timings.', leadTh: 'ค้นหารายการสอบ เปิดรายละเอียด และแก้ไขเวลาของวิชาที่จัดอัตโนมัติ' },
    calendar: { en: 'Exam calendar', th: 'ปฏิทินสอบ', lead: 'The generated timetable, week by week, with fixed days marked.', leadTh: 'ตารางสอบรายสัปดาห์พร้อมวันที่ล็อกไว้' },
    groups: { en: 'Student groups', th: 'กลุ่มนักศึกษา', lead: 'Pick a student group to read its personal exam timetable.', leadTh: 'เลือกกลุ่มนักศึกษาเพื่อดูตารางสอบของกลุ่ม' },
    issues: { en: 'Issues', th: 'ข้อควรตรวจสอบ', lead: 'Every finding with its origin, source rows and affected courses.', leadTh: 'ทุกข้อค้นพบพร้อมที่มา แถวข้อมูลต้นทาง และวิชาที่เกี่ยวข้อง' },
    rooms: { en: 'Rooms', th: 'ห้องสอบ', lead: 'Which room hosts each timed examination, and which examinations still need one.', leadTh: 'ห้องสอบของแต่ละวิชา และวิชาที่ยังไม่มีห้อง' },
    proctors: { en: 'Proctors', th: 'ผู้คุมสอบ', lead: 'Roster, workload and availability, with source terms and quarantined candidates kept visible.', leadTh: 'รายชื่อ ภาระงาน และเวลาว่าง พร้อมแสดงภาคการศึกษาต้นทางและผู้สมัครที่ถูกกักกัน' },
    cloud: { en: 'Save & share', th: 'บันทึกและแชร์', lead: 'Save immutable revisions to your cloud server and hand out scoped, revocable links.', leadTh: 'บันทึกฉบับที่แก้ไขไม่ได้ขึ้นเซิร์ฟเวอร์ของคุณ และแชร์ลิงก์ที่กำหนดขอบเขตและเพิกถอนได้' },
    audit: { en: 'Audit', th: 'ตรวจสอบ', lead: 'What the scheduler produced, which checks passed or failed, and the machine-readable record you can download or share.', leadTh: 'สิ่งที่ตัวจัดตารางสร้างขึ้น รายการตรวจที่ผ่านหรือไม่ผ่าน และชุดข้อมูลที่ดาวน์โหลดหรือแชร์ได้' },
    help: { en: 'How it works', th: 'วิธีใช้งาน', lead: 'A field guide to the scheduling workflow, input format and synthetic samples.', leadTh: 'คู่มือขั้นตอนการจัดตาราง รูปแบบข้อมูล และไฟล์ตัวอย่าง' },
    sources: { en: '', th: '', lead: '', leadTh: '' },
  };

  let view = $state<View>('sources');
  let examType = $state<ExamType>('midterm');
  let project = $state.raw<Project | null>(null);
  let inspection = $state.raw<Inspection | null>(null);
  let result = $state.raw<ScheduleResult | null>(null);
  let importing = $state(false);
  let generating = $state(false);
  let resourcing = $state(false);
  let exporting = $state(false);
  let resourceSummary = $state<ResourceSummary | null>(null);
  let audit = $state.raw<AuditBundle | null>(null);
  let auditBusy = $state(false);
  let cachedSources = $state<{ name: string; kind: 'course' | 'rules' | 'rooms' | 'proctors'; role?: string; bytes: Uint8Array }[]>([]);
  let importError = $state<LocalizedText | null>(null);
  let generateError = $state<LocalizedText | null>(null);
  let noticeText = $state<{ en: string; th: string } | null>(null);
  let noticeTone = $state<'success' | 'warning'>('success');
  let dirty = $state(false);
  let importedSignature = '';
  let editId = $state('');
  let examQuery = $state('');
  let groupQuery = $state('');
  let selectedGroup = $state('');
  let task: ReturnType<typeof runJob> | undefined;
  let jobToken = 0;

  let notice = $derived(noticeText ? t(noticeText.en, noticeText.th) : '');
  function setNotice(en: string, th: string) { noticeText = { en, th }; }
  function clearNotice() { noticeText = null; }
  // Notices float: success confirmations dismiss themselves; warnings stay until closed.
  $effect(() => {
    if (!noticeText || noticeTone !== 'success') return;
    const timer = setTimeout(() => { noticeText = null; }, 7000);
    return () => clearTimeout(timer);
  });

  let moreOpen = $state(false);
  let moreSheet = $state<HTMLDialogElement | null>(null);
  let moreActive = $derived(moreItems.some(item => item.id === view) || view === 'help');
  $effect(() => {
    if (!moreSheet) return;
    if (moreOpen && !moreSheet.open) moreSheet.showModal();
    if (!moreOpen && moreSheet.open) moreSheet.close();
  });

  // Cloud session (plan §50-65): the connection this browser holds, the shares it created,
  // and the read-only share view when the app was opened through a link.
  interface ShareSession { shareId: string; secret: string; projectId: string | null; projectName: string; permission: SharePermission; revisionId: string }
  let shareState = $state.raw<ShareSession | null>(null);
  let loadingShare = $state(false);
  let cloudConn = $state.raw<CloudConnection | null>(null);
  let shares = $state.raw<ShareLinkInfo[]>([]);
  // The deployed worker co-hosts the API, so production defaults to same-origin ('');
  // the Vite dev server has no proxy, so development keeps the local worker on :8787.
  let cloudServer = $state(localStorage.getItem('cloud.server') ?? (import.meta.env.DEV ? 'http://127.0.0.1:8787' : ''));
  let cloudSaving = $state(false);
  let shareSaving = $state(false);
  let cloudError = $state<LocalizedText | null>(null);
  let cloudDirty = $state(false);
  let cloudPending = $state(false);
  let autosaveOn = $state(localStorage.getItem('cloud.autosave') !== 'off');
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let cloudConflict = $state.raw<{ cloudRevisionId: string; localHash: string; cloudHash: string; cloudProject: Project } | null>(null);
  let conflictDialog = $state<HTMLDialogElement | null>(null);

  const shareNav = (permission: SharePermission): View[] => permission === 'schedule'
    ? ['overview', 'exams', 'calendar', 'groups', ...(SHOW_ROOMS ? (['rooms'] as const) : [])]
    : ['overview', 'exams', 'calendar', 'groups', ...(SHOW_ROOMS ? (['rooms'] as const) : []), ...(SHOW_PROCTORS ? (['proctors'] as const) : []), 'issues', 'audit'];
  const available = (target: View) => target === 'help' ? true : shareState
    ? shareNav(shareState.permission).includes(target)
    : target === 'sources' ? true : target === 'review' ? !!project : !!result;
  const navBlockedWhy = (target: View) => target === 'review'
    ? t('Import your source files first.', 'กรุณานำเข้าไฟล์ข้อมูลก่อน')
    : t('Generate a schedule to open this view.', 'จัดตารางสอบก่อนจะเปิดหน้านี้ได้');
  const data = $derived(result?.project ?? null);
  const typeViews = new Set<View>(['exams', 'calendar', 'groups', 'rooms']);
  const policyLabel = (p: string) => t({ only_if_necessary: 'Only if necessary', never: 'Never', normal: 'Normal' }[p] ?? p, { only_if_necessary: 'ใช้เมื่อจำเป็น', never: 'ไม่ใช้วันเหล่านี้', normal: 'ใช้ได้ตามปกติ' }[p] ?? p);

  let generateSummary = $derived.by(() => {
    if (!inspection) return null;
    const issues = visibleIssues(inspection.issues);
    return { blocking: issues.filter(i => i.severity === 'error'), warnings: issues.filter(i => i.severity === 'warning') };
  });
  // The interface shows the validation report with proctor findings withheld (flags.ts);
  // status, coverage and counts are all recomputed from the visible issues so nothing disagrees.
  let vValidation = $derived(result ? visibleValidation(result.validation) : null);
  let reviewIssues = $derived(inspection ? visibleIssues(inspection.issues) : []);
  let overview = $derived.by(() => {
    if (!result || !vValidation) return null;
    const current = result;
    const issues = vValidation.issues;
    const types: { type: ExamType; required: number; scheduled: number; unscheduled: number; fixed: number; locked: number }[] = (['midterm', 'final'] as const).map(type => {
      const events = current.project.events.filter(e => e.examType === type);
      return { type, required: events.filter(e => e.required && e.ownership === 'managed').length, scheduled: events.filter(e => e.required && e.ownership === 'managed' && e.timing).length, unscheduled: events.filter(e => e.required && e.ownership === 'managed' && !e.timing).length, fixed: events.filter(e => e.timingOrigin === 'imported').length, locked: events.filter(e => e.timingOrigin === 'manual').length };
    });
    const origins = (['source', 'generated', 'manual', 'resource'] as const).map(origin => ({ origin, count: issues.filter(i => i.origin === origin).length }));
    return { types, origins, errors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length, infos: issues.filter(i => i.severity === 'info').length };
  });
  let groupList = $derived(data ? [...new Set(data.events.filter(e => e.examType === examType && e.studentGroups.length).flatMap(e => e.studentGroups))].sort() : []);
  let groupMatches = $derived(groupList.filter(g => g.toLowerCase().includes(groupQuery.trim().toLowerCase())).slice(0, 30));
  let groupStats = $derived.by(() => {
    const events = data?.events.filter(e => e.examType === examType && e.studentGroups.includes(selectedGroup)) ?? [];
    const dated = events.filter(e => e.timing);
    const perDay = new Map<string, number>();
    for (const event of dated) perDay.set(event.timing!.date, (perDay.get(event.timing!.date) ?? 0) + 1);
    return { exams: events.length, unscheduled: events.filter(e => e.required && !e.timing).length, days: perDay.size, doubleDays: [...perDay.values()].filter(n => n > 1).length };
  });
  let coverageCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    if (!result || !vValidation) return counts;
    for (const [key, types] of Object.entries(coverageChecks)) counts[key] = types.length ? vValidation.issues.filter(i => types.includes(i.type)).length : 0;
    return counts;
  });
  const coverageStatusRank = (status: ValidationReport['coverage'][string]) => status === 'failed' ? 0 : status === 'not_checked' ? 1 : 2;
  let coverageEntries = $derived.by(() => result
    ? visibleCoverageEntries(result.validation.coverage).sort(([keyA, a], [keyB, b]) => coverageStatusRank(a as ValidationReport['coverage'][string]) - coverageStatusRank(b as ValidationReport['coverage'][string]) || keyA.localeCompare(keyB))
    : []);
  let shownResourceSummary = $derived(data ? resourceSummary ?? summarizeAssignedResources(data) : null);
  let chip = $derived.by(() => {
    if (!project) return t('No project', 'ยังไม่มีโครงการ');
    if (dirty) return t('Sources changed', 'เปลี่ยนข้อมูลแล้ว');
    if (!result || !vValidation) return t('Draft, not generated', 'ร่าง ยังไม่จัดตาราง');
    return vValidation.overallStatus === 'valid' ? t('Valid', 'ไม่มีข้อขัดแย้ง') : vValidation.overallStatus === 'valid_with_warnings' ? t('Valid with warnings', 'ไม่มีข้อขัดแย้ง มีข้อควรระวัง') : t('Invalid', 'พบข้อขัดแย้ง');
  });

  // The audit bundle is derived from the current schedule, so the Audit tab is never a dead end:
  // it recomputes whenever the result (project + validation) changes and reflects the resources
  // assigned so far. Uses a cancellation guard so a stale async hashing pass is dropped.
  $effect(() => {
    const current = result;
    if (!current) { audit = null; return; }
    let cancelled = false;
    auditBusy = true;
    buildAuditBundle(current.project, current.validation)
      .then(bundle => { if (!cancelled) audit = bundle; })
      .catch(() => { if (!cancelled) audit = null; })
      .finally(() => { if (!cancelled) auditBusy = false; });
    return () => { cancelled = true; };
  });
  let chipTone = $derived(
    !dirty && vValidation?.overallStatus === 'invalid' ? 'error-status'
      : dirty || vValidation?.overallStatus === 'valid_with_warnings' ? 'warning-status'
        : !dirty && vValidation?.overallStatus === 'valid' ? 'success-status' : '',
  );

  $effect(() => {
    document.documentElement.lang = i18n.lang;
    try { localStorage.setItem('lang', i18n.lang); } catch { /* private mode: language just won't persist */ }
    document.title = t('Exam Scheduler · FITM', 'ตัวจัดตารางสอบ · FITM');
  });

  // Imported files and results live only in memory; warn before an accidental reload destroys them.
  $effect(() => {
    if (!project && !result) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  });

  $effect(() => { if (cloudConflict && conflictDialog) conflictDialog.showModal(); });
  onMount(() => { void boot(); });

  function go(target: View) { if (available(target)) { view = target; clearNotice(); } }
  const roleLabel = (role: string | null) => role === 'managed' ? t('Managed', 'จัดอัตโนมัติ') : t('Context', 'จัดไปแล้ว');
  const termLabel = (term?: { academicYearBE: number; semester: number; campus?: string } | null) => term ? `${term.campus ? `${term.campus} · ` : ''}${t(`Semester ${term.semester}/${term.academicYearBE}`, `ภาคการศึกษา ${term.semester}/${term.academicYearBE}`)}` : t('Term unknown', 'ไม่ทราบ');

  async function startImport(input: ProjectInput) {
    if (importing) return;
    importing = true; importError = null; jobToken++;
    task = runJob({ type: 'import', input });
    try {
      const outcome = await task.promise;
      if (outcome.type === 'import') {
        project = outcome.project; inspection = outcome.inspection; result = null;
        resourceSummary = null; audit = null;
        cachedSources = [
          ...input.courseSources.map(s => ({ name: s.name, kind: 'course' as const, role: s.role, bytes: s.bytes })),
          ...(input.rules ? [{ name: input.rules.name, kind: 'rules' as const, bytes: input.rules.bytes }] : []),
          ...((input.references ?? []).map(r => ({ name: r.name, kind: r.kind, bytes: r.bytes }))),
        ];
        const sourceDrafts = await Promise.all(input.courseSources.map(async source => ({ ...(await describeDraftFile(source)), role: source.role })));
        const rulesDraft = input.rules ? await describeDraftFile(input.rules) : undefined;
        const referenceDrafts = await Promise.all((input.references ?? []).map(async reference => ({ ...(await describeDraftFile(reference)), kind: reference.kind })));
        importedSignature = draftSignature(sourceDrafts, rulesDraft, input.settings, referenceDrafts);
        dirty = false; view = 'review'; noticeTone = 'success';
        setNotice('Import finished. Review the findings before generating.', 'นำเข้าเสร็จแล้ว กรุณาตรวจสอบผลก่อนจัดตาราง');
        // A fresh import is a new working session: it saves as a new cloud project, not a revision of the old one.
        cloudConn = null; shares = []; cloudDirty = false;
        persistCache();
      }
    } catch (error) { importError = friendlyError(error); }
    finally { importing = false; task = undefined; }
  }

  async function generate() {
    if (!project || generating || shareState) return;
    const source = project; const token = ++jobToken;
    generating = true; generateError = null; clearNotice();
    task = runJob({ type: 'schedule', project: source });
    try {
      const outcome = await task.promise;
      if (outcome.type !== 'schedule' || token !== jobToken || project !== source) return;
      if (dirty) { generateError = localized('The source settings changed while generating. Import the files again, then generate.', 'ตั้งค่าต้นทางเปลี่ยนระหว่างจัดตาราง กรุณานำเข้าไฟล์อีกครั้ง'); return; }
      result = outcome.result; view = 'overview';
      resourceSummary = null; audit = null;
      cloudDirty = true; persistCache(); queueAutosave();
      const unscheduled = outcome.result.project.events.filter(e => e.required && e.ownership === 'managed' && !e.timing).length;
      noticeTone = unscheduled > 0 || visibleValidation(outcome.result.validation).overallStatus !== 'valid' ? 'warning' : 'success';
      setNotice(`Generation finished: ${unscheduled} exam(s) remain unscheduled because of source problems.`, `จัดตารางเสร็จแล้ว ยังมี ${unscheduled} วิชาที่จัดไม่ได้จากปัญหาข้อมูลต้นทาง`);
    } catch (error) {
      if (error instanceof CancelledError) { noticeTone = 'warning'; setNotice('Generation cancelled. The previous schedule is unchanged.', 'ยกเลิกการจัดตารางแล้ว ตารางเดิมยังอยู่'); }
      else generateError = friendlyError(error);
    } finally { generating = false; task = undefined; }
  }

  function saveEdit(preview: EditPreview) {
    if (!result || !preview.accepted) return;
    const stillUnscheduled = result.unscheduled.filter(reason => reason.eventIds.some(id => preview.project.events.some(e => e.id === id && !e.timing)));
    result = { ...result, project: preview.project, validation: preview.validation, unscheduled: stillUnscheduled };
    resourceSummary = null; audit = null;
    cloudDirty = true; persistCache(); queueAutosave();
    editId = ''; noticeTone = 'success';
    setNotice(
      SHOW_PROCTORS
        ? `Timing saved and locked for ${preview.affectedIds.length} exam(s). Resource assignments were cleared — assign resources again.`
        : `Timing saved and locked for ${preview.affectedIds.length} exam(s). Room assignments were cleared — assign rooms again.`,
      SHOW_PROCTORS
        ? `บันทึกและล็อกเวลาแล้ว ${preview.affectedIds.length} รายการ การจัดห้องและผู้คุมถูกล้าง กรุณาจัดทรัพยากรอีกครั้ง`
        : `บันทึกและล็อกเวลาแล้ว ${preview.affectedIds.length} รายการ การจัดห้องถูกล้าง กรุณาจัดห้องอีกครั้ง`,
    );
  }

  async function assign() {
    if (!result || resourcing || shareState) return;
    const token = ++jobToken;
    resourcing = true; generateError = null;
    task = runJob({ type: 'resources', project: result.project, computerProctorRule: result.project.settings.computerProctorRule });
    try {
      const outcome = await task.promise;
      if (outcome.type !== 'resources' || token !== jobToken) return;
      result = { ...result, project: outcome.result.project, validation: outcome.result.validation };
      resourceSummary = outcome.summary;
      view = 'rooms';
      noticeTone = outcome.summary.roomsUnassigned > 0 || (SHOW_PROCTORS && (outcome.summary.positionsUnfilled > 0 || outcome.summary.eventsWithUnknownProctorDemand > 0 || outcome.summary.ineligibleProctors > 0)) ? 'warning' : 'success';
      cloudDirty = true; persistCache(); queueAutosave();
      setNotice(
        SHOW_PROCTORS
          ? `Resources assigned: ${outcome.summary.roomsAssigned} rooms, ${outcome.summary.positionsFilled}/${outcome.summary.proctorPositions} known proctor positions. ${outcome.summary.eventsWithUnknownProctorDemand} event(s) still have unknown proctor demand.`
          : `Rooms assigned: ${outcome.summary.roomsAssigned} room(s).`,
        SHOW_PROCTORS
          ? `จัดทรัพยากรแล้ว ห้อง ${outcome.summary.roomsAssigned} ห้อง ผู้คุม ${outcome.summary.positionsFilled}/${outcome.summary.proctorPositions} ตำแหน่งที่ทราบ ยังมี ${outcome.summary.eventsWithUnknownProctorDemand} รายการที่ไม่ทราบความต้องการผู้คุม`
          : `จัดห้องแล้ว ${outcome.summary.roomsAssigned} ห้อง`,
      );
    } catch (error) {
      if (!(error instanceof CancelledError)) generateError = friendlyError(error);
    } finally { resourcing = false; task = undefined; }
  }

  async function repair() {
    if (!result || resourcing || shareState) return;
    const token = ++jobToken;
    resourcing = true; generateError = null;
    task = runJob({ type: 'repair', project: result.project });
    try {
      const outcome = await task.promise;
      if (outcome.type !== 'repair' || token !== jobToken) return;
      result = { ...result, project: outcome.result.project, validation: outcome.result.validation };
      resourceSummary = outcome.result.summary;
      cloudDirty = true; persistCache(); queueAutosave();
      const moved = outcome.result.attempts.filter(a => a.accepted).length;
      noticeTone = outcome.result.failuresAfter < outcome.result.failuresBefore ? 'success' : 'warning';
      setNotice(`Repair tried ${outcome.result.attempts.length} move(s), accepted ${moved}. Resource failures: ${outcome.result.failuresBefore} → ${outcome.result.failuresAfter}.`, `ลองย้ายเวลา ${outcome.result.attempts.length} ครั้ง รับ ${moved} ครั้ง ปัญหาทรัพยากร ${outcome.result.failuresBefore} → ${outcome.result.failuresAfter}`);
    } catch (error) {
      if (!(error instanceof CancelledError)) generateError = friendlyError(error);
    } finally { resourcing = false; task = undefined; }
  }

  function setAvailability(proctorId: string, availability: Project['proctors'][number]['availability']) {
    if (!result || shareState) return;
    const next = structuredClone(result.project);
    const proctor = next.proctors.find(p => p.id === proctorId);
    if (!proctor) return;
    proctor.availability = availability;
    task?.cancel();
    task = runJob({ type: 'resources', project: next, computerProctorRule: next.settings.computerProctorRule });
    resourcing = true;
    task.promise.then(outcome => {
      if (outcome.type !== 'resources') return;
      result = { ...result!, project: outcome.result.project, validation: outcome.result.validation };
      resourceSummary = outcome.summary; audit = null;
      cloudDirty = true; persistCache(); queueAutosave();
      noticeTone = 'success';
      setNotice('Availability updated and resources reassigned.', 'อัปเดตเวลาว่างและจัดทรัพยากรใหม่แล้ว');
    }).catch(error => { if (!(error instanceof CancelledError)) generateError = friendlyError(error); })
      .finally(() => { resourcing = false; task = undefined; });
  }

  function download(kind: 'audit' | 'validation') {
    if (!result) return;
    const payload = kind === 'audit' ? audit ?? null : result.validation;
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = kind === 'audit' ? 'audit.json' : 'validation.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function copyAuditInfo() {
    if (!audit) return;
    const info = `Exam Scheduler audit · schema ${audit.schemaVersion} · validator ${audit.validatorVersion} · schedule sha256:${audit.scheduleHash} · POST /api/v1/validate · GET /api/v1/shares/{shareId}/{snapshot,validation,audit}`;
    navigator.clipboard?.writeText(info).then(() => { noticeTone = 'success'; setNotice('Audit API information copied.', 'คัดลอกข้อมูล API แล้ว'); }).catch(e => { generateError = friendlyError(e); });
  }

  async function downloadZip() {
    if (!result || exporting) return;
    exporting = true; generateError = null;
    task = runJob({ type: 'export', project: result.project, validation: result.validation });
    try {
      const outcome = await task.promise;
      if (outcome.type !== 'export') return;
      const bytes = createZip(outcome.files.map(f => ({ path: f.path, bytes: new Uint8Array(f.bytes) })));
      const archive = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(archive); link.download = 'project.zip';
      link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      noticeTone = 'success';
      setNotice(`Export ready: ${outcome.files.length} files.`, `ส่งออกแล้ว ${outcome.files.length} ไฟล์`);
    } catch (error) {
      if (!(error instanceof CancelledError)) generateError = friendlyError(error);
    } finally { exporting = false; task = undefined; }
  }

  function openExam(id: string) {
    if (shareState) { noticeTone = 'warning'; setNotice('This is a shared, read-only view. Edits need an edit link and the owner’s project.', 'นี่คือมุมมองแชร์แบบอ่านอย่างเดียว การแก้ไขต้องใช้ลิงก์แก้ไขและโครงการของเจ้าของ'); return; }
    editId = id;
  }
  function openCourse(code: string) {
    const events = result?.project.events ?? [];
    const match = events.find(e => e.courseCode === code && e.examType === examType) ?? events.find(e => e.courseCode === code);
    if (match) { openExam(match.id); if (!shareState) view = 'exams'; }
  }

  // ---- cloud persistence & sharing (plan §50-65) ---------------------------------

  function persistCache() {
    if (!project && !result) return;
    try {
      void cacheProject({
        key: 'current', updatedAt: new Date().toISOString(),
        project: project ?? result!.project,
        sources: cachedSources.map(s => ({ name: s.name, kind: s.kind, role: s.role, bytes: [...s.bytes] })),
        result, cloud: cloudConn, shares,
      });
    } catch { /* local cache is best-effort; the in-memory project remains authoritative */ }
  }

  async function boot() {
    const ref = parseShareRef(location.hash);
    if (ref) { await openShare(ref.shareId, ref.secret); return; }
    try {
      const cached = await loadCachedProject('current');
      if (!cached) return;
      project = cached.project;
      inspection = inspectImport(cached.project);
      cachedSources = (cached.sources ?? []).map(s => ({ name: s.name, kind: s.kind, role: s.role, bytes: new Uint8Array(s.bytes) }));
      cloudConn = cached.cloud ?? null;
      shares = cached.shares ?? [];
        const sourceDrafts = await Promise.all(cachedSources.filter(s => s.kind === 'course').map(async source => ({ ...(await describeDraftFile(source)), role: (source.role ?? 'managed') as 'managed' | 'context' })));
        const cachedRules = cachedSources.find(s => s.kind === 'rules');
        const rulesDraft = cachedRules ? await describeDraftFile(cachedRules) : undefined;
        const referenceDrafts = await Promise.all(cachedSources.filter(s => s.kind === 'rooms' || s.kind === 'proctors').map(async reference => ({ ...(await describeDraftFile(reference)), kind: reference.kind as 'rooms' | 'proctors' })));
        importedSignature = draftSignature(sourceDrafts, rulesDraft, cached.project.settings, referenceDrafts);
      if (cached.result) {
        result = cached.result;
        resourceSummary = summarizeAssignedResources(result.project);
        view = 'overview';
        noticeTone = visibleValidation(result.validation).overallStatus === 'valid' ? 'success' : 'warning';
        setNotice('Restored the last working session from this browser.', 'กู้คืนการทำงานล่าสุดจากเบราว์เซอร์นี้แล้ว');
      } else if (project) view = 'review';
    } catch { /* first run or unavailable storage: start empty */ }
  }

  function setAutosave(on: boolean) {
    autosaveOn = on;
    localStorage.setItem('cloud.autosave', on ? 'on' : 'off');
    if (!on && autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = undefined; cloudPending = false; }
    else queueAutosave();
  }

  function queueAutosave() {
    if (!cloudConn || !autosaveOn || !result || shareState) return;
    cloudPending = true;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { autosaveTimer = undefined; void saveToCloud(''); }, 10000);
  }

  async function saveToCloud(name = '') {
    if (!result || cloudSaving) return;
    cloudSaving = true; cloudError = null; cloudPending = false;
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = undefined; }
    const snapshot = structuredClone(result.project);
    const uploads = cachedSources.map(s => ({ name: s.name, bytes: s.bytes }));
    try {
      if (cloudConn) {
        const saved = await saveCloudRevision(cloudServer, cloudConn.projectId, cloudConn.revisionId, snapshot, uploads, cloudConn.ownerSecret);
        cloudConn = { ...cloudConn, revisionId: saved.revisionId, savedAt: new Date().toISOString() };
      } else {
        const projectName = name.trim() || 'Exam schedule';
        const created = await createCloudProject(cloudServer, projectName, snapshot, uploads);
        // The worker hands the creator the owner capability: an edit-permission share that
        // is the only credential allowed to save revisions or manage shares.
        cloudConn = { projectId: created.projectId, name: projectName, ownerShareId: created.ownerShareId, ownerSecret: created.ownerSecret, revisionId: created.revisionId, savedAt: new Date().toISOString() };
        shares = [...shares, { shareId: created.ownerShareId, secret: created.ownerSecret, permission: 'edit', createdAt: new Date().toISOString() }];
        noticeTone = 'success';
        setNotice('Saved to the cloud. This browser now holds the private project link.', 'บันทึกขึ้นคลาวด์แล้ว เบราว์เซอร์นี้เก็บลิงก์โครงการส่วนตัวไว้');
      }
      cloudDirty = false;
      persistCache();
    } catch (error) {
      if (error instanceof RevisionConflictError && cloudConn) await handleRevisionConflict();
      else cloudError = friendlyError(error);
    } finally { cloudSaving = false; }
  }

  /** Another device saved first (plan §55): compare by hash, reload/compare, never overwrite silently. */
  async function handleRevisionConflict() {
    const connection = cloudConn!;
    try {
      const fetched = await fetchShareSnapshot(cloudServer, connection.ownerShareId, connection.ownerSecret);
      const cloudHash = (await buildAuditBundle(fetched.snapshot)).scheduleHash;
      const localHash = (await buildAuditBundle(result!.project)).scheduleHash;
      if (cloudHash === localHash) {
        cloudConn = { ...connection, revisionId: fetched.revisionId };
        persistCache();
        noticeTone = 'warning';
        setNotice('Another device saved the same content, so the revision pointer moved forward. Nothing was lost.', 'อุปกรณ์อื่นบันทึกเนื้อหาเดียวกัน ตัวชี้ฉบับจึงเลื่อนไปข้างหน้า ไม่มีข้อมูลสูญหาย');
        return;
      }
      cloudConflict = { cloudRevisionId: fetched.revisionId, localHash, cloudHash, cloudProject: fetched.snapshot };
    } catch (cause) { cloudError = friendlyError(cause); }
  }

  async function reloadFromCloud() {
    if (!cloudConn || !cloudConflict || !result) return;
    const snapshot = structuredClone(cloudConflict.cloudProject);
    cloudConn = { ...cloudConn, revisionId: cloudConflict.cloudRevisionId, savedAt: new Date().toISOString() };
    result = viewResultFor(snapshot);
    resourceSummary = summarizeAssignedResources(snapshot); audit = null; editId = ''; view = 'overview';
    cloudConflict = null; cloudDirty = false;
    persistCache();
    noticeTone = 'warning';
    setNotice('Reloaded the cloud revision. This browser’s unsaved changes were replaced.', 'โหลดฉบับจากคลาวด์แล้ว การเปลี่ยนแปลงที่ยังไม่ได้บันทึกของเบราว์เซอร์นี้ถูกแทนที่');
  }

  async function createShareInCloud(share: { permission: SharePermission; pinned: boolean; expiresAt?: string }): Promise<ShareLinkInfo | null> {
    if (!cloudConn || cloudSaving) return null;
    cloudSaving = true; shareSaving = true; cloudError = null;
    try {
      const created = await createCloudShare(cloudServer, cloudConn.projectId, share.permission, { revisionId: share.pinned ? cloudConn.revisionId : undefined, expiresAt: share.expiresAt }, cloudConn.ownerSecret);
      const link: ShareLinkInfo = { shareId: created.shareId, secret: created.secret, permission: created.permission, revisionId: share.pinned ? cloudConn.revisionId : undefined, createdAt: new Date().toISOString(), expiresAt: share.expiresAt };
      shares = [...shares, link];
      persistCache();
      noticeTone = 'success';
      setNotice('Share link created. Copy it now — the secret stays in this browser; the cloud stores only its hash.', 'สร้างลิงก์แชร์แล้ว คัดลอกเลย รหัสลับเก็บเฉพาะในเบราว์เซอร์นี้ คลาวด์เก็บเพียงแฮชของมัน');
      return link;
    } catch (error) { cloudError = friendlyError(error); return null; }
    finally { cloudSaving = false; shareSaving = false; }
  }

  const shareUrlOf = (link: ShareLinkInfo) => `${location.origin}${location.pathname}#/share/${link.shareId}/${link.secret}`;

  /** Plan §78 audit view action: hand out a revision-pinned audit link for external verification. */
  async function copyAuditShare() {
    const link = await createShareInCloud({ permission: 'audit', pinned: true });
    if (link) copyText(shareUrlOf(link), { en: 'Audit share', th: 'ตรวจสอบ' });
  }

  async function revokeShareInCloud(shareId: string) {
    if (!cloudConn) return;
    cloudError = null;
    try {
      await revokeCloudShare(cloudServer, cloudConn.projectId, shareId, cloudConn.ownerSecret);
      shares = shares.map(s => s.shareId === shareId ? { ...s, revokedAt: new Date().toISOString() } : s);
      persistCache();
      noticeTone = 'success';
      setNotice('Share revoked. Links that used it can no longer open the project.', 'เพิกถอนแล้ว ลิงก์ที่ใช้รหัสนี้จะเปิดโครงการไม่ได้อีก');
    } catch (error) { cloudError = friendlyError(error); }
  }

  function copyText(text: string, label: { en: string; th: string }) {
    navigator.clipboard?.writeText(text)
      .then(() => { noticeTone = 'success'; setNotice(`${label.en} link copied to the clipboard.`, `คัดลอกลิงก์${label.th}แล้ว`); })
      .catch(e => { cloudError = friendlyError(e); });
  }

  async function openShareFromText(text: string) {
    const ref = parseShareRef(text);
    if (!ref) { importError = localized('That does not look like a project or share link from this app.', 'นี่ดูเหมือนไม่ใช่ลิงก์โครงการหรือลิงก์แชร์ของแอปนี้'); return; }
    await openShare(ref.shareId, ref.secret);
  }

  async function openShare(shareId: string, secret: string) {
    if (loadingShare) return;
    loadingShare = true; importError = null; clearNotice();
    try {
      const fetched = await fetchShareSnapshot(cloudServer, shareId, secret);
      const [report, bundle] = fetched.permission === 'schedule'
        ? [await fetchShareValidation(cloudServer, shareId, secret).then(v => ({ overallStatus: v.status, issues: v.issues, coverage: v.coverage } as ValidationReport)), null]
        : await fetchShareAudit(cloudServer, shareId, secret).then(a => [a.validation, a.audit] as const);
      shareState = { shareId, secret, projectId: fetched.projectId, projectName: fetched.projectName, permission: fetched.permission, revisionId: fetched.revisionId };
      project = null; inspection = null; dirty = false; editId = '';
      resourceSummary = null; cloudDirty = false;
      audit = bundle;
      result = viewResultFor(structuredClone(fetched.snapshot), report);
      view = 'overview';
      noticeTone = 'success';
      setNotice(`Opened the shared ${fetched.permission === 'schedule' ? 'schedule' : 'project'} (${fetched.revisionId}).`, `เปิด${fetched.permission === 'schedule' ? 'ตารางสอบ' : 'โครงการ'}ที่แชร์ไว้แล้ว (${fetched.revisionId})`);
    } catch (error) { importError = friendlyError(error); view = 'sources'; }
    finally { loadingShare = false; }
  }

  function closeShare() {
    history.replaceState(null, '', location.pathname + location.search);
    shareState = null; result = null; audit = null; clearNotice(); view = 'sources';
  }

  /** Adopt an edit share as this browser's working session (plan §87): it is the credential the
   * worker accepts for saving revisions, so other share scopes cannot continue editing. */
  async function continueEditing() {
    if (!shareState || !result) return;
    const session = shareState;
    if (session.permission !== 'edit' || !session.projectId) return;
    loadingShare = true; importError = null;
    try {
      const snapshot = structuredClone(result.project);
      const restored: typeof cachedSources = [];
      let missing = 0;
      for (const artifact of snapshot.artifacts) {
        if (!artifact.sha256) continue;
        const bytes = await fetchShareSource(cloudServer, session.shareId, session.secret, artifact.sha256).catch(() => null);
        if (!bytes) { missing++; continue; }
        const role = artifact.kind === 'course' ? snapshot.sections.find(s => s.sourceRef.artifactId === artifact.id)?.sourceRole ?? 'managed' : undefined;
        restored.push({ name: artifact.originalName, kind: artifact.kind, role, bytes });
      }
      cachedSources = restored;
      project = snapshot;
      inspection = inspectImport(snapshot);
      const sourceDrafts = await Promise.all(restored.filter(s => s.kind === 'course').map(async source => ({ ...(await describeDraftFile(source)), role: (source.role ?? 'managed') as 'managed' | 'context' })));
      const restoredRules = restored.find(s => s.kind === 'rules');
      const rulesDraft = restoredRules ? await describeDraftFile(restoredRules) : undefined;
      const referenceDrafts = await Promise.all(restored.filter(s => s.kind === 'rooms' || s.kind === 'proctors').map(async reference => ({ ...(await describeDraftFile(reference)), kind: reference.kind as 'rooms' | 'proctors' })));
      importedSignature = draftSignature(sourceDrafts, rulesDraft, snapshot.settings, referenceDrafts);
      cloudConn = { projectId: session.projectId, name: session.projectName, ownerShareId: session.shareId, ownerSecret: session.secret, revisionId: session.revisionId, savedAt: new Date().toISOString() };
      shares = [{ shareId: session.shareId, secret: session.secret, permission: session.permission, createdAt: new Date().toISOString() }];
      shareState = null; dirty = false; cloudDirty = false;
      resourceSummary = summarizeAssignedResources(snapshot);
      view = 'overview';
      noticeTone = missing ? 'warning' : 'success';
      setNotice(
        missing
          ? `Opened the project for editing. ${missing} source file(s) could not be downloaded; re-import them if you need to change inputs.`
          : 'Opened the project for editing, with its source files.',
        missing
          ? `เปิดโครงการเพื่อแก้ไขแล้ว มีไฟล์ต้นทาง ${missing} ไฟล์ที่ดาวน์โหลดไม่ได้ หากต้องแก้ข้อมูลต้นทางกรุณานำเข้าใหม่`
          : 'เปิดโครงการเพื่อแก้ไขแล้ว พร้อมไฟล์ต้นทางครบ',
      );
      persistCache();
    } catch (error) { importError = friendlyError(error); }
    finally { loadingShare = false; }
  }

  /** A result-like view over any snapshot: validation from the authoritative report, solver detail intentionally absent. */
  function viewResultFor(project: Project, validation: ValidationReport = validateProject(project)): ScheduleResult {
    const idleSearch = { visitedNodes: 0, budget: 0, feasibilityBudget: 0, budgetExhausted: false, improvementMoves: 0, improvementEvaluations: 0, exchangeMoves: 0, components: 0, coverageUpperBound: 0, coverageOptimal: false, avoidedEventLowerBound: 0, avoidedDaysOptimal: false, improvementBudgetExhausted: false };
    return { project, unscheduled: [], search: idleSearch as ScheduleResult['search'], quality: scheduleQuality(project), validation };
  }

</script>

<div class="app-shell">
  <nav class="app-nav" aria-label={t('Primary', 'เมนูหลัก')}>
    <p class="brand"><img class="brand-mark" src={fitmLogo} alt="" /><span><strong>{t('Exam Scheduler', 'ตัวจัดตารางสอบ')}</strong><small>{t('FITM · KMUTNB', 'FITM · มจพ.')}</small></span></p>
    <div class="nav-scroll">
      <ul class="nav-list">
        {#each navItemsShown as item (item.id)}
          <li><button class="nav-item" class:current={view === item.id} disabled={!available(item.id)} title={available(item.id) ? undefined : navBlockedWhy(item.id)} aria-current={view === item.id ? 'page' : undefined} onclick={() => go(item.id)}><Icon name={item.icon} /><span class="nav-item-label"><strong>{t(item.en, item.th)}</strong></span></button></li>
        {/each}
        {#if !available('overview')}<li class="nav-hint-item"><p class="nav-hint"><Icon name="info" size={15} />{t('Import source files and generate a schedule to unlock the remaining views.', 'นำเข้าไฟล์ข้อมูลและจัดตารางสอบเพื่อเปิดหน้าที่เหลือ')}</p></li>{/if}
      </ul>
    </div>
    <ul class="nav-bottom">
      <li>
        <button class="nav-item" class:current={view === 'help'} aria-current={view === 'help' ? 'page' : undefined} onclick={() => go('help')}>
          <Icon name="info" />
          <span class="nav-item-label"><strong>{t('How it works', 'วิธีใช้งาน')}</strong><small>{t('Help & samples', 'คู่มือและตัวอย่าง')}</small></span>
        </button>
      </li>
      <li>
        <button class="nav-item" disabled={!result} title={result ? undefined : t('Generate a schedule to download the archive.', 'จัดตารางสอบก่อนจึงดาวน์โหลดไฟล์เก็บถาวรได้')} onclick={downloadZip}>
          <Icon name="download" />
          <span class="nav-item-label"><strong>{exporting ? t('Preparing…', 'กำลังเตรียม…') : t('Download project.zip', 'ดาวน์โหลด project.zip')}</strong><small>{t('Complete archive', 'ไฟล์ ZIP ครบชุด')}</small></span>
        </button>
      </li>
    </ul>
    <p class="nav-foot"><Icon name="lock" size={15} />{t('Processed in this browser. Nothing leaves it until you save or share.', 'ประมวลผลในเบราว์เซอร์ จะไม่ส่งข้อมูลออกจนกว่าคุณจะบันทึกหรือแชร์')}</p>
  </nav>
  <div class="app-body">
    <header class="app-header">
      <p class="header-brand"><img src={fitmLogo} alt="FITM" /><strong>{t('Exam Scheduler', 'ตัวจัดตารางสอบ')}</strong></p>
      <p class="status-chip header-status {chipTone}">{chip}</p>
      <div class="type-switch type-switch-lang" role="group" aria-label={t('Language', 'ภาษา')}>
        <button class:active={i18n.lang === 'en'} aria-pressed={i18n.lang === 'en'} onclick={() => { i18n.lang = 'en'; }}>EN</button>
        <button class:active={i18n.lang === 'th'} aria-pressed={i18n.lang === 'th'} onclick={() => { i18n.lang = 'th'; }}>ไทย</button>
      </div>
      {#if result && typeViews.has(view)}
        <div class="type-switch type-switch-view" role="group" aria-label={t('Exam type', 'ชนิดการสอบ')}>
          <button class:active={examType === 'midterm'} aria-pressed={examType === 'midterm'} onclick={() => { examType = 'midterm'; selectedGroup = ''; }}>{t('Midterm', 'กลางภาค')}</button>
          <button class:active={examType === 'final'} aria-pressed={examType === 'final'} onclick={() => { examType = 'final'; selectedGroup = ''; }}>{t('Final', 'ปลายภาค')}</button>
        </div>
      {/if}
    </header>
    {#if view !== 'sources'}<p class="status-chip status-chip-mobile {chipTone}">{chip}</p>{/if}
    <p class="visually-hidden" role="status">{notice}</p>
    <p class="visually-hidden" role="alert">{localizedText(importError) || localizedText(generateError)}</p>
    {#if loadingShare && !shareState}
      <div class="app-loading" aria-hidden="true">
        <span class="spinner"></span>
        <h2>{t('Opening the shared project…', 'กำลังเปิดโครงการที่แชร์ไว้…')}</h2>
        <p>{t('Verifying the share and fetching its schedule from the cloud.', 'กำลังตรวจสอบลิงก์แชร์และดึงตารางจากคลาวด์')}</p>
      </div>
    {:else if loadingShare}<div class="app-notice" aria-hidden="true"><Icon name="info" size={17} /><p>{t('Opening the shared project…', 'กำลังเปิดโครงการที่แชร์ไว้…')}</p></div>{/if}
    {#if notice}
      <div class="app-toast {noticeTone}" aria-hidden="true">
        <Icon name={noticeTone === 'warning' ? 'info' : 'check'} size={17} />
        <p>{notice}</p>
        <button class="toast-close" onclick={clearNotice} title={t('Dismiss', 'ปิด')}><Icon name="close" size={14} /></button>
      </div>
    {/if}
    {#if shareState}
      <section class="panel share-banner">
        <div class="share-banner-copy">
          <h2>{t('Shared view', 'มุมมองที่แชร์')}</h2>
          <p class="muted">
            {t({ schedule: 'Schedule share', audit: 'Audit share', full_project: 'Full-project share', edit: 'Edit share' }[shareState.permission], { schedule: 'ตารางสอบที่แชร์', audit: 'ข้อมูลตรวจสอบที่แชร์', full_project: 'โครงการเต็มที่แชร์', edit: 'สิทธิ์แก้ไขที่แชร์' }[shareState.permission])}
            · <code>{shareState.revisionId}</code> · {t('read-only', 'อ่านอย่างเดียว')}
          </p>
        </div>
        <div class="inline-actions">
          {#if shareState.permission === 'edit'}
            <button class="button primary compact" disabled={loadingShare} onclick={continueEditing}><Icon name="edit" size={15} />{t('Continue editing here', 'แก้ไขต่อในเครื่องนี้')}</button>
          {/if}
          <button class="button secondary compact" onclick={closeShare}>{t('Close shared view', 'ปิดมุมมองนี้')}</button>
        </div>
      </section>
    {/if}
    {#if dirty && result}<div class="app-notice warning" role="status"><Icon name="info" size={17} /><p>{t('Source settings changed after this schedule was generated. Import again before trusting these results.', 'การตั้งค่าเปลี่ยนหลังจัดตารางนี้ กรุณานำเข้าไฟล์อีกครั้งก่อนใช้ผลลัพธ์')}</p></div>{/if}
    {#if importError || generateError}<div class="app-notice danger" aria-hidden="true"><Icon name="alert" size={17} /><p>{localizedText(importError) || localizedText(generateError)}</p></div>{/if}
    <main class="app-main" id="main">
      <div class="view source-mount" class:active={view === 'sources'}>
        <SourceImport busy={importing || generating} ondraft={(signature) => { dirty = !!importedSignature && signature !== importedSignature; }} onimport={startImport} onopenlink={openShareFromText} />
      </div>
      {#if view === 'review' && project && inspection}
        <section class="view" aria-labelledby="review-title">
          <hgroup><h1 id="review-title">{t(viewTitles.review.en, viewTitles.review.th)}</h1><p class="lede">{t(viewTitles.review.lead, viewTitles.review.leadTh)}</p></hgroup>
          <div class="source-layout">
            <div class="source-main">
              <section class="panel">
                <h2>{t('Imported sources', 'ไฟล์ที่นำเข้า')}</h2>
                <div class="table-scroll" role="region" aria-label={t('Imported sources', 'ไฟล์ที่นำเข้า')}>
                  <table class="exam-table"><thead><tr><th scope="col">{t('File', 'ไฟล์')}</th><th scope="col">{t('Role', 'ประเภท')}</th><th scope="col">{t('Courses', 'วิชา')}</th><th scope="col">{t('Sections', 'ตอน')}</th><th scope="col">{t('Term', 'ภาคการศึกษา')}</th></tr></thead><tbody>
                    {#each inspection.sources as source (source.id)}
                      {#if (SHOW_PROCTORS || source.kind !== 'proctors') && (SHOW_ROOMS || source.kind !== 'rooms')}
                      <tr><td class="cell-primary" data-label={t('File', 'ไฟล์')}><strong>{source.originalName}</strong><small class="muted">{(source.byteLength / 1024).toFixed(1)} KB · {(source.sha256 ?? '').slice(0, 12)}…</small></td><td data-label={t('Role', 'ประเภท')}>{source.kind === 'rules' ? t('Rules', 'เงื่อนไขการสอบ') : source.kind === 'rooms' ? t('Rooms', 'ข้อมูลห้องสอบ') : source.kind === 'proctors' ? t('Proctor roster', 'รายชื่อผู้คุมสอบ') : roleLabel(project.sections.find(s => s.sourceRef.artifactId === source.id)?.sourceRole ?? null)}</td><td data-label={t('Courses', 'วิชา')}>{source.courseCount}</td><td data-label={t('Sections', 'ตอน')}>{source.sectionCount}</td><td data-label={t('Term', 'ภาคการศึกษา')}>{source.term ? termLabel(source.term) : source.kind === 'course' ? termLabel(source.term) : '—'}</td></tr>
                      {/if}
                    {/each}
                  </tbody></table>
                </div>
                <p class="muted">{t('Source errors can stay in a draft. They are never hidden by a successful generation.', 'ข้อผิดพลาดของข้อมูลต้นทางยังคงแสดงแม้จัดตารางสำเร็จ')}</p>
              </section>
              <section class="panel">
                <h2>{t('Findings before generation', 'ข้อค้นพบก่อนจัดตาราง')}</h2>
                {#if generateSummary}<p class="muted">{generateSummary.blocking.length} {t('errors', 'ข้อผิดพลาด')} · {generateSummary.warnings.length} {t('warnings', 'คำเตือน')} {t('in the imported data', 'ในข้อมูลที่นำเข้า')}</p>{/if}
                <IssueList issues={reviewIssues} {project} oncourse={openCourse} />
              </section>
            </div>
            <aside class="panel calendar-settings">
              <h2>{t('Calendar checks', 'การตรวจสอบปฏิทิน')}</h2>
              {#each inspection.calendar as cal (cal.examType)}
                {@const type = cal.examType as ExamType}
                <section class="calendar-check">
                  <h3>{examLabel(type)}</h3>
                  <p>{dateLabel(project.settings.periods[type].start)} – {dateLabel(project.settings.periods[type].end)}</p>
                  <ul>
                    <li>{cal.weekendDates.length} {t('weekend days in range', 'วันเสาร์–อาทิตย์ในช่วง')} ({t('policy', 'นโยบาย')}: {policyLabel(cal.weekendPolicy)})</li>
                    <li>{cal.holidayDates.length} {t('configured holidays in range', 'วันหยุดที่กำหนดในช่วง')} ({t('policy', 'นโยบาย')}: {policyLabel(cal.holidayPolicy)})</li>
                  </ul>
                </section>
              {/each}
              <div class="generate-bar">
                <div><h2>{t('Generate schedule', 'จัดตารางสอบ')}</h2>{#if generating}<p class="muted" aria-live="polite">{t('Generating in the background…', 'กำลังจัดตารางเบื้องหลัง…')}</p>{:else}<p class="muted">{t('The generator never hides source errors or forces an impossible assignment.', 'ตัวจัดตารางไม่ซ่อนข้อผิดพลาดและไม่บังคับจัดวิชาที่เป็นไปไม่ได้')}</p>{/if}</div>
                {#if generating}<button class="button secondary" onclick={() => task?.cancel()}><Icon name="close" size={16} />{t('Cancel', 'ยกเลิก')}</button>{:else}<button class="button primary" onclick={generate}><Icon name="calendar" size={16} />{t('Generate', 'จัดตาราง')}</button>{/if}
              </div>
            </aside>
          </div>
        </section>
      {:else if view === 'overview' && result && overview}
        <section class="view" aria-labelledby="overview-title">
          <hgroup><h1 id="overview-title">{t(viewTitles.overview.en, viewTitles.overview.th)}</h1><p class="lede">{t(viewTitles.overview.lead, viewTitles.overview.leadTh)}</p></hgroup>
          <div class="stat-grid">
            {#each overview.types as entry (entry.type)}
              <section class="panel stat">
                <h2>{examLabel(entry.type)}</h2>
                <p class="stat-value">{entry.scheduled}<span class="muted"> / {entry.required}</span></p>
                <p class="stat-label">{t('managed exams scheduled, of required', 'วิชาที่จัดแล้ว จากที่ต้องจัด')}</p>
                {#if entry.unscheduled}<p class="stat-detail error-status"><Icon name="alert" size={14} /> {entry.unscheduled} {t('unscheduled', 'ยังไม่จัด')}</p>{/if}
                <p class="stat-detail muted">{entry.fixed} {t('fixed imported', 'ต้นทางกำหนด')} · {entry.locked} {t('manual locks', 'ล็อกเอง')}</p>
              </section>
            {/each}
            <section class="panel stat">
              <h2>{t('Findings', 'ข้อค้นพบ')}</h2>
              <p class="stat-value">{overview.errors + overview.warnings}</p>
              <p class="stat-label">{t('errors & warnings', 'ข้อผิดพลาดและคำเตือน')}</p>
              <p class="stat-detail"><span class="error-status">{overview.errors} {t('errors', 'ข้อผิดพลาด')}</span> · <span class="warning-status">{overview.warnings} {t('warnings', 'คำเตือน')}</span> · {overview.infos} {t('info', 'ข้อมูล')}</p>
            </section>
            <section class="panel stat">
              <h2>{t('Origins', 'ที่มา')}</h2>
              <ul class="origin-list">
                {#each overview.origins as item (item.origin)}<li>{originLabel(item.origin)}<strong>{item.count}</strong></li>{/each}
              </ul>
            </section>
          </div>
          <section class="panel">
            <h2>{t('Validation coverage', 'ขอบเขตการตรวจสอบ')}</h2>
            <p class="muted">{t('Checks that ran are listed as passed or failed; unrun checks are not counted as passes.', 'รายการที่ตรวจแล้วแสดงผ่านหรือไม่ผ่าน รายการที่ยังไม่ตรวจไม่นับว่าผ่าน')}</p>
            <ul class="coverage-list">
              {#each coverageEntries as [key, status] (key)}
                <li class:coverage-passed={status === 'passed'} class:coverage-failed={status === 'failed'} class:coverage-not-checked={status === 'not_checked'}>
                  <span class="status" class:success-status={status === 'passed'} class:error-status={status === 'failed'} class:warning-status={status === 'not_checked'}>{status === 'passed' ? t('Passed', 'ผ่าน') : status === 'failed' ? t('Failed', 'ไม่ผ่าน') : t('Not checked', 'ยังไม่ตรวจ')}</span>
                  <span class="coverage-copy"><span>{coverageLabel(key)}</span>{#if SHOW_RESOURCES && status === 'not_checked' && (key.includes('room') || key.includes('proctor') || key === 'resourceIntegrity') }<small class="muted">{SHOW_PROCTORS ? t('No matching room or proctor source was supplied, so this check could not run.', 'ไม่มีไฟล์ห้องสอบหรือผู้คุมที่ตรงกัน จึงยังตรวจสอบรายการนี้ไม่ได้') : t('No matching room source was supplied, so this check could not run.', 'ไม่มีไฟล์ห้องสอบที่ตรงกัน จึงยังตรวจสอบรายการนี้ไม่ได้')}</small>{/if}</span>
                  {#if coverageCounts[key]}<button class="text-button coverage-count" onclick={() => go('issues')}>{coverageCounts[key]} {t('findings', 'ข้อค้นพบ')} <Icon name="arrow" size={13} /></button>{/if}
                </li>
              {/each}
            </ul>
          </section>
          {#if SHOW_RESOURCES}
          <section class="panel">
            <h2>{SHOW_PROCTORS ? t('Resources', 'ห้องและผู้คุมสอบ') : SHOW_ROOMS ? t('Resources', 'ห้องสอบ') : t('Resources', 'ทรัพยากร')}</h2>
            {#if shownResourceSummary}
              {#if SHOW_ROOMS}<p class="stat-detail">{shownResourceSummary.roomsAssigned}/{shownResourceSummary.scheduledManagedEvents} {t('managed events have a room', 'รายการที่จัดอัตโนมัติมีห้องแล้ว')}{shownResourceSummary.roomsUnassigned ? ` · ${shownResourceSummary.roomsUnassigned} ${t('without a room', 'ยังไม่มีห้อง')}` : ''}</p>{/if}
              {#if SHOW_PROCTORS}
                <p class="stat-detail">{shownResourceSummary.positionsFilled}/{shownResourceSummary.proctorPositions} {t('known proctor positions filled', 'ตำแหน่งผู้คุมที่ทราบและจัดแล้ว')}{shownResourceSummary.eventsWithUnfilledProctorPositions ? ` · ${shownResourceSummary.eventsWithUnfilledProctorPositions} ${t('events still short', 'รายการยังขาดผู้คุม')}` : ''}</p>
                {#if shownResourceSummary.eventsWithUnknownProctorDemand}<p class="stat-detail warning-status"><Icon name="info" size={14} /> {shownResourceSummary.eventsWithUnknownProctorDemand} {t('events have unknown proctor demand; this is not zero demand.', 'รายการไม่ทราบความต้องการผู้คุม ไม่ใช่ความต้องการศูนย์')}</p>{/if}
                <p class="stat-detail muted">{shownResourceSummary.eligibleProctors} {t('eligible roster candidates', 'ผู้สมัครจากรายชื่อที่มีสิทธิ์')} · {shownResourceSummary.ineligibleProctors} {t('quarantined', 'ถูกกักกัน')}</p>
              {/if}
              <div class="inline-actions">{#if SHOW_ROOMS}<button class="text-button" onclick={() => go('rooms')}>{t('Open rooms', 'ดูห้องสอบ')} <Icon name="arrow" size={14} /></button>{/if}{#if SHOW_PROCTORS}<button class="text-button" onclick={() => go('proctors')}>{t('Open proctors', 'ดูผู้คุมสอบ')} <Icon name="arrow" size={14} /></button>{/if}</div>
            {:else}
              <p class="muted">{SHOW_PROCTORS ? t('Assign rooms and proctors after generating. Unresolved positions stay visible.', 'จัดห้องและผู้คุมหลังจัดตาราง ตำแหน่งที่ยังว่างจะแสดงไว้เสมอ') : t('Assign rooms after generating. Events without a room stay visible.', 'จัดห้องหลังจัดตาราง รายการที่ยังไม่มีห้องจะแสดงไว้เสมอ')}</p>
              <div class="inline-actions"><button class="button primary compact" disabled={resourcing} onclick={assign}>{resourcing ? t('Working…', 'กำลังทำ…') : t('Assign resources', 'จัดทรัพยากร')}</button></div>
            {/if}
          </section>
          {/if}
          <section class="panel">
            <h2>{t('Latest findings', 'ข้อค้นพบล่าสุด')}</h2>
            {#if vValidation}<IssueList issues={vValidation.issues} project={result!.project} oncourse={openCourse} compact />{/if}
            <p class="table-footnote"><button class="text-button" onclick={() => go('issues')}>{t('Open all issues', 'ดูทุกข้อควรตรวจสอบ')} <Icon name="arrow" size={14} /></button></p>
          </section>
        </section>
      {:else if view === 'exams' && data}
        <section class="view" aria-labelledby="exams-title">
          <hgroup><h1 id="exams-title">{t(viewTitles.exams.en, viewTitles.exams.th)}</h1><p class="lede">{t(viewTitles.exams.lead, viewTitles.exams.leadTh)}</p></hgroup>
          <ExamTable project={data} {examType} bind:query={examQuery} onselect={openExam} />
        </section>
      {:else if view === 'calendar' && data}
        <section class="view" aria-labelledby="calendar-title">
          <hgroup><h1 id="calendar-title">{t(viewTitles.calendar.en, viewTitles.calendar.th)}</h1><p class="lede">{t(viewTitles.calendar.lead, viewTitles.calendar.leadTh)}</p></hgroup>
          <CalendarView project={data} {examType} onselect={openExam} />
        </section>
      {:else if view === 'groups' && data}
        <section class="view" aria-labelledby="groups-title">
          <hgroup><h1 id="groups-title">{t(viewTitles.groups.en, viewTitles.groups.th)}</h1><p class="lede">{t(viewTitles.groups.lead, viewTitles.groups.leadTh)}</p></hgroup>
          <div class="groups-layout">
            <section class="panel group-picker">
              <h2>{t('Choose a group', 'เลือกกลุ่ม')}</h2>
              <label class="search-field"><Icon name="search" /><span class="visually-hidden">{t('Search groups', 'ค้นหากลุ่ม')}</span><input type="search" placeholder={t('Group code', 'รหัสกลุ่ม')} bind:value={groupQuery} /></label>
              <p class="field-hint">{t('Type part of a group code to filter the list.', 'พิมพ์บางส่วนของรหัสกลุ่มเพื่อกรองรายการ')}</p>
              <div class="group-chips">
                {#each groupMatches as group (group)}<button class="group-chip" class:selected={group === selectedGroup} aria-pressed={group === selectedGroup} onclick={() => { selectedGroup = group; }}>{group}</button>{:else}<p class="empty-help">{t('No group matches.', 'ไม่พบกลุ่มที่ตรงกัน')}</p>{/each}
              </div>
              {#if selectedGroup}
                <p class="muted">{examLabel(examType)} · {groupStats.exams} {t('exams', 'วิชา')} · {groupStats.days} {t('exam days', 'วันสอบ')} · {groupStats.doubleDays} {t('days with multiple exams', 'วันที่สอบมากกว่าหนึ่งวิชา')}{#if groupStats.unscheduled} · <span class="error-status">{groupStats.unscheduled} {t('unscheduled', 'ยังไม่จัด')}</span>{/if}</p>
              {:else}<p class="muted">{t('Select a group to see its exams only.', 'เลือกกลุ่มเพื่อดูเฉพาะวิชาของกลุ่มนั้น')}</p>{/if}
            </section>
            <section class="panel group-table">
              {#if selectedGroup}<ExamTable project={data} {examType} group={selectedGroup} onselect={openExam} />{:else}<div class="empty-state"><Icon name="groups" size={34} /><h3>{t('No group selected', 'ยังไม่ได้เลือกกลุ่ม')}</h3><p>{t('Choose a student group to list only its examinations.', 'เลือกกลุ่มนักศึกษาเพื่อแสดงเฉพาะรายการสอบของกลุ่ม')}</p></div>{/if}
            </section>
          </div>
        </section>
      {:else if view === 'issues' && result}
        <section class="view" aria-labelledby="issues-title">
          <hgroup><h1 id="issues-title">{t(viewTitles.issues.en, viewTitles.issues.th)}</h1><p class="lede">{t(viewTitles.issues.lead, viewTitles.issues.leadTh)}</p></hgroup>
          <IssueList issues={vValidation!.issues} project={result.project} oncourse={openCourse} />
        </section>
      {:else if SHOW_ROOMS && view === 'rooms' && data}
        <section class="view" aria-labelledby="rooms-title">
          <hgroup><h1 id="rooms-title">{t(viewTitles.rooms.en, viewTitles.rooms.th)}</h1><p class="lede">{t(viewTitles.rooms.lead, viewTitles.rooms.leadTh)}</p></hgroup>
        {#if !shareState}
          <section class="panel resource-bar">
            <div><h2>{t('Assign resources', 'จัดทรัพยากร')}</h2><p class="muted">{SHOW_PROCTORS ? t('Rooms first, then eligible proctors. Known demand is reported separately from rooms that do not record a proctor count.', 'จัดห้องก่อนแล้วจึงจัดผู้คุมที่มีสิทธิ์ รายงานความต้องการที่ทราบแยกจากห้องที่ไม่ได้ระบุจำนวนผู้คุม') : t('Assign a room to every scheduled examination.', 'จัดห้องให้รายการสอบทุกรายการ')}</p></div>
            <div class="inline-actions">
              {#if resourcing}<button class="button secondary" onclick={() => task?.cancel()}><Icon name="close" size={16} />{t('Cancel', 'ยกเลิก')}</button>
              {:else}<button class="button primary" onclick={assign}><Icon name="calendar" size={16} />{t('Assign resources', 'จัดทรัพยากร')}</button>
              <button class="button secondary" onclick={repair}>{t('Repair timings', 'ลองย้ายเวลา')}</button>{/if}
            </div>
          </section>
        {/if}
          {#if SHOW_PROCTORS && shownResourceSummary && (shownResourceSummary.eventsWithUnknownProctorDemand || shownResourceSummary.eventsWithUnfilledProctorPositions)}
            <div class="app-notice warning" role="status"><Icon name="info" size={17} /><p>{#if shownResourceSummary.eventsWithUnknownProctorDemand}{shownResourceSummary.eventsWithUnknownProctorDemand} {t('events have unknown proctor demand; unknown is not zero.', 'รายการไม่ทราบความต้องการผู้คุม ไม่ใช่ศูนย์')}{/if}{#if shownResourceSummary.eventsWithUnknownProctorDemand && shownResourceSummary.eventsWithUnfilledProctorPositions} · {/if}{#if shownResourceSummary.eventsWithUnfilledProctorPositions}{shownResourceSummary.eventsWithUnfilledProctorPositions} {t('events have unfilled known positions.', 'รายการมีตำแหน่งผู้คุมที่ทราบแต่ยังว่าง')}{/if}</p></div>
          {/if}
          <RoomView project={data} {examType} onselect={openExam} />
        </section>
      {:else if SHOW_PROCTORS && view === 'proctors' && result}
        <section class="view" aria-labelledby="proctors-title">
          <hgroup><h1 id="proctors-title">{t(viewTitles.proctors.en, viewTitles.proctors.th)}</h1><p class="lede">{t(viewTitles.proctors.lead, viewTitles.proctors.leadTh)}</p></hgroup>
          <ProctorView project={result.project} onavailability={setAvailability} />
        </section>
      {:else if view === 'cloud' && result}
        <section class="view" aria-labelledby="cloud-title">
          <hgroup><h1 id="cloud-title">{t(viewTitles.cloud.en, viewTitles.cloud.th)}</h1><p class="lede">{t(viewTitles.cloud.lead, viewTitles.cloud.leadTh)}</p></hgroup>
          <CloudView
            connected={cloudConn} saving={cloudSaving} creating={shareSaving} pending={cloudPending} error={cloudError}
            savedAt={cloudConn?.savedAt ?? ''} autosave={autosaveOn} shares={shares} revisionAhead={cloudDirty}
            onautosave={setAutosave} onsave={saveToCloud}
            oncreate={createShareInCloud} onrevoke={revokeShareInCloud} oncopy={copyText} />
        </section>
      {:else if view === 'audit' && result}
        <section class="view" aria-labelledby="audit-title">
          <hgroup><h1 id="audit-title">{t(viewTitles.audit.en, viewTitles.audit.th)}</h1><p class="lede">{t(viewTitles.audit.lead, viewTitles.audit.leadTh)}</p></hgroup>
          <AuditView audit={audit} busy={auditBusy} validation={vValidation} ondownload={download} oncopy={copyAuditInfo} onshare={cloudConn ? copyAuditShare : undefined} />
        </section>
      {:else if view === 'help'}
        <HelpView />
      {/if}
    </main>
  </div>
  <nav class="tab-bar" aria-label={t('Primary', 'เมนูหลัก')}>
    {#each tabItems as item (item.id)}
      <button class="tab-item" class:current={view === item.id} disabled={!available(item.id)} title={available(item.id) ? undefined : navBlockedWhy(item.id)} aria-current={view === item.id ? 'page' : undefined} onclick={() => go(item.id)}>
        <Icon name={item.icon} size={20} />
        <span>{tabLabel(item)}</span>
      </button>
    {/each}
    <button class="tab-item" class:current={moreActive} aria-haspopup="dialog" aria-expanded={moreOpen} onclick={() => { moreOpen = true; }}>
      <Icon name="menu" size={20} />
      <span>{t('More', 'อื่น ๆ')}</span>
    </button>
  </nav>
  <dialog class="more-sheet" bind:this={moreSheet} aria-label={t('Menu', 'เมนู')} onclick={(event) => { if (event.target === moreSheet) moreSheet?.close(); }} onclose={() => { moreOpen = false; }}>
    <div class="more-sheet-head">
      <strong>{t('Menu', 'เมนู')}</strong>
      <button class="icon-button" aria-label={t('Close', 'ปิด')} onclick={() => moreSheet?.close()}><Icon name="close" size={17} /></button>
    </div>
    <ul>
      {#each moreItems as item (item.id)}
        <li><button class="more-item" class:current={view === item.id} disabled={!available(item.id)} title={available(item.id) ? undefined : navBlockedWhy(item.id)} aria-current={view === item.id ? 'page' : undefined} onclick={() => { go(item.id); moreOpen = false; }}><Icon name={item.icon} size={19} /><span>{t(item.en, item.th)}</span></button></li>
      {/each}
      <li><button class="more-item" class:current={view === 'help'} aria-current={view === 'help' ? 'page' : undefined} onclick={() => { go('help'); moreOpen = false; }}><Icon name="info" size={19} /><span>{t('How it works', 'วิธีใช้งาน')}</span></button></li>
    </ul>
    <div class="more-lang">
      <span class="more-lang-label">{t('Language', 'ภาษา')}</span>
      <div class="type-switch type-switch-lang" role="group" aria-label={t('Language', 'ภาษา')}>
        <button class:active={i18n.lang === 'en'} aria-pressed={i18n.lang === 'en'} onclick={() => { i18n.lang = 'en'; }}>EN</button>
        <button class:active={i18n.lang === 'th'} aria-pressed={i18n.lang === 'th'} onclick={() => { i18n.lang = 'th'; }}>ไทย</button>
      </div>
    </div>
    {#if !available('overview')}
      <p class="more-sheet-hint"><Icon name="info" size={15} />{t('Import source files and generate a schedule to unlock the remaining views.', 'นำเข้าไฟล์ข้อมูลและจัดตารางสอบเพื่อเปิดหน้าที่เหลือ')}</p>
    {/if}
  </dialog>
</div>
{#if editId && data}{#key editId}<EditExam project={data} eventId={editId} onclose={() => { editId = ''; }} onsave={saveEdit} />{/key}{/if}
{#if cloudConflict}
  <dialog class="exam-dialog" bind:this={conflictDialog} onclose={() => { cloudConflict = null; }}>
    <div class="dialog-heading">
      <div>
        <h2>{t('Another revision was saved first', 'มีฉบับอื่นถูกบันทึกก่อน')}</h2>
        <p>{t('Another device saved this project to the cloud ahead of this browser. Overwriting silently would destroy work, so choose.', 'อุปกรณ์อื่นบันทึกโครงการนี้ขึ้นคลาวด์ก่อนเบราว์เซอร์นี้ ระบบจะไม่เขียนทับเงียบ ๆ โปรดเลือก')}</p>
      </div>
      <button class="icon-button" aria-label={t('Close', 'ปิด')} onclick={() => conflictDialog?.close()}><Icon name="close" /></button>
    </div>
    <div class="dialog-body">
      <dl class="audit-grid">
        <div><dt>{t('This browser', 'เบราว์เซอร์นี้')}</dt><dd><code>sha256:{cloudConflict.localHash.slice(0, 16)}…</code></dd></div>
        <div><dt>{t('Saved on the cloud', 'ที่บันทึกบนคลาวด์')}</dt><dd><code>sha256:{cloudConflict.cloudHash.slice(0, 16)}…</code></dd></div>
        <div><dt>{t('Cloud revision', 'ฉบับบนคลาวด์')}</dt><dd><code>{cloudConflict.cloudRevisionId}</code></dd></div>
      </dl>
      <p class="muted">{t('The schedule hashes differ, so the two versions are not the same content. Reloading replaces this browser’s unsaved changes; download a ZIP first if you still need them.', 'แฮชของตารางต่างกัน เนื้อหาสองฉบับจึงไม่เหมือนกัน การโหลดใหม่จะแทนที่การเปลี่ยนแปลงที่ยังไม่ได้บันทึก หากยังต้องการใช้ ให้ดาวน์โหลด ZIP ก่อน')}</p>
    </div>
    <div class="dialog-footer">
      <button class="text-button" onclick={downloadZip}>{t('Download project.zip', 'ดาวน์โหลด project.zip')}</button>
      <button class="button secondary" onclick={() => { cloudConflict = null; conflictDialog?.close(); }}>{t('Keep editing locally', 'แก้ต่อในเครื่องนี้')}</button>
      <button class="button primary" onclick={reloadFromCloud}>{t('Reload cloud version', 'โหลดฉบับจากคลาวด์')}</button>
    </div>
  </dialog>
{/if}
