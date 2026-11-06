// Demo data for คิวหมอ. Run after applying the migration:  npm run seed
// Creates 4 demo accounts, demo patients, today's queue and 90 days of history for the dashboard.
// Deletes and recreates every patient that has no login account (demo patients) each time it runs.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const must = ({ data, error }, what) => { if (error) { console.error(what, error.message); process.exit(1); } return data; };

const PASSWORD = 'KhiuMor-demo-2026';
const ACCOUNTS = [
  { email: 'patient@khiumor.demo', name: 'สมศรี ใจดี', role: 'patient' },
  { email: 'nurse@khiumor.demo', name: 'พว.สุดา มั่นคง', role: 'nurse' },
  { email: 'doctor@khiumor.demo', name: 'นพ.กิตติ วงศ์ไทย', role: 'doctor' },
  { email: 'admin@khiumor.demo', name: 'วรรณา ศรีสวัสดิ์', role: 'admin' },
];

// deterministic random
let seed = 20261106;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (arr, w) => { let x = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) { x -= w[i]; if (x <= 0) return arr[i]; } return arr.at(-1); };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const bangkokNow = () => new Date(Date.now() + 7 * 3600e3);          // fields read with getUTC*
const isoDate = (d) => d.toISOString().slice(0, 10);

async function ensureUsers() {
  const list = must(await db.auth.admin.listUsers({ perPage: 1000 }), 'listUsers').users;
  const ids = {};
  for (const a of ACCOUNTS) {
    let u = list.find((x) => x.email === a.email);
    if (!u) u = must(await db.auth.admin.createUser({ email: a.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: a.name } }), 'createUser').user;
    must(await db.from('profiles').update({ role: a.role, full_name: a.name }).eq('id', u.id), 'profile');
    ids[a.role] = u.id;
  }
  return ids;
}

const FIRST = ['สมพร', 'บุญมี', 'วิชัย', 'อรุณี', 'ประสิทธิ์', 'สุนทร', 'กาญจนา', 'ธนา', 'ละเอียด', 'มานพ', 'พรทิพย์', 'สมบัติ', 'ณัฐชา', 'จันทร์เพ็ญ', 'ชาญ', 'นิภา', 'ปรีชา', 'รัตนา', 'สมชาย', 'อำไพ'];
const LAST = ['แก้วใส', 'ศรีสุข', 'ทองดี', 'มณีวงศ์', 'ใจงาม', 'พึ่งบุญ', 'ศรีเมือง', 'รุ่งเรือง', 'คำดี', 'สายทอง', 'นาคดี', 'ทองคำ', 'วงศ์ดี', 'บุญมา', 'แสงทอง'];
const DX = {
  med: [['I10', 'ความดันโลหิตสูง'], ['E11', 'เบาหวานชนิดที่ 2'], ['J06.9', 'ทางเดินหายใจส่วนบนติดเชื้อ'], ['K29.7', 'กระเพาะอาหารอักเสบ'], ['E78.5', 'ไขมันในเลือดสูง']],
  ortho: [['M54.5', 'ปวดหลังส่วนล่าง'], ['M17.9', 'ข้อเข่าเสื่อม'], ['M79.1', 'กล้ามเนื้ออักเสบ'], ['S93.4', 'ข้อเท้าแพลง']],
  skin: [['L23.9', 'ผื่นแพ้สัมผัส'], ['B35.4', 'กลากที่ลำตัว'], ['L70.0', 'สิว']],
  ent: [['J32.9', 'ไซนัสอักเสบเรื้อรัง'], ['J02.9', 'คออักเสบ'], ['H60.9', 'หูชั้นนอกอักเสบ']],
  eye: [['H10.9', 'เยื่อบุตาอักเสบ'], ['H26.9', 'ต้อกระจก'], ['H52.7', 'สายตาผิดปกติ']],
};
const PRICE = { med: [350, 1400], ortho: [500, 2600], skin: [300, 1100], ent: [350, 1300], eye: [400, 2200] };
const RATIO = { gold: 1, sso: 1, civil: 1, private: 0.8, self: 0 };

async function main() {
  const ids = await ensureUsers();
  must(await db.from('clinic_settings').update({ open_time: '07:00', close_time: '21:00' }).eq('id', 1), 'settings');

  // demo patient linked to the patient login
  const { data: own } = await db.from('patients').select('id').eq('user_id', ids.patient).maybeSingle();
  if (!own) must(await db.from('patients').insert({ user_id: ids.patient, full_name: 'สมศรี ใจดี', gender: 'F', birth_date: '1958-03-14', phone: '081-234-5678', coverage: 'gold', chronic_diseases: 'ความดันโลหิตสูง', regular_meds: 'Amlodipine 5 mg', drug_allergies: '-', emergency_contact: 'ลูกสาว 089-111-2222' }), 'own patient');

  // reset demo patients (those without a login)
  must(await db.from('patients').delete().is('user_id', null), 'reset');
  const patients = [];
  for (let i = 0; i < 140; i++) {
    const g = rnd() < 0.56 ? 'F' : 'M';
    const age = Math.round(pick([8, 22, 37, 52, 70], [8, 14, 20, 26, 32]) + rnd() * 14 - 7);
    patients.push({ full_name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`, gender: g, birth_date: `${2026 - Math.max(1, age)}-0${1 + (i % 9)}-1${i % 9}`,
      phone: `08${Math.floor(rnd() * 1e8).toString().padStart(8, '0')}`, coverage: pick(['gold', 'sso', 'civil', 'private', 'self'], [45, 25, 12, 8, 10]),
      chronic_diseases: age > 55 ? pick(['ความดันโลหิตสูง', 'เบาหวาน', '-'], [3, 2, 3]) : '-', drug_allergies: rnd() < 0.08 ? 'เพนิซิลลิน' : '-' });
  }
  const P = must(await db.from('patients').insert(patients).select('id, coverage, gender, birth_date'), 'patients');

  // ── history: 90 days ──
  const now = bangkokNow();
  const appts = [], extra = [];
  for (let d = 90; d >= 1; d--) {
    const day = new Date(now); day.setUTCDate(day.getUTCDate() - d);
    const dow = day.getUTCDay(); if (dow === 0) continue;
    const n = Math.round((dow === 1 ? 46 : dow === 6 ? 22 : 36) * (0.85 + rnd() * 0.3));
    for (let i = 0; i < n; i++) {
      const p = P[Math.floor(rnd() * P.length)];
      const dept = pick(['med', 'ortho', 'skin', 'ent', 'eye'], [44, 22, 12, 12, 10]);
      const hour = pick([9, 10, 11, 12, 13, 14, 15], dow === 6 ? [30, 28, 20, 8, 6, 5, 3] : [22, 20, 16, 6, 14, 12, 10]);
      const level = pick([1, 2, 3, 4, 5], [0.2, 1.3, 11, 38, 49.5]);
      const late = rnd() < 0.09;
      appts.push({ patient_id: p.id, visit_date: isoDate(day), slot_start: hhmm(hour * 60 + (rnd() < 0.5 ? 0 : 30)), queue_no: `Q${String(i + 1).padStart(3, '0')}`,
        department_id: dept, triage_level: level, status: level <= 2 ? 'referred' : 'done',
        checked_in_at: `${isoDate(day)}T0${Math.max(1, hour - 8)}:00:00Z`, rescheduled_from: late ? hhmm(hour * 60 - 30) : null });
      const criteria = rnd() < 0.06 ? Math.min(5, level + 1) : rnd() < 0.045 ? Math.max(1, level - 1) : level;
      const [icd, dx] = DX[dept][Math.floor(Math.pow(rnd(), 1.6) * DX[dept].length)];
      const base = PRICE[dept], total = Math.round(base[0] + rnd() * (base[1] - base[0]));
      extra.push({ level, criteria, dept, icd, dx, total, cov: p.coverage });
    }
  }
  console.log(`history: ${appts.length} visits`);
  for (let i = 0; i < appts.length; i += 500) {
    const rows = must(await db.from('appointments').insert(appts.slice(i, i + 500)).select('id'), 'appointments');
    const reviews = [], visits = [], charges = [];
    rows.forEach((r, j) => {
      const x = extra[i + j];
      reviews.push({ appointment_id: r.id, nurse_id: ids.nurse, stage: 'pre_visit', criteria_level: x.criteria, final_level: x.level, department_id: x.dept,
        override_reason: x.criteria !== x.level ? 'ประเมินจากการโทรสอบถามเพิ่มเติม' : null });
      if (x.level <= 2) return;
      visits.push({ appointment_id: r.id, doctor_id: ids.doctor, diagnosis: x.dx, icd10: x.icd, started_at: new Date().toISOString(), finished_at: new Date().toISOString() });
      const consult = 200, med = Math.round((x.total - consult) * 0.7), proc = x.total - consult - med;
      for (const [item_type, amount] of [['consult', consult], ['medicine', med], ['procedure', proc]]) {
        if (amount <= 0) continue;
        const claimable = Math.round(amount * RATIO[x.cov] * 100) / 100;
        charges.push({ appointment_id: r.id, item_type, amount, coverage: x.cov, claimable, patient_paid: amount - claimable });
      }
    });
    must(await db.from('triage_reviews').insert(reviews), 'reviews');
    must(await db.from('visits').insert(visits), 'visits');
    must(await db.from('charges').insert(charges), 'charges');
  }

  // ── today: a live queue around the current time ──
  const today = isoDate(now);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const base = Math.min(Math.max(Math.ceil(nowMin / 30) * 30, 7 * 60 + 30), 20 * 60);
  const T = (o) => hhmm(Math.min(Math.max(base + o, 7 * 60), 21 * 60));
  const todayRows = [
    { k: 'waiting', slot: T(-30), status: 'waiting_doctor', dept: 'med', level: 3, sym: [['head', 'เวียนหัวตอนเช้า บ้านหมุน', 5]], scr: { onset: 'd2_7', trend: 'same', associated: ['dizzy'], note: 'เป็นมา 3 วัน' }, vit: { weight: 51, height: 152, bp_sys: 168, bp_dia: 96, pulse: 84, temperature: 36.7, spo2: 97 } },
    { k: 'vitals', slot: T(0), status: 'in_vitals', dept: 'med', level: 4, sym: [['chest', 'ใจสั่นเป็นพัก ๆ', 3]], scr: { onset: 'w1_4', trend: 'same', associated: [] } },
    { k: 'ci1', slot: T(0), status: 'checked_in', dept: 'ortho', level: 4, sym: [['knee_a', 'ปวดเข่าขวาเวลาเดินขึ้นบันได', 6], ['knee_b', 'เข่าซ้ายบวมเล็กน้อย', 5]], scr: { onset: 'm1', trend: 'same', associated: [] } },
    { k: 'ci2', slot: T(30), status: 'checked_in', dept: 'ent', level: 5, sym: [['neck', 'เจ็บคอเวลากลืน', 3]], scr: { onset: 'd2_7', trend: 'better', associated: ['cough'] } },
    { k: 'b1', slot: T(60), status: 'booked', dept: 'skin', level: 5, sym: [['arm_b', 'ผื่นแดงคันที่แขนซ้าย', 2]], scr: { onset: 'w1_4', trend: 'same', associated: [] } },
    { k: 'pending1', slot: T(30), status: 'booked', dept: null, level: null, sym: [['abdomen', 'ปวดท้องขวาล่าง ปวดบิดเป็นพัก ๆ', 8], ['pelvis', 'ปวดร้าวลงท้องน้อย', 7]], scr: { onset: 'today', trend: 'worse', associated: ['fever', 'vomit'], note: 'ผู้ป่วยบอกว่าไม่เป็นไรมาก ขอรอได้' } },
    { k: 'pending2', slot: T(60), status: 'booked', dept: null, level: null, sym: [['neck', 'เจ็บคอ กลืนลำบาก', 5]], scr: { onset: 'd2_7', trend: 'same', associated: ['fever'] } },
    { k: 'pending3', slot: T(90), status: 'booked', dept: null, level: null, sym: [['arm_a', 'คันแขนขวา ไม่มีผื่น', 2]], scr: { onset: 'w1_4', trend: 'same', associated: [], note: 'กังวลมาก ขอคิวด่วน' } },
  ];
  const ages = { pending1: 78, pending3: 24 };
  for (const [i, r] of todayRows.entries()) {
    const p = P[i];
    if (ages[r.k]) must(await db.from('patients').update({ birth_date: `${2026 - ages[r.k]}-02-10` }).eq('id', p.id), 'age');
    const a = must(await db.from('appointments').insert({ patient_id: p.id, visit_date: today, slot_start: r.slot, queue_no: `Q${String(i + 1).padStart(3, '0')}`,
      department_id: r.dept, triage_level: r.level, status: r.status, checked_in_at: r.status === 'booked' ? null : new Date().toISOString() }).select('id').single(), 'today');
    must(await db.from('screenings').insert({ appointment_id: a.id, onset: r.scr.onset, trend: r.scr.trend, associated: r.scr.associated, note: r.scr.note ?? null }), 'screening');
    must(await db.from('symptom_reports').insert(r.sym.map(([body_part, description, severity]) => ({ appointment_id: a.id, body_part, description, severity }))), 'symptoms');
    if (r.level) must(await db.from('triage_reviews').insert({ appointment_id: a.id, nurse_id: ids.nurse, stage: 'pre_visit', criteria_level: r.level, final_level: r.level, department_id: r.dept }), 'review');
    if (r.vit) must(await db.from('vital_signs').insert({ appointment_id: a.id, ...r.vit, recorded_by: ids.nurse }), 'vitals');
  }
  console.log('Done. Demo password for all accounts:', PASSWORD);
  ACCOUNTS.forEach((a) => console.log(`  ${a.role.padEnd(8)} ${a.email}`));
}
main();
