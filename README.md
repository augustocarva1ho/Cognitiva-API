💻 Cognitiva API (Backend)

API de microsserviço em Node.js / Express, responsável pela gestão de dados (CRUD) de Alunos, Turmas, Docentes e pela comunicação com a API Gemini para análise de desempenho pedagógico.

Tecnologias

Runtime: Node.js

Framework: Express

Database: PostgreSQL

ORM: Prisma ORM

IA: Google Gemini API

Autenticação: JWT (JSON Web Tokens)

🚀 Guia de Instalação e Execução

Este guia detalha os passos necessários para colocar a API em funcionamento em ambiente local.

1. Configuração do Ambiente

Pré-requisitos:

Node.js (versão 18 ou superior)

PostgreSQL Database (local ou em nuvem)

Gerenciador de pacotes (npm ou yarn)

A. Variáveis de Ambiente (.env)

Crie um arquivo chamado .env na raiz do diretório da API e insira as seguintes variáveis. Estas são cruciais para a conexão com o banco de dados e a autenticação.

# Conexão com o Banco de Dados PostgreSQL (Altere para sua credencial)
DATABASE_URL="postgresql://USUARIO:SENHA@HOST:PORTA/NOME_DO_BANCO?schema=public"

# Chaves de Segurança e Integração
JWT_SECRET="sua_chave_secreta_forte_aqui"
GEMINI_API_KEY="SUA_CHAVE_API_DA_GOOGLE_GEMINI" 


B. Instalação de Dependências

Na raiz do projeto, instale todas as dependências do Node.js:

npm install


2. Configuração do Prisma (ORM e Banco de Dados)

O Prisma precisa de gerar o código do cliente baseado no seu schema e sincronizar a estrutura do banco de dados (que deve estar rodando).

A. Sincronização do Cliente Prisma

Gere o Prisma Client, que é o código que a aplicação usa para interagir com o banco de dados:

npm run prisma:generate


B. Sincronização do Banco de Dados

Se você já tem o banco de dados criado (e o DATABASE_URL no .env está correto), use o comando prisma migrate para aplicar o schema e criar as tabelas (ou prisma db push para ambientes de desenvolvimento).

# Se estiver usando migrations:
# npx prisma migrate dev --name init

# Ou, se for apenas para sincronizar o schema (mais rápido para dev):
npx prisma db push 


Nota: Se o seu banco de dados já estiver populado, use o comando npm run prisma:pull (que executa prisma db pull) para garantir que o seu schema.prisma local reflita a estrutura do banco.

3. Execução da API

Use o script dev para iniciar o servidor Node.js com o hot-reloading (ts-node):

npm run dev


A API estará disponível em http://localhost:4000 (ou na porta definida na sua variável de ambiente PORT).