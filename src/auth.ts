import NextAuth from "next-auth";
import "next-auth/jwt";
import Salesforce from "next-auth/providers/salesforce";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Salesforce({
      clientId: process.env.SALESFORCE_CLIENT_ID,
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
      issuer: process.env.SALESFORCE_LOGIN_URL,
      authorization: {
        params: {
          scope: "id profile email api full refresh_token",          prompt: "consent",        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
        try {
          console.log("[nextauth][jwt] called", { hasAccount: Boolean(account), token: { ...token, error: token.error } });
        } catch (e) {
          console.error("[nextauth][jwt] log failed", e);
        }
      if (account) {
          try { console.log('[nextauth][jwt] account payload', account); } catch (e) {}
        if (account.access_token) {
          token.accessToken = account.access_token as string;
        }
        if (account.instance_url) {
          token.instanceUrl = account.instance_url as string;
        }
        if (account.refresh_token) {
          token.refreshToken = account.refresh_token as string;
        }
        if (account.expires_in) {
          token.expiresAt = Date.now() + (account.expires_in as number) * 1000;
        }
        token.error = undefined;
        return token;
      }

      if (token.expiresAt && Date.now() < token.expiresAt) {
        token.error = undefined;
        return token;
      }

      // If Salesforce does not return token expiry metadata, keep the current
      // access token and avoid refreshing until we have a reason to do so.
      if (!token.expiresAt && token.accessToken) {
        token.error = undefined;
        return token;
      }

      if (!token.refreshToken) {
        if (token.accessToken) {
          token.error = undefined;
          return token;
        }

        return {
          ...token,
          accessToken: undefined,
          instanceUrl: undefined,
          error: "NoRefreshToken",
        };
      }

      try {
        try { console.log('[nextauth][jwt] attempting token refresh', { refreshToken: token.refreshToken }); } catch (e) {}
        const tokenUrl =
          process.env.SALESFORCE_TOKEN_URL ??
          `${process.env.SALESFORCE_LOGIN_URL}/services/oauth2/token`;

        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: process.env.SALESFORCE_CLIENT_ID!,
            client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
            refresh_token: token.refreshToken as string,
          }),
        });

        const refreshedTokens = await response.json();

        if (!response.ok) {
          console.error("Salesforce refresh error", refreshedTokens);
          return {
              ...token,
              // Preserve any existing access token/instanceUrl so the user isn't immediately signed out.
              // Clear refresh token and expiry so a full re-auth can be initiated.
              refreshToken: undefined,
              expiresAt: undefined,
              error: refreshedTokens.error_description || refreshedTokens.error || "RefreshAccessTokenError",
          };
        }

        return {
          ...token,
          accessToken: refreshedTokens.access_token as string,
          instanceUrl: refreshedTokens.instance_url as string || token.instanceUrl,
          refreshToken: refreshedTokens.refresh_token ? refreshedTokens.refresh_token as string : token.refreshToken,
          expiresAt: Date.now() + (refreshedTokens.expires_in as number) * 1000,
          error: undefined,
        };
      } catch (error) {
        console.error("Failed to refresh Salesforce access token", error);
        return {
          ...token,
            // Keep existing accessToken/instanceUrl (if present) to avoid immediate logout.
            refreshToken: undefined,
            expiresAt: undefined,
            error: "RefreshAccessTokenError",
        };
      }
    },
    async session({ session, token }) {
      if (token.accessToken) {
        session.accessToken = token.accessToken as string;
      }
      if (token.instanceUrl) {
        session.instanceUrl = token.instanceUrl as string;
      }
      if (token.error) {
        session.error = token.error as string;
      }
      return session;
    },
  },
});

// Session aur JWT ke custom properties ke liye TypeScript interfaces ko extend karna
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    instanceUrl?: string;
    error?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    instanceUrl?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
  }
}