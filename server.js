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
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { 
    type: String, 
    required: true, 
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'] 
  },
  message: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
});

const commentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { 
    type: String, 
    required: true, 
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'] 
  },
  message: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  replies: [{
    name: { type: String, required: true, trim: true },
    email: { 
      type: String, 
      required: true, 
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'] 
    },
    message: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  }],
});

const Contact = mongoose.model('Contact', contactSchema);
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

// Endpoint de contato
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    console.log('Contato recebido:', { name, email, message });
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    const sanitizedData = {
      name: sanitize(name),
      email: sanitize(email),
      message: sanitize(message),
    };
    const contact = new Contact(sanitizedData);
    await contact.save();
    io.emit('newContact', { ...sanitizedData, createdAt: contact.createdAt });
    res.status(201).json({ message: 'Mensagem enviada com sucesso!' });
  } catch (error) {
    console.error('Erro ao salvar contato:', error);
    res.status(500).json({ error: 'Erro ao salvar mensagem', details: error.message });
  }
});

// Criar comentário
app.post('/api/comments', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    console.log('Comentário recebido:', { name, email, message });
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Nome, email e mensagem são obrigatórios' });
    }
    const sanitizedData = {
      name: sanitize(name),
      email: sanitize(email),
      message: sanitize(message),
      replies: [],
    };
    const comment = new Comment(sanitizedData);
    await comment.save();
    io.emit('newComment', { ...sanitizedData, _id: comment._id, createdAt: comment.createdAt });
    res.status(201).json({ message: 'Comentário enviado com sucesso!', comment });
  } catch (error) {
    console.error('Erro ao salvar comentário:', error);
    res.status(500).json({ error: 'Erro ao salvar comentário', details: error.message });
  }
});

// Criar resposta
app.post('/api/comments/reply', async (req, res) => {
  try {
    const { name, email, message, parentId } = req.body;
    console.log('Resposta recebida:', { name, email, message, parentId });
    if (!name || !email || !message || !parentId) {
      return res.status(400).json({ error: 'Nome, email, mensagem e parentId são obrigatórios' });
    }
    const sanitizedData = {
      name: sanitize(name),
      email: sanitize(email),
      message: sanitize(message),
      createdAt: new Date(),
    };
    const comment = await Comment.findById(parentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comentário pai não encontrado' });
    }
    comment.replies.push(sanitizedData);
    await comment.save();
    io.emit('newReply', { reply: sanitizedData, parentId });
    res.status(201).json({ message: 'Resposta enviada com sucesso!', reply: sanitizedData });
  } catch (error) {
    console.error('Erro ao salvar resposta:', error);
    res.status(500).json({ error: 'Erro ao salvar resposta', details: error.message });
  }
});

// Obter comentários
app.get('/api/comments', async (req, res) => {
  try {
    const comments = await Comment.find().sort({ createdAt: -1 }).limit(50).lean();
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