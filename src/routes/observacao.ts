import express from "express";
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware de autenticação básico
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
  
    if (!token) {
      return res.status(401).json({ error: "Token de autenticação não fornecido." });
    }
  
    // Em produção, use jwt.verify() para validar o token e extrair o professorId
    // Por enquanto, apenas avança.
    next(); 
};

// Rota GET: Buscar a última observação de um Aluno
router.get("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;
    
    if (!alunoId) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        // Busca a observação mais recente para o aluno
        const observacao = await prisma.observacaoAluno.findFirst({
            where: { alunoId: alunoId },
            orderBy: { data: 'desc' }, 
            select: {
                id: true,
                texto: true,
                data: true,
                professorId: true,
            }
        });
        
        // Retorna a observação (ou null se não houver)
        res.json(observacao || null); 
    } catch (err) {
        console.error(`[API Observacao] Erro ao buscar observação do aluno ${alunoId}: `, err);
        res.status(500).json({ error: "Erro interno ao buscar observação." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST/PUT: Criar nova Observação (sem histórico, substituindo a última)
// Esta rota vai criar um novo registro para manter o histórico (conforme a modelagem)
router.post("/", authenticateToken, async (req, res) => {
    const { alunoId, texto, professorId } = req.body; // professorId deve vir do frontend

    if (!alunoId || !texto || !professorId) {
        return res.status(400).json({ error: "Dados da observação incompletos." });
    }

    try {
        // Cria sempre uma nova observação (para histórico)
        const novaObservacao = await prisma.observacaoAluno.create({
            data: {
                alunoId: alunoId,
                professorId: professorId,
                texto: texto,
            }
        });
        
        res.status(201).json({ message: "Observação salva com sucesso!", observacao: novaObservacao });
        
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Aluno ou professor não encontrados." });
        }
        console.error("[API Observacao] Erro ao salvar observação: ", err);
        res.status(500).json({ error: "Erro interno ao salvar observação." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;
