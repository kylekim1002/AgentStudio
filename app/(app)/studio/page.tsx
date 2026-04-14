import { redirect } from "next/navigation";
import StudioClient from "@/components/studio/StudioClient";
import { createClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";
import { AIProvider } from "@/lib/agents/types";
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  normalizeDocumentTemplates,
} from "@/lib/documentTemplates";

function resolveProvider(value: unknown): AIProvider | undefined {
  if (value === AIProvider.CLAUDE || value === AIProvider.GPT || value === AIProvider.GEMINI) {
    return value;
  }
  return undefined;
}

export default async function StudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const access = await getViewerAccess(supabase, user);

  // Load user settings to resolve default provider
  const { data: profile } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();

  const settings = (profile?.settings ?? {}) as Record<string, unknown>;
  const savedProvider = resolveProvider(settings.defaultProvider);

  // If user can't pick a provider, force Claude. Otherwise use their saved default.
  const defaultProvider = access.features.includes("studio.provider_select")
    ? (savedProvider ?? AIProvider.CLAUDE)
    : AIProvider.CLAUDE;

  const { data: templateSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "document_templates")
    .maybeSingle();

  const documentTemplates = normalizeDocumentTemplates(
    templateSetting?.value ?? DEFAULT_DOCUMENT_TEMPLATES
  );

  return (
    <StudioClient
      canViewPipeline={access.features.includes("studio.pipeline_view")}
      canSelectProvider={access.features.includes("studio.provider_select")}
      canToggleApproval={access.features.includes("studio.approval_toggle")}
      canExportTeacher={access.features.includes("library.export_teacher")}
      defaultProvider={defaultProvider}
      initialDocumentTemplates={documentTemplates}
    />
  );
}
