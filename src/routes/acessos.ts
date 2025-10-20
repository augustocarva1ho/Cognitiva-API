import express from "express";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const router = express.Router();
const prisma = new PrismaClient();

// Middleware de autenticação (simplificado, já que a autenticação é global)
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "Token de autenticação não fornecido." });
    
    try {
        jwt.verify(token, process.env.JWT_SECRET!);
        next();
    } catch (err) {
        return res.status(403).json({ error: "Token inválido." });
    }
};

// Rota GET: Listar todos os níveis de acesso
router.get("/", authenticateToken, async (req, res) => {
     try {
         const acessos = await prisma.acesso.findMany();
         res.json(acessos);
     } catch (err) {
         console.error("[API Acessos] Erro ao buscar níveis de acesso: ", err);
         res.status(500).json({ error: "Erro interno ao listar níveis de acesso." });
     } finally {
         await prisma.$disconnect();
     }
});

export default router;
