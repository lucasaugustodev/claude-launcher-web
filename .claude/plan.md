# Landing Page - Captura de Formulário

## Visão Geral
Criar um projeto separado em `/opt/landing-page/` com uma landing page moderna para captura de leads via formulário.

## Stack
- **Frontend**: HTML + CSS + JS vanilla (sem frameworks)
- **Backend**: Node.js + Express (API simples para receber formulário)
- **Storage**: Arquivo JSON local (`leads.json`)

## Estrutura do Projeto

```
/opt/landing-page/
├── package.json
├── server.js          # Express server + API POST /api/leads
├── leads.json         # Dados dos leads salvos
├── public/
│   ├── index.html     # Landing page completa
│   ├── css/
│   │   └── style.css  # Estilos modernos
│   └── js/
│       └── app.js     # Lógica do formulário (validação + submit)
```

## Campos do Formulário
- Nome completo
- Email

## Design
- Visual moderno, clean, estilo SaaS
- Gradiente escuro como hero section
- Formulário centralizado com destaque
- Responsivo (mobile-first)
- Animações sutis

## Funcionalidades
1. **Landing page** com hero, benefícios e CTA
2. **Formulário** com validação client-side
3. **API POST /api/leads** que salva no JSON
4. **Feedback visual** de sucesso/erro ao enviar
5. **Rota GET /api/leads** para consultar leads salvos

## Steps
1. Criar estrutura do projeto e `package.json`
2. Criar `server.js` com Express + rotas de API
3. Criar `index.html` com a landing page completa
4. Criar `style.css` com design moderno responsivo
5. Criar `app.js` com validação e envio do formulário
6. Testar tudo funcionando
