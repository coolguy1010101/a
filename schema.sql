-- Run once in Supabase: SQL Editor > New query > paste > Run

create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text unique not null,
  pass text not null,
  role text not null default 'user',      -- 'user' or 'mod'
  tag text,                               -- custom tag shown as [TAG] username
  tv int not null default 0,              -- bump to sign a user out everywhere
  ban_until timestamptz,
  ban_reason text,
  created_at timestamptz default now()
);

create table images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  descr text,
  path text not null,
  created_at timestamptz default now()
);

create table likes (
  image_id uuid references images(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  primary key (image_id, user_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references images(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

-- Lock tables to the server only (the API uses the service key, which bypasses RLS)
alter table users enable row level security;
alter table images enable row level security;
alter table likes enable row level security;
alter table comments enable row level security;

-- Public bucket for uploaded images (uploads happen only through the API)
insert into storage.buckets (id, name, public) values ('images', 'images', true);

-- After you register your own account, make yourself a moderator:
-- update users set role = 'mod', tag = 'MOD' where username = 'YOUR_USERNAME';
