export type AppRole = "admin" | "lead_teacher" | "teacher" | "reviewer";

export type AppFeature =
  | "studio.generate"
  | "studio.pipeline_view"
  | "studio.provider_select"
  | "studio.approval_toggle"
  | "library.access"
  | "library.export_teacher"
  | "ops.view"
  | "approval.manage"
  | "admin.manage_users";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "관리자",
  lead_teacher: "수석 강사",
  teacher: "강사",
  reviewer: "검토자",
};

const ROLE_FEATURES: Record<AppRole, AppFeature[]> = {
  admin: [
    "studio.generate",
    "studio.pipeline_view",
    "studio.provider_select",
    "studio.approval_toggle",
    "library.access",
    "library.export_teacher",
    "ops.view",
    "approval.manage",
    "admin.manage_users",
  ],
  lead_teacher: [
    "studio.generate",
    "studio.pipeline_view",
    "studio.provider_select",
    "studio.approval_toggle",
    "library.access",
    "library.export_teacher",
    "ops.view",
    "approval.manage",
  ],
  teacher: [
    "studio.generate",
    "library.access",
  ],
  reviewer: [
    "library.access",
    "ops.view",
    "approval.manage",
  ],
};

export function normalizeRole(role: string | null | undefined): AppRole {
  if (role === "admin" || role === "lead_teacher" || role === "teacher" || role === "reviewer") {
    return role;
  }
  return "teacher";
}

export function getRoleFeatures(role: AppRole): AppFeature[] {
  return ROLE_FEATURES[role];
}

export function hasFeature(role: AppRole, feature: AppFeature): boolean {
  return ROLE_FEATURES[role].includes(feature);
}
