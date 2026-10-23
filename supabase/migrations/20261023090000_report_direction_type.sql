-- A new enum value cannot be used in the transaction that adds it, so this is its
-- own migration. See 20261023090100_public_reports.sql for what uses it.
alter type public.report_type add value if not exists 'incorrect_direction';
