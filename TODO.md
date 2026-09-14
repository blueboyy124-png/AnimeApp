# Completed

- [x] Replaced the **module-level** hardcoded `TMDB_API_KEY = "e0554f6521da4365d4a36ea7ff17ae51"` with `process.env.NEXT_PUBLIC_TMDB_API_KEY || ""` in `watch/page.tsx`.
- [x] Removed the **duplicate shadowed** `const TMDB_API_KEY = "e0554f6521da4365d4a36ea7ff17ae51"` that was inside the MOVIE/TV metadata `useEffect` (it already reads the module-level one).
- [x] The key is now driven by `NEXT_PUBLIC_TMDB_API_KEY` environment variable (Next.js client-side env convention), with an empty string fallback + a console warning if missing.


Update ui home