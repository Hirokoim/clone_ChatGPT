-- 第5章: 会話ログと複数セッション
-- conversations: 1つの会話(セッション)を表す
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新しい会話',
  created_at timestamptz not null default now()
);

-- messages: 会話に紐づく1つ1つの発言
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- RLSを有効化(すでにプロジェクト作成時にONにしてあるはずですが念のため)
alter table conversations enable row level security;
alter table messages enable row level security;

-- 自分の会話だけ読み書きできるポリシー
create policy "select own conversations"
  on conversations for select
  using (auth.uid() = user_id);

create policy "insert own conversations"
  on conversations for insert
  with check (auth.uid() = user_id);

create policy "update own conversations"
  on conversations for update
  using (auth.uid() = user_id);

create policy "delete own conversations"
  on conversations for delete
  using (auth.uid() = user_id);

-- messagesは「自分の会話に属するメッセージ」だけ読み書きできる
create policy "select own messages"
  on messages for select
  using (
    exists (
      select 1 from conversations
      where conversations.id = messages.conversation_id
      and conversations.user_id = auth.uid()
    )
  );

create policy "insert own messages"
  on messages for insert
  with check (
    exists (
      select 1 from conversations
      where conversations.id = messages.conversation_id
      and conversations.user_id = auth.uid()
    )
  );

-- 「Automatically expose new tables」をOFFにしたため、Data API(PostgREST)への
-- 基本アクセス権限(GRANT)がまだない。RLSとは別に、ログイン済みユーザー(authenticated)に
-- テーブルそのものへの権限を与える。実際に何が許可されるかはRLSポリシーが絞り込む。
grant select, insert, update, delete on conversations to authenticated;
grant select, insert on messages to authenticated;

-- 第6章: 使いすぎを防ぐ(認証ユーザーごとの上限)
-- ユーザーごと・日付ごとに、その日送ったメッセージ数を記録する。
-- このテーブルはサーバー(service_role key)からのみ読み書きする想定なので、
-- RLSは有効にしておくが、authenticatedロールへのGRANT/ポリシーは作らない
-- (ブラウザから直接触らせない = service_roleだけがRLSをバイパスして操作できる)。
create table usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  message_count int not null default 0,
  primary key (user_id, usage_date)
);

alter table usage enable row level security;

-- service_roleはRLSこそバイパスできるが、テーブルそのものへのGRANTは別途必要。
-- 「Automatically expose new tables」をOFFにしているため、service_roleにも
-- 明示的に権限を与えないと "permission denied for table usage" になる。
grant select, insert, update on usage to service_role;
