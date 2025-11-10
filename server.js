// server.js
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let broadcaster = null;
const viewers = new Set();

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // 🎥 配信者からの接続
    if (data.offer) {
      broadcaster = ws;
      console.log("📡 Broadcaster connected");
      // 視聴者全員にOfferを送信
      viewers.forEach(v => v.send(JSON.stringify({ offer: data.offer })));
    }

    // 👀 視聴者登録
    if (data.viewer) {
      viewers.add(ws);
      console.log("👤 Viewer connected (total:", viewers.size, ")");
      if (broadcaster) {
        broadcaster.send(JSON.stringify({ viewerConnected: true }));
      }
    }

    // 👀 Answerを配信者へ中継
    if (data.answer && broadcaster) {
      broadcaster.send(JSON.stringify({ answer: data.answer }));
    }

    // ICE候補を中継
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
      viewers.forEach(v => v.send(JSON.stringify({ broadcasterDisconnected: true })));
    } else {
      viewers.delete(ws);
      console.log("👋 Viewer disconnected (total:", viewers.size, ")");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ WebSocket Server running on port ${PORT}`));
