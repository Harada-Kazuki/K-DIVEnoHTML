// server.js（修正版）
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

// ✅ 追加: 最新のOfferを保存しておく
let broadcaster = null;
let latestOffer = null;
const viewers = new Set();

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // 🎥 配信者がOfferを送った
    if (data.offer) {
      broadcaster = ws;
      latestOffer = data.offer; // ✅ Offerを保存
      console.log("📡 Broadcaster sent offer");
      viewers.forEach(v => v.send(JSON.stringify({ offer: data.offer })));
    }

    // 👀 視聴者が接続
    if (data.viewer) {
      viewers.add(ws);
      console.log("👤 Viewer connected (total:", viewers.size, ")");
      // ✅ すでに配信中なら、最新のOfferを即送信
      if (latestOffer) {
        ws.send(JSON.stringify({ offer: latestOffer }));
      }
    }

    // 👀 視聴者からAnswerを受け取った
    if (data.answer && broadcaster) {
      broadcaster.send(JSON.stringify({ answer: data.answer }));
    }

    // ICE候補の中継
    if (data.candidate) {
      if (ws === broadcaster) {
        viewers.forEach(v => v.send(JSON.stringify({ candidate: data.candidate })));
      } else if (broadcaster) {
        broadcaster.send(JSON.stringify({ candidate: data.candidate }));
      }
    }
  });

  ws.on("close", () => {
    if (ws === broadcaster) {
      console.log("🛑 Broadcaster disconnected");
      broadcaster = null;
      latestOffer = null; // ✅ 配信が終わったらクリア
      viewers.forEach(v => v.send(JSON.stringify({ broadcasterDisconnected: true })));
    } else {
      viewers.delete(ws);
      console.log("👋 Viewer disconnected (total:", viewers.size, ")");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
