# Senditto Database Studio

Standalone operator console for the **Senditto product** PostgreSQL database.

This project is **completely separate** from the Senditto Platform (email product UI).

## Security

- **Never display server IPs, public hosts, or raw API endpoints in the UI.**
- Connection details live only in local env / operator secrets (not committed).
- `.env.local` is gitignored.

## Run

```bash
# create .env.local with VITE_DB_API_BASE and VITE_DB_API_TOKEN (do not commit)
npm install
npm run dev
```

Opens on `http://localhost:5180`.
