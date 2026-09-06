import {readFileSync,writeFileSync} from 'node:fs';
const b=JSON.parse(readFileSync('docs/data/benchmarks.json','utf8'));
const lines=[String.raw`\begin{center}\begin{tabular}{p{3cm}p{9cm}}\toprule Environment B1 & ค่าที่บันทึก \\\midrule`,
`${b.environment.cpu} & RAM ${b.environment.ramBytes/2**30} GB, macOS ${b.environment.macOS}, ${b.environment.architecture} \\\\`,
`Node & ${b.environment.node}, TZ ${b.environment.timezone} \\\\`,
String.raw`พลังงาน & AC Power, แบตเตอรี่ 100\%, low power mode ปิด \\`,
String.raw`งานร่วม & ไม่มีงานอื่นที่ผู้ทดลองตั้งใจให้แข่งขันทรัพยากรระหว่างวัด \\\bottomrule\end{tabular}\end{center}`,
String.raw`\begin{center}\begin{tabular}{llrrr}\toprule ชุด & วิธี & มัธยฐาน & ต่ำสุด & สูงสุด \\\midrule`,
...b.summary.map((s:any)=>`${s.scale} & ${s.family} & ${s.median.toFixed(2)} & ${s.min.toFixed(2)} & ${s.max.toFixed(2)} \\\\`),
String.raw`\bottomrule\end{tabular}\end{center}`];
writeFileSync('docs/benchmark-summary.tex',lines.join('\n')+'\n');
