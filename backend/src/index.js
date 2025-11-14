require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

const { registerSocketHandlers, setSocketIO } = require('./controllers/messageController');
const messageRoutes = require('./routes/messageRoutes');
const authRoutes = require('./routes/authRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const friendRoutes = require('./routes/friendRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Chat API is running' });
});

// Register all API routes
app.use('/api/messages', messageRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/users', userRoutes);

// Debug: Log registered routes after all routes are mounted
setTimeout(() => {
  console.log('\n=== Registered Routes ===');
  const routes = [];
  if (app._router && app._router.stack) {
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
        routes.push(`${methods} ${middleware.route.path}`);
      } else if (middleware.name === 'router' && middleware.regexp) {
        routes.push(`Router: ${middleware.regexp}`);
      }
    });
  }
  routes.forEach(route => console.log(route));
  console.log('========================\n');
}, 100);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/chatapp';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const normalizeOrigins = (originValue) => {
  if (!originValue) return [];
  return originValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const allowedOrigins = normalizeOrigins(CLIENT_ORIGIN);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
  },
});

setSocketIO(io);

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  registerSocketHandlers(socket);

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', socket.id, reason);
  });
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

