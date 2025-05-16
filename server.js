const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware para parsing de JSON e permitir CORS
app.use(express.json());
app.use(cors());

// Conectando ao MongoDB Atlas usando o banco 'fone-ouvido'
mongoose.connect('mongodb+srv://henri8274:1QCtcecpyFCS7oQF@cluster0.u63gt3d.mongodb.net/fone-ouvido?retryWrites=true&w=majority')
  .then(() => console.log('✅ Conectado ao MongoDB Atlas (banco: fone-ouvido)'))
  .catch(err => console.error('❌ Erro ao conectar ao MongoDB:', err));

// Schema para o formulário de contato
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Modelo para o formulário de contato
const Contact = mongoose.model('Contact', contactSchema);

// Rota inicial
app.get('/', (req, res) => {
  res.send('Olá Mundo!');
});

// Rota para salvar o formulário de contato
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

app.listen(port, () => {
  console.log(`🚀 App está rodando na porta ${port}`);
});