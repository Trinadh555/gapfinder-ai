-- 1. Documents and chunks
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  kind text not null check (kind in ('syllabus','notes','past_paper')),
  created_at timestamptz default now()
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  page int,
  content text not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored
);

alter table chunks add column if not exists seq int default 0;
create index if not exists chunks_fts_idx on chunks using gin (fts);

-- 2. Retrieval function
create or replace function search_chunks(q text, doc_ids uuid[], k int default 5)
returns table (id uuid, document_id uuid, page int, content text, rank real)
language sql stable as $$
  select c.id, c.document_id, c.page, c.content,
         ts_rank(c.fts, to_tsquery('english',
           replace(plainto_tsquery('english', q)::text, '&', '|'))) as rank
  from chunks c
  where c.document_id = any(doc_ids)
    and c.fts @@ to_tsquery('english',
           replace(plainto_tsquery('english', q)::text, '&', '|'))
  order by rank desc
  limit k;
$$;

-- 3. Topics, questions, attempts
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  syllabus_doc_id uuid references documents(id) on delete cascade,
  name text not null,
  subtopics jsonb default '[]',
  position int default 0,
  exam_count int default 0,
  exam_questions jsonb default '[]'
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references topics(id) on delete cascade,
  subtopic text,
  question text not null,
  options jsonb not null,
  correct_index int not null,
  option_explanations jsonb default '[]',
  source_chunk_id uuid references chunks(id) on delete set null,
  source_page int,
  source_doc_name text,
  created_at timestamptz default now()
);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  syllabus_doc_id uuid references documents(id) on delete cascade,
  user_id uuid,
  score_pct int,
  created_at timestamptz default now()
);

create table if not exists attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  chosen_index int,
  is_correct boolean
);

-- 4. Per-user document list (login)
drop function if exists list_documents();
drop function if exists list_documents(uuid);

create or replace function list_documents(p_user uuid)
returns table (id uuid, name text, kind text, created_at timestamptz, chunks bigint)
language sql stable as $$
  select d.id, d.name, d.kind, d.created_at, count(c.id) as chunks
  from documents d
  left join chunks c on c.document_id = d.id
  where d.user_id = p_user
  group by d.id
  order by d.created_at desc;
$$;

-- 5. Permissions for the server key
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 6. Row level security (server key bypasses it, browser keys get no access)
alter table documents enable row level security;
alter table chunks enable row level security;
alter table topics enable row level security;
alter table questions enable row level security;
alter table attempts enable row level security;
alter table attempt_answers enable row level security;

-- 7. Give any ownerless data to the demo user
update documents
  set user_id = (select id from auth.users where email = 'demo@gapfinder.ai')
  where user_id is null;

update attempts
  set user_id = (select id from auth.users where email = 'demo@gapfinder.ai')
  where user_id is null;