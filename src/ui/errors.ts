import { t } from './i18n.svelte.ts';

export interface LocalizedText { en: string; th: string }
export const localized = (en: string, th: string): LocalizedText => ({ en, th });
export const localizedText = (value: LocalizedText | null | undefined) => value ? t(value.en, value.th) : '';

/** Turns an unknown exception into a localized, honest message; the raw error is logged for diagnosis. */
export function friendlyError(error: unknown): LocalizedText {
  console.error(error);
  const detail = (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, '');
  if (detail === 'Sessions must be valid time intervals') return localized('Sessions must be valid time intervals.', 'ช่วงเวลาสอบต้องเป็นช่วงเวลาที่ถูกต้อง');
  if (detail === 'Invalid exam period') return localized('The exam period is invalid.', 'ช่วงสอบไม่ถูกต้อง');
  if (detail === 'Exam periods must be at most 366 days') return localized('Exam periods must be no longer than 366 days.', 'ช่วงสอบต้องยาวไม่เกิน 366 วัน');
  if (detail === 'Invalid weekend policy') return localized('The weekend policy is invalid.', 'นโยบายวันหยุดสุดสัปดาห์ไม่ถูกต้อง');
  if (detail === 'Invalid holiday policy or holiday dates') return localized('The holiday policy or holiday dates are invalid.', 'นโยบายวันหยุดหรือวันที่วันหยุดไม่ถูกต้อง');
  if (detail === 'Search budget must be an integer from 1 to 1000000') return localized('Solver effort must be a whole number from 1 to 1,000,000.', 'ระดับความพยายามต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000');
  if (detail === 'Spreadsheet is empty') return localized('The spreadsheet is empty.', 'ไฟล์สเปรดชีตว่างเปล่า');
  if (detail === 'Spreadsheet exceeds 25 MiB import limit') return localized('The spreadsheet exceeds the 25 MiB import limit.', 'ไฟล์สเปรดชีตมีขนาดเกินขีดจำกัดนำเข้า 25 MiB');
  if (detail.startsWith('Unsupported spreadsheet format:')) return localized('This spreadsheet format is not supported.', 'ไม่รองรับรูปแบบไฟล์สเปรดชีตนี้');
  if (detail === 'Course source role must be managed or context') return localized('Choose whether the course source is managed or context.', 'เลือกว่าไฟล์รายวิชานี้จะให้จัดอัตโนมัติ หรือจัดเวลาไว้แล้ว');
  if (detail === 'Choose a valid date and an end time after the start time.') return localized('Choose a valid date and an end time after the start time.', 'เลือกวันที่ถูกต้องและให้เวลาสิ้นสุดอยู่หลังเวลาเริ่ม');
  if (detail === 'The examination no longer exists.') return localized('The examination no longer exists.', 'ไม่พบรายการสอบนี้แล้ว');
  if (detail === 'Imported examinations are fixed. Correct their source file instead.') return localized('Imported examinations are fixed. Correct their source file instead.', 'รายการสอบที่นำเข้ามีเวลาคงที่ กรุณาแก้ไขไฟล์ต้นทางแทน');
  if (detail === 'Resolve missing student groups or contradictory source data before assigning this examination.') return localized('Resolve missing student groups or contradictory source data before assigning this examination.', 'แก้ไขกลุ่มนักศึกษาที่หายไปหรือข้อมูลต้นทางที่ขัดแย้งก่อนกำหนดเวลาสอบนี้');
  if (detail === 'A course in this same-time group has a different fixed imported time.') return localized('A course in this same-time group has a different fixed imported time.', 'วิชาในกลุ่มสอบพร้อมกันนี้มีเวลาจากไฟล์ต้นทางที่แตกต่างกัน');
  if (detail === 'REVISION_CONFLICT') return localized('Another revision was saved first. Reload it before saving again.', 'มีการบันทึกฉบับอื่นก่อนหน้านี้ กรุณาโหลดฉบับนั้นก่อนบันทึกอีกครั้ง');
  if (detail.startsWith('Cannot reach the cloud server')) return localized('Cannot reach the cloud server. Check the server URL and connection.', 'ไม่สามารถติดต่อเซิร์ฟเวอร์คลาวด์ได้ กรุณาตรวจสอบที่อยู่เซิร์ฟเวอร์และการเชื่อมต่อ');
  if (/^\d+\s/.test(detail)) {
    const status = detail.match(/^(\d+)/)?.[1] ?? '';
    return localized(`The cloud server rejected the request (HTTP ${status}).`, `เซิร์ฟเวอร์คลาวด์ปฏิเสธคำขอ (HTTP ${status})`);
  }
  return localized('Something went wrong. See the browser console for technical details.', 'เกิดข้อผิดพลาด กรุณาดูรายละเอียดทางเทคนิคในคอนโซลของเบราว์เซอร์');
}
