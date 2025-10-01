const mysql = require('mysql2');
const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const fs = require('fs');
const fetch = require('node-fetch');

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
app.use(express.urlencoded({ extended: true }));
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
// ✅ ROTA PARA LISTAR POSTS COM INFO DE CURTIDAS E COMENTÁRIOS
app.get('/api/posts', (req, res) => {
    const usuarioId = req.session.usuarioId || null;
    
    const query = `
        SELECT p.*, 
               COUNT(DISTINCT c.id) as curtidas_count,
               COUNT(DISTINCT com.id) as comentarios_count,
               EXISTS(
                   SELECT 1 FROM curtidas c2 
                   WHERE c2.post_id = p.id AND c2.usuario_id = ?
               ) as usuario_curtiu
        FROM posts p
        LEFT JOIN curtidas c ON p.id = c.post_id
        LEFT JOIN comentarios com ON p.id = com.post_id
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

        cone.execute('SELECT * FROM posts WHERE id = ?', [postId], (err, postResults) => {
            if (err) {
                console.error('Erro ao verificar post:', err);
                return res.status(500).json({ error: "Erro interno do servidor" });
            }

            if (postResults.length === 0) {
                return res.status(404).json({ error: 'Post não encontrado' });
            }

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
        'SELECT id, nome, email FROM Usuarios WHERE id = ?',
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

// ✅ CORRIGINDO ROTA DE LOGIN
app.post('/api/login', async (req, res) => {
    try {
        console.log('📥 Dados recebidos no login:', req.body);
        
        const { email, senha } = req.body;
        
        if (!email || !senha) {
            return res.status(400).json({ 
                success: false, 
                error: "Email e senha são obrigatórios" 
            });
        }

        const resultados = await verificarUsuario(email, senha);
        
        if (resultados.length > 0) {
            // Salvar usuário na sessão
            req.session.usuarioId = resultados[0].id;
            req.session.usuarioNome = resultados[0].nome;
            
            console.log('✅ Login bem-sucedido para:', resultados[0].nome);
            
            return res.json({ 
                success: true, 
                message: "Login bem-sucedido",
                usuario: resultados[0] 
            });
        } else {
            console.log('❌ Credenciais inválidas para:', email);
            return res.status(401).json({ 
                success: false, 
                error: "Credenciais inválidas" 
            });
        }
    } catch (error) {
        console.error('❌ Erro no login:', error);
        return res.status(500).json({ 
            success: false, 
            error: "Erro interno do servidor" 
        });
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

// ✅ ROTA PARA ADICIONAR COMENTÁRIOS - VERSÃO CORRIGIDA
app.post('/api/posts/:postId/comentarios', async (req, res) => {
    try {
        const { postId } = req.params;
        const { conteudo } = req.body;
        const usuarioId = req.session.usuarioId;

        console.log('📥 Recebendo comentário:', { postId, usuarioId, conteudo });

        if (!usuarioId) {
            return res.status(401).json({
                success: false,
                error: "Usuário não autenticado"
            });
        }

        if (!conteudo || conteudo.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: 'Conteúdo do comentário é obrigatório' 
            });
        }

        // Usar promise wrapper
        const promiseConnection = cone.promise();

        // Verificar se o post existe
        const [post] = await promiseConnection.execute(
            'SELECT id FROM posts WHERE id = ?',
            [postId]
        );

        if (post.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Post não encontrado' 
            });
        }

        // Buscar nome do usuário
        const [usuario] = await promiseConnection.execute(
            'SELECT nome FROM Usuarios WHERE id = ?',
            [usuarioId]
        );

        if (usuario.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Usuário não encontrado' 
            });
        }

        // CORREÇÃO: Usar 'comentario' em vez de 'conteudo' e não incluir 'autor'
        const [result] = await promiseConnection.execute(
            `INSERT INTO comentarios (post_id, usuario_id, comentario, data_criacao) 
             VALUES (?, ?, ?, NOW())`,
            [postId, usuarioId, conteudo.trim()]
        );

        console.log('✅ Comentário adicionado com sucesso');

        res.status(201).json({
            success: true,
            message: 'Comentário adicionado com sucesso',
            comentarioId: result.insertId,
            autor: usuario[0].nome, // Retornar o nome do usuário da tabela Usuarios
            data_criacao: new Date().toISOString()
        });

    } catch (error) {
        console.error("❌ Erro ao adicionar comentário:", error);
        res.status(500).json({ 
            success: false,
            error: 'Erro interno do servidor: ' + error.message
        });
    }
});

// ✅ ROTA PARA BUSCAR COMENTÁRIOS - VERSÃO CORRIGIDA
app.get('/api/posts/:postId/comentarios', async (req, res) => {
    try {
        const { postId } = req.params;

        console.log('🔍 Buscando comentários para o post:', postId);

        // Usar promise wrapper
        const promiseConnection = cone.promise();

        // CORREÇÃO: Usar JOIN para buscar o nome do usuário e 'comentario' em vez de 'conteudo'
        const [comentarios] = await promiseConnection.execute(
            `SELECT 
                c.id,
                c.comentario as conteudo,  -- CORREÇÃO: usar alias para manter compatibilidade com frontend
                c.data_criacao,
                c.usuario_id,
                u.nome as autor            -- Buscar nome da tabela Usuarios
                FROM comentarios c
                INNER JOIN Usuarios u ON c.usuario_id = u.id
                WHERE c.post_id = ?
                ORDER BY c.data_criacao DESC`,
            [postId]
        );

        console.log(`✅ Encontrados ${comentarios.length} comentários para o post ${postId}`);

        res.json(comentarios);

    } catch (error) {
        console.error('❌ Erro ao buscar comentários:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erro interno do servidor: ' + error.message
        });
    }
});


app.post('/api/register', async (req, res) => {
    try {
        console.log('📥 Dados recebidos no cadastro:', req.body);
        
        const { nome, senha, email } = req.body;

        // Validação dos dados
        if (!nome || !senha || !email) {
            console.log('❌ Campos faltando:', { nome, email, senha: senha ? '***' : 'faltando' });
            return res.status(400).json({ 
                success: false, 
                error: "Todos os campos são obrigatórios" 
            });
        }

        const emailExiste = await verificarEmail(email);

        if (emailExiste) {
            return res.status(400).json({ 
                success: false, 
                error: "Email já existe" 
            });
        }

        await inserirUsuario(nome, email, senha);
        
        console.log('✅ Usuário cadastrado com sucesso:', nome);
        
        return res.json({ 
            success: true, 
            message: "Usuário cadastrado com sucesso!" 
        });

    } catch (error) {
        console.error('❌ Erro no cadastro:', error);
        return res.status(500).json({ 
            success: false, 
            error: "Erro interno do servidor" 
        });
    }
})

// Conexão com o banco
cone.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao MySQL:', err);
        return;
    }
    console.log('✅ Conectado ao MySQL com sucesso!');
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
        cone.execute('INSERT INTO Usuarios (nome, email, senha) VALUES (?, ?, ?)',
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
        cone.execute("SELECT * FROM Usuarios WHERE email = ? AND senha = ?",
            [email, senha], (err, results) => {
                if (err) {
                    console.error("❌ Erro na verificação:", err);
                    reject(err);
                } else {
                    console.log("🔍 Resultados da verificação:", results);
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

process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM, encerrando servidor...');
    cone.end();
    process.exit(0);
});

app.listen(port, () => {
    console.log(`🚀 Server rodando na porta ${port}`);
    console.log(`📍 Acesse: http://localhost:${port}`);
});
