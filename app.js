const express = require('express');
const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const waToken = process.env.WA_TOKEN;
const waPhoneId = process.env.WA_PHONE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;

// System prompt guiding the intake questionnaire
const INTAKE_PROMPT = `
You are a friendly intake assistant for custom project requests.
Your goal is to gather:
1. Client's name.
2. What they need built (type of project, dimensions, or specific materials).
3. Their desired deadline or timeline.

Rules:
- Ask only one question at a time.
- Keep responses short, clear, and helpful for WhatsApp.
- When all details are gathered, summarize the request and confirm that a specialist will be in touch.
`;

// Handle incoming messages
app.post('/', async (req, res) => {
  console.log('>>> INCOMING WEBHOOK HIT <<<');
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).end(); // Acknowledge Meta immediately

  const entry = req.body.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];

  if (!message || message.type !== 'text') return;

  const senderPhone = message.from;
  const incomingText = message.text.body;

  try {
    // 1. Send incoming text to Google Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    
    const aiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: INTAKE_PROMPT }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: incomingText }]
          }
        ]
      })
    });

    const aiData = await aiResponse.json();
    const replyText = aiData.candidates?.[0]?.content?.parts?.[0]?.text 
      || "Thank you for reaching out! We received your message and will get back to you shortly.";

    // 2. Post reply back to WhatsApp
    await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${waToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: senderPhone,
        type: 'text',
        text: { body: replyText }
      })
    });
  } catch (err) {
    console.error('Error handling webhook:', err);
  }
});
