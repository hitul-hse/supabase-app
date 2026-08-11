create table files (
  id bigint generated always as identity primary key,
  object_path text not null unique,
  original_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

alter table files enable row level security;

create policy "Allow anon full access to files"
  on files
  for all
  to anon
  using (true)
  with check (true);
