import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

let twilioWs = null;

// =======================
//  /answer  (TwiML)
// =======================
app.post("/answer", (req, res) => {
  console.log("Twilio hit /answer");

  const twiml = `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://spherereach-ws.onrender.com/stream" />
  </Connect>
</Response>
  `.trim();

  res.set("Content-Type", "text/xml");
  res.send(twiml);
});

// OPTIONAL: Twilio status/events
app.post("/event", (req, res) => {
  console.log("Twilio event:", req.body);
  res.sendStatus(200);
});

// ============================
//   WebSocket server setup
// ============================
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(process.env.PORT || 3000, () =>
  console.log("Server running on port", process.env.PORT || 3000)
);

// Handle WS upgrade requests
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/stream") {
    console.log("WS upgrade request for /stream");

    wss.handleUpgrade(req, socket, head, (ws) => {
      twilioWs = ws;
      console.log("Twilio WebSocket connected");

      ws.on("message", handleIncomingAudio);
      ws.on("close", () => console.log("Twilio WebSocket disconnected"));
    });
  }
});

// ============================
//   Handle Twilio Media Frames
// ============================
async function handleIncomingAudio(message) {
  try {
    const data = JSON.parse(message);

    if (data.event === "media") {
      const base64Audio = data.media.payload;

      // SEND TO YOUR LAMBDA
      const response = await axios.post(process.env.LAMBDA_URL, {
        audio: base64Audio,
      });

      const audioToPlay = response.data?.audio;

      if (!audioToPlay) {
        console.log("Lambda returned no audio");
        return;
      }

      // SEND AUDIO BACK TO TWILIO
      const frame = JSON.stringify({
        event: "media",
        media: { payload: audioToPlay },
      });

      if (twilioWs?.readyState === WebSocket.OPEN) {
        twilioWs.send(frame);
      }
    }
  } catch (err) {
    console.error("Error in handleIncomingAudio:", err.message);
  }
}
