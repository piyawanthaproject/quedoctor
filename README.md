# คิวหมอ · Khiu Mor

ระบบนัดหมายและคัดกรองผู้ป่วยนอก ที่ให้พยาบาลเป็นผู้ตัดสินแผนกและระดับความเร่งด่วน
Outpatient appointment and triage system where nurses decide the department and urgency level.

[ภาษาไทย](#ภาษาไทย) · [English](#english)

![Nurse triage](docs/screenshots/nurse-triage.png)

---

## ภาษาไทย

### ปัญหาที่แก้
- ผู้ป่วย โดยเฉพาะผู้สูงอายุ ต้องมารอตั้งแต่เช้ามืดเพราะระบบ "มาก่อนได้ก่อน"
- ผู้ป่วยเลือกแผนกเองไม่ถูก ถูกส่งต่อไปมา
- ผู้ป่วยที่อาการหนักจริงแต่บอกว่า "ไม่เป็นไรมาก" อาจรอคิวปกติ ส่วนคนที่กังวลมากอาจได้คิวด่วนทั้งที่อาการไม่หนัก
- ข้อมูลอาการ ค่าร่างกาย และการวินิจฉัยอยู่บนกระดาษ ผู้บริหารไม่มีข้อมูลวางแผน

### ระบบทำงานอย่างไร
1. **ผู้ป่วย** กรอกประวัติครั้งเดียว ตอบคำถามสัญญาณอันตราย 7 ข้อ กดตำแหน่งบนภาพร่างกาย (ชาย/หญิง หน้า/หลัง) แล้ว **เขียนอาการเอง** พร้อมความรุนแรง 0–10 จากนั้นเลือกเวลานัด **ไม่ต้องเลือกแผนก**
2. ถ้าเลือกสัญญาณอันตราย ระบบไม่ให้จองนัด แนะนำให้ไปห้องฉุกเฉินหรือโทร 1669 และแจ้งพยาบาลให้โทรกลับ
3. **พยาบาล** เห็นอาการทั้งหมดและ "ผลตามเกณฑ์คัดกรอง" พร้อมเหตุผลทุกข้อ แล้ว **กำหนดแผนกและระดับ 1–5 เอง** ถ้าต่างจากผลตามเกณฑ์ต้องเขียนเหตุผล
4. ผู้ป่วยต้อง **เช็กอินก่อนนัด 30 นาที** ถ้าไม่ทัน ระบบเลื่อนคิวอัตโนมัติ คนถัดไปขยับขึ้น และเมื่อผู้ป่วยมาถึงจะได้ช่วงเวลาว่างถัดไป
5. จุดตรวจร่างกายเรียกคิวตามระดับความเร่งด่วนก่อน แล้วตามเวลานัด ถ้าค่าร่างกายเข้าเกณฑ์ระดับที่สูงกว่าเดิม ต้องประเมินซ้ำก่อนส่งพบแพทย์
6. ระหว่างรอ ผู้ป่วยกด "อาการแย่ลง" ได้ พยาบาลได้รับแจ้งเตือนทันที
7. **แพทย์** เห็นข้อมูลทุกอย่างหน้าเดียว **เขียนการวินิจฉัยเอง** (ใส่รหัส ICD-10 ได้) บันทึกการรักษาและค่ารักษา
8. **ผู้บริหาร** เห็นแดชบอร์ดแบบไม่ระบุตัวบุคคล: ผู้ป่วยแยกแผนก ช่วงอายุ ช่วงเวลาที่หนาแน่น โรคที่พบบ่อย รายได้แยกแผนกและสิทธิ์การรักษา และอัตราที่พยาบาลปรับระดับจากผลตามเกณฑ์

### ความปลอดภัยของข้อมูล
- ทุกการเขียนข้อมูลผ่านฟังก์ชันในฐานข้อมูลที่ตรวจบทบาทผู้เรียก (`SECURITY DEFINER` + `require_role`)
- Row Level Security: ผู้ป่วยอ่านตาราง `appointments` ไม่ได้เลย เห็นนัดของตัวเองผ่าน `get_my_appointments()` ซึ่งไม่มีระดับความเร่งด่วนและไม่มีข้อมูลคนอื่น
- แพทย์เห็นเฉพาะผู้ป่วยที่ส่งมาพบ ผู้บริหารเห็นเฉพาะตัวเลขรวมผ่าน `admin_stats()`
- ทุกการกระทำบันทึกใน `audit_logs` พร้อมผู้ทำและเวลา

### เทคโนโลยี
Next.js 14 (App Router) · TypeScript · Supabase (PostgreSQL, Auth, Realtime, RLS) · Recharts · Vitest · ฟอนต์ Noto Sans Thai Looped · สลับภาษาไทย/อังกฤษได้ทุกหน้า

### ติดตั้งและรัน
1. ติดตั้ง Node.js 18 ขึ้นไป แล้วรัน `npm install`
2. สร้างโปรเจกต์ที่ [supabase.com](https://supabase.com) (ฟรี)
3. เปิด **SQL Editor** ใน Supabase วางไฟล์ `supabase/migrations/20261106000000_init.sql` ทั้งไฟล์ แล้วกด Run
4. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่า URL, anon key และ service role key จาก **Project Settings → API**
5. ใส่ข้อมูลตัวอย่าง: `npm run seed` (สร้างบัญชีทดลอง 4 บทบาท ผู้ป่วยตัวอย่าง คิววันนี้ และข้อมูลย้อนหลัง 90 วัน)
6. รัน `npm run dev` แล้วเปิด http://localhost:3000
7. ทดสอบเกณฑ์คัดกรอง: `npm test`

บัญชีทดลอง (รหัสผ่าน `KhiuMor-demo-2026`): `patient@khiumor.demo` · `nurse@khiumor.demo` · `doctor@khiumor.demo` · `admin@khiumor.demo`

> ถ้าต้องการให้ผู้ป่วยสมัครเองได้ทันทีโดยไม่ต้องยืนยันอีเมล ให้ปิด **Confirm email** ใน Authentication → Providers → Email
> สคริปต์ seed ตั้งเวลาเปิดคลินิกเป็น 07:00–21:00 เพื่อให้ทดลองได้ทั้งวัน แก้ได้ในตาราง `clinic_settings`

### ข้อควรทราบ
- **เกณฑ์คัดกรองใน `src/lib/triage.ts` เป็นตัวอย่าง** ใช้ประกอบการตัดสินใจของพยาบาลเท่านั้น ก่อนใช้งานจริงต้องให้ทีมพยาบาลและแพทย์กำหนดเกณฑ์ตามแนวทางที่โรงพยาบาลใช้
- อัตราเบิกของแต่ละสิทธิ์ในตาราง `coverage_rates` เป็นค่าสมมติ
- ระดับตามเกณฑ์คำนวณฝั่งหน้าเว็บแล้วส่งให้ฐานข้อมูล งานถัดไปคือย้ายการคำนวณไปไว้ในฐานข้อมูลด้วย เพื่อไม่ต้องเชื่อค่าจากหน้าเว็บ

---

## English

### Problem
- Patients, especially older people, queue from dawn under first-come-first-served.
- Patients pick the wrong department and get passed between clinics.
- A seriously ill patient who says "it's nothing" can wait in the regular queue, while a worried patient with mild symptoms can be rushed.
- Symptoms, vital signs and diagnoses live on paper, so managers have nothing to plan with.

### How it works
1. **Patients** fill in their record once, answer 7 emergency-sign questions, tap areas on a body diagram (female/male, front/back), **write their own symptoms** with a 0–10 severity, and pick a time. **They never choose a department.**
2. Any emergency sign blocks booking, tells the patient to go to the ED or call 1669, and alerts a nurse to call back.
3. **Nurses** see all symptoms plus a transparent **triage criteria result** with every reason listed, then **set the department and a level from 1 to 5 themselves**. A level that differs from the criteria needs a written reason.
4. Patients must **check in 30 minutes before** their time. Late patients are moved automatically, the queue moves up, and on arrival they get the next free slot.
5. The examination station calls patients by urgency level, then by time. If vital signs meet a higher level, the nurse must reassess before the physician sees them.
6. While waiting, patients can report that they feel worse; nurses are alerted immediately.
7. **Physicians** see everything on one page, **write the diagnosis as free text** (optional ICD-10 code), and record treatment and charges.
8. **Administrators** see an anonymised dashboard: patients by department, age and sex, busiest times, common diagnoses, revenue by department and coverage, and how often nurses override the criteria.

### Data protection
- All writes go through database functions that check the caller's role.
- Row level security: patients cannot read `appointments`; they see their own through `get_my_appointments()`, which hides urgency levels and other people.
- Physicians see only patients sent to them; administrators only aggregates via `admin_stats()`.
- Every action is written to `audit_logs` with actor and time.

### Stack
Next.js 14 (App Router) · TypeScript · Supabase (PostgreSQL, Auth, Realtime, RLS) · Recharts · Vitest · Thai/English on every page

### Setup
1. Node.js 18+, then `npm install`
2. Create a free project at [supabase.com](https://supabase.com)
3. In the Supabase **SQL Editor**, paste and run `supabase/migrations/20261106000000_init.sql`
4. Copy `.env.example` to `.env.local` and fill in the URL, anon key and service role key (Project Settings → API)
5. `npm run seed` for demo accounts, patients, today's queue and 90 days of history
6. `npm run dev` and open http://localhost:3000
7. `npm test` runs the triage criteria tests

Demo accounts (password `KhiuMor-demo-2026`): `patient@khiumor.demo` · `nurse@khiumor.demo` · `doctor@khiumor.demo` · `admin@khiumor.demo`

### Notes
- **The criteria in `src/lib/triage.ts` are examples** that support, never replace, the nurse's judgement. Real thresholds must come from the hospital's clinical team.
- Claim ratios in `coverage_rates` are placeholders.
- The criteria level is computed in the browser and passed to the database; moving that calculation into the database is the next step.

### Screenshots
| | |
|---|---|
| ![Symptoms](docs/screenshots/patient-symptoms.png) | ![Slip](docs/screenshots/patient-slip.png) |
| ![Doctor](docs/screenshots/doctor-exam.png) | ![Dashboard](docs/screenshots/admin-dashboard.png) |

Screenshots use demo data.
