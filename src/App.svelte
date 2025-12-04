<script lang="ts">
  import { parseSubjectCSV, parseRulesCSV, mergeSubjects } from './lib/parser';
  import { scheduleExams, exportScheduleToCSV } from './lib/scheduler';
  import type { Subject, Rules, ScheduleResult, ExamPeriod, ScheduledExam, ScheduleConflict } from './lib/types';
  import { parseThaiDate, formatThaiDate } from './lib/types';

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

      <div class="summary">
        <span>จัดได้: {currentExams.length} รายวิชา</span>
        <span>จัดไม่ได้: {scheduleResult.unscheduled.filter(s => 
          examTypeView === 'midterm' ? !s.midtermDate : !s.finalDate
        ).length} รายวิชา</span>
      </div>

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
            {#each currentExams.sort((a, b) => {
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
</style>
