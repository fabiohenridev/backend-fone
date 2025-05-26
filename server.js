const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const sanitize = require('mongo-sanitize');
const axios = require('axios'); // Adicionado para chamadas à API de geolocalização

const app = express();
const port = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? ['https://foness.vercel.app'] : '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ['https://foness.vercel.app'] : '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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
const visitSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  location: {
    latitude: { type: Number },
    longitude: { type: Number },
    country: { type: String },
    city: { type: String }
  },
  ip: { type: String }
});

const Visit = mongoose.model('Visit', visitSchema);

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);
  socket.on('disconnect', (reason) => console.log(`Cliente desconectado: ${socket.id}, motivo: ${reason}`));
  socket.on('error', (error) => console.error(`Erro Socket.IO: ${error.message}`));
});

// Função para obter localização por IP
async function getLocationFromIP(ip) {
  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}`);
    if (response.data.status === 'success') {
      return {
        latitude: response.data.lat,
        longitude: response.data.lon,
        country: response.data.country,
        city: response.data.city
      };
    }
    return {};
  } catch (error) {
    console.error('Erro ao obter localização por IP:', error.message);
    return {};
  }
}

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Servidor OK', status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/ping', (req, res) => {
  console.log(`[${new Date().toISOString()}] Ping recebido`);
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Rota para registrar uma nova visita
app.post('/api/visits', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const location = await getLocationFromIP(ip);
    const visit = new Visit({ ip, location });
    await visit.save();
    io.emit('newVisit', { totalVisits: await Visit.countDocuments(), location });
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

// Rota para obter estatísticas de localização
app.get('/api/visits/locations', async (req, res) => {
  try {
    const visits = await Visit.find().lean();
    const countByCountry = visits.reduce((acc, visit) => {
      const country = visit.location?.country || 'Desconhecido';
      acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {});
    const countByCity = visits.reduce((acc, visit) => {
      const city = visit.location?.city || 'Desconhecida';
      acc[city] = (acc[city] || 0) + 1;
      return acc;
    }, {});
    res.status(200).json({ visits, countByCountry, countByCity });
  } catch (error) {
    console.error('Erro ao obter estatísticas de localização:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas', details: error.message });
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