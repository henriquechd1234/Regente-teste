  const mysql = require('mysql2');
  const express = require('express');
  const path = require('path');
  const cors = require('cors');
  const session= require('express-session');
  const fs = require('fs');
  const multer = require('multer');

  const app = express();
  const port = 3000;
  app.use(session({
    secret: 'segredo-temporario-para-testes-123',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  app.use(cors());
  app.use(express.json({limit: '10mb'}));
  app.use(express.static("public"));

  
  
  const cone = mysql.createConnection({
    host: 'regentte-cauadesplanches5-2f80.j.aivencloud.com',
    user: 'avnadmin',
    database: 'defaultdb',
    password: 'AVNS_7ISC-ZZEwf_msIR4-YX',
    port: '20358'
  });

  // const cone = mysql.createConnection({
  //   host: 'localhost',
  //   user: 'root',
  //   database: 'teste1',
  //   password: '',
  //   port: '3306'
  // })

  const uploadDir = path.join(__dirname, 'posts');

  // Configuração do multer para upload de imagens
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {

      cb(null, file.fieldname + '-' + Date.now() + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
    


  });

 const upload = multer({
    storage: storage,
    
   });
  app.use('/posts', express.static(path.join(__dirname, "./posts")));

  let img = null;
  app.post('/api/posts', upload.single('foto'), async (req, res) => {
    try {
      const { titulo, conteudo } = req.body;
      const save = req.file ? `/posts/${req.file.filename}` : null;
  
      if (!titulo || !conteudo) {
        return res.status(400).json({ error: "Dados incompletos" });
      }
      
      const query = 'INSERT INTO posts (titulo, conteudo, foto_url, data_criacao) VALUES (?, ?, ?, NOW())';
      
      cone.execute(query, [titulo, conteudo, save], (err, results) => {
        if (err) {
          console.error('Erro ao criar post:', err);
          return res.status(500).json({ error: "Erro interno do servidor" });
        }
        
        return res.status(201).json({ 
          success: true, 
          message: "Post criado com sucesso!",
          postId: results.insertId 
        });
      });
    } catch (error) {
      console.error('Erro no cadastro de post:', error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  // Rota para listar posts
  app.get('/api/posts', (req, res) => {
    const query = `
     SELECT * FROM posts 
    ORDER BY data_criacao DESC
    `;
    
    cone.execute(query, (err, results) => {
      if (err) {
        console.error('Erro ao buscar posts:', err);
        return res.status(500).json({ error: "Erro interno do servidor" });
      }
      
      return res.json(results);
    });
  });

  // Servir arquivos estáticos da pasta uploads
  app.use('/uploads', express.static(path.join(__dirname,  'uploads')));

  cone.connect((err) => {
    if (err) {
      console.error('Erro ao conectar ao MySQL:', err);
      return;
    }
    console.log('Conectado ao MySQL com sucesso!');
  });

  function verificarEmail(email) {
    return new Promise((resolve, reject) => {
      cone.execute('SELECT * FROM Usuarios WHERE email = ?', [email], (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        // Se encontrar algum resultado, o email já existe
        resolve(results.length > 0);
      });
    });
  }

  // Função para inserir usuário usando Promise
  function inserirUsuario(nome, email, senha) {
    return new Promise((resolve, reject) => {
      cone.execute('INSERT INTO Usuarios (nome, email, senha) VALUES (?,?,?)',
        [nome, email, senha], (err, results) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(results);
        });
    });
  }
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cadastro.html'));
  });
  app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });
  app.get('/post', (req, res)=>
  {
  res.sendFile(path.join(__dirname, 'public','post.html')); 
  })

  app.get('/health', (req, res) => {
    if (cone.state === 'authenticated') {
      res.status(200).json({ 
        status: 'OK', 
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({ 
        status: 'Service Unavailable', 
        database: 'disconnected' 
      });
    }
  });



  app.post('/api/register', async (req, res) => {
    try {
      const { nome, senha, email } = req.body;

      const emailExiste = await verificarEmail(email);

      if (emailExiste) {
        console.log("Email já registrado");
        return res.status(400).json({ error: "EMAIL ja existe" });
      }

      // Aguarda a inserção ser concluída
      await inserirUsuario(nome, email, senha);
      
      console.log('Usuario cadastrado com sucesso');
      return res.status(201).json({ 
        success: true, 
        message: "Usuário cadastrado com sucesso!" 
      });

    } catch (error) {
      console.error('Erro no cadastro:', error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  app.post('/api/login', async (req, res) => {
    try{
    const {email, senha} = req.body;
    const resultados = await verificarUsuario(email, senha);
    if (resultados.length > 0) {
      console.log('Login bem-sucedido');
      return res.status(200).json({ 
        success: true, 
        message: "Login bem-sucedido",
        usuario: resultados[0] 
      });
    }else{
      console.log('Credenciais inválidas');
      return res.status(401).json({ error: "Credenciais inválidas", success: false  });  
    }
    }catch (error) {
      console.error('Erro no login:', error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  });



  function verificarUsuario(email, senha) {
    return new Promise((resolve, reject) => {
      cone.execute("SELECT * FROM Usuarios WHERE email = ? AND senha = ?",
        [email, senha], (err, results) => {
          if (err) {
            console.log("Deu erro 3", err);
            reject(err);
            
          } else {
            resolve(results);
          }
        });
    });
  }
  process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM, encerrando servidor...');
    cone.end();
    process.exit(0);
  });
  app.listen(port, () => {
    console.log(`Server rodando na porta ${port}`);
    console.log(`Acesse: http://localhost:${port}`);
  });
