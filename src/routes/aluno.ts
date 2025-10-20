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
        const user = jwt.verify(token, JWT_SECRET!) as { id: string, nome: string, acesso: string, escolaId: string };
        (req as any).user = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar todos os Alunos (COM FILTRO DE ESCOLA)
router.get("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const viewingSchoolId = req.query.viewingSchoolId as string;

    try {
        let whereClause: Prisma.AlunoWhereInput = {};
        
        if (user.acesso === 'Administrador') {
            if (viewingSchoolId) {
                 whereClause = { escolaId: viewingSchoolId };
            } else {
                 return res.json([]);
            }
        } else if (user.escolaId) {
            whereClause = { escolaId: user.escolaId };
        } else {
             return res.status(403).json({ error: "Usuário sem associação de escola para visualização." });
        }
        
        const alunos = await prisma.aluno.findMany({
            where: whereClause,
            select: {
                id: true,
                Nome: true,
                Matricula: true,
                Idade: true,
                turmaId: true, 
                escolaId: true, 
                turma: { select: { Nome: true, id: true } },
                condicao: { select: { id: true, nomeCondicao: true, statusComprovacao: true, descricaoAdicional: true } }
            }
        });
        res.json(alunos);
    } catch (err) {
        console.error("[API Aluno] Erro ao buscar alunos: ", err);
        res.status(500).json({ error: "Erro interno ao listar alunos." });
    } finally {
        await prisma.$disconnect();
    }
});

//Obter todos os dados COMPLETOs de um aluno para GERAÇÃO DE INSIGHT
router.get("/:id/full-data", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    const viewingSchoolId = req.query.viewingSchoolId as string; 

    if (!id) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        // 1. Determina a escola de operação para permissão
        const escolaDeOperacao = user.acesso === 'Administrador' ? viewingSchoolId : user.escolaId;

        if (!escolaDeOperacao) {
             return res.status(403).json({ error: "ID da escola de operação não fornecido." });
        }

        // 2. Busca o aluno e todos os dados relacionados, filtrando pela escola de operação
        const aluno = await prisma.aluno.findUnique({
            where: { 
                id: id,
                escolaId: escolaDeOperacao // Garante que o aluno pertence à escola de operação
            },
            include: {
                turma: true,
                condicao: true,
                avaliacoes: {
                    include: {
                        atividade: { 
                            select: { 
                                tipo: true, 
                                materia: { select: { nome: true } }, 
                                notaMaxima: true 
                            } 
                        }
                    }
                },
                notasBimestrais: {
                    include: { materia: { select: { nome: true } } }
                },
                observacoes: true,
                insights: true,
            }
        });

        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado ou não pertence à escola selecionada." });
        }

        res.json(aluno);
    } catch (err) {
        console.error(`[API Aluno] Erro ao buscar dados completos do aluno ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao buscar dados do aluno." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar novo Aluno (ATRIBUI ESCOLA ID)
router.post("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    // Tipagem forçada para evitar erro 'any'
    const { Nome, Matricula, Idade, turmaId, escolaId } = req.body as { Nome: string, Matricula: string, Idade: number, turmaId: string, escolaId: string };

    // Determina qual escolaId usar (Admin pode trocar a escola, outros não)
    const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;

    if (!Nome || !Matricula || !turmaId || !finalEscolaId) {
        return res.status(400).json({ error: "Nome, Matrícula, Turma e ID da escola são obrigatórios." });
    }

    try {
        // Opcional: Validar se a Turma pertence à Escola de destino
        const turma = await prisma.turma.findUnique({ where: { id: turmaId }, select: { escolaId: true } });
        if (turma?.escolaId !== finalEscolaId) {
             return res.status(403).json({ error: "A turma selecionada não pertence à escola de destino." });
        }

        const novoAluno = await prisma.aluno.create({
            data: {
                Nome: Nome,
                Matricula: Matricula,
                Idade: Idade,
                escola: { connect: { id: escolaId } }, // Atribui a FK diretamente
                turma: { connect: { id: turmaId } },
            }
        });
        res.status(201).json({ message: "Aluno cadastrado com sucesso!", aluno: novoAluno });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return res.status(409).json({ error: "Um aluno com esta matrícula já existe." });
        }
        console.error("[API Aluno] Erro ao cadastrar aluno: ", err);
        res.status(500).json({ error: "Erro interno ao cadastrar aluno." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota PUT: Editar Aluno (COM FILTRO DE ESCOLA)
router.put("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    const { Nome, Matricula, Idade, turmaId, escolaId } = req.body as { Nome: string, Matricula: string, Idade: number, turmaId: string, escolaId: string };
    const escolaDeVisualizacao = req.query.viewingSchoolId as string; 

    if (!id) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        // 1. Determina a escola de operação
        const escolaDeOperacao = user.acesso === 'Administrador' ? escolaDeVisualizacao : user.escolaId;

        // 2. Validar Permissão: O aluno deve pertencer à escola de operação
        const alunoExistente = await prisma.aluno.findUnique({ where: { id: id }, select: { escolaId: true } });
        
        if (alunoExistente?.escolaId !== escolaDeOperacao) {
            return res.status(403).json({ error: "Acesso negado: Tentativa de editar aluno de outra escola." });
        }
        
        // 3. Determina qual escolaId usar para o salvamento
        const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;

        // 4. Opcional: Validar se a nova Turma pertence à escola
        if (turmaId) {
             const turma = await prisma.turma.findUnique({ where: { id: turmaId }, select: { escolaId: true } });
             if (turma?.escolaId !== finalEscolaId) {
                 return res.status(403).json({ error: "A nova turma selecionada não pertence à escola de destino." });
             }
        }

        const alunoAtualizado = await prisma.aluno.update({
            where: { id: id },
            data: {
                Nome: Nome,
                Matricula: Matricula,
                Idade: Idade,
                escola: { connect: { id: escolaId } }, // Atribui a FK diretamente
                turma: { connect: { id: turmaId } },
            }
        });
        res.json({ message: "Aluno atualizado com sucesso!", aluno: alunoAtualizado });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Aluno não encontrado para atualização." });
        }
        console.error(`[API Aluno] Erro ao editar aluno ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao editar aluno." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir Aluno (COM FILTRO DE ESCOLA E EXCLUSÃO EM CASCATA MANUAL)
router.delete("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    const escolaDeVisualizacao = req.query.viewingSchoolId as string;

    if (!id) {
        return res.status(400).json({ error: "ID do aluno é obrigatório." });
    }

    try {
        // 1. Determina a escola de operação
        const escolaDeOperacao = user.acesso === 'Administrador' ? escolaDeVisualizacao : user.escolaId;

        // 2. Validação de Permissão
        const alunoExistente = await prisma.aluno.findUnique({ where: { id: id }, select: { escolaId: true } });
        
        if (alunoExistente?.escolaId !== escolaDeOperacao) {
            return res.status(403).json({ error: "Acesso negado: Tentativa de excluir aluno de outra escola." });
        }

        // --- CORREÇÃO P2003: EXCLUSÃO DE DEPENDÊNCIAS ---
        await prisma.condicaoAluno.deleteMany({ where: { alunoId: id } });
        await prisma.avaliacao.deleteMany({ where: { alunoId: id } });
        await prisma.observacaoAluno.deleteMany({ where: { alunoId: id } });
        await prisma.notaBimestral.deleteMany({ where: { alunoId: id } });
        await prisma.insight.deleteMany({ where: { alunoId: id } });
        
        await prisma.aluno.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Aluno excluído com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Aluno não encontrado para exclusão." });
        }
        console.error(`[API Aluno] Erro ao excluir aluno ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir aluno." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;
