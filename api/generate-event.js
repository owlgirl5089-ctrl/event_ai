function extractJson(text) {
  if (!text) return null;

  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');

  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'POST 요청만 가능합니다.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.'
    });
  }

  const body = req.body || {};

  const {
    eventPurpose,
    memberCount,
    activeTime,
    vibe,
    operationTime,
    extra,
    retryCount,
    avoidTitle,
  } = body;

  const prompt = `
당신은 디스코드 서버 운영진을 위한 이벤트 기획 전문가입니다.
아래 조건에 맞는 이벤트 아이디어 1개를 추천해주세요.

[입력 정보]
- 이벤트 목적: ${eventPurpose || '미입력'}
- 서버 인원수: 약 ${memberCount || '미입력'}명
- 주 활동 시간대: ${activeTime || '미입력'}
- 원하는 분위기: ${vibe || '미입력'}
- 운영진이 쓸 수 있는 시간: ${operationTime || '30분 정도'}
${extra ? `- 추가 요청사항: ${extra}` : ''}
${retryCount ? `- 다시 추천 요청: 이전 추천과 다른 새 이벤트를 제안하세요.` : ''}
${avoidTitle ? `- 피해야 할 이전 이벤트 제목: ${avoidTitle}` : ''}

반드시 아래 JSON 객체만 반환하세요.
설명 문장, 마크다운, 코드블록은 절대 쓰지 마세요.

{
  "title": "이벤트 제목",
  "reason": "추천 이유",
  "preparation": "준비물",
  "steps": ["단계1", "단계2", "단계3"],
  "duration": "소요 시간",
  "notice": "공지문",
  "engagementTips": "참여 유도 멘트",
  "caution": "주의사항"
}
`.trim();

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: retryCount ? 1.0 : 0.85,
            maxOutputTokens: 1400,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const raw = await geminiRes.text();

    if (!geminiRes.ok) {
      console.error('Gemini API error:', raw);

      return res.status(502).json({
        error: 'Gemini API 호출에 실패했습니다.',
        detail: raw.slice(0, 300),
      });
    }

    let geminiJson;

    try {
      geminiJson = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: 'Gemini 응답을 읽지 못했습니다.',
      });
    }

    const text =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const eventData = extractJson(text);

    if (!eventData) {
      return res.status(502).json({
        error: 'Gemini 응답 JSON 파싱 실패',
        text,
      });
    }

    return res.status(200).json({
      event: eventData,
      text,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: '서버 내부 오류가 발생했습니다.',
    });
  }
};
