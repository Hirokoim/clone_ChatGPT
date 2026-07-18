import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { estimateTokenCount, isNearTokenLimit } from "./tokenEstimate";

const app = express();
const port = process.env.PORT ?? 3000;
const DAILY_MESSAGE_LIMIT = 20;
const MODEL_CONTEXT_WINDOW = 128000; // gpt-4o-miniのコンテキスト上限(トークン数)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// service_role keyはRLSを無視できる強い権限。サーバー側だけで使い、ブラウザには絶対渡さない。
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

app.use(express.json());
app.use(express.static("public"));

// SupabaseのURLとanon keyはブラウザに公開してよい値(RLSで保護される)。
// .envから読み込んで、ブラウザに渡すためのエンドポイント。
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ブラウザが送ってきたSupabaseのアクセストークンから「誰か」を確認する。
async function getAuthenticatedUserId(req: express.Request): Promise<string | null> {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace("Bearer ", "");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return null;
  return userData.user.id;
}

async function getTodayUsageCount(userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRow } = await supabaseAdmin
    .from("usage")
    .select("message_count")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .maybeSingle();

  return usageRow?.message_count ?? 0;
}

app.get("/api/usage", async (req, res) => {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "ログインが必要です。" });
    return;
  }

  const count = await getTodayUsageCount(userId);
  res.json({ count, limit: DAILY_MESSAGE_LIMIT });
});

app.post("/api/chat", async (req, res) => {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "ログインが必要です。" });
    return;
  }

  // 【守り②】今日すでに何回使ったかを確認し、上限を超えていたら429で断る。
  const currentCount = await getTodayUsageCount(userId);
  if (currentCount >= DAILY_MESSAGE_LIMIT) {
    res.status(429).json({ error: "本日の利用回数の上限に達しました。また明日お試しください。" });
    return;
  }

  const { messages } = req.body;

  // 第8章: 送る前に、会話全体のトークン数をざっくり見積もっておく。
  const estimatedTokens = estimateTokenCount(messages);
  const nearLimit = isNearTokenLimit(messages, MODEL_CONTEXT_WINDOW);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  // 使用回数を+1する(なければ1件目として作成)。
  const today = new Date().toISOString().slice(0, 10);
  const { error: upsertError } = await supabaseAdmin
    .from("usage")
    .upsert(
      { user_id: userId, usage_date: today, message_count: currentCount + 1 },
      { onConflict: "user_id,usage_date" }
    );
  if (upsertError) console.error("usage upsert failed:", upsertError);

  res.json({
    reply: completion.choices[0].message,
    estimatedTokens,
    nearLimit,
  });
});

// 第9章: 直近10件から外れた古い発言を、要約に追加で組み込む。
// 「前回までの要約」+「今回新たに外れた分の発言」だけをAIに渡し、要約を更新させる。
app.post("/api/summarize", async (req, res) => {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "ログインが必要です。" });
    return;
  }

  const { previousSummary, messagesToFold } = req.body;

  const foldedText = messagesToFold
    .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "あなたは会話ログを要約するアシスタントです。固有名詞(人名・地名・作品名など)や" +
          "決定事項(合意した内容・約束・結論)は省略せず残し、簡潔にまとめてください。",
      },
      {
        role: "user",
        content:
          `これまでの要約:\n${previousSummary || "(まだ要約はありません)"}\n\n` +
          `新たに要約に組み込む会話:\n${foldedText}\n\n` +
          "上記を踏まえて、これまでの要約を更新してください。",
      },
    ],
  });

  res.json({ summary: completion.choices[0].message.content });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
