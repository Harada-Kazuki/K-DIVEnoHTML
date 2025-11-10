// server.js（修正版 - 視聴者ごとにOffer/Answer管理）
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

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
const viewers = new Map(); // viewerId -> { ws, id, connectedAt }

// 定期的なクリーンアップ
setInterval(() => {
  viewers.forEach((viewerInfo, id) => {
    if (viewerInfo.ws.readyState !== 1) {
      viewers.delete(id);
      console.log(`🧹 Cleaned up viewer ${id}`);
    }
  });
}, 30000);

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");
  
  let viewerId = null;
  let isBroadcaster = false;
  
  // 接続維持のためのping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.ping();
    }
  }, 25000);

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // 🎥 配信者として登録
      if (data.broadcaster) {
        broadcaster = ws;
        isBroadcaster = true;
        console.log("📡 Broadcaster registered");
        ws.send(JSON.stringify({ 
          type: 'registered',
          role: 'broadcaster'
        }));
        return;
      }

      // 👀 視聴者として登録
      if (data.viewer) {
        viewerId = randomUUID();
        viewers.set(viewerId, {
          ws,
          id: viewerId,
          connectedAt: Date.now()
        });
        console.log(`👤 Viewer ${viewerId} registered (total: ${viewers.size})`);
        
        // 視聴者にIDを送信
        ws.send(JSON.stringify({ 
          type: 'registered',
          role: 'viewer',
          viewerId
        }));
        
        // 配信者に新しい視聴者を通知
        if (broadcaster && broadcaster.readyState === 1) {
          broadcaster.send(JSON.stringify({
            type: 'newViewer',
            viewerId
          }));
          console.log(`📤 Notified broadcaster about viewer ${viewerId}`);
        }
        return;
      }

      // 🎥 配信者からのOffer（視聴者IDを含む）
      if (data.offer && data.targetViewerId) {
        const viewer = viewers.get(data.targetViewerId);
        if (viewer && viewer.ws.readyState === 1) {
          console.log(`📤 Sending offer to viewer ${data.targetViewerId}`);
          viewer.ws.send(JSON.stringify({ 
            type: 'offer',
            offer: data.offer 
          }));
        } else {
          console.log(`❌ Viewer ${data.targetViewerId} not found or disconnected`);
        }
        return;
      }

      // 👀 視聴者からのAnswer
      if (data.answer && data.viewerId) {
        if (broadcaster && broadcaster.readyState === 1) {
          console.log(`📤 Sending answer from viewer ${data.viewerId} to broadcaster`);
          broadcaster.send(JSON.stringify({
            type: 'answer',
            answer: data.answer,
            viewerId: data.viewerId
          }));
        }
        return;
      }

      // ICE候補の中継（配信者 → 視聴者）
      if (data.candidate && data.targetViewerId && isBroadcaster) {
        const viewer = viewers.get(data.targetViewerId);
        if (viewer && viewer.ws.readyState === 1) {
          viewer.ws.send(JSON.stringify({ 
            type: 'candidate',
            candidate: data.candidate 
          }));
        }
        return;
      }

      // ICE候補の中継（視聴者 → 配信者）
      if (data.candidate && data.viewerId && !isBroadcaster) {
        if (broadcaster && broadcaster.readyState === 1) {
          broadcaster.send(JSON.stringify({
            type: 'candidate',
            candidate: data.candidate,
            viewerId: data.viewerId
          }));
        }
        return;
      }

    } catch (err) {
      console.error("❌ Error handling message:", err);
    }
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
    
    if (isBroadcaster) {
      console.log("🛑 Broadcaster disconnected");
      broadcaster = null;
      
      // 全視聴者に通知
      viewers.forEach((viewer) => {
        if (viewer.ws.readyState === 1) {
          viewer.ws.send(JSON.stringify({ 
            type: 'broadcasterDisconnected' 
          }));
        }
      });
      viewers.clear();
    } else if (viewerId) {
      viewers.delete(viewerId);
      console.log(`👋 Viewer ${viewerId} disconnected (remaining: ${viewers.size})`);
      
      // 配信者に通知
      if (broadcaster && broadcaster.readyState === 1) {
        broadcaster.send(JSON.stringify({
          type: 'viewerDisconnected',
          viewerId
        }));
      }
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
