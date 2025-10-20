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

// Rota GET: Listar todas as Condições (Apenas para referência de nomes comuns, se necessário)
router.get("/", authenticateToken, async (req, res) => {
    // Retorna uma lista de nomes comuns para o frontend usar como sugestão (se você quiser)
    const sugestoes = [
        { id: "sug_tdah", nome: "TDAH" },
        { id: "sug_tea", nome: "TEA (Autismo)" },
        { id: "sug_dislexia", nome: "Dislexia" },
        { id: "sug_ansiedade", nome: "Transtorno de Ansiedade" },
        { id: "sug_depressao", nome: "Depressão" },
    ];
    res.json(sugestoes);
});

// Rota GET: Buscar Condições de um Aluno - CORRIGIDO
router.get("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;

    // VERIFICAÇÃO ADICIONADA: Retorna erro se o ID for nulo ou indefinido
    if (!alunoId) {
        return res.status(400).json({ error: "ID do aluno não fornecido na URL." });
    }
    
    try {
        const condicoes = await prisma.condicaoAluno.findMany({
            where: { alunoId: alunoId },
            orderBy: { dataCadastro: 'asc' }
        });
        res.json(condicoes);
    } catch (err) {
        console.error("[API Condicao] Erro ao buscar condições do aluno: ", err);
        res.status(500).json({ error: "Erro interno ao listar condições." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Atribuir/Criar uma Condição a um Aluno (com texto livre)
router.post("/atribuir", authenticateToken, async (req, res) => {
    const { alunoId, nomeCondicao, statusComprovacao, descricaoAdicional } = req.body;

    if (!alunoId || !nomeCondicao || !statusComprovacao) {
        return res.status(400).json({ error: "Dados da condição incompletos." });
    }

    try {
        const atribuicao = await prisma.condicaoAluno.create({
            data: {
                alunoId: alunoId,
                nomeCondicao: nomeCondicao, // Texto livre
                statusComprovacao: statusComprovacao,
                descricaoAdicional: descricaoAdicional
            }
        });
        res.status(201).json({ message: "Condição atribuída com sucesso!", atribuicao: atribuicao });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return res.status(409).json({ error: `A condição '${nomeCondicao}' já foi cadastrada para este aluno.` });
        }
        console.error("[API Condicao] Erro ao atribuir condição: ", err);
        res.status(500).json({ error: "Erro interno ao atribuir condição." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Remover uma Condição do Aluno
router.delete("/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "ID da condição é obrigatório." });
    }

    try {
        await prisma.condicaoAluno.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Condição removida com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Condição não encontrada." });
        }
        console.error("[API Condicao] Erro ao remover condição: ", err);
        res.status(500).json({ error: "Erro interno ao remover condição." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;