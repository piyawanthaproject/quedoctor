import type { Level, Vitals } from './triage';

export type Role = 'patient' | 'nurse' | 'doctor' | 'admin';
export type Coverage = 'gold' | 'sso' | 'civil' | 'private' | 'self';
export const COVERAGES: Coverage[] = ['gold', 'sso', 'civil', 'private', 'self'];
export type Status =
  | 'booked' | 'checked_in' | 'skipped' | 'in_vitals' | 'waiting_doctor' | 'in_exam' | 'done' | 'referred' | 'cancelled';

export interface Department { id: string; name_th: string; name_en: string }

export interface Patient {
  id: string;
  user_id: string | null;
  full_name: string;
  gender: 'F' | 'M';
  birth_date: string | null;
  phone: string | null;
  coverage: Coverage;
  chronic_diseases: string | null;
  regular_meds: string | null;
  drug_allergies: string | null;
  emergency_contact: string | null;
}

export interface Screening {
  red_flags: string[];
  onset: string | null;
  trend: string | null;
  associated: string[];
  pregnant: boolean;
  note: string | null;
}

export interface SymptomReport { id?: string; body_part: string; description: string; severity: number }

export interface TriageReview {
  id: string;
  stage: 'pre_visit' | 'vitals' | 'worsened';
  criteria_level: Level;
  from_level: Level | null;
  final_level: Level;
  department_id: string | null;
  override_reason: string | null;
  created_at: string;
  nurse_id: string | null;
}

export interface VitalSigns extends Vitals { appointment_id?: string; recorded_at?: string }

/** Appointment row as staff see it, with related records joined in. */
export interface StaffAppointment {
  id: string;
  patient_id: string;
  visit_date: string;
  slot_start: string;
  queue_no: string;
  department_id: string | null;
  triage_level: Level | null;
  status: Status;
  checked_in_at: string | null;
  rescheduled_from: string | null;
  worsened_at: string | null;
  worsened_flags: string[] | null;
  patients: Patient;
  screenings: Screening | null;
  symptom_reports: SymptomReport[];
  vital_signs: VitalSigns | null;
  triage_reviews: TriageReview[];
}

/** What a patient may see about their own appointment (get_my_appointments). */
export interface MyAppointment {
  id: string;
  queue_no: string;
  visit_date: string;
  slot_start: string;
  checkin_deadline: string;
  department_id: string | null;
  status: Status;
  checked_in_at: string | null;
  rescheduled_from: string | null;
  worsened_at: string | null;
  ahead_count: number;
}

export const STAFF_SELECT =
  '*, patients(*), screenings(*), symptom_reports(*), vital_signs(*), triage_reviews(*)';
