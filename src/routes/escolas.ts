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
  
    if (!token) {
      return res.status(401).json({ error: "Token de autenticação não fornecido." });
    }
  
    try {
        const user = jwt.verify(token, JWT_SECRET!) as { id: string, nome: string, acesso: string };
        (req as any).user = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar todas as Escolas (com restrição por nível de acesso)
router.get("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    try {
        let escolas;
        if (user.acesso === 'Administrador') {
            // Admin vê todas as escolas
            escolas = await prisma.escola.findMany();
        } else {
            // Outros usuários só veem a sua própria escola
            const docente = await prisma.docente.findUnique({
                where: { id: user.id },
                select: { escolaId: true }
            });
            if (!docente || !docente.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Usuário não associado a uma escola." });
            }
            escolas = await prisma.escola.findMany({
                where: { id: docente.escolaId }
            });
        }
        res.json(escolas);
    } catch (err) {
        console.error("[API Escola] Erro ao buscar escolas: ", err);
        res.status(500).json({ error: "Erro interno ao listar escolas." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar nova Escola
router.post("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    if (user.acesso !== 'Administrador') {
        return res.status(403).json({ error: "Apenas administradores podem criar escolas." });
    }

    const { nome, endereco } = req.body;
    if (!nome) {
        return res.status(400).json({ error: "O nome da escola é obrigatório." });
    }

    try {
        const novaEscola = await prisma.escola.create({
            data: {
                nome: nome,
                endereco: endereco,
            }
        });
        res.status(201).json({ message: "Escola cadastrada com sucesso!", escola: novaEscola });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return res.status(409).json({ error: "Uma escola com este nome já existe." });
        }
        console.error("[API Escola] Erro ao cadastrar escola: ", err);
        res.status(500).json({ error: "Erro interno ao cadastrar escola." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota GET: Buscar uma Escola por ID
router.get("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "ID da escola é obrigatório." });
    }

    try {
        const escola = await prisma.escola.findUnique({
            where: { id: id }
        });
        if (!escola) {
            return res.status(404).json({ error: "Escola não encontrada." });
        }

        // Validação de acesso: apenas Admin ou usuário daquela escola pode ver
        if (user.acesso !== 'Administrador') {
            const docente = await prisma.docente.findUnique({
                where: { id: user.id },
                select: { escolaId: true }
            });
            if (docente?.escolaId !== escola.id) {
                return res.status(403).json({ error: "Acesso negado." });
            }
        }
        
        res.json(escola);
    } catch (err) {
        console.error(`[API Escola] Erro ao buscar escola ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao buscar escola." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota PUT: Editar uma Escola
router.put("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    if (user.acesso !== 'Administrador') {
        return res.status(403).json({ error: "Apenas administradores podem editar escolas." });
    }

    const { id } = req.params;
    const { nome, endereco } = req.body;

    if (!id || !nome) {
        return res.status(400).json({ error: "ID e nome da escola são obrigatórios." });
    }

    try {
        const escolaAtualizada = await prisma.escola.update({
            where: { id: id },
            data: { nome: nome, endereco: endereco }
        });
        res.json({ message: "Escola atualizada com sucesso!", escola: escolaAtualizada });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Escola não encontrada para atualização." });
        }
        console.error(`[API Escola] Erro ao editar escola ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao editar escola." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir uma Escola
router.delete("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    if (user.acesso !== 'Administrador') {
        return res.status(403).json({ error: "Apenas administradores podem excluir escolas." });
    }

    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "ID da escola é obrigatório." });
    }

    try {
        await prisma.escola.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Escola excluída com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Escola não encontrada para exclusão." });
        }
        console.error(`[API Escola] Erro ao excluir escola ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir escola." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;