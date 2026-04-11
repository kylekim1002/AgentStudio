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

const API_KEY_KEYS = ["anthropicApiKey", "openaiApiKey", "googleApiKey"] as const;

const ADVANCED_SETTING_KEYS = [
  "defaultProvider",
  "agentProviders",
  "tokenLimit",
  "warnMinutes",
  "blockOnLimit",
  ...API_KEY_KEYS,
  ...PERSONAL_SETTING_KEYS,
] as const;

const API_KEY_FIELD_TO_KEY: Record<
  (typeof API_KEY_KEYS)[number],
  "anthropic" | "openai" | "google"
> = {
  anthropicApiKey: "anthropic",
  openaiApiKey: "openai",
  googleApiKey: "google",
};

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

function maskApiKey(key: string): string {
  if (key.length > 12) {
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  }
  return "••••";
}

function buildApiKeyStatus(settings: Record<string, unknown>) {
  const apiKeys = (settings.apiKeys ?? {}) as Record<string, unknown>;
  const status: Record<
    "anthropic" | "openai" | "google",
    { hasKey: boolean; maskedKey?: string }
  > = {
    anthropic: { hasKey: false },
    openai: { hasKey: false },
    google: { hasKey: false },
  };
  for (const provider of ["anthropic", "openai", "google"] as const) {
    const value = apiKeys[provider];
    if (typeof value === "string" && value.length > 0) {
      status[provider] = { hasKey: true, maskedKey: maskApiKey(value) };
    }
  }
  return status;
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

  const fullSettings = (data?.settings ?? {}) as Record<string, unknown>;
  const filteredSettings = pickAllowedSettings(access.role, fullSettings);
  // Strip raw api keys (jsonb subtree) from response — only expose via apiKeyStatus
  delete (filteredSettings as Record<string, unknown>).apiKeys;

  return NextResponse.json({
    settings: filteredSettings,
    apiKeyStatus: buildApiKeyStatus(fullSettings),
  });
}

// POST /api/settings — 설정 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getViewerAccess(supabase, user);

  const body = (await req.json()) as Record<string, unknown>;

  // Extract API key fields from body BEFORE generic filter — handle them specially
  const apiKeyUpdates: Partial<Record<"anthropic" | "openai" | "google", string | null>> = {};
  const allowedKeys = getAllowedSettingKeys(access.role) as readonly string[];
  const canManageApiKeys = (API_KEY_KEYS as readonly string[]).every((k) =>
    allowedKeys.includes(k)
  );

  if (canManageApiKeys) {
    for (const field of API_KEY_KEYS) {
      if (field in body) {
        const raw = body[field];
        const provider = API_KEY_FIELD_TO_KEY[field];
        if (typeof raw === "string") {
          if (raw.length > 0) {
            apiKeyUpdates[provider] = raw;
          } else {
            // empty string => clear this key
            apiKeyUpdates[provider] = null;
          }
        }
        // undefined => leave existing value unchanged (no-op)
      }
    }
  }

  // Remove api key fields from body so generic pick step doesn't write them at top level
  const bodyWithoutApiKeys: Record<string, unknown> = { ...body };
  for (const field of API_KEY_KEYS) {
    delete bodyWithoutApiKeys[field];
  }

  const filteredBody = pickAllowedSettings(access.role, bodyWithoutApiKeys);

  const { data: currentProfile, error: currentError } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });

  const currentSettings = (currentProfile?.settings ?? {}) as Record<string, unknown>;
  const currentApiKeys = ((currentSettings.apiKeys ?? {}) as Record<string, unknown>) as Record<
    string,
    string | undefined
  >;

  // Merge api key updates onto existing apiKeys subtree
  const nextApiKeys: Record<string, string> = {};
  for (const provider of ["anthropic", "openai", "google"] as const) {
    const update = apiKeyUpdates[provider];
    if (update === null) {
      // cleared — skip
      continue;
    }
    if (typeof update === "string") {
      nextApiKeys[provider] = update;
      continue;
    }
    // unchanged — keep existing
    const existing = currentApiKeys[provider];
    if (typeof existing === "string" && existing.length > 0) {
      nextApiKeys[provider] = existing;
    }
  }

  const nextSettings: Record<string, unknown> = {
    ...currentSettings,
    ...filteredBody,
    apiKeys: nextApiKeys,
  };

  const { error } = await supabase
    .from("profiles")
    .update({
      settings: nextSettings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
