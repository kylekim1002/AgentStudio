import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type TemplateStatsItem = {
  template: string;
  count: number;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await (supabase as any)
    .from("lesson_activities")
    .select("action, metadata")
    .in("action", ["approved", "revision_requested"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const approvedMap = new Map<string, number>();
  const revisionMap = new Map<string, number>();

  for (const row of data ?? []) {
    const metadata = row.metadata as {
      template_used?: boolean;
      template_text?: string | null;
    } | null;

    if (!metadata?.template_used || !metadata.template_text) continue;

    const targetMap = row.action === "approved" ? approvedMap : revisionMap;
    targetMap.set(
      metadata.template_text,
      (targetMap.get(metadata.template_text) ?? 0) + 1
    );
  }

  function toSortedList(source: Map<string, number>): TemplateStatsItem[] {
    return Array.from(source.entries())
      .map(([template, count]) => ({ template, count }))
      .sort((a, b) => b.count - a.count);
  }

  return NextResponse.json({
    stats: {
      approved: toSortedList(approvedMap),
      needs_revision: toSortedList(revisionMap),
    },
  });
}
