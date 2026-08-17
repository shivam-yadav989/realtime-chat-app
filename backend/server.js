require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let onlineUsers = [];

io.on('connection', (socket) => {
  // Terminal par print hoga jab bhi socket connect hoga
  console.log('Connected to socket.io');

  socket.on('setup', (userData) => {
    if (!userData || !userData.email) return;
    socket.join(userData.email);
    if (!onlineUsers.includes(userData.email)) {
      onlineUsers.push(userData.email);
    }
    io.emit('online users', onlineUsers);
  });

  socket.on('join chat', (room) => {
    socket.join(room);
  });

  socket.on('typing', (room) => {
    socket.in(room).emit('typing');
  });

  socket.on('stop typing', (room) => {
    socket.in(room).emit('stop typing');
  });

  socket.on('new message', (receivedMessage) => {
    const { room, sender, content, _id, time } = receivedMessage;
    socket.in(room).emit('message received', {
      _id,
      sender,
      content,
      room,
      time
    });
  });

  socket.on('delete message', ({ messageId, room }) => {
    socket.in(room).emit('message deleted', messageId);
  });

  // Call Events
  socket.on('callUser', (data) => {
    io.to(data.userToCall).emit('callUser', {
      signal: data.signalData,
      from: data.from,
      isAudioOnly: data.isAudioOnly
    });
  });

  socket.on('answerCall', (data) => {
    io.to(data.to).emit('callAccepted', data.signal);
  });

  socket.on('endCall', (data) => {
    io.to(data.to).emit('callEnded');
  });

  socket.on('disconnect', () => {
    console.log('USER DISCONNECTED:', socket.id);
  });
});

// Local MongoDB Connection
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/realtime-chat-app';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.log('Database connection error:', err);
  });