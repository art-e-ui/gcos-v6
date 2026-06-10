# Netlify Deployment
This project has been refactored for static hosting on Netlify with serverless API via Netlify Functions.

## Environment Variables
Ensure the following variables are set in your Netlify site settings:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Required for admin/API operations)
- `VITE_API_BASE_URL` (Optional, defaults to relative `/api/*`)

## Local Development
To run this project locally with API routing properly proxied to serverless functions, you should use the Netlify CLI.

1. Install Netlify CLI:
```bash
npm i -g netlify-cli
```

2. Run the local dev server:
```bash
netlify dev
```

This ensures `netlify.toml` redirects apply and `/.netlify/functions/api` handles your API endpoints locally just like in production.
