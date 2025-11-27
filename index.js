import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

let twilioWs = null;

/**
 * Twilio hits this first when a call begins.
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

/**
 * WebSocket server (for Twilio Media Streams)
 */
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on port", process.env.PORT)
);

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/stream") {
    console.log("WS upgrade request for /stream");

    wss.handleUpgrade(req, socket, head, (ws) => {
      twilioWs = ws;
      console.log("Twilio WebSocket connected");

      ws.on("message", handleIncomingAudio);
      ws.on("close", () => {
        console.log("Twilio WebSocket disconnected");
        twilioWs = null;
      });
    });
  }
});

/**
 * Handle incoming audio chunks
 */
async function handleIncomingAudio(message) {
  try {
    const data = JSON.parse(message);
    if (data.event !== "media") return;

    const base64Audio = data.media.payload;

    // Send audio to Lambda
    const lambdaResponse = await axios.post(
      process.env.LAMBDA_URL,
      { audio: base64Audio },
      { timeout: 2000 }
    );

    if (!lambdaResponse.data || !lambdaResponse.data.audio) {
      console.log("Lambda returned empty audio");
      return;
    }

    const audioOut = lambdaResponse.data.audio;

    // Return audio to Twilio
    const frame = JSON.stringify({
      event: "media",
      media: { payload: audioOut }
    });

    if (twilioWs?.readyState === WebSocket.OPEN) {
      twilioWs.send(frame);
    }

  } catch (err) {
    console.log("Lambda request error:", err.message);
  }
}
