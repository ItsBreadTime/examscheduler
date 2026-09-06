export type ExamType = 'midterm' | 'final';
export type SourceRole = 'managed' | 'context';
export interface TimeInterval { startMinutes: number; endMinutes: number }
export interface ExamTiming extends TimeInterval { date: string }
export interface AcademicTerm { academicYearBE: number; semester: number; campus?: string }
export interface SourceReference { artifactId: string; sheet?: string; row?: number; column?: number; field?: string }
export interface SourceArtifact {
  id: string; originalName: string; mediaType: string; byteLength: number; sha256: string;
  importedAt: string; kind: 'course' | 'rules' | 'rooms' | 'proctors'; term?: AcademicTerm;
}
export interface Section {
  id: string; courseCode: string; courseName: string; sectionNumber: number;
  studentGroups: string[]; rawStudentGroups: string; faculty?: string; department?: string;
  plannedEnrollment?: number; registeredEnrollment?: number;
  teachingDay?: string; teachingTime?: string; teachingRoom?: string; instructors: string[];
  sourceRole: SourceRole; sourceRef: SourceReference;
  exams: Partial<Record<ExamType, ExamTiming>>;
  invalidExams: ExamType[];
}
export interface CourseExamRule {
  courseCodes: string[]; examType?: ExamType;
  action: 'exclude_from_central_schedule' | 'no_exam' | 'full_day' | 'same_time';
  sourceRef: SourceReference;
}
export interface ExamEvent {
  id: string; courseCode: string; examType: ExamType; sectionIds: string[]; studentGroups: string[];
  ownership: SourceRole; timing?: ExamTiming; timingOrigin: 'imported' | 'generated' | 'manual';
  roomAssignments: string[]; proctorAssignments: string[]; sourceRefs: SourceReference[];
  required: boolean; fullDay: boolean; blocked: boolean;
}
export interface ValidationIssue {
  id: string; type: string; severity: 'error' | 'warning' | 'info'; blocking: boolean;
  origin: 'source' | 'generated' | 'manual' | 'resource'; message: string;
  eventIds: string[]; courseCodes: string[]; studentGroups: string[]; sourceRefs: SourceReference[];
  blockedCandidates?: { proctorId: string; reasons: string[]; eventIds: string[]; sourceRefs: SourceReference[] }[];
}
export interface RoomResource {
  id: string; name: string; zones: string[]; proctorsRequired?: number; tags: string[];
  capacity?: number; unavailableDates: string[]; sourceRef: SourceReference;
}
export interface AvailabilityConstraint {
  available: false; dayOfWeek?: number; date?: string; interval?: TimeInterval;
  sourceRef?: SourceReference;
}
export interface Proctor {
  id: string; displayName: string; role?: string; gender?: string; tags: string[];
  notes: string[]; availability: AvailabilityConstraint[]; sourceRef: SourceReference;
  sourceRefs?: SourceReference[];
  assignmentEligibility?: { eligible: boolean; reason?: string; sourceTerm?: AcademicTerm };
}
export interface SchedulerSettings {
  periods: Record<ExamType, { start: string; end: string }>;
  sessions: TimeInterval[]; fullDay: TimeInterval;
  weekendPolicy: 'never' | 'only_if_necessary' | 'normal';
  holidays: string[]; holidayPolicy: 'never' | 'only_if_necessary' | 'normal'; searchBudget: number;
  /** Plan §35: the computer-proctor capability rule stays opt-in until its meaning is confirmed. */
  computerProctorRule?: boolean;
}
export interface Project {
  schemaVersion: 1; artifacts: SourceArtifact[]; sections: Section[]; rules: CourseExamRule[];
  importIssues: ValidationIssue[]; settings: SchedulerSettings; events: ExamEvent[];
  locks: Record<string, ExamTiming>; rooms: RoomResource[]; proctors: Proctor[];
}
export interface SameTimeGroup { examType: ExamType; courseCodes: string[]; sourceRefs: SourceReference[] }
export interface UnscheduledReason {
  eventIds: string[]; reason: 'NO_CANDIDATES' | 'STUDENT_CONFLICTS' | 'FIXED_CONSTRAINTS' | 'SAME_TIME_CONTRADICTION' | 'SEARCH_BUDGET_EXHAUSTED' | 'SOURCE_DATA_INVALID';
  blockedCandidateCount: number;
}
export interface ValidationReport {
  overallStatus: 'valid' | 'valid_with_warnings' | 'invalid'; issues: ValidationIssue[];
  coverage: Record<string, 'passed' | 'failed' | 'not_checked'>;
}
