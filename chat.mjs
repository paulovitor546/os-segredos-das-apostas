// Netlify Function: mantém a chave da OpenAI no servidor.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requests = new Map();

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido." }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "O chat ainda não foi ativado. Falta configurar OPENAI_API_KEY nas variáveis do Netlify."
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const ip = req.headers.get("x-nf-client-connection-ip") || "unknown";
  const now = Date.now();
  const entry = requests.get(ip) || { start: now, count: 0 };
  if (now - entry.start > WINDOW_MS) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  requests.set(ip, entry);
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return new Response(JSON.stringify({ error: "Muitas mensagens em pouco tempo. Aguarde um minuto." }), {
      status: 429, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json();
    const incoming = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const messages = incoming
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return new Response(JSON.stringify({ error: "Envie uma pergunta para começar." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.4,
        max_tokens: 550,
        messages: [
          {
            role: "system",
            content: "Você é o Segredos IA, assistente do site Os Segredos das Casas de Apostas. Responda em português brasileiro, com clareza e concisão. Ajude a entender odds decimais, probabilidades implícitas, handicaps, mercados e arbitragem matemática. Explique que uma surebet teórica não é lucro garantido: odds podem mudar, apostas podem ser recusadas, limites, taxas, câmbio e regras de liquidação podem eliminar a margem. Nunca invente odds, jogos, disponibilidade ou resultados ao vivo; diga quando não tiver dados em tempo real. Não incentive perseguir perdas, endividamento ou apostas compulsivas. Não peça senhas, códigos, documentos nem dados bancários. Para contas, pagamentos ou problemas com casas, recomende suporte oficial. Não prometa ganhos."
          },
          ...messages
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = upstream.status === 401
        ? "A chave da API foi recusada. Confira OPENAI_API_KEY no Netlify."
        : "O serviço de IA está indisponível no momento. Tente novamente.";
      return new Response(JSON.stringify({ error: message }), {
        status: upstream.status === 429 ? 429 : 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("Resposta vazia da IA.");
    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Não consegui processar a mensagem. Tente novamente." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};
