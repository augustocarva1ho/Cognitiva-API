// src/index.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import alunoRoute from "./routes/aluno.js";
import loginRoute from "./routes/login.js";
import docenteRoute from "./routes/docente.js"
import turmaRoute from "./routes/turma.js"
import materiaRoute from "./routes/materia.js"
import atividadeRoute from "./routes/atividade.js"
import notaBimestralRoute from "./routes/notaBimestral.js"
import avaliacaoRoute from "./routes/avaliacao.js"
import observacaoRoute from "./routes/observacao.js"
import condicaoRoute from "./routes/condicao.js"
import insightRoute from "./routes/insight.js"
import escolaRoute from "./routes/escolas.js"
import acessoRoute from "./routes/acessos.js"

dotenv.config();

const app = express();
app.use(express.json());

// permitir requisições do Next.js em dev
app.use(cors({
  origin: ["http://localhost:3000"], // adicione outros domínios se necessário
  methods: 'GET,POST,PUT,DELETE',
  credentials: true,
}));

app.use("/login", loginRoute);
app.use("/api/alunos", alunoRoute);
app.use("/api/docentes", docenteRoute);
app.use("/api/turmas", turmaRoute);
app.use("/api/materias", materiaRoute);
app.use("/api/atividades", atividadeRoute);
app.use("/api/notasBimestrais", notaBimestralRoute)
app.use("/api/avaliacoes", avaliacaoRoute);
app.use("/api/observacoes", observacaoRoute);
app.use("/api/condicoes", condicaoRoute);
app.use("/api/insights", insightRoute);
app.use("/api/escolas", escolaRoute);
app.use("/api/acessos", acessoRoute);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});
