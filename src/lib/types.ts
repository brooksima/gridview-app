export type Role = 'owner' | 'pilot' | 'customer';
export type Status = 'pending' | 'approved' | 'denied';
export type Severity = 'none' | 'low' | 'medium' | 'high';

export interface Company { id: string; name: string }
export interface Profile {
  id: string; email: string; full_name: string; phone: string | null;
  requested_role: Role; requested_company: string | null;
  role: Role; status: Status; company_id: string | null;
  reviewed_at: string | null; created_at: string;
}
export interface Photo {
  id: string; company_id: string; territory: string | null; circuit: string | null;
  issue: string | null; severity: Severity; storage_path: string; thumb_path: string | null;
  original_name: string | null; lat: number | null; lng: number | null; has_gps: boolean;
  taken_at: string | null; pilot_id: string; created_at: string;
  gimbal_pitch: number | null; is_thermal: boolean;
}

export const SIGNUP_COMPANIES = ['DTE Energy', 'Consumers Energy', 'Toledo Edison (FirstEnergy)', 'Hancock-Wood Electric Co-op', 'Other'];

export const SEV_COLOR: Record<Severity, string> = { high: '#ff3b3b', medium: '#ff7a1a', low: '#ffd23f', none: '#4f9fd1' };
export const SEV_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };
export const SEV_RANK: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3 };

export const ISSUE_PRESETS: { issue: string; severity: Severity }[] = [
  { issue: 'Broken crossarm', severity: 'high' },
  { issue: 'Cracked insulator', severity: 'medium' },
  { issue: 'Leaning pole', severity: 'medium' },
  { issue: 'Pole top', severity: 'medium' },
  { issue: 'Vegetation contact', severity: 'low' },
  { issue: 'Bird nest', severity: 'low' },
];
