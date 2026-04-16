insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'curriculum-assets',
    'curriculum-assets',
    true,
    52428800,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
      'image/webp'
    ]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "curriculum-assets select" on storage.objects;
create policy "curriculum-assets select"
on storage.objects
for select
to authenticated
using (bucket_id = 'curriculum-assets');

drop policy if exists "curriculum-assets insert" on storage.objects;
create policy "curriculum-assets insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'curriculum-assets'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "curriculum-assets update" on storage.objects;
create policy "curriculum-assets update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'curriculum-assets'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'curriculum-assets'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "curriculum-assets delete" on storage.objects;
create policy "curriculum-assets delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'curriculum-assets'
  and auth.uid()::text = (storage.foldername(name))[1]
);
