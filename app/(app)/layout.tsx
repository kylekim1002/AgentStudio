import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name")
    .eq("id", user.id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role: string = (profile as any)?.role ?? "teacher";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name: string = (profile as any)?.name ?? user.email ?? "";

  return (
    <AppShell userEmail={user.email!} userName={name} userRole={role}>
      {children}
    </AppShell>
  );
}
