// server.js
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ✅ 状態管理
let broadcaster = null;
let latestOffer = null;
const viewers = new Set();

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // 🎥 配信者からOfferを受信
    if (data.offer) {
      broadcaster = ws;
      latestOffer = data.offer;
      console.log("📡 Broadcaster sent new offer");
      viewers.forEach(v => v.send(JSON.stringify({ offer: data.offer })));
    }

    // 👀 視聴者登録
    if (data.viewer) {
      viewers.add(ws);
      console.log(`👤 Viewer connected (${viewers.size} total)`);

      // ✅ すでに配信中ならOfferを即送信
      if (latestOffer) {
        ws.send(JSON.stringify({ offer: latestOffer }));
      }
    }

    // 👂 Answerを受信（視聴者 → 配信者）
    if (data.answer && broadcaster) {
      broadcaster.send(JSON.stringify({ answer: data.answer }));
    }

    // 🧊 ICE候補をリレー
    if (data.candidate) {
      if (ws === broadcaster) {
        viewers.forEach(v => v.send(JSON.stringify({ candidate: data.candidate })));
      } else if (broadcaster) {
        broadcaster.send(JSON.stringify({ candidate: data.candidate }));
      }
    }

    // 🛑 手動停止時
    if (data.stop) {
      console.log("🧹 Broadcast manually stopped");
      latestOffer = null;
    }
  });

  ws.on("close", () => {
    if (ws === broadcaster) {
      console.log("🛑 Broadcaster disconnected");
      broadcaster = null;
      latestOffer = null;
      viewers.forEach(v => v.send(JSON.stringify({ broadcasterDisconnected: true })));
    } else {
      viewers.delete(ws);
      console.log(`👋 Viewer disconnected (${viewers.size} remaining)`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ NieR WebRTC server running on port ${PORT}`));
