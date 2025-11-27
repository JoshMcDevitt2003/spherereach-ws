import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Store websocket connection to Twilio
let twilioWs = null;

/**
 * Twilio will POST here when the call begins.
 * This tells Twilio to start a <Stream> to our WebSocket endpoint.
 */
app.post("/answer", (req, res) => {
  console.log("Twilio hit /answer");

  const twiml = `
    <Response>
      <Start>
        <Stream url="wss://${process.env.RAILWAY_PUBLIC_DOMAIN}/stream" />
      </Start>
      <Say voice="Polly.Joanna">Connecting you now.</Say>
    </Response>
  `;

  res.type("text/xml");
  res.send(twiml);
});

// Twilio will POST call status events here (not required but healthy)
app.post("/event", (req, res) => {
  res.sendStatus(200);
});

/**
 * Create WebSocket server (for Twilio)
 */
const wss = new WebSocketServer({ noServer: true });

/**
 * Start HTTP server
 */
const server = app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on port 3000")
);

/**
 * Handle WebSocket upgrade to /stream
 */
server.on("upgrade", (request, socket, head) => {
  if (request.url === "/stream") {
    console.log("WS upgrade request for /stream");

    wss.handleUpgrade(request, socket, head, (ws) => {
      twilioWs = ws;
      console.log("Twilio WebSocket connected");

      ws.on("message", handleIncomingAudio);
      ws.on("close", () => console.log("Twilio WebSocket disconnected"));
    });
  }
});

/**
 * Handles ONLY audio frames from Twilio.
 * All other events are safely ignored.
 */
async function handleIncomingAudio(message) {
  try {
    const data = JSON.parse(message);

    // Ignore non-audio events ("start", "connected", "mark", "stop")
    if (data.event !== "media") {
      return;
    }

    const base64Audio = data.media.payload;

    // If audio frame is empty, skip
    if (!base64Audio) return;

    // Send to Lambda
    let response;
    try {
      response = await axios.post(process.env.LAMBDA_URL, {
        audio: base64Audio,
      });
    } catch (err) {
      console.error("Lambda request error:", err.response?.status, err.message);
      return;
    }

    const audioToPlay = response.data?.audio;

    if (!audioToPlay) {
      console.log("Lambda returned no audio");
      return;
    }

    // Frame structure required by Twilio
    const frame = JSON.stringify({
      event: "media",
      media: { payload: audioToPlay },
    });

    // Send audio back to Twilio stream
    if (twilioWs?.readyState === WebSocket.OPEN) {
      twilioWs.send(frame);
    }
  } catch (err) {
    console.error("Error in handleIncomingAudio:", err.message);
  }
}
