import { createClient } from "@/lib/supabase/server";
import { HomeClient } from "@/components/HomeClient";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name")
    .eq("id", user!.id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (profile as any)?.role ?? "teacher";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name = (profile as any)?.name ?? user!.email;

  return <HomeClient userEmail={user!.email!} userName={name} userRole={role} />;
}
