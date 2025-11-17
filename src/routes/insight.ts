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

// Função utilitária para simular delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryGenerateInsight(fullPrompt: string, maxRetries: number = 3) {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY não está definida.");
    }
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const result = await model.generateContent(fullPrompt);
            return result.response.text();
        } catch (error) {
            // Tenta extrair o status do erro (pode ser um erro de fetch ou API)
            const status = (error as any).status || (error as any).cause?.status;
            
            // Se o erro NÃO for 503 (sobrecarga), falha imediatamente
            if (status !== 503) {
                console.error("[Gemini API] Erro não recuperável:", error);
                throw error;
            }
            
            // Log do erro 503 e espera o tempo de backoff
            const delayTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            console.warn(`[Gemini API] 503 Sobrecarga (Tentativa ${attempt + 1}/${maxRetries}). Tentando novamente em ${delayTime / 1000}s...`);
            await delay(delayTime);
        }
    }
    // Se todas as tentativas falharem
    throw new Error("Gemini API falhou após múltiplas tentativas (503 Sobrecarga persistente).");
}

// Rota POST: Gerar Insight para um Aluno
router.post("/aluno/:alunoId", authenticateToken, async (req, res) => {
    const { alunoId } = req.params;
    const { user } = req as any;

    const promptBase = `
        Você é um analista pedagógico especializado em identificar padrões ocultos entre desempenho acadêmico,
        condições psicológicas, socioemocionais e observações comportamentais registradas pelos professores.

        Sua tarefa é analisar profundamente o JSON fornecido e devolver:

        1. Padrões relevantes entre notas, comportamento, condições e tipos de atividades.
        2. Pontos fortes reais do aluno (não genéricos), baseados em evidências do JSON.
        3. Pontos fracos e vulnerabilidades, relacionando desempenho com contexto emocional/cognitivo.
        4. Três recomendações práticas, específicas e aplicáveis pelo professor na sala de aula,
        explicando o *porquê* de cada recomendação com base nos dados.
        5. Linguagem clara, profissional e acessível.

        ### Instruções adicionais:
        - Leve em consideração dislexia, TDAH, depressão, ansiedade ou outras condições quando estiverem presentes.
        - Analise também tipos de atividade (individual/dupla, consulta ou não, criatividade, local da atividade).
        - Identifique flutuações de notas e o que elas indicam sobre o estilo de aprendizagem.
        - Observe atrasos, engajamento, comportamento e padrões recorrentes.
        - Não invente dados.

        ---

        ### EXEMPLO DE RESPOSTA (FEW-SHOT)

        **Resumo Inicial:**

        [Nome do aluno], [idade], apresenta um histórico marcado por variações de desempenho acadêmico e por fatores emocionais/cognitivos que influenciam diretamente sua aprendizagem. Sua participação em sala e engajamento nas atividades mostram padrões consistentes que ajudam a entender suas principais dificuldades e potenciais. Condições registradas (como dislexia, suspeitas emocionais ou laudos formais) são fundamentais para interpretar o comportamento e o rendimento.

        ---

        **Pontos Fortes:**

        1. **Evolução com suporte direcionado:** Demonstra capacidade de recuperação em disciplinas nas quais inicialmente apresentou baixo rendimento, indicando boa responsividade quando recebe intervenções adequadas.
        2. **Desempenho consistente em áreas específicas:** Apresenta estabilidade e facilidade em determinadas disciplinas (como idiomas ou matérias de raciocínio lógico), sugerindo estilos de aprendizagem que podem ser aproveitados pedagogicamente.
        3. **Organização quando recebe estrutura:** Em atividades com instruções claras e prazos definidos, mostra responsabilidade e capacidade de entrega, ainda que a nota nem sempre seja alta — o que indica esforço mesmo em contextos de dificuldade.

        ---

        **Pontos Fracos:**

        1. **Fragilidades em disciplinas textuais ou que exigem leitura/escrita prolongada:** Quedas de rendimento em matérias que demandam interpretação, escrita ou produção textual sugerem impacto de possíveis condições como dislexia ou dificuldades de foco.
        2. **Oscilação de desempenho ao longo dos bimestres:** Notas irregulares revelam dificuldade em manter um ritmo estável de aprendizagem, possivelmente influenciada por fatores emocionais, motivacionais ou cognitivos.
        3. **Desatenção e comportamento dispersivo em sala:** Registros de distração, conversas e perda de foco apontam para barreiras socioemocionais que prejudicam a concentração e afetam negativamente tanto o próprio aluno quanto o ambiente da turma.

        ---

        **Três Recomendações Específicas ao Professor (com justificativas):**

        1. **Adaptar materiais, leitura e avaliações quando houver indícios de dificuldades textuais:**
        *Sugestão:* Utilizar textos segmentados ("chunking"), fontes acessíveis, espaçamento ampliado, atividades orais e formatos alternativos de avaliação.  
        *Justificativa:* Minimiza a sobrecarga de decodificação, permitindo que o aluno demonstre conhecimento real sem ser penalizado por limitações de leitura/escrita.

        2. **Estruturar as aulas em blocos menores, com sinais discretos de redirecionamento:**
        *Sugestão:* Dividir explicações longas, inserir pequenas pausas, alternar tipos de atividade e utilizar lembretes visuais ou gestuais.  
        *Justificativa:* Reduz a probabilidade de dispersão e melhora a permanência na tarefa, especialmente importante quando há suspeita de questões emocionais ou transtornos de atenção.

        3. **Aproveitar modalidades colaborativas para reforçar autoestima e engajamento:**
        *Sugestão:* Promover atividades em grupo com papéis definidos e oportunidades de participação oral.  
        *Justificativa:* O aluno tende a apresentar melhor desempenho quando pode contribuir verbalmente ou trabalhar com pares, diminuindo pressão individual e aumentando a motivação.

        ---

        Agora analise **o seguinte JSON real** e gere uma resposta completa seguindo exatamente o mesmo formato e profundidade: 
        `;

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

        if (user.escolaId !== aluno.escolaId && user.acesso !== 'Administrador') {
            return res.status(403).json({ error: "Acesso negado: Aluno não pertence à sua escola." });
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
        
        const fullPrompt = `${promptBase}\n\nJSON do Aluno:\n${JSON.stringify(jsonInput, null, 2)}`;
        
        const responseText = await retryGenerateInsight(fullPrompt);

        const novoInsight = await prisma.insight.create({
            data: {
                alunoId: aluno.id,
                jsonInput: jsonInput,
                textoInsight: responseText,
                escolaId: aluno.escolaId, // Adiciona a FK escolaId
            },
        });
        
        res.json({ message: "Insight gerado com sucesso!", insight: novoInsight });

    } catch (err) {
        console.error(`[API Insight] Erro ao gerar insight para o aluno ${alunoId}: `, err);
        // Tratamento de erro 503 e erro interno
        const isRetryFailure = (err as Error).message.includes("Sobrecarga persistente");
        res.status(isRetryFailure ? 503 : 500).json({ 
            error: isRetryFailure ? "Serviço de IA Indisponível (Sobrecarga). Tente novamente." : "Erro interno ao gerar insight." 
        });

    } finally {
        await prisma.$disconnect();
    }
});

export default router;