import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT ?? 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  res.json({ reply: completion.choices[0].message });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
