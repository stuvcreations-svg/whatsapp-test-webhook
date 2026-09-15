const express = require('express');
const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const waToken = process.env.WA_TOKEN;
const waPhoneId = process.env.WA_PHONE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;

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

// Meta Webhook Verification (GET)
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Incoming Message Receiver (POST)
app.post('/', async (req, res) => {
  console.log('>>> WEBHOOK RECEIVED PAYLOAD:');
  console.log(JSON.stringify(req.body, null, 2));

  // Meta requires an immediate 200 OK
  res.status(200).send('EVENT_RECEIVED');

  // Handle both Live WhatsApp payloads and Meta Test Button payloads
  const value = req.body.entry?.[0]?.changes?.[0]?.value || req.body.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text') {
    console.log('No text message found in payload.');
    return;
  }

  const senderPhone = message.from;
  const incomingText = message.text.body;

  console.log(`From: ${senderPhone} | Message: ${incomingText}`);

  try {
    // 1. Send text to Gemini
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    const aiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: INTAKE_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: incomingText }] }]
      })
    });

    const aiData = await aiResponse.json();
    const replyText =
      aiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Thank you! We received your message and will follow up shortly.';

    console.log(`Gemini Reply: ${replyText}`);

    // 2. Reply back to sender on WhatsApp
    const waResponse = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
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

    const waData = await waResponse.json();
    console.log('WhatsApp send response:', waData);
  } catch (err) {
    console.error('Processing error:', err);
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
