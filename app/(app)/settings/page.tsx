import { redirect } from "next/navigation";
import SettingsClient from "@/components/settings/SettingsClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialTab = resolvedSearchParams.tab;

  return <SettingsClient viewerRole={access.role} initialTab={typeof initialTab === "string" ? (initialTab as any) : undefined} />;
}
