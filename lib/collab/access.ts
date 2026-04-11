import { ViewerAccess } from "@/lib/authz/server";

interface LessonAccessRecord {
  user_id: string;
  reviewer_id?: string | null;
}

export function canViewLesson(access: ViewerAccess, lesson: LessonAccessRecord): boolean {
  return (
    access.user.id === lesson.user_id ||
    access.user.id === lesson.reviewer_id ||
    access.features.includes("approval.manage")
  );
}

export function canDeleteLesson(access: ViewerAccess, lesson: LessonAccessRecord): boolean {
  return access.user.id === lesson.user_id || access.features.includes("admin.manage_users");
}

export function canReviewLesson(access: ViewerAccess, lesson: LessonAccessRecord): boolean {
  return (
    access.features.includes("approval.manage") &&
    (access.user.id === lesson.reviewer_id || access.role === "admin" || access.role === "lead_teacher" || access.role === "reviewer")
  );
}
