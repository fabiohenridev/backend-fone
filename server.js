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

app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ['https://foness.vercel.app'] : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Muitas requisições. Tente novamente mais tarde.',
});
app.use('/api/', limiter);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Erro:`, err.stack);
  res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});

mongoose.connect('mongodb+srv://henri8274:1QCtcecpyFCS7oQF@cluster0.u63gt3d.mongodb.net/fone-ouvido?retryWrites=true&w=majority', {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
})
  .then(() => console.log('✅ Conectado ao MongoDB'))
  .catch(err => {
    console.error('❌ Erro ao conectar ao MongoDB:', err.message);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => console.log('MongoDB desconectado'));
mongoose.connection.on('reconnected', () => console.log('MongoDB reconectado'));
mongoose.connection.on('error', (err) => console.error('Erro MongoDB:', err));

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

const visitSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Comment = mongoose.model('Comment', commentSchema);
const Visit = mongoose.model('Visit', visitSchema);

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);
  socket.on('disconnect', (reason) => console.log(`Cliente desconectado: ${socket.id}, motivo: ${reason}`));
  socket.on('error', (error) => console.error(`Erro Socket.IO: ${error.message}`));
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Servidor OK', status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/ping', (req, res) => {
  console.log(`[${new Date().toISOString()}] Ping recebido`);
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

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
    const populatedComment = await Comment.findById(comment._id).populate('userId', 'username email').lean();
    io.emit('newComment', populatedComment);
    res.status(201).json({ message: 'Comentário enviado com sucesso!', comment: populatedComment });
  } catch (error) {
    console.error('Erro ao salvar comentário:', error);
    res.status(500).json({ error: 'Erro ao salvar comentário', details: error.message });
  }
});

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
    const populatedReply = { ...sanitizedData, userId: { _id: user._id, username: user.username, email: user.email } };
    io.emit('newReply', { reply: populatedReply, parentId });
    res.status(201).json({ message: 'Resposta enviada com sucesso!', reply: populatedReply });
  } catch (error) {
    console.error('Erro ao salvar resposta:', error);
    res.status(500).json({ error: 'Erro ao salvar resposta', details: error.message });
  }
});

app.get('/api/comments', async (req, res) => {
  try {
    const comments = await Comment.find()
      .populate('userId', 'username email')
      .populate('replies.userId', 'username email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json(comments);
  } catch (error) {
    console.error('Erro ao obter comentários:', error);
    res.status(500).json({ error: 'Erro ao obter comentários', details: error.message });
  }
});

// Rota para registrar uma nova visita
app.post('/api/visits', async (req, res) => {
  try {
    const visit = new Visit();
    await visit.save();
    res.status(201).json({ message: 'Visita registrada com sucesso!' });
  } catch (error) {
    console.error('Erro ao registrar visita:', error);
    res.status(500).json({ error: 'Erro ao registrar visita', details: error.message });
  }
});

// Rota para obter o total de visitas
app.get('/api/visits/count', async (req, res) => {
  try {
    const count = await Visit.countDocuments();
    res.status(200).json({ totalVisits: count });
  } catch (error) {
    console.error('Erro ao obter total de visitas:', error);
    res.status(500).json({ error: 'Erro ao obter total de visitas', details: error.message });
  }
});

// Rota para excluir todas as visitas
app.delete('/api/visits', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== 'Bearer minha-chave-secreta') {
      return res.status(401).json({ error: 'Acesso não autorizado' });
    }
    await Visit.deleteMany({});
    console.log('Todas as visitas foram excluídas');
    res.status(200).json({ message: 'Todas as visitas foram excluídas com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir visitas:', error);
    res.status(500).json({ error: 'Erro ao excluir visitas', details: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Rota ${req.url} não encontrada` });
});

server.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});