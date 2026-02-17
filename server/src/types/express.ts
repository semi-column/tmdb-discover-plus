declare global {
  namespace Express {
    interface Request {
      apiKey?: string;
      apiKeyId?: string;
      config?: import('./config.ts').UserConfig;
    }
    interface Response {
      etagJson?(data: unknown, options?: { extra?: string }): void;
    }
  }
}

export {};
