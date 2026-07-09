# Alcance — Backend

API REST del marketplace que conecta anunciantes con micro-influencers.

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Instalación

```bash
npm install
cp .env.example .env
```

Edita `.env` con los datos reales de tu base de datos y un `JWT_SECRET` propio.

## Crear la base de datos

```bash
createdb alcance_db
psql alcance_db < db/schema.sql
```

## Correr el servidor

```bash
npm run dev     # con recarga automática (nodemon)
# o
npm start
```

El servidor queda en `http://localhost:4000`. Puedes probar que está vivo con:

```bash
curl http://localhost:4000/api/health
```

## Endpoints principales

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Crear cuenta (anunciante o influencer) | No |
| POST | `/api/auth/login` | Iniciar sesión, devuelve JWT | No |
| GET | `/api/spaces` | Catálogo de espacios (filtros: category, minFollowers, maxPrice) | No |
| POST | `/api/spaces` | Publicar un espacio nuevo | Influencer |
| PATCH | `/api/spaces/:id` | Editar/desactivar un espacio propio | Influencer |
| POST | `/api/requests` | Enviar solicitud a un espacio | Anunciante |
| GET | `/api/requests/received` | Ver solicitudes recibidas | Influencer |
| GET | `/api/requests/sent` | Ver solicitudes enviadas | Anunciante |
| PATCH | `/api/requests/:id/respond` | Aceptar/rechazar solicitud (genera transacción si se acepta) | Influencer |

## Ejemplo rápido

```bash
# Registrar un influencer
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "María López",
    "email": "maria@example.com",
    "password": "supersegura123",
    "role": "influencer",
    "profile": { "category": "Moda", "followers": 18000, "engagement_rate": 3.5 }
  }'

# Ver catálogo
curl http://localhost:4000/api/spaces
```

## Próximos pasos sugeridos

- Conectar Stripe (o pasarela local) para procesar `transactions.status = 'paid'` de verdad
- Subida de imágenes de perfil/creatividades (ej. con S3 o Cloudinary)
- Endpoint de mensajería (tabla `messages` ya está en el esquema)
- Tests automatizados (Jest + supertest)
