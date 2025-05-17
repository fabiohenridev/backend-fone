const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server and integrate Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for testing; restrict in production
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*', // Allow all origins for testing; restrict in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Request logging for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// MongoDB Connection
mongoose.connect('mongodb+srv://henri8274:1QCtcecpyFCS7oQF@cluster0.u63gt3d.mongodb.net/fone-ouvido?retryWrites=true&w=majority')
  .then(() => console.log('✅ Conectado ao MongoDB Atlas (banco: fone-ouvido)'))
  .catch(err => console.error('❌ Erro ao conectar ao MongoDB:', err));

// Schema para contatos
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { 
    type: String, 
    required: true, 
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'] 
  },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Schema para comentários
const commentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { 
    type: String, 
    required: true, 
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email inválido'] 
  },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Contact = mongoose.model('Contact', contactSchema);
const Comment = mongoose.model('Comment', commentSchema);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Novo cliente conectado: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Olá Mundo! Servidor está funcionando.' });
});

// Endpoint para contatos
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    console.log('Payload recebido (contact):', { name, email, message });
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    const contact = new Contact({ name, email, message });
    await contact.save();
    // Emitir evento para todos os clientes
    io.emit('newContact', { name, email, message, createdAt: contact.createdAt });
    res.status(201).json({ message: 'Mensagem enviada com sucesso!' });
  } catch (error) {
    console.error('Erro ao salvar contato:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Erro de validação', details: error.errors });
    }
    res.status(500).json({ error: 'Erro ao salvar a mensagem', details: error.message });
  }
});

// Endpoint para criar comentários
app.post('/api/comments', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    console.log('Payload recebido (comment):', { name, email, message });
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Nome, email e mensagem são obrigatórios' });
    }
    const comment = new Comment({ name, email, message });
    await comment.save();
    // Emitir evento para todos os clientes
    io.emit('newComment', { name, email, message, createdAt: comment.createdAt });
    res.status(201).json({ message: 'Comentário enviado com sucesso!', comment });
  } catch (error) {
    console.error('Erro ao salvar comentário:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Erro de validação', details: error.errors });
    }
    res.status(500).json({ error: 'Erro ao salvar o comentário', details: error.message });
  }
});

// Endpoint para obter comentários
app.get('/api/comments', async (req, res) => {
  try {
    const comments = await Comment.find().sort({ createdAt: -1 });
    res.status(200).json(comments);
  } catch (error) {
    console.error('Erro ao obter comentários:', error);
    res.status(500).json({ error: 'Erro ao obter comentários', details: error.message });
  }
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({ error: `Rota ${req.url} não encontrada` });
});

// Start server
server.listen(port, () => {
  console.log(`🚀 App está rodando na porta ${port}`);
});