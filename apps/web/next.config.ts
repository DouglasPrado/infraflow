import type { NextConfig } from "next";

/** A API roda em processo separado; em produção troque por `API_URL`. */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3333";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // A web fala com a API pela mesma origem. Sem isso, o cookie de sessão
      // exigiria CORS com credenciais e configuração de SameSite mais frágil.
      { source: "/api/:path*", destination: `${API_URL}/:path*` },
    ];
  },
};

export default nextConfig;
