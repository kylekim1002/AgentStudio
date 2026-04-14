import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import {
  DEFAULT_IMAGE_PROMPT_PRESETS,
  normalizeImagePromptPresets,
} from "@/lib/imagePrompts";

const IMAGE_PROMPT_KEY = "image_prompt_presets";

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
    .eq("key", IMAGE_PROMPT_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    prompts: normalizeImagePromptPresets(data?.value ?? DEFAULT_IMAGE_PROMPT_PRESETS),
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

  const body = (await req.json()) as { prompts?: unknown };
  const prompts = normalizeImagePromptPresets(body.prompts);

  const { error } = await supabase.from("system_settings").upsert(
    {
      key: IMAGE_PROMPT_KEY,
      value: prompts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, prompts });
}
