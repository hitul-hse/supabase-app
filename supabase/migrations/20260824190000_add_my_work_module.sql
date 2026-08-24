-- Put My Work on the portal.
--
-- WHY THIS IS A DATA CHANGE AND NOT A DEPLOY
-- ------------------------------------------
-- /portal does not hard-code its tiles. It renders whatever `app_user_modules()`
-- returns, which is `app_module` filtered to rows whose `module_key` matches a
-- permission the caller's role holds. So adding a tile is an INSERT, and who
-- sees it is decided by the existing permission grants rather than by new code.
--
-- module_key = 'my_work', WITH ITS OWN PERMISSION
-- -----------------------------------------------
-- `module_key` is the primary key of app_module, so the tile cannot reuse
-- 'projects' -- that row is Project Management. It needs its own key, and
-- therefore its own permission, because app_user_modules() joins
-- app_permission.module_key to app_module.module_key: a module with no matching
-- permission is invisible to EVERY role including exec, which is the single
-- most likely way this change fails silently.
--
-- So this migration adds one permission (`my_work:read_own`) and grants it to
-- every role that already holds `people:read_own`.
--
-- `people:read_own` and NOT `projects:read_own`, which was the first attempt and
-- was wrong: measured on live, hr holds people:read_own but NOT
-- projects:read_own, so deriving from projects left HR unable to see the tile at
-- all. HR has a book of work like anybody else. people:read_own is the one
-- permission all five roles hold -- "you may see your own record" is the
-- closest existing statement to "you are a person here", which is the only
-- precondition this page has.
--
-- Derived from an existing grant rather than a hard-coded role list so a role
-- added later is not silently left without the tile -- the same failure this
-- caught on the first run.
--
-- SORT ORDER 15, i.e. BETWEEN Hub (10) AND Project Management (20)
-- ---------------------------------------------------------------
-- The portal is read top-left first. For a consultant, "my customers and
-- projects" is the reason they opened the Hub at all; the company-wide
-- portfolio is context they consult afterwards. Putting it after Project
-- Management would bury the personal view under the organisational one.
--
-- ACCENT
-- ------
-- #91C2B7 is --accent, the brand mint, deliberately shared with the Hub tile
-- rather than given a new hue: this is a Hub surface, not a separate product,
-- and a fifth colour on a five-tile portal turns a palette into a swatch book.
--
-- Idempotent: re-running updates the row rather than duplicating it, so this is
-- safe to apply to an environment that already has the tile.

insert into public.app_module
  (module_key, display_name, tagline, href, accent, is_live, sort_order)
values
  ('my_work', 'My Work', 'Your customers, projects and assignments', '/my-work', '#91C2B7', true, 15)
on conflict (module_key) do update set
  display_name = excluded.display_name,
  tagline      = excluded.tagline,
  href         = excluded.href,
  accent       = excluded.accent,
  is_live      = excluded.is_live,
  sort_order   = excluded.sort_order;

-- The permission that makes the tile visible. Without a row here whose
-- module_key is 'my_work', app_user_modules() returns nothing for this module
-- and the tile never renders for anybody.
--
-- It is a real permission rather than a formality: it appears in the Role
-- Permissions admin screen, so "why can this person see that" has an answer in
-- app_role_permission rather than in a code comment.

insert into public.app_permission
  (permission_key, display_name, resource, action, description, module_key, sort_order)
values
  ('my_work:read_own', 'See your own book of work', 'my_work', 'read_own',
   'View the customers and projects you own or are assigned to.', 'my_work', 10)
on conflict (permission_key) do update set
  display_name = excluded.display_name,
  description  = excluded.description,
  module_key   = excluded.module_key;

-- Granted to every role that can already see its own person record.
insert into public.app_role_permission (role_key, permission_key)
select rp.role_key, 'my_work:read_own'
from public.app_role_permission rp
where rp.permission_key = 'people:read_own'
on conflict do nothing;

-- Verify:
--   select role_key from app_role_permission where permission_key='my_work:read_own';
--   -- expect all five roles
--   select * from app_module where module_key='my_work';
