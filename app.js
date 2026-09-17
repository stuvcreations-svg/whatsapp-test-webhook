const express = require('express');
const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const waToken = process.env.WA_TOKEN;
const waPhoneId = process.env.WA_PHONE_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;

// Store state per phone number in memory
// Schema: { currentStep: number, data: Object, isComplete: boolean }
const userSessions = new Map();

const DEFAULT_STATE = {
  property_address: null,
  scope_of_work: null, // full tear-off, repair, new construction
  existing_roof_material: null, // shingle, tile, metal, flat
  desired_new_material: null,
  building_stories: null, // 1-story, 2-story
  active_leaks_or_decking_damage: null,
  insurance_or_retail: null,
  timeline: null,
  client_name: null
};

const PROTOCOL_INSTRUCTIONS = `
You are an AI intake coordinator for a professional roofing contractor.
Your objective is to guide the user through a strict, sequential intake protocol.

Protocol Sequence:
1. property_address: Street address, city, and zip.
2. scope_of_work: Full tear-off replacement, leak repair, or new construction.
3. existing_roof_material: Current material (shingles, tile, metal, flat/mod-bit).
4. desired_new_material: Material to install (architectural shingles, metal, tile, coating).
5. building_stories: Height/stories (1-story, 2-story, etc.).
6. active_leaks_or_decking_damage: Any current leaks or damaged wood/plywood.
7. insurance_or_retail: Insurance claim or direct retail/cash quote.
8. timeline: Preferred timeline (immediate emergency, 2-4 weeks, flexible).
9. client_name: Name and best contact info for the proposal.

Rules:
- You must output VALID JSON only, following the exact schema provided.
- Inspect the user's message and update "collected_data" with any provided details. If they provide multiple fields at once, extract all of them.
- Look at the first field in the protocol sequence that remains null. That determines the next question.
- "customer_reply": Ask ONLY ONE concise, professional question for that missing item. Do not combine multiple questions.
- If the user asks an off-topic question, briefly redirect them back to the current protocol question in "customer_reply".
- When all 9 items are filled, set "is_complete": true. Set "customer_reply" to a crisp bulleted summary of the project details, stating that an estimator will review aerial imagery and provide the quote.
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

// Incoming Webhook (POST)
app.post('/', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  const value = req.body.entry?.[0]?.changes?.[0]?.value || req.body.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text') {
    return;
  }

  const senderPhone = message.from;
  const incomingText = message.text.body;

  console.log(`\n--- Incoming from ${senderPhone}: "${incomingText}" ---`);

  // Initialize session state if first-time sender
  if (!userSessions.has(senderPhone)) {
    userSessions.set(senderPhone, {
      data: { ...DEFAULT_STATE },
      isComplete: false
    });
  }

  const session = userSessions.get(senderPhone);

  // If already finished, acknowledge and stop re-prompting
  if (session.isComplete) {
    await sendWhatsAppMessage(
      senderPhone,
      "We already have your intake details on file! A roofing specialist will reach out shortly. If you need immediate assistance, please give our office a call."
    );
    return;
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiApiKey}`;

    const promptPayload = {
      system_instruction: {
        parts: [{ text: PROTOCOL_INSTRUCTIONS }]
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                current_state: session.data,
                user_message: incomingText
              })
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1 // Low temperature ensures strict compliance
      }
    };

    const aiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promptPayload)
    });

    const aiData = await aiResponse.json();
    const rawAiOutput = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawAiOutput) {
      console.error('Gemini error response:', JSON.stringify(aiData));
      return;
    }

    const parsed = JSON.parse(rawAiOutput);
    console.log('Structured Extraction:', parsed.collected_data);

    // Save updated state back into memory
    session.data = { ...session.data, ...parsed.collected_data };
    session.isComplete = Boolean(parsed.is_complete);

    // Send the structured conversational reply to WhatsApp
    await sendWhatsAppMessage(senderPhone, parsed.customer_reply);

  } catch (err) {
    console.error('Processing failure:', err);
  }
});

// Outgoing WhatsApp sender
async function sendWhatsAppMessage(to, text) {
  try {
    const waResponse = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${waToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text }
      })
    });

    const resData = await waResponse.json();
    console.log('WhatsApp Delivery Status:', resData.messages ? 'Sent' : resData);
  } catch (error) {
    console.error('WhatsApp dispatch error:', error);
  }
}

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
