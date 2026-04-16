import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CURRICULUM_BUCKET, sanitizeCurriculumFileName } from "@/lib/curriculum";

export const runtime = "nodejs";

async function ensureBucket() {
  const service = await createServiceClient();
  const { data: buckets } = await service.storage.listBuckets();
  const exists = buckets?.some((bucket) => bucket.name === CURRICULUM_BUCKET);
  if (!exists) {
    await service.storage.createBucket(CURRICULUM_BUCKET, {
      public: true,
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/png",
        "image/jpeg",
        "image/webp",
      ],
    });
  }
  return service;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const semester = searchParams.get("semester");
  const levelName = searchParams.get("level");
  const subject = searchParams.get("subject");
  const contentType = searchParams.get("type");
  const status = searchParams.get("status");

  let query = supabase
    .from("curriculum_assets")
    .select("*")
    .order("created_at", { ascending: false });

  if (semester) query = query.eq("semester", semester);
  if (levelName) query = query.eq("level_name", levelName);
  if (subject) query = query.eq("subject", subject);
  if (contentType) query = query.eq("content_type", contentType);
  if (status) query = query.eq("status", status);

  const { data: assets, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const assetIds = (assets ?? []).map((asset) => asset.id);
  const [pagesResult, passagesResult, setsResult, questionsResult, jobsResult] = await Promise.all([
    assetIds.length
      ? supabase.from("curriculum_asset_pages").select("asset_id")
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase.from("curriculum_passages").select("asset_id")
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase.from("curriculum_question_sets").select("id, asset_id")
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase
          .from("curriculum_questions")
          .select("question_set_id")
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase
          .from("curriculum_transform_jobs")
          .select("asset_id, status, error_message, created_at")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const setAssetMap = new Map<string, string>();
  for (const set of setsResult.data ?? []) {
    setAssetMap.set(set.id, set.asset_id);
  }

  const pageCounts = new Map<string, number>();
  for (const row of pagesResult.data ?? []) {
    pageCounts.set(row.asset_id, (pageCounts.get(row.asset_id) ?? 0) + 1);
  }
  const passageCounts = new Map<string, number>();
  for (const row of passagesResult.data ?? []) {
    passageCounts.set(row.asset_id, (passageCounts.get(row.asset_id) ?? 0) + 1);
  }
  const setCounts = new Map<string, number>();
  for (const row of setsResult.data ?? []) {
    setCounts.set(row.asset_id, (setCounts.get(row.asset_id) ?? 0) + 1);
  }
  const questionCounts = new Map<string, number>();
  for (const row of questionsResult.data ?? []) {
    const assetId = setAssetMap.get(row.question_set_id);
    if (!assetId) continue;
    questionCounts.set(assetId, (questionCounts.get(assetId) ?? 0) + 1);
  }
  const latestJobs = new Map<string, { status: string | null; error_message: string | null }>();
  for (const row of jobsResult.data ?? []) {
    if (!latestJobs.has(row.asset_id)) {
      latestJobs.set(row.asset_id, {
        status: row.status,
        error_message: row.error_message,
      });
    }
  }

  return NextResponse.json({
    assets: (assets ?? []).map((asset) => ({
      id: asset.id,
      title: asset.title,
      semester: asset.semester,
      levelName: asset.level_name,
      subject: asset.subject,
      contentType: asset.content_type,
      fileUrl: asset.file_url,
      fileType: asset.file_type,
      notes: asset.notes,
      status: asset.status,
      lexileMin: asset.lexile_min,
      lexileMax: asset.lexile_max,
      metadata: asset.metadata ?? {},
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      pageCount: pageCounts.get(asset.id) ?? 0,
      passageCount: passageCounts.get(asset.id) ?? 0,
      questionSetCount: setCounts.get(asset.id) ?? 0,
      questionCount: questionCounts.get(asset.id) ?? 0,
      latestJobStatus: latestJobs.get(asset.id)?.status ?? null,
      latestJobError: latestJobs.get(asset.id)?.error_message ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 필요합니다." }, { status: 400 });
  }

  const title = String(formData.get("title") || file.name || "").trim();
  const semester = String(formData.get("semester") || "").trim();
  const levelName = String(formData.get("levelName") || "").trim();
  const subject = String(formData.get("subject") || "").trim();
  const contentType = String(formData.get("contentType") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const lexileMin = Number(formData.get("lexileMin"));
  const lexileMax = Number(formData.get("lexileMax"));

  if (!title || !semester || !levelName || !subject || !contentType) {
    return NextResponse.json({ error: "학기, 레벨, 과목, 유형, 자료명은 필수입니다." }, { status: 400 });
  }

  const service = await ensureBucket();
  const fileName = sanitizeCurriculumFileName(file.name || title || "curriculum-asset");
  const storagePath = `${user.id}/${semester}/${levelName}/${subject}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await service.storage
    .from(CURRICULUM_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const publicUrl = service.storage.from(CURRICULUM_BUCKET).getPublicUrl(storagePath).data.publicUrl;

  const { data: asset, error } = await supabase
    .from("curriculum_assets")
    .insert({
      user_id: user.id,
      title,
      semester,
      level_name: levelName,
      subject,
      content_type: contentType,
      storage_path: storagePath,
      file_url: publicUrl,
      file_type: file.type || "application/octet-stream",
      notes: notes || null,
      status: "uploaded",
      lexile_min: Number.isFinite(lexileMin) ? lexileMin : null,
      lexile_max: Number.isFinite(lexileMax) ? lexileMax : null,
      metadata: {
        originalFileName: file.name,
        fileSize: file.size,
      },
    })
    .select("*")
    .single();

  if (error || !asset) {
    return NextResponse.json({ error: error?.message ?? "업로드 저장 실패" }, { status: 500 });
  }

  return NextResponse.json({ asset });
}
