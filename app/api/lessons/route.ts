import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LessonPackage, AIProvider } from "@/lib/agents/types";

// GET /api/lessons — 내 레슨 목록 + 즐겨찾기 여부
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("lessons")
    .select("id, title, difficulty, provider, created_at, favorites(id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lessons = (data as any[]).map((l) => ({
    id: l.id,
    title: l.title,
    difficulty: l.difficulty,
    provider: l.provider,
    created_at: l.created_at,
    isFavorite: Array.isArray(l.favorites) && l.favorites.length > 0,
  }));

  return NextResponse.json({ lessons });
}

// POST /api/lessons — 레슨 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { package: LessonPackage; provider: AIProvider };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { package: lessonPackage, provider } = body;

  const { data, error } = await supabase
    .from("lessons")
    .insert({
      user_id: user.id,
      title: lessonPackage.title,
      difficulty: lessonPackage.difficulty,
      provider,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      package: lessonPackage as any,
    } as never)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({ id: (data as any).id }, { status: 201 });
}
