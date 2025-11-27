import express from "express";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
app.use(express.json());

let telnyxMediaWs = null;
let openAiWs = null;
let openAiReady = false;

// ------------------------------
// 1. TELNYX CALL CONTROL WEBHOOK
// ------------------------------
app.post("/telnyx", (req, res) => {
  const event = req.body.data;

  console.log("Telnyx Event:", event?.event_type);

  if (!event) return res.sendStatus(200);

  const payload = event.payload;
  const callControlId = payload?.call_control_id;

  switch (event.event_type) {
    case "call.initiated":
      console.log("Incoming call");
      return res.sendStatus(200);

    case "call.answered":
      console.log("Call answered");

      // Tell Telnyx to start media streaming
      return res.json([
        {
          call_control_id: callControlId,
          command: "stream_start",
          stream_url: `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/telnyx-media`
        }
      ]);
  }

  res.sendStatus(200);
});

// ------------------------------
// 2. WEBSOCKET UPGRADE FOR TELNYX MEDIA
// ------------------------------
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on port", process.env.PORT || 3000)
);

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/telnyx-media") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log("Telnyx media WebSocket connected");
      telnyxMediaWs = ws;

      connectToOpenAi();

      ws.on("message", (msg) => handleTelnyxAudio(msg));
      ws.on("close", () => {
        console.log("Telnyx media closed");
        telnyxMediaWs = null;
        cleanupOpenAi();
      });
    });
  }
});

// ------------------------------
// 3. SEND TELNYX AUDIO TO OPENAI
// ------------------------------
function handleTelnyxAudio(message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch {
    return;
  }

  const base64Audio = data?.payload?.media?.payload;
  if (!base64Audio) return;

  if (openAiReady) {
    openAiWs.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: base64Audio
      })
    );
  }
}

// ------------------------------
// 4. CONNECT TO OPENAI REALTIME
// ------------------------------
function connectToOpenAi() {
  const url = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`;

  openAiWs = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  openAiWs.on("open", () => {
    console.log("Connected to OpenAI Realtime");
    openAiReady = true;

    openAiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: `
Speak like a real human on the phone. Use 'uh', 'um', restarts, hesitations, imperfect grammar, short sentences, natural pauses.
          `,
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          modalities: ["audio", "text"]
        }
      })
    );

    openAiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: "Say hello naturally like a real person."
        }
      })
    );
  });

  openAiWs.on("message", (msg) => handleOpenAiAudio(msg));
  openAiWs.on("close", () => (openAiReady = false));
}

function cleanupOpenAi() {
  if (openAiWs) openAiWs.close();
  openAiReady = false;
}

// ------------------------------
// 5. SEND OPENAI AUDIO BACK TO TELNYX
// ------------------------------
function handleOpenAiAudio(message) {
  const data = JSON.parse(message);
  if (data.type !== "response.audio.delta") return;

  if (telnyxMediaWs?.readyState === WebSocket.OPEN) {
    telnyxMediaWs.send(
      JSON.stringify({
        payload: {
          type: "media",
          media: {
            payload: data.audio
          }
        }
      })
    );
  }
}