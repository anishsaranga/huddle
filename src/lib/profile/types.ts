import type { AvatarKind, Units } from "@/db/schema";
import type { AvatarConfig } from "@/lib/avatar/key";

/** What server actions return to client components. */
export type ProfileActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; field?: string };

/** The user-row fields the profile UI reads (serializable: dates are ISO strings). */
export type ProfileData = {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
  timezone: string | null;
  units: Units | null;
  dob: string | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  maxHr: number | null;
  stepGoal: number | null;
  sleepGoalMin: number | null;
};
