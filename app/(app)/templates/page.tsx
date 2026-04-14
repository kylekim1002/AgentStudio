import { redirect } from "next/navigation";
import TemplatesClient from "@/components/templates/TemplatesClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);
  if (access.role !== "admin" && access.role !== "lead_teacher") {
    redirect("/work");
  }

  return <TemplatesClient />;
}
