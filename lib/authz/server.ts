import { SupabaseClient, User } from "@supabase/supabase-js";
import { AppFeature, AppRole, getRoleFeatures, hasFeature, normalizeRole } from "./roles";

export interface ViewerAccess {
  user: User;
  role: AppRole;
  features: AppFeature[];
  name: string;
}

export async function getViewerAccess(
  supabase: SupabaseClient,
  user: User
): Promise<ViewerAccess> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("role, name")
    .eq("id", user.id)
    .single();

  const role = normalizeRole((profile as { role?: string } | null)?.role);
  const name = (profile as { name?: string | null } | null)?.name ?? user.email ?? "";

  return {
    user,
    role,
    features: getRoleFeatures(role),
    name,
  };
}

export function canAccess(access: ViewerAccess, feature: AppFeature): boolean {
  return hasFeature(access.role, feature);
}
