import { redirect } from "next/navigation";
import CurriculumClient from "@/components/curriculum/CurriculumClient";
import { createClient } from "@/lib/supabase/server";

export default async function CurriculumPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  return <CurriculumClient viewerId={user.id} />;
}
