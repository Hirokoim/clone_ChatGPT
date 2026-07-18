// 第8章: トークンあふれ — コンテキストには上限がある
//
// 正確なトークン数を数えるには専用のトークナイザが必要だが、ここでは
// 「上限に近づいているかどうか」をざっくり把握できれば十分なので、
// 文字数からの概算で済ませる。日本語混じりの文章は英語主体の見積もりより
// トークン数が多くなりやすいため、安全側(過大)に倒して見積もる。

export type ChatMessage = { role: string; content: string };

const ESTIMATED_TOKENS_PER_CHAR = 1.5; // 1文字あたりの概算トークン数(日本語混じりを想定し多めに設定)
const PER_MESSAGE_OVERHEAD_TOKENS = 4; // role等のメタ情報にかかる概算オーバーヘッド(発言1件ごと)
const WARNING_RATIO = 0.8; // 上限の何割に達したら「近づいている」と判定するか

// 会話全体(messages配列)のトークン数をざっくり見積もる。
export function estimateTokenCount(messages: ChatMessage[]): number {
  let total = 0; // 合計トークン数の積み上げ用
  for (const message of messages) {
    const contentTokens = Math.ceil(message.content.length * ESTIMATED_TOKENS_PER_CHAR); // 本文の文字数からトークン数を概算(多めに)
    total += contentTokens + PER_MESSAGE_OVERHEAD_TOKENS; // 本文分 + メタ情報オーバーヘッドを加算
  }
  return total; // 会話全体の概算トークン数を返す
}

// 概算トークン数が上限に近づいている(警告ライン以上)かどうかを判定する。
export function isNearTokenLimit(messages: ChatMessage[], limit: number): boolean {
  const estimated = estimateTokenCount(messages); // 現在の概算トークン数
  const warningLine = limit * WARNING_RATIO; // 警告を出す境界(上限のWARNING_RATIO倍)
  return estimated >= warningLine; // 境界に達していればtrue
}
