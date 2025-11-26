import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Twilio will connect its WebSocket here
let twilioWs = null;

// ===============
//  TWILIO ANSWER
// ===============
app.post("/answer", (req, res) => {
  console.log("Twilio requested /answer");

  const twiml = `
    <Response>
      <Start>
        <Stream url="wss://spherereach-ws.onrender.com/stream" />
      </Start>
      <Say voice="Polly.Joanna">Connecting you now.</Say>
    </Response>
  `;

  res.type("text/xml");
  res.send(twiml);
});

// OPTIONAL event handler if Twilio sends events
app.post("/event", (req, res) => {
  console.log("Twilio event received:", req.body);
  res.sendStatus(200);
});

// ==========================
//  WEBSOCKET UPGRADE SERVER
// ==========================
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/stream") {
    console.log("Upgrading HTTP → WebSocket");
    wss.handleUpgrade(req, socket, head, (ws) => {
      twilioWs = ws;
      console.log("Twilio WebSocket connected");

      ws.on("message", handleIncomingAudio);
      ws.on("close", () => console.log("Twilio WebSocket closed"));
    });
  }
});

// ===============================
//  HANDLE INCOMING AUDIO FRAMES
// ===============================
async function handleIncomingAudio(message) {
  try {
    const data = JSON.parse(message);

    // Twilio sends media frames
    if (data.event === "media") {
      const base64Audio = data.media.payload;

      // Forward audio to your Lambda AI brain
      const response = await axios.post(process.env.LAMBDA_URL, {
        audio: base64Audio,
      });

      const audioToPlay = response.data.audio;

      if (!audioToPlay) {
        console.log("Lambda returned no audio");
        return;
      }

      // Send audio back to Twilio as a media frame
      const outboundFrame = JSON.stringify({
        event: "media",
        media: { payload: audioToPlay },
      });

      if (twilioWs?.readyState === WebSocket.OPEN) {
        twilioWs.send(outboundFrame);
      }
    }
  } catch (err) {
    console.error("Error in handleIncomingAudio:", err.message);
  }
}
