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
escooter-go-management/
│
├── server/
│   ├── server.js
│   ├── database.js
│   ├── database.sql
│   ├── package.json
│   └── docker-compose.yml
│
├── css/
├── js/
├── images/
├── *.html
│
└── README.md

• Banco de Dados
O sistema utiliza PostgreSQL para armazenamento persistente dos
dados da aplicação.
Entre as informações armazenadas estão:
- Usuários
- Clientes
- Funcionários
- Patinetes
- Pontos
- Locações
- Manutenções
- Histórico de operações
- Configurações do sistema
O banco pode ser administrado utilizando o pgAdmin e também pode ser
executado utilizando Docker Compose.
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
