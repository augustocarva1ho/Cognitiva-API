import express from "express";
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const router = express.Router();
const prisma = new PrismaClient();
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET; // Garante que a chave é lida aqui

// Função para buscar o ID do Nível de Acesso pelo NOME (para o connect)
const getAcessoIdByNome = async (nome: string) => {
    // Usamos findFirst para evitar conflitos de tipagem do findUnique no TS/Prisma
    const acesso = await prisma.acesso.findFirst({
        where: { nome: nome },
        select: { id: true }
    });
    return acesso?.id;
};

// Middleware de autenticação
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "Token de autenticação não fornecido." });
    
    try {
        const user = jwt.verify(token, JWT_SECRET!) as { id: string, nome: string, acesso: string, escolaId: string };
        (req as any).user = user; // Injeta o usuário na requisição
        next();
    } catch (err) {
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar todos os Docentes (COM FILTRO DE ESCOLA)
router.get("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    // CRÍTICO: Lê o ID de visualização do Admin (se fornecido pelo frontend)
    const viewingSchoolId = req.query.viewingSchoolId as string; 
    
    try {
        let whereClause: Prisma.DocenteWhereInput = {};
        
        if (user.acesso === 'Administrador' && viewingSchoolId) {
            // ADMIN: Filtra pela escola que está a ser visualizada
            whereClause = { escolaId: viewingSchoolId };
        } else if (user.acesso !== 'Administrador' && user.escolaId) {
            // Supervisor/Professor: Filtra PELA SUA PRÓPRIA ESCOLA (segurança)
            whereClause = { escolaId: user.escolaId };
        } else if (user.acesso !== 'Administrador' && !user.escolaId) {
             // Usuário sem escola: Acesso negado
             return res.status(403).json({ error: "Usuário não associado a uma escola para visualização." });
        }
        // Se for Admin mas não forneceu viewingSchoolId, retorna lista vazia (o frontend cuida da mensagem)


        const docentes = await prisma.docente.findMany({
            where: whereClause,
            select: {
                id: true,
                nome: true,
                email: true,
                registro: true,
                escolaId: true, // Inclui a FK
                acesso: { select: { nome: true } }
            },
        });
        res.json(docentes);
    } catch (err) {
        console.error("[API Docente] Erro ao buscar docentes: ", err);
        res.status(500).json({ error: "Erro interno ao listar docentes." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar novo Docente (ATRIBUI ESCOLA ID)
router.post("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    // Tipagem forçada para string para evitar erro 'any'
    const { registro, nome, email, cpf, senha, materia, turmas, nivelAcesso, escolaId } = req.body as {
        registro: string, nome: string, email: string, cpf: string, senha: string,
        materia: string, turmas: string[], nivelAcesso: string, escolaId: string
    };
    
    // Apenas Admin pode criar para outras escolas. Se não for Admin, usa a escola do próprio usuário logado.
    const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;

    if (!senha || !finalEscolaId || !nivelAcesso) {
        return res.status(400).json({ error: "Senha, Nível de Acesso e ID da escola são obrigatórios." });
    }
    
    try {
        // 1. BUSCA O ID DA ROLE PELO NOME
        const acessoId = await getAcessoIdByNome(nivelAcesso);
        if (!acessoId) {
            return res.status(404).json({ error: `Nível de acesso '${nivelAcesso}' não encontrado.` });
        }
        
        const hashedPassword = await bcrypt.hash(senha, SALT_ROUNDS);

        const novoDocente = await prisma.docente.create({
            data: {
                nome: nome,
                email: email,
                registro: registro,
                senha: hashedPassword,
                escola: { connect: { id: escolaId } }, // Atribui a FK diretamente
                acesso: { connect: { id: acessoId } } // Conecta por ID
            },
            select: { nome: true, registro: true, email: true }
        });

        res.status(201).json({ message: "Docente cadastrado com sucesso!", docente: novoDocente });

    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return res.status(409).json({ error: "O código de registro ou e-mail já existe." });
        }
        console.error("[API Docente] Erro ao cadastrar docente: ", err);
        res.status(500).json({ error: "Erro interno ao cadastrar docente." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota PUT: Editar Docente (ATUALIZAÇÃO DE ROLE POR ID)
router.put("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
     // Tipagem forçada para string para evitar erro 'any'
    const { nome, email, cpf, materia, turmas, nivelAcesso, escolaId } = req.body as {
        nome: string, email: string, cpf: string, materia: string, turmas: string[], nivelAcesso: string, escolaId: string
    };
    
    if (!id) {
        return res.status(400).json({ error: "ID do docente é obrigatório." });
    }

    try {
        // 1. Validação de Permissão: Garante que apenas Admin ou o Supervisor/Professor daquela escola edite.
        if (user.acesso !== 'Administrador' && user.escolaId) {
            const docente = await prisma.docente.findUnique({ where: { id: id }, select: { escolaId: true } });
            if (docente?.escolaId !== user.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Tentativa de editar docente de outra escola." });
            }
        }

        // 2. BUSCA O ID DA ROLE PELO NOME
        const acessoId = await getAcessoIdByNome(nivelAcesso);
        if (!acessoId) {
            return res.status(404).json({ error: `Nível de acesso '${nivelAcesso}' não encontrado.` });
        }

        // 3. Determina qual escolaId usar (Admin pode trocar a escola, outros não)
        const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;


        const docenteAtualizado = await prisma.docente.update({
            where: { id: id },
            data: {
                nome: nome,
                email: email,
                escola: { connect: { id: escolaId } }, // Atribui a FK diretamente
                acesso: { connect: { id: acessoId } } // Conecta por ID
            },
        });

        res.json({ message: "Docente atualizado com sucesso!", docente: docenteAtualizado });

    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Docente não encontrado para atualização." });
        }
        console.error(`[API Docente] Erro ao editar docente ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao editar docente." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir Docente (COM FILTRO DE ESCOLA)
router.delete("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "ID do docente é obrigatório." });
    }

    try {
        // Validação de Permissão: Garante que apenas Admin ou o Docente daquela escola exclua.
        if (user.acesso !== 'Administrador' && user.escolaId) {
            const docente = await prisma.docente.findUnique({ where: { id: id }, select: { escolaId: true } });
            if (docente?.escolaId !== user.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Tentativa de excluir docente de outra escola." });
            }
        }

        await prisma.docente.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Docente excluído com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Docente não encontrado para exclusão." });
        }
        console.error(`[API Docente] Erro ao excluir docente ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir docente." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;
