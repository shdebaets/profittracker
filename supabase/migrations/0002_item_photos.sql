-- Optional item photos. Paths point into the private `item-photos` bucket; the first is the cover.

alter table public.items
  add column photo_paths text[] not null default '{}'
    check (cardinality(photo_paths) <= 12);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Objects live under `{user_id}/...`; each user can only touch their own folder.
create policy "own photos read" on storage.objects for select to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
