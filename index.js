import express from "express";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
app.use(express.json());

let telnyxMediaWs = null;

// ------------------------------
// 1. TELNYX CALL CONTROL WEBHOOK
// ------------------------------
app.post("/telnyx", (req, res) => {
  const event = req.body?.data;

  console.log("Telnyx Event:", event?.event_type);

  if (!event) {
    console.log("No event in body");
    return res.sendStatus(200);
  }

  const payload = event.payload;
  const callControlId = payload?.call_control_id;

  switch (event.event_type) {
    case "call.initiated":
      console.log("Incoming call");
      // ANSWER CALL FIRST
      return res.json([
        {
          call_control_id: callControlId,
          command: "answer"
        }
      ]);

    case "call.answered":
      console.log("Call answered by us");

      // NOW START MEDIA STREAM
      return res.json([
        {
          call_control_id: callControlId,
          command: "stream_start",
          stream_url: `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/telnyx-media`
        }
      ]);

    default:
      return res.sendStatus(200);
  }
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
    console.log("Telnyx attempting WS upgrade");

    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log("Telnyx media WebSocket CONNECTED");
      telnyxMediaWs = ws;

      ws.on("message", (msg) => {
        console.log("Media message received:", msg.toString().slice(0, 60));
      });

      ws.on("close", () => {
        console.log("Telnyx media WebSocket CLOSED");
        telnyxMediaWs = null;
      });
    });
  }
});
