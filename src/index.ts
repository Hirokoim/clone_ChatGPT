import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT ?? 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(express.static("public"));

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
