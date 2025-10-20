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

// Rota GET: Listar todas as Atividades (COM FILTRO DE ESCOLA)
router.get("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    // O Admin envia o ID de visualização no query
    const viewingSchoolId = req.query.viewingSchoolId as string; 

    try {
        let whereClause: Prisma.AtividadeWhereInput = {};
        
        if (user.acesso === 'Administrador' && viewingSchoolId) {
            // ADMIN: Filtra pela escola selecionada
            whereClause = { escolaId: viewingSchoolId };
        } else if (user.escolaId) {
            // Supervisor/Professor: Filtra PELA SUA PRÓPRIA ESCOLA
            whereClause = { escolaId: user.escolaId };
        } else {
            // Usuário sem escola: Acesso negado
            return res.status(403).json({ error: "Usuário sem associação de escola para visualização." });
        }
        
        const atividades = await prisma.atividade.findMany({
            where: whereClause,
            include: { 
                materia: { select: { id: true, nome: true } }, 
                professor: { select: { id: true, nome: true } }
            }
        });
        res.json(atividades);
    } catch (err) {
        console.error("[API Atividade] Erro ao buscar atividades: ", err);
        res.status(500).json({ error: "Erro interno ao listar atividades." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota POST: Criar nova Atividade (ATRIBUI ESCOLA ID)
router.post("/", authenticateToken, async (req, res) => {
    const { user } = req as any;
    // Tipagem forçada para evitar erro 'any'
    const { tipo, local, tempoFinalizacao, dinamica, comConsulta, liberdadeCriativa, descricaoAdicional, notaMaxima, materiaId, professorId, escolaId } = req.body as {
        tipo: string, local: string, tempoFinalizacao: string, dinamica: string, comConsulta: boolean, liberdadeCriativa: boolean, descricaoAdicional: string, notaMaxima: number, materiaId: string, professorId: string, escolaId: string 
    };
    
    // Apenas Docentes e Admins podem criar
    if (user.acesso === 'Professor' && user.id !== professorId) {
         return res.status(403).json({ error: "Professores só podem cadastrar atividades em seu próprio nome." });
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

    if (!tipo || !materiaId || !professorId || !finalEscolaId) {
        return res.status(400).json({ error: "Tipo, Matéria, Professor e ID da escola são obrigatórios." });
    }

    try {
        // Validação: Matéria e Professor devem pertencer à mesma escola de destino
        const [materia, professor] = await Promise.all([
             prisma.materia.findUnique({ where: { id: materiaId }, select: { escolaId: true } }),
             prisma.docente.findUnique({ where: { id: professorId }, select: { escolaId: true } })
        ]);

        if (materia?.escolaId !== finalEscolaId || professor?.escolaId !== finalEscolaId) {
             return res.status(403).json({ error: "Matéria ou Professor não pertencem à escola de destino." });
        }
        

        const novaAtividade = await prisma.atividade.create({
            data: {
                tipo, local, tempoFinalizacao, dinamica, comConsulta, liberdadeCriativa, descricaoAdicional, notaMaxima,
                materiaId, professorId,
                escolaId: finalEscolaId, // Atribui a FK diretamente
            }
        });
        res.status(201).json({ message: "Atividade cadastrada com sucesso!", atividade: novaAtividade });
    } catch (err) {
        console.error("[API Atividade] Erro ao cadastrar atividade: ", err);
        res.status(500).json({ error: "Erro interno ao cadastrar atividade." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota PUT: Editar Atividade (COM FILTRO DE ESCOLA)
router.put("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    const { tipo, local, tempoFinalizacao, dinamica, comConsulta, liberdadeCriativa, descricaoAdicional, notaMaxima, materiaId, professorId, escolaId } = req.body as {
        tipo: string, local: string, tempoFinalizacao: string, dinamica: string, comConsulta: boolean, liberdadeCriativa: boolean, descricaoAdicional: string, notaMaxima: number, materiaId: string, professorId: string, escolaId: string 
    };

    // Leitura do ID de visualização do Admin
    const escolaDeVisualizacao = req.query.viewingSchoolId as string; 
    
    // Apenas Docentes e Admins podem editar
    if (user.acesso === 'Professor' && user.id !== professorId) {
         return res.status(403).json({ error: "Professores só podem editar atividades em seu próprio nome." });
    }

    if (!id || !materiaId || !professorId) {
        return res.status(400).json({ error: "ID da atividade, Matéria e Professor são obrigatórios." });
    }

    try {
        // 1. Determina a escola de operação
        const escolaDeOperacao = user.acesso === 'Administrador' ? escolaDeVisualizacao : user.escolaId;

        // 2. Validação de Permissão: A atividade deve pertencer à escola de operação
        const atividadeExistente = await prisma.atividade.findUnique({ where: { id: id }, select: { escolaId: true } });
        
        if (atividadeExistente?.escolaId !== escolaDeOperacao) {
            return res.status(403).json({ error: "Acesso negado: Tentativa de editar atividade de outra escola." });
        }
        
        // 3. Determina qual escolaId usar para o salvamento
        const finalEscolaId = user.acesso === 'Administrador' && escolaId ? escolaId : user.escolaId;

        // 4. Validação: Matéria e Professor devem pertencer à mesma escola de destino
        const [materia, professor] = await Promise.all([
             prisma.materia.findUnique({ where: { id: materiaId }, select: { escolaId: true } }),
             prisma.docente.findUnique({ where: { id: professorId }, select: { escolaId: true } })
        ]);

        if (materia?.escolaId !== finalEscolaId || professor?.escolaId !== finalEscolaId) {
             return res.status(403).json({ error: "Matéria ou Professor não pertencem à escola de destino." });
        }


        const atividadeAtualizada = await prisma.atividade.update({
            where: { id: id },
            data: {
                tipo, local, tempoFinalizacao, dinamica, comConsulta, liberdadeCriativa, descricaoAdicional, notaMaxima,
                materiaId, professorId,
                escolaId: finalEscolaId, // Atribui a FK diretamente
            }
        });
        res.json({ message: "Atividade atualizada com sucesso!", atividade: atividadeAtualizada });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Atividade não encontrada para atualização." });
        }
        console.error(`[API Atividade] Erro ao editar atividade ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao editar atividade." });
    } finally {
        await prisma.$disconnect();
    }
});

// Rota DELETE: Excluir Atividade (COM FILTRO DE ESCOLA E EXCLUSÃO DE DEPENDÊNCIAS)
router.delete("/:id", authenticateToken, async (req, res) => {
    const { user } = req as any;
    const { id } = req.params;
    // Leitura do ID de visualização do Admin
    const escolaDeVisualizacao = req.query.viewingSchoolId as string;

    // Apenas Docentes e Admins podem editar
    if (user.acesso === 'Professor') {
        return res.status(403).json({ error: "Professores não têm permissão para excluir atividades." });
    }

    if (!id) {
        return res.status(400).json({ error: "ID da atividade é obrigatório." });
    }

    try {
        // 1. Determina a escola de operação
        const escolaDeOperacao = user.acesso === 'Administrador' ? escolaDeVisualizacao : user.escolaId;

        // 2. Validação de Permissão
        const atividadeExistente = await prisma.atividade.findUnique({ where: { id: id }, select: { escolaId: true } });
        
        if (atividadeExistente?.escolaId !== escolaDeOperacao) {
            return res.status(403).json({ error: "Acesso negado: Tentativa de excluir atividade de outra escola." });
        }

        // 3. Excluir dependências (Avaliacoes) antes de excluir a Atividade
        await prisma.avaliacao.deleteMany({
            where: { atividadeId: id }
        });
        
        await prisma.atividade.delete({
            where: { id: id }
        });
        res.status(200).json({ message: "Atividade excluída com sucesso." });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            return res.status(404).json({ error: "Atividade não encontrada para exclusão." });
        }
        console.error(`[API Atividade] Erro ao excluir atividade ${id}: `, err);
        res.status(500).json({ error: "Erro interno ao excluir atividade." });
    } finally {
        await prisma.$disconnect();
    }
});

export default router;
