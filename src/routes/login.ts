import express from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

router.post("/", async (req, res) => {
  const { registro, senha } = req.body; 

  try {
    // 1. Encontrar o Docente, incluindo acesso e escola (CORRIGIDO)
    const docente = await prisma.docente.findUnique({
      where: { registro },
      include: { 
        acesso: true,
        escola: { select: { nome: true, id: true } } // Inclui o nome da escola
      },
    });

    // 2. Verifica se o usuário foi encontrado
    if (!docente) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }
    
    // 3. Compara a senha
    const senhaOk = await bcrypt.compare(senha, docente.senha);
    
    if (!senhaOk) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // 4. Verifica a chave secreta
    if (!JWT_SECRET) {
      console.error("[API Login] ERRO FATAL: JWT_SECRET não está definido.");
      return res.status(500).json({ error: "Configuração do servidor inválida." });
    }

    // 5. Gera token JWT com ESCOLANOME
    const escolaNome = docente.escola?.nome || "Sem Escola";

    const token = jwt.sign(
      { 
        id: docente.id, 
        nome: docente.nome, 
        acesso: docente.acesso.nome,
        escolaId: docente.escolaId 
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 6. Envia o token e os dados do usuário (Status 200 OK)
    res.json({ 
      token, 
      user: { 
        id: docente.id, 
        nome: docente.nome, 
        acesso: docente.acesso.nome,
        escolaId: docente.escolaId,
        escolaNome: escolaNome // Inclui o nome da escola
      } 
    });

  } catch (err) {
    console.error(`[API Login] ERRO INTERNO: `, err);
    res.status(500).json({ error: "Erro interno do servidor durante o login" });
  } finally {
    await prisma.$disconnect();
  }
});

export default router;
