import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getViewerAccess } from "@/lib/authz/server";

export const runtime = "nodejs";

const BUCKET = "image-prompt-references";

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureBucket() {
  const service = await createServiceClient();
  const { data: buckets } = await service.storage.listBuckets();
  const exists = buckets?.some((bucket) => bucket.name === BUCKET);
  if (!exists) {
    await service.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    });
  }
  return service;
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

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 이미지 파일이 필요합니다." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "이미지 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  const service = await ensureBucket();
  const fileName = sanitizeFileName(file.name || "reference-image");
  const path = `${user.id}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data } = service.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    reference: {
      name: file.name,
      url: data.publicUrl,
      storagePath: path,
    },
  });
}
