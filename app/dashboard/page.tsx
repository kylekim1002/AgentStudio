import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data } = await supabase
    .from("lessons")
    .select("id, title, difficulty, provider, created_at, favorites(id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lessons = ((data as any[]) ?? []).map((l) => ({
    id: l.id as string,
    title: l.title as string,
    difficulty: l.difficulty as string,
    provider: l.provider as string,
    created_at: l.created_at as string,
    isFavorite: Array.isArray(l.favorites) && l.favorites.length > 0,
  }));

  return <DashboardClient user={user} lessons={lessons} />;
}
