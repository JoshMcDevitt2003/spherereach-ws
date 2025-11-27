import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import bodyParser from "body-parser";

const app = express();

// IMPORTANT: Telnyx API v2 requires raw JSON parsing.
app.use(bodyParser.json({ type: "application/json" }));

let telnyxMediaWs = null;

// ------------------------------
// 1. TELNYX CALL CONTROL WEBHOOK (API v2)
// ------------------------------
app.post("/telnyx", (req, res) => {
  const event = req.body?.data;

  console.log("🔥 Telnyx Webhook Received:", event?.event_type);
  console.log("Full Event:", JSON.stringify(req.body, null, 2));

  if (!event) {
    console.log("⚠️ No event data");
    return res.status(200).send("No event");
  }

  const payload = event.payload;
  const callControlId = payload?.call_control_id;

  switch (event.event_type) {
    case "call.initiated":
      console.log("☎️ Incoming call");
      return res.status(200).send("OK");

    case "call.answered":
      console.log("🎉 Call answered! Starting media stream...");

      res.json([
        {
          call_control_id: callControlId,
          command: "stream_start",
          stream_url: `wss://${process.env.RENDER_EXTERNAL_HOSTNAME}/telnyx-media`
        }
      ]);

      return;
  }

  res.status(200).send("Unhandled event");
});

// ------------------------------
// 2. WEBSOCKET MEDIA SERVER
// ------------------------------
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server running on", process.env.PORT || 3000)
);

// Handle WebSocket upgrade
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/telnyx-media") {
    console.log("🔄 Telnyx connecting media WebSocket...");

    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log("🟢 Telnyx Media WS CONNECTED");
      telnyxMediaWs = ws;

      ws.on("message", (msg) => {
        console.log("🎧 Incoming Telnyx audio frame:", msg.toString().slice(0, 80) + "...");
      });

      ws.on("close", () => {
        console.log("🔴 Telnyx Media WS CLOSED");
        telnyxMediaWs = null;
      });
    });
  }
});
