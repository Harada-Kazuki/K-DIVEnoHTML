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

// ✅ public フォルダの静的配信
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// favicon 404対策（無視用）
app.get("/favicon.ico", (req, res) => res.status(204).end());

// --- 状態管理 ---
let broadcaster = null;        // 配信者ソケット
let latestOffer = null;        // 最新のOfferを保持
const viewers = new Set();     // 視聴者セット

// --- WebSocket処理 ---
wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (e) {
      console.error("Invalid JSON:", msg);
      return;
    }

    // 🎥 配信者がOfferを送信したとき
    if (data.offer) {
      broadcaster = ws;
      latestOffer = data.offer;
      console.log("📡 Broadcaster sent new offer");
      // 現在の視聴者全員に送信
      viewers.forEach(v => {
        if (v.readyState === v.OPEN) {
          v.send(JSON.stringify({ offer: latestOffer }));
        }
      });
    }

    // 👀 視聴者が接続したとき
    if (data.viewer) {
      viewers.add(ws);
      console.log("👤 Viewer joined (total:", viewers.size, ")");
      // 配信中なら最新のOfferをすぐ送る
      if (latestOffer) {
        ws.send(JSON.stringify({ offer: latestOffer }));
      } else {
        // 配信者がまだいない場合
        ws.send(JSON.stringify({ waiting: true }));
      }
    }

    // 👀 視聴者がAnswerを送ってきた
    if (data.answer && broadcaster) {
      console.log("📨 Answer from viewer → broadcaster");
      if (broadcaster.readyState === broadcaster.OPEN) {
        broadcaster.send(JSON.stringify({ answer: data.answer }));
      }
    }

    // 🧊 ICE candidateの中継
    if (data.candidate) {
      if (ws === broadcaster) {
        // 配信者→視聴者へ
        viewers.forEach(v => {
          if (v.readyState === v.OPEN) {
            v.send(JSON.stringify({ candidate: data.candidate }));
          }
        });
      } else if (broadcaster && broadcaster.readyState === broadcaster.OPEN) {
        // 視聴者→配信者へ
        broadcaster.send(JSON.stringify({ candidate: data.candidate }));
      }
    }

    // 🛑 配信停止メッセージ
    if (data.stop) {
      console.log("🧹 Broadcaster manually stopped");
      latestOffer = null;
      if (broadcaster) {
        broadcaster = null;
      }
      viewers.forEach(v => {
        if (v.readyState === v.OPEN) {
          v.send(JSON.stringify({ broadcasterDisconnected: true }));
        }
      });
    }
  });

  // 接続終了時の処理
  ws.on("close", () => {
    if (ws === broadcaster) {
      console.log("🛑 Broadcaster disconnected");
      broadcaster = null;
      latestOffer = null;
      viewers.forEach(v => {
        if (v.readyState === v.OPEN) {
          v.send(JSON.stringify({ broadcasterDisconnected: true }));
        }
      });
    } else if (viewers.has(ws)) {
      viewers.delete(ws);
      console.log("👋 Viewer disconnected (total:", viewers.size, ")");
    }
  });
});

// --- 起動 ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ WebSocket Server running on port ${PORT}`));
