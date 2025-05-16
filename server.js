const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

mongoose.connect('mongodb+srv://henri8274:1QCtcecpyFCS7oQF@cluster0.u63gt3d.mongodb.net/fone-ouvido?retryWrites=true&w=majority')
  .then(() => console.log('✅ Conectado ao MongoDB Atlas (banco: fone-ouvido)'))
  .catch(err => console.error('❌ Erro ao conectar ao MongoDB:', err));

// Schema para contatos
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Schema para comentários
const commentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Contact = mongoose.model('Contact', contactSchema);
const Comment = mongoose.model('Comment', commentSchema);

app.get('/', (req, res) => {
  res.send('Olá Mundo!');
});

// Endpoint para contatos
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    const contact = new Contact({ name, email, message });
    await contact.save();
    res.status(201).json({ message: 'Mensagem enviada com sucesso!' });
  } catch (error) {
    console.error('Erro ao salvar contato:', error);
    res.status(500).json({ error: 'Erro ao salvar a mensagem' });
  }
});

// Endpoint para criar comentários
app.post('/api/comments', async (req, res) => {
  try {
    const { name, message } = req.body;
    if (!name || !message) {
      return res.status(400).json({ error: 'Nome e mensagem são obrigatórios' });
    }
    const comment = new Comment({ name, message });
    await comment.save();
    res.status(201).json({ message: 'Comentário enviado com sucesso!', comment });
  } catch (error) {
    console.error('Erro ao salvar comentário:', error);
    res.status(500).json({ error: 'Erro ao salvar o comentário' });
  }
});

// Endpoint para obter comentários
app.get('/api/comments', async (req, res) => {
  try {
    const comments = await Comment.find().sort({ createdAt: -1 });
    res.status(200).json(comments);
  } catch (error) {
    console.error('Erro ao obter comentários:', error);
    res.status(500).json({ error: 'Erro ao obter comentários' });
  }
});

app.listen(port, () => {
  console.log(`🚀 App está rodando na porta ${port}`);
});