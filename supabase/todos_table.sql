create table todos (
  id bigint generated always as identity primary key,
  task text not null,
  is_complete boolean not null default false,
  inserted_at timestamptz not null default now()
);

alter table todos enable row level security;

-- Demo-only policy: anyone with the anon/publishable key can read and write.
-- Once you add auth, replace this with policies scoped to auth.uid().
create policy "Allow anon full access to todos"
  on todos
  for all
  to anon
  using (true)
  with check (true);
