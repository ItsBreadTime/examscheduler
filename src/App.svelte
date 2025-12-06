<script lang="ts">
  import { parseSubjectCSV, parseRulesCSV, mergeSubjects } from './lib/parser';
  import { scheduleExams, exportScheduleToCSV } from './lib/scheduler';
  import { validateSchedule } from './lib/conflicts';
  import type { Subject, Rules, ScheduleResult, ExamPeriod, ScheduledExam, ScheduleConflict, ExamSlot } from './lib/types';
  import { parseThaiDate, formatThaiDate } from './lib/types';
  import JSZip from 'jszip';

  // File state
  let file040Content = $state<string | null>(null);
  let file060Content = $state<string | null>(null);
  let file080Content = $state<string | null>(null);
  let rulesContent = $state<string | null>(null);

  // Parsed data
  let subjects040 = $state<Subject[]>([]);
  let subjects060 = $state<Subject[]>([]);
  let subjects080 = $state<Subject[]>([]);
  let rules = $state<Rules | null>(null);

  // Date selection - defaults for 2025 (BE 2568)
  let midtermStart = $state('2025-01-20');
  let midtermEnd = $state('2025-01-26');
  let finalStart = $state('2025-03-17');
  let finalEnd = $state('2025-03-28');

  // Schedule result
  let scheduleResult = $state<ScheduleResult | null>(null);
  let isScheduling = $state(false);
  let errorMessage = $state<string | null>(null);

  // View mode
  let viewMode = $state<'upload' | 'schedule' | 'calendar' | 'studentGroup' | 'conflicts'>('upload');
  
  // Sub-view for exam type
  let examTypeView = $state<'midterm' | 'final'>('midterm');
  
  // Selected student group for filtering
  let selectedStudentGroup = $state<string | null>(null);
  
  // Selected calendar slot for modal
  let selectedCalendarSlot = $state<{ date: string; time: 'morning' | 'afternoon'; exams: ScheduledExam[] } | null>(null);

  // Search state
  let searchQuery = $state('');
  
  // Edit modal state
  let selectedExamForEdit = $state<ScheduledExam | null>(null);
  let editSlotDate = $state('');
  let editSlotTime = $state<'morning' | 'afternoon'>('morning');

  // Export/Save/Load state
  let isExporting = $state(false);
  let isImporting = $state(false);
  let isSaving = $state(false);
  let saveMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let importFileInput: HTMLInputElement;

  // File upload handlers
  async function handleFileUpload(event: Event, fileType: '040' | '060' | '080' | 'rules') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const content = await file.text();

    switch (fileType) {
      case '040':
        file040Content = content;
        subjects040 = parseSubjectCSV(content, 'fixed');
        break;
      case '060':
        file060Content = content;
        subjects060 = parseSubjectCSV(content, 'schedulable');
        break;
      case '080':
        file080Content = content;
        subjects080 = parseSubjectCSV(content, 'fixed');
        break;
      case 'rules':
        rulesContent = content;
        rules = parseRulesCSV(content);
        break;
    }
  }

  // Check if all files are loaded
  let allFilesLoaded = $derived(
    file040Content !== null &&
    file060Content !== null &&
    file080Content !== null &&
    rulesContent !== null
  );

  // Generate schedule
  function generateSchedule() {
    if (!rules) {
      errorMessage = 'กรุณาอัปโหลดไฟล์ rules.csv';
      return;
    }

    isScheduling = true;
    errorMessage = null;

    try {
      const allSubjects = mergeSubjects(subjects040, subjects080, subjects060);

      const midtermPeriod: ExamPeriod = {
        name: 'midterm',
        startDate: new Date(midtermStart),
        endDate: new Date(midtermEnd)
      };

      const finalPeriod: ExamPeriod = {
        name: 'final',
        startDate: new Date(finalStart),
        endDate: new Date(finalEnd)
      };

      scheduleResult = scheduleExams(allSubjects, {
        midtermPeriod,
        finalPeriod,
        rules
      });

      if (scheduleResult.conflicts.length > 0) {
        viewMode = 'conflicts';
      } else {
        viewMode = 'schedule';
      }
    } catch (e) {
      errorMessage = `เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : 'Unknown error'}`;
    } finally {
      isScheduling = false;
    }
  }

  // Export to CSV
  function downloadCSV() {
    if (!scheduleResult) return;

    const csv = exportScheduleToCSV(scheduleResult.scheduled);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exam_schedule.csv';
    link.click();
    
    URL.revokeObjectURL(url);
  }

  // Group scheduled exams by date for display
  function groupByDate(exams: ScheduledExam[]): Map<string, ScheduledExam[]> {
    const grouped = new Map<string, ScheduledExam[]>();
    
    for (const exam of exams) {
      const key = `${exam.slot.date}-${exam.examType}`;
      const existing = grouped.get(key) || [];
      existing.push(exam);
      grouped.set(key, existing);
    }
    
    return grouped;
  }

  let groupedSchedule = $derived(
    scheduleResult ? groupByDate(scheduleResult.scheduled) : new Map()
  );

  let sortedDates = $derived(
    [...groupedSchedule.keys()].sort((a, b) => {
      const dateA = parseThaiDate(a.split('-')[0])?.getTime() || 0;
      const dateB = parseThaiDate(b.split('-')[0])?.getTime() || 0;
      return dateA - dateB;
    })
  );

  // Filter exams by exam type
  let midtermExams = $derived(
    scheduleResult?.scheduled.filter(e => e.examType === 'midterm') || []
  );
  
  let finalExams = $derived(
    scheduleResult?.scheduled.filter(e => e.examType === 'final') || []
  );
  
  let currentExams = $derived(
    examTypeView === 'midterm' ? midtermExams : finalExams
  );

  // Get all unique student groups
  let allStudentGroups = $derived(() => {
    if (!scheduleResult) return [];
    const groups = new Set<string>();
    for (const exam of scheduleResult.scheduled) {
      for (const group of exam.subject.studentGroups) {
        groups.add(group);
      }
    }
    return [...groups].sort();
  });

  // Get exams for selected student group (deduplicated by subject code)
  let studentGroupExams = $derived(() => {
    if (!scheduleResult || !selectedStudentGroup) return [];
    const exams = scheduleResult.scheduled.filter(exam => 
      exam.subject.studentGroups.includes(selectedStudentGroup!)
    );
    // Deduplicate by subject code + exam type (keep first occurrence, merge sections)
    const seen = new Map<string, ScheduledExam>();
    for (const exam of exams) {
      const key = `${exam.subject.code}-${exam.examType}`;
      if (!seen.has(key)) {
        seen.set(key, exam);
      }
    }
    return [...seen.values()];
  });

  // Calendar data structure
  interface CalendarDay {
    date: Date;
    dateStr: string;
    morning: ScheduledExam[];
    afternoon: ScheduledExam[];
    isWeekend: boolean;
  }

  // Generate calendar data for current exam type
  let calendarData = $derived(() => {
    if (!scheduleResult) return [];
    
    const exams = examTypeView === 'midterm' ? midtermExams : finalExams;
    const start = new Date(examTypeView === 'midterm' ? midtermStart : finalStart);
    const end = new Date(examTypeView === 'midterm' ? midtermEnd : finalEnd);
    
    const days: CalendarDay[] = [];
    const current = new Date(start);
    
    while (current <= end) {
      const dateStr = formatThaiDate(current);
      const dayExams = exams.filter(e => e.slot.date === dateStr);
      
      days.push({
        date: new Date(current),
        dateStr,
        morning: dayExams.filter(e => e.slot.time === 'morning'),
        afternoon: dayExams.filter(e => e.slot.time === 'afternoon'),
        isWeekend: current.getDay() === 0 || current.getDay() === 6
      });
      
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  });

  // Export student group schedule to CSV
  function downloadStudentGroupCSV() {
    if (!selectedStudentGroup) return;
    
    const exams = studentGroupExams();
    const sortedExams = [...exams].sort((a, b) => {
      const dateA = parseThaiDate(a.slot.date)?.getTime() || 0;
      const dateB = parseThaiDate(b.slot.date)?.getTime() || 0;
      if (dateA !== dateB) return dateA - dateB;
      return a.slot.time === 'morning' ? -1 : 1;
    });
    
    const header = 'วันที่,เวลา,ประเภท,รหัสวิชา,ชื่อวิชา,ตอน';
    const rows = sortedExams.map(exam => 
      `${exam.slot.date},${exam.slot.timeDisplay},${exam.examType === 'midterm' ? 'กลางภาค' : 'ปลายภาค'},${exam.subject.code},${exam.subject.name},${exam.subject.section}`
    );
    
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `schedule_${selectedStudentGroup}.csv`;
    link.click();
    
    URL.revokeObjectURL(url);
  }

  // Export calendar to interactive HTML
  function downloadCalendarHTML() {
    const calendar = calendarData();
    const examType = examTypeView === 'midterm' ? 'กลางภาค' : 'ปลายภาค';
    const exams = examTypeView === 'midterm' ? midtermExams : finalExams;
    
    // Group exams by date and time for the HTML
    const examsBySlot: Record<string, { code: string; name: string; groups: string[] }[]> = {};
    for (const exam of exams) {
      const key = exam.slot.date + '-' + exam.slot.time;
      if (!examsBySlot[key]) examsBySlot[key] = [];
      // Deduplicate by subject code
      if (!examsBySlot[key].some(e => e.code === exam.subject.code)) {
        examsBySlot[key].push({
          code: exam.subject.code,
          name: exam.subject.name,
          groups: exam.subject.studentGroups
        });
      }
    }
    
    // Generate calendar cells HTML
    const calendarCells = generateInteractiveCalendarCells(calendar);
    const examDataJson = JSON.stringify(examsBySlot);
    
    // Create interactive HTML content using array join to avoid quote issues
    const contentParts = [
      '<!DOCTYPE html>',
      '<html lang="th">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>ตารางสอบ' + examType + ' - มจพ. วิทยาเขตปราจีนบุรี</title>',
      '  <style>',
      '    * { box-sizing: border-box; margin: 0; padding: 0; }',
      '    body { font-family: "Segoe UI", Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }',
      '    h1 { text-align: center; margin-bottom: 10px; color: #333; }',
      '    .subtitle { text-align: center; color: #666; margin-bottom: 20px; }',
      '    .calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; max-width: 1200px; margin: 0 auto; }',
      '    .calendar-header { background: #4CAF50; color: white; padding: 10px; text-align: center; font-weight: bold; border-radius: 8px; }',
      '    .day { border: 1px solid #ddd; border-radius: 8px; padding: 8px; min-height: 140px; background: white; }',
      '    .day.empty { background: #fafafa; border: none; }',
      '    .day.weekend { background: #f9f9f9; }',
      '    .day-number { font-weight: bold; font-size: 1.1rem; margin-bottom: 8px; }',
      '    .time-slot { margin-bottom: 8px; padding-left: 8px; cursor: pointer; }',
      '    .time-slot.morning { border-left: 3px solid #FF9800; }',
      '    .time-slot.afternoon { border-left: 3px solid #4CAF50; }',
      '    .time-slot:hover { background: #f0f0f0; border-radius: 4px; }',
      '    .slot-label { font-size: 0.75rem; color: #666; display: block; margin-bottom: 4px; }',
      '    .exam-chip { background: #e3f2fd; padding: 4px 6px; border-radius: 4px; font-size: 0.8rem; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '    .exam-more { font-size: 0.75rem; color: #666; font-style: italic; }',
      '    .legend { display: flex; gap: 2rem; justify-content: center; margin-top: 20px; padding: 15px; background: white; border-radius: 8px; max-width: 400px; margin-left: auto; margin-right: auto; }',
      '    .legend-item { display: flex; align-items: center; gap: 8px; }',
      '    .legend-color { width: 16px; height: 16px; border-radius: 4px; }',
      '    .legend-color.morning { background: #FF9800; }',
      '    .legend-color.afternoon { background: #4CAF50; }',
      '    .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center; }',
      '    .modal-overlay.active { display: flex; }',
      '    .modal { background: white; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }',
      '    .modal-header { padding: 1rem 1.5rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }',
      '    .modal-header h2 { margin: 0; font-size: 1.2rem; }',
      '    .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #666; }',
      '    .modal-close:hover { color: #333; }',
      '    .modal-body { padding: 1.5rem; }',
      '    .exam-item { padding: 12px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 8px; }',
      '    .exam-item:last-child { margin-bottom: 0; }',
      '    .exam-code { font-weight: bold; color: #1976D2; }',
      '    .exam-name { margin-top: 4px; }',
      '    .exam-groups { font-size: 0.85rem; color: #666; margin-top: 4px; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <h1>🗓️ ตารางสอบ' + examType + '</h1>',
      '  <p class="subtitle">มจพ. วิทยาเขตปราจีนบุรี</p>',
      '  <div class="calendar">',
      '    <div class="calendar-header">อา.</div>',
      '    <div class="calendar-header">จ.</div>',
      '    <div class="calendar-header">อ.</div>',
      '    <div class="calendar-header">พ.</div>',
      '    <div class="calendar-header">พฤ.</div>',
      '    <div class="calendar-header">ศ.</div>',
      '    <div class="calendar-header">ส.</div>',
      calendarCells,
      '  </div>',
      '  <div class="legend">',
      '    <div class="legend-item"><div class="legend-color morning"></div> เช้า (09:00-12:00)</div>',
      '    <div class="legend-item"><div class="legend-color afternoon"></div> บ่าย (13:00-16:00)</div>',
      '  </div>',
      '  <div class="modal-overlay" id="modal" onclick="closeModal(event)">',
      '    <div class="modal" onclick="event.stopPropagation()">',
      '      <div class="modal-header">',
      '        <h2 id="modal-title">รายละเอียดการสอบ</h2>',
      '        <button class="modal-close" onclick="closeModal()">×</button>',
      '      </div>',
      '      <div class="modal-body" id="modal-body"></div>',
      '    </div>',
      '  </div>',
      '  <script>',
      '    var examData = ' + examDataJson + ';',
      '    function showSlotDetails(dateStr, time) {',
      '      var key = dateStr + "-" + time;',
      '      var exams = examData[key] || [];',
      '      var timeLabel = time === "morning" ? "09:00-12:00" : "13:00-16:00";',
      '      document.getElementById("modal-title").textContent = dateStr + " " + timeLabel;',
      '      var html = "";',
      '      for (var i = 0; i < exams.length; i++) {',
      '        var exam = exams[i];',
      "        html += '<div class=\"exam-item\"><div class=\"exam-code\">' + exam.code + '</div><div class=\"exam-name\">' + exam.name + '</div><div class=\"exam-groups\">กลุ่ม: ' + exam.groups.join(\", \") + '</div></div>';",
      '      }',
      '      if (html === "") { html = "<p>ไม่มีการสอบในช่วงเวลานี้</p>"; }',
      '      document.getElementById("modal-body").innerHTML = html;',
      '      document.getElementById("modal").classList.add("active");',
      '    }',
      '    function closeModal(event) {',
      '      if (!event || event.target.id === "modal") {',
      '        document.getElementById("modal").classList.remove("active");',
      '      }',
      '    }',
      '    document.addEventListener("keydown", function(e) { if (e.key === "Escape") closeModal(); });',
      '  </' + 'script>',
      '</body>',
      '</html>'
    ];
    
    const content = contentParts.join('\n');
    const blob = new Blob([content], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exam_calendar_' + examTypeView + '.html';
    link.click();
    
    URL.revokeObjectURL(url);
  }

  function generateInteractiveCalendarCells(days: CalendarDay[]): string {
    if (days.length === 0) return '';
    
    // Fill empty cells before first day
    const firstDayOfWeek = days[0].date.getDay();
    let cells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells += '<div class="day empty"></div>';
    }
    
    // Generate day cells
    for (const day of days) {
      const weekendClass = day.isWeekend ? 'weekend' : '';
      const dayNum = day.date.getDate();
      
      // Deduplicate exams by subject code
      const morningExams = deduplicateExams(day.morning);
      const afternoonExams = deduplicateExams(day.afternoon);
      
      let examContent = '';
      if (morningExams.length > 0) {
        examContent += '<div class="time-slot morning" onclick="showSlotDetails(\'' + day.dateStr + '\', \'morning\')">';
        examContent += '<span class="slot-label">🌅 เช้า (' + morningExams.length + ')</span>';
        for (const exam of morningExams.slice(0, 2)) {
          const shortName = exam.subject.name.length > 15 ? exam.subject.name.substring(0, 15) + '...' : exam.subject.name;
          examContent += '<div class="exam-chip">' + exam.subject.code + ' - ' + shortName + '</div>';
        }
        if (morningExams.length > 2) {
          examContent += '<div class="exam-more">+' + (morningExams.length - 2) + ' อื่นๆ</div>';
        }
        examContent += '</div>';
      }
      if (afternoonExams.length > 0) {
        examContent += '<div class="time-slot afternoon" onclick="showSlotDetails(\'' + day.dateStr + '\', \'afternoon\')">';
        examContent += '<span class="slot-label">🌇 บ่าย (' + afternoonExams.length + ')</span>';
        for (const exam of afternoonExams.slice(0, 2)) {
          const shortName = exam.subject.name.length > 15 ? exam.subject.name.substring(0, 15) + '...' : exam.subject.name;
          examContent += '<div class="exam-chip">' + exam.subject.code + ' - ' + shortName + '</div>';
        }
        if (afternoonExams.length > 2) {
          examContent += '<div class="exam-more">+' + (afternoonExams.length - 2) + ' อื่นๆ</div>';
        }
        examContent += '</div>';
      }
      
      cells += '<div class="day ' + weekendClass + '"><div class="day-number">' + dayNum + '</div>' + examContent + '</div>';
    }
    
    return cells;
  }

  // Helper to deduplicate exams by subject code
  function deduplicateExams(exams: ScheduledExam[]): ScheduledExam[] {
    const seen = new Map<string, ScheduledExam>();
    for (const exam of exams) {
      if (!seen.has(exam.subject.code)) {
        seen.set(exam.subject.code, exam);
      }
    }
    return [...seen.values()];
  }

  // Filter exams by search query
  let filteredExams = $derived(() => {
    if (!searchQuery.trim()) return currentExams;
    const query = searchQuery.toLowerCase().trim();
    return currentExams.filter(exam => 
      exam.subject.code.toLowerCase().includes(query) ||
      exam.subject.name.toLowerCase().includes(query) ||
      exam.subject.studentGroups.some(g => g.toLowerCase().includes(query))
    );
  });

  // Get available slots for editing (based on exam type)
  let availableEditSlots = $derived(() => {
    if (!selectedExamForEdit) return [];
    
    const start = new Date(selectedExamForEdit.examType === 'midterm' ? midtermStart : finalStart);
    const end = new Date(selectedExamForEdit.examType === 'midterm' ? midtermEnd : finalEnd);
    
    const slots: { date: string; dateDisplay: string }[] = [];
    const current = new Date(start);
    
    while (current <= end) {
      const dateStr = formatThaiDate(current);
      const dayName = getThaiDayName(current);
      const isWeekend = current.getDay() === 0 || current.getDay() === 6;
      slots.push({
        date: dateStr,
        dateDisplay: `${dateStr} (${dayName})${isWeekend ? ' - วันหยุด' : ''}`
      });
      current.setDate(current.getDate() + 1);
    }
    
    return slots;
  });

  // Open edit modal for an exam
  function openEditModal(exam: ScheduledExam) {
    selectedExamForEdit = exam;
    // Convert Thai date to ISO date for the date input
    const parsedDate = parseThaiDate(exam.slot.date);
    if (parsedDate) {
      editSlotDate = exam.slot.date;
    }
    editSlotTime = exam.slot.time;
  }

  // Close edit modal
  function closeEditModal() {
    selectedExamForEdit = null;
    editSlotDate = '';
    editSlotTime = 'morning';
  }

  // Save edited timeslot
  function saveEditedSlot() {
    if (!selectedExamForEdit || !scheduleResult || !editSlotDate) return;
    
    const newSlot: ExamSlot = {
      date: editSlotDate,
      time: editSlotTime,
      timeDisplay: editSlotTime === 'morning' ? '09:00-12:00' : '13:00-16:00'
    };
    
    // Find all exams with the same subject code + exam type (different sections)
    const subjectCode = selectedExamForEdit.subject.code;
    const examType = selectedExamForEdit.examType;
    
    // Update all matching exams
    const updatedScheduled = scheduleResult.scheduled.map(exam => {
      if (exam.subject.code === subjectCode && exam.examType === examType) {
        return { ...exam, slot: newSlot };
      }
      return exam;
    });
    
    // Revalidate conflicts
    const newConflicts = validateSchedule(updatedScheduled);
    
    // Update schedule result
    scheduleResult = {
      ...scheduleResult,
      scheduled: updatedScheduled,
      conflicts: newConflicts
    };
    
    closeEditModal();
  }

  // Generate calendar HTML for a specific exam type (midterm or final)
  function generateCalendarHTMLContent(examType: 'midterm' | 'final'): string {
    if (!scheduleResult) return '';
    
    const exams = examType === 'midterm' ? midtermExams : finalExams;
    const start = new Date(examType === 'midterm' ? midtermStart : finalStart);
    const end = new Date(examType === 'midterm' ? midtermEnd : finalEnd);
    const examTypeLabel = examType === 'midterm' ? 'กลางภาค' : 'ปลายภาค';
    
    // Generate calendar days
    const days: CalendarDay[] = [];
    const current = new Date(start);
    while (current <= end) {
      const dateStr = formatThaiDate(current);
      const dayExams = exams.filter(e => e.slot.date === dateStr);
      days.push({
        date: new Date(current),
        dateStr,
        morning: dayExams.filter(e => e.slot.time === 'morning'),
        afternoon: dayExams.filter(e => e.slot.time === 'afternoon'),
        isWeekend: current.getDay() === 0 || current.getDay() === 6
      });
      current.setDate(current.getDate() + 1);
    }
    
    // Group exams by date and time for the HTML
    const examsBySlot: Record<string, { code: string; name: string; groups: string[] }[]> = {};
    for (const exam of exams) {
      const key = exam.slot.date + '-' + exam.slot.time;
      if (!examsBySlot[key]) examsBySlot[key] = [];
      if (!examsBySlot[key].some(e => e.code === exam.subject.code)) {
        examsBySlot[key].push({
          code: exam.subject.code,
          name: exam.subject.name,
          groups: exam.subject.studentGroups
        });
      }
    }
    
    const calendarCells = generateInteractiveCalendarCells(days);
    const examDataJson = JSON.stringify(examsBySlot);
    
    const contentParts = [
      '<!DOCTYPE html>',
      '<html lang="th">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>ตารางสอบ' + examTypeLabel + ' - มจพ. วิทยาเขตปราจีนบุรี</title>',
      '  <style>',
      '    * { box-sizing: border-box; margin: 0; padding: 0; }',
      '    body { font-family: "Segoe UI", Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }',
      '    h1 { text-align: center; margin-bottom: 10px; color: #333; }',
      '    .subtitle { text-align: center; color: #666; margin-bottom: 20px; }',
      '    .calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; max-width: 1200px; margin: 0 auto; }',
      '    .calendar-header { background: #4CAF50; color: white; padding: 10px; text-align: center; font-weight: bold; border-radius: 8px; }',
      '    .day { border: 1px solid #ddd; border-radius: 8px; padding: 8px; min-height: 140px; background: white; }',
      '    .day.empty { background: #fafafa; border: none; }',
      '    .day.weekend { background: #f9f9f9; }',
      '    .day-number { font-weight: bold; font-size: 1.1rem; margin-bottom: 8px; }',
      '    .time-slot { margin-bottom: 8px; padding-left: 8px; cursor: pointer; }',
      '    .time-slot.morning { border-left: 3px solid #FF9800; }',
      '    .time-slot.afternoon { border-left: 3px solid #4CAF50; }',
      '    .time-slot:hover { background: #f0f0f0; border-radius: 4px; }',
      '    .slot-label { font-size: 0.75rem; color: #666; display: block; margin-bottom: 4px; }',
      '    .exam-chip { background: #e3f2fd; padding: 4px 6px; border-radius: 4px; font-size: 0.8rem; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '    .exam-more { font-size: 0.75rem; color: #666; font-style: italic; }',
      '    .legend { display: flex; gap: 2rem; justify-content: center; margin-top: 20px; padding: 15px; background: white; border-radius: 8px; max-width: 400px; margin-left: auto; margin-right: auto; }',
      '    .legend-item { display: flex; align-items: center; gap: 8px; }',
      '    .legend-color { width: 16px; height: 16px; border-radius: 4px; }',
      '    .legend-color.morning { background: #FF9800; }',
      '    .legend-color.afternoon { background: #4CAF50; }',
      '    .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center; }',
      '    .modal-overlay.active { display: flex; }',
      '    .modal { background: white; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }',
      '    .modal-header { padding: 1rem 1.5rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }',
      '    .modal-header h2 { margin: 0; font-size: 1.2rem; }',
      '    .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #666; }',
      '    .modal-close:hover { color: #333; }',
      '    .modal-body { padding: 1.5rem; }',
      '    .exam-item { padding: 12px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 8px; }',
      '    .exam-item:last-child { margin-bottom: 0; }',
      '    .exam-code { font-weight: bold; color: #1976D2; }',
      '    .exam-name { margin-top: 4px; }',
      '    .exam-groups { font-size: 0.85rem; color: #666; margin-top: 4px; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <h1>🗓️ ตารางสอบ' + examTypeLabel + '</h1>',
      '  <p class="subtitle">มจพ. วิทยาเขตปราจีนบุรี</p>',
      '  <div class="calendar">',
      '    <div class="calendar-header">อา.</div>',
      '    <div class="calendar-header">จ.</div>',
      '    <div class="calendar-header">อ.</div>',
      '    <div class="calendar-header">พ.</div>',
      '    <div class="calendar-header">พฤ.</div>',
      '    <div class="calendar-header">ศ.</div>',
      '    <div class="calendar-header">ส.</div>',
      calendarCells,
      '  </div>',
      '  <div class="legend">',
      '    <div class="legend-item"><div class="legend-color morning"></div> เช้า (09:00-12:00)</div>',
      '    <div class="legend-item"><div class="legend-color afternoon"></div> บ่าย (13:00-16:00)</div>',
      '  </div>',
      '  <div class="modal-overlay" id="modal" onclick="closeModal(event)">',
      '    <div class="modal" onclick="event.stopPropagation()">',
      '      <div class="modal-header">',
      '        <h2 id="modal-title">รายละเอียดการสอบ</h2>',
      '        <button class="modal-close" onclick="closeModal()">×</button>',
      '      </div>',
      '      <div class="modal-body" id="modal-body"></div>',
      '    </div>',
      '  </div>',
      '  <script>',
      '    var examData = ' + examDataJson + ';',
      '    function showSlotDetails(dateStr, time) {',
      '      var key = dateStr + "-" + time;',
      '      var exams = examData[key] || [];',
      '      var timeLabel = time === "morning" ? "09:00-12:00" : "13:00-16:00";',
      '      document.getElementById("modal-title").textContent = dateStr + " " + timeLabel;',
      '      var html = "";',
      '      for (var i = 0; i < exams.length; i++) {',
      '        var exam = exams[i];',
      "        html += '<div class=\"exam-item\"><div class=\"exam-code\">' + exam.code + '</div><div class=\"exam-name\">' + exam.name + '</div><div class=\"exam-groups\">กลุ่ม: ' + exam.groups.join(\", \") + '</div></div>';",
      '      }',
      '      if (html === "") { html = "<p>ไม่มีการสอบในช่วงเวลานี้</p>"; }',
      '      document.getElementById("modal-body").innerHTML = html;',
      '      document.getElementById("modal").classList.add("active");',
      '    }',
      '    function closeModal(event) {',
      '      if (!event || event.target.id === "modal") {',
      '        document.getElementById("modal").classList.remove("active");',
      '      }',
      '    }',
      '    document.addEventListener("keydown", function(e) { if (e.key === "Escape") closeModal(); });',
      '  </' + 'script>',
      '</body>',
      '</html>'
    ];
    
    return contentParts.join('\n');
  }

  // Generate student group CSV content for a specific group
  function generateStudentGroupCSVContent(group: string): string {
    if (!scheduleResult) return '';
    
    const exams = scheduleResult.scheduled.filter(exam => 
      exam.subject.studentGroups.includes(group)
    );
    
    // Deduplicate by subject code + exam type
    const seen = new Map<string, ScheduledExam>();
    for (const exam of exams) {
      const key = `${exam.subject.code}-${exam.examType}`;
      if (!seen.has(key)) {
        seen.set(key, exam);
      }
    }
    
    const dedupedExams = [...seen.values()].sort((a, b) => {
      const dateA = parseThaiDate(a.slot.date)?.getTime() || 0;
      const dateB = parseThaiDate(b.slot.date)?.getTime() || 0;
      if (dateA !== dateB) return dateA - dateB;
      return a.slot.time === 'morning' ? -1 : 1;
    });
    
    const header = 'วันที่,เวลา,ประเภท,รหัสวิชา,ชื่อวิชา,ตอน';
    const rows = dedupedExams.map(exam => 
      `${exam.slot.date},${exam.slot.timeDisplay},${exam.examType === 'midterm' ? 'กลางภาค' : 'ปลายภาค'},${exam.subject.code},${exam.subject.name},${exam.subject.section}`
    );
    
    return '\ufeff' + [header, ...rows].join('\n');
  }

  // Generate conflicts CSV
  function generateConflictsCSV(): string {
    if (!scheduleResult) return '';
    
    const header = 'วันที่,เวลา,ประเภท,กลุ่มนักศึกษา,รหัสวิชาที่ขัดแย้ง,ชื่อวิชาที่ขัดแย้ง';
    const rows = scheduleResult.conflicts.map(conflict => {
      const codes = conflict.subjects.map(s => s.code).join('; ');
      const names = conflict.subjects.map(s => s.name).join('; ');
      return `${conflict.slot.date},${conflict.slot.timeDisplay},${conflict.examType === 'midterm' ? 'กลางภาค' : 'ปลายภาค'},${conflict.studentGroup},"${codes}","${names}"`;
    });
    
    return '\ufeff' + [header, ...rows].join('\n');
  }

  // Export all files as ZIP
  async function exportAllAsZip() {
    if (!scheduleResult) return;
    
    isExporting = true;
    
    try {
      const zip = new JSZip();
      
      // 1. Main schedule CSV
      const mainScheduleCSV = exportScheduleToCSV(scheduleResult.scheduled);
      zip.file('ตารางสอบทั้งหมด.csv', '\ufeff' + mainScheduleCSV);
      
      // 2. Midterm and Final schedule CSVs
      const midtermCSV = exportScheduleToCSV(midtermExams);
      const finalCSV = exportScheduleToCSV(finalExams);
      zip.file('ตารางสอบกลางภาค.csv', '\ufeff' + midtermCSV);
      zip.file('ตารางสอบปลายภาค.csv', '\ufeff' + finalCSV);
      
      // 3. Calendar HTML files
      const midtermHTML = generateCalendarHTMLContent('midterm');
      const finalHTML = generateCalendarHTMLContent('final');
      zip.file('ปฏิทินสอบกลางภาค.html', midtermHTML);
      zip.file('ปฏิทินสอบปลายภาค.html', finalHTML);
      
      // 4. Student group schedules folder
      const groups = allStudentGroups();
      const studentGroupFolder = zip.folder('ตารางสอบรายกลุ่ม');
      if (studentGroupFolder) {
        for (const group of groups) {
          const groupCSV = generateStudentGroupCSVContent(group);
          // Sanitize filename
          const safeFilename = group.replace(/[/\\?%*:|"<>]/g, '_');
          studentGroupFolder.file(`${safeFilename}.csv`, groupCSV);
        }
      }
      
      // 5. Conflicts CSV
      if (scheduleResult.conflicts.length > 0) {
        const conflictsCSV = generateConflictsCSV();
        zip.file('ข้อขัดแย้ง.csv', conflictsCSV);
      }
      
      // 6. Data JSON for re-import
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: {
          midtermStart,
          midtermEnd,
          finalStart,
          finalEnd
        },
        scheduleResult,
        subjects040,
        subjects060,
        subjects080,
        rules
      };
      zip.file('_data.json', JSON.stringify(exportData, null, 2));
      
      // Generate and download ZIP
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = 'exam_schedule_export.zip';
      link.click();
      
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error:', e);
      alert('เกิดข้อผิดพลาดในการส่งออกไฟล์');
    } finally {
      isExporting = false;
    }
  }

  // Save schedule to localStorage
  function saveSchedule() {
    if (!scheduleResult) return;
    
    isSaving = true;
    saveMessage = null;
    
    try {
      const saveData = {
        version: 1,
        savedAt: new Date().toISOString(),
        settings: {
          midtermStart,
          midtermEnd,
          finalStart,
          finalEnd
        },
        scheduleResult,
        // Also save parsed subjects for reference
        subjects040: subjects040,
        subjects060: subjects060,
        subjects080: subjects080,
        rules
      };
      
      localStorage.setItem('examSchedulerSave', JSON.stringify(saveData));
      saveMessage = { type: 'success', text: '✅ บันทึกสำเร็จ!' };
      
      // Clear message after 3 seconds
      setTimeout(() => {
        saveMessage = null;
      }, 3000);
    } catch (e) {
      console.error('Save error:', e);
      saveMessage = { type: 'error', text: '❌ บันทึกไม่สำเร็จ' };
    } finally {
      isSaving = false;
    }
  }

  // Load schedule from localStorage
  function loadSchedule() {
    try {
      const savedData = localStorage.getItem('examSchedulerSave');
      if (!savedData) {
        saveMessage = { type: 'error', text: '❌ ไม่พบข้อมูลที่บันทึกไว้' };
        setTimeout(() => saveMessage = null, 3000);
        return;
      }
      
      const data = JSON.parse(savedData);
      
      // Restore settings
      if (data.settings) {
        midtermStart = data.settings.midtermStart;
        midtermEnd = data.settings.midtermEnd;
        finalStart = data.settings.finalStart;
        finalEnd = data.settings.finalEnd;
      }
      
      // Restore subjects
      if (data.subjects040) subjects040 = data.subjects040;
      if (data.subjects060) subjects060 = data.subjects060;
      if (data.subjects080) subjects080 = data.subjects080;
      if (data.rules) rules = data.rules;
      
      // Mark files as loaded (for UI)
      if (data.subjects040?.length) file040Content = 'loaded';
      if (data.subjects060?.length) file060Content = 'loaded';
      if (data.subjects080?.length) file080Content = 'loaded';
      if (data.rules) rulesContent = 'loaded';
      
      // Restore schedule result
      if (data.scheduleResult) {
        scheduleResult = data.scheduleResult;
        viewMode = 'schedule';
      }
      
      saveMessage = { type: 'success', text: '✅ โหลดข้อมูลสำเร็จ!' };
      setTimeout(() => saveMessage = null, 3000);
    } catch (e) {
      console.error('Load error:', e);
      saveMessage = { type: 'error', text: '❌ โหลดข้อมูลไม่สำเร็จ' };
      setTimeout(() => saveMessage = null, 3000);
    }
  }

  // Check if there's a saved schedule
  let hasSavedSchedule = $derived(() => {
    try {
      return localStorage.getItem('examSchedulerSave') !== null;
    } catch {
      return false;
    }
  });

  // Import from ZIP file
  async function importFromZip(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    isImporting = true;
    saveMessage = null;
    
    try {
      const file = input.files[0];
      const zip = await JSZip.loadAsync(file);
      
      // Look for _data.json file
      const dataFile = zip.file('_data.json');
      if (!dataFile) {
        saveMessage = { type: 'error', text: '❌ ไฟล์ ZIP ไม่ถูกต้อง (ไม่พบ _data.json)' };
        setTimeout(() => saveMessage = null, 3000);
        return;
      }
      
      const dataContent = await dataFile.async('string');
      const data = JSON.parse(dataContent);
      
      // Restore settings
      if (data.settings) {
        midtermStart = data.settings.midtermStart;
        midtermEnd = data.settings.midtermEnd;
        finalStart = data.settings.finalStart;
        finalEnd = data.settings.finalEnd;
      }
      
      // Restore subjects
      if (data.subjects040) subjects040 = data.subjects040;
      if (data.subjects060) subjects060 = data.subjects060;
      if (data.subjects080) subjects080 = data.subjects080;
      if (data.rules) rules = data.rules;
      
      // Mark files as loaded (for UI)
      if (data.subjects040?.length) file040Content = 'loaded';
      if (data.subjects060?.length) file060Content = 'loaded';
      if (data.subjects080?.length) file080Content = 'loaded';
      if (data.rules) rulesContent = 'loaded';
      
      // Restore schedule result
      if (data.scheduleResult) {
        scheduleResult = data.scheduleResult;
        viewMode = 'schedule';
      }
      
      saveMessage = { type: 'success', text: '✅ นำเข้าข้อมูลสำเร็จ!' };
      setTimeout(() => saveMessage = null, 3000);
    } catch (e) {
      console.error('Import error:', e);
      saveMessage = { type: 'error', text: '❌ นำเข้าข้อมูลไม่สำเร็จ' };
      setTimeout(() => saveMessage = null, 3000);
    } finally {
      isImporting = false;
      // Reset input so same file can be selected again
      input.value = '';
    }
  }

  // Trigger file input for import
  function triggerImport() {
    importFileInput?.click();
  }

  // Get day name in Thai
  function getThaiDayName(date: Date): string {
    const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    return days[date.getDay()];
  }

  function formatDisplayDate(date: Date): string {
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  }
</script>

<main>
  <h1>🗓️ ระบบจัดตารางสอบ</h1>
  <p class="subtitle">มจพ. วิทยาเขตปราจีนบุรี</p>

  <!-- Global actions bar -->
  <div class="global-actions">
    <div class="action-group save-load-group">
      <button 
        class="action-btn save-btn" 
        onclick={saveSchedule}
        disabled={!scheduleResult || isSaving}
        title="บันทึกตารางสอบลงในเบราว์เซอร์"
      >
        {#if isSaving}
          ⏳ กำลังบันทึก...
        {:else}
          💾 บันทึก
        {/if}
      </button>
      <button 
        class="action-btn load-btn" 
        onclick={loadSchedule}
        disabled={!hasSavedSchedule()}
        title={hasSavedSchedule() ? 'โหลดตารางสอบที่บันทึกไว้' : 'ไม่มีข้อมูลที่บันทึกไว้'}
      >
        📂 โหลด
      </button>
    </div>
    
    <div class="action-group export-import-group">
      <button 
        class="action-btn export-all-btn" 
        onclick={exportAllAsZip}
        disabled={!scheduleResult || isExporting}
        title="ส่งออกไฟล์ทั้งหมดเป็น ZIP"
      >
        {#if isExporting}
          ⏳ กำลังส่งออก...
        {:else}
          📦 ส่งออก (ZIP)
        {/if}
      </button>
      
      <input 
        type="file" 
        accept=".zip"
        onchange={importFromZip}
        bind:this={importFileInput}
        style="display: none;"
      />
      <button 
        class="action-btn import-btn" 
        onclick={triggerImport}
        disabled={isImporting}
        title="นำเข้าจากไฟล์ ZIP ที่ส่งออกไว้"
      >
        {#if isImporting}
          ⏳ กำลังนำเข้า...
        {:else}
          📥 นำเข้า (ZIP)
        {/if}
      </button>
    </div>

    {#if saveMessage}
      <span class="save-message" class:success={saveMessage.type === 'success'} class:error={saveMessage.type === 'error'}>
        {saveMessage.text}
      </span>
    {/if}
  </div>

  <!-- Navigation tabs -->
  <nav class="tabs">
    <button 
      class:active={viewMode === 'upload'} 
      onclick={() => viewMode = 'upload'}
    >
      📁 อัปโหลด
    </button>
    <button 
      class:active={viewMode === 'schedule'} 
      onclick={() => viewMode = 'schedule'}
      disabled={!scheduleResult}
    >
      📋 ตาราง
    </button>
    <button 
      class:active={viewMode === 'calendar'} 
      onclick={() => viewMode = 'calendar'}
      disabled={!scheduleResult}
    >
      📅 ปฏิทิน
    </button>
    <button 
      class:active={viewMode === 'studentGroup'} 
      onclick={() => viewMode = 'studentGroup'}
      disabled={!scheduleResult}
    >
      👥 กลุ่มนักศึกษา
    </button>
    <button 
      class:active={viewMode === 'conflicts'} 
      onclick={() => viewMode = 'conflicts'}
      disabled={!scheduleResult}
    >
      ⚠️ ข้อขัดแย้ง {scheduleResult?.conflicts?.length ? `(${scheduleResult.conflicts.length})` : ''}
    </button>
  </nav>

  {#if viewMode === 'upload'}
    <section class="upload-section">
      <h2>อัปโหลดไฟล์ CSV</h2>
      
      <div class="file-grid">
        <div class="file-card" class:loaded={file040Content !== null}>
          <h3>040.csv</h3>
          <p>ตารางสอบคณะวิทยาศาสตร์ประยุกต์ (คงที่)</p>
          <input type="file" accept=".csv" onchange={(e) => handleFileUpload(e, '040')} />
          {#if file040Content}
            <span class="status">✅ โหลดแล้ว ({new Set(subjects040.map(s => s.code)).size} รายวิชา)</span>
          {/if}
        </div>

        <div class="file-card" class:loaded={file060Content !== null}>
          <h3>060.csv</h3>
          <p>ตารางสอบคณะเทคโนโลยีฯ (จัดอัตโนมัติ)</p>
          <input type="file" accept=".csv" onchange={(e) => handleFileUpload(e, '060')} />
          {#if file060Content}
            <span class="status">✅ โหลดแล้ว ({new Set(subjects060.map(s => s.code)).size} รายวิชา)</span>
          {/if}
        </div>

        <div class="file-card" class:loaded={file080Content !== null}>
          <h3>080.csv</h3>
          <p>ตารางสอบคณะศิลปศาสตร์ประยุกต์ (คงที่)</p>
          <input type="file" accept=".csv" onchange={(e) => handleFileUpload(e, '080')} />
          {#if file080Content}
            <span class="status">✅ โหลดแล้ว ({new Set(subjects080.map(s => s.code)).size} รายวิชา)</span>
          {/if}
        </div>

        <div class="file-card" class:loaded={rulesContent !== null}>
          <h3>rules.csv</h3>
          <p>กฎเกณฑ์การจัดสอบ</p>
          <input type="file" accept=".csv" onchange={(e) => handleFileUpload(e, 'rules')} />
          {#if rules}
            <span class="status">✅ โหลดแล้ว</span>
            <ul class="rules-summary">
              <li>ไม่มีสอบกลางภาค: {rules.noMidterm.length} วิชา</li>
              <li>ไม่มีสอบปลายภาค: {rules.noFinal.length} วิชา</li>
              <li>ไม่มีสอบ: {rules.noExam.length} วิชา</li>
              <li>สอบสองช่วง (9:00-16:00): {rules.fullDayExam.length} วิชา</li>
              <li>สอบพร้อมกัน: {rules.sameTimeGroups.length} กลุ่ม</li>
            </ul>
          {/if}
        </div>
      </div>

      <h2>ตั้งค่าช่วงวันสอบ</h2>
      
      <div class="date-settings">
        <div class="date-group">
          <h3>สอบกลางภาค</h3>
          <label>
            เริ่มต้น:
            <input type="date" bind:value={midtermStart} />
          </label>
          <label>
            สิ้นสุด:
            <input type="date" bind:value={midtermEnd} />
          </label>
        </div>

        <div class="date-group">
          <h3>สอบปลายภาค</h3>
          <label>
            เริ่มต้น:
            <input type="date" bind:value={finalStart} />
          </label>
          <label>
            สิ้นสุด:
            <input type="date" bind:value={finalEnd} />
          </label>
        </div>

      </div>

      {#if errorMessage}
        <div class="error-message">
          ❌ {errorMessage}
        </div>
      {/if}

      <button 
        class="generate-btn"
        onclick={generateSchedule}
        disabled={!allFilesLoaded || isScheduling}
      >
        {#if isScheduling}
          ⏳ กำลังจัดตาราง...
        {:else}
          จัดตารางสอบ
        {/if}
      </button>

      {#if !allFilesLoaded}
        <p class="hint">กรุณาอัปโหลดไฟล์ทั้ง 4 ไฟล์ก่อนจัดตาราง</p>
      {/if}
    </section>
  {/if}

  {#if viewMode === 'schedule' && scheduleResult}
    <section class="schedule-section">
      <div class="schedule-header">
        <h2>📋 ตารางสอบที่จัดแล้ว</h2>
        <div class="actions">
          <button onclick={downloadCSV}>📥 ดาวน์โหลด CSV</button>
        </div>
      </div>

      <!-- Exam type tabs -->
      <div class="exam-type-tabs">
        <button 
          class:active={examTypeView === 'midterm'}
          onclick={() => examTypeView = 'midterm'}
        >
          📝 กลางภาค ({midtermExams.length})
        </button>
        <button 
          class:active={examTypeView === 'final'}
          onclick={() => examTypeView = 'final'}
        >
          📝 ปลายภาค ({finalExams.length})
        </button>
      </div>

      <!-- Search box -->
      <div class="search-box">
        <input 
          type="text" 
          placeholder="🔍 ค้นหารหัสวิชา, ชื่อวิชา, หรือกลุ่มนักศึกษา..." 
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button class="clear-search" onclick={() => searchQuery = ''}>✕</button>
        {/if}
      </div>

      <div class="summary">
        <span>จัดได้: {currentExams.length} รายวิชา</span>
        {#if searchQuery}
          <span>พบ: {filteredExams().length} รายวิชา</span>
        {/if}
        <span>จัดไม่ได้: {scheduleResult.unscheduled.filter(s => 
          examTypeView === 'midterm' ? !s.midtermDate : !s.finalDate
        ).length} รายวิชา</span>
      </div>

      <p class="edit-hint">💡 คลิกที่แถวเพื่อแก้ไขเวลาสอบ</p>

      <div class="schedule-table">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>เวลา</th>
              <th>รหัสวิชา</th>
              <th>ชื่อวิชา</th>
              <th>ตอน</th>
              <th>กลุ่มนักศึกษา</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredExams().sort((a, b) => {
              const dateA = parseThaiDate(a.slot.date)?.getTime() || 0;
              const dateB = parseThaiDate(b.slot.date)?.getTime() || 0;
              if (dateA !== dateB) return dateA - dateB;
              return a.slot.time === 'morning' ? -1 : 1;
            }) as exam}
              <tr class="clickable-row" onclick={() => openEditModal(exam)}>
                <td>{exam.slot.date}</td>
                <td>{exam.slot.timeDisplay}</td>
                <td>{exam.subject.code}</td>
                <td>{exam.subject.name}</td>
                <td>{exam.subject.section}</td>
                <td>{exam.subject.studentGroups.join(', ')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if scheduleResult.unscheduled.length > 0}
        <div class="unscheduled">
          <h3>⚠️ รายวิชาที่จัดไม่ได้</h3>
          <ul>
            {#each scheduleResult.unscheduled as subject}
              <li>{subject.code} - {subject.name} (ตอน {subject.section})</li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Edit modal -->
      {#if selectedExamForEdit}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
        <div class="modal-overlay" onclick={closeEditModal} role="button" tabindex="-1">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
          <div class="modal edit-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
            <div class="modal-header">
              <h3>✏️ แก้ไขเวลาสอบ</h3>
              <button class="modal-close" onclick={closeEditModal}>×</button>
            </div>
            <div class="modal-body">
              <div class="edit-exam-info">
                <div class="edit-label">รายวิชา</div>
                <div class="edit-value">
                  <strong>{selectedExamForEdit.subject.code}</strong> - {selectedExamForEdit.subject.name}
                </div>
                <div class="edit-label">ประเภทสอบ</div>
                <div class="edit-value">
                  {selectedExamForEdit.examType === 'midterm' ? '📝 กลางภาค' : '📝 ปลายภาค'}
                </div>
                <div class="edit-label">เวลาปัจจุบัน</div>
                <div class="edit-value current-slot">
                  {selectedExamForEdit.slot.date} {selectedExamForEdit.slot.timeDisplay}
                </div>
              </div>

              <div class="edit-form">
                <div class="form-group">
                  <label for="edit-date">เลือกวันใหม่:</label>
                  <select id="edit-date" bind:value={editSlotDate}>
                    {#each availableEditSlots() as slot}
                      <option value={slot.date}>{slot.dateDisplay}</option>
                    {/each}
                  </select>
                </div>

                <div class="form-group">
                  <span class="form-label">เลือกเวลาใหม่:</span>
                  <div class="time-options">
                    <button 
                      class="time-option" 
                      class:active={editSlotTime === 'morning'}
                      onclick={() => editSlotTime = 'morning'}
                    >
                      🌅 เช้า (09:00-12:00)
                    </button>
                    <button 
                      class="time-option" 
                      class:active={editSlotTime === 'afternoon'}
                      onclick={() => editSlotTime = 'afternoon'}
                    >
                      🌇 บ่าย (13:00-16:00)
                    </button>
                  </div>
                </div>
              </div>

              <div class="edit-warning">
                ⚠️ การเปลี่ยนเวลาจะมีผลกับทุกตอนของวิชานี้ และระบบจะตรวจสอบข้อขัดแย้งใหม่โดยอัตโนมัติ
              </div>

              <div class="edit-actions">
                <button class="btn-cancel" onclick={closeEditModal}>ยกเลิก</button>
                <button class="btn-save" onclick={saveEditedSlot}>💾 บันทึก</button>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if viewMode === 'calendar' && scheduleResult}
    <section class="calendar-section">
      <div class="schedule-header">
        <h2>📅 ปฏิทินตารางสอบ</h2>
        <div class="actions">
          <button onclick={downloadCalendarHTML}>📥 ดาวน์โหลด HTML</button>
        </div>
      </div>

      <!-- Exam type tabs -->
      <div class="exam-type-tabs">
        <button 
          class:active={examTypeView === 'midterm'}
          onclick={() => examTypeView = 'midterm'}
        >
          📝 กลางภาค
        </button>
        <button 
          class:active={examTypeView === 'final'}
          onclick={() => examTypeView = 'final'}
        >
          📝 ปลายภาค
        </button>
      </div>

      <div class="calendar-grid">
        <div class="calendar-header">อา.</div>
        <div class="calendar-header">จ.</div>
        <div class="calendar-header">อ.</div>
        <div class="calendar-header">พ.</div>
        <div class="calendar-header">พฤ.</div>
        <div class="calendar-header">ศ.</div>
        <div class="calendar-header">ส.</div>
        
        <!-- Empty cells before first day -->
        {#each Array(calendarData()[0]?.date.getDay() || 0) as _}
          <div class="calendar-day empty"></div>
        {/each}
        
        {#each calendarData() as day}
          <div class="calendar-day" class:weekend={day.isWeekend}>
            <div class="day-number">{day.date.getDate()}</div>
            
            {#if deduplicateExams(day.morning).length > 0}
              {@const morningExams = deduplicateExams(day.morning)}
              <button 
                class="time-slot morning clickable"
                onclick={() => selectedCalendarSlot = { date: day.dateStr, time: 'morning', exams: morningExams }}
              >
                <span class="slot-label">🌅 เช้า ({morningExams.length})</span>
                {#each morningExams.slice(0, 2) as exam}
                  <div class="exam-chip">
                    {exam.subject.code} - {exam.subject.name.length > 12 ? exam.subject.name.substring(0, 12) + '...' : exam.subject.name}
                  </div>
                {/each}
                {#if morningExams.length > 2}
                  <div class="exam-more">+{morningExams.length - 2} อื่นๆ</div>
                {/if}
              </button>
            {/if}
            
            {#if deduplicateExams(day.afternoon).length > 0}
              {@const afternoonExams = deduplicateExams(day.afternoon)}
              <button 
                class="time-slot afternoon clickable"
                onclick={() => selectedCalendarSlot = { date: day.dateStr, time: 'afternoon', exams: afternoonExams }}
              >
                <span class="slot-label">🌇 บ่าย ({afternoonExams.length})</span>
                {#each afternoonExams.slice(0, 2) as exam}
                  <div class="exam-chip">
                    {exam.subject.code} - {exam.subject.name.length > 12 ? exam.subject.name.substring(0, 12) + '...' : exam.subject.name}
                  </div>
                {/each}
                {#if afternoonExams.length > 2}
                  <div class="exam-more">+{afternoonExams.length - 2} อื่นๆ</div>
                {/if}
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <div class="calendar-legend">
        <span><span class="legend-color morning"></span> เช้า (09:00-12:00)</span>
        <span><span class="legend-color afternoon"></span> บ่าย (13:00-16:00)</span>
      </div>

      <!-- Modal for slot details -->
      {#if selectedCalendarSlot}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
        <div class="modal-overlay" onclick={() => selectedCalendarSlot = null} role="button" tabindex="-1">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
          <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
            <div class="modal-header">
              <h3>{selectedCalendarSlot.date} {selectedCalendarSlot.time === 'morning' ? '09:00-12:00' : '13:00-16:00'}</h3>
              <button class="modal-close" onclick={() => selectedCalendarSlot = null}>×</button>
            </div>
            <div class="modal-body">
              {#each selectedCalendarSlot.exams as exam}
                <div class="exam-detail-card">
                  <div class="exam-detail-code">{exam.subject.code}</div>
                  <div class="exam-detail-name">{exam.subject.name}</div>
                  <div class="exam-detail-groups">กลุ่ม: {exam.subject.studentGroups.join(', ')}</div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if viewMode === 'studentGroup' && scheduleResult}
    <section class="student-group-section">
      <div class="schedule-header">
        <h2>👥 ตารางสอบตามกลุ่มนักศึกษา</h2>
        {#if selectedStudentGroup}
          <div class="actions">
            <button onclick={downloadStudentGroupCSV}>📥 ดาวน์โหลด CSV</button>
          </div>
        {/if}
      </div>

      <div class="group-selector">
        <label for="student-group-select">เลือกกลุ่มนักศึกษา:</label>
        <select id="student-group-select" bind:value={selectedStudentGroup}>
          <option value={null}>-- เลือกกลุ่ม --</option>
          {#each allStudentGroups() as group}
            <option value={group}>{group}</option>
          {/each}
        </select>
      </div>

      {#if selectedStudentGroup}
        <div class="group-schedule">
          <h3>ตารางสอบของกลุ่ม {selectedStudentGroup}</h3>
          
          <!-- Midterm section -->
          <div class="exam-section">
            <h4>📝 สอบกลางภาค</h4>
            {#if studentGroupExams().filter(e => e.examType === 'midterm').length === 0}
              <p class="no-exams">ไม่มีรายวิชาที่ต้องสอบ</p>
            {:else}
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เวลา</th>
                    <th>รหัสวิชา</th>
                    <th>ชื่อวิชา</th>
                  </tr>
                </thead>
                <tbody>
                  {#each studentGroupExams().filter(e => e.examType === 'midterm').sort((a, b) => {
                    const dateA = parseThaiDate(a.slot.date)?.getTime() || 0;
                    const dateB = parseThaiDate(b.slot.date)?.getTime() || 0;
                    if (dateA !== dateB) return dateA - dateB;
                    return a.slot.time === 'morning' ? -1 : 1;
                  }) as exam}
                    <tr>
                      <td>{exam.slot.date}</td>
                      <td>{exam.slot.timeDisplay}</td>
                      <td>{exam.subject.code}</td>
                      <td>{exam.subject.name}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>

          <!-- Final section -->
          <div class="exam-section">
            <h4>📝 สอบปลายภาค</h4>
            {#if studentGroupExams().filter(e => e.examType === 'final').length === 0}
              <p class="no-exams">ไม่มีรายวิชาที่ต้องสอบ</p>
            {:else}
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เวลา</th>
                    <th>รหัสวิชา</th>
                    <th>ชื่อวิชา</th>
                  </tr>
                </thead>
                <tbody>
                  {#each studentGroupExams().filter(e => e.examType === 'final').sort((a, b) => {
                    const dateA = parseThaiDate(a.slot.date)?.getTime() || 0;
                    const dateB = parseThaiDate(b.slot.date)?.getTime() || 0;
                    if (dateA !== dateB) return dateA - dateB;
                    return a.slot.time === 'morning' ? -1 : 1;
                  }) as exam}
                    <tr>
                      <td>{exam.slot.date}</td>
                      <td>{exam.slot.timeDisplay}</td>
                      <td>{exam.subject.code}</td>
                      <td>{exam.subject.name}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        </div>
      {:else}
        <div class="select-prompt">
          <p>กรุณาเลือกกลุ่มนักศึกษาเพื่อดูตารางสอบ</p>
        </div>
      {/if}
    </section>
  {/if}

  {#if viewMode === 'conflicts' && scheduleResult}
    <section class="conflicts-section">
      <h2>⚠️ ข้อขัดแย้งในตารางสอบ</h2>

      {#if scheduleResult.conflicts.length === 0}
        <div class="no-conflicts">
          ✅ ไม่พบข้อขัดแย้งในตารางสอบ
        </div>
      {:else}
        <p class="conflict-info">
          พบ {scheduleResult.conflicts.length} ข้อขัดแย้ง - กรุณาแก้ไขด้วยตนเอง
        </p>

        <div class="conflicts-list">
          {#each scheduleResult.conflicts as conflict}
            <div class="conflict-card">
              <div class="conflict-header">
                <span class="slot">{conflict.slot.date} {conflict.slot.timeDisplay}</span>
                <span class="type">{conflict.examType === 'midterm' ? 'กลางภาค' : 'ปลายภาค'}</span>
              </div>
              <div class="conflict-body">
                <strong>กลุ่มนักศึกษา: {conflict.studentGroup}</strong>
                <p>ต้องสอบพร้อมกัน:</p>
                <ul>
                  {#each conflict.subjects as subject}
                    <li>{subject.code} - {subject.name}</li>
                  {/each}
                </ul>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</main>

<style>
  :global(body) {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: #f5f5f5;
    margin: 0;
    padding: 0;
  }

  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    text-align: center;
    color: #333;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    text-align: center;
    color: #666;
    margin-bottom: 2rem;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 2rem;
    border-bottom: 2px solid #ddd;
    padding-bottom: 0.5rem;
  }

  .tabs button {
    padding: 0.75rem 1.5rem;
    border: none;
    background: #e0e0e0;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
  }

  .tabs button:hover:not(:disabled) {
    background: #d0d0d0;
  }

  .tabs button.active {
    background: #4CAF50;
    color: white;
  }

  .tabs button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .file-card {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    border: 2px solid transparent;
    transition: all 0.2s;
  }

  .file-card.loaded {
    border-color: #4CAF50;
  }

  .file-card h3 {
    margin: 0 0 0.5rem 0;
    color: #333;
  }

  .file-card p {
    color: #666;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .file-card input[type="file"] {
    width: 100%;
    padding: 0.5rem;
    border: 2px dashed #ccc;
    border-radius: 8px;
    cursor: pointer;
  }

  .status {
    display: block;
    margin-top: 0.5rem;
    color: #4CAF50;
    font-weight: 500;
  }

  .rules-summary {
    font-size: 0.85rem;
    color: #666;
    margin-top: 0.5rem;
    padding-left: 1.2rem;
  }

  .date-settings {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    margin-bottom: 2rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
  }

  .date-group h3 {
    margin: 0 0 1rem 0;
    color: #333;
  }

  .date-group label {
    display: block;
    margin-bottom: 0.5rem;
    color: #555;
  }

  .date-group input[type="date"] {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 1rem;
  }

  .generate-btn {
    display: block;
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
    padding: 1rem 2rem;
    font-size: 1.2rem;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .generate-btn:hover:not(:disabled) {
    background: #45a049;
    transform: translateY(-2px);
  }

  .generate-btn:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .hint {
    text-align: center;
    color: #666;
    margin-top: 1rem;
  }

  .error-message {
    background: #ffebee;
    color: #c62828;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    text-align: center;
  }

  .schedule-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .schedule-header h2 {
    margin: 0;
  }

  .actions button {
    padding: 0.75rem 1.5rem;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
  }

  .actions button:hover {
    background: #1976D2;
  }

  .summary {
    display: flex;
    gap: 2rem;
    background: white;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .summary span {
    font-weight: 500;
  }

  .schedule-table {
    background: white;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid #eee;
  }

  th {
    background: #f5f5f5;
    font-weight: 600;
    color: #333;
  }

  tr:hover {
    background: #f9f9f9;
  }

  .unscheduled {
    margin-top: 2rem;
    background: #fff3e0;
    border-radius: 12px;
    padding: 1.5rem;
  }

  .unscheduled h3 {
    margin: 0 0 1rem 0;
    color: #e65100;
  }

  .no-conflicts {
    background: #e8f5e9;
    color: #2e7d32;
    padding: 2rem;
    border-radius: 12px;
    text-align: center;
    font-size: 1.2rem;
  }

  .conflict-info {
    background: #fff3e0;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }

  .conflicts-list {
    display: grid;
    gap: 1rem;
  }

  .conflict-card {
    background: white;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    border-left: 4px solid #ff9800;
  }

  .conflict-header {
    background: #fff3e0;
    padding: 0.75rem 1rem;
    display: flex;
    justify-content: space-between;
  }

  .conflict-header .slot {
    font-weight: 600;
  }

  .conflict-header .type {
    color: #e65100;
  }

  .conflict-body {
    padding: 1rem;
  }

  .conflict-body strong {
    color: #c62828;
  }

  .conflict-body ul {
    margin: 0.5rem 0 0 0;
    padding-left: 1.5rem;
  }

  /* Exam type tabs */
  .exam-type-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .exam-type-tabs button {
    padding: 0.5rem 1rem;
    border: 2px solid #ddd;
    background: white;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .exam-type-tabs button:hover {
    border-color: #4CAF50;
  }

  .exam-type-tabs button.active {
    background: #4CAF50;
    color: white;
    border-color: #4CAF50;
  }

  /* Calendar styles */
  .calendar-section {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
    margin-top: 1rem;
  }

  .calendar-header {
    background: #f5f5f5;
    padding: 0.75rem;
    text-align: center;
    font-weight: 600;
    border-radius: 8px;
  }

  .calendar-day {
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 0.5rem;
    min-height: 120px;
    background: white;
  }

  .calendar-day.empty {
    background: #fafafa;
    border: none;
  }

  .calendar-day.weekend {
    background: #f9f9f9;
  }

  .day-number {
    font-weight: bold;
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
    color: #333;
  }

  .time-slot {
    margin-bottom: 0.5rem;
  }

  .time-slot.morning {
    border-left: 3px solid #FF9800;
    padding-left: 0.5rem;
  }

  .time-slot.afternoon {
    border-left: 3px solid #4CAF50;
    padding-left: 0.5rem;
  }

  .slot-label {
    font-size: 0.7rem;
    color: #666;
    display: block;
    margin-bottom: 0.25rem;
  }

  .exam-chip {
    background: #e3f2fd;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-size: 0.75rem;
    margin: 2px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .exam-more {
    font-size: 0.7rem;
    color: #666;
    font-style: italic;
  }

  .calendar-legend {
    display: flex;
    gap: 2rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #eee;
  }

  .legend-color {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    margin-right: 0.5rem;
    vertical-align: middle;
  }

  .legend-color.morning {
    background: #FF9800;
  }

  .legend-color.afternoon {
    background: #4CAF50;
  }

  /* Student group styles */
  .student-group-section {
    background: white;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .group-selector {
    margin-bottom: 1.5rem;
  }

  .group-selector label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #333;
  }

  .group-selector select {
    width: 100%;
    max-width: 400px;
    padding: 0.75rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    font-size: 1rem;
    background: white;
    cursor: pointer;
  }

  .group-selector select:focus {
    border-color: #4CAF50;
    outline: none;
  }

  .group-schedule {
    margin-top: 1rem;
  }

  .group-schedule h3 {
    margin: 0 0 1rem 0;
    color: #333;
  }

  .exam-section {
    margin-bottom: 2rem;
  }

  .exam-section h4 {
    margin: 0 0 0.75rem 0;
    padding: 0.5rem 1rem;
    background: #f5f5f5;
    border-radius: 8px;
    color: #333;
  }

  .exam-section table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 8px;
    overflow: hidden;
  }

  .no-exams {
    color: #666;
    font-style: italic;
    padding: 1rem;
    background: #f9f9f9;
    border-radius: 8px;
    text-align: center;
  }

  .select-prompt {
    text-align: center;
    padding: 3rem;
    color: #666;
  }

  .select-prompt p {
    font-size: 1.1rem;
  }

  /* Clickable time slot button */
  .time-slot.clickable {
    cursor: pointer;
    border: none;
    background: transparent;
    text-align: left;
    width: 100%;
    padding: 0.25rem;
    padding-left: 0.5rem;
    font-family: inherit;
    transition: background 0.2s;
  }

  .time-slot.clickable:hover {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .modal {
    background: white;
    border-radius: 12px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #eee;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #333;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #666;
    padding: 0;
    line-height: 1;
  }

  .modal-close:hover {
    color: #333;
  }

  .modal-body {
    padding: 1rem 1.5rem;
  }

  .exam-detail-card {
    padding: 0.75rem;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    margin-bottom: 0.5rem;
  }

  .exam-detail-card:last-child {
    margin-bottom: 0;
  }

  .exam-detail-code {
    font-weight: bold;
    color: #1976D2;
  }

  .exam-detail-name {
    margin-top: 0.25rem;
    color: #333;
  }

  .exam-detail-groups {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: #666;
  }

  /* Search box styles */
  .search-box {
    position: relative;
    margin-bottom: 1rem;
  }

  .search-box input {
    width: 100%;
    padding: 0.75rem 1rem;
    padding-right: 2.5rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    font-size: 1rem;
    transition: border-color 0.2s;
  }

  .search-box input:focus {
    border-color: #4CAF50;
    outline: none;
  }

  .search-box .clear-search {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 1.2rem;
    padding: 0.25rem;
  }

  .search-box .clear-search:hover {
    color: #333;
  }

  .edit-hint {
    font-size: 0.9rem;
    color: #666;
    margin-bottom: 0.5rem;
    font-style: italic;
  }

  /* Clickable table row */
  .clickable-row {
    cursor: pointer;
    transition: background 0.2s;
  }

  .clickable-row:hover {
    background: #e3f2fd !important;
  }

  /* Edit modal styles */
  .edit-modal {
    max-width: 500px;
  }

  .edit-exam-info {
    background: #f5f5f5;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
  }

  .edit-label {
    font-size: 0.85rem;
    color: #666;
    margin-bottom: 0.25rem;
  }

  .edit-value {
    margin-bottom: 0.75rem;
    font-size: 1rem;
  }

  .edit-value:last-child {
    margin-bottom: 0;
  }

  .current-slot {
    font-weight: 500;
    color: #1976D2;
    background: #e3f2fd;
    padding: 0.5rem;
    border-radius: 4px;
    display: inline-block;
  }

  .edit-form {
    margin-bottom: 1.5rem;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label,
  .form-label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: #333;
  }

  .form-group select {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    font-size: 1rem;
    background: white;
    cursor: pointer;
  }

  .form-group select:focus {
    border-color: #4CAF50;
    outline: none;
  }

  .time-options {
    display: flex;
    gap: 0.5rem;
  }

  .time-option {
    flex: 1;
    padding: 0.75rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    background: white;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .time-option:hover {
    border-color: #4CAF50;
  }

  .time-option.active {
    background: #4CAF50;
    color: white;
    border-color: #4CAF50;
  }

  .edit-warning {
    background: #fff3e0;
    color: #e65100;
    padding: 0.75rem;
    border-radius: 8px;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .edit-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .btn-cancel,
  .btn-save {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
  }

  .btn-cancel {
    background: #e0e0e0;
    color: #333;
  }

  .btn-cancel:hover {
    background: #d0d0d0;
  }

  .btn-save {
    background: #4CAF50;
    color: white;
  }

  .btn-save:hover {
    background: #45a049;
  }

  /* Global actions bar */
  .global-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
    padding: 1rem;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .action-group {
    display: flex;
    gap: 0.5rem;
  }

  .save-load-group {
    flex: 0 0 auto;
  }

  .action-btn {
    padding: 0.6rem 1rem;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-btn {
    background: #2196F3;
    color: white;
  }

  .save-btn:hover:not(:disabled) {
    background: #1976D2;
  }

  .load-btn {
    background: #9C27B0;
    color: white;
  }

  .load-btn:hover:not(:disabled) {
    background: #7B1FA2;
  }

  .export-all-btn {
    background: linear-gradient(135deg, #4CAF50, #45a049);
    color: white;
    padding: 0.7rem 1.2rem;
    font-size: 1rem;
  }

  .export-all-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #45a049, #3d8b40);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.4);
  }

  .import-btn {
    background: linear-gradient(135deg, #FF9800, #F57C00);
    color: white;
    padding: 0.7rem 1.2rem;
    font-size: 1rem;
  }

  .import-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #F57C00, #E65100);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.4);
  }

  .export-import-group {
    margin-left: auto;
  }

  .save-message {
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    animation: fadeIn 0.3s ease;
  }

  .save-message.success {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .save-message.error {
    background: #ffebee;
    color: #c62828;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Responsive adjustments */
  @media (max-width: 600px) {
    .global-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .action-group {
      width: 100%;
    }

    .save-load-group {
      justify-content: center;
    }

    .export-import-group {
      margin-left: 0;
      justify-content: center;
    }

    .export-all-btn,
    .import-btn {
      flex: 1;
    }
  }
</style>
