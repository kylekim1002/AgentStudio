import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LessonPackage, AIProvider } from "@/lib/agents/types";

// GET /api/lessons — 내 레슨 목록 (project_id, search 필터 지원)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  const search    = searchParams.get("search");
  const favOnly   = searchParams.get("favorite") === "true";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("lessons")
    .select("id, title, difficulty, provider, created_at, project_id, tags, favorites(id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (projectId) query = query.eq("project_id", projectId);
  if (search)    query = query.ilike("title", `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lessons = (data as any[]).map((l) => ({
    ...l,
    isFavorite: Array.isArray(l.favorites) && l.favorites.length > 0,
    favorites: undefined,
  }));

  if (favOnly) lessons = lessons.filter((l) => l.isFavorite);

  return NextResponse.json({ lessons });
}

// POST /api/lessons — 레슨 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { package: LessonPackage; provider: AIProvider; project_id?: string; tags?: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { package: lessonPackage, provider, project_id, tags } = body;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("lessons")
    .insert({
      user_id: user.id,
      title: lessonPackage.title,
      difficulty: lessonPackage.difficulty,
      provider,
      package: lessonPackage,
      project_id: project_id ?? null,
      tags: tags ?? [],
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({ id: (data as any).id }, { status: 201 });
}
