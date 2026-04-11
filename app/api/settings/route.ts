import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { AppRole } from "@/lib/authz/roles";

const PERSONAL_SETTING_KEYS = [
  "notificationsEnabled",
  "reviewAlerts",
  "revisionAlerts",
  "quietStartHour",
  "quietEndHour",
  "reassignmentAlertsLastSeenAt",
] as const;

const ADVANCED_SETTING_KEYS = [
  "defaultProvider",
  "agentProviders",
  "tokenLimit",
  "warnMinutes",
  "blockOnLimit",
  ...PERSONAL_SETTING_KEYS,
] as const;

function getAllowedSettingKeys(role: AppRole) {
  if (role === "admin" || role === "lead_teacher") {
    return ADVANCED_SETTING_KEYS;
  }
  return PERSONAL_SETTING_KEYS;
}

function pickAllowedSettings(
  role: AppRole,
  source: Record<string, unknown>
): Record<string, unknown> {
  const allowedKeys = getAllowedSettingKeys(role) as readonly string[];
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowedKeys.includes(key))
  );
}

// GET /api/settings — 현재 사용자 설정 불러오기
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getViewerAccess(supabase, user);

  const { data, error } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    settings: pickAllowedSettings(access.role, (data?.settings ?? {}) as Record<string, unknown>),
  });
}

// POST /api/settings — 설정 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getViewerAccess(supabase, user);

  const body = (await req.json()) as Record<string, unknown>;
  const filteredBody = pickAllowedSettings(access.role, body);

  const { data: currentProfile, error: currentError } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });

  const currentSettings = (currentProfile?.settings ?? {}) as Record<string, unknown>;

  const { error } = await supabase
    .from("profiles")
    .update({
      settings: {
        ...currentSettings,
        ...filteredBody,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
