import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

let broadcaster = null;
wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    if (data.offer) {
      broadcaster = ws;
      wss.clients.forEach(c => { if (c !== ws) c.send(JSON.stringify({ offer: data.offer })); });
    } else if (data.answer) {
      if (broadcaster) broadcaster.send(JSON.stringify({ answer: data.answer }));
    } else if (data.candidate) {
      wss.clients.forEach(c => { if (c !== ws) c.send(JSON.stringify({ candidate: data.candidate })); });
    }
  });
});
console.log("WebSocket signaling server running on port 8080");
