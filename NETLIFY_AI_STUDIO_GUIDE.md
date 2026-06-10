# Netlify Hosting Refactor Guide for gcos-v4

## Goal
Refactor the existing Vite + React project so it can be hosted as a static site on Netlify, with server-side API behavior migrated from `server.ts` into Netlify Functions.

## Current architecture
- Frontend: Vite + React app built into `dist`
- Backend: `server.ts` running Express and Supabase admin API routes
- API routes are currently mounted under `/api/*`
- The app already has a `src/lib/api.ts` helper to unify API requests

## Required refactor tasks

1. Convert `server.ts` Express routes into a Netlify Function
   - Create `netlify/functions/api.ts`
   - Initialize Supabase with `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` / `VITE_SUPABASE_ANON_KEY`
   - Preserve the existing API endpoints:
     - `GET /api/health`
     - `POST /api/reseller/request-reset`
     - `POST /api/admin/reset-reseller-password`
     - `POST /api/admin/create-reseller`
     - `POST /api/admin/create-admin`
     - `POST /api/register-reseller`
     - `POST /api/admin/verify-all`
     - `POST /api/scrape`
     - `POST /api/sync`
     - `POST /api/send-notification`
   - Use event path normalization and a router switch to dispatch requests
   - Return JSON responses using Netlify function response shape

2. Update Netlify configuration
   - Add `functions = "netlify/functions"` to `netlify.toml`
   - Add a redirect rule that maps `/api/*` to `/.netlify/functions/api/:splat`
   - Preserve the SPA fallback rule so all non-API routes return `/index.html`

3. Keep frontend API request helper compatible with Netlify
   - Ensure `src/lib/api.ts` resolves relative `/api` URLs when `VITE_API_BASE_URL` is unset
   - Continue calling API endpoints via `apiFetch("/api/...", ...)`

4. Update deployment docs and variable expectations
   - Document that Netlify now hosts the static frontend and serverless API
   - List required environment variables:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `VITE_API_BASE_URL` optionally for external API backends

## Suggested improvements
- Split large route logic into smaller function files if the API expands further
- Use dedicated Netlify functions per resource for better scaling and smaller cold-start behavior
- Clean up or deprecate `server.ts` if the codebase fully moves to Netlify
- Add local Netlify dev instructions using `netlify dev` if the CLI is available
- Consider code-splitting large admin pages and lazy-loading assets to reduce bundle size

## Notes for the AI agent
- The repository is a Vite + React app with an existing `server.ts` Express backend.
- The backend should no longer be served by Express in Netlify deployments.
- The function should receive requests under `/api/*`, handle JSON parsing, and call Supabase using the server-side service key.
- Keep the static build output in `dist` and use `netlify.toml` for redirects.
