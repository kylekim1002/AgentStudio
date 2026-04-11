import { redirect } from "next/navigation";
import WorkInboxClient from "@/components/work/WorkInboxClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export default async function WorkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);

  return (
    <WorkInboxClient
      viewerRole={access.role}
      canManageReview={access.features.includes("approval.manage")}
    />
  );
}
