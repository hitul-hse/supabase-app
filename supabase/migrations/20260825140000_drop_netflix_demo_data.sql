-- ============================================================================
-- Remove the Netflix demo dataset from production
-- ============================================================================
--
-- WHAT THIS IS
-- ------------
-- `public.netflix_users` holds 25,000 rows of streaming-service demo data --
-- name, age, country, subscription tier, watch hours, favourite genre, last
-- login -- with four views over it (`netflix_overview`,
-- `netflix_country_stats`, `netflix_genre_stats`,
-- `netflix_subscription_stats`). None of it has anything to do with HSE Health
-- & Safety Experts. It is a tutorial dataset that was loaded into the live
-- project and never removed.
--
-- WHY IT IS NOT MERELY UNTIDY
-- ---------------------------
-- The table carries this policy:
--
--     "Allow anon read access to netflix_users"  USING (true)
--
-- and the four views are `security_invoker=true`, so they inherit it rather
-- than shielding it. That means the whole dataset is readable by ANY caller
-- holding the anon key -- which ships in the browser bundle by design and is
-- therefore public. Verified against the live API with no session at all
-- (scripts/probe-anon-exposure.mjs):
--
--     200  netflix_users               [{"user_id":1,"name":"James Martinez","age":18,"country":"France",...
--     200  netflix_overview            [{"total_users":25000,...
--     200  netflix_country_stats       [{"country":"UK","user_count":2592},...
--     content-range: 0-0/25000        <- the API advertises the full count
--
-- The same probe confirms the real business tables are correctly closed:
-- `projects`, `people` and `app_user_profile` all return an empty set to an
-- anonymous caller. So RLS is working everywhere it was actually configured;
-- this one table was configured to be open on purpose, for a demo, and the
-- purpose is long gone.
--
-- Whether these are real people or synthetic rows, publishing a table of names
-- with ages and countries from a company database is not a defensible posture,
-- and "it is only test data" is exactly the sentence that precedes a breach
-- notification. PRODUCT.md commits this project to EU data residency and "no
-- PII in logs or error messages"; an anonymously-readable person table is a
-- louder version of the same mistake.
--
-- WHY DROP RATHER THAN LOCK DOWN
-- ------------------------------
-- Tightening the policy would leave 2.8 MB of irrelevant data in the production
-- `public` schema, still visible in every schema listing, still typed into
-- `database.types.ts`, and still one careless policy edit away from being
-- public again. Nothing in `src/` references any of these objects -- the app
-- does not read them, so removing them cannot break a page.
--
-- The drop is ordered views-then-table and uses IF EXISTS throughout, so
-- re-running it on a database where it has already been applied is a no-op
-- rather than an error.
-- ============================================================================

drop view if exists public.netflix_overview;
drop view if exists public.netflix_country_stats;
drop view if exists public.netflix_genre_stats;
drop view if exists public.netflix_subscription_stats;

-- The policy goes with the table, but drop it explicitly first so that a
-- partially-applied run cannot leave an open policy behind on a surviving table.
drop policy if exists "Allow anon read access to netflix_users" on public.netflix_users;

drop table if exists public.netflix_users;
