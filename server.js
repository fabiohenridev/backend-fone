const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const http      = require('http');
const { Server }= require('socket.io');
const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');
const sanitize  = require('mongo-sanitize');

const app  = express();
const port = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server,{
  cors:{
    origin: process.env.NODE_ENV==='production'
            ? ['https://foness.vercel.app']
            : '*',
    methods:['GET','POST'],
    allowedHeaders:['Content-Type'],
  },
  pingTimeout: 60000,
  pingInterval:25000,
});

/* ---------- MIDDLEWARE ---------- */
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV==='production'
          ? ['https://foness.vercel.app']
          : '*',
  methods:['GET','POST'],
  allowedHeaders:['Content-Type'],
}));
app.use(rateLimit({
  windowMs:15*60*1000,max:100,
  message:'Muitas requisições. Tente novamente mais tarde.'
}));
app.use((req,res,next)=>{
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ---------- MONGODB ---------- */
mongoose.connect('mongodb+srv://USUARIO:SENHA@cluster0.u63gt3d.mongodb.net/fone-ouvido?retryWrites=true&w=majority',{
  serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,
  socketTimeoutMS:45000,maxPoolSize:10,
})
.then(()=>console.log('✅ Conectado ao MongoDB'))
.catch(err=>console.error('❌ Erro ao conectar:',err.message));

/* ---------- SCHEMAS ---------- */
const userSchema=new mongoose.Schema({
  user:{type:String,required:true,unique:true,trim:true,maxlength:20},
  email:{
    type:String,required:true,trim:true,
    match:[/^[^\s@]+@[^\s@]+\.[^\s@]+$/,'Email inválido']
  },
  createdAt:{type:Date,default:Date.now},
});
const commentSchema=new mongoose.Schema({
  user:{type:String,required:true,trim:true},
  email:{
    type:String,required:true,trim:true,
    match:[/^[^\s@]+@[^\s@]+\.[^\s@]+$/,'Email inválido']
  },
  message:{type:String,required:true,trim:true},
  createdAt:{type:Date,default:Date.now},
});
const User    = mongoose.model('User',userSchema);
const Comment = mongoose.model('Comment',commentSchema);

/* ---------- SOCKET.IO ---------- */
io.on('connection',socket=>{
  console.log(`Cliente ${socket.id} conectado`);
  socket.on('disconnect',reason=>console.log(`Cliente ${socket.id} saiu: ${reason}`));
});

/* ---------- ROTAS ---------- */
app.get('/',(req,res)=>res.json({status:'OK',timestamp:new Date().toISOString()}));
app.get('/ping',(req,res)=>res.json({status:'OK',timestamp:new Date().toISOString()}));

/* ---- criar comentário ---- */
app.post('/api/comments',async (req,res)=>{
  try{
    const {user,email,message}=req.body;
    if(!user||!email||!message)
      return res.status(400).json({error:'Usuário, email e mensagem são obrigatórios'});

    /* cria usuário se não existir */
    let existing=await User.findOne({user});
    if(!existing){
      existing=new User({user,email});
      await existing.save().catch(err=>{
        if(err.code===11000)
          return res.status(409).json({error:'Usuário já existe'});
        throw err;
      });
    }

    const comment=new Comment({user,email,message});
    await comment.save();

    io.emit('newComment',{...comment.toObject()});
    res.status(201).json({message:'Comentário enviado com sucesso!',comment});
  }catch(err){
    console.error('Erro ao salvar comentário:',err);
    res.status(500).json({error:'Erro ao salvar comentário',details:err.message});
  }
});

/* ---- obter comentários ---- */
app.get('/api/comments',async (req,res)=>{
  try{
    const comments=await Comment.find().sort({createdAt:-1}).limit(50).lean();
    res.json(comments);
  }catch(err){
    console.error('Erro ao obter comentários:',err);
    res.status(500).json({error:'Erro ao obter comentários',details:err.message});
  }
});

/* ---- 404 ---- */
app.use((req,res)=>res.status(404).json({error:`Rota ${req.url} não encontrada`}));

/* ---------- INICIAR ---------- */
server.listen(port,()=>console.log(`🚀 Servidor rodando na porta ${port}`));
