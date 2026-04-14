import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  normalizeDocumentTemplates,
} from "@/lib/documentTemplates";

const DOCUMENT_TEMPLATE_KEY = "document_templates";

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
    .eq("key", DOCUMENT_TEMPLATE_KEY)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    templates: normalizeDocumentTemplates(data?.value ?? DEFAULT_DOCUMENT_TEMPLATES),
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

  const body = (await req.json()) as { templates?: unknown };
  const templates = normalizeDocumentTemplates(body.templates);

  const { error } = await supabase.from("system_settings").upsert(
    {
      key: DOCUMENT_TEMPLATE_KEY,
      value: templates,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates });
}
