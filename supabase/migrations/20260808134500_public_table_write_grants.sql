-- Customer and admin mutations are handled by authenticated server routes and
-- tightly scoped service-role RPCs. RLS already denies direct writes, but
-- removing the underlying client grants provides a second independent fence.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

revoke usage, select, update
  on all sequences in schema public
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select, update
  on sequences
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute
  on functions
  from public;
