import type { RPCSchema } from "electrobun/view";

export type BrowserRPC = {
  bun: RPCSchema<{
    requests: {
      config: { params: {}; response: { platform: string; partition: string } };
      guardTabRemoval: { params: {}; response: void };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: { command: { action: string } };
  }>;
};
