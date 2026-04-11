import { redirect } from "next/navigation";
import StudioClient from "@/components/studio/StudioClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { AIProvider } from "@/lib/agents/types";

export default async function StudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);

  return (
    <StudioClient
      canViewPipeline={access.features.includes("studio.pipeline_view")}
      canSelectProvider={access.features.includes("studio.provider_select")}
      canToggleApproval={access.features.includes("studio.approval_toggle")}
      canExportTeacher={access.features.includes("library.export_teacher")}
      defaultProvider={access.features.includes("studio.provider_select") ? undefined : AIProvider.CLAUDE}
    />
  );
}
