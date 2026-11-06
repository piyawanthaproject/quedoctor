// Body diagram regions (2D, front and back, female and male outlines).
// Region ids are stored in symptom_reports.body_part.

export type View = 'front' | 'back';
export type Shape =
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; r: number };

export interface Region { id: string; th: string; en: string; shapes: Shape[] }

const E = (cx: number, cy: number, rx: number, ry: number): Shape => ({ t: 'ellipse', cx, cy, rx, ry });
const R = (x: number, y: number, w: number, h: number, r: number): Shape => ({ t: 'rect', x, y, w, h, r });

export function regions(gender: 'F' | 'M', view: View): Region[] {
  const f = gender === 'F', back = view === 'back';
  const torsoX = f ? 64 : 58, torsoW = f ? 72 : 84;
  const hipX = f ? 56 : 62, hipW = f ? 88 : 76;
  const armX = f ? [42, 138] : [34, 144], armW = f ? 20 : 22;
  // In the front view the viewer's left is the patient's right.
  const sides: [string, number, string, string][] = back
    ? [['a', 0, 'ซ้าย', 'left'], ['b', 1, 'ขวา', 'right']]
    : [['a', 0, 'ขวา', 'right'], ['b', 1, 'ซ้าย', 'left']];
  const p = back ? 'b_' : '';

  const list: Region[] = [
    { id: `${p}head`, th: back ? 'ศีรษะด้านหลัง' : 'ศีรษะ', en: back ? 'Back of head' : 'Head', shapes: [E(100, 42, 26, 30)] },
  ];
  if (!back) list.push({ id: 'eyes', th: 'ตา', en: 'Eyes', shapes: [E(90, 40, 6.5, 4), E(110, 40, 6.5, 4)] });
  list.push(
    { id: back ? 'b_neck' : 'neck', th: back ? 'ต้นคอ' : 'คอ / ลำคอ', en: back ? 'Back of neck' : 'Neck / throat', shapes: [R(88, 70, 24, 18, 5)] },
    { id: back ? 'upper_back' : 'chest', th: back ? 'หลังส่วนบน' : 'หน้าอก', en: back ? 'Upper back' : 'Chest', shapes: [R(torsoX, 88, torsoW, 62, 14)] },
    { id: back ? 'lower_back' : 'abdomen', th: back ? 'หลังส่วนล่าง / เอว' : 'ท้อง', en: back ? 'Lower back' : 'Abdomen', shapes: [R(f ? 66 : 64, 152, f ? 68 : 72, 52, 10)] },
    { id: back ? 'buttocks' : 'pelvis', th: back ? 'สะโพก / ก้น' : 'ท้องน้อย / เชิงกราน', en: back ? 'Buttocks' : 'Lower abdomen / pelvis', shapes: [R(hipX, 206, hipW, 36, 12)] },
  );
  for (const [k, i, sth, sen] of sides) {
    const ax = armX[i];
    list.push(
      { id: `${p}arm_${k}`, th: `แขน${sth}`, en: `${cap(sen)} arm`, shapes: [R(ax, 92, armW, 90, 10)] },
      { id: `${p}hand_${k}`, th: `มือ${sth}`, en: `${cap(sen)} hand`, shapes: [E(ax + armW / 2, 198, 11, 14)] },
      { id: `${p}thigh_${k}`, th: `ต้นขา${sth}`, en: `${cap(sen)} thigh`, shapes: [R(i ? 102 : 66, 244, 32, 70, 14)] },
      { id: `${p}knee_${k}`, th: back ? `ข้อพับเข่า${sth}` : `เข่า${sth}`, en: back ? `Back of ${sen} knee` : `${cap(sen)} knee`, shapes: [E(i ? 118 : 82, 326, 15, 11)] },
      { id: `${p}leg_${k}`, th: back ? `น่อง${sth}` : `หน้าแข้ง${sth}`, en: back ? `${cap(sen)} calf` : `${cap(sen)} shin`, shapes: [R(i ? 105 : 69, 339, 26, 54, 12)] },
      { id: `${p}foot_${k}`, th: back ? `ส้นเท้า${sth}` : `เท้า${sth}`, en: back ? `${cap(sen)} heel` : `${cap(sen)} foot`, shapes: [E(i ? 118 : 82, 403, 16, 8)] },
    );
  }
  return list;
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

const ALL = new Map<string, Region>();
(['F', 'M'] as const).forEach((g) => (['front', 'back'] as const).forEach((v) => regions(g, v).forEach((r) => ALL.set(r.id, r))));

export function regionName(id: string, lang: 'th' | 'en') {
  const r = ALL.get(id);
  return r ? r[lang] : id;
}

export function viewFor(parts: string[]): View {
  return parts.some((p) => /^(b_|upper_back|lower_back|buttocks)/.test(p)) ? 'back' : 'front';
}
