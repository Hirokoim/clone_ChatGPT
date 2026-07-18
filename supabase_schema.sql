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

-- 第7章: 順番が崩れるとき(中断・エラーとuser→assistantの交互)
-- 発言が「完成済み(done)」か「まだ途中(pending)」かの札を持たせる。
-- 送信中にブラウザが閉じられる等で中断されても、pendingのまま残った発言を
-- 次回の読み込み時に判別・除外できるようにする。
alter table messages
  add column status text not null default 'done' check (status in ('pending', 'done'));

-- authenticatedはstatusを更新できる必要がある(pending→done)ので、updateも許可する。
grant update on messages to authenticated;

-- 第9章: 溢れさせない(要約+ログのハイブリッド)
-- messages(全文ログ)はそのまま残しつつ、AIに毎回渡すのは
-- 「system設定 + これまでの要約 + 直近10件 + 今回の発言」だけに絞る。
-- summary: 古い会話をまとめた要約文。summarized_count: 何件目までを要約に
-- 組み込み済みか(次回、直近10件から外れた「差分」だけを追加要約するための目印)。
alter table conversations
  add column summary text not null default '',
  add column summarized_count int not null default 0;
