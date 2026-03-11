import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * Minimal realtime hub for PIMS ↔ GXT ↔ GNT.
 *
 * - Clients connect via WS and send {type:"HELLO", app:"PIMS"|"GXT"|"GNT", deviceId, plate?}
 * - PIMS publishes events by POST /event (or WS {type:"EVENT", ...}).
 * - Server broadcasts events to all clients (and also keeps last-known job per plate).
 *
 * NOTE: In-memory storage; for production persistence, plug DB later.
 */

const clients = new Map(); // ws -> {app, deviceId, plate}
const jobsByPlate = new Map(); // plate -> job payload
const stateByPlate = new Map(); // plate -> {status, ...}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function broadcast(event, { plate } = {}) {
  const msg = JSON.stringify(event);
  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    // If the receiver is tied to a plate, only deliver matching plate events.
    if (plate && meta?.plate && meta.plate !== plate) continue;
    ws.send(msg);
  }
}

function upsertPlateState(plate, patch) {
  const prev = stateByPlate.get(plate) || {};
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  stateByPlate.set(plate, next);
  return next;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    now: Date.now(),
    clients: clients.size,
    plates: [...stateByPlate.keys()].length
  });
});

app.get("/state/:plate", (req, res) => {
  const plate = String(req.params.plate || "").toUpperCase();
  res.json({
    plate,
    job: jobsByPlate.get(plate) || null,
    state: stateByPlate.get(plate) || null
  });
});

app.post("/event", (req, res) => {
  const event = req.body;
  if (!event || typeof event !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }
  const plate = String(event.plate || "").toUpperCase();
  const type = String(event.type || "");

  if (!plate || !type) {
    return res.status(400).json({ ok: false, error: "Missing plate/type" });
  }

  const enriched = {
    ...event,
    plate,
    serverTime: Date.now()
  };

  // Keep last job per plate
  if (type === "JOB_CREATED" && event.job) {
    jobsByPlate.set(plate, { ...event.job, plate });
    upsertPlateState(plate, { status: "JOB_CREATED" });
  }

  if (type === "PIMS_DONE") upsertPlateState(plate, { status: "PIMS_DONE" });
  if (type === "GXT_CONFIRMED") upsertPlateState(plate, { status: "GXT_CONFIRMED" });
  if (type === "GXT_ARRIVED") upsertPlateState(plate, { status: "GXT_ARRIVED" });
  if (type === "GNT_CONFIRMED") upsertPlateState(plate, { status: "GNT_CONFIRMED" });
  if (type === "GNT_DONE") upsertPlateState(plate, { status: "GNT_DONE" });
  if (type === "GXT_FINISH") upsertPlateState(plate, { status: "GXT_FINISH" });
  if (type === "GXT_CHECKOUT") upsertPlateState(plate, { status: "GXT_CHECKOUT" });

  broadcast({ type: "EVENT", event: enriched }, { plate });
  return res.json({ ok: true });
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "WELCOME", serverTime: Date.now() }));

  ws.on("message", (data) => {
    const msg = safeJsonParse(String(data));
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "HELLO") {
      const meta = {
        app: String(msg.app || "UNKNOWN"),
        deviceId: String(msg.deviceId || "unknown"),
        plate: msg.plate ? String(msg.plate).toUpperCase() : null
      };
      clients.set(ws, meta);

      ws.send(
        JSON.stringify({
          type: "HELLO_ACK",
          meta,
          serverTime: Date.now()
        })
      );

      // If the client binds to a plate, immediately push current state/job
      if (meta.plate) {
        ws.send(
          JSON.stringify({
            type: "SYNC",
            plate: meta.plate,
            job: jobsByPlate.get(meta.plate) || null,
            state: stateByPlate.get(meta.plate) || null,
            serverTime: Date.now()
          })
        );
      }
      return;
    }

    if (msg.type === "EVENT" && msg.event) {
      // Allow publishing via WS too
      const plate = String(msg.event.plate || "").toUpperCase();
      const type = String(msg.event.type || "");
      if (!plate || !type) return;
      const enriched = { ...msg.event, plate, serverTime: Date.now() };
      broadcast({ type: "EVENT", event: enriched }, { plate });
      return;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

const PORT = Number(process.env.PORT || 8787);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Realtime server listening on :${PORT}`);
});

