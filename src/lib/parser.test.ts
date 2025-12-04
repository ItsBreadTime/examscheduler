import { describe, it, expect } from 'vitest';
import { parseSubjectCSV, parseRulesCSV, getAllStudentGroups, groupSubjectsByCode } from './parser';

// Sample CSV data mimicking the university format
const sample040CSV = `,,มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ,,,,,,,,,,,รายงานระเบียนขบวนวิชา,,,,,,,,
,,ระบบตารางสอนตารางสอบ,,,,,,,,,,,มจพ. วิทยาเขตปราจีนบุรี ภาคการศึกษาที่ 2/2567,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,
คณะวิทยาศาสตร์ประยุกต์,,,,,,,,,,,,,ภาควิชาคณิตศาสตร์,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,
  รหัสวิชา,,,ชื่อวิชา,หน่วยกิต,,,,ตอน,"จำนวน นศ.",,วัน,เวลาเรียน,สถานที่,อาจารย์ผู้สอน,กลุ่มนักศึกษา,สอบกลางภาค,,สอบปลายภาค,,,
,,,,รวม,ท.,ป.,ศ.,,เปิด,ลง,,,,,,วัน,เวลา,วัน,เวลา,,
040203111,,,Engineering Mathematics I,3,3,0,6,4,120,100,F,13:00-16:00,1-B4-20-B,อ.ดร.เอกภัค เจริญเลิศมงคล,"AFE-R-DE-RA
AFET-1R-RA",20/01/68,09:00-12:00,21/03/68,09:00-12:00,,
040203112,,,Engineering Mathematics II,3,3,0,6,21,40,27,TH,09:00-12:00,ENG-วิศวฯ:303,อ.ดร.เอกภัค เจริญเลิศมงคล,InAE-1R-DE-RA,20/01/68,09:00-12:00,21/03/68,09:00-12:00,,`;

const sample060CSV = `,,มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ,,,,,,,,,,,รายงานระเบียนขบวนวิชา,,,,,,,,
,,ระบบตารางสอนตารางสอบ,,,,,,,,,,,มจพ. วิทยาเขตปราจีนบุรี ภาคการศึกษาที่ 2/2567,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,
คณะเทคโนโลยีและการจัดการอุตสาหกรรม,,,,,,,,,,,,,ภาควิชาการจัดการอุตสาหกรรม,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,
  รหัสวิชา,,,ชื่อวิชา,หน่วยกิต,,,,ตอน,"จำนวน นศ.",,วัน,เวลาเรียน,สถานที่,อาจารย์ผู้สอน,กลุ่มนักศึกษา,สอบกลางภาค,,สอบปลายภาค,,,
,,,,รวม,ท.,ป.,ศ.,,เปิด,ลง,,,,,,วัน,เวลา,วัน,เวลา,,
060123402,,,Manufacturing Processes,3,3,0,6,1,50,31,M,09:00-12:00,1-B3-07,ผศ.ดร.ณรงค์ฤทธิ์   สนใจธรรม,IMT-1R-RA,,,,,,
060123405,,,Production Planning and Control,3,3,0,6,1,50,33,TU,09:00-12:00,1-B2-22,ผศ.ดร.พิเชฐ พุ่มเกษร,IMT-1R-RA,,,,,,
060133403,,,Manufacturing Processes,3,3,0,6,1,55,40,TU,13:00-16:00,1-B2-04,ผศ.ดร.ณรงค์ฤทธิ์   สนใจธรรม,"IEM-1R-DE-RA
IEM-2R-DE-RA",,,,,,`;

const sampleRulesCSV = `ไม่มีสอบกลางภาค/สอบนอกตาราง,ไม่มีสอบปลายภาค,ไม่มีสอบ,วิชาเดียวแต่สอบสองช่วง,ให้มีวัน เวลา สอบ ตรงกัน,,,
060123432,060436006,060113405,060243104,060133403,060123402,,
060133424,060436012,060133421,,060133419,060123428,,
060436010,060436018,060133427,,,,`;

describe('parseSubjectCSV', () => {
  it('should parse fixed schedule subjects (040)', () => {
    const subjects = parseSubjectCSV(sample040CSV, 'fixed');
    
    expect(subjects.length).toBeGreaterThan(0);
    
    // Check first subject
    const mathI = subjects.find(s => s.code === '040203111');
    expect(mathI).toBeDefined();
    expect(mathI!.name).toBe('Engineering Mathematics I');
    expect(mathI!.section).toBe(4);
    expect(mathI!.studentGroups).toContain('AFE-R-DE-RA');
    expect(mathI!.studentGroups).toContain('AFET-1R-RA');
    expect(mathI!.midtermDate).toBe('20/01/68');
    expect(mathI!.midtermTime).toBe('09:00-12:00');
    expect(mathI!.finalDate).toBe('21/03/68');
    expect(mathI!.source).toBe('fixed');
  });

  it('should parse schedulable subjects (060)', () => {
    const subjects = parseSubjectCSV(sample060CSV, 'schedulable');
    
    expect(subjects.length).toBeGreaterThan(0);
    
    // Check subject without existing schedule
    const mfg = subjects.find(s => s.code === '060123402');
    expect(mfg).toBeDefined();
    expect(mfg!.midtermDate).toBeUndefined();
    expect(mfg!.finalDate).toBeUndefined();
    expect(mfg!.source).toBe('schedulable');
  });

  it('should parse multiple student groups from multiline cells', () => {
    const subjects = parseSubjectCSV(sample060CSV, 'schedulable');
    
    const mfg2 = subjects.find(s => s.code === '060133403');
    expect(mfg2).toBeDefined();
    expect(mfg2!.studentGroups.length).toBe(2);
    expect(mfg2!.studentGroups).toContain('IEM-1R-DE-RA');
    expect(mfg2!.studentGroups).toContain('IEM-2R-DE-RA');
  });

  it('should return empty array for empty CSV', () => {
    expect(parseSubjectCSV('', 'fixed')).toEqual([]);
  });
});

describe('parseRulesCSV', () => {
  it('should parse no midterm rules', () => {
    const rules = parseRulesCSV(sampleRulesCSV);
    
    expect(rules.noMidterm).toContain('060123432');
    expect(rules.noMidterm).toContain('060133424');
    expect(rules.noMidterm).toContain('060436010');
  });

  it('should parse no final rules', () => {
    const rules = parseRulesCSV(sampleRulesCSV);
    
    expect(rules.noFinal).toContain('060436006');
    expect(rules.noFinal).toContain('060436012');
    expect(rules.noFinal).toContain('060436018');
  });

  it('should parse no exam rules', () => {
    const rules = parseRulesCSV(sampleRulesCSV);
    
    expect(rules.noExam).toContain('060113405');
    expect(rules.noExam).toContain('060133421');
    expect(rules.noExam).toContain('060133427');
  });

  it('should parse full day exam rules', () => {
    const rules = parseRulesCSV(sampleRulesCSV);
    
    expect(rules.fullDayExam).toContain('060243104');
  });

  it('should parse same time groups', () => {
    const rules = parseRulesCSV(sampleRulesCSV);
    
    expect(rules.sameTimeGroups.length).toBeGreaterThan(0);
    
    // Each row in columns 4+ forms a same-time group
    // Row 1: 060133403, 060123402 should be at same time
    const group1 = rules.sameTimeGroups.find(g => 
      g.includes('060133403') && g.includes('060123402')
    );
    expect(group1).toBeDefined();
    
    // Row 2: 060133419, 060123428 should be at same time
    const group2 = rules.sameTimeGroups.find(g => 
      g.includes('060133419') && g.includes('060123428')
    );
    expect(group2).toBeDefined();
  });

  it('should return empty rules for empty CSV', () => {
    const rules = parseRulesCSV('');
    
    expect(rules.noMidterm).toEqual([]);
    expect(rules.noFinal).toEqual([]);
    expect(rules.noExam).toEqual([]);
    expect(rules.fullDayExam).toEqual([]);
    expect(rules.sameTimeGroups).toEqual([]);
  });
});

describe('getAllStudentGroups', () => {
  it('should extract all unique student groups', () => {
    const subjects = parseSubjectCSV(sample060CSV, 'schedulable');
    const groups = getAllStudentGroups(subjects);
    
    expect(groups.has('IMT-1R-RA')).toBe(true);
    expect(groups.has('IEM-1R-DE-RA')).toBe(true);
    expect(groups.has('IEM-2R-DE-RA')).toBe(true);
  });

  it('should not have duplicates', () => {
    const subjects = parseSubjectCSV(sample060CSV, 'schedulable');
    const groups = getAllStudentGroups(subjects);
    
    // Set naturally removes duplicates
    expect(groups instanceof Set).toBe(true);
  });
});

describe('groupSubjectsByCode', () => {
  it('should group subjects by code', () => {
    const subjects = parseSubjectCSV(sample060CSV, 'schedulable');
    const grouped = groupSubjectsByCode(subjects);
    
    expect(grouped.has('060123402')).toBe(true);
    expect(grouped.has('060123405')).toBe(true);
    expect(grouped.has('060133403')).toBe(true);
  });

  it('should group multiple sections together', () => {
    // This would need a CSV with multiple sections
    const csvWithSections = `,,มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ,,,,,,,,,,,รายงานระเบียนขบวนวิชา,,,,,,,,
  รหัสวิชา,,,ชื่อวิชา,หน่วยกิต,,,,ตอน,"จำนวน นศ.",,วัน,เวลาเรียน,สถานที่,อาจารย์ผู้สอน,กลุ่มนักศึกษา,สอบกลางภาค,,สอบปลายภาค,,,
060123402,,,Manufacturing Processes,3,3,0,6,1,50,31,M,09:00-12:00,1-B3-07,Teacher,Group-A,,,,,,
,,,,,,,,2,50,31,M,09:00-12:00,1-B3-07,Teacher,Group-B,,,,,,`;
    
    const subjects = parseSubjectCSV(csvWithSections, 'schedulable');
    const grouped = groupSubjectsByCode(subjects);
    
    const sections = grouped.get('060123402');
    expect(sections).toBeDefined();
    expect(sections!.length).toBe(2);
    expect(sections!.some(s => s.section === 1)).toBe(true);
    expect(sections!.some(s => s.section === 2)).toBe(true);
  });
});
