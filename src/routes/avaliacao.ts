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
    next(); 
};

// Rota GET: Listar avaliações de um Aluno
router.get("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;
    
    if (!alunoId) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        const avaliacoes = await prisma.avaliacao.findMany({
            where: { alunoId: alunoId },
            include: { 
                atividade: {
                    select: { 
                        tipo: true, 
                        notaMaxima: true,
                        materia: { select: { nome: true } },
                        professor: { select: { nome: true } }
                    } 
                },
                professor: { select: { nome: true } }
            }
        });
        res.json(avaliacoes);
    } catch (err) {
        console.error(`[API Avaliacao] Erro ao buscar avaliações do aluno ${alunoId}: `, err);
        res.status(500).json({ error: "Erro interno ao listar avaliações." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Atribuir ou atualizar uma Avaliação (FINAL E CORRIGIDA)
router.post("/", authenticateToken, async (req, res) => {
    // Extrai o campo 'entregouNoPrazo' (String) e outros dados
    const { alunoId, atividadeId, notaNumerica, avaliacaoEscrita, entregouNoPrazo, professorId } = req.body; 

    if (!alunoId || !atividadeId || notaNumerica === undefined || !professorId) {
        return res.status(400).json({ error: "Dados da avaliação incompletos." });
    }

    try {
        const atividade = await prisma.atividade.findUnique({
            where: { id: atividadeId },
            select: { notaMaxima: true }
        });

        if (!atividade) {
            return res.status(404).json({ error: "Atividade não encontrada." });
        }
        
        if (notaNumerica > atividade.notaMaxima) {
            return res.status(400).json({ error: `A nota ${notaNumerica} excede a nota máxima permitida de ${atividade.notaMaxima}.` });
        }

        const avaliacaoSalva = await prisma.avaliacao.upsert({
            where: {
                alunoId_atividadeId: { alunoId: alunoId, atividadeId: atividadeId }
            },
            update: {
                notaNumerica: notaNumerica,
                avaliacaoEscrita: avaliacaoEscrita,
                // CORRIGIDO: Aceita a string diretamente do frontend
                entregouNoPrazo: entregouNoPrazo, 
                dataAvaliacao: new Date(),
            },
            create: {
                alunoId: alunoId,
                atividadeId: atividadeId,
                professorId: professorId,
                notaNumerica: notaNumerica,
                avaliacaoEscrita: avaliacaoEscrita,
                // CORRIGIDO: Aceita a string diretamente do frontend
                entregouNoPrazo: entregouNoPrazo,
            }
        });
        
        res.status(201).json({ message: "Avaliação salva com sucesso!", avaliacao: avaliacaoSalva });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Aluno, atividade ou professor não encontrados." });
        }
        console.error("[API Avaliacao] Erro ao salvar avaliação (500): ", err);
        res.status(500).json({ error: "Erro interno ao salvar avaliação." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir uma Avaliação
router.delete("/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "ID da avaliação é obrigatório." });
    }

    try {
        await prisma.avaliacao.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Avaliação excluída com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Avaliação não encontrada." });
        }
        console.error(`[API Avaliacao] Erro ao excluir avaliação ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir avaliação." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;