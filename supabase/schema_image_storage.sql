-- Image storage buckets and policies
-- Run this in Supabase SQL Editor before enabling uploaded image references
-- and generated image persistence.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'image-prompt-references',
    'image-prompt-references',
    true,
    10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  ),
  (
    'lesson-generated-images',
    'lesson-generated-images',
    true,
    10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "image-prompt-references select" on storage.objects;
create policy "image-prompt-references select"
on storage.objects
for select
to authenticated
using (bucket_id = 'image-prompt-references');

drop policy if exists "image-prompt-references insert" on storage.objects;
create policy "image-prompt-references insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'image-prompt-references'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "image-prompt-references update" on storage.objects;
create policy "image-prompt-references update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'image-prompt-references'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'image-prompt-references'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "image-prompt-references delete" on storage.objects;
create policy "image-prompt-references delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'image-prompt-references'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "lesson-generated-images select" on storage.objects;
create policy "lesson-generated-images select"
on storage.objects
for select
to authenticated
using (bucket_id = 'lesson-generated-images');

drop policy if exists "lesson-generated-images insert" on storage.objects;
create policy "lesson-generated-images insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'lesson-generated-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "lesson-generated-images update" on storage.objects;
create policy "lesson-generated-images update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'lesson-generated-images'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'lesson-generated-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "lesson-generated-images delete" on storage.objects;
create policy "lesson-generated-images delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'lesson-generated-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);
