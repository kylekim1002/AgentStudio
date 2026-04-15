import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import {
  DEFAULT_LEVEL_SETTINGS,
  normalizeLevelSettings,
} from "@/lib/levelSettings";

const LEVEL_SETTING_KEY = "level_settings";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", LEVEL_SETTING_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    levels: normalizeLevelSettings(data?.value ?? DEFAULT_LEVEL_SETTINGS),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getViewerAccess(supabase, user);
  if (access.role !== "admin" && access.role !== "lead_teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as { levels?: unknown };
  const levels = normalizeLevelSettings(body.levels);

  const { error } = await supabase.from("system_settings").upsert(
    {
      key: LEVEL_SETTING_KEY,
      value: levels,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, levels });
}
