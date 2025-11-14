// server.js（拡張版 - チャット、リアクション、視聴者リスト対応）
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
const viewers = new Map(); // viewerId -> { ws, id, name, connectedAt }
let broadcasterDisconnectTimer = null;
let chatHistory = []; // チャット履歴（最大100件）
const MAX_CHAT_HISTORY = 100;

// 定期的なクリーンアップ
setInterval(() => {
  viewers.forEach((viewerInfo, id) => {
    if (viewerInfo.ws.readyState !== 1) {
      viewers.delete(id);
      console.log(`🧹 Cleaned up viewer ${id}`);
      broadcastViewerList();
    }
  });
}, 30000);

// 全員にメッセージをブロードキャスト
function broadcastToAll(message) {
  const msgStr = JSON.stringify(message);
  
  if (broadcaster && broadcaster.readyState === 1) {
    broadcaster.send(msgStr);
  }
  
  viewers.forEach((viewer) => {
    if (viewer.ws.readyState === 1) {
      viewer.ws.send(msgStr);
    }
  });
}

// 視聴者リストをブロードキャスト
function broadcastViewerList() {
  const viewerList = Array.from(viewers.values()).map(v => ({
    id: v.id,
    name: v.name,
    connectedAt: v.connectedAt
  }));
  
  broadcastToAll({
    type: 'viewerList',
    viewers: viewerList,
    count: viewers.size
  });
}

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
        
        if (broadcasterDisconnectTimer) {
          clearTimeout(broadcasterDisconnectTimer);
          broadcasterDisconnectTimer = null;
          console.log("✅ Broadcaster reconnected - timer cleared");
        }
        
        console.log("📡 Broadcaster registered");
        
        const existingViewerIds = Array.from(viewers.keys());
        ws.send(JSON.stringify({ 
          type: 'registered',
          role: 'broadcaster',
          existingViewers: existingViewerIds
        }));
        
        // チャット履歴を送信
        ws.send(JSON.stringify({
          type: 'chatHistory',
          messages: chatHistory
        }));
        
        broadcastViewerList();
        return;
      }

      // 👀 視聴者として登録
      if (data.viewer || (data.type === 'register' && data.role === 'viewer')) {
        const existingViewer = data.viewerId && viewers.has(data.viewerId);
        const viewerName = data.name || `Viewer${Math.floor(Math.random() * 1000)}`;
        
        if (existingViewer) {
          viewerId = data.viewerId;
          const viewerInfo = viewers.get(viewerId);
          viewerInfo.ws = ws;
          viewerInfo.name = viewerName;
          console.log(`🔄 Viewer ${viewerId} (${viewerName}) reconnected`);
        } else {
          viewerId = randomUUID();
          viewers.set(viewerId, {
            ws,
            id: viewerId,
            name: viewerName,
            connectedAt: Date.now()
          });
          console.log(`👤 Viewer ${viewerId} (${viewerName}) registered (total: ${viewers.size})`);
        }
        
        ws.send(JSON.stringify({ 
          type: 'registered',
          role: 'viewer',
          viewerId,
          name: viewerName
        }));
        
        // チャット履歴を送信
        ws.send(JSON.stringify({
          type: 'chatHistory',
          messages: chatHistory
        }));
        
        if (broadcaster && broadcaster.readyState === 1) {
          broadcaster.send(JSON.stringify({
            type: 'newViewer',
            viewerId
          }));
        }
        
        broadcastViewerList();
        return;
      }

      // 💬 チャットメッセージ
      if (data.type === 'chat') {
        const chatMessage = {
          type: 'chat',
          senderId: isBroadcaster ? 'broadcaster' : viewerId,
          senderName: isBroadcaster ? '📡 Broadcaster' : (viewers.get(viewerId)?.name || 'Unknown'),
          message: data.message,
          timestamp: Date.now()
        };
        
        console.log(`💬 Chat from ${chatMessage.senderName}: ${data.message}`);
        
        // チャット履歴に追加
        chatHistory.push(chatMessage);
        if (chatHistory.length > MAX_CHAT_HISTORY) {
          chatHistory.shift();
        }
        
        // 全員にブロードキャスト
        broadcastToAll(chatMessage);
        return;
      }

      // 😊 リアクション
      if (data.type === 'reaction') {
        const reactionMessage = {
          type: 'reaction',
          senderId: isBroadcaster ? 'broadcaster' : viewerId,
          senderName: isBroadcaster ? '📡 Broadcaster' : (viewers.get(viewerId)?.name || 'Unknown'),
          emoji: data.emoji,
          timestamp: Date.now()
        };
        
        console.log(`😊 Reaction from ${reactionMessage.senderName}: ${data.emoji}`);
        
        // 全員にブロードキャスト
        broadcastToAll(reactionMessage);
        return;
      }

      // 🎥 配信者からのOffer
      if (data.offer && data.targetViewerId) {
        const viewer = viewers.get(data.targetViewerId);
        if (viewer && viewer.ws.readyState === 1) {
          console.log(`📤 Sending offer to viewer ${data.targetViewerId}`);
          viewer.ws.send(JSON.stringify({ 
            type: 'offer',
            offer: data.offer 
          }));
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
      
      if (broadcasterDisconnectTimer) {
        clearTimeout(broadcasterDisconnectTimer);
      }
      
      broadcasterDisconnectTimer = setTimeout(() => {
        console.log("⏰ Broadcaster timeout - treating as permanent disconnect");
        viewers.forEach((viewer) => {
          if (viewer.ws.readyState === 1) {
            viewer.ws.send(JSON.stringify({ 
              type: 'broadcasterDisconnected',
              permanent: true
            }));
          }
        });
        viewers.clear();
        chatHistory = [];
        console.log("🧹 All viewers cleared due to permanent broadcaster disconnect");
      }, 10000);
      
      viewers.forEach((viewer) => {
        if (viewer.ws.readyState === 1) {
          viewer.ws.send(JSON.stringify({ 
            type: 'broadcasterDisconnected',
            permanent: false
          }));
        }
      });
      
    } else if (viewerId) {
      const viewerName = viewers.get(viewerId)?.name || 'Unknown';
      viewers.delete(viewerId);
      console.log(`👋 Viewer ${viewerId} (${viewerName}) disconnected (remaining: ${viewers.size})`);
      
      if (broadcaster && broadcaster.readyState === 1) {
        broadcaster.send(JSON.stringify({
          type: 'viewerDisconnected',
          viewerId
        }));
      }
      
      broadcastViewerList();
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
