#  E-Scooter GO

## Sistema de Gestão e Locação de Patinetes Elétricos

O **E-Scooter GO** é uma plataforma web desenvolvida para o gerenciamento
de serviços de locação de patinetes elétricos.

O sistema centraliza o controle de patinetes, clientes, funcionários,
pontos de retirada, locações e manutenções, permitindo acompanhar as
principais operações da plataforma por meio de uma interface web.

##  Sobre o Projeto

O projeto foi desenvolvido com o objetivo de criar uma solução completa
para gerenciamento de uma operação de mobilidade urbana baseada em
patinetes elétricos.

A aplicação permite administrar os recursos da empresa e manter os dados
centralizados em um banco de dados relacional.

##  Principais Funcionalidades

- Cadastro e gerenciamento de clientes
- Cadastro e gerenciamento de funcionários
- Controle de usuários e autenticação
- Cadastro e gerenciamento de patinetes
- Controle de pontos de retirada
- Registro e acompanhamento de locações
- Controle de manutenção dos patinetes
- Histórico de operações
- Configurações de preços e locações
- Dashboard para acompanhamento do sistema
- Persistência dos dados em banco de dados

##  Tecnologias Utilizadas

### Front-end
- HTML5
- CSS3
- JavaScript
- Chart.js
- Font Awesome

### Back-end
- Node.js
- Express.js
- API REST

### Banco de Dados
- PostgreSQL
- pgAdmin

### Infraestrutura
- Docker
- Docker Compose

### Versionamento
- Git
- GitHub

##  Arquitetura

A aplicação utiliza uma arquitetura baseada na comunicação entre
Front-end, API e banco de dados:

Frontend (HTML / CSS / JavaScript)
        ↓
      Fetch API
        ↓
Node.js / Express / API REST
        ↓
    PostgreSQL

O front-end realiza requisições para a API desenvolvida em Node.js e
Express, responsável pelas regras de negócio e pela comunicação com o
banco de dados PostgreSQL.

##  Estrutura do Projeto

```text
Scooter/
│
├── server/
│   ├── server.js
│   ├── database.js
│   ├── database.sql
│   ├── conexao.js
│   ├── inicializacao.js
│   ├── package.json
│   └── docker-compose.yml
│
├── public/
│   ├── css/
│   ├── js/
│   ├── images/
│   └── *.html
│
├── data/
│   └── database.example.json
│
└── README.md
```

##  Como Executar

Pré-requisitos: Node.js 18+ e Docker (ou um PostgreSQL próprio).

1. Suba o PostgreSQL:

   ```bash
   cd server
   docker compose up -d
   ```

2. Instale as dependências e inicie a API:

   ```bash
   npm install
   npm start
   ```

3. Acesse http://localhost:3000. As tabelas são criadas automaticamente na primeira execução (o `database.sql` também pode ser executado manualmente no pgAdmin).

No primeiro acesso é criado o usuário `admin`, com a senha definida em `ADMIN_SENHA_INICIAL` (padrão: `admin123`). **Troque essa senha em produção.**

### Variáveis de ambiente (opcionais)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta da API |
| `PGHOST` / `PGPORT` | `localhost` / `5432` | Servidor PostgreSQL |
| `PGDATABASE` | `escooter` | Nome do banco |
| `PGUSER` / `PGPASSWORD` | `postgres` / `postgres` | Credenciais do banco |
| `AUTH_SECRET` | gerado em `server/.auth-secret` | Segredo de assinatura das sessões |
| `ADMIN_SENHA_INICIAL` | `admin123` | Senha do `admin` criada no primeiro acesso |
| `APP_TZ` | `America/Sao_Paulo` | Fuso usado para agrupar relatórios por dia/mês |

##  Banco de Dados

O sistema usa um esquema relacional no PostgreSQL ([server/database.sql](server/database.sql)):

| Tabela | Conteúdo | Relacionamentos |
|--------|----------|-----------------|
| `pontos` | Pontos de distribuição | — |
| `usuarios` | Administradores e operadores (senha com hash PBKDF2) | `ponto_id` → pontos |
| `patinetes` | Frota, bateria e status | `ponto_id` → pontos |
| `clientes` | Clientes, identificados pelo telefone | — |
| `locacoes` | Locações, valores e multas | patinetes, clientes, pontos, usuarios |
| `manutencoes` | Manutenções e custos | patinetes, pontos, usuarios |
| `historico_usuarios` | Auditoria de logins e ações administrativas | usuarios |
| `configuracoes` / `precos` | Configuração geral e tabela de preços por tempo | — |

O próprio banco garante as regras principais:

- **Chaves estrangeiras**: não existe locação de cliente ou patinete inexistente.
- **CHECK**: status, bateria (0–100), forma de pagamento e valores não negativos.
- **Índice único parcial**: um patinete nunca tem duas locações ativas ao mesmo tempo.
- **Transações com `SELECT ... FOR UPDATE`**: alugar, devolver e enviar para manutenção travam só os patinetes envolvidos, então vários operadores trabalham ao mesmo tempo sem perder dados.
- **`NUMERIC(10,2)`** para dinheiro e **`TIMESTAMPTZ`** para datas.

Locações e manutenções guardam também o código do patinete, o nome do ponto e o login do operador do momento em que aconteceram. Assim o histórico financeiro continua correto mesmo que um patinete ou ponto seja removido depois.

### Migração da versão antiga

As versões anteriores guardavam tudo como um único JSON na tabela `sistema`. Na primeira execução da versão nova, se essa tabela existir, os dados são migrados automaticamente para as tabelas novas (usuários e senhas, pontos, patinetes, clientes, locações, manutenções, histórico e configurações). A tabela antiga **não é apagada**: ela é renomeada para `sistema_legado` como backup.
• Segurança
O sistema possui mecanismos de autenticação e controle de usuários.
As senhas não são armazenadas diretamente em texto simples, utilizando
mecanismos de hash para aumentar a segurança das credenciais.
• Objetivo
O objetivo do E-Scooter GO é fornecer uma solução centralizada para
gerenciamento de uma operação de aluguel de patinetes elétricos,
facilitando o controle administrativo, operacional e dos usuários.
• Desenvolvimento
Projeto acadêmico desenvolvido para aplicação prática de conceitos de:
- Desenvolvimento Web
- APIs REST
- Banco de Dados
- Segurança
- Engenharia de Software
- Controle de versão
- Conteinerização


• Licença
Projeto desenvolvido para fins acadêmicos e educacionais.
