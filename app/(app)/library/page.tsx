import { redirect } from "next/navigation";
import LibraryClient from "@/components/library/LibraryClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string;
    status?: string;
    favorite?: string;
    search?: string;
    project_id?: string;
    lesson_id?: string;
    panel?: string;
    reassigned?: string;
    delete_requests?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);
  const resolvedSearchParams = await searchParams;
  const initialScope =
    resolvedSearchParams.scope === "mine" || resolvedSearchParams.scope === "review"
      ? resolvedSearchParams.scope
      : "all";
  const initialStatus =
    resolvedSearchParams.status === "draft" ||
    resolvedSearchParams.status === "in_review" ||
    resolvedSearchParams.status === "needs_revision" ||
    resolvedSearchParams.status === "approved" ||
    resolvedSearchParams.status === "published"
      ? resolvedSearchParams.status
      : "all";
  const initialFavorite = resolvedSearchParams.favorite === "true";
  const initialSearch = resolvedSearchParams.search ?? "";
  const initialProjectId = resolvedSearchParams.project_id ?? null;
  const initialLessonId = resolvedSearchParams.lesson_id ?? null;
  const initialPanel =
    resolvedSearchParams.panel === "comments" || resolvedSearchParams.panel === "activities"
      ? resolvedSearchParams.panel
      : null;
  const initialReassignedFilter =
    resolvedSearchParams.reassigned === "to_me" || resolvedSearchParams.reassigned === "from_me"
      ? resolvedSearchParams.reassigned
      : "all";
  const initialDeleteRequestOnly = resolvedSearchParams.delete_requests === "true";

  return (
    <LibraryClient
      viewerId={user.id}
      canExportTeacher={access.features.includes("library.export_teacher")}
      canManageReview={access.features.includes("approval.manage")}
      viewerRole={access.role}
      initialScope={initialScope}
      initialStatus={initialStatus}
      initialFavorite={initialFavorite}
      initialSearch={initialSearch}
      initialProjectId={initialProjectId}
      initialLessonId={initialLessonId}
      initialPanel={initialPanel}
      initialReassignedFilter={initialReassignedFilter}
      initialDeleteRequestOnly={initialDeleteRequestOnly}
    />
  );
}
