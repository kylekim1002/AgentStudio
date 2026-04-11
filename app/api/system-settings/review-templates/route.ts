import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import {
  DEFAULT_REVIEW_NOTE_TEMPLATES,
  normalizeReviewNoteTemplates,
} from "@/lib/reviewTemplates";
import {
  DEFAULT_REVIEW_SLA_HOURS,
  normalizeReviewSlaHours,
} from "@/lib/reviewSettings";

const TEMPLATE_SETTING_KEY = "review_note_templates";
const SLA_SETTING_KEY = "review_sla_hours";

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
    .select("key, value")
    .in("key", [TEMPLATE_SETTING_KEY, SLA_SETTING_KEY]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    templates: normalizeReviewNoteTemplates(
      data?.find((item) => item.key === TEMPLATE_SETTING_KEY)?.value ?? DEFAULT_REVIEW_NOTE_TEMPLATES
    ),
    slaHours: normalizeReviewSlaHours(
      data?.find((item) => item.key === SLA_SETTING_KEY)?.value ?? DEFAULT_REVIEW_SLA_HOURS
    ),
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

  const body = (await req.json()) as { templates?: unknown; slaHours?: unknown };
  const templates = normalizeReviewNoteTemplates(body.templates);
  const slaHours = normalizeReviewSlaHours(body.slaHours);

  const { error } = await supabase.from("system_settings").upsert(
    [
      {
        key: TEMPLATE_SETTING_KEY,
        value: templates,
        updated_at: new Date().toISOString(),
      },
      {
        key: SLA_SETTING_KEY,
        value: slaHours,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: "key" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates, slaHours });
}
