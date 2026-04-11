import { SupabaseClient } from "@supabase/supabase-js";

export async function logLessonActivity(
  supabase: SupabaseClient,
  input: {
    lessonId: string;
    actorId?: string | null;
    action: string;
    metadata?: Record<string, unknown> | null;
  }
) {
  await (supabase as any)
    .from("lesson_activities")
    .insert({
      lesson_id: input.lessonId,
      actor_id: input.actorId ?? null,
      action: input.action,
      metadata: input.metadata ?? null,
    });
}
