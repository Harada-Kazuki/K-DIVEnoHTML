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

// ✅ public フォルダ内を静的配信
app.use(express.static(path.join(__dirname, "public")));

// デフォルトルートを index.html に
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let broadcaster = null;
const viewers = new Set();

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // 🎥 配信者からの接続
    if (data.offer) {
      broadcaster = ws;
      console.log("📡 Broadcaster connected");
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
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
