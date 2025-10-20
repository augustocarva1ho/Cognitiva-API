import express from 'express';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

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
        console.error("Erro na verificação do token:", err);
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar Insights de um aluno
router.get("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;

    if (!alunoId) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        const insights = await prisma.insight.findMany({
            where: { alunoId: alunoId },
            orderBy: { dataGeracao: 'desc' },
        });
        res.json(insights);
    } catch (err) {
        console.error(`[API Insight] Erro ao buscar insights do aluno ${alunoId}: `, err);
        res.status(500).json({ error: "Erro interno ao buscar insights." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Gerar Insight para um Aluno
router.post("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;
    const { prompt } = req.body;
    const { user } = req as any;

    if (!alunoId) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        const aluno = await prisma.aluno.findUnique({
            where: { id: alunoId },
            include: {
                turma: true,
                condicao: true,
                notasBimestrais: { include: { materia: true } },
                avaliacoes: { include: { atividade: { include: { materia: true, professor: true } } } },
                observacoes: true,
            }
        });

        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }
        
        const jsonInput = {
            aluno: {
                Nome: aluno.Nome,
                Matricula: aluno.Matricula,
                Idade: aluno.Idade,
                turma: aluno.turma.Nome,
                condicao: aluno.condicao,
            },
            notas: aluno.notasBimestrais,
            avaliacoes: aluno.avaliacoes,
            observacoes: aluno.observacoes.map(obs => obs.texto),
        };
        
        const fullPrompt = `Análise de Desempenho do Aluno: ${prompt}\n\nDados do Aluno:\n${JSON.stringify(jsonInput, null, 2)}`;
        
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY não está definida." });
        }
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // Usando o modelo gemini-2.5-flash
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(fullPrompt);
        const responseText = result.response.text();

        const novoInsight = await prisma.insight.create({
            data: {
                alunoId: aluno.id,
                jsonInput: jsonInput,
                textoInsight: responseText,
            },
        });
        
        res.json({ message: "Insight gerado com sucesso!", insight: novoInsight });

    } catch (err) {
        console.error(`[API Insight] Erro ao gerar insight para o aluno ${alunoId}: `, err);
        res.status(500).json({ error: "Erro interno ao gerar insight." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;