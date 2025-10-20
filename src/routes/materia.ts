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
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar todas as Matérias (COM FILTRO DE ESCOLA)
router.get("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const viewingSchoolId = req.query.viewingSchoolId as string; 

    try {
        let whereClause: Prisma.MateriaWhereInput = {};
        
        if (user.acesso === 'Administrador' && viewingSchoolId) {
            // ADMIN: Filtra pela escola selecionada
            whereClause = { escolaId: viewingSchoolId };
        } else if (user.acesso !== 'Administrador' && user.escolaId) {
            // Supervisor/Professor: Filtra PELA SUA PRÓPRIA ESCOLA
            whereClause = { escolaId: user.escolaId };
        } else if (user.acesso !== 'Administrador' && !user.escolaId) {
            return res.status(403).json({ error: "Usuário não associado a uma escola para visualização." });
        } else if (user.acesso === 'Administrador' && !viewingSchoolId) {
             // Admin logado mas sem escola selecionada (retorna vazio para exibir a mensagem no frontend)
             return res.json([]); 
        }

        const materias = await prisma.materia.findMany({
            where: whereClause,
            include: { atividades: { select: { id: true } } }
        });
        res.json(materias);
    } catch (err) {
        console.error("[API Materia] Erro ao buscar matérias: ", err);
        res.status(500).json({ error: "Erro interno ao listar matérias." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar nova Matéria (ATRIBUI ESCOLA ID)
router.post("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { nome, escolaId } = req.body as { nome: string, escolaId: string };
    
    // Apenas Admin e Supervisor podem criar matérias (Professor não tem permissão de CRUD)
    if (user.acesso === 'Professor') {
        return res.status(403).json({ error: "Professores não têm permissão para cadastrar matérias." });
    }
    
    let finalEscolaId: string;

    // Lógica de atribuição: Se for Admin E forneceu um ID, usa o ID fornecido.
    if (user.acesso === 'Administrador' && escolaId) {
        finalEscolaId = escolaId;
    } else if (user.escolaId) {
        finalEscolaId = user.escolaId;
    } else {
        return res.status(403).json({ error: "Usuário não associado a uma escola para cadastro." });
    }

    if (!nome) {
        return res.status(400).json({ error: "Nome da matéria é obrigatório." });
    }

    try {
        const novaMateria = await prisma.materia.create({
            data: {
                nome: nome,
                escolaId: finalEscolaId, // Atribui a FK diretamente
            }
        });
        res.status(201).json({ message: "Matéria cadastrada com sucesso!", materia: novaMateria });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return res.status(409).json({ error: "Uma matéria com este nome já existe." });
        }
        console.error("[API Materia] Erro ao cadastrar matéria: ", err);
        res.status(500).json({ error: "Erro interno ao cadastrar matéria." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota PUT: Editar Matéria (COM FILTRO DE ESCOLA)
router.put("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    const { nome, escolaId } = req.body as { nome: string, escolaId: string };

    // Apenas Admin e Supervisor podem editar matérias
    if (user.acesso === 'Professor') {
        return res.status(403).json({ error: "Professores não têm permissão para editar matérias." });
    }

    if (!id) {
        return res.status(400).json({ error: "ID da matéria é obrigatório." });
    }

    try {
        // 1. Validação de Permissão (verifica se a matéria pertence à escola do usuário logado)
        if (user.acesso !== 'Administrador' && user.escolaId) {
            const materia = await prisma.materia.findUnique({ where: { id: id }, select: { escolaId: true } });
            if (materia?.escolaId !== user.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Tentativa de editar matéria de outra escola." });
            }
        }

        // 2. Determina qual escolaId usar (Admin pode trocar a escola, outros não)
        const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;


        const materiaAtualizada = await prisma.materia.update({
            where: { id: id },
            data: {
                nome: nome,
                escolaId: finalEscolaId, // Atribui a FK diretamente
            }
        });
        res.json({ message: "Matéria atualizada com sucesso!", materia: materiaAtualizada });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Matéria não encontrada para atualização." });
        }
        console.error(`[API Materia] Erro ao editar matéria ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao editar matéria." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir Matéria (COM FILTRO DE ESCOLA)
router.delete("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;

    // Apenas Admin e Supervisor podem excluir matérias
    if (user.acesso === 'Professor') {
        return res.status(403).json({ error: "Professores não têm permissão para excluir matérias." });
    }

    if (!id) {
        return res.status(400).json({ error: "ID da matéria é obrigatório." });
    }

    try {
        // Validação de Permissão: Garante que apenas Admin ou o Docente daquela escola exclua.
        if (user.acesso !== 'Administrador' && user.escolaId) {
            const materia = await prisma.materia.findUnique({ where: { id: id }, select: { escolaId: true } });
            if (materia?.escolaId !== user.escolaId) {
                return res.status(403).json({ error: "Acesso negado: Tentativa de excluir matéria de outra escola." });
            }
        }

        await prisma.materia.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Matéria excluída com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Matéria não encontrada para exclusão." });
        }
        console.error(`[API Materia] Erro ao excluir matéria ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir matéria." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;
