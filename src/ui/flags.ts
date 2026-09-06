/**
 * UI feature switches. The resource-assignment core (room/proctor import, allocation,
 * validation) stays intact behind these flags; setting them false hides every resource
 * surface from the interface and keeps the visible issue list, coverage and status
 * consistent. Flip SHOW_PROCTORS and/or SHOW_ROOMS to true to restore a surface.
 */
export const SHOW_PROCTORS = false;
export const SHOW_ROOMS = false;
export const SHOW_RESOURCES = SHOW_PROCTORS || SHOW_ROOMS;

const PROCTOR_COVERAGE = new Set(['proctorAvailability', 'proctorDoubleBooking', 'proctorStaffing']);
const ROOM_COVERAGE = new Set(['roomCapacity', 'roomDoubleBooking']);
const RESOURCE_COVERAGE = new Set(['resourceIntegrity']);

const COVERAGE_GENERIC = new Set(['RESOURCE_TIMING_INVALID', 'RESOURCE_SCHEDULING_NOT_IMPLEMENTED', 'INVALID_RESOURCE_ID']);

const visibleCoverageKey = (key: string) =>
  !(PROCTOR_COVERAGE.has(key) && !SHOW_PROCTORS)
  && !(ROOM_COVERAGE.has(key) && !SHOW_ROOMS)
  && !(RESOURCE_COVERAGE.has(key) && !SHOW_RESOURCES);

export const visibleIssueType = (type: string) =>
  (SHOW_PROCTORS || !type.includes('PROCTOR'))
  && (SHOW_ROOMS || !type.includes('ROOM'))
  && (SHOW_RESOURCES || !COVERAGE_GENERIC.has(type));

export const visibleIssues = <T extends { type: string }>(issues: T[]): T[] =>
  issues.filter(issue => visibleIssueType(issue.type));

export const visibleCoverageEntries = (coverage: Record<string, string>): [string, string][] =>
  Object.entries(coverage).filter(([key]) => visibleCoverageKey(key));

/** The report the interface shows: resource findings and coverage removed, status recomputed from what remains. */
export const visibleValidation = <T extends { overallStatus: 'valid' | 'valid_with_warnings' | 'invalid'; issues: { type: string; severity: string }[]; coverage: Record<string, string> }>(report: T): T => {
  if (SHOW_RESOURCES) return report;
  const issues = visibleIssues(report.issues);
  return {
    ...report,
    issues,
    coverage: Object.fromEntries(visibleCoverageEntries(report.coverage)) as T['coverage'],
    overallStatus: issues.some(issue => issue.severity === 'error') ? 'invalid' : issues.length ? 'valid_with_warnings' : 'valid',
  };
};
