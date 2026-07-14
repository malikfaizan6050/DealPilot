import NextAuth from "next-auth";
import "next-auth/jwt";
import Salesforce from "next-auth/providers/salesforce";

type SalesforceAccount = {
  access_token?: string;
  refresh_token?: string;
  instance_url?: string;
  expires_in?: number | string;
};

type SalesforceRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  instance_url?: string;
  expires_in?: number | string;
  error?: string;
};

const salesforceLoginUrl =
  process.env.SALESFORCE_LOGIN_URL ?? "https://login.salesforce.com";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Salesforce({
      clientId: process.env.SALESFORCE_CLIENT_ID,
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
      issuer: salesforceLoginUrl,
      authorization: {
        params: {
          scope: "id profile email api full refresh_token",
          prompt: "consent",
        },
      },
    }),
  ],

  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        const salesforceAccount = account as SalesforceAccount;

        if (salesforceAccount.access_token) {
          token.accessToken = salesforceAccount.access_token;
        }

        if (salesforceAccount.instance_url) {
          token.instanceUrl = salesforceAccount.instance_url;
        }

        if (salesforceAccount.refresh_token) {
          token.refreshToken = salesforceAccount.refresh_token;
        }

        const expiresIn = Number(salesforceAccount.expires_in);

        token.expiresAt =
          Number.isFinite(expiresIn) && expiresIn > 0
            ? Date.now() + expiresIn * 1000
            : undefined;

        token.error = undefined;

        return token;
      }

      if (
        token.accessToken &&
        token.expiresAt &&
        Date.now() < token.expiresAt - 60_000
      ) {
        token.error = undefined;
        return token;
      }

      if (token.accessToken && !token.expiresAt) {
        token.error = undefined;
        return token;
      }

      const refreshToken = token.refreshToken;

      if (!refreshToken) {
        return {
          ...token,
          accessToken: undefined,
          instanceUrl: undefined,
          expiresAt: undefined,
          error: "NoRefreshToken",
        };
      }

      try {
        const tokenUrl =
          process.env.SALESFORCE_TOKEN_URL ??
          `${salesforceLoginUrl}/services/oauth2/token`;

        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: process.env.SALESFORCE_CLIENT_ID ?? "",
            client_secret: process.env.SALESFORCE_CLIENT_SECRET ?? "",
            refresh_token: refreshToken,
          }),
          cache: "no-store",
        });

        const refreshedTokens =
          (await response.json()) as SalesforceRefreshResponse;

        if (!response.ok || !refreshedTokens.access_token) {
          console.error("Salesforce token refresh failed", {
            status: response.status,
            error: refreshedTokens.error ?? "unknown_error",
          });

          return {
            ...token,
            accessToken: undefined,
            instanceUrl: undefined,
            refreshToken: undefined,
            expiresAt: undefined,
            error: "RefreshAccessTokenError",
          };
        }

        const expiresIn = Number(refreshedTokens.expires_in);

        return {
          ...token,
          accessToken: refreshedTokens.access_token,
          instanceUrl:
            refreshedTokens.instance_url ?? token.instanceUrl,
          refreshToken:
            refreshedTokens.refresh_token ?? refreshToken,
          expiresAt:
            Number.isFinite(expiresIn) && expiresIn > 0
              ? Date.now() + expiresIn * 1000
              : undefined,
          error: undefined,
        };
      } catch (error) {
        console.error(
          "Unable to refresh Salesforce access token",
          error instanceof Error
            ? error.message
            : "Unknown refresh error",
        );

        return {
          ...token,
          accessToken: undefined,
          instanceUrl: undefined,
          refreshToken: undefined,
          expiresAt: undefined,
          error: "RefreshAccessTokenError",
        };
      }
    },

    async session({ session, token }) {
      if (token.accessToken) {
        session.accessToken = token.accessToken;
      }

      if (token.instanceUrl) {
        session.instanceUrl = token.instanceUrl;
      }

      if (token.error) {
        session.error = token.error;
      }

      return session;
    },
  },
});

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