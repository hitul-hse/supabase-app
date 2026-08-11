create policy "Temp allow anon insert to netflix_users"
  on netflix_users
  for insert
  to anon
  with check (true);
