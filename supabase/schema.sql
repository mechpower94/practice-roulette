-- '오늘 뭐 먹지?' 점심 룰렛 DB 스키마 (여러 번 실행해도 안전)

create table if not exists public.votes (
  id         bigint generated always as identity primary key,
  menu       text not null check (char_length(menu) between 1 and 20),
  team       text not null default '전체' check (char_length(team) between 1 and 20),
  created_at timestamptz not null default now()
);
create index if not exists votes_team_created_idx on public.votes (team, created_at desc);

-- 서비스 마감 시각 (anon 에게는 보이지 않음)
create table if not exists public.app_config (
  id         int primary key default 1 check (id = 1),
  expires_at timestamptz not null
);

alter table public.votes      enable row level security;
alter table public.app_config enable row level security;

create or replace function public.service_open()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select now() < expires_at from public.app_config where id = 1), false);
$$;

-- 무료 한도 보호: 10초에 60표 이상 몰리면 거절 (도배 방지)
create or replace function public.votes_rate_limit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.votes where created_at > now() - interval '10 seconds') >= 60 then
    raise exception 'too many votes, slow down';
  end if;
  return new;
end;
$$;
drop trigger if exists votes_rate_limit on public.votes;
create trigger votes_rate_limit before insert on public.votes
  for each row execute function public.votes_rate_limit();

drop policy if exists "anyone can read" on public.votes;
create policy "anyone can read" on public.votes
  for select to anon using (true);

drop policy if exists "anyone can vote" on public.votes;
drop policy if exists "anyone can vote while open" on public.votes;
create policy "anyone can vote while open" on public.votes
  for insert to anon with check (public.service_open());

-- 오늘(한국 시간) 팀별 TOP 5 를 DB에서 집계해서 돌려줌 → 전송량 최소화
create or replace function public.top_menus(p_team text)
returns table (menu text, votes bigint, total bigint)
language sql stable security invoker
set search_path = public
as $$
  select v.menu, count(*) as votes, sum(count(*)) over ()::bigint as total
  from public.votes v
  where v.team = p_team
    and v.created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
  group by v.menu
  order by votes desc, max(v.created_at) desc
  limit 5;
$$;

revoke all on public.app_config from anon, authenticated;
revoke update, delete, truncate on public.votes from anon, authenticated;
grant select, insert on public.votes to anon;
grant execute on function public.top_menus(text) to anon;
grant execute on function public.service_open() to anon;

notify pgrst, 'reload schema';
