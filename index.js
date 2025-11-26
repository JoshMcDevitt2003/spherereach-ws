import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

let twilioWs = null;

app.post("/answer", (req, res) => {
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

app.post("/event", (req, res) => {
  res.sendStatus(200);
});

const wss = new WebSocketServer({ noServer: true });

const server = app.listen(process.env.PORT || 3000, () =>
  console.log("Server running")
);

server.on("upgrade", (request, socket, head) => {
  if (request.url === "/stream") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      twilioWs = ws;
      ws.on("message", handleIncomingAudio);
    });
  }
});

async function handleIncomingAudio(message) {
  try {
    const data = JSON.parse(message);

    if (data.event === "media") {
      const base64Audio = data.media.payload;

      const response = await axios.post(process.env.LAMBDA_URL, {
        audio: base64Audio,
      });

      const audioToPlay = response.data.audio;

      const frame = JSON.stringify({
        event: "media",
        media: { payload: audioToPlay },
      });

      if (twilioWs?.readyState === WebSocket.OPEN) {
        twilioWs.send(frame);
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}
