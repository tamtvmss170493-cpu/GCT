// Shared realtime client for PIMS/GXT/GNT (works on Netlify HTTPS).
// Stores server URL in localStorage key: rt_server_url
// Protocol: WS send {type:"HELLO", app, deviceId, plate?}; receive {type:"EVENT", event}

export function getServerUrl() {
  return localStorage.getItem("rt_server_url") || "";
}

export function setServerUrl(url) {
  localStorage.setItem("rt_server_url", url);
}

export function ensureDeviceId(prefix = "dev") {
  const key = "rt_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function connectRealtime({ app, plate, onEvent, onStatus }) {
  const base = getServerUrl().trim();
  if (!base) {
    onStatus?.({ ok: false, status: "NO_SERVER_URL" });
    return { close() {} };
  }

  const wsUrl = base.replace(/^http/, "ws").replace(/\/$/, "");
  const deviceId = ensureDeviceId(app.toLowerCase());
  let ws;
  let closed = false;
  let retry = 0;
  let retryTimer;

  function setStatus(s) {
    onStatus?.({ ok: true, ...s });
  }

  function open() {
    if (closed) return;
    setStatus({ status: "CONNECTING", wsUrl });
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      retry = 0;
      setStatus({ status: "CONNECTED" });
      ws.send(
        JSON.stringify({
          type: "HELLO",
          app,
          deviceId,
          plate: plate ? String(plate).toUpperCase() : undefined
        })
      );
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === "EVENT") onEvent?.(msg.event);
        if (msg?.type === "SYNC") onEvent?.({ type: "SYNC", ...msg });
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      if (closed) return;
      setStatus({ status: "DISCONNECTED" });
      retry = Math.min(retry + 1, 8);
      const wait = Math.min(15000, 500 * 2 ** retry);
      retryTimer = setTimeout(open, wait);
    };

    ws.onerror = () => {
      // Let onclose handle retries.
    };
  }

  open();

  return {
    publish: async (event) => {
      const url = base.replace(/\/$/, "") + "/event";
      const payload = { ...event, plate: String(event.plate || "").toUpperCase() };
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    },
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    }
  };
}

