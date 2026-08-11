alter table netflix_users enable row level security;

create policy "Allow anon read access to netflix_users"
  on netflix_users
  for select
  to anon
  using (true);
