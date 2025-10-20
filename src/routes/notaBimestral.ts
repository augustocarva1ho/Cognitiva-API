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
  
    // Em produção, use jwt.verify() para validar o token
    next(); 
};

// Rota GET: Listar notas de um Aluno
router.get("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;
    
    if (!alunoId) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        const notas = await prisma.notaBimestral.findMany({
            where: { alunoId: alunoId },
            include: { materia: { select: { nome: true, id: true } } }
        });
        res.json(notas);
    } catch (err) {
        console.error(`[API Notas] Erro ao buscar notas do aluno ${alunoId}: `, err);
        res.status(500).json({ error: "Erro interno ao listar notas." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar ou atualizar NOTAS EM LOTE (CORRIGIDA)
router.post("/salvarLote", authenticateToken, async (req, res) => {
    const { alunoId, notas } = req.body;

    if (!alunoId || !Array.isArray(notas)) {
        return res.status(400).json({ error: "Dados incompletos ou inválidos para salvar notas em lote." });
    }

    try {
        const result = await prisma.$transaction(
            notas.map(nota => {
                // Tenta encontrar a nota existente
                return prisma.notaBimestral.upsert({
                    where: {
                        alunoId_materiaId_bimestre: {
                            alunoId: alunoId,
                            materiaId: nota.materiaId,
                            bimestre: nota.bimestre
                        }
                    },
                    update: {
                        nota: nota.nota,
                        recuperacao: nota.recuperacao
                    },
                    create: {
                        alunoId: alunoId,
                        materiaId: nota.materiaId,
                        bimestre: nota.bimestre,
                        nota: nota.nota,
                        recuperacao: nota.recuperacao
                    }
                });
            })
        );
        res.status(201).json({ message: "Notas salvas com sucesso!", notas: result });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Aluno ou matéria não encontrados." });
        }
        console.error("[API Notas] Erro ao salvar notas: ", err);
        res.status(500).json({ error: "Erro interno ao salvar notas." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar ou atualizar uma Nota Bimestral (agora para uso individual, se precisar)
router.post("/", authenticateToken, async (req, res) => {
    const { alunoId, materiaId, bimestre, nota, recuperacao } = req.body;

    if (!alunoId || !materiaId || !bimestre || nota === undefined) {
        return res.status(400).json({ error: "Dados da nota incompletos." });
    }

    try {
        const notaSalva = await prisma.notaBimestral.upsert({
            where: {
                alunoId_materiaId_bimestre: {
                    alunoId: alunoId,
                    materiaId: materiaId,
                    bimestre: bimestre
                }
            },
            update: {
                nota: nota,
                recuperacao: recuperacao
            },
            create: {
                alunoId: alunoId,
                materiaId: materiaId,
                bimestre: bimestre,
                nota: nota,
                recuperacao: recuperacao
            }
        });
        res.status(201).json({ message: "Nota salva com sucesso!", nota: notaSalva });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Aluno ou matéria não encontrados." });
        }
        console.error("[API Notas] Erro ao salvar nota: ", err);
        res.status(500).json({ error: "Erro interno ao salvar nota." });
    } finally {
        await prisma.$disconnect();
    }
});


// Rota DELETE: Excluir nota de um Aluno
router.delete("/:alunoId/:materiaId/:bimestre", authenticateToken, async (req, res) => {
    const { alunoId, materiaId, bimestre } = req.params;

    if (!alunoId || !materiaId || !bimestre) {
        return res.status(400).json({ error: "Dados da nota incompletos." });
    }

    try {
        await prisma.notaBimestral.delete({
            where: {
                alunoId_materiaId_bimestre: {
                    alunoId: alunoId,
                    materiaId: materiaId,
                    bimestre: parseInt(bimestre)
                }
            }
        });
        res.status(200).json({ message: "Nota excluída com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Nota não encontrada." });
        }
        console.error(`[API Notas] Erro ao excluir nota do aluno ${alunoId}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir nota." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;