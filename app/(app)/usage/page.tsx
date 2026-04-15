import { redirect } from "next/navigation";
import UsageClient from "@/components/usage/UsageClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export default async function UsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);
  if (!access.features.includes("ops.view")) {
    redirect("/studio");
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <UsageClient />
    </div>
  );
}
