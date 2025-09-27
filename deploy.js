const mysql = require('mysql2');
const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const fs = require('fs');
const fetch = require('node-fetch');
const router = express.Router();

const app = express();
const port = process.env.PORT || 3000;

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

// ✅ MIDDLEWARE DE AUTENTICAÇÃO
function authMiddleware(req, res, next) {
    if (!req.session.usuarioId) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
}

// ✅ ROTA PARA CRIAR POSTS
app.post('/api/posts', async (req, res) => {
    try {
        const { titulo, conteudo, imagem_base64 } = req.body;
        
        if (!titulo || !conteudo) {
            return res.status(400).json({ error: "Dados incompletos" });
        }

        let foto_url = null;

        // Upload para ImgBB se tiver imagem
        if (imagem_base64) {
            console.log('📤 Fazendo upload para ImgBB...');
            
            const base64Data = imagem_base64.split(',')[1];
            
            const formData = new URLSearchParams();
            formData.append('key', process.env.IMGBB_API_KEY || '350fbab0c0ca8b5d3f85a0c1139tcda');
            formData.append('image', base64Data);
            
            const response = await fetch('https://api.imgbb.com/1/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                foto_url = data.data.url;
                console.log('✅ Imagem salva na nuvem:', foto_url);
            } else {
                console.error('❌ Erro ImgBB:', data.error);
                return res.status(500).json({ error: "Erro ao salvar imagem" });
            }
        }

        // Salvar no banco
        const query = 'INSERT INTO posts (titulo, conteudo, foto_url, data_criacao) VALUES (?, ?, ?, NOW())';
        
        cone.execute(query, [titulo, conteudo, foto_url], (err, results) => {
            if (err) {
                console.error('Erro ao salvar no banco:', err);
                return res.status(500).json({ error: "Erro interno do servidor" });
            }
            
            res.status(201).json({ 
                success: true, 
                message: "Post criado com sucesso!",
                postId: results.insertId
            });
        });
        
    } catch (error) {
        console.error('Erro no cadastro de post:', error);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ✅ ROTA PARA LISTAR POSTS COM INFO DE CURTIDAS
app.get('/api/posts', (req, res) => {
    const usuarioId = req.session.usuarioId || null;
    
    const query = `
        SELECT p.*, 
               COUNT(c.id) as curtidas_count,
               EXISTS(
                   SELECT 1 FROM curtidas c2 
                   WHERE c2.post_id = p.id AND c2.usuario_id = ?
               ) as usuario_curtiu
        FROM posts p
        LEFT JOIN curtidas c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.data_criacao DESC
    `;
    
    cone.execute(query, [usuarioId], (err, results) => {
        if (err) {
            console.error('Erro ao buscar posts:', err);
            return res.status(500).json({ error: "Erro interno do servidor" });
        }
        
        return res.json(results);
    });
});

// ✅ ROTA PARA CURTIR/DESCURTIR POSTS
app.post('/api/posts/:id/curtir', authMiddleware, (req, res) => {
    try {
        const postId = req.params.id;
        const usuarioId = req.session.usuarioId;

        // Verificar se post existe
        cone.execute('SELECT * FROM posts WHERE id = ?', [postId], (err, postResults) => {
            if (err) {
                console.error('Erro ao verificar post:', err);
                return res.status(500).json({ error: "Erro interno do servidor" });
            }

            if (postResults.length === 0) {
                return res.status(404).json({ error: 'Post não encontrado' });
            }

            // Verificar se já curtiu
            cone.execute(
                'SELECT * FROM curtidas WHERE post_id = ? AND usuario_id = ?',
                [postId, usuarioId],
                (err, curtidaResults) => {
                    if (err) {
                        console.error('Erro ao verificar curtida:', err);
                        return res.status(500).json({ error: "Erro interno do servidor" });
                    }

                    if (curtidaResults.length > 0) {
                        // Descurtir
                        cone.execute(
                            'DELETE FROM curtidas WHERE post_id = ? AND usuario_id = ?',
                            [postId, usuarioId],
                            (err, deleteResults) => {
                                if (err) {
                                    console.error('Erro ao descurtir:', err);
                                    return res.status(500).json({ error: "Erro interno do servidor" });
                                }
                                res.json({ 
                                    curtida: false,
                                    message: 'Curtida removida'
                                });
                            }
                        );
                    } else {
                        // Curtir
                        cone.execute(
                            'INSERT INTO curtidas (post_id, usuario_id) VALUES (?, ?)',
                            [postId, usuarioId],
                            (err, insertResults) => {
                                if (err) {
                                    console.error('Erro ao curtir:', err);
                                    return res.status(500).json({ error: "Erro interno do servidor" });
                                }
                                res.json({ 
                                    curtida: true,
                                    message: 'Post curtido'
                                });
                            }
                        );
                    }
                }
            );
        });
    } catch (error) {
        console.error('Erro ao processar curtida:', error);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ✅ ROTA PARA OBTER INFORMAÇÕES DO USUÁRIO LOGADO
app.get('/api/user-info', (req, res) => {
    if (!req.session.usuarioId) {
        return res.json({ loggedIn: false });
    }

    cone.execute(
        'SELECT id, nome, email FROM usuarios WHERE id = ?',
        [req.session.usuarioId],
        (err, results) => {
            if (err || results.length === 0) {
                return res.json({ loggedIn: false });
            }

            res.json({
                loggedIn: true,
                user: results[0]
            });
        }
    );
});

// ✅ MODIFICAR ROTA DE LOGIN PARA SALVAR SESSÃO
app.post('/api/login', async (req, res) => {
    try {
        const {email, senha} = req.body;
        const resultados = await verificarUsuario(email, senha);
        
        if (resultados.length > 0) {
            // Salvar usuário na sessão
            req.session.usuarioId = resultados[0].id;
            req.session.usuarioNome = resultados[0].nome;
            
            return res.status(200).json({ 
                success: true, 
                message: "Login bem-sucedido",
                usuario: resultados[0] 
            });
        } else {
            return res.status(401).json({ error: "Credenciais inválidas", success: false });
        }
    } catch (error) {
        console.error('Erro no login:', error);
        return res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// ✅ ROTA DE LOGOUT
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Erro ao fazer logout" });
        }
        res.json({ success: true, message: "Logout realizado com sucesso" });
    });
});

// Conexão com o banco
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
            resolve(results.length > 0);
        });
    });
}

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

function verificarUsuario(email, senha) {
    return new Promise((resolve, reject) => {
        cone.execute("SELECT * FROM tes WHERE email = ? AND senha = ?",
            [email, senha], (err, results) => {
                if (err) {
                    console.log("Erro na verificação:", err);
                    reject(err);
                } else {
                    resolve(results);
                }
            });
    });
}

// Rotas de páginas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cadastro.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/enviar', (req, res) => {
    res.sendFile(path.join(__dirname, 'public','enviarposts.html'));
});

app.get('/posts', (req, res) => {
    res.sendFile(path.join(__dirname, 'public','posts.html'));
});

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
            return res.status(400).json({ error: "EMAIL ja existe" });
        }

        await inserirUsuario(nome, email, senha);
        
        return res.status(201).json({ 
            success: true, 
            message: "Usuário cadastrado com sucesso!" 
        });

    } catch (error) {
        console.error('Erro no cadastro:', error);
        return res.status(500).json({ error: "Erro interno do servidor" });
    }
});

process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM, encerrando servidor...');
    cone.end();
    process.exit(0);
});

app.listen(port, () => {
    console.log(`Server rodando na porta ${port}`);
    console.log(`Acesse: http://localhost:${port}`);
});
