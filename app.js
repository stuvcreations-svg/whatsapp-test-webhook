const express = require('express');
const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const waToken = process.env.WA_TOKEN;
const waPhoneId = process.env.WA_PHONE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;

// In-memory conversation history keyed by phone number
const conversations = new Map();

const ROOFING_INTAKE_PROMPT = `
You are an expert, professional intake assistant for a roofing contractor business.
Your goal is to collect the essential details needed to build an accurate roof estimate.

Required Information to Collect:
1. Property Address (street, city, zip)
2. Scope of Work (full tear-off replacement, leak/repair, or new construction)
3. Existing Roof Material (shingles, tile, metal, flat/mod-bit)
4. Desired New Roof Material (architectural shingles, standing seam metal, tile, flat roof coating)
5. Stories / Building Height (1-story, 2-story, etc.)
6. Known Leaks or Decking Damage (interior water spots, rotted plywood)
7. Insurance Claim or Retail/Cash
8. Desired Timeline (emergency, within 2 weeks, within a month)
9. Client Name & Best Email for the formal quote

Conversation Guidelines:
- Ask only ONE question at a time.
- If the user provides multiple pieces of information in one message (e.g., "Need an asphalt shingle replacement at 104 Main St"), acknowledge what they gave and smoothly ask for the next missing item.
- Keep messages short, professional, and readable on WhatsApp (use bullet points or emojis sparingly).
- Once all 9 items are gathered, output a clean, formatted summary of the job specs and confirm that the estimating team will review satellite/aerial data and reach out with the quote.
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

// Incoming Webhook Events (POST)
app.post('/', async (req, res) => {
  console.log('>>> WEBHOOK RECEIVED PAYLOAD <<<');
  res.status(200).send('EVENT_RECEIVED');

  const value = req.body.entry?.[0]?.changes?.[0]?.value || req.body.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text') {
    return;
  }

  const senderPhone = message.from;
  const incomingText = message.text.body;

  console.log(`From: ${senderPhone} | Message: ${incomingText}`);

  // Retrieve or initialize conversation history for this sender
  if (!conversations.has(senderPhone)) {
    conversations.set(senderPhone, []);
  }
  const history = conversations.get(senderPhone);

  // Append user message
  history.push({
    role: 'user',
    parts: [{ text: incomingText }]
  });

  // Keep history manageable (last 16 messages / 8 turns)
  if (history.length > 16) {
    history.splice(0, history.length - 16);
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    
    const aiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: ROOFING_INTAKE_PROMPT }] },
        contents: history
      })
    });

    const aiData = await aiResponse.json();
    const replyText =
      aiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Thanks for reaching out! Could you share the property address for your roofing project?';

    // Store bot reply in memory
    history.push({
      role: 'model',
      parts: [{ text: replyText }]
    });

    console.log(`Gemini Reply: ${replyText}`);

    // Send reply back via WhatsApp Cloud API
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
    console.log('WhatsApp send result:', waData);
  } catch (err) {
    console.error('Processing error:', err);
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
