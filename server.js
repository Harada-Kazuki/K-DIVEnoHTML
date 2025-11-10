// server.js（改善版 - 10人視聴対応）
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

// 配信状態の管理
let broadcaster = null;
let latestOffer = null;
let broadcasterIceCandidates = []; // ✅ ICE候補を保存
const viewers = new Map(); // Set から Map に変更（視聴者ごとの情報を保存）

// ✅ 定期的なクリーンアップ（切断されたコネクションを削除）
setInterval(() => {
  viewers.forEach((viewerInfo, ws) => {
    if (ws.readyState !== 1) { // 1 = OPEN
      viewers.delete(ws);
      console.log("🧹 Cleaned up disconnected viewer");
    }
  });
}, 30000); // 30秒ごと

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");
  
  // ✅ 接続維持のためのping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.ping();
    }
  }, 25000); // 25秒ごと

  ws.on("pong", () => {
    if (viewers.has(ws)) {
      viewers.get(ws).lastPong = Date.now();
    }
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // 🎥 配信者がOfferを送った
      if (data.offer) {
        broadcaster = ws;
        latestOffer = data.offer;
        broadcasterIceCandidates = []; // 新しい配信の開始時にリセット
        console.log("📡 Broadcaster sent offer (viewers:", viewers.size, ")");
        
        // 全視聴者にOfferを送信
        viewers.forEach((viewerInfo, viewerWs) => {
          if (viewerWs.readyState === 1) {
            viewerWs.send(JSON.stringify({ offer: data.offer }));
            viewerInfo.offerSent = true;
          }
        });
      }

      // 👀 視聴者が接続
      if (data.viewer) {
        viewers.set(ws, {
          connectedAt: Date.now(),
          lastPong: Date.now(),
          offerSent: false,
          iceCandidatesSent: false
        });
        console.log("👤 Viewer connected (total:", viewers.size, ")");
        
        // ✅ 配信中なら、Offer + ICE候補を送信
        if (latestOffer && broadcaster) {
          ws.send(JSON.stringify({ offer: latestOffer }));
          viewers.get(ws).offerSent = true;
          
          // ✅ 保存されたICE候補も送信
          if (broadcasterIceCandidates.length > 0) {
            console.log(`📤 Sending ${broadcasterIceCandidates.length} ICE candidates to new viewer`);
            broadcasterIceCandidates.forEach(candidate => {
              ws.send(JSON.stringify({ candidate }));
            });
            viewers.get(ws).iceCandidatesSent = true;
          }
        }
      }

      // 👀 視聴者からAnswerを受け取った
      if (data.answer && broadcaster && broadcaster.readyState === 1) {
        console.log("📥 Received answer from viewer");
        broadcaster.send(JSON.stringify({ answer: data.answer }));
      }

      // ✅ ICE候補の中継（改善版）
      if (data.candidate) {
        if (ws === broadcaster) {
          // 配信者からのICE候補を保存
          broadcasterIceCandidates.push(data.candidate);
          console.log(`🧊 Broadcaster ICE candidate saved (total: ${broadcasterIceCandidates.length})`);
          
          // 全視聴者に送信
          let sentCount = 0;
          viewers.forEach((viewerInfo, viewerWs) => {
            if (viewerWs.readyState === 1 && viewerInfo.offerSent) {
              viewerWs.send(JSON.stringify({ candidate: data.candidate }));
              sentCount++;
            }
          });
          console.log(`📤 Sent ICE candidate to ${sentCount} viewers`);
        } else if (broadcaster && broadcaster.readyState === 1) {
          // 視聴者からのICE候補を配信者に送信
          console.log("🧊 Forwarding viewer ICE candidate to broadcaster");
          broadcaster.send(JSON.stringify({ candidate: data.candidate }));
        }
      }
    } catch (err) {
      console.error("❌ Error handling message:", err);
    }
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
    
    if (ws === broadcaster) {
      console.log("🛑 Broadcaster disconnected");
      broadcaster = null;
      latestOffer = null;
      broadcasterIceCandidates = [];
      
      // 全視聴者に通知
      viewers.forEach((viewerInfo, viewerWs) => {
        if (viewerWs.readyState === 1) {
          viewerWs.send(JSON.stringify({ broadcasterDisconnected: true }));
        }
      });
      viewers.clear();
    } else {
      viewers.delete(ws);
      console.log("👋 Viewer disconnected (remaining:", viewers.size, ")");
    }
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
});
