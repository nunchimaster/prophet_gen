export const runtime = "nodejs";
export const maxDuration = 60; // 초 (Vercel/호스트에 따라 상한 다름)

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json(
      { error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 를 확인하세요." },
      { status: 500 }
    );
  }

  // 선택적 접근 암호 게이트
  const demoPass = process.env.DEMO_PASSWORD;
  if (demoPass) {
    const provided = req.headers.get("x-demo-key") || "";
    if (provided !== demoPass) {
      return Response.json({ error: "접근 암호가 올바르지 않습니다." }, { status: 401 });
    }
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { system, content, max_tokens } = body || {};
  if (!system || !content) {
    return Response.json({ error: "system/content 누락" }, { status: 400 });
  }

  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: max_tokens || 2000,
        system,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return Response.json(
        { error: data?.error?.message || `Anthropic API 오류 (${r.status})` },
        { status: r.status }
      );
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: "분석 호출 실패: " + (e.message || String(e)) }, { status: 502 });
  }
}
