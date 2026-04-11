import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getViewerAccess } from "@/lib/authz/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");
  const access = await getViewerAccess(supabase, user);

  return (
    <AppShell
      userEmail={user.email!}
      userName={access.name}
      userRole={access.role}
      userFeatures={access.features}
    >
      {children}
    </AppShell>
  );
}
