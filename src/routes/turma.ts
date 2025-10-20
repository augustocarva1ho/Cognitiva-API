import express from "express";
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware de autenticação
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
  
    if (!token) return res.status(401).json({ error: "Token de autenticação não fornecido." });
    
    try {
        // Incluído escolaId no tipo de usuário do JWT
        const user = jwt.verify(token, JWT_SECRET!) as { id: string, nome: string, acesso: string, escolaId: string };
        (req as any).user = user;
        next();
    } catch (err) {
        console.error("Erro na verificação do token:", err);
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar todas as Turmas (COM FILTRO DE ESCOLA)
router.get("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    // CORRIGIDO: Lê o ID de visualização (enviado pelo frontend)
    const viewingSchoolId = req.query.viewingSchoolId as string; 

    try {
        let whereClause: Prisma.TurmaWhereInput = {};
        
        if (user.acesso === 'Administrador') {
            // ADMIN: Filtra SOMENTE pela escola selecionada no dropdown.
            // Se o ID for vazio (''), ele não deve retornar nada.
            if (viewingSchoolId) {
                whereClause = { escolaId: viewingSchoolId };
            } else {
                // Se o Admin não selecionou uma escola (viewingSchoolId vazio) e não é Admin, retorna 403 (ou vazio, dependendo da UX)
                // Vamos retornar uma lista vazia, pois o Admin tem permissão, mas o filtro é necessário.
                return res.json([]); 
            }
        } else if (user.escolaId) {
            // Supervisor/Professor: Filtra PELA SUA PRÓPRIA ESCOLA (segurança)
            whereClause = { escolaId: user.escolaId };
        } else {
            // Usuário sem escola e não admin: Acesso negado
            return res.status(403).json({ error: "Usuário não associado a uma escola para visualização." });
        }

        const turmas = await prisma.turma.findMany({
            where: whereClause,
            include: { Alunos: { select: { id: true } } }
        });
        res.json(turmas);
    } catch (err) {
        console.error("[API Turma] Erro ao buscar turmas: ", err);
        res.status(500).json({ error: "Erro interno ao listar turmas." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar nova Turma (ATRIBUI ESCOLA ID)
router.post("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { Nome, escolaId } = req.body as { Nome: string, escolaId: string };
    
    let finalEscolaId: string;

    // CORRIGIDO: Atribuição baseada na permissão e no ID de visualização (se Admin)
    if (user.acesso === 'Administrador' && escolaId) {
        finalEscolaId = escolaId;
    } else if (user.escolaId) {
        finalEscolaId = user.escolaId;
    } else {
        return res.status(403).json({ error: "Usuário não associado a uma escola para cadastro." });
    }

    if (!Nome) {
        return res.status(400).json({ error: "Nome da turma é obrigatório." });
    }

    try {
        const novaTurma = await prisma.turma.create({
            data: {
                Nome: Nome,
                escolaId: finalEscolaId, // Atribui a FK diretamente
            }
        });
        res.status(201).json({ message: "Turma cadastrada com sucesso!", turma: novaTurma });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return res.status(409).json({ error: "Uma turma com este nome já existe." });
        }
        console.error("[API Turma] Erro ao cadastrar turma: ", err);
        res.status(500).json({ error: "Erro interno ao cadastrar turma." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota PUT: Editar Turma (COM FILTRO DE ESCOLA)
router.put("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    const { Nome, escolaId } = req.body as { Nome: string, escolaId: string };

    if (!id) {
        return res.status(400).json({ error: "ID da turma é obrigatório." });
    }

    try {
        // 1. Validação de Permissão (verifica se a turma pertence à escola do usuário logado)
        if (user.acesso !== 'Administrador' && user.escolaId) {
            const turma = await prisma.turma.findUnique({ where: { id: id }, select: { escolaId: true } });
            if (turma?.escolaId !== user.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Tentativa de editar turma de outra escola." });
            }
        }

        // 2. Determina qual escolaId usar (Admin pode trocar a escola, outros não)
        const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;


        const turmaAtualizada = await prisma.turma.update({
            where: { id: id },
            data: {
                Nome: Nome,
                escolaId: finalEscolaId, // Atribui a FK diretamente
            }
        });
        res.json({ message: "Turma atualizada com sucesso!", turma: turmaAtualizada });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Turma não encontrada para atualização." });
        }
        console.error(`[API Turma] Erro ao editar turma ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao editar turma." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir Turma (COM FILTRO DE ESCOLA)
router.delete("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "ID da turma é obrigatório." });
    }

    try {
        // Validação de Permissão: Garante que apenas Admin ou o Docente daquela escola exclua.
        if (user.acesso !== 'Administrador' && user.escolaId) {
            const turma = await prisma.turma.findUnique({ where: { id: id }, select: { escolaId: true } });
            if (turma?.escolaId !== user.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Tentativa de excluir turma de outra escola." });
            }
        }

        await prisma.turma.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Turma excluída com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Turma não encontrada para exclusão." });
        }
        console.error(`[API Turma] Erro ao excluir turma ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir turma." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;
