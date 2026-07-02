# A360 Assistant Frontend

Minimal Vue.js test frontend for the A360 FastAPI backend.

## Local Run

```powershell
npm install
npm run dev
```

Default local backend:

```text
http://localhost:8000
```

Override it with:

```powershell
copy .env.example .env.local
```

Then edit:

```text
VITE_API_BASE_URL=http://localhost:8000
```

## Vercel

Option A: connect this GitHub repository from the Vercel dashboard and set the environment variable below.

Option B: use the included GitHub Actions workflow:

```text
.github/workflows/vercel-deploy.yml
```

Required GitHub Secrets for Option B:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
VITE_API_BASE_URL
```

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

Set this Vercel environment variable:

```text
VITE_API_BASE_URL=https://your-backend-domain.example.com
```

The backend CloudFormation `FrontendOrigins` must include the final Vercel URL.
