# Management Dashboard: development read mode

The management dashboard has two deliberately separate data-access paths:

| Environment | Identity | Read access |
| --- | --- | --- |
| Development | `DEV_USER` validated by the `hse_dev_auth` cookie | Server-only management read client using the configured service-role key |
| Production | Supabase Auth session | Existing cookie-bound Supabase client with RLS |

The development path exists because the local development identity is not a
Supabase Auth session and therefore cannot satisfy production RLS policies. It
is selected only when `NODE_ENV === "development"` and the existing development
cookie is valid. The service-role client is imported through `server-only` code
and is never passed to a Client Component or exposed to the browser.

The management models remain read-only. No migrations, RLS changes, user-table
changes, or write operations are part of this mode. The production path is not
changed.

The read client covers these server-side management models:

- `management-contract-hours`
- `management-service-overview`
- `management-employee-ownership`
- `management-data-quality`
- `management-project-risks`
- `management-multi-service-matrix`
- `management-customer-portfolio`
