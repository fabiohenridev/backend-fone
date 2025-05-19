const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const sanitize = require('mongo-sanitize');

const app = express();
const port = process.env.PORT || 3000;

// Criar servidor HTTP e integrar Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? ['https://foness.vercel.app'] : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ['https://foness.vercel.app'] : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: 'Muitas requisições. Tente novamente mais tarde.',
});
app.use('/api/', limiter);

// Logging de requisições
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Erro:`, err.stack);
  res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});

// Conexão MongoDB
mongoose.connect('mongodb+srv://henri8274:1QCtcecpyFCS7oQF@cluster0.u63gt3d.mongodb.net/fone-ouvido?retryWrites=true&w=majority', {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
})
  .then(() => console.log('✅ Conectado ao MongoDB'))
  .catch(err => console.error('❌ Erro ao conectar ao MongoDB:', err.message));

// Esquemas
const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    trim: true, 
    unique: true, 
    minlength: 3,
    maxlength: 20,
    match: [/^[a-zA-Z0-9_]+$/, 'Usuário deve conter apenas letras, números ou sublinhados']
  },
  email: { 
    type: String, 
    required: true, 
    trim: true,
    unique: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'] 
  },
  createdAt: { type: Date, default: Date.now },
});

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  replies: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  }],
});

const User = mongoose.model('User', userSchema);
const Comment = mongoose.model('Comment', commentSchema);

// Socket.IO
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);
  socket.on('disconnect', (reason) => console.log(`Cliente desconectado: ${socket.id}, motivo: ${reason}`));
  socket.on('error', (error) => console.error(`Erro Socket.IO: ${error.message}`));
});

// Health check
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Servidor OK', status: 'OK', timestamp: new Date().toISOString() });
});

// Ping
app.get('/ping', (req, res) => {
  console.log(`[${new Date().toISOString()}] Ping recebido`);
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Registrar usuário
app.post('/api/users/register', async (req, res) => {
  try {
    const { username, email } = req.body;
    console.log('Tentativa de registro:', { username, email });
    if (!username || !email) {
      return res.status(400).json({ error: 'Usuário e email são obrigatórios' });
    }
    const sanitizedData = {
      username: sanitize(username),
      email: sanitize(email),
    };
    const existingUser = await User.findOne({ $or: [{ username: sanitizedData.username }, { email: sanitizedData.email }] });
    if (existingUser) {
      return res.status(400).json({ error: existingUser.username === sanitizedData.username ? 'Usuário já existe' : 'Email já registrado' });
    }
    const user = new User(sanitizedData);
    await user.save();
    res.status(201).json({ message: 'Usuário registrado com sucesso!', user: { id: user._id, username: user.username } });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ error: 'Erro ao registrar usuário', details: error.message });
  }
});

// Criar comentário
app.post('/api/comments', async (req, res) => {
  try {
    const { userId, message } = req.body;
    console.log('Comentário recebido:', { userId, message });
    if (!userId || !message) {
      return res.status(400).json({ error: 'Usuário e mensagem são obrigatórios' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const sanitizedData = {
      userId: sanitize(userId),
      message: sanitize(message),
      replies: [],
    };
    const comment = new Comment(sanitizedData);
    await comment.save();
    const populatedComment = await Comment.findById(comment._id).populate('userId', 'username').lean();
    io.emit('newComment', populatedComment);
    res.status(201).json({ message: 'Comentário enviado com sucesso!', comment: populatedComment });
  } catch (error) {
    console.error('Erro ao salvar comentário:', error);
    res.status(500).json({ error: 'Erro ao salvar comentário', details: error.message });
  }
});

// Criar resposta
app.post('/api/comments/reply', async (req, res) => {
  try {
    const { userId, message, parentId } = req.body;
    console.log('Resposta recebida:', { userId, message, parentId });
    if (!userId || !message || !parentId) {
      return res.status(400).json({ error: 'Usuário, mensagem e parentId são obrigatórios' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const comment = await Comment.findById(parentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comentário pai não encontrado' });
    }
    const sanitizedData = {
      userId: sanitize(userId),
      message: sanitize(message),
      createdAt: new Date(),
    };
    comment.replies.push(sanitizedData);
    await comment.save();
    const populatedReply = { ...sanitizedData, userId: { _id: user._id, username: user.username } };
    io.emit('newReply', { reply: populatedReply, parentId });
    res.status(201).json({ message: 'Resposta enviada com sucesso!', reply: populatedReply });
  } catch (error) {
    console.error('Erro ao salvar resposta:', error);
    res.status(500).json({ error: 'Erro ao salvar resposta', details: error.message });
  }
});

// Obter comentários
app.get('/api/comments', async (req, res) => {
  try {
    const comments = await Comment.find()
      .populate('userId', 'username')
      .populate('replies.userId', 'username')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json(comments);
  } catch (error) {
    console.error('Erro ao obter comentários:', error);
    res.status(500).json({ error: 'Erro ao obter comentários', details: error.message });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Rota ${req.url} não encontrada` });
});

// Iniciar servidor
server.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});