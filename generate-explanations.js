const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'data.json');
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('Brak zmiennej ANTHROPIC_API_KEY');
  process.exit(1);
}

const client = new Anthropic({ apiKey: API_KEY });

function buildPrompt(question) {
  const choices = Array.isArray(question.choices) && question.choices.length
    ? question.choices
        .map(c => `  ${c.label ? c.label + '. ' : ''}${c.text ?? c.raw ?? ''} ${c.is_correct ? '✓ (correct)' : ''}`)
        .join('\n')
    : '  (no choices available)';

  return `You are an AI-900 Microsoft Azure AI Fundamentals exam expert. Write a clear, concise explanation for the following exam question.

The explanation should:
- Explain WHY the correct answer is correct
- Briefly clarify why other options are wrong (if applicable)
- Reference the relevant Azure AI service or concept
- Be 3-6 sentences long
- End with 1-2 relevant Microsoft Learn documentation URLs (use real, accurate URLs from learn.microsoft.com)

Question: ${question.question_text || '(see HTML)'}

Answer choices:
${choices}

Respond with ONLY the explanation text (no labels, no JSON, no markdown headers). Start directly with the explanation.`;
}

async function generateExplanation(question) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [
      { role: 'user', content: buildPrompt(question) }
    ]
  });

  return message.content[0].type === 'text' ? message.content[0].text.trim() : '';
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Wczytywanie data.json…');
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const questions = data.questions;

  const missing = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => !q.explanation_en || q.explanation_en.trim() === '');

  console.log(`Pytania bez explanation_en: ${missing.length}`);

  let done = 0;
  let errors = 0;

  for (const { q, i } of missing) {
    const label = `Q${q.question_number ?? i + 1}`;
    try {
      const explanation = await generateExplanation(q);
      questions[i].explanation_en = explanation;
      done++;
      console.log(`[${done}/${missing.length}] ${label} ✓`);

      // Zapisuj co 10 pytań
      if (done % 10 === 0) {
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
        console.log(`  → Zapisano postęp (${done} pytań)`);
      }

      // Krótka przerwa żeby nie przekroczyć rate limitu
      await sleep(300);
    } catch (err) {
      errors++;
      console.error(`[BŁĄD] ${label}: ${err.message}`);
      // Przy błędzie rate limit — czekaj dłużej
      if (err.status === 429) {
        console.log('Rate limit — czekam 10s…');
        await sleep(10000);
      }
    }
  }

  // Końcowy zapis
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nGotowe! Wygenerowano: ${done}, błędów: ${errors}`);
}

main().catch(err => {
  console.error('Krytyczny błąd:', err);
  process.exit(1);
});
